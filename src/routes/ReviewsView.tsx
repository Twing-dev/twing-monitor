import { useState } from "react";
import type { PendingReview } from "../api/types.js";
import { StatusBadge, type BadgeTone } from "../components/StatusBadge.js";
import { relativeTime } from "../lib/time.js";
import { conflictKindInfo, bucketFromReviewConflictKind } from "../lib/conflictKind.js";

/** The pieces of a review's card -- header row and expanded body -- kept
 * here and exported for `ConflictsView` (2026-09 conflict-tab unification:
 * Reviews merged with Alignment threads into one tab) to reuse verbatim
 * rather than reimplementing the approve/reject flow a second time. There
 * is no longer a standalone "Reviews" route; browsing reviews now always
 * goes through `ConflictsView`. */

/** Roughly the length at which the clamp actually hides something -- below
 * it, a "Show all" control costs more attention than the text it saves. */
const SAID_CLAMP_CHARS = 220;

/** The stored value is the verb the API takes ("approve"), but a badge is
 * reporting state, not offering an action -- "APPROVE" sitting next to
 * Approve/Reject buttons reads as a third button. */
function decisionLabel(decision?: "approve" | "reject"): string {
  if (decision === "approve") return "approved";
  if (decision === "reject") return "rejected";
  return "pending";
}

function toneForDecision(decision?: "approve" | "reject"): BadgeTone {
  if (decision === "approve") return "good";
  if (decision === "reject") return "critical";
  return "warning";
}

/** The machine names for a constraint type say nothing to someone who has
 * never opened `.twing/twing.yml`. Only meaningful for a pre-2026-08-26
 * constraint row, which may still carry one of these three old type strings
 * verbatim (no migration touched existing rows -- see `DesignConstraintType`'s
 * doc comment, api/types.ts). A new row's `type` is always the single value
 * `"constraint"`, which is no longer informative enough to show -- mirrors
 * the CLI dropping the same per-constraint-type text entirely
 * (`hook/design_gate.go`'s `constraintTypeText`, removed 2026-08-26).
 * Returns `undefined` rather than the raw type string so the caller can
 * skip rendering the sub-line at all in that case. */
function constraintTypeText(type: string): string | undefined {
  switch (type) {
    case "review_required":
      return "a human must review changes here";
    case "canonical_abstraction":
      return "use the existing approach, don't add a second one";
    case "domain_fact":
      return "a fact about this codebase you shouldn't contradict";
    default:
      return undefined;
  }
}

/** The header row shared by a card's collapsible list form and its
 * standalone focused-page form. `expanded` hides the rule/collision count
 * hints once the full detail (ReviewCardBody) is already showing them. */
export function ReviewCardHeaderContent({ review, expanded, repoBadge }: { review: PendingReview; expanded: boolean; repoBadge?: React.ReactNode }) {
  const design = review.design;
  const blockers = review.constraints ?? [];
  const conflicts = review.conflicts ?? [];
  return (
    <>
      <div className="card-top-row">
        <span className="review-headline">{design?.summary ?? review.justification}</span>
        <div className="card-badges">
          {repoBadge}
          {!expanded && blockers.length > 0 && <span className="card-hint">{blockers.length === 1 ? "1 rule" : `${blockers.length} rules`}</span>}
          {!expanded && conflicts.length > 0 && <span className="card-hint">{conflicts.length === 1 ? "1 collision" : `${conflicts.length} collisions`}</span>}
          <StatusBadge label={decisionLabel(review.decision)} tone={toneForDecision(review.decision)} />
        </div>
      </div>
      <div className="card-meta">
        {design?.developerId && <span>{design.developerId}</span>}
        <span>{relativeTime(review.createdAt)}</span>
      </div>
    </>
  );
}

/**
 * The expanded body shared by both render paths -- what is being built, why
 * it stopped, and what the requester says, in that order (see the original
 * doc comment this replaced: an admin needs enough to answer "do I want
 * this to happen?", not just the argument for letting it through).
 */
