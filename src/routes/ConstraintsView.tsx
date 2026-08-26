import { useApiFetch } from "../api/client.js";
import { fetchConstraints } from "../api/constraints.js";
import type { ProjectSummary } from "../api/types.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AsyncSection } from "../components/AsyncSection.js";
import { RepoBadge } from "../components/RepoBadge.js";
import { relativeTime } from "../lib/time.js";

export function ConstraintsView({ projectIds, projectsById }: { projectIds: string[]; projectsById: Record<string, ProjectSummary> }) {
  const apiFetch = useApiFetch();
  const state = useAsyncData(
    () => Promise.all(projectIds.map((pid) => fetchConstraints(apiFetch, pid))).then((lists) => lists.flat().sort((a, b) => b.createdAt - a.createdAt)),
    [apiFetch, projectIds.join(",")],
  );

  const showRepoBadge = projectIds.length > 1;

  return (
    <div className="list-view">
      <AsyncSection
        state={state}
        isEmpty={(items) => items.length === 0}
        emptyMessage="No constraints registered."
        render={(items) => (
          <ul className="card-list">
            {items.map((c) => (
              <li key={c.id} className="design-card">
                <div className="card-top-row">
                  <span className="card-summary">{c.statement}</span>
                  {/* 2026-08-26 terminology simplification: DesignConstraintType
                      collapsed to a single value, so a per-constraint type badge
                      no longer distinguishes anything -- dropped, same call
                      twing-cli's own `twing constraints list` made (see
                      constraints.ts's list output). */}
                  {showRepoBadge && (
                    <div className="card-badges">
                      <RepoBadge project={projectsById[c.projectId] ?? { projectId: c.projectId }} />
                    </div>
                  )}
                </div>
                <div className="card-meta">
                  <span>{c.scope.join(", ") || "(no scope paths)"}</span>
                  <span>{c.source}</span>
                  <span>{relativeTime(c.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      />
    </div>
  );
}
