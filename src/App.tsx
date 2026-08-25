import { useState } from "react";
import { ServerProvider } from "./auth/ServerContext.js";
import { useAuth } from "./auth/useAuth.js";
import { LoginScreen } from "./auth/LoginScreen.js";
import { RepoListView } from "./routes/RepoListView.js";
import { RepoDetailLayout } from "./routes/RepoDetailLayout.js";
import type { ProjectSummary } from "./api/types.js";

function AuthGate() {
  const { auth } = useAuth();
  // `detail`'s `projects` covers both the single-repo click-through and
  // the new multi-repo aggregated view -- RepoDetailLayout treats a
  // one-element array as the same thing as any other, see its own doc
  // comment.
  const [view, setView] = useState<{ mode: "list" } | { mode: "detail"; projects: ProjectSummary[] }>({ mode: "list" });

  if (!auth) return <LoginScreen />;
  if (view.mode === "detail") return <RepoDetailLayout projects={view.projects} onBack={() => setView({ mode: "list" })} />;
  return (
    <RepoListView
      onSelectProject={(project) => setView({ mode: "detail", projects: [project] })}
      onViewAggregate={(projects) => setView({ mode: "detail", projects })}
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
