import { ObserveProvider } from "../auth/ObserveContext.js";
import { useApiFetch } from "../api/client.js";
import { fetchProjects } from "../api/projects.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { RepoDetailLayout } from "./RepoDetailLayout.js";
import { Mascot } from "../components/Mascot.js";

/**
 * The unauthenticated `/observe` entry point -- mounted by `App.tsx` in
 * place of `ServerProvider`/`AuthGate` when `window.location.pathname ===
 * "/observe"`. No `LoginScreen`, no repo picker: the coordinator's
 * `publicProjectId` auth branch scopes this identity to exactly one
 * project, so `GET /v1/projects` naturally returns exactly that project
 * and there's nothing to choose between -- `RepoListView` is skipped
 * entirely.
 */
function ObserveContent() {
  const apiFetch = useApiFetch();
  const state = useAsyncData(() => fetchProjects(apiFetch), [apiFetch]);

  if (state.status === "loading") {
    return <p className="empty-state">Loading…</p>;
  }

  if (state.status === "error") {
    return (
      <p className="empty-state error" role="alert">
        Couldn't load the demo project: {state.message}
      </p>
    );
  }

  const project = state.data[0];
  if (!project) {
    // Only reachable if the coordinator's TWING_PUBLIC_PROJECT_ID points at
    // a project id that no longer exists -- a deploy misconfiguration, not
    // a state a real visitor's actions can cause.
    return (
      <div className="empty-state empty-state-figure">
        <Mascot color="#7dd0ac" size={56} />
        <p>No public demo project is configured right now.</p>
      </div>
    );
  }

  return <RepoDetailLayout projects={[project]} onBack={() => {}} readOnly />;
}

export function ObserveApp() {
  return (
    <ObserveProvider>
      <ObserveContent />
    </ObserveProvider>
  );
}
