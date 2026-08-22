import { useEffect, useState } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchDesigns } from "../api/designs.js";
import { fetchActivity } from "../api/activity.js";
import { fetchAlignmentThreads } from "../api/alignmentThreads.js";
import type { ActivityEvent, AlignmentThread, DesignStatement } from "../api/types.js";
import { useAuth } from "../auth/useAuth.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AsyncSection } from "../components/AsyncSection.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { DesignDetail, type SemanticOverlap } from "../components/DesignDetail.js";
import { relativeTime } from "../lib/time.js";
import { toneForDesignStatus } from "../lib/designStatus.js";

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

export function DesignsView({ projectId, focusDesignId, onOpenTab }: { projectId: string; focusDesignId?: string; onOpenTab?: (tab: "threads") => void }) {
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

  const state = useAsyncData(() => fetchDesigns(apiFetch, projectId, status === "all" ? undefined : status), [apiFetch, projectId, status, refreshKey]);
  const checksState = useAsyncData(
    () => fetchActivity(apiFetch, projectId, { kinds: ["design_checked"], limit: 200 }),
    [apiFetch, projectId, refreshKey],
  );
  // Bonus, list-wide context -- same "don't block the primary render on it"
  // stance as DesignDetail's own LatestCheckOutcome: an empty map just means
  // no card gets a conflict chip, not a loading/error state of its own.
  const latestChecks = checksState.status === "ready" ? latestCheckByDesign(checksState.data.items) : new Map<string, { verdict: string; severity?: string }>();
  const openThreadsState = useAsyncData(() => fetchAlignmentThreads(apiFetch, projectId, "open"), [apiFetch, projectId, refreshKey]);
  const openThreads = openThreadsState.status === "ready" ? openThreadsState.data : [];
  // Every status, not just the current filter -- a semantic overlap's
  // counterpart design may not itself match the active status/mine-only
  // filter, and jumpToDesign needs its id to resolve to something real
  // regardless. Also doubles as the origin-detection lookup
  // findSemanticOverlapThread needs (see its own doc comment).
  const allDesignsState = useAsyncData(() => fetchDesigns(apiFetch, projectId), [apiFetch, projectId, refreshKey]);
  const designsById: Record<string, DesignStatement> = allDesignsState.status === "ready" ? Object.fromEntries(allDesignsState.data.map((d) => [d.id, d])) : {};

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
        render={(items) => (
          <ul className="card-list">
            {items
              .filter((d) => !mineOnly || d.developerId === auth?.developerId)
              .map((d) => {
                const expanded = expandedId === d.id;
                // Only surface this for designs still "open" -- "flagged"
                // already carries an amber badge of its own, and doubling
                // up on it here would just be noise.
                const latestCheck = latestChecks.get(d.id);
                const hasUnresolvedWarning = d.status === "open" && latestCheck?.severity === "warning" && latestCheck.verdict !== "clean";
                const semanticThread = findSemanticOverlapThread(openThreads, designsById, d.id);
                const semanticOverlap: SemanticOverlap | undefined = semanticThread
                  ? { thread: semanticThread, counterpart: designsById[semanticThread.designId === d.id ? semanticThread.symbolId : semanticThread.designId!] }
                  : undefined;
                return (
                  <li key={d.id} className={`design-card${expanded ? " expanded" : ""}`}>
                    <button
                      type="button"
                      className="design-card-toggle"
                      aria-expanded={expanded}
                      onClick={() => setExpandedId(expanded ? null : d.id)}
                    >
                      <div className="card-top-row">
                        <span className="card-summary">{d.summary}</span>
                        <div className="card-badges">
                          {hasUnresolvedWarning && <StatusBadge label="overlap warning" tone="warning" />}
                          {semanticOverlap && <StatusBadge label="semantic overlap" tone="warning" />}
                          <StatusBadge label={d.status} tone={toneForDesignStatus(d.status)} />
                        </div>
                      </div>
                      <div className="card-meta">
                        <span>{d.developerId}</span>
                        <span>{relativeTime(d.createdAt)}</span>
                        {d.creates.length + d.touches.length > 0 && (
                          <span>
                            {d.creates.length} created, {d.touches.length} touched
                          </span>
                        )}
                      </div>
                    </button>
                    {expanded && (
                      <DesignDetail
                        design={d}
                        onResolved={() => setRefreshKey((k) => k + 1)}
                        semanticOverlap={semanticOverlap}
                        onOpenDesign={jumpToDesign}
                        onOpenTab={onOpenTab}
                      />
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      />
    </div>
  );
}
