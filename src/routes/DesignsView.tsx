import { useEffect, useState } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchDesigns } from "../api/designs.js";
import { fetchActivity } from "../api/activity.js";
import { fetchAlignmentThreads } from "../api/alignmentThreads.js";
import type { ActivityEvent, AlignmentThread, DesignStatement, ProjectSummary } from "../api/types.js";
import { useAuth } from "../auth/useAuth.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AsyncSection } from "../components/AsyncSection.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { RepoBadge } from "../components/RepoBadge.js";
import { DesignDetail, type SemanticOverlap } from "../components/DesignDetail.js";
import { relativeTime } from "../lib/time.js";
import { toneForDesignStatus } from "../lib/designStatus.js";
import { dedupeDesignsByGroup } from "../lib/aggregate.js";

const STATUSES = ["open", "flagged", "dormant", "superseded", "closed", "expired", "all"] as const;
type StatusFilter = (typeof STATUSES)[number];

/** `status` alone doesn't tell a list viewer everything worth knowing at a
 * glance: a `"warning"`-severity overlap (2026-08-19 severity split, tier
 * 1's exactOverlap) never demotes a design out of `"open"` -- by design,
 * it's advisory-only -- so without this, an open design with a live,
 * unresolved warning looks identical to a design with nothing wrong at all
 * until you expand the card. One project-wide `design_checked` fetch
 * (capped at the server's own 200-event page limit -- fine for a dashboard
 * list, not meant to paginate infinitely) covers every visible design in a
 * single request; each design's own latest event wins since the API
 * already returns newest-first. */
function latestCheckByDesign(events: ActivityEvent[]): Map<string, { verdict: string; severity?: string }> {
  const byDesign = new Map<string, { verdict: string; severity?: string }>();
  for (const event of events) {
    if (!event.relatedId || byDesign.has(event.relatedId)) continue; // newest-first: first hit per id is the latest
    const payload = event.payload as { verdict?: string; severity?: string } | undefined;
    if (!payload?.verdict) continue;
    byDesign.set(event.relatedId, { verdict: payload.verdict, severity: payload.severity });
  }
  return byDesign;
}

/** The async Bedrock semantic comparator (`design-semantic-check.ts`) is a
 * separate pipeline from `runDesignChecks` entirely -- it never touches
 * `status`/`design_checked`, only opens an alignment thread (§7), so
 * without this a design with a live, unresolved semantic duplication looks
 * identical to a clean one anywhere in the Designs tab, only visible by
 * separately checking Alignment threads.
 *
 * A thread can also originate from the claims path (`design_divergence`,
 * `POST /v1/claims`) instead, where `symbolId` is a real code symbol, not a
 * design -- this only ever matches the semantic-conflict shape, where
 * `symbolId` is repurposed to hold the *initiating* design's own id (see
 * `runSemanticComparatorPass`, packages/server/src/app.ts, and
 * AlignmentThreadsView's `ThreadDetail` doc comment for the full
 * reasoning). Checking `designsById[t.symbolId]` is what tells the two
 * origins apart -- a design id is a `crypto.randomUUID()`, a real symbolId
 * always looks like `path::Name` (`symbol-id.ts`), so they never collide. */
function findSemanticOverlapThread(threads: AlignmentThread[], designsById: Record<string, DesignStatement>, designId: string): AlignmentThread | undefined {
  return threads.find((t) => (t.designId === designId || t.symbolId === designId) && Boolean(designsById[t.symbolId]));
}

/** First occurrence per key, order preserved -- used to collapse a grouped
 * card's badge row to one badge per distinct repo/status rather than one
 * per member (see the `card-badges` doc comment above its use). */
function uniqueBy<T, K>(items: T[], key: (item: T) => K): T[] {
  const seen = new Set<K>();
  const result: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    result.push(item);
  }
  return result;
}

