import type { ProjectSummary } from "../api/types.js";

/** `owner/repo` when the project is GitHub-bound, the raw `projectId`
 * otherwise -- extracted out of `RepoListView`/`RepoDetailLayout`, which
 * each had their own copy of this exact ternary, once `RepoBadge` needed a
 * third. Takes a `Pick` rather than the full `ProjectSummary` so a caller
 * building one ad hoc (e.g. from a `DesignStatement`'s `projectId` alone,
 * with no matching `ProjectSummary`) isn't forced to fabricate unrelated
 * fields. */
export function repoLabel(project: Pick<ProjectSummary, "githubOwner" | "githubRepo" | "projectId">): string {
  return project.githubOwner && project.githubRepo ? `${project.githubOwner}/${project.githubRepo}` : project.projectId;
}
