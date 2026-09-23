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

import type { DesignComment, DesignCommentReply, CommentAuthorKind } from "./types.js";
import type { Fetcher } from "./client.js";

export interface DesignCommentsResponse {
  items: DesignComment[];
  /** Keyed by comment id. Fetched with the comments rather than per comment,
   * so rendering a design's whole discussion is one request. */
  replies: Record<string, DesignCommentReply[]>;
}

/** `GET /v1/designs/:id/comments` -- readable by any project member, any
 * project admin, and the public `/observe` viewer. */
export async function fetchDesignComments(fetcher: Fetcher, designId: string): Promise<DesignCommentsResponse> {
  return fetcher<DesignCommentsResponse>(`/v1/designs/${designId}/comments`);
}

/**
 * `POST /v1/designs/:id/comments`.
 *
 * Returns as soon as the comment is stored -- the coordinator's first-pass
 * answer runs fire-and-forget behind it, so the comment comes back `open` and
 * becomes `answered` a few seconds later. Callers poll rather than wait; that
 * latency is a model call and blocking the reviewer on it would make leaving
 * a comment feel like submitting a form to a slow server.
 */
export async function postDesignComment(
  fetcher: Fetcher,
  designId: string,
  body: string,
  targetChangeId?: string,
): Promise<{ comment: DesignComment }> {
  return fetcher<{ comment: DesignComment }>(`/v1/designs/${designId}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, ...(targetChangeId ? { targetChangeId } : {}) }),
  });
}

/** `POST /v1/comments/:id/replies`. Always `authorKind: "human"` from here --
 * a reply typed into this dashboard is by definition a person's. An agent
 * replies through `twing design comment reply`, which declares `"agent"`. The
 * token cannot tell the two apart, which is why either side has to say. */
export async function postCommentReply(fetcher: Fetcher, commentId: string, message: string): Promise<{ reply: DesignCommentReply }> {
  const authorKind: CommentAuthorKind = "human";
  return fetcher<{ reply: DesignCommentReply }>(`/v1/comments/${commentId}/replies`, {
    method: "POST",
    body: JSON.stringify({ message, authorKind }),
  });
}

/**
 * `POST /v1/comments/:id/escalate` -- the reviewer's decision that the
 * agent's answer wasn't enough.
 *
 * Deliberately a human action with a button behind it, not something the
 * model does on its own confidence. The coordinator's answer carries a
 * recommendation (posted as a `[needs a human]` reply), but acting on it
 * belongs to the person who asked the question: they are the only one who can
 * judge whether their own question was answered.
 *
 * The design's owner sees this as a non-blocking banner at the start of their
 * next Claude Code / Codex / OpenCode session.
 */
export async function escalateComment(fetcher: Fetcher, commentId: string, reason?: string): Promise<{ comment: DesignComment }> {
  return fetcher<{ comment: DesignComment }>(`/v1/comments/${commentId}/escalate`, {
    method: "POST",
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

/** `POST /v1/comments/:id/resolve` -- settled. Distinct from the owner
 * *acknowledging* an escalation, which only clears their session banner and
 * has no button here: acknowledging happens automatically when their agent
 * reads the comment. */
export async function resolveComment(fetcher: Fetcher, commentId: string): Promise<{ comment: DesignComment }> {
  return fetcher<{ comment: DesignComment }>(`/v1/comments/${commentId}/resolve`, { method: "POST" });
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