export function DesignsView({
  projectIds,
  projectsById,
  focusDesignId,
  onOpenTab,
}: {
  projectIds: string[];
  projectsById: Record<string, ProjectSummary>;
  focusDesignId?: string;
  onOpenTab?: (tab: "threads") => void;
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

  // A link from ActivityView ("View design ->") or a card's own semantic-
  // overlap note (jumpToDesign, below) names a specific design regardless
  // of its current status or who owns it -- force both filters open so
  // it's guaranteed visible, and expand it directly rather than making the
  // viewer hunt for the right card.
  useEffect(() => {
    if (!focusDesignId) return;
    setStatus("all");
    setMineOnly(false);
    setExpandedId(focusDesignId);
  }, [focusDesignId]);

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
  const latestChecks = checksState.status === "ready" ? latestCheckByDesign(checksState.data) : new Map<string, { verdict: string; severity?: string }>();
  const openThreadsState = useAsyncData(
    () => Promise.all(projectIds.map((pid) => fetchAlignmentThreads(apiFetch, pid, "open"))).then((lists) => lists.flat()),
    [apiFetch, projectIds.join(","), refreshKey],
  );
  const openThreads = openThreadsState.status === "ready" ? openThreadsState.data : [];
  // Every status, not just the current filter -- a semantic overlap's
  // counterpart design may not itself match the active status/mine-only
  // filter, and jumpToDesign needs its id to resolve to something real
  // regardless. Also doubles as the origin-detection lookup
  // findSemanticOverlapThread needs (see its own doc comment).
  const allDesignsState = useAsyncData(
    () => Promise.all(projectIds.map((pid) => fetchDesigns(apiFetch, pid))).then((lists) => lists.flat()),
    [apiFetch, projectIds.join(","), refreshKey],
  );
  const designsById: Record<string, DesignStatement> = allDesignsState.status === "ready" ? Object.fromEntries(allDesignsState.data.map((d) => [d.id, d])) : {};

  const showRepoBadge = projectIds.length > 1;

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
                // Only surface this for a member still "open" -- "flagged"
                // already carries an amber badge of its own, and doubling
                // up on it here would just be noise. A grouped card can mix
                // statuses across its members, so this looks at every
                // member, not just the primary one.
                const anyUnresolvedWarning = group.members.some((m) => {
                  const check = latestChecks.get(m.id);
                  return m.status === "open" && check?.severity === "warning" && check.verdict !== "clean";
                });
                const anySemanticOverlap = group.members.some((m) => findSemanticOverlapThread(openThreads, designsById, m.id));
                return (
                  <li key={group.key} className={`design-card${expanded ? " expanded" : ""}`}>
                    <button
                      type="button"
                      className="design-card-toggle"
                      aria-expanded={expanded}
                      onClick={() => setExpandedId(expanded ? null : primary.id)}
                    >
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
                            uniqueBy(group.members, (m) => m.projectId).map((m) => <RepoBadge key={m.projectId} project={projectsById[m.projectId] ?? { projectId: m.projectId }} />)}
                          {uniqueBy(group.members, (m) => m.status).map((m) => (
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
                    </button>
                    {expanded &&
                      group.members.map((member) => {
                        const semanticThread = findSemanticOverlapThread(openThreads, designsById, member.id);
                        const semanticOverlap: SemanticOverlap | undefined = semanticThread
                          ? { thread: semanticThread, counterpart: designsById[semanticThread.designId === member.id ? semanticThread.symbolId : semanticThread.designId!] }
                          : undefined;
                        return (
                          <div key={member.id}>
                            {showRepoBadge && (
                              <div className="repo-badge-row">
                                <RepoBadge project={projectsById[member.projectId] ?? { projectId: member.projectId }} />
                              </div>
                            )}
                            <DesignDetail
                              design={member}
                              onResolved={() => setRefreshKey((k) => k + 1)}
                              semanticOverlap={semanticOverlap}
                              onOpenDesign={jumpToDesign}
                              onOpenTab={onOpenTab}
                            />
                          </div>
                        );
                      })}
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
