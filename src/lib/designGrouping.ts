import type { ActivityEvent, DesignStatement } from "../api/types.js";
import { formatActivityEvent } from "./activityFormat.js";

export interface DesignGroup {
  design: DesignStatement;
  events: ActivityEvent[];
  lastActivityAt: number;
}

export type ActivityEntry = { type: "group"; group: DesignGroup } | { type: "event"; event: ActivityEvent };

/**
 * Buckets activity events by the design each relates to, for the Activity
 * feed's "group by design" view (default view -- see ActivityView.tsx).
 * Deliberately reuses the exact two best-effort joins ActivityView already
 * computed per-row for its "View design" link, rather than inventing a
 * stricter, separate notion of "belongs to this design": grouping is just
 * applying that same resolution across the whole list.
 *
 *  - design_* and review_* kinds already carry a resolved `designId` from
 *    `formatActivityEvent` (relatedId/payload -- see activityFormat.ts).
 *  - finding_raised/alignment_* kinds resolve via `threadDesignById`,
 *    built by the caller from `AlignmentThread.designId`
 *    (`fetchAlignmentThreads`) -- these carry no designId of their own.
 *  - claim_recorded/call_edge_recorded carry no design reference at all
 *    (Claim/CallEdge and DesignStatement deliberately share no foreign
 *    key -- see twing-cli's own CLAUDE.md, "share a data model but never
 *    share logic") -- fall back to `designsBySession`, the same
 *    session -> most-recently-active-design join ActivityView already used
 *    for their per-row "View design" link before this change.
 *  - constraint_* kinds are never design-scoped -- always ungrouped.
 *
 * An event whose resolved designId isn't in `designsById` (e.g. it names a
 * design this project's design fetch didn't return) falls back to a plain
 * `{ type: "event" }` entry, same as one with no designId at all -- a
 * failed join here should degrade the same way it already does for the
 * per-row link, not throw or hide the row.
 *
 * `events` is assumed already sorted newest-first (as `/v1/activity`
 * returns it) -- entries are emitted in first-occurrence order, which for
 * a group is therefore always its own most recent event, so the result
 * needs no separate sort to stay in "most recent activity first" order.
 */
export function groupActivityByDesign(
  events: ActivityEvent[],
  designsById: Record<string, DesignStatement>,
  designsBySession: Record<string, DesignStatement>,
  threadDesignById: Record<string, string>,
): ActivityEntry[] {
  const groups = new Map<string, DesignGroup>();
  const entries: ActivityEntry[] = [];

  const sessionFallbackKinds = new Set(["claim_recorded", "call_edge_recorded"]);

  for (const event of events) {
    const formatted = formatActivityEvent(event);
    const designId =
      formatted.designId ??
      (formatted.threadId ? threadDesignById[formatted.threadId] : undefined) ??
      (sessionFallbackKinds.has(event.kind) && event.sessionId ? designsBySession[event.sessionId]?.id : undefined);
    const design = designId ? designsById[designId] : undefined;

    if (!design) {
      entries.push({ type: "event", event });
      continue;
    }

    let group = groups.get(design.id);
    if (!group) {
      group = { design, events: [], lastActivityAt: event.ts };
      groups.set(design.id, group);
      entries.push({ type: "group", group });
    }
    group.events.push(event);
    if (event.ts > group.lastActivityAt) group.lastActivityAt = event.ts;
  }

  return entries;
}
