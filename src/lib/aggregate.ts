import type { DesignStatement, ProjectMember } from "../api/types.js";

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
 */
export function dedupeDesignsByGroup(designs: DesignStatement[]): DesignGroup[] {
  const groups = new Map<string, DesignGroup>();

  for (const design of designs) {
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
