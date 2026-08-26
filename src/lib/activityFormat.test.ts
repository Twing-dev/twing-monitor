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
          verdict: "file_overlap",
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

  // constraints (2026-08-22): a single object -> a list, since one check can
  // match several distinct constraints at once. Type (2026-08-26) collapsed
  // to a single value, so the rendered row no longer prefixes a type phrase
  // -- the statement text alone carries the substance, matching twing-cli's
  // own hook deny-message rewrite (constraintReason, hook/design_gate.go).
  it("design_flagged with constraint matches renders each one's statement, not just the bare verdict", () => {
    const formatted = formatActivityEvent(
      event({
        kind: "design_flagged",
        relatedId: "design-3",
        payload: { verdict: "constraint_violation", summary: "touches README.md", constraints: [{ id: "c1", statement: "use pkg/retry", type: "constraint" }] },
      }),
    );
    expect(formatted.label).toBe("Design flagged");
    expect(formatted.designSummary).toBe("touches README.md");
    const constraintField = formatted.details.find((d) => d.label === "Constraint");
    expect(constraintField?.value).toBe("use pkg/retry");
  });

  it("design_flagged with several constraint matches renders one Constraint row per match", () => {
    const formatted = formatActivityEvent(
      event({
        kind: "design_flagged",
        relatedId: "design-3b",
        payload: {
          verdict: "constraint_violation",
          constraints: [
            { id: "c1", statement: "use pkg/retry", type: "constraint" },
            { id: "c2", statement: "money paths need a second pair of eyes", type: "constraint" },
          ],
        },
      }),
    );
    const constraintFields = formatted.details.filter((d) => d.label === "Constraint");
    expect(constraintFields.map((f) => f.value)).toEqual(["use pkg/retry", "money paths need a second pair of eyes"]);
  });

  it("design_flagged with no conflicts/constraints (pre-enrichment event) still renders the bare verdict without crashing", () => {
    const formatted = formatActivityEvent(event({ kind: "design_flagged", relatedId: "design-4", payload: { verdict: "file_overlap" } }));
    expect(formatted.details).toEqual([{ label: "Verdict", value: "file_overlap" }]);
    expect(formatted.designSummary).toBeUndefined();
  });

  // 2026-08-26 terminology simplification: severity is gone entirely --
  // whether a verdict blocks is a pure function of the verdict now
  // (file_overlap never does, constraint_violation/symbol_conflict/
  // llm_divergence always do), so there's no separate field left to assert.
  it("design_checked never carries a severity field, for any verdict", () => {
    const overlap = formatActivityEvent(event({ kind: "design_checked", relatedId: "design-5", payload: { verdict: "file_overlap", summary: "third design" } }));
    const clean = formatActivityEvent(event({ kind: "design_checked", relatedId: "design-6", payload: { verdict: "clean", summary: "sixth design" } }));
    expect((overlap as { severity?: unknown }).severity).toBeUndefined();
    expect((clean as { severity?: unknown }).severity).toBeUndefined();
    expect(overlap.details.some((d) => d.label === "Severity")).toBe(false);
    expect(clean.details.some((d) => d.label === "Severity")).toBe(false);
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
    const formatted = formatActivityEvent(event({ kind: "constraint_removed", relatedId: "c1", payload: { statement: "keep README.md canonical", type: "constraint", scope: ["README.md"] } }));
    expect(formatted.label).toBe("Constraint removed");
    expect(formatted.constraintId).toBe("c1");
    expect(formatted.details).toEqual([
      { label: "Statement", value: "keep README.md canonical" },
      { label: "Type", value: "constraint" },
    ]);
  });

  it("an unrecognized kind falls back to the raw label with its payload stringified, instead of throwing", () => {
    const formatted = formatActivityEvent(event({ kind: "some_future_kind" as ActivityEvent["kind"], payload: { foo: "bar" } }));
    expect(formatted.label).toBe("some_future_kind");
    expect(formatted.details[0].value).toContain("bar");
  });
});
