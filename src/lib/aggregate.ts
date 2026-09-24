import type { AlignmentThread, DesignStatement, PendingReview, ProjectMember } from "../api/types.js";
import { pathOfTarget } from "./designConformance.js";

/**
 * Fans a per-project list-fetcher out across every selected repo and
 * flattens the results -- what every tab view's `useAsyncData` load
 * callback does once it's given `projectIds: string[]` instead of a single
 * `projectId`. Every list endpoint (`GET /v1/designs`, `/v1/reviews`, ...)
 * is already scoped by a `projectId` query param and every returned item
 * already carries its own `projectId`, so this needs no server change --
 * it's just N parallel requests to endpoints the caller already has
 * permission to hit (`GET /v1/projects` already filters to projects the
 * developer is a member of).
 *
 * Not used for `fetchActivity` -- its paginated `{items, nextBefore}`
 * shape doesn't fit "returns a flat array," and merging its per-project
 * cursors needs its own state in `ActivityView` (see that file).
 */
export async function fetchAllProjects<T>(projectIds: string[], fetchOne: (projectId: string) => Promise<T[]>): Promise<T[]> {
  const results = await Promise.all(projectIds.map(fetchOne));
  return results.flat();
}

/** One card's worth of `DesignStatement`s that all represent the same
 * logical unit of work -- see `@twing/core`'s `DesignStatement.groupId`
 * doc comment (packages/core/src/types.ts) for the full mechanics. Every
 * design has a non-null `groupId` server-side (self-assigned to its own
 * `id` when a caller doesn't link it to anything), so `members` always has
 * at least one entry and is never empty. */
export interface DesignGroup {
  /** `d.groupId ?? d.id` -- the dedup key. Falls back to `id` only for a
   * design registered before the `groupId` field existed (a pre-migration
   * row, `groupId` genuinely absent rather than self-assigned). */
  key: string;
  /** Newest-active-first, same order as the fetched list itself. */
  members: DesignStatement[];
  /** The max `lastActivityAt` across `members` -- what the group list
   * itself is sorted by, so a group with any recently-active member sorts
   * as recent even if its other members are old. */
  lastActivityAt: number;
}

/**
 * Collapses a merged, multi-project design list into one card per logical
 * unit of work. Applied unconditionally, not just when viewing more than
 * one repo -- two designs sharing a `groupId` *within* the same project
 * (registered by hand with the same `--group`, an edge case but a real
 * one) collapse the same way, since that's correct regardless of how many
 * repos happen to be selected right now.
 *
 * `designs` is assumed already sorted newest-active-first (as
 * `GET /v1/designs` returns it per project) -- a caller merging several
 * projects' results must re-sort before calling this, since interleaving
 * several already-sorted lists isn't itself sorted.
 *
 * The same design arriving twice collapses to one member, first occurrence
 * winning. A group listing one design twice is never meaningful, and every
 * caller merges lists that can repeat one: WorkView appends each `before`
 * page onto the last (an overlapping cursor re-delivers a row), and both
 * views merge a directly-fetched focus design into an already-loaded page.
 * Downstream this is what stops a duplicate rendering as a second,
 * identical member panel -- one that `MemberPanel`'s own label cannot tell
 * apart from the first, because every field in it would match -- and what
 * stops React seeing two children under one `key`.
 */
