import type { ProjectMember } from "./types.js";
import type { Fetcher } from "./client.js";

export async function fetchMembers(fetcher: Fetcher, projectId: string): Promise<ProjectMember[]> {
  const body = await fetcher<{ items: ProjectMember[] }>(`/v1/projects/${projectId}/developers`);
  return body.items;
}
