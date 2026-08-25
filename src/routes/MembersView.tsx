import { useApiFetch } from "../api/client.js";
import { fetchMembers } from "../api/members.js";
import type { ProjectMember, ProjectSummary } from "../api/types.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AsyncSection } from "../components/AsyncSection.js";
import { StatusBadge, type BadgeTone } from "../components/StatusBadge.js";
import { RepoBadge } from "../components/RepoBadge.js";
import { repoLabel } from "../lib/repoLabel.js";

function toneForRole(role: "admin" | "member"): BadgeTone {
  return role === "admin" ? "accent" : "neutral";
}

/** One row per `(developerId, projectId)` pair -- deliberately not
 * deduped by developer alone, since the same developer can be `admin` in
 * one repo and `member` in another and both are worth showing. */
export function MembersView({ projectIds, projectsById }: { projectIds: string[]; projectsById: Record<string, ProjectSummary> }) {
  const apiFetch = useApiFetch();
  const state = useAsyncData(
    () =>
      Promise.all(projectIds.map((pid) => fetchMembers(apiFetch, pid))).then((lists) =>
        lists.flat().sort((a, b) => a.developerId.localeCompare(b.developerId) || repoLabel(projectsById[a.projectId] ?? { projectId: a.projectId }).localeCompare(repoLabel(projectsById[b.projectId] ?? { projectId: b.projectId }))),
      ),
    [apiFetch, projectIds.join(",")],
  );

  const showRepoBadge = projectIds.length > 1;

  return (
    <div className="list-view">
      <AsyncSection
        state={state}
        isEmpty={(items) => items.length === 0}
        emptyMessage="No members found."
        render={(items: ProjectMember[]) => (
          <ul className="card-list">
            {items.map((m) => (
              <li key={`${m.projectId}:${m.developerId}`} className="design-card">
                <div className="card-top-row">
                  <span className="card-summary">{m.developerId}</span>
                  <div className="card-badges">
                    {showRepoBadge && <RepoBadge project={projectsById[m.projectId] ?? { projectId: m.projectId }} />}
                    <StatusBadge label={m.role} tone={toneForRole(m.role)} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      />
    </div>
  );
}
