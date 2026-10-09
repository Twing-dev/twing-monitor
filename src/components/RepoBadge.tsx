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
export function RepoBadge({
  project,
  /** Drop the owner prefix (2026-10-07). Opt-in, so every existing caller
   * keeps the full `owner/repo` it renders today.
   *
   * For a dense list where the badge repeats on every row, the owner is the
   * part that never varies: `twing-dev/` cost ~70px per badge and
   * distinguished nothing, while squeezing the fields beside it. Views that
   * show a badge once -- a detail header, a member panel -- keep the whole
   * thing, since there the owner is the context rather than noise.
   *
   * Only meaningful for a GitHub-bound project; a raw `projectId` has no
   * owner half to drop, so it renders whole either way. */
  short = false,
}: {
  project: Pick<ProjectSummary, "githubOwner" | "githubRepo" | "projectId">;
  short?: boolean;
}) {
  const label = short && project.githubOwner && project.githubRepo ? project.githubRepo : repoLabel(project);
  // The full name stays reachable on hover, since the short form can collide
  // across orgs (two `api` repos under different owners).
  return (
    <span className="repo-badge" title={short ? repoLabel(project) : undefined}>
      {label}
    </span>
  );
}
