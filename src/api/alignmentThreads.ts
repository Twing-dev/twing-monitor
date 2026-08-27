import type { AlignmentThread, AlignmentMessage } from "./types.js";
import type { Fetcher } from "./client.js";

export async function fetchAlignmentThreads(fetcher: Fetcher, projectId: string, status?: "open" | "closed" | "dormant"): Promise<AlignmentThread[]> {
  const qs = new URLSearchParams({ projectId, ...(status ? { status } : {}) });
  const body = await fetcher<{ items: AlignmentThread[] }>(`/v1/alignment-threads?${qs}`);
  return body.items;
}

export async function fetchAlignmentThread(fetcher: Fetcher, threadId: string): Promise<{ thread: AlignmentThread; messages: AlignmentMessage[] }> {
  return fetcher(`/v1/alignment-threads/${threadId}`);
}

/** `POST /v1/alignment-threads/:id/messages` -- party-only server-side
 * (`isThreadParty`, packages/server/src/app.ts), same as every other
 * alignment-thread route. The list this view renders from is already
 * pre-filtered to threads the signed-in developer is a party to, so there's
 * no separate client-side gate needed before offering this. */
export async function postAlignmentMessage(fetcher: Fetcher, threadId: string, message: string): Promise<{ message: AlignmentMessage }> {
  return fetcher<{ message: AlignmentMessage }>(`/v1/alignment-threads/${threadId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

/** `PATCH /v1/alignment-threads/:id/close` -- unilateral by design (§7):
 * either party can close without the other's agreement, this is voluntary
 * reconciliation, not enforcement. */
export async function closeAlignmentThread(fetcher: Fetcher, threadId: string): Promise<{ status?: string }> {
  return fetcher<{ status?: string }>(`/v1/alignment-threads/${threadId}/close`, { method: "PATCH" });
}
