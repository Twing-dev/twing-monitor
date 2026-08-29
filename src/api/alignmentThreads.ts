import type { AlignmentThread, AlignmentMessage } from "./types.js";
import type { Fetcher } from "./client.js";

export interface AlignmentThreadsPage {
  items: AlignmentThread[];
  nextBefore?: number;
}

/** Paginated (monitor UI load-time fix, 2026-08-29): mirrors
 * api/activity.ts's fetchActivity/ActivityPage shape. `nextBefore` cursors
 * on the server's COALESCE(lastActivityAt, openedAt) ordering. */
export async function fetchAlignmentThreads(
  fetcher: Fetcher,
  projectId: string,
  options: { status?: "open" | "closed" | "dormant"; before?: number; limit?: number } = {},
): Promise<AlignmentThreadsPage> {
  const qs = new URLSearchParams({ projectId });
  if (options.status) qs.set("status", options.status);
  if (options.before !== undefined) qs.set("before", String(options.before));
  if (options.limit !== undefined) qs.set("limit", String(options.limit));
  return fetcher<AlignmentThreadsPage>(`/v1/alignment-threads?${qs}`);
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
