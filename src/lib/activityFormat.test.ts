import { describe, it, expect } from "vitest";
import { formatActivityEvent } from "./activityFormat.js";
import type { ActivityEvent } from "../api/types.js";

function event(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return { id: "evt-1", projectId: "proj-1", kind: "design_registered", ts: Date.now(), ...overrides };
}

describe("formatActivityEvent", () => {
  it("design_checked with conflicts renders which design it overlapped and why, plus the checked design's own summary", () => {
    const formatted = formatActivityEvent(
      event({
        kind: "design_checked",
        relatedId: "design-2",
        payload: {
          verdict: "overlap",
          conflictCount: 1,
          summary: "second design",
          conflicts: [{ conflictingDesignId: "design-1", overlapKind: "touches", overlapDetail: "both touch shared.ts", conflictingSummary: "first design", overlapPaths: ["shared.ts"] }],
        },
      }),
    );
    expect(formatted.label).toBe("Design checked");
    expect(formatted.designId).toBe("design-2");
    expect(formatted.designSummary).toBe("second design");
    const overlapsField = formatted.details.find((d) => d.label === "Overlaps");
    expect(overlapsField?.value).toContain("first design");
    expect(overlapsField?.value).toContain("both touch shared.ts");
  });

  it("design_flagged with a constraint match renders the constraint's type and statement, not just the bare verdict", () => {
    const formatted = formatActivityEvent(
      event({
        kind: "design_flagged",
        relatedId: "design-3",
        payload: { verdict: "constraint_flag", summary: "touches README.md", constraint: { id: "c1", statement: "use pkg/retry", type: "canonical_abstraction" } },
      }),
    );
    expect(formatted.label).toBe("Design flagged");
    expect(formatted.designSummary).toBe("touches README.md");
    const constraintField = formatted.details.find((d) => d.label === "Constraint");
    expect(constraintField?.value).toBe("[canonical abstraction] use pkg/retry");
  });

  it("design_flagged with no conflicts/constraint (pre-enrichment event) still renders the bare verdict without crashing", () => {
    const formatted = formatActivityEvent(event({ kind: "design_flagged", relatedId: "design-4", payload: { verdict: "overlap" } }));
    expect(formatted.details).toEqual([{ label: "Verdict", value: "overlap" }]);
    expect(formatted.designSummary).toBeUndefined();
  });

  // 2026-08-19 severity split (design-checks.ts)
  it("design_checked with severity: warning surfaces it as its own field and as a details row", () => {
    const formatted = formatActivityEvent(
      event({
        kind: "design_checked",
        relatedId: "design-5",
        payload: { verdict: "overlap", severity: "warning", summary: "third design", conflicts: [{ conflictingDesignId: "design-1", overlapKind: "touches", overlapDetail: "both touch shared.ts", conflictingSummary: "first design" }] },
      }),
    );
    expect(formatted.severity).toBe("warning");
    expect(formatted.details.find((d) => d.label === "Severity")?.value).toBe("warning");
  });

  it("design_checked with a clean verdict has no severity at all", () => {
    const formatted = formatActivityEvent(event({ kind: "design_checked", relatedId: "design-6", payload: { verdict: "clean", summary: "sixth design" } }));
    expect(formatted.severity).toBeUndefined();
    expect(formatted.details.some((d) => d.label === "Severity")).toBe(false);
  });

  it("design_flagged always reports severity: error, even for a pre-split event with no severity in its payload", () => {
    const formatted = formatActivityEvent(event({ kind: "design_flagged", relatedId: "design-7", payload: { verdict: "constraint_flag" } }));
    expect(formatted.severity).toBe("error");
  });

  it("claim_recorded has no designId of its own -- resolving one is ActivityView's job, not the formatter's", () => {
    const formatted = formatActivityEvent(event({ kind: "claim_recorded", relatedId: "src/x.ts::f", payload: { symbolId: "src/x.ts::f", kind: "write", stage: "firm" } }));
    expect(formatted.designId).toBeUndefined();
    expect(formatted.details).toEqual([
      { label: "Symbol", value: "src/x.ts::f" },
      { label: "Kind", value: "write" },
      { label: "Stage", value: "firm" },
    ]);
  });

  it("constraint_removed renders the removed constraint's statement and type", () => {
    const formatted = formatActivityEvent(event({ kind: "constraint_removed", relatedId: "c1", payload: { statement: "keep README.md canonical", type: "canonical_abstraction", scope: ["README.md"] } }));
    expect(formatted.label).toBe("Constraint removed");
    expect(formatted.constraintId).toBe("c1");
    expect(formatted.details).toEqual([
      { label: "Statement", value: "keep README.md canonical" },
      { label: "Type", value: "canonical abstraction" },
    ]);
  });

  it("an unrecognized kind falls back to the raw label with its payload stringified, instead of throwing", () => {
    const formatted = formatActivityEvent(event({ kind: "some_future_kind" as ActivityEvent["kind"], payload: { foo: "bar" } }));
    expect(formatted.label).toBe("some_future_kind");
    expect(formatted.details[0].value).toContain("bar");
  });
});
