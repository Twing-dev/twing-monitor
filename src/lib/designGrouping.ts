import type { ActivityEvent, DesignStatement } from "../api/types.js";
import { formatActivityEvent } from "./activityFormat.js";
import { dedupeDesignsByGroup } from "./aggregate.js";

export interface DesignGroup {
  /** `design.groupId ?? design.id` for whichever design an event resolved
   * to -- the exact dedup key `aggregate.ts`'s `dedupeDesignsByGroup` uses
   * for the Designs tab's own cards, reused here so a `--group`-linked
   * chain of designs (a continuation registered as its own design rather
   * than amended onto the original -- see twing-cli's own convention for
   * when to do which) collapses to one row in the Activity feed too,
   * instead of one row per member the way this used to key by raw
   * `design.id` alone. */
  key: string;
  /** Every design belonging to the group, newest-active-first (mirrors
   * `aggregate.ts`'s `DesignGroup.members`) -- the *whole* group as
   * resolved from `designsById`, not just whichever members this
   * particular page of events happened to reference, so the header stays
   * stable across pagination/filtering the same way the Designs tab's
   * cards do. `members[0]` is what the header/toggle treats as the
   * group's representative, same convention DesignsView uses. */
  members: DesignStatement[];
  events: ActivityEvent[];
  lastActivityAt: number;
  /** Every distinct `developerId` among the group's events (an
   * alignment-thread-driven event can carry a different developer than
   * the design's own owner -- see `finding_raised`'s `otherDeveloperId`),
   * most-recently-active first, since `events` arrives newest-first. Lets
   * the collapsed header show whose agent(s) produced this design's
   * activity without expanding it. */
  developerIds: string[];
}

export type ActivityEntry = { type: "group"; group: DesignGroup } | { type: "event"; event: ActivityEvent };

/**
 * Buckets activity events by the design *group* each relates to, for the
 * Activity feed's "group by design" view (default view -- see
 * ActivityView.tsx). Deliberately reuses the exact two best-effort joins
 * ActivityView already computed per-row for its "View design" link, rather
 * than inventing a stricter, separate notion of "belongs to this design":
 * grouping is just applying that same resolution across the whole list,
 * then collapsing by `groupId` the same way the Designs tab already does
 * (`aggregate.ts`'s `dedupeDesignsByGroup`) so the two tabs' notion of "one
 * logical unit of work" agree -- before this, a `--group`-linked chain of
 * (say) 3 designs read as 1 card on the Designs tab but 3 separate rows
 * here, which is exactly the discrepancy this was written to close.
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
 * `designsById`'s own order, by contrast, is *not* assumed sorted (a
 * caller merging several projects' design fetches interleaves already-
 * sorted lists, which isn't itself sorted -- the same caveat
 * `dedupeDesignsByGroup`'s own doc comment flags) -- resorted locally by
 * `lastActivityAt` before grouping so `members[0]` is reliably the group's
 * most-recently-active design regardless of what order the caller built
 * `designsById` in.
 */
export function groupActivityByDesign(
  events: ActivityEvent[],
  designsById: Record<string, DesignStatement>,
  designsBySession: Record<string, DesignStatement>,
  threadDesignById: Record<string, string>,
): ActivityEntry[] {
  const sortedDesigns = Object.values(designsById).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  const designGroups = dedupeDesignsByGroup(sortedDesigns);
  const groupKeyByDesignId = new Map<string, string>();
  const membersByGroupKey = new Map<string, DesignStatement[]>();
  for (const g of designGroups) {
    membersByGroupKey.set(g.key, g.members);
    for (const m of g.members) groupKeyByDesignId.set(m.id, g.key);
  }

  const groups = new Map<string, DesignGroup>();
  const developerIds = new Map<string, Set<string>>();
  const entries: ActivityEntry[] = [];

  const sessionFallbackKinds = new Set(["claim_recorded", "call_edge_recorded"]);

  for (const event of events) {
    const formatted = formatActivityEvent(event);
    const designId =
      formatted.designId ??
      (formatted.threadId ? threadDesignById[formatted.threadId] : undefined) ??
      (sessionFallbackKinds.has(event.kind) && event.sessionId ? designsBySession[event.sessionId]?.id : undefined);
    const groupKey = designId ? groupKeyByDesignId.get(designId) : undefined;

    if (!groupKey) {
      entries.push({ type: "event", event });
      continue;
    }

    let group = groups.get(groupKey);
    if (!group) {
      group = { key: groupKey, members: membersByGroupKey.get(groupKey) ?? [], events: [], lastActivityAt: event.ts, developerIds: [] };
      groups.set(groupKey, group);
      developerIds.set(groupKey, new Set());
      entries.push({ type: "group", group });
    }
    group.events.push(event);
    if (event.ts > group.lastActivityAt) group.lastActivityAt = event.ts;
    if (event.developerId) developerIds.get(groupKey)!.add(event.developerId);
  }

  for (const group of groups.values()) {
    group.developerIds = Array.from(developerIds.get(group.key) ?? []);
  }

  return entries;
}
