import { useState } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchDesigns } from "../api/designs.js";
import { fetchActivity } from "../api/activity.js";
import { fetchAlignmentThreads } from "../api/alignmentThreads.js";
import type { ActivityEvent, AlignmentThread, DesignStatement, ProjectSummary } from "../api/types.js";
import { resolveAlignmentBucket } from "../api/types.js";
import { useAuth } from "../auth/useAuth.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AsyncSection } from "../components/AsyncSection.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { RepoBadge } from "../components/RepoBadge.js";
import { DesignDetail, type SemanticOverlap } from "../components/DesignDetail.js";
import { CopyLinkButton } from "../components/CopyLinkButton.js";
import { relativeTime } from "../lib/time.js";
import { toBullets } from "../lib/summaryBullets.js";
import { toneForDesignStatus } from "../lib/designStatus.js";
import { dedupeDesignsByGroup, uniqueBy, type DesignGroup } from "../lib/aggregate.js";
import { buildShareUrl } from "../lib/urlState.js";

const STATUSES = ["open", "flagged", "dormant", "superseded", "closed", "expired", "all"] as const;
type StatusFilter = (typeof STATUSES)[number];

/** `status` alone doesn't tell a list viewer everything worth knowing at a
 * glance: `"file_overlap"` (2026-08-26 terminology simplification, was
 * `"overlap"` tier 1 at "warning" severity) never demotes a design out of
 * `"open"` -- by design, it's always advisory-only -- so without this, an
 * open design with a live, unresolved overlap looks identical to a design
 * with nothing wrong at all until you expand the card. One project-wide
 * `design_checked` fetch (capped at the server's own 200-event page limit
 * -- fine for a dashboard list, not meant to paginate infinitely) covers
 * every visible design in a single request; each design's own latest event
 * wins since the API already returns newest-first. */
function latestCheckByDesign(events: ActivityEvent[]): Map<string, { verdict: string }> {
  const byDesign = new Map<string, { verdict: string }>();
  for (const event of events) {
    if (!event.relatedId || byDesign.has(event.relatedId)) continue; // newest-first: first hit per id is the latest
    const payload = event.payload as { verdict?: string } | undefined;
    if (!payload?.verdict) continue;
    byDesign.set(event.relatedId, { verdict: payload.verdict });
  }
  return byDesign;
}

/** The async Bedrock semantic comparator (`design-semantic-check.ts`) does
 * flag the design it flags (`designs.flag(current.id, "llm_divergence",
 * ...)`, `runSemanticComparatorPass`, packages/server/src/app.ts) -- but
 * only the *initiating* side; the referenced design's own `status` never
 * changes, and either side's `status` reverts to `"open"` on a self-approve
 * resolve while the alignment thread itself stays open until someone
 * closes it (resolving and closing are deliberately separate actions). So
 * without this, a resolved-but-not-yet-closed conflict -- or the
 * referenced side of a live one -- looks identical to a clean design
 * anywhere in the Designs tab, only visible by separately checking
 * Alignment threads.
 *
 * Matches `initiatingDesignId`/`designId` symmetrically, same as `app.ts`
 * does server-side (either id can land in either slot depending on which
 * side you're looking up) -- fixed 2026-08-26. Previously matched via
 * `(t.designId === designId || t.symbolId === designId) &&
 * designsById[t.symbolId]`, relying on `symbolId` being repurposed to hold
 * the initiating design's own id. That convention was already dead by this
 * point: `runSemanticComparatorPass` always passes `symbolIds: []`, and
 * `AlignmentThreadStore.findOrCreate` stores `symbolId: symbolIds[0] ?? ""`
 * -- so `thread.symbolId` was unconditionally `""` on every real
 * `llm_divergence` thread, and no design has an empty-string id. The
 * `&& designsById[t.symbolId]` clause was therefore unconditionally false,
 * which made the *whole* predicate false regardless of the `||` before it
 * -- this never matched for *either* side in production, not merely the
 * initiator: the "semantic overlap" badge and `DesignDetail`'s
 * `SemanticOverlapNote` silently never rendered for anyone. (The one test
 * that exercised this, `DesignsView.test.tsx`, passed anyway because its
 * fixture hand-set `symbolId` to a real design id -- unrepresentative of
 * what the server actually ever writes; fixed alongside this.)
 * `resolveAlignmentBucket` (api/types.ts) normalizes a possibly-legacy
 * pre-2026-08-26 `category` string the same way AlignmentThreadsView does,
 * so old rows keep matching too. */
