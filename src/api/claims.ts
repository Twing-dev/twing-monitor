import type { Claim } from "./types.js";
import type { Fetcher } from "./client.js";

export async function fetchClaims(fetcher: Fetcher, projectId: string, sessionId?: string): Promise<Claim[]> {
  const qs = new URLSearchParams({ projectId, ...(sessionId ? { sessionId } : {}) });
  const body = await fetcher<{ items: Claim[] }>(`/v1/claims?${qs}`);
  return body.items;
}
