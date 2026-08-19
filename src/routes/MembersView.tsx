import { useApiFetch } from "../api/client.js";
import { fetchMembers } from "../api/members.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AsyncSection } from "../components/AsyncSection.js";
import { StatusBadge, type BadgeTone } from "../components/StatusBadge.js";

function toneForRole(role: "admin" | "member"): BadgeTone {
  return role === "admin" ? "accent" : "neutral";
}

export function MembersView({ projectId }: { projectId: string }) {
  const apiFetch = useApiFetch();
  const state = useAsyncData(() => fetchMembers(apiFetch, projectId), [apiFetch, projectId]);

  return (
    <div className="list-view">
      <AsyncSection
        state={state}
        isEmpty={(items) => items.length === 0}
        emptyMessage="No members found."
        render={(items) => (
          <ul className="card-list">
            {items.map((m) => (
              <li key={m.developerId} className="design-card">
                <div className="card-top-row">
                  <span className="card-summary">{m.developerId}</span>
                  <StatusBadge label={m.role} tone={toneForRole(m.role)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      />
    </div>
  );
}
