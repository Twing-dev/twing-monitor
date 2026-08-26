import type { DesignStatement } from "./types.js";
import type { Fetcher } from "./client.js";

export async function fetchDesigns(fetcher: Fetcher, projectId: string, status?: string): Promise<DesignStatement[]> {
  const qs = new URLSearchParams({ projectId, ...(status ? { status } : {}) });
  const body = await fetcher<{ items: DesignStatement[] }>(`/v1/designs?${qs}`);
  return body.items;
}

/** Mirrors packages/server/src/app.ts's `POST /v1/designs/:id/resolve` body
 * (`ResolveRequestBody`) -- the two ways a flagged design gets addressed
 * (§17.5): supersede it in favor of the design it conflicts with, or
 * justify the divergence, which either self-clears immediately or *queues*
 * a review (see `PendingReview`/`decideReview` below), depending on what it
 * carries -- see `ResolveDesignResult.status`'s own doc comment. There's
 * deliberately no third "just dismiss it" option -- the server has none
 * either. */
export type ResolveDesignBody =
  | { resolution: "adopted"; adoptedDesignId: string }
  | { resolution: "justified_divergence"; justification: string };

export interface ResolveDesignResult {
  /** `"resolved"` (2026-08-26 self-approve): a justified_divergence that
   * carries zero constraint hits -- `symbol_conflict`/`llm_divergence`
   * alone, never `constraint_violation` -- auto-decides "approve" in the
   * same request and reopens the design immediately, no admin involved.
   * Any constraint hit in the mix (even bundled with other waiver kinds)
   * keeps it `"pending_review"`, same as before this change -- that's
   * someone else's rule to waive, not the flagged developer's own. */
  status?: "superseded" | "resolved" | "pending_review";
  adoptedDesignId?: string;
  reviewId?: string;
  error?: string;
}

export async function resolveDesign(fetcher: Fetcher, designId: string, body: ResolveDesignBody): Promise<ResolveDesignResult> {
  return fetcher<ResolveDesignResult>(`/v1/designs/${designId}/resolve`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
