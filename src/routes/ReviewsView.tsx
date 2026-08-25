import { useState } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchReviews, decideReview, type ReviewStatus } from "../api/reviews.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AsyncSection } from "../components/AsyncSection.js";
import { StatusBadge, type BadgeTone } from "../components/StatusBadge.js";
import { relativeTime } from "../lib/time.js";
import type { PendingReview } from "../api/types.js";

const STATUSES: ReviewStatus[] = ["pending", "decided", "all"];

function toneForDecision(decision?: "approve" | "reject"): BadgeTone {
  if (decision === "approve") return "good";
  if (decision === "reject") return "critical";
  return "warning";
}

/** The machine names for a constraint type say nothing to someone who has
 * never opened `.twing/twing.yml`. Mirrors the same translation the CLI's
 * deny messages make (`hook/design_gate.go`'s constraintTypeText). */
function constraintTypeText(type: string): string {
  switch (type) {
    case "review_required":
      return "a human must review changes here";
    case "canonical_abstraction":
      return "use the existing approach, don't add a second one";
    case "domain_fact":
      return "a fact about this codebase you shouldn't contradict";
    default:
      return type;
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
  onDecide,
}: {
  review: PendingReview;
  canDecide: boolean;
  busy: boolean;
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
          <span className="review-headline">
            {design?.summary ?? review.justification}
          </span>
          <StatusBadge label={review.decision ?? "pending"} tone={toneForDecision(review.decision)} />
        </div>

        <div className="card-meta">
          {design?.developerId && <span>{design.developerId}</span>}
          <span>{relativeTime(review.createdAt)}</span>
        </div>

        {blockers.length > 0 && (
          <div className="review-band review-band-blocked">
            <span className="review-band-label">Blocked by</span>
            <div>
              {blockers.map((c) => (
                <p key={c.id} className="review-band-line">
                  “{c.statement}”
                  <span className="review-band-sub">{constraintTypeText(c.type)}</span>
                </p>
              ))}
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
                    {c.kind === "overlap" ? "same files" : "same work, judged by content"}
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

/** `canDecide` gates the Approve/Reject buttons -- `POST
 * /v1/reviews/:id/decide` requires that review's project `admin` role
 * server-side (§17.10 hardening), so a `member` would just get a 403 back;
 * hiding the buttons for them is purely UX, the server is the real
 * enforcement either way. */
export function ReviewsView({ projectId, canDecide }: { projectId: string; canDecide: boolean }) {
  const apiFetch = useApiFetch();
  const [status, setStatus] = useState<ReviewStatus>("pending");
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a successful decide -- a decided review needs to drop out
  // of the "pending" filter (or pick up its new badge under "decided"/
  // "all"), and useAsyncData has no refetch of its own.
  const [refreshKey, setRefreshKey] = useState(0);

  const state = useAsyncData(() => fetchReviews(apiFetch, projectId, status), [apiFetch, projectId, status, refreshKey]);

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
                canDecide={canDecide}
                busy={decidingId !== null}
                onDecide={decide}
              />
            ))}
          </ul>
        )}
      />
    </div>
  );
}
