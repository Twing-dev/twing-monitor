import { useApiFetch } from "../api/client.js";
import { fetchConstraints } from "../api/constraints.js";
import type { DesignConstraint, ProjectSummary } from "../api/types.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AsyncSection } from "../components/AsyncSection.js";
import { StatusBadge, type BadgeTone } from "../components/StatusBadge.js";
import { RepoBadge } from "../components/RepoBadge.js";
import { relativeTime } from "../lib/time.js";

function toneForType(type: DesignConstraint["type"]): BadgeTone {
  return type === "review_required" ? "warning" : "accent";
}

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
                  <div className="card-badges">
                    {showRepoBadge && <RepoBadge project={projectsById[c.projectId] ?? { projectId: c.projectId }} />}
                    <StatusBadge label={c.type.replace(/_/g, " ")} tone={toneForType(c.type)} />
                  </div>
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