export function ReviewCardBody({
  review,
  canDecide,
  busy,
  onDecide,
}: {
  review: PendingReview;
  canDecide: boolean;
  busy: boolean;
  onDecide: (id: string, decision: "approve" | "reject") => void;
}) {
  const [saidExpanded, setSaidExpanded] = useState(false);
  const design = review.design;
  const blockers = review.constraints ?? [];
  // Every rule carries a type, but a card whose rules all share one (the
  // common case -- three `review_required` paths on the same design) was
  // printing the identical translation under each of them. Show it once,
  // as a heading for the group, and only fall back to per-rule when the
  // types genuinely differ.
  const blockerTypes = [...new Set(blockers.map((c) => c.type))];
  const oneBlockerType = blockerTypes.length === 1 ? blockerTypes[0] : undefined;
  // A new-style row's type is always "constraint" -- constraintTypeText
  // returns undefined for it (nothing worth heading a group with), so the
  // dedup heading only ever appears for a shared *old*-style type.
  const oneBlockerTypeText = oneBlockerType ? constraintTypeText(oneBlockerType) : undefined;
  const conflicts = review.conflicts ?? [];

  return (
    <div className="review-card-inner">
      {blockers.length > 0 && (
        <div className="review-band review-band-blocked">
          <span className="review-band-label">Blocked by</span>
          <div>
            {oneBlockerTypeText && (
              <p className="review-band-sub review-band-heading">
                {blockers.length > 1 ? `${blockers.length} rules — ` : ""}
                {oneBlockerTypeText}
              </p>
            )}
            {blockers.map((c) => {
              const typeText = constraintTypeText(c.type);
              return (
                <p key={c.id} className="review-band-line">
                  “{c.statement}”
                  {!oneBlockerTypeText && typeText && <span className="review-band-sub">{typeText}</span>}
                </p>
              );
            })}
          </div>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="review-band review-band-blocked">
          <span className="review-band-label">Collides with</span>
          <div>
            {conflicts.map((c) => {
              const info = conflictKindInfo(bucketFromReviewConflictKind(c.kind));
              return (
                <p key={`${c.kind}-${c.designId}`} className="review-band-line">
                  {c.summary ?? <span className="review-band-sub">design {c.designId}</span>}
                  <span className="review-band-sub">
                    <StatusBadge label={info.label} tone={info.tone} />
                    {c.developerId ? ` ${c.developerId} · ` : " "}
                    {info.explanation}
                  </span>
                </p>
              );
            })}
          </div>
        </div>
      )}

      {/* Only worth a band of its own once there's something above it to
          contrast against -- on a bare card the headline already is the
          justification, and repeating it reads as a bug. */}
      {design && (
        <div className="review-band review-band-says">
          <span className="review-band-label">They say</span>
          <div>
            {/* Clamped by default. A justification written by an agent runs
                to several hundred words of implementation detail, and left
                open it dwarfs the two bands above it -- which are the ones
                a reviewer actually decides on. It's their argument, not the
                finding, so it earns less room until asked for. */}
            <p className={`review-band-line${saidExpanded ? "" : " clamped"}`}>“{review.justification}”</p>
            {review.justification.length > SAID_CLAMP_CHARS && (
              <button type="button" className="review-expand" onClick={() => setSaidExpanded((v) => !v)} aria-expanded={saidExpanded}>
                {saidExpanded ? "Show less" : "Show all"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* No nested "Show detail" any more. The card itself is the
          disclosure now, and a second one inside it meant opening a card
          still didn't show you the card -- which is the bloat this whole
          change is removing. Everything below appears on open. */}
      {design && (
        <dl className="review-detail">
          {design.creates.length > 0 && (
            <>
              <dt>Creates</dt>
              <dd>{design.creates.join(", ")}</dd>
            </>
          )}
          {design.touches.length > 0 && (
            <>
              <dt>Touches</dt>
              <dd>{design.touches.join(", ")}</dd>
            </>
          )}
          {conflicts.some((c) => c.paths?.length) && (
            <>
              <dt>Overlapping</dt>
              <dd>{conflicts.flatMap((c) => c.paths ?? []).join(", ")}</dd>
            </>
          )}
          <dt>Plan</dt>
          <dd>{review.designId}</dd>
        </dl>
      )}

      {canDecide && !review.decision && (
        <div className="review-actions">
          <button type="button" className="resolve-button resolve-approve" disabled={busy} onClick={() => onDecide(review.id, "approve")}>
            {busy ? "…" : "Approve"}
          </button>
          <button type="button" className="resolve-button resolve-reject" disabled={busy} onClick={() => onDecide(review.id, "reject")}>
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
