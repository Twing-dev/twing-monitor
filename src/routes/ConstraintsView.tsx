import { useApiFetch } from "../api/client.js";
import { fetchConstraints } from "../api/constraints.js";
import type { DesignConstraint } from "../api/types.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AsyncSection } from "../components/AsyncSection.js";
import { StatusBadge, type BadgeTone } from "../components/StatusBadge.js";
import { relativeTime } from "../lib/time.js";

function toneForType(type: DesignConstraint["type"]): BadgeTone {
  return type === "review_required" ? "warning" : "accent";
}

export function ConstraintsView({ projectId }: { projectId: string }) {
  const apiFetch = useApiFetch();
  const state = useAsyncData(() => fetchConstraints(apiFetch, projectId), [apiFetch, projectId]);

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
                  <StatusBadge label={c.type.replace(/_/g, " ")} tone={toneForType(c.type)} />
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
