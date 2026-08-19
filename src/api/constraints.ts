import type { DesignConstraint } from "./types.js";
import type { Fetcher } from "./client.js";

export async function fetchConstraints(fetcher: Fetcher, projectId: string): Promise<DesignConstraint[]> {
  const qs = new URLSearchParams({ projectId });
  const body = await fetcher<{ items: DesignConstraint[] }>(`/v1/constraints?${qs}`);
  return body.items;
}
