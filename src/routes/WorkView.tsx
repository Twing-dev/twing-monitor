import { useCallback, useEffect, useMemo, useState } from "react";
import { useApiFetch, ApiError } from "../api/client.js";
import { fetchDesigns, fetchDesignById } from "../api/designs.js";
import { fetchActivity } from "../api/activity.js";
import { fetchAlignmentThreads } from "../api/alignmentThreads.js";
import { fetchClaims } from "../api/claims.js";
import type { ActivityEvent, AlignmentThread, DesignStatement, ProjectSummary } from "../api/types.js";
import { resolveAlignmentBucket } from "../api/types.js";
import { useAuth } from "../auth/useAuth.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { useOnDemandDesigns } from "../hooks/useOnDemandDesigns.js";
import { RepoBadge } from "../components/RepoBadge.js";
import { CopyLinkButton } from "../components/CopyLinkButton.js";
import { LatestCheckOutcome, SemanticOverlapNote, ResolveActions, DeclaredChanges, PathList, type SemanticOverlap } from "../components/DesignDetail.js";
import { relativeTime } from "../lib/time.js";
import { toBullets } from "../lib/summaryBullets.js";
import { dedupeDesignsByGroup, uniqueBy, type DesignGroup } from "../lib/aggregate.js";
import { blastRadius, hasStructuredChanges } from "../lib/designConformance.js";
import { formatActivityEvent } from "../lib/activityFormat.js";
import { buildShareUrl } from "../lib/urlState.js";

/** The unified "list of designs, click one, work from its tabs" home screen
 * (2026-09): replaces the old Overview + Designs + Conflicts three-tab split
 * with one always-visible list (left) and one always-visible detail pane
 * (right) -- selecting a row updates the right pane instead of navigating
 * away, and a design's conflict (if it has one) lives under a tab on its own
 * row instead of a separate page you have to know to go check. Conflicts
 * (Reviews/Alignment threads) stay reachable as their own page too -- a
 * review's admin queue and a thread's *other* party aren't always "this one
 * design you're looking at," so the exhaustive browse view didn't go away,
 * it just moved off the primary nav (see RepoDetailLayout's top bar). */

type Section = "attention" | "progress" | "resolved";
type FilterPill = "all" | Section;

const PILLS: { value: FilterPill; label: string }[] = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs attention" },
  { value: "resolved", label: "Resolved" },
];

const SECTION_HEADING: Record<Section, string> = {
  attention: "Needs attention",
  progress: "In progress",
  resolved: "Resolved",
};

/** Same "one project-wide `design_checked` fetch, newest wins per design"
 * approach DesignsView uses for its own list-level chip -- copied rather
 * than imported since DesignsView.tsx stays as an independent, still-tested
 * file this change doesn't touch. */
function latestCheckByDesign(events: ActivityEvent[]): Map<string, { verdict: string }> {
  const byDesign = new Map<string, { verdict: string }>();
  for (const event of events) {
    if (!event.relatedId || byDesign.has(event.relatedId)) continue;
    const payload = event.payload as { verdict?: string } | undefined;
    if (!payload?.verdict) continue;
    byDesign.set(event.relatedId, { verdict: payload.verdict });
  }
  return byDesign;
}

function findSemanticOverlapThread(threads: AlignmentThread[], designId: string): AlignmentThread | undefined {
  return threads.find((t) => resolveAlignmentBucket(t.category) === "llm_divergence" && (t.designId === designId || t.initiatingDesignId === designId));
}

function counterpartIdsForOverlaps(members: DesignStatement[], openThreads: AlignmentThread[]): string[] {
  const ids: string[] = [];
  for (const member of members) {
    const thread = findSemanticOverlapThread(openThreads, member.id);
    if (!thread) continue;
    const counterpartId = thread.initiatingDesignId === member.id ? thread.designId : thread.initiatingDesignId;
    if (counterpartId) ids.push(counterpartId);
  }
  return ids;
}

function designFlags(group: DesignGroup, latestChecks: Map<string, { verdict: string }>, openThreads: AlignmentThread[]): { anyUnresolvedWarning: boolean; anySemanticOverlap: boolean } {
  const anyUnresolvedWarning = group.members.some((m) => {
    const check = latestChecks.get(m.id);
    return m.status === "open" && check?.verdict === "file_overlap";
  });
  const anySemanticOverlap = group.members.some((m) => findSemanticOverlapThread(openThreads, m.id));
  return { anyUnresolvedWarning, anySemanticOverlap };
}

