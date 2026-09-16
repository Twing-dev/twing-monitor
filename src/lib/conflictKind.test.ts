import { describe, it, expect } from "vitest";
import { bucketFromReviewConflictKind, conflictKindInfo, isConflictBucket, type ConflictBucket } from "./conflictKind.js";
import type { AlignmentSubKind } from "../api/types.js";

const ALL_BUCKETS: ConflictBucket[] = ["file_overlap", "constraint_violation", "symbol_conflict", "llm_divergence"];
const ALL_SUBKINDS: AlignmentSubKind[] = ["duplication", "contradictory_assumptions", "tension", "real_edit_collision", "scope_intrusion", "contract_break"];

describe("conflictKindInfo", () => {
  it("gives every bucket a non-empty label and explanation", () => {
    for (const bucket of ALL_BUCKETS) {
      const info = conflictKindInfo(bucket);
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.explanation.length).toBeGreaterThan(0);
    }
  });

  it("only file_overlap is non-blocking", () => {
    expect(conflictKindInfo("file_overlap").blocking).toBe(false);
    expect(conflictKindInfo("constraint_violation").blocking).toBe(true);
    expect(conflictKindInfo("symbol_conflict").blocking).toBe(true);
    expect(conflictKindInfo("llm_divergence").blocking).toBe(true);
  });

  it("only file_overlap gets a warning tone -- everything else is critical", () => {
    expect(conflictKindInfo("file_overlap").tone).toBe("warning");
    for (const bucket of ["constraint_violation", "symbol_conflict", "llm_divergence"] as const) {
      expect(conflictKindInfo(bucket).tone).toBe("critical");
    }
  });

  it("gives every subKind its own explanation, distinct from the bare bucket explanation", () => {
    for (const subKind of ALL_SUBKINDS) {
      const withSubKind = conflictKindInfo("symbol_conflict", subKind);
      const bare = conflictKindInfo("symbol_conflict");
      expect(withSubKind.explanation.length).toBeGreaterThan(0);
      expect(withSubKind.explanation).not.toBe(bare.explanation);
      // subKind never changes severity -- only the bucket does.
      expect(withSubKind.tone).toBe(bare.tone);
      expect(withSubKind.blocking).toBe(bare.blocking);
    }
  });
});

describe("isConflictBucket", () => {
  it("accepts the four real buckets", () => {
    for (const bucket of ALL_BUCKETS) expect(isConflictBucket(bucket)).toBe(true);
  });

  it("rejects clean and unknown strings", () => {
    expect(isConflictBucket("clean")).toBe(false);
    expect(isConflictBucket("something_else")).toBe(false);
  });
});

describe("bucketFromReviewConflictKind", () => {
  it("maps the three review-conflict kinds to their buckets", () => {
    expect(bucketFromReviewConflictKind("overlap")).toBe("file_overlap");
    expect(bucketFromReviewConflictKind("symbol_conflict")).toBe("symbol_conflict");
    expect(bucketFromReviewConflictKind("conflict")).toBe("llm_divergence");
  });
});
