/**
 * A reviewer's private chat with a design (design review phase 2, 2026-09).
 *
 * Distinct from `api/comments.ts` in who can see it, which is the whole
 * reason it is a separate surface. A comment is a question asked *of the
 * project*: public, answered in the open, escalatable to the developer. A
 * chat is one reviewer working out whether they understand a design, and
 * most of what gets asked there is half-formed by design. Publishing that
 * would make people stop asking.
 *
 * So there is no thread id in this API at all. Both routes address a design,
 * and the server resolves the conversation through the caller's own identity
 * -- which means there is no id with which to request somebody else's. That
 * is deliberate: privacy enforced by the shape of the API rather than by a
 * check that could be forgotten.
 */

import type { DesignChatMessage } from "./types.js";
import type { Fetcher } from "./client.js";

/** `GET /v1/designs/:id/chat` -- this viewer's own conversation. An empty
 * list is the normal first state, not a missing resource. */
export async function fetchDesignChat(fetcher: Fetcher, designId: string): Promise<{ messages: DesignChatMessage[] }> {
  return fetcher<{ messages: DesignChatMessage[] }>(`/v1/designs/${designId}/chat`);
}

/**
 * `POST /v1/designs/:id/chat` -- ask, and wait for the answer.
 *
 * Answered in the response rather than on a later poll, unlike a comment.
 * The difference is what the person is doing: a chat is someone sitting at a
 * prompt, so returning early and making them poll would buy nothing; a
 * comment is left for later, and blocking on a model call to file one would
 * be strange.
 */
export async function postDesignChatMessage(
  fetcher: Fetcher,
  designId: string,
  message: string,
): Promise<{ answer: string; provenance?: string; messages: DesignChatMessage[] }> {
  return fetcher(`/v1/designs/${designId}/chat`, { method: "POST", body: JSON.stringify({ message }) });
}
