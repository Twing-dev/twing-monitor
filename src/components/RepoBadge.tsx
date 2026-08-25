import type { ProjectSummary } from "../api/types.js";
import { repoLabel } from "../lib/repoLabel.js";

/** Labels a card with which repo it belongs to -- only ever rendered by a
 * tab view when it's showing more than one repo at once (`projectIds.length
 * > 1`); a single-repo view never renders this, so the common case stays
 * pixel-identical to before multi-repo aggregation existed. Deliberately a
 * separate component/style from `StatusBadge` rather than
 * `<StatusBadge tone="neutral">` -- `status-badge`'s uppercase transform
 * would mangle a real `owner/repo` name (or a raw `projectId`), so this
 * gets its own non-uppercase, monospace chip instead. */
export function RepoBadge({ project }: { project: Pick<ProjectSummary, "githubOwner" | "githubRepo" | "projectId"> }) {
  return <span className="repo-badge">{repoLabel(project)}</span>;
}
