import { describe, it, expect } from "vitest";
import { groupActivityByDesign } from "./designGrouping.js";
import type { ActivityEvent, DesignStatement } from "../api/types.js";

function design(overrides: Partial<DesignStatement> = {}): DesignStatement {
  return {
    id: "design-1",
    projectId: "proj-1",
    developerId: "alice@example.com",
    sessionId: "sess-1",
    status: "open",
    createdAt: 1000,
    summary: "Add retry backoff",
    creates: [],
    touches: [],
    dependsOn: [],
    ttlMs: 3_600_000,
    scopeVersion: 1,
    lastActivityAt: 1000,
    justifiedConstraintIds: [],
    justifiedOverlaps: [],
    justifiedConflicts: [],
    justifiedSymbolConflicts: [],
    ...overrides,
  };
}

function event(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return { id: "evt-1", projectId: "proj-1", kind: "design_registered", ts: 1000, ...overrides };
}

describe("groupActivityByDesign", () => {
  it("groups a design_registered event by its own relatedId", () => {
    const d = design();
    const registered = event({ kind: "design_registered", relatedId: "design-1", payload: { summary: "Add retry backoff" } });
    const entries = groupActivityByDesign([registered], { "design-1": d }, {}, {});
    expect(entries).toEqual([{ type: "group", group: { key: "design-1", members: [d], events: [registered], lastActivityAt: 1000, developerIds: [] } }]);
  });

  it("groups a claim_recorded event via the session -> design fallback, since it carries no designId of its own", () => {
    const d = design({ sessionId: "sess-1" });
    const claim = event({ id: "evt-claim", kind: "claim_recorded", sessionId: "sess-1", developerId: "alice@example.com", relatedId: "src/x.ts::f", payload: { symbolId: "src/x.ts::f", kind: "write", stage: "firm" } });
    const entries = groupActivityByDesign([claim], { "design-1": d }, { "sess-1": d }, {});
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ type: "group", group: { key: "design-1", members: [d], events: [claim], lastActivityAt: 1000, developerIds: ["alice@example.com"] } });
  });

  it("a claim from a different session than any known design's stays ungrouped", () => {
    const d = design({ sessionId: "sess-other" });
    const claim = event({ kind: "claim_recorded", sessionId: "sess-1" });
    const entries = groupActivityByDesign([claim], { "design-1": d }, { "sess-other": d }, {});
    expect(entries).toEqual([{ type: "event", event: claim }]);
  });

  it("groups finding_raised/alignment_* events via the threadId -> designId map, since they carry a threadId but no designId", () => {
    const d = design();
    const finding = event({ id: "evt-finding", kind: "finding_raised", relatedId: "thread-1" });
    const opened = event({ id: "evt-opened", kind: "alignment_thread_opened", relatedId: "thread-1", ts: 900 });
    const entries = groupActivityByDesign([finding, opened], { "design-1": d }, {}, { "thread-1": "design-1" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ type: "group", group: { key: "design-1", members: [d], events: [finding, opened], lastActivityAt: 1000, developerIds: [] } });
  });

  it("collects every distinct developerId across a group's events, most-recently-active first, deduped and skipping events with none", () => {
    const d = design();
    // finding_raised can carry a different developer than the design's own
    // owner (the other party in the alignment thread) -- both should show.
    const newest = event({ id: "evt-newest", kind: "finding_raised", relatedId: "thread-1", developerId: "carol@example.com", ts: 3000 });
    const noDeveloper = event({ id: "evt-system", kind: "finding_raised", relatedId: "thread-1", ts: 2000 });
    const repeat = event({ id: "evt-repeat", kind: "finding_raised", relatedId: "thread-1", developerId: "carol@example.com", ts: 1500 });
    const oldest = event({ id: "evt-oldest", kind: "finding_raised", relatedId: "thread-1", developerId: "alice@example.com", ts: 1000 });

    const entries = groupActivityByDesign([newest, noDeveloper, repeat, oldest], { "design-1": d }, {}, { "thread-1": "design-1" });

    const group = entries[0].type === "group" ? entries[0].group : undefined;
    expect(group?.developerIds).toEqual(["carol@example.com", "alice@example.com"]);
  });

  it("constraint_ratified/_updated/_removed are never design-scoped -- always ungrouped even alongside an otherwise-matching session/thread", () => {
    const d = design();
    const ratified = event({ kind: "constraint_ratified", sessionId: "sess-1", relatedId: "c1" });
    const entries = groupActivityByDesign([ratified], { "design-1": d }, { "sess-1": d }, {});
    expect(entries).toEqual([{ type: "event", event: ratified }]);
  });

  it("a resolved designId that isn't in designsById degrades to ungrouped rather than throwing", () => {
    const flagged = event({ kind: "design_flagged", relatedId: "design-missing", payload: { verdict: "constraint_violation" } });
    const entries = groupActivityByDesign([flagged], {}, {}, {});
    expect(entries).toEqual([{ type: "event", event: flagged }]);
  });

  it("tracks lastActivityAt as the group's own most recent event and preserves newest-first ordering without a separate sort", () => {
    const d = design();
    const other = design({ id: "design-2", summary: "Unrelated" });
    const newestForD = event({ id: "evt-newest", kind: "design_flagged", relatedId: "design-1", ts: 3000, payload: { verdict: "constraint_violation" } });
    const otherDesignEvent = event({ id: "evt-other", kind: "design_registered", relatedId: "design-2", ts: 2000, payload: { summary: "Unrelated" } });
    const olderForD = event({ id: "evt-older", kind: "design_registered", relatedId: "design-1", ts: 1000, payload: { summary: "Add retry backoff" } });

    // Already newest-first, as /v1/activity returns it.
    const entries = groupActivityByDesign([newestForD, otherDesignEvent, olderForD], { "design-1": d, "design-2": other }, {}, {});

    expect(entries.map((e) => (e.type === "group" ? e.group.key : e.event.id))).toEqual(["design-1", "design-2"]);
    const groupD = entries[0].type === "group" ? entries[0].group : undefined;
    expect(groupD?.lastActivityAt).toBe(3000);
    expect(groupD?.events.map((e) => e.id)).toEqual(["evt-newest", "evt-older"]);
  });

  it("collapses a groupId-linked chain of designs into a single row, matching the Designs tab's own dedup key -- the bug this was written to fix", () => {
    // Three separately-registered designs sharing one groupId, e.g. a
    // re-theme design plus two `--group`-linked follow-up designs, exactly
    // the shape this session's own real prod data hit (5 designs, 2
    // groupId chains, but "group by design" showed 5 rows before this fix).
    const root = design({ id: "root", groupId: "root", summary: "Re-theme", lastActivityAt: 1000 });
    const follow1 = design({ id: "follow-1", groupId: "root", summary: "Restore mascot", lastActivityAt: 2000 });
    const follow2 = design({ id: "follow-2", groupId: "root", summary: "Drop dark mode", lastActivityAt: 3000 });
    const designsById = { root, "follow-1": follow1, "follow-2": follow2 };

    const rootRegistered = event({ id: "evt-root", kind: "design_registered", relatedId: "root", ts: 1000, payload: { summary: "Re-theme" } });
    const follow1Registered = event({ id: "evt-follow-1", kind: "design_registered", relatedId: "follow-1", ts: 2000, payload: { summary: "Restore mascot" } });
    const follow2Registered = event({ id: "evt-follow-2", kind: "design_registered", relatedId: "follow-2", ts: 3000, payload: { summary: "Drop dark mode" } });

    // Newest-first, as /v1/activity returns it.
    const entries = groupActivityByDesign([follow2Registered, follow1Registered, rootRegistered], designsById, {}, {});

    expect(entries).toHaveLength(1);
    const group = entries[0].type === "group" ? entries[0].group : undefined;
    expect(group?.key).toBe("root");
    expect(group?.events.map((e) => e.id)).toEqual(["evt-follow-2", "evt-follow-1", "evt-root"]);
    // members[0] is the most-recently-active member regardless of the
    // order designsById happened to be built in.
    expect(group?.members.map((m) => m.id)).toEqual(["follow-2", "follow-1", "root"]);
  });

  it("keeps two designs with no shared groupId as separate rows", () => {
    const a = design({ id: "design-a", groupId: "design-a", summary: "First" });
    const b = design({ id: "design-b", groupId: "design-b", summary: "Second" });
    const eventA = event({ id: "evt-a", kind: "design_registered", relatedId: "design-a", payload: { summary: "First" } });
    const eventB = event({ id: "evt-b", kind: "design_registered", relatedId: "design-b", payload: { summary: "Second" } });

    const entries = groupActivityByDesign([eventA, eventB], { "design-a": a, "design-b": b }, {}, {});

    expect(entries.map((e) => (e.type === "group" ? e.group.key : undefined))).toEqual(["design-a", "design-b"]);
  });
});
