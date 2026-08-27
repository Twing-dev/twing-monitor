import { useEffect, useRef, useState } from "react";
import { ServerProvider } from "./auth/ServerContext.js";
import { useAuth } from "./auth/useAuth.js";
import { LoginScreen } from "./auth/LoginScreen.js";
import { RepoListView } from "./routes/RepoListView.js";
import { RepoDetailLayout } from "./routes/RepoDetailLayout.js";
import { useProjectsList } from "./hooks/useProjectsList.js";
import { parseUrlState, pushUrlState, replaceUrlState } from "./lib/urlState.js";
import type { ProjectSummary } from "./api/types.js";

function AuthGate() {
  const { auth } = useAuth();
  const projectsState = useProjectsList();
  // `detail`'s `projects` covers both the single-repo click-through and
  // the new multi-repo aggregated view -- RepoDetailLayout treats a
  // one-element array as the same thing as any other, see its own doc
  // comment.
  const [view, setView] = useState<{ mode: "list" } | { mode: "detail"; projects: ProjectSummary[] }>({ mode: "list" });
  const restoredRef = useRef(false);

  // Restore from a pasted URL once the project list is known. Runs once --
  // afterwards, navigation drives `view` directly and popstate (below)
  // handles the browser back/forward case.
  useEffect(() => {
    if (restoredRef.current || projectsState.status !== "ready") return;
    restoredRef.current = true;
    const url = parseUrlState();
    if (url.repoIds.length === 0) return;
    const byId = new Map(projectsState.items.map((p) => [p.projectId, p]));
    const matched = url.repoIds.map((id) => byId.get(id)).filter((p): p is ProjectSummary => Boolean(p));
    if (matched.length === 0) {
      // Named repo(s) not found / no longer accessible -- fall back to the
      // list view rather than erroring, and drop the dead reference.
      replaceUrlState({ repoIds: [], tab: "designs" });
      return;
    }
    setView({ mode: "detail", projects: matched });
    if (matched.length !== url.repoIds.length) {
      replaceUrlState({ repoIds: matched.map((p) => p.projectId), tab: url.tab, focusId: url.focusId });
    }
  }, [projectsState]);

  // Handles the list<->detail boundary and switching between different repo
  // selections. Tab/focus changes within an already-mounted detail view are
  // RepoDetailLayout's own popstate listener's job -- it already has the
  // resolved ProjectSummary objects and needs no fetch to react.
  useEffect(() => {
    function onPopState() {
      if (projectsState.status !== "ready") return;
      const url = parseUrlState();
      if (url.repoIds.length === 0) {
        setView({ mode: "list" });
        return;
      }
      const byId = new Map(projectsState.items.map((p) => [p.projectId, p]));
      const matched = url.repoIds.map((id) => byId.get(id)).filter((p): p is ProjectSummary => Boolean(p));
      setView(matched.length > 0 ? { mode: "detail", projects: matched } : { mode: "list" });
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [projectsState]);

  if (!auth) return <LoginScreen />;
  if (view.mode === "detail") {
    return (
      <RepoDetailLayout
        key={view.projects.map((p) => p.projectId).join(",")}
        projects={view.projects}
        onBack={() => {
          pushUrlState({ repoIds: [], tab: "designs" });
          setView({ mode: "list" });
        }}
      />
    );
  }
  return (
    <RepoListView
      state={projectsState}
      onSelectProject={(project) => {
        pushUrlState({ repoIds: [project.projectId], tab: "designs" });
        setView({ mode: "detail", projects: [project] });
      }}
      onViewAggregate={(projects) => {
        pushUrlState({ repoIds: projects.map((p) => p.projectId), tab: "designs" });
        setView({ mode: "detail", projects });
      }}
    />
  );
}

export default function App() {
  return (
    <ServerProvider>
      <AuthGate />
    </ServerProvider>
  );
}
