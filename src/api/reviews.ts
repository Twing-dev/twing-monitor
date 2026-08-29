import type { PendingReview } from "./types.js";
import type { Fetcher } from "./client.js";

export type ReviewStatus = "pending" | "decided" | "all";

export interface ReviewsPage {
  items: PendingReview[];
  nextBefore?: number;
}

/** Paginated (monitor UI load-time fix, 2026-08-29): mirrors
 * api/activity.ts's fetchActivity/ActivityPage shape. */
export async function fetchReviews(
  fetcher: Fetcher,
  projectId: string,
  status: ReviewStatus = "pending",
  options: { before?: number; limit?: number } = {},
): Promise<ReviewsPage> {
  const qs = new URLSearchParams({ projectId, status });
  if (options.before !== undefined) qs.set("before", String(options.before));
  if (options.limit !== undefined) qs.set("limit", String(options.limit));
  return fetcher<ReviewsPage>(`/v1/reviews?${qs}`);
}

/** GET /v1/reviews/:id (monitor UI load-time fix, 2026-08-29) -- resolves
 * one review by id (e.g. for ReviewFocusedPage) without pulling the whole
 * project's review history. 404s for the public viewer, same as the list
 * route. */
export async function fetchReviewById(fetcher: Fetcher, id: string): Promise<{ item: PendingReview }> {
  return fetcher<{ item: PendingReview }>(`/v1/reviews/${id}`);
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
