import { useCallback, useEffect, useMemo, useState } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchActivity } from "../api/activity.js";
import { fetchDesigns } from "../api/designs.js";
import { fetchAlignmentThreads } from "../api/alignmentThreads.js";
import type { ActivityEvent, DesignStatement } from "../api/types.js";
import { relativeTime } from "../lib/time.js";
import { formatActivityEvent, type ActivityDetailField } from "../lib/activityFormat.js";
import { groupActivityByDesign, type ActivityEntry, type DesignGroup } from "../lib/designGrouping.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { toneForDesignStatus } from "../lib/designStatus.js";

const KIND_GROUPS = [
  {
    value:
      "design_registered,design_flagged,design_resolved,design_closed,design_semantic_conflict,review_created,review_decided,constraint_ratified,constraint_updated,constraint_removed,alignment_thread_opened,alignment_thread_closed",
    label: "High value",
  },
  { value: "", label: "All kinds" },
  {
    value: "design_registered,design_checked,design_flagged,design_amended,design_resolved,design_closed,design_expired,design_dormant,design_resumed,design_stale_sibling_suggested,design_semantic_conflict",
    label: "Designs",
  },
  { value: "review_created,review_decided", label: "Reviews" },
  { value: "claim_recorded,call_edge_recorded,finding_raised", label: "Claims" },
  { value: "alignment_thread_opened,alignment_message_posted,alignment_thread_closed", label: "Alignment threads" },
  { value: "constraint_ratified,constraint_updated,constraint_removed", label: "Constraints" },
];

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

export interface ActivityViewProps {
  projectId: string;
  /** Jumps to the Designs tab with this design expanded -- RepoDetailLayout
   * owns the actual tab switch, this view only ever knows "which design." */
  onOpenDesign?: (designId: string) => void;
  /** Simple tab switches for kinds this view doesn't have a per-item
   * detail target for yet (a specific alignment thread/constraint row). */
  onOpenTab?: (tab: "threads" | "constraints") => void;
}

/** One event row -- shared between the flat list and an expanded design
 * group's event list, so there's exactly one place that resolves a row's
 * design link/field and renders its details. */
