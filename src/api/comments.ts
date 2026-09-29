/**
 * Design review comments (2026-09) -- the dashboard's first *write* surface.
 *
 * twing-monitor was deliberately read-only through v1: every server route it
 * needed for approve/reject/resolve already existed, and not calling them was
 * a scoping choice. Comments reverse that for exactly one surface, because a
 * read-only review channel is a contradiction -- there is no way to leave
 * feedback on a design without writing something.
 *
 * Shaped after `api/alignmentThreads.ts`, which is the closest existing
 * thing. The authorization differs in both directions though, and it is worth
 * knowing which way: an alignment thread is party-only (an admin can read it
 * but not speak in it), while a comment is visible and answerable by the
 * whole project, and readable by the public `/observe` viewer, which can
 * write none of it.
 */

import type { CommentAnchor, DesignComment, DesignCommentReply } from "./types.js";
import type { Fetcher } from "./client.js";

export interface DesignCommentsResponse {
  items: DesignComment[];
  /** Keyed by comment id. Fetched with the comments rather than per comment,
   * so rendering a design's whole review is one request. */
  replies: Record<string, DesignCommentReply[]>;
}

/** `GET /v1/designs/:id/comments` -- readable by any project member, any
 * project admin, and the public `/observe` viewer. */
export async function fetchDesignComments(fetcher: Fetcher, designId: string): Promise<DesignCommentsResponse> {
  return fetcher<DesignCommentsResponse>(`/v1/designs/${designId}/comments`);
}

/**
 * `POST /v1/designs/:id/comments`, optionally anchored to highlighted text.
 *
 * The coordinator checks the quote against the design as it reads *now* and
 * answers 409 when the words are gone -- an agent amended the design while
 * the reviewer was reading it. Nothing answers the comment; the design's
 * owner is told it exists and answers it here.
 */
export async function postDesignComment(fetcher: Fetcher, designId: string, body: string, anchor?: CommentAnchor): Promise<{ comment: DesignComment }> {
  return fetcher<{ comment: DesignComment }>(`/v1/designs/${designId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, ...(anchor ? { anchor } : {}) }),
  });
}

/** `POST /v1/comments/:id/replies`. Refused (409) on a resolved comment: a
 * settled question is a new comment, not a reopened one. */
export async function postCommentReply(fetcher: Fetcher, commentId: string, message: string): Promise<{ reply: DesignCommentReply }> {
  return fetcher<{ reply: DesignCommentReply }>(`/v1/comments/${commentId}/replies`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

/**
 * `POST /v1/comments/:id/resolve` -- settled, by the person who asked (or a
 * project admin; the server decides and says so per comment as `canResolve`).
 *
 * Declares `authorKind: "human"` because the server refuses an
 * agent-declared resolve, and a click in this dashboard is by definition a
 * person's.
 */
export async function resolveComment(fetcher: Fetcher, commentId: string): Promise<{ comment: DesignComment }> {
  return fetcher<{ comment: DesignComment }>(`/v1/comments/${commentId}/resolve`, { method: "POST", body: JSON.stringify({ authorKind: "human" }) });
}

/**
 * `GET /v1/designs/comment-counts` -- how many comments each of these designs
 * carries, and how many are still unresolved.
 *
 * Its own request rather than a field on `GET /v1/designs`: that response is
 * also read by the CLI and the Go hook, and widening it to serve one list-view
 * chip would make both of them carry the cost.
 *
 * A design with no comments is **absent from the map**, not a zero. Callers
 * render nothing for it, which is what keeps the list quiet for the ordinary
 * case of a project where most designs were never commented on.
 */
export async function fetchCommentCounts(
  fetcher: Fetcher,
  projectId: string,
  designIds: string[],
): Promise<Record<string, { total: number; unresolved: number }>> {
  if (designIds.length === 0) return {};
  const qs = new URLSearchParams({ projectId, designIds: designIds.join(",") });
  const body = await fetcher<{ counts?: Record<string, { total: number; unresolved: number }> }>(`/v1/designs/comment-counts?${qs}`);
  return body?.counts ?? {};
}
