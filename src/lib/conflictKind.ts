/**
 * One vocabulary for "why is this design/review/thread flagged," shared by
 * DesignsView, DesignDetail, ReviewsView/AlignmentThreadsView (now merged
 * into ConflictsView), and Overview -- replacing four independent label
 * switches (DesignsView's `designFlags`, AlignmentThreadsView's
 * `categoryLabel`, ReviewsView's inline kind ternary, and DesignDetail's
 * raw-verdict-string rendering) that had drifted into three different names
 * for the same four buckets. See @twing/core's `DesignVerdict` doc comment
 * (packages/core/src/types.ts) for the authoritative four-bucket model this
 * mirrors.
 */

import type { AlignmentSubKind } from "../api/types.js";
import type { BadgeTone } from "../components/StatusBadge.js";

export type ConflictBucket = "file_overlap" | "constraint_violation" | "symbol_conflict" | "llm_divergence";

export interface ConflictKindInfo {
  label: string;
  tone: BadgeTone;
  /** `file_overlap` is the one bucket that never blocks -- always
   * advisory/display-only. Every other bucket blocks until resolved. */
  blocking: boolean;
  /** One sentence, for a detail panel or tooltip. `subKind`-specific when
   * available (more precise), falling back to a bucket-level explanation
   * otherwise. */
  explanation: string;
}

function bucketLabel(bucket: ConflictBucket): string {
  switch (bucket) {
    case "file_overlap":
      return "Planning overlap";
    case "constraint_violation":
      return "Blocked by team rule";
    case "symbol_conflict":
      return "Edits collide";
    case "llm_divergence":
      return "Conflicting approach";
  }
}

function bucketTone(bucket: ConflictBucket): BadgeTone {
  return bucket === "file_overlap" ? "warning" : "critical";
}

function bucketBlocking(bucket: ConflictBucket): boolean {
  return bucket !== "file_overlap";
}

function bucketExplanation(bucket: ConflictBucket): string {
  switch (bucket) {
    case "file_overlap":
      return "Both declared the same file/scope before either wrote code -- advisory only, nobody's blocked yet.";
    case "constraint_violation":
      return "This work touches something the team has protected with a fixed rule.";
    case "symbol_conflict":
      return "Both sessions made real edits to the same code, not just declared plans.";
    case "llm_divergence":
      return "An automatic check judged these two plans as duplicating or contradicting each other.";
  }
}

/** Detail text under the bucket label -- the specific mechanism, for
 * someone who wants it, without displacing the bucket label's severity
 * signal. Undefined for a thread with no `subKind` (predates the column),
 * in which case the caller falls back to `bucketExplanation`. */
function subKindExplanation(subKind: AlignmentSubKind): string {
  switch (subKind) {
    case "duplication":
      return "Two sessions appear to be building the same thing.";
    case "contradictory_assumptions":
      return "Their stated assumptions don't agree.";
    case "tension":
      return "Related work that isn't clearly compatible.";
    case "real_edit_collision":
      return "Both sessions edited the same code directly.";
    case "scope_intrusion":
      return "One session edited past what it declared it would touch.";
    case "contract_break":
      return "A signature changed that another session's work depends on.";
  }
}

export function conflictKindInfo(bucket: ConflictBucket, subKind?: AlignmentSubKind): ConflictKindInfo {
  return {
    label: bucketLabel(bucket),
    tone: bucketTone(bucket),
    blocking: bucketBlocking(bucket),
    explanation: subKind ? subKindExplanation(subKind) : bucketExplanation(bucket),
  };
}

export function isConflictBucket(value: string): value is ConflictBucket {
  return value === "file_overlap" || value === "constraint_violation" || value === "symbol_conflict" || value === "llm_divergence";
}

/** `PendingReview.conflicts[].kind` -- see that field's own doc comment
 * (api/types.ts) for why it's a third, waiver-specific vocabulary
 * (`"overlap"`/`"conflict"`/`"symbol_conflict"`) rather than `DesignVerdict`
 * values directly. `constraint_violation` has no equivalent here: a
 * review's `conflicts` array is specifically the design-vs-design
 * collisions, `constraints` is the separate array for rule violations. */
export function bucketFromReviewConflictKind(kind: "overlap" | "conflict" | "symbol_conflict"): ConflictBucket {
  switch (kind) {
    case "overlap":
      return "file_overlap";
    case "symbol_conflict":
      return "symbol_conflict";
    case "conflict":
      return "llm_divergence";
  }
}
