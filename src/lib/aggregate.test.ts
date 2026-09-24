import { describe, it, expect } from "vitest";
import { fetchAllProjects, dedupeDesignsByGroup, dedupeMembersByDeveloper, buildConflictItems, summarizeOverview, buildHotspots } from "./aggregate.js";
import type { AlignmentThread, DesignStatement, PendingReview, ProjectMember } from "../api/types.js";

function design(overrides: Partial<DesignStatement> & { id: string }): DesignStatement {
  return {
    projectId: "proj-1",
    developerId: "alice@example.com",
    sessionId: "sess-1",
    status: "open",
    createdAt: 0,
    summary: "",
    creates: [],
    touches: [],
    dependsOn: [],
    ttlMs: 3_600_000,
    scopeVersion: 1,
    lastActivityAt: 0,
    justifiedConstraintIds: [],
    justifiedOverlaps: [],
    justifiedConflicts: [],
    justifiedSymbolConflicts: [],
    ...overrides,
  };
}

describe("fetchAllProjects", () => {
  it("fans a per-project fetch out and flattens the results", async () => {
    const calls: string[] = [];
    const result = await fetchAllProjects(["proj-1", "proj-2"], async (projectId) => {
      calls.push(projectId);
      return [`${projectId}-a`, `${projectId}-b`];
    });
    expect(calls.sort()).toEqual(["proj-1", "proj-2"]);
    expect(result.sort()).toEqual(["proj-1-a", "proj-1-b", "proj-2-a", "proj-2-b"]);
  });

  it("returns an empty array for an empty project list", async () => {
    const result = await fetchAllProjects([], async () => [1, 2, 3]);
    expect(result).toEqual([]);
  });
});

