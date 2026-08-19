import type { ActivityEvent } from "./types.js";
import type { Fetcher } from "./client.js";

export interface ActivityPage {
  items: ActivityEvent[];
  nextBefore?: number;
}

export async function fetchActivity(
  fetcher: Fetcher,
  projectId: string,
  options: { before?: number; limit?: number; kinds?: string[]; developerId?: string; relatedId?: string } = {},
): Promise<ActivityPage> {
  const qs = new URLSearchParams({ projectId });
  if (options.before !== undefined) qs.set("before", String(options.before));
  if (options.limit !== undefined) qs.set("limit", String(options.limit));
  if (options.kinds && options.kinds.length > 0) qs.set("kind", options.kinds.join(","));
  if (options.developerId) qs.set("developerId", options.developerId);
  if (options.relatedId) qs.set("relatedId", options.relatedId);
  return fetcher<ActivityPage>(`/v1/activity?${qs}`);
}
