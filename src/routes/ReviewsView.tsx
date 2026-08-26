import { useState } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchReviews, decideReview, type ReviewStatus } from "../api/reviews.js";
import type { ProjectSummary, PendingReview } from "../api/types.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AsyncSection } from "../components/AsyncSection.js";
import { StatusBadge, type BadgeTone } from "../components/StatusBadge.js";
import { RepoBadge } from "../components/RepoBadge.js";
import { relativeTime } from "../lib/time.js";

const STATUSES: ReviewStatus[] = ["pending", "decided", "all"];

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

/**
 * A review card answers, in this order: **what** is being built, **why** it
 * stopped, and **what the requester says** about it.
 *
 * It used to lead with `justification` and show nothing else -- so an admin
 * was shown the argument for letting something through without being shown
 * what it was, who wanted it, or what had blocked it. The question you're
 * actually being asked is "do I want this to happen?", and the card didn't
 * contain enough to answer it.
 *
 * Everything under `review.design` / `.constraints` / `.conflicts` is
 * server-assembled and optional (see the coordinator's review-enrich.ts), so
 * this degrades to the old justification-led rendering against a coordinator
 * that predates the enrichment rather than rendering a blank card.
 */
function ReviewCard({
  review,
  canDecide,
  busy,
  repoBadge,
  onDecide,
}: {
  review: PendingReview;
  canDecide: boolean;
  busy: boolean;
  repoBadge?: React.ReactNode;
  onDecide: (id: string, decision: "approve" | "reject") => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const design = review.design;
  const blockers = review.constraints ?? [];
  const conflicts = review.conflicts ?? [];
  const hasDetail = Boolean(design?.touches.length || design?.creates.length || conflicts.length);

  return (
    <li className={`design-card${expanded ? " expanded" : ""}`}>
      <div className="review-card-inner">
        <div className="card-top-row">
          <span className="review-headline">{design?.summary ?? review.justification}</span>
          <div className="card-badges">
            {repoBadge}
            <StatusBadge label={review.decision ?? "pending"} tone={toneForDecision(review.decision)} />
          </div>
        </div>

        <div className="card-meta">
          {design?.developerId && <span>{design.developerId}</span>}
          <span>{relativeTime(review.createdAt)}</span>
        </div>

        {blockers.length > 0 && (
          <div className="review-band review-band-blocked">
            <span className="review-band-label">Blocked by</span>
            <div>
              {blockers.map((c) => {
                const typeText = constraintTypeText(c.type);
                return (
                  <p key={c.id} className="review-band-line">
                    “{c.statement}”
                    {typeText && <span className="review-band-sub">{typeText}</span>}
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
              {conflicts.map((c) => (
                <p key={`${c.kind}-${c.designId}`} className="review-band-line">
                  {c.summary ?? <span className="review-band-sub">design {c.designId}</span>}
                  <span className="review-band-sub">
                    {c.developerId ? `${c.developerId} · ` : ""}
                    {c.kind === "overlap" ? "same files" : c.kind === "symbol_conflict" ? "same real edits" : "same work, judged by content"}
                  </span>
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Only worth a band of its own once there's something above it to
            contrast against -- on a bare card the headline already is the
            justification, and repeating it reads as a bug. */}
        {design && (
          <div className="review-band review-band-says">
            <span className="review-band-label">They say</span>
            <p className="review-band-line">“{review.justification}”</p>
          </div>
        )}

        {hasDetail && (
          <button type="button" className="review-expand" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? "Hide detail" : "Show detail"}
          </button>
        )}

        {expanded && design && (
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
    </li>
  );
}

/** `POST /v1/reviews/:id/decide` requires that review's *own* project
 * `admin` role server-side (§17.10 hardening) -- a developer can be
 * `admin` in one repo and `member` in another, so "can I decide" is
 * resolved per-review from `projectsById[review.projectId]`, not a single
 * boolean for the whole view (unlike the pre-aggregation version of this
 * component). Hiding the buttons for a `member` is purely UX either way;
 * the server is the real enforcement. */
export function ReviewsView({ projectIds, projectsById }: { projectIds: string[]; projectsById: Record<string, ProjectSummary> }) {
  const apiFetch = useApiFetch();
  const [status, setStatus] = useState<ReviewStatus>("pending");
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a successful decide -- a decided review needs to drop out
  // of the "pending" filter (or pick up its new badge under "decided"/
  // "all"), and useAsyncData has no refetch of its own.
  const [refreshKey, setRefreshKey] = useState(0);

  const state = useAsyncData(
    () => Promise.all(projectIds.map((pid) => fetchReviews(apiFetch, pid, status))).then((lists) => lists.flat().sort((a, b) => b.createdAt - a.createdAt)),
    [apiFetch, projectIds.join(","), status, refreshKey],
  );

  async function decide(id: string, decision: "approve" | "reject") {
    setDecidingId(id);
    setError(null);
    try {
      await decideReview(apiFetch, id, decision);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDecidingId(null);
    }
  }

  const showRepoBadge = projectIds.length > 1;

  return (
    <div className="list-view">
      <div className="filter-bar">
        <select value={status} onChange={(e) => setStatus(e.target.value as ReviewStatus)} aria-label="Filter by status">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="resolve-error" role="alert">
          {error}
        </p>
      )}

      <AsyncSection
        state={state}
        isEmpty={(items) => items.length === 0}
        emptyMessage={status === "pending" ? "Nothing pending review." : "No reviews match this filter."}
        render={(items) => (
          <ul className="card-list">
            {items.map((r) => (
              <ReviewCard
                key={r.id}
                review={r}
                canDecide={projectsById[r.projectId]?.role === "admin"}
                busy={decidingId !== null}
                repoBadge={showRepoBadge ? <RepoBadge project={projectsById[r.projectId] ?? { projectId: r.projectId }} /> : undefined}
                onDecide={decide}
              />
            ))}
          </ul>
        )}
      />
    </div>
  );
}
