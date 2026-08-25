import { useState } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchReviews, decideReview, type ReviewStatus } from "../api/reviews.js";
import type { ProjectSummary } from "../api/types.js";
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
            {items.map((r) => {
              const canDecide = projectsById[r.projectId]?.role === "admin";
              return (
                <li key={r.id} className="design-card">
                  <div className="card-top-row">
                    <span className="card-summary">{r.justification}</span>
                    <div className="card-badges">
                      {showRepoBadge && <RepoBadge project={projectsById[r.projectId] ?? { projectId: r.projectId }} />}
                      <StatusBadge label={r.decision ?? "pending"} tone={toneForDecision(r.decision)} />
                    </div>
                  </div>
                  <div className="card-meta">
                    <span>{relativeTime(r.createdAt)}</span>
                    {r.constraintId && <span>constraint waiver</span>}
                    {r.overlapWaivers && r.overlapWaivers.length > 0 && <span>{r.overlapWaivers.length} overlap waiver(s)</span>}
                  </div>
                  {canDecide && !r.decision && (
                    <div className="review-actions">
                      <button
                        type="button"
                        className="resolve-button resolve-approve"
                        disabled={decidingId !== null}
                        onClick={() => decide(r.id, "approve")}
                      >
                        {decidingId === r.id ? "…" : "Approve"}
                      </button>
                      <button
                        type="button"
                        className="resolve-button resolve-reject"
                        disabled={decidingId !== null}
                        onClick={() => decide(r.id, "reject")}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      />
    </div>
  );
}
