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
 * justify the divergence, which only *queues* a review (see
 * `PendingReview`/`decideReview` below) rather than unblocking anything by
 * itself. There's deliberately no third "just dismiss it" option -- the
 * server has none either. */
export type ResolveDesignBody =
  | { resolution: "adopted"; adoptedDesignId: string }
  | { resolution: "justified_divergence"; justification: string };

export interface ResolveDesignResult {
  status?: "superseded" | "pending_review";
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