export function dedupeDesignsByGroup(designs: DesignStatement[]): DesignGroup[] {
  const groups = new Map<string, DesignGroup>();
  const seenIds = new Set<string>();

  for (const design of designs) {
    if (seenIds.has(design.id)) continue;
    seenIds.add(design.id);
    const key = design.groupId ?? design.id;
    let group = groups.get(key);
    if (!group) {
      group = { key, members: [], lastActivityAt: design.lastActivityAt };
      groups.set(key, group);
    }
    group.members.push(design);
    if (design.lastActivityAt > group.lastActivityAt) group.lastActivityAt = design.lastActivityAt;
  }

  return Array.from(groups.values()).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/** One row's worth of `ProjectMember`s for the same developer, across
 * however many of the selected repos they belong to. A developer's role
 * is per-project (`admin` in one repo, `member` in another is normal), so
 * `memberships` keeps every `(projectId, role)` pair rather than
 * collapsing to a single role -- `MembersView` renders one repo/role chip
 * per membership on the developer's one row. */
export interface DeveloperGroup {
  developerId: string;
  memberships: ProjectMember[];
}

/**
 * Collapses a merged, multi-project member list to one row per developer
 * -- fixes an early version of the aggregated Members tab that rendered
 * one row per `(developer, project)` pair, which read as duplicate rows
 * for the common case of the same person being on several selected repos.
 * Sorted by `developerId`; each developer's own `memberships` sorted by
 * repo label via the `projectsById` lookup the caller already has.
 */
export function dedupeMembersByDeveloper(members: ProjectMember[]): DeveloperGroup[] {
  const groups = new Map<string, DeveloperGroup>();

  for (const member of members) {
    let group = groups.get(member.developerId);
    if (!group) {
      group = { developerId: member.developerId, memberships: [] };
      groups.set(member.developerId, group);
    }
    group.memberships.push(member);
  }

  return Array.from(groups.values()).sort((a, b) => a.developerId.localeCompare(b.developerId));
}

/** First occurrence per key, order preserved -- shared by any grouped-card
 * header that needs one badge per distinct repo/status among a group's
 * members rather than one per member (DesignsView's design cards,
 * ActivityView's design-grouped activity rows). */
export function uniqueBy<T, K>(items: T[], key: (item: T) => K): T[] {
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

/** Which stage a merged Conflicts-tab item is at. Deliberately computed only
 * from fields already on the list-view record (`PendingReview`/
 * `AlignmentThread`) -- not from a thread's full message history, which
 * would need a second fetch per thread. `open_discussion` therefore means
 * "this thread is still open," not "it's specifically your turn to reply"
 * (that would need to know the last message's author, which the list
 * endpoint doesn't carry). */
export type ConflictStage = "open_discussion" | "awaiting_approval" | "resolved";

/** One row in the merged Conflicts tab -- a `PendingReview` (admin
 * approve/reject queue) or an `AlignmentThread` (party reply/close
 * conversation) are different entities with different actions, so this
 * stays a discriminated union rather than flattening them into one shape;
 * `ConflictsView` renders each arm with the real `ReviewCardBody`/
 * `ThreadDetail` components instead of a shared generic card. */
export type ConflictItem =
  | { kind: "review"; stage: ConflictStage; ts: number; review: PendingReview }
  | { kind: "thread"; stage: ConflictStage; ts: number; thread: AlignmentThread };

/** Merges a project's pending reviews and alignment threads into one
 * newest-first list -- the data behind ConflictsView (Reviews +
 * Alignment threads, merged: both are "a conflict between two people's
 * work, at some stage of getting resolved," which is the whole point of
 * combining them under one tab instead of two unrelated-sounding ones). */
export function buildConflictItems(reviews: PendingReview[], threads: AlignmentThread[]): ConflictItem[] {
  const reviewItems: ConflictItem[] = reviews.map((review) => ({
    kind: "review",
    stage: review.decision ? "resolved" : "awaiting_approval",
    ts: review.createdAt,
    review,
  }));
  const threadItems: ConflictItem[] = threads.map((thread) => ({
    kind: "thread",
    stage: thread.status === "open" ? "open_discussion" : "resolved",
    ts: thread.lastActivityAt ?? thread.openedAt,
    thread,
  }));
  return [...reviewItems, ...threadItems].sort((a, b) => b.ts - a.ts);
}

/** The Overview page's four KPI tiles -- every count here comes from a list
 * a caller already fetches for another tab (no new endpoint), just reduced
 * to a number. `teamMembers` dedupes by developer the same way
 * `dedupeMembersByDeveloper` does, since a developer can be a member of
 * more than one selected repo. */
export interface OverviewSummary {
  activeWork: number;
  conflictsBlocking: number;
  pendingApprovals: number;
  teamMembers: number;
}

export function summarizeOverview(openDesigns: DesignStatement[], flaggedDesigns: DesignStatement[], pendingReviews: PendingReview[], members: ProjectMember[]): OverviewSummary {
  return {
    activeWork: openDesigns.length,
    conflictsBlocking: flaggedDesigns.length,
    pendingApprovals: pendingReviews.length,
    teamMembers: new Set(members.map((m) => m.developerId)).size,
  };
}

/** A file/symbol path that has collided more than once, with everyone
 * involved and when it last happened. Every other view organizes conflicts
 * by developer or by status -- this is the one axis nothing shows: which
 * *code* keeps generating conflicts, which is a signal about the code
 * (needs splitting up, needs clearer ownership) rather than about any one
 * conflict. Built from the same `paths`/`symbolIds` fields Reviews'
 * "Collides with" band and a thread's "Overlapping files" section already
 * render -- no new data, just aggregated by path instead of by conflict. */
export interface Hotspot {
  path: string;
  count: number;
  /** Deduped, sorted. Every developer who was on either side of any
   * conflict this path was involved in. */
  developers: string[];
  lastActivityAt: number;
}

/** Reduces overlapping-path mentions across reviews and threads to one
 * ranked list, most-collided-first (ties broken by most recent). A single
 * conflict naming several paths counts once per path, not once overall --
 * "how many separate collisions has this file been part of" is the
 * question this answers, not "how many conflicts exist." */
export function buildHotspots(reviews: PendingReview[], threads: AlignmentThread[]): Hotspot[] {
  const byPath = new Map<string, { count: number; developers: Set<string>; lastActivityAt: number }>();

  function record(rawPath: string, developers: (string | undefined)[], ts: number) {
    const path = pathOfTarget(rawPath);
    if (!path) return;
    let entry = byPath.get(path);
    if (!entry) {
      entry = { count: 0, developers: new Set(), lastActivityAt: 0 };
      byPath.set(path, entry);
    }
    entry.count++;
    for (const d of developers) if (d) entry.developers.add(d);
    if (ts > entry.lastActivityAt) entry.lastActivityAt = ts;
  }

  for (const review of reviews) {
    for (const conflict of review.conflicts ?? []) {
      for (const path of conflict.paths ?? []) {
        record(path, [review.design?.developerId, conflict.developerId], review.createdAt);
      }
    }
  }
  for (const thread of threads) {
    for (const symbolId of thread.symbolIds) {
      record(symbolId, [thread.developerId, thread.otherDeveloperId], thread.lastActivityAt ?? thread.openedAt);
    }
  }

  return Array.from(byPath.entries())
    .map(([path, e]) => ({ path, count: e.count, developers: Array.from(e.developers).sort(), lastActivityAt: e.lastActivityAt }))
    .sort((a, b) => b.count - a.count || b.lastActivityAt - a.lastActivityAt);
}
