import { describe, it, expect } from "vitest";
import { fetchAllProjects, dedupeDesignsByGroup, dedupeMembersByDeveloper } from "./aggregate.js";
import type { DesignStatement, ProjectMember } from "../api/types.js";

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