function findSemanticOverlapThread(threads: AlignmentThread[], designId: string): AlignmentThread | undefined {
  return threads.find((t) => resolveAlignmentBucket(t.category) === "llm_divergence" && (t.designId === designId || t.initiatingDesignId === designId));
}

function designFlags(
  group: DesignGroup,
  latestChecks: Map<string, { verdict: string }>,
  openThreads: AlignmentThread[],
): { anyUnresolvedWarning: boolean; anySemanticOverlap: boolean } {
  // Only surface this for a member still "open" -- "flagged" already
  // carries an amber badge of its own, and doubling up on it here would
  // just be noise. A grouped card can mix statuses across its members, so
  // this looks at every member, not just the primary one.
  const anyUnresolvedWarning = group.members.some((m) => {
    const check = latestChecks.get(m.id);
    return m.status === "open" && check?.verdict === "file_overlap";
  });
  const anySemanticOverlap = group.members.some((m) => findSemanticOverlapThread(openThreads, m.id));
  return { anyUnresolvedWarning, anySemanticOverlap };
}

/** The header row shared by a card's collapsible list form and its
 * standalone focused-page form -- only the wrapping element (button vs.
 * static div) differs between the two, see DesignsView's two render
 * paths below. */
function DesignCardHeaderContent({
  primary,
  members,
  showRepoBadge,
  projectsById,
  anyUnresolvedWarning,
  anySemanticOverlap,
}: {
  primary: DesignStatement;
  members: DesignStatement[];
  showRepoBadge: boolean;
  projectsById: Record<string, ProjectSummary>;
  anyUnresolvedWarning: boolean;
  anySemanticOverlap: boolean;
}) {
  return (
    <>
      <div className="card-top-row">
        <span className="card-summary">{primary.summary}</span>
        <div className="card-badges">
          {anyUnresolvedWarning && <StatusBadge label="overlap warning" tone="warning" />}
          {anySemanticOverlap && <StatusBadge label="semantic overlap" tone="warning" />}
          {/* One badge per distinct repo/status, not per member -- a group can
              have more members than repos (two designs linked in the same
              project) or more members than distinct statuses (a uniformly
              closed group), and a badge per member in either case just repeats
              the same label back-to-back rather than adding information. */}
          {showRepoBadge &&
            uniqueBy(members, (m) => m.projectId).map((m) => <RepoBadge key={m.projectId} project={projectsById[m.projectId] ?? { projectId: m.projectId }} />)}
          {uniqueBy(members, (m) => m.status).map((m) => (
            <StatusBadge key={m.status} label={m.status} tone={toneForDesignStatus(m.status)} />
          ))}
        </div>
      </div>
      <div className="card-meta">
        <span>{primary.developerId}</span>
        <span>{relativeTime(primary.lastActivityAt)}</span>
        {primary.creates.length + primary.touches.length > 0 && (
          <span>
            {primary.creates.length} created, {primary.touches.length} touched
          </span>
        )}
      </div>
    </>
  );
}

/** The expanded body shared by both render paths -- summary bullets plus one
 * DesignDetail per group member. */
