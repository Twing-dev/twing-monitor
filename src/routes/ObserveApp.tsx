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
 * `publicProjectIds` auth branch (2026-08-28, generalized from a single
 * `publicProjectId`) scopes this identity to exactly the allowlisted
 * projects, so `GET /v1/projects` naturally returns exactly those and
 * there's nothing to choose between -- `RepoListView` is skipped entirely
 * in favor of handing every returned project straight to
 * `RepoDetailLayout`, reusing its existing multi-repo aggregate view
 * (`projects.length > 1`) rather than building a separate picker for this
 * one page. A single public project still works the same way -- that's
 * just the `projects.length === 1` case of the same component.
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
        Couldn't load the demo project(s): {state.message}
      </p>
    );
  }

  if (state.data.length === 0) {
    // Only reachable if the coordinator's TWING_PUBLIC_PROJECT_IDS is unset
    // or points at project ids that no longer exist -- a deploy
    // misconfiguration, not a state a real visitor's actions can cause.
    return (
      <div className="empty-state empty-state-figure">
        <Mascot color="#7dd0ac" size={56} />
        <p>No public demo project is configured right now.</p>
      </div>
    );
  }

  return <RepoDetailLayout projects={state.data} onBack={() => {}} readOnly />;
}

export function ObserveApp() {
  return (
    <ObserveProvider>
      <ObserveContent />
    </ObserveProvider>
  );
}
