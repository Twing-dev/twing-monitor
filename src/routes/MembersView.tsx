import { useApiFetch } from "../api/client.js";
import { fetchMembers } from "../api/members.js";
import type { ProjectMember, ProjectSummary } from "../api/types.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AsyncSection } from "../components/AsyncSection.js";
import { StatusBadge, type BadgeTone } from "../components/StatusBadge.js";
import { dedupeMembersByDeveloper } from "../lib/aggregate.js";
import { repoLabel } from "../lib/repoLabel.js";

function toneForRole(role: "admin" | "member"): BadgeTone {
  return role === "admin" ? "accent" : "neutral";
}

/** One row per developer -- `dedupeMembersByDeveloper` collapses however
 * many of the selected repos they belong to into that developer's own
 * `memberships`, each rendered as its own repo/role chip (a developer can
 * be `admin` in one repo and `member` in another, so these aren't
 * collapsed further). A single-repo view has at most one membership per
 * developer already, so this renders identically to before aggregation
 * existed. */
export function MembersView({ projectIds, projectsById }: { projectIds: string[]; projectsById: Record<string, ProjectSummary> }) {
  const apiFetch = useApiFetch();
  const state = useAsyncData(
    () => Promise.all(projectIds.map((pid) => fetchMembers(apiFetch, pid))).then((lists) => lists.flat()),
    [apiFetch, projectIds.join(",")],
  );

  const showRepoLabel = projectIds.length > 1;

  return (
    <div className="list-view">
      <AsyncSection
        state={state}
        isEmpty={(items) => items.length === 0}
        emptyMessage="No members found."
        render={(items: ProjectMember[]) => {
          const developers = dedupeMembersByDeveloper(items);
          return (
            <ul className="card-list">
              {developers.map((dev) => {
                const sorted = [...dev.memberships].sort((a, b) =>
                  repoLabel(projectsById[a.projectId] ?? { projectId: a.projectId }).localeCompare(repoLabel(projectsById[b.projectId] ?? { projectId: b.projectId })),
                );
                return (
                  <li key={dev.developerId} className="design-card">
                    <div className="card-top-row">
                      <span className="card-summary">{dev.developerId}</span>
                      <div className="card-badges">
                        {sorted.map((m) =>
                          showRepoLabel ? (
                            <span key={m.projectId} className="repo-badge">
                              {repoLabel(projectsById[m.projectId] ?? { projectId: m.projectId })} · {m.role}
                            </span>
                          ) : (
                            <StatusBadge key={m.projectId} label={m.role} tone={toneForRole(m.role)} />
                          ),
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          );
        }}
      />
    </div>
  );
}