function sectionFor(primary: DesignStatement, flags: { anyUnresolvedWarning: boolean; anySemanticOverlap: boolean }): Section {
  if (primary.status === "flagged" || flags.anyUnresolvedWarning || flags.anySemanticOverlap) return "attention";
  if (primary.status === "closed" || primary.status === "superseded" || primary.status === "expired") return "resolved";
  return "progress";
}

type ProjectPage = { items: DesignStatement[]; nextBefore?: number };
type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };
type DetailTab = "overview" | "changes" | "conflict" | "activity";

export function WorkView({
  projectIds,
  projectsById,
  focusDesignId,
  onClearFocus,
  onOpenTab,
  readOnly,
}: {
  projectIds: string[];
  projectsById: Record<string, ProjectSummary>;
  focusDesignId?: string;
  onClearFocus?: () => void;
  onOpenTab?: (tab: "conflicts") => void;
  readOnly?: boolean;
}) {
  const apiFetch = useApiFetch();
  const { auth } = useAuth();
  const [pill, setPill] = useState<FilterPill>("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [refreshKey, setRefreshKey] = useState(0);
  const [pages, setPages] = useState<Record<string, ProjectPage>>({});
  const [listState, setListState] = useState<LoadState>({ status: "loading" });

  const projectIdsKey = projectIds.join(",");
  const developerId = mineOnly ? auth?.developerId : undefined;

  const loadFirstPage = useCallback(() => {
    let cancelled = false;
    setListState({ status: "loading" });
    Promise.all(projectIds.map((pid) => fetchDesigns(apiFetch, pid, { status: "all", developerId }).then((page) => [pid, page] as const)))
      .then((results) => {
        if (cancelled) return;
        setPages(Object.fromEntries(results.map(([pid, page]) => [pid, { items: page.items, nextBefore: page.nextBefore }])));
        setListState({ status: "ready" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setListState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch, projectIdsKey, developerId, refreshKey]);

  useEffect(() => loadFirstPage(), [loadFirstPage]);

  async function loadMore() {
    const toFetch = projectIds.filter((pid) => pages[pid]?.nextBefore !== undefined);
    if (toFetch.length === 0) return;
    try {
      const results = await Promise.all(
        toFetch.map((pid) => fetchDesigns(apiFetch, pid, { status: "all", developerId, before: pages[pid].nextBefore }).then((page) => [pid, page] as const)),
      );
      setPages((prev) => {
        const next = { ...prev };
        for (const [pid, page] of results) next[pid] = { items: [...(prev[pid]?.items ?? []), ...page.items], nextBefore: page.nextBefore };
        return next;
      });
    } catch (err) {
      setListState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const items = useMemo(() => Object.values(pages).flatMap((p) => p.items).sort((a, b) => b.lastActivityAt - a.lastActivityAt), [pages]);
  const hasMore = Object.values(pages).some((p) => p.nextBefore !== undefined);

  // A copy-link URL or a cross-link from another design's Conflict tab names
  // one specific design that may not be on an already-loaded page -- fetched
  // directly by id, same "resolve directly, don't paginate to find it"
  // convention DesignsView's own focus handling uses, and merged into the
  // list below rather than replacing it (split-pane always shows the whole
  // list; there's no separate "focus page" to switch into).
  const focusState = useAsyncData(
    () =>
      !focusDesignId
        ? Promise.resolve(undefined)
        : fetchDesignById(apiFetch, focusDesignId).catch((err: unknown) => {
            if (err instanceof ApiError && err.status === 404) return undefined;
            throw err;
          }),
    [apiFetch, focusDesignId, refreshKey],
  );

  const allItems = useMemo(() => {
    if (focusState.status !== "ready" || !focusState.data) return items;
    const extra = [focusState.data.design, ...focusState.data.groupMembers];
    const known = new Set(items.map((d) => d.id));
    return [...items, ...extra.filter((d) => !known.has(d.id))];
  }, [items, focusState]);

  const groups = useMemo(() => dedupeDesignsByGroup(allItems), [allItems]);

  const checksState = useAsyncData(
    () => Promise.all(projectIds.map((pid) => fetchActivity(apiFetch, pid, { kinds: ["design_checked"], limit: 200 }))).then((pages) => pages.flatMap((p) => p.items).sort((a, b) => b.ts - a.ts)),
    [apiFetch, projectIdsKey, refreshKey],
  );
  const latestChecks = checksState.status === "ready" ? latestCheckByDesign(checksState.data) : new Map<string, { verdict: string }>();
  const openThreadsState = useAsyncData(
    () => Promise.all(projectIds.map((pid) => fetchAlignmentThreads(apiFetch, pid, { status: "open" }))).then((pages) => pages.flatMap((p) => p.items)),
    [apiFetch, projectIdsKey, refreshKey],
  );
  const openThreads = openThreadsState.status === "ready" ? openThreadsState.data : [];

  const showRepoBadge = projectIds.length > 1;

  const rows = useMemo(
    () =>
      groups.map((group) => {
        const primary = group.members[0];
        const flags = designFlags(group, latestChecks, openThreads);
        return { group, primary, flags, section: sectionFor(primary, flags) };
      }),
    [groups, latestChecks, openThreads],
  );

  const counts = useMemo(() => {
    const c: Record<Section, number> = { attention: 0, progress: 0, resolved: 0 };
    for (const r of rows) c[r.section]++;
    return c;
  }, [rows]);

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.primary.summary.toLowerCase().includes(q) || r.primary.developerId.toLowerCase().includes(q));
  }, [rows, query]);

  const visibleRows = pill === "all" ? searched : searched.filter((r) => r.section === pill);

  // Auto-select the first visible row whenever the current selection drops
  // out of view (filter/search changed, or nothing selected yet) -- keeps
  // the detail pane from ever showing a row the list no longer displays.
  useEffect(() => {
    if (focusDesignId) return; // the focus effect below owns selection while a focus id is active
    if (visibleRows.some((r) => r.group.key === selectedKey)) return;
    setSelectedKey(visibleRows[0]?.group.key ?? null);
    setDetailTab("overview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows.map((r) => r.group.key).join(","), focusDesignId]);

  useEffect(() => {
    if (!focusDesignId || focusState.status !== "ready" || !focusState.data) return;
    const key = focusState.data.design.groupId ?? focusState.data.design.id;
    setSelectedKey(key);
    setDetailTab("overview");
  }, [focusDesignId, focusState]);

  function selectRow(key: string) {
    setSelectedKey(key);
    setDetailTab("overview");
    if (focusDesignId) onClearFocus?.();
  }

  /** A cross-link from another design's Conflict tab (its semantic-overlap
   * counterpart) -- jumps straight to that design regardless of the current
   * filter/search, same as DesignsView's own jumpToDesign. */
  function openDesign(designId: string) {
    setPill("all");
    setMineOnly(false);
    setQuery("");
    const group = groups.find((g) => g.members.some((m) => m.id === designId));
    setSelectedKey(group?.key ?? designId);
    setDetailTab("conflict");
  }

  const selected = rows.find((r) => r.group.key === selectedKey);

  const neededCounterpartIds = useMemo(() => counterpartIdsForOverlaps(selected ? selected.group.members : [], openThreads), [selected, openThreads]);
  const designsById = useOnDemandDesigns(apiFetch, neededCounterpartIds);

  if (listState.status === "loading" && groups.length === 0) return <p className="empty-state">Loading…</p>;
  if (listState.status === "error") {
    return (
      <p className="empty-state error" role="alert">
        Couldn't load: {listState.message}
      </p>
    );
  }

  return (
    <div className="work-body">
      <div className="work-pane-list">
        <div className="work-filter-row">
          {PILLS.map((p) => (
            <button key={p.value} type="button" className={`work-pill${pill === p.value ? " active" : ""}`} onClick={() => setPill(p.value)}>
              {p.label} {p.value === "all" ? rows.length : counts[p.value]}
            </button>
          ))}
          <label className="checkbox-filter work-mine-only">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
            Mine
          </label>
        </div>

        {visibleRows.length === 0 ? (
          <p className="empty-state">No designs match this filter.</p>
        ) : (
          <div className="work-rows">
            {(pill === "all" ? (["attention", "progress", "resolved"] as Section[]) : [pill]).map((section) => {
              const inSection = visibleRows.filter((r) => r.section === section);
              if (inSection.length === 0) return null;
              return (
                <div key={section}>
                  {pill === "all" && (
                    <div className={`work-section-heading${section === "attention" ? " attention" : ""}`}>
                      {SECTION_HEADING[section]} <span className="n">{inSection.length}</span>
                    </div>
                  )}
                  {inSection.map(({ group, primary, flags }) => (
                    <button
                      key={group.key}
                      type="button"
                      className={`work-row${selectedKey === group.key ? " selected" : ""}`}
                      onClick={() => selectRow(group.key)}
                    >
                      <div className="work-row-summary">{primary.summary}</div>
                      <div className="work-row-meta">
                        <span className={`work-status-dot ${section}`} aria-hidden="true" />
                        {showRepoBadge && uniqueBy(group.members, (m) => m.projectId).map((m) => <RepoBadge key={m.projectId} project={projectsById[m.projectId] ?? { projectId: m.projectId }} />)}
                        <span>{primary.developerId}</span>
                        <span className="sep">{relativeTime(primary.lastActivityAt)}</span>
                        {primary.status === "flagged" && <span className="work-badge conflict">flagged</span>}
                        {primary.status !== "flagged" && flags.anySemanticOverlap && <span className="work-badge conflict">overlap</span>}
                        {primary.status !== "flagged" && !flags.anySemanticOverlap && flags.anyUnresolvedWarning && <span className="work-badge warn">file overlap</span>}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        {hasMore && (
          <button type="button" className="load-more-button" onClick={loadMore}>
            Load older
          </button>
        )}
      </div>

      <div className="work-pane-detail">
        {!selected ? (
          <p className="empty-state">Select a design to see its details.</p>
        ) : (
          <DesignDetailPane
            key={selected.group.key}
            group={selected.group}
            flags={selected.flags}
            showRepoBadge={showRepoBadge}
            projectsById={projectsById}
            openThreads={openThreads}
            designsById={designsById}
            tab={detailTab}
            onTabChange={setDetailTab}
            onResolved={() => setRefreshKey((k) => k + 1)}
            onOpenDesign={openDesign}
            onOpenTab={onOpenTab}
            readOnly={readOnly}
          />
        )}
      </div>
    </div>
  );
}

/** One member's declared changes, with its own claims fetched by session --
 * a linked group can span sessions (and projects), so conformance ("did the
 * code match the plan") has to be checked per member rather than once for
 * the group. Mirrors DesignDetail's own top-level claims fetch, just scoped
 * to whichever member this is. */
function MemberChanges({ member }: { member: DesignStatement }) {
  const apiFetch = useApiFetch();
  const claimsState = useAsyncData(() => fetchClaims(apiFetch, member.projectId, member.sessionId), [apiFetch, member.projectId, member.sessionId]);

  return (
    <>
      {hasStructuredChanges(member.changes) ? (
        <DeclaredChanges changes={member.changes} claims={claimsState.status === "ready" ? claimsState.data : []} />
      ) : (
        <>
          <PathList title="Creates" paths={member.creates} />
          <PathList title="Touches" paths={member.touches} />
        </>
      )}
      <PathList title="Depends on" paths={member.dependsOn} />
    </>
  );
}

function DesignDetailPane({
  group,
  flags,
  showRepoBadge,
  projectsById,
  openThreads,
  designsById,
  tab,
  onTabChange,
  onResolved,
  onOpenDesign,
  onOpenTab,
  readOnly,
}: {
  group: DesignGroup;
  flags: { anyUnresolvedWarning: boolean; anySemanticOverlap: boolean };
  showRepoBadge: boolean;
  projectsById: Record<string, ProjectSummary>;
  openThreads: AlignmentThread[];
  designsById: Record<string, DesignStatement>;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onResolved: () => void;
  onOpenDesign: (designId: string) => void;
  onOpenTab?: (tab: "conflicts") => void;
  readOnly?: boolean;
}) {
  const apiFetch = useApiFetch();
  const primary = group.members[0];
  const hasConflict = primary.status === "flagged" || flags.anyUnresolvedWarning || flags.anySemanticOverlap;
  const bullets = toBullets(primary.summary);

  const activityState = useAsyncData(
    () =>
      Promise.all(group.members.map((m) => fetchActivity(apiFetch, m.projectId, { relatedId: m.id, limit: 50 }))).then((pages) =>
        pages.flatMap((p) => p.items).sort((a, b) => b.ts - a.ts),
      ),
    [apiFetch, group.key, tab === "activity"],
  );

  return (
    <>
      <div className="work-detail-header">
        <div className="work-detail-title">{primary.summary}</div>
        <div className="work-detail-meta">
          {showRepoBadge && uniqueBy(group.members, (m) => m.projectId).map((m) => <RepoBadge key={m.projectId} project={projectsById[m.projectId] ?? { projectId: m.projectId }} />)}
          <span>
            <b>{primary.developerId}</b>
          </span>
          <span>updated {relativeTime(primary.lastActivityAt)}</span>
          <span className={`status-badge tone-neutral`}>{primary.status}</span>
        </div>
        <CopyLinkButton url={buildShareUrl(primary.projectId, "designs", primary.id)} />
      </div>

      <div className="work-tabs">
        <button type="button" className={`work-tab${tab === "overview" ? " active" : ""}`} onClick={() => onTabChange("overview")}>
          Overview
        </button>
        <button type="button" className={`work-tab${tab === "changes" ? " active" : ""}`} onClick={() => onTabChange("changes")}>
          Design change
        </button>
        {hasConflict && (
          <button type="button" className={`work-tab${tab === "conflict" ? " active" : ""}`} onClick={() => onTabChange("conflict")}>
            Conflict
          </button>
        )}
        <button type="button" className={`work-tab${tab === "activity" ? " active" : ""}`} onClick={() => onTabChange("activity")}>
          Activity
        </button>
      </div>

      {tab === "overview" && (
        <div className="work-tab-panel">
          {bullets.length > 0 && (
            <ul className="summary-bullets">
              {bullets.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          <div className="detail-field detail-bookkeeping">
            <h3>Session</h3>
            <dl className="detail-kv">
              <dt>Developer</dt>
              <dd>{primary.developerId}</dd>
              <dt>Session</dt>
              <dd>
                <code>{primary.sessionId}</code>
              </dd>
              <dt>Registered</dt>
              <dd>{relativeTime(primary.createdAt)}</dd>
              <dt>Last activity</dt>
              <dd>{relativeTime(primary.lastActivityAt)}</dd>
            </dl>
          </div>
        </div>
      )}

      {tab === "changes" && (
        <div className="work-tab-panel">
          {hasStructuredChanges(primary.changes) && <p className="work-blast-radius">{blastRadius(primary.changes)}</p>}
          {group.members.map((member) => (
            <div key={member.id}>
              {showRepoBadge && (
                <div className="repo-badge-row">
                  <RepoBadge project={projectsById[member.projectId] ?? { projectId: member.projectId }} />
                </div>
              )}
              <MemberChanges member={member} />
            </div>
          ))}
        </div>
      )}

      {tab === "conflict" && hasConflict && (
        <div className="work-tab-panel">
          {group.members.map((member) => {
            const semanticThread = findSemanticOverlapThread(openThreads, member.id);
            const semanticOverlap: SemanticOverlap | undefined = semanticThread
              ? { thread: semanticThread, counterpart: designsById[semanticThread.initiatingDesignId === member.id ? semanticThread.designId! : semanticThread.initiatingDesignId!] }
              : undefined;
            return (
              <div key={member.id}>
                {showRepoBadge && (
                  <div className="repo-badge-row">
                    <RepoBadge project={projectsById[member.projectId] ?? { projectId: member.projectId }} />
                  </div>
                )}
                <LatestCheckOutcome design={member} />
                {semanticOverlap && <SemanticOverlapNote overlap={semanticOverlap} onOpenDesign={onOpenDesign} onOpenTab={onOpenTab} />}
                <ResolveActions design={member} onResolved={onResolved} readOnly={readOnly} />
              </div>
            );
          })}
        </div>
      )}

      {tab === "activity" && (
        <div className="work-tab-panel">
          {activityState.status === "loading" && <p className="empty-state">Loading…</p>}
          {activityState.status === "error" && (
            <p className="empty-state error" role="alert">
              Couldn't load: {activityState.message}
            </p>
          )}
          {activityState.status === "ready" && activityState.data.length === 0 && <p className="empty-state">No activity yet.</p>}
          {activityState.status === "ready" && activityState.data.length > 0 && (
            <ul className="work-activity-list">
              {activityState.data.map((event) => {
                const formatted = formatActivityEvent(event);
                return (
                  <li key={event.id} className="work-activity-item">
                    <span className="work-activity-time">{relativeTime(event.ts)}</span>
                    <span>{formatted.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
