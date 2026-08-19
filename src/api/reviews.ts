import type { PendingReview } from "./types.js";
import type { Fetcher } from "./client.js";

export type ReviewStatus = "pending" | "decided" | "all";

export async function fetchReviews(fetcher: Fetcher, projectId: string, status: ReviewStatus = "pending"): Promise<PendingReview[]> {
  const qs = new URLSearchParams({ projectId, status });
  const body = await fetcher<{ items: PendingReview[] }>(`/v1/reviews?${qs}`);
  return body.items;
}

/** `POST /v1/reviews/:id/decide` (packages/server/src/app.ts) -- requires
 * that review's project `admin` role server-side (§17.10); the caller is
 * responsible for not showing this to a non-admin, same as ReviewsView
 * gating on `project.role`. */
export async function decideReview(fetcher: Fetcher, reviewId: string, decision: "approve" | "reject"): Promise<{ review: PendingReview }> {
  return fetcher<{ review: PendingReview }>(`/v1/reviews/${reviewId}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}
