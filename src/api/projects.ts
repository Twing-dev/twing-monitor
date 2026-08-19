import type { ProjectSummary } from "./types.js";
import type { Fetcher } from "./client.js";

export async function fetchProjects(fetcher: Fetcher): Promise<ProjectSummary[]> {
  const body = await fetcher<{ items: ProjectSummary[] }>("/v1/projects");
  return body.items;
}
