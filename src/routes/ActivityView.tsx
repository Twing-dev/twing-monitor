import { useCallback, useEffect, useState } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchActivity } from "../api/activity.js";
import { fetchDesigns } from "../api/designs.js";
import type { ActivityEvent, DesignStatement } from "../api/types.js";
import { relativeTime } from "../lib/time.js";
import { formatActivityEvent, type ActivityDetailField } from "../lib/activityFormat.js";

const KIND_GROUPS = [
  { value: "", label: "All kinds" },
  {
    value: "design_registered,design_checked,design_flagged,design_amended,design_resolved,design_closed,design_expired,design_dormant,design_resumed,design_stale_sibling_suggested,design_semantic_conflict",
    label: "Designs",
  },
  { value: "review_created,review_decided", label: "Reviews" },
  { value: "claim_recorded,call_edge_recorded,finding_raised", label: "Claims" },
  { value: "alignment_thread_opened,alignment_message_posted,alignment_thread_closed", label: "Alignment threads" },
  { value: "constraint_ratified,constraint_updated", label: "Constraints" },
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

/** Unlike the other list views, this one accumulates pages rather than
 * replacing them wholesale on every render -- `useAsyncData` resets to
 * "loading" on any dependency change, which is right for a filter swap
 * (start over) but wrong for "load older" (append). So this view manages
 * its own load state instead of going through that hook. */
export function ActivityView({ projectId, onOpenDesign, onOpenTab }: ActivityViewProps) {
  const apiFetch = useApiFetch();
  const [kindFilter, setKindFilter] = useState("");
  const [developerFilter, setDeveloperFilter] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<ActivityEvent[]>([]);
  const [nextBefore, setNextBefore] = useState<number | undefined>(undefined);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  // Best-effort session -> design lookup (2026-08-19): claims (§4/§11) and
  // designs (§17) deliberately share no foreign key -- see this repo's own
  // CLAUDE.md, "share a data model but never share logic" -- so a
  // claim_recorded/call_edge_recorded row has no designId of its own. This
  // is a client-side join on sessionId only, purely for display: "here's
  // the design whose session produced this claim," not a guarantee that
  // claim is actually *in scope* of that design. Fetched once per project
  // (every status, not just "open") rather than per-row, since the whole
  // point is avoiding an activity-feed-sized fan-out of design lookups.
  const [designsBySession, setDesignsBySession] = useState<Record<string, DesignStatement>>({});
  useEffect(() => {
    let cancelled = false;
    fetchDesigns(apiFetch, projectId)
      .then((designs) => {
        if (cancelled) return;
        const bySession: Record<string, DesignStatement> = {};
        for (const d of designs) {
          const existing = bySession[d.sessionId];
          if (!existing || d.lastActivityAt > existing.lastActivityAt) bySession[d.sessionId] = d;
        }
        setDesignsBySession(bySession);
      })
      .catch(() => {
        // Best-effort only -- a failed lookup just means rows fall back to
        // showing no design reference, not a broken activity feed.
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch, projectId]);

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
            {items.map((event) => {
              const formatted = formatActivityEvent(event);

              // The event's own payload already named a design (and its
              // summary) for every design_* kind -- only fall back to the
              // session-based best-effort match (claim_recorded/
              // call_edge_recorded, which never carry a designId of their
              // own) when it didn't.
              const sessionDesign = !formatted.designId && event.sessionId ? designsBySession[event.sessionId] : undefined;
              const designId = formatted.designId ?? sessionDesign?.id;
              const designSummary = formatted.designSummary ?? sessionDesign?.summary;

              // "Design registered" already shows the summary under its own
              // "Summary" field -- don't repeat it as a second "Design" row.
              const showDesignField = designSummary && formatted.label !== "Design registered" && formatted.label !== "Design re-registered";
              const details: ActivityDetailField[] = showDesignField ? [{ label: "Design", value: designSummary }, ...formatted.details] : formatted.details;

              return (
                <li key={event.id} className="activity-row">
                  <div className="activity-row-top">
                    <span className="activity-kind">{formatted.label}</span>
                    <span className="activity-meta">
                      {event.developerId && (
                        <button type="button" className="link-chip" onClick={() => setDeveloperFilter(event.developerId)}>
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
            })}
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