function ActivityRow({
  event,
  designsBySession,
  onOpenDesign,
  onOpenTab,
  onFilterDeveloper,
}: {
  event: ActivityEvent;
  designsBySession: Record<string, DesignStatement>;
  onOpenDesign?: (designId: string) => void;
  onOpenTab?: (tab: "threads" | "constraints") => void;
  onFilterDeveloper: (developerId: string) => void;
}) {
  const formatted = formatActivityEvent(event);

  // The event's own payload already named a design (and its summary) for
  // every design_* kind -- only fall back to the session-based best-effort
  // match (claim_recorded/call_edge_recorded, which never carry a designId
  // of their own) when it didn't.
  const sessionDesign = !formatted.designId && event.sessionId ? designsBySession[event.sessionId] : undefined;
  const designId = formatted.designId ?? sessionDesign?.id;
  const designSummary = formatted.designSummary ?? sessionDesign?.summary;

  // "Design registered" already shows the summary under its own "Summary"
  // field -- don't repeat it as a second "Design" row.
  const showDesignField = designSummary && formatted.label !== "Design registered" && formatted.label !== "Design re-registered";
  const details: ActivityDetailField[] = showDesignField ? [{ label: "Design", value: designSummary }, ...formatted.details] : formatted.details;

  return (
    <li className="activity-row">
      <div className="activity-row-top">
        <span className="activity-kind">{formatted.label}</span>
        <span className="activity-meta">
          {event.developerId && (
            <button type="button" className="link-chip" onClick={() => onFilterDeveloper(event.developerId!)}>
              {event.developerId}
            </button>
          )}
          <span>{relativeTime(event.ts)}</span>
        </span>
      </div>
      {details.length > 0 && (
        <dl className="activity-details">
          {details.map((d) => (
            <div key={d.label} className="activity-detail-field">
              <dt>{d.label}</dt>
              <dd>{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {(designId || formatted.constraintId || formatted.threadId) && (
        <div className="activity-links">
          {designId && onOpenDesign && (
            <button type="button" className="link-chip link-chip-accent" onClick={() => onOpenDesign(designId)}>
              {designSummary ? `→ ${designSummary}` : "View design →"}
            </button>
          )}
          {formatted.threadId && onOpenTab && (
            <button type="button" className="link-chip link-chip-accent" onClick={() => onOpenTab("threads")}>
              View alignment thread →
            </button>
          )}
          {formatted.constraintId && onOpenTab && (
            <button type="button" className="link-chip link-chip-accent" onClick={() => onOpenTab("constraints")}>
              View constraint →
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** A collapsed-by-default design group -- "the summary shows the timestamp
 * of the last activity, full activity is shown when expanded." Reuses
 * `ActivityRow` for the expanded event list, so a grouped and an ungrouped
 * row look identical once you're looking at the event itself. */
function DesignGroupRow({
  group,
  expanded,
  onToggle,
  designsBySession,
  onOpenDesign,
  onOpenTab,
  onFilterDeveloper,
}: {
  group: DesignGroup;
  expanded: boolean;
  onToggle: () => void;
  designsBySession: Record<string, DesignStatement>;
  onOpenDesign?: (designId: string) => void;
  onOpenTab?: (tab: "threads" | "constraints") => void;
  onFilterDeveloper: (developerId: string) => void;
}) {
  return (
    <li className="activity-group">
      <button type="button" className="activity-group-header" onClick={onToggle} aria-expanded={expanded}>
        <span className="activity-group-caret">{expanded ? "▾" : "▸"}</span>
        <span className="activity-group-summary">{group.design.summary || "(no summary)"}</span>
        <StatusBadge label={group.design.status} tone={toneForDesignStatus(group.design.status)} />
        <span className="activity-group-count">{group.events.length}</span>
        <span className="activity-meta">{relativeTime(group.lastActivityAt)}</span>
      </button>
      {expanded && (
        <ul className="activity-list activity-group-events">
          {group.events.map((event) => (
            <ActivityRow key={event.id} event={event} designsBySession={designsBySession} onOpenDesign={onOpenDesign} onOpenTab={onOpenTab} onFilterDeveloper={onFilterDeveloper} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Unlike the other list views, this one accumulates pages rather than
 * replacing them wholesale on every render -- `useAsyncData` resets to
 * "loading" on any dependency change, which is right for a filter swap
 * (start over) but wrong for "load older" (append). So this view manages
 * its own load state instead of going through that hook. */
export function ActivityView({ projectId, onOpenDesign, onOpenTab }: ActivityViewProps) {
  const apiFetch = useApiFetch();
  const [kindFilter, setKindFilter] = useState(KIND_GROUPS[0].value);
  const [developerFilter, setDeveloperFilter] = useState<string | undefined>(undefined);
  const [groupByDesign, setGroupByDesign] = useState(true);
  const [expandedDesignIds, setExpandedDesignIds] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<ActivityEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<number | undefined>(undefined);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  // Backs both the flat list's per-row "View design" link (session-based
  // best-effort join, 2026-08-19) and the grouped view's bucketing
  // (designGrouping.ts) -- fetched once per project (every status, not
  // just "open"), same as before this change.
  const [designs, setDesigns] = useState<DesignStatement[]>([]);
  // designId -> the AlignmentThread's own designId (2026-08-22): needed
  // only for grouping finding_raised/alignment_* rows, which carry a
  // threadId but no designId of their own -- see designGrouping.ts.
  const [threadDesignById, setThreadDesignById] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetchDesigns(apiFetch, projectId)
      .then((fetched) => {
        if (!cancelled) setDesigns(fetched);
      })
      .catch(() => {
        // Best-effort only -- a failed lookup just means rows fall back to
        // showing no design reference, not a broken activity feed.
      });
    fetchAlignmentThreads(apiFetch, projectId)
      .then((threads) => {
        if (cancelled) return;
        const byId: Record<string, string> = {};
        for (const t of threads) if (t.designId) byId[t.id] = t.designId;
        setThreadDesignById(byId);
      })
      .catch(() => {
        // Same best-effort contract as the designs fetch above.
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch, projectId]);

  const designsById = useMemo(() => Object.fromEntries(designs.map((d) => [d.id, d])), [designs]);

  const designsBySession = useMemo(() => {
    const bySession: Record<string, DesignStatement> = {};
    for (const d of designs) {
      const existing = bySession[d.sessionId];
      if (!existing || d.lastActivityAt > existing.lastActivityAt) bySession[d.sessionId] = d;
    }
    return bySession;
  }, [designs]);

  const entries: ActivityEntry[] = useMemo(
    () => (groupByDesign ? groupActivityByDesign(items, designsById, designsBySession, threadDesignById) : items.map((event) => ({ type: "event" as const, event }))),
    [groupByDesign, items, designsById, designsBySession, threadDesignById],
  );

  const loadFirstPage = useCallback(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchActivity(apiFetch, projectId, { kinds: kindFilter ? kindFilter.split(",") : undefined, developerId: developerFilter })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextBefore(page.nextBefore);
        setState({ status: "ready" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch, projectId, kindFilter, developerFilter]);

  useEffect(() => loadFirstPage(), [loadFirstPage]);

  async function loadMore() {
    if (nextBefore === undefined) return;
    try {
      const page = await fetchActivity(apiFetch, projectId, {
        before: nextBefore,
        kinds: kindFilter ? kindFilter.split(",") : undefined,
        developerId: developerFilter,
      });
      setItems((prev) => [...prev, ...page.items]);
      setNextBefore(page.nextBefore);
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  function toggleGroup(designId: string) {
    setExpandedDesignIds((prev) => {
      const next = new Set(prev);
      if (next.has(designId)) next.delete(designId);
      else next.add(designId);
      return next;
    });
  }

  return (
    <div className="list-view">
      <div className="filter-bar">
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} aria-label="Filter by kind">
          {KIND_GROUPS.map((opt) => (
            <option key={opt.label} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <label className="checkbox-filter">
          <input type="checkbox" checked={groupByDesign} onChange={(e) => setGroupByDesign(e.target.checked)} />
          Group by design
        </label>
        {developerFilter && (
          <span className="active-filter-chip">
            {developerFilter}
            <button type="button" aria-label="Clear developer filter" onClick={() => setDeveloperFilter(undefined)}>
              ×
            </button>
          </span>
        )}
      </div>

      {state.status === "loading" && <p className="empty-state">Loading…</p>}
      {state.status === "error" && (
        <p className="empty-state error" role="alert">
          Couldn't load: {state.message}
        </p>
      )}
      {state.status === "ready" && items.length === 0 && <p className="empty-state">No activity yet.</p>}
      {state.status === "ready" && items.length > 0 && (
        <>
          <ul className="activity-list">
            {entries.map((entry) =>
              entry.type === "group" ? (
                <DesignGroupRow
                  key={`design-${entry.group.design.id}`}
                  group={entry.group}
                  expanded={expandedDesignIds.has(entry.group.design.id)}
                  onToggle={() => toggleGroup(entry.group.design.id)}
                  designsBySession={designsBySession}
                  onOpenDesign={onOpenDesign}
                  onOpenTab={onOpenTab}
                  onFilterDeveloper={setDeveloperFilter}
                />
              ) : (
                <ActivityRow key={entry.event.id} event={entry.event} designsBySession={designsBySession} onOpenDesign={onOpenDesign} onOpenTab={onOpenTab} onFilterDeveloper={setDeveloperFilter} />
              ),
            )}
          </ul>
          {nextBefore !== undefined && (
            <button type="button" className="load-more-button" onClick={loadMore}>
              Load older
            </button>
          )}
        </>
      )}
    </div>
  );
}