describe("dedupeDesignsByGroup", () => {
  it("merges two designs sharing a groupId across different projects into one group", () => {
    const a = design({ id: "a", projectId: "proj-1", groupId: "a", lastActivityAt: 100 });
    const b = design({ id: "b", projectId: "proj-2", groupId: "a", lastActivityAt: 200 });
    const groups = dedupeDesignsByGroup([b, a]); // newest-active-first input order

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("a");
    expect(groups[0].members.map((m) => m.id)).toEqual(["b", "a"]);
    expect(groups[0].lastActivityAt).toBe(200);
  });

  it("treats designs with no shared groupId as singleton groups", () => {
    const a = design({ id: "a", groupId: "a", lastActivityAt: 100 });
    const b = design({ id: "b", groupId: "b", lastActivityAt: 50 });
    const groups = dedupeDesignsByGroup([a, b]);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.key)).toEqual(["a", "b"]);
    expect(groups.map((g) => g.members.length)).toEqual([1, 1]);
  });

  it("merges two designs sharing a groupId within the same project", () => {
    const a = design({ id: "a", projectId: "proj-1", groupId: "a", lastActivityAt: 100 });
    const b = design({ id: "b", projectId: "proj-1", groupId: "a", lastActivityAt: 50 });
    const groups = dedupeDesignsByGroup([a, b]);

    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("falls back to the design's own id when groupId is absent (pre-migration row)", () => {
    const a = design({ id: "a", groupId: undefined, lastActivityAt: 100 });
    const groups = dedupeDesignsByGroup([a]);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("a");
  });

  it("returns an empty array for an empty input", () => {
    expect(dedupeDesignsByGroup([])).toEqual([]);
  });

  // The same row delivered twice -- an overlapping `before` cursor, or a
  // focus design merged into a page that already held it. Two members with
  // one id render as two identical panels that no label can separate, so
  // the collapse happens here rather than at each call site.
  it("collapses the same design arriving twice into one member", () => {
    const a = design({ id: "a", groupId: "grp", lastActivityAt: 100 });
    const groups = dedupeDesignsByGroup([a, { ...a }]);

    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id)).toEqual(["a"]);
  });

  it("keeps the first occurrence, so a stale repeat cannot overwrite a fresher one", () => {
    const fresh = design({ id: "a", groupId: "grp", lastActivityAt: 300, summary: "current" });
    const stale = design({ id: "a", groupId: "grp", lastActivityAt: 100, summary: "outdated" });
    const groups = dedupeDesignsByGroup([fresh, stale]); // newest-active-first

    expect(groups[0].members).toHaveLength(1);
    expect(groups[0].members[0].summary).toBe("current");
    expect(groups[0].lastActivityAt).toBe(300);
  });

  it("still distinguishes two different designs that share a groupId", () => {
    const a = design({ id: "a", groupId: "grp", lastActivityAt: 100 });
    const b = design({ id: "b", groupId: "grp", lastActivityAt: 50 });
    const groups = dedupeDesignsByGroup([a, b, { ...a }]);

    expect(groups[0].members.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("sorts groups by their max member's lastActivityAt, descending", () => {
    const old = design({ id: "old", groupId: "old", lastActivityAt: 10 });
    const recentA = design({ id: "recent-a", groupId: "recent", lastActivityAt: 20 });
    const recentB = design({ id: "recent-b", groupId: "recent", lastActivityAt: 300 });
    const groups = dedupeDesignsByGroup([old, recentA, recentB]);

    expect(groups.map((g) => g.key)).toEqual(["recent", "old"]);
    expect(groups[0].lastActivityAt).toBe(300);
  });
});

describe("dedupeMembersByDeveloper", () => {
  function member(overrides: Partial<ProjectMember> & { developerId: string; projectId: string }): ProjectMember {
    return { role: "member", ...overrides };
  }

  it("merges the same developer's membership across repos into one group with both memberships", () => {
    const a = member({ developerId: "alice@example.com", projectId: "proj-1", role: "admin" });
    const b = member({ developerId: "alice@example.com", projectId: "proj-2", role: "member" });
    const groups = dedupeMembersByDeveloper([a, b]);

    expect(groups).toHaveLength(1);
    expect(groups[0].developerId).toBe("alice@example.com");
    expect(groups[0].memberships).toEqual([a, b]);
  });

  it("keeps different developers as separate groups", () => {
    const a = member({ developerId: "alice@example.com", projectId: "proj-1" });
    const b = member({ developerId: "bob@example.com", projectId: "proj-1" });
    const groups = dedupeMembersByDeveloper([a, b]);

    expect(groups.map((g) => g.developerId)).toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("sorts groups by developerId", () => {
    const groups = dedupeMembersByDeveloper([member({ developerId: "zoe@example.com", projectId: "proj-1" }), member({ developerId: "adam@example.com", projectId: "proj-1" })]);
    expect(groups.map((g) => g.developerId)).toEqual(["adam@example.com", "zoe@example.com"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(dedupeMembersByDeveloper([])).toEqual([]);
  });
});

function review(overrides: Partial<PendingReview> & { id: string }): PendingReview {
  return { designId: "design-1", projectId: "proj-1", justification: "because", createdAt: 0, ...overrides };
}

function thread(overrides: Partial<AlignmentThread> & { id: string }): AlignmentThread {
  return {
    projectId: "proj-1",
    symbolId: "",
    developerId: "alice@example.com",
    otherDeveloperId: "bob@example.com",
    status: "open",
    systemDescription: "looks like a duplicate",
    openedAt: 0,
    symbolIds: [],
    lastActivityAt: 0,
    ...overrides,
  };
}

describe("buildConflictItems", () => {
  it("stages an undecided review as awaiting_approval and a decided one as resolved", () => {
    const pending = review({ id: "r-pending", createdAt: 10 });
    const decided = review({ id: "r-decided", createdAt: 20, decision: "approve" });
    const items = buildConflictItems([pending, decided], []);

    const pendingItem = items.find((i) => i.kind === "review" && i.review.id === "r-pending");
    const decidedItem = items.find((i) => i.kind === "review" && i.review.id === "r-decided");
    expect(pendingItem?.stage).toBe("awaiting_approval");
    expect(decidedItem?.stage).toBe("resolved");
  });

  it("stages an open thread as open_discussion and a closed/dormant one as resolved", () => {
    const open = thread({ id: "t-open", status: "open", lastActivityAt: 10 });
    const closed = thread({ id: "t-closed", status: "closed", lastActivityAt: 20 });
    const dormant = thread({ id: "t-dormant", status: "dormant", lastActivityAt: 30 });
    const items = buildConflictItems([], [open, closed, dormant]);

    expect(items.find((i) => i.kind === "thread" && i.thread.id === "t-open")?.stage).toBe("open_discussion");
    expect(items.find((i) => i.kind === "thread" && i.thread.id === "t-closed")?.stage).toBe("resolved");
    expect(items.find((i) => i.kind === "thread" && i.thread.id === "t-dormant")?.stage).toBe("resolved");
  });

  it("merges reviews and threads into one newest-first list", () => {
    const oldReview = review({ id: "r-old", createdAt: 10 });
    const newThread = thread({ id: "t-new", lastActivityAt: 30 });
    const midReview = review({ id: "r-mid", createdAt: 20 });
    const items = buildConflictItems([oldReview, midReview], [newThread]);

    expect(items.map((i) => (i.kind === "review" ? i.review.id : i.thread.id))).toEqual(["t-new", "r-mid", "r-old"]);
  });

  it("a thread with no lastActivityAt falls back to openedAt for sorting", () => {
    const t = thread({ id: "t1", openedAt: 42, lastActivityAt: undefined as unknown as number });
    const items = buildConflictItems([], [t]);
    expect(items[0].ts).toBe(42);
  });

  it("returns an empty array when there's nothing to merge", () => {
    expect(buildConflictItems([], [])).toEqual([]);
  });
});

describe("summarizeOverview", () => {
  it("counts each list at face value, deduping team members by developerId", () => {
    const open = [design({ id: "d1" }), design({ id: "d2" })];
    const flagged = [design({ id: "d3", status: "flagged" })];
    const pendingReviews = [review({ id: "r1" })];
    const members = [
      { developerId: "alice@example.com", projectId: "proj-1", role: "admin" as const },
      { developerId: "alice@example.com", projectId: "proj-2", role: "member" as const },
      { developerId: "bob@example.com", projectId: "proj-1", role: "member" as const },
    ];

    expect(summarizeOverview(open, flagged, pendingReviews, members)).toEqual({
      activeWork: 2,
      conflictsBlocking: 1,
      pendingApprovals: 1,
      teamMembers: 2,
    });
  });

  it("is all zeros for empty inputs", () => {
    expect(summarizeOverview([], [], [], [])).toEqual({ activeWork: 0, conflictsBlocking: 0, pendingApprovals: 0, teamMembers: 0 });
  });
});

describe("buildHotspots", () => {
  it("counts a review conflict's paths, attributing both the design author and the conflict's own developer", () => {
    const r = review({
      id: "r1",
      design: { summary: "", creates: [], touches: [], developerId: "alice@example.com", status: "flagged" },
      conflicts: [{ designId: "d2", kind: "overlap", developerId: "bob@example.com", paths: ["src/billing/charge.ts"] }],
    });
    const hotspots = buildHotspots([r], []);

    expect(hotspots).toEqual([{ path: "src/billing/charge.ts", count: 1, developers: ["alice@example.com", "bob@example.com"], lastActivityAt: r.createdAt }]);
  });

  it("strips the symbol half of a thread's symbolIds down to the file path", () => {
    const t = thread({ id: "t1", symbolIds: ["src/net/retry.ts::RetryPolicy.backoff"], developerId: "alice@example.com", otherDeveloperId: "bob@example.com" });
    const hotspots = buildHotspots([], [t]);

    expect(hotspots[0].path).toBe("src/net/retry.ts");
    expect(hotspots[0].developers).toEqual(["alice@example.com", "bob@example.com"]);
  });

  it("counts one occurrence per conflict a path appears in, not the total number of collisions overall", () => {
    const r1 = review({ id: "r1", conflicts: [{ designId: "d2", kind: "overlap", paths: ["src/x.ts"] }] });
    const r2 = review({ id: "r2", conflicts: [{ designId: "d3", kind: "overlap", paths: ["src/x.ts"] }] });
    const hotspots = buildHotspots([r1, r2], []);

    expect(hotspots[0]).toMatchObject({ path: "src/x.ts", count: 2 });
  });

  it("sorts most-collided-first, breaking ties by most recent", () => {
    const busy = review({ id: "r1", createdAt: 10, conflicts: [{ designId: "d2", kind: "overlap", paths: ["src/busy.ts"] }] });
    const busyAgain = review({ id: "r2", createdAt: 20, conflicts: [{ designId: "d3", kind: "overlap", paths: ["src/busy.ts"] }] });
    const quietNewer = review({ id: "r3", createdAt: 30, conflicts: [{ designId: "d4", kind: "overlap", paths: ["src/quiet.ts"] }] });
    const hotspots = buildHotspots([busy, busyAgain, quietNewer], []);

    expect(hotspots.map((h) => h.path)).toEqual(["src/busy.ts", "src/quiet.ts"]);
    expect(hotspots[0].lastActivityAt).toBe(20);
  });

  it("dedupes a developer who appears on multiple collisions for the same path", () => {
    const r1 = review({ id: "r1", design: { summary: "", creates: [], touches: [], developerId: "alice@example.com", status: "flagged" }, conflicts: [{ designId: "d2", kind: "overlap", paths: ["src/x.ts"] }] });
    const r2 = review({ id: "r2", design: { summary: "", creates: [], touches: [], developerId: "alice@example.com", status: "flagged" }, conflicts: [{ designId: "d3", kind: "overlap", paths: ["src/x.ts"] }] });
    const hotspots = buildHotspots([r1, r2], []);

    expect(hotspots[0].developers).toEqual(["alice@example.com"]);
  });

  it("returns an empty array when there's nothing to aggregate", () => {
    expect(buildHotspots([], [])).toEqual([]);
  });
});