function DesignCardBody({
  primary,
  members,
  showRepoBadge,
  projectsById,
  openThreads,
  designsById,
  onResolved,
  onOpenDesign,
  onOpenTab,
  readOnly,
}: {
  primary: DesignStatement;
  members: DesignStatement[];
  showRepoBadge: boolean;
  projectsById: Record<string, ProjectSummary>;
  openThreads: AlignmentThread[];
  designsById: Record<string, DesignStatement>;
  onResolved: () => void;
  onOpenDesign: (designId: string) => void;
  onOpenTab?: (tab: "threads") => void;
  readOnly?: boolean;
}) {
  return (
    <>
      {/* The clamped line in the header above is the card's title; this is
          the summary in full, one bullet per sentence -- a real extracted
          plan describes four or five separate things in one block, and as
          prose you can't tell where one ends. Rendered once for the group
          rather than per member: a groupId-linked group shares one summary
          by design (only `summary` and closing propagate across a group),
          so per-member would repeat the same text. Skipped for an
          already-single-sentence summary, which would just repeat the
          title. */}
      {toBullets(primary.summary).length > 0 && (
        <ul className="summary-bullets">
          {toBullets(primary.summary).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {members.map((member) => {
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
            <DesignDetail design={member} onResolved={onResolved} semanticOverlap={semanticOverlap} onOpenDesign={onOpenDesign} onOpenTab={onOpenTab} readOnly={readOnly} />
          </div>
        );
      })}
    </>
  );
}

export function DesignsView({
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
  onOpenTab?: (tab: "threads") => void;
  readOnly?: boolean;
}) {
  const apiFetch = useApiFetch();
  const { auth } = useAuth();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Bumped by a card's own ResolveActions after a successful adopt/justify
  // -- both the design list (status may have changed) and the bulk
  // design_checked fetch (a fresh check may have run) need to reflect it,
  // and neither has any other way to know a mutation happened elsewhere.
  const [refreshKey, setRefreshKey] = useState(0);

  function jumpToDesign(designId: string) {
    setStatus("all");
    setMineOnly(false);
    setExpandedId(designId);
  }

  // Every fetch below fans out across `projectIds` and merges -- a single
  // repo is just the `projectIds.length === 1` case of the same
  // `Promise.all`. Per-project results are individually sorted
  // newest-first; interleaving several already-sorted lists isn't itself
  // sorted, so each merge re-sorts before use.
  const state = useAsyncData(
    () =>
      Promise.all(projectIds.map((pid) => fetchDesigns(apiFetch, pid, status === "all" ? undefined : status))).then((lists) =>
        lists.flat().sort((a, b) => b.lastActivityAt - a.lastActivityAt),
      ),
    [apiFetch, projectIds.join(","), status, refreshKey],
  );
  const checksState = useAsyncData(
    () =>
      Promise.all(projectIds.map((pid) => fetchActivity(apiFetch, pid, { kinds: ["design_checked"], limit: 200 }))).then((pages) =>
        pages.flatMap((p) => p.items).sort((a, b) => b.ts - a.ts),
      ),
    [apiFetch, projectIds.join(","), refreshKey],
  );
  // Bonus, list-wide context -- same "don't block the primary render on it"
  // stance as DesignDetail's own LatestCheckOutcome: an empty map just means
  // no card gets a conflict chip, not a loading/error state of its own.
  const latestChecks = checksState.status === "ready" ? latestCheckByDesign(checksState.data) : new Map<string, { verdict: string }>();
  const openThreadsState = useAsyncData(
    () => Promise.all(projectIds.map((pid) => fetchAlignmentThreads(apiFetch, pid, "open"))).then((lists) => lists.flat()),
    [apiFetch, projectIds.join(","), refreshKey],
  );
  const openThreads = openThreadsState.status === "ready" ? openThreadsState.data : [];
  // Every status, not just the current filter -- a semantic overlap's
  // counterpart design may not itself match the active status/mine-only
  // filter, and jumpToDesign needs its id to resolve to something real
  // regardless. Also doubles as the focused-page's own data source below
  // (a pasted link names a design regardless of the current filter, or of
  // any filter at all).
  const allDesignsState = useAsyncData(
    () => Promise.all(projectIds.map((pid) => fetchDesigns(apiFetch, pid))).then((lists) => lists.flat()),
    [apiFetch, projectIds.join(","), refreshKey],
  );
  const designsById: Record<string, DesignStatement> = allDesignsState.status === "ready" ? Object.fromEntries(allDesignsState.data.map((d) => [d.id, d])) : {};

  const showRepoBadge = projectIds.length > 1;

  // A copy-link URL (or a jump from another tab) names one specific design
  // to look at -- show only that, not the whole filtered list with it
  // expanded somewhere inside, which for anyone but the most recently
  // active design meant landing on the list and having to scroll to find
  // it. Independent of `status`/`mineOnly` entirely, since this bypasses
  // the filtered list -- source is `allDesignsState`, every status.
  if (focusDesignId) {
    return (
      <div className="list-view">
        <AsyncSection
          state={allDesignsState}
          isEmpty={() => false}
          emptyMessage=""
          render={(items) => {
            const group = dedupeDesignsByGroup(items).find((g) => g.members.some((m) => m.id === focusDesignId));
            return (
              <div className="focus-page">
                <button type="button" className="link-button back-link" onClick={onClearFocus}>
                  ← Back to all designs
                </button>
                {group ? (
                  (() => {
                    const primary = group.members[0];
                    const { anyUnresolvedWarning, anySemanticOverlap } = designFlags(group, latestChecks, openThreads);
                    return (
                      <div className="design-card expanded">
                        <div className="design-card-header">
                          <div className="design-card-toggle has-copy-link">
                            <DesignCardHeaderContent
                              primary={primary}
                              members={group.members}
                              showRepoBadge={showRepoBadge}
                              projectsById={projectsById}
                              anyUnresolvedWarning={anyUnresolvedWarning}
                              anySemanticOverlap={anySemanticOverlap}
                            />
                          </div>
                          <CopyLinkButton url={buildShareUrl(primary.projectId, "designs", primary.id)} />
                        </div>
                        <DesignCardBody
                          primary={primary}
                          members={group.members}
                          showRepoBadge={showRepoBadge}
                          projectsById={projectsById}
                          openThreads={openThreads}
                          designsById={designsById}
                          onResolved={() => setRefreshKey((k) => k + 1)}
                          onOpenDesign={jumpToDesign}
                          onOpenTab={onOpenTab}
                          readOnly={readOnly}
                        />
                      </div>
                    );
                  })()
                ) : (
                  <p className="empty-state">That design couldn't be found -- it may have been removed, or you may not have access.</p>
                )}
              </div>
            );
          }}
        />
      </div>
    );
  }

  return (
    <div className="list-view">
      <div className="filter-bar">
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Filter by status">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s}
            </option>
          ))}
        </select>
        <label className="checkbox-filter">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          Mine only
        </label>
      </div>

      <AsyncSection
        state={state}
        isEmpty={(items) => items.filter((d) => !mineOnly || d.developerId === auth?.developerId).length === 0}
        emptyMessage="No designs match this filter."
        render={(items) => {
          const groups = dedupeDesignsByGroup(items.filter((d) => !mineOnly || d.developerId === auth?.developerId));
          return (
            <ul className="card-list">
              {groups.map((group) => {
                const primary = group.members[0];
                const expanded = group.members.some((m) => m.id === expandedId);
                const { anyUnresolvedWarning, anySemanticOverlap } = designFlags(group, latestChecks, openThreads);
                return (
                  <li key={group.key} className={`design-card${expanded ? " expanded" : ""}`}>
                    <div className="design-card-header">
                      <button
                        type="button"
                        className="design-card-toggle has-copy-link"
                        aria-expanded={expanded}
                        onClick={() => setExpandedId(expanded ? null : primary.id)}
                      >
                        <DesignCardHeaderContent
                          primary={primary}
                          members={group.members}
                          showRepoBadge={showRepoBadge}
                          projectsById={projectsById}
                          anyUnresolvedWarning={anyUnresolvedWarning}
                          anySemanticOverlap={anySemanticOverlap}
                        />
                      </button>
                      <CopyLinkButton url={buildShareUrl(primary.projectId, "designs", primary.id)} />
                    </div>
                    {expanded && (
                      <DesignCardBody
                        primary={primary}
                        members={group.members}
                        showRepoBadge={showRepoBadge}
                        projectsById={projectsById}
                        openThreads={openThreads}
                        designsById={designsById}
                        onResolved={() => setRefreshKey((k) => k + 1)}
                        onOpenDesign={jumpToDesign}
                        onOpenTab={onOpenTab}
                        readOnly={readOnly}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          );
        }}
      />
    </div>
  );
}
