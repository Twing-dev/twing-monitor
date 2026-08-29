import type { DesignStatement } from "./types.js";
import type { Fetcher } from "./client.js";

export interface DesignsPage {
  items: DesignStatement[];
  nextBefore?: number;
}

/** Paginated (monitor UI load-time fix, 2026-08-29): GET /v1/designs used to
 * return every design ever registered for a project. Mirrors
 * api/activity.ts's fetchActivity/ActivityPage shape exactly --
 * `{before, limit}` in, `{items, nextBefore}` out. `developerId` is new
 * here: lets DesignsView's "mine only" toggle filter server-side, which
 * pagination requires for correctness (a client-side filter over one page
 * can wrongly look empty while more matching rows sit on later pages). */
export async function fetchDesigns(
  fetcher: Fetcher,
  projectId: string,
  options: { status?: string; sessionId?: string; developerId?: string; before?: number; limit?: number } = {},
): Promise<DesignsPage> {
  const qs = new URLSearchParams({ projectId });
  if (options.status) qs.set("status", options.status);
  if (options.sessionId) qs.set("sessionId", options.sessionId);
  if (options.developerId) qs.set("developerId", options.developerId);
  if (options.before !== undefined) qs.set("before", String(options.before));
  if (options.limit !== undefined) qs.set("limit", String(options.limit));
  return fetcher<DesignsPage>(`/v1/designs?${qs}`);
}

/** GET /v1/designs/:id (monitor UI load-time fix, 2026-08-29) -- resolves
 * one design by id without pulling the whole project's design history.
 * `groupMembers` is every other design sharing this one's `groupId` the
 * caller is authorized to see (server-side filtered, may span projects). */
export async function fetchDesignById(fetcher: Fetcher, id: string): Promise<{ design: DesignStatement; groupMembers: DesignStatement[] }> {
  return fetcher<{ design: DesignStatement; groupMembers: DesignStatement[] }>(`/v1/designs/${id}`);
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
