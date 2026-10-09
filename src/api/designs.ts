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

/** `PATCH /v1/designs/:id/overview` (2026-10-02) -- the design's owner
 * replaces its title and/or its overview prose, as opposed to `amend`'s
 * `summary`, which the server appends as a dated `Update (date):` entry.
 * Owner-only server-side (403 for anyone else, project admins included), so
 * the caller is expected to have checked ownership before showing the
 * affordance at all; this is the enforcement, not the gate.
 *
 * Omitting a field leaves it untouched. `title: null` is distinct from
 * omitting it -- it *clears* a stored title, reverting to the derived one
 * (`lib/designTitle.ts`). A blank string for either is a 400, not a clear. */
export async function reviseDesignOverview(fetcher: Fetcher, designId: string, body: { title?: string | null; summary?: string }): Promise<{ design: DesignStatement }> {
  return fetcher<{ design: DesignStatement }>(`/v1/designs/${designId}/overview`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/** `POST /v1/designs/:id/resynthesize` (2026-10-06) -- asks the coordinator
 * to fold the design's appended `Update (date):` entries back into one
 * current overview.
 *
 * **Returns the proposal; saves nothing.** The caller puts it in front of the
 * owner, who edits and saves it through `reviseDesignOverview` above like any
 * other edit -- which is what records it as theirs, and what stops the
 * coordinator's automatic path touching that design afterwards.
 *
 * `summary: null` is a 200, not a failure: a design with nothing to fold (or
 * a coordinator with no model configured) has nothing to offer, and the
 * difference between that and an error matters to what the UI says. A
 * coordinator older than this route answers 404 instead -- the server ships
 * before the dashboard, so the caller is expected to say so in words rather
 * than show a bare "Not Found". */
export async function resynthesizeDesignOverview(fetcher: Fetcher, designId: string): Promise<{ summary: string | null; unavailable?: string }> {
  return fetcher<{ summary: string | null; unavailable?: string }>(`/v1/designs/${designId}/resynthesize`, { method: "POST" });
}

/** `GET /v1/designs/:id/group-overview` (2026-10-09) -- one combined
 * overview across every design sharing this one's `groupId`, computed from
 * each member's own overview (and, when available, the conversation that
 * produced it). `overview: null` covers both "not linked to anyone" and "a
 * coordinator with no model configured" -- same honest "nothing to offer"
 * shape `resynthesizeDesignOverview` above uses, not a failure. */
export async function fetchGroupOverview(fetcher: Fetcher, designId: string): Promise<{ overview: string | null }> {
  return fetcher<{ overview: string | null }>(`/v1/designs/${designId}/group-overview`);
}

/** `POST /v1/designs/:id/resynthesize/apply` (2026-10-06) -- saves the
 * proposal the coordinator computed for this design's current state.
 *
 * **Carries no text**, which is the whole reason it exists separately from
 * `reviseDesignOverview`. That route takes arbitrary words and is owner-only;
 * this one can only store what the server itself wrote, so any project member
 * may accept a rephrase without ever being able to put words of their own
 * into someone else's design.
 *
 * 409 when the coordinator has no proposal for the current state -- nobody
 * fetched one, or the design moved underneath it. Ask for a rephrase again
 * and read what comes back. */
export async function applyDesignRephrase(fetcher: Fetcher, designId: string): Promise<{ design: DesignStatement }> {
  return fetcher<{ design: DesignStatement }>(`/v1/designs/${designId}/resynthesize/apply`, { method: "POST" });
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
