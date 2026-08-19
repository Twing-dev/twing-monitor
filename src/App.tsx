import { useState } from "react";
import { ServerProvider } from "./auth/ServerContext.js";
import { useAuth } from "./auth/useAuth.js";
import { LoginScreen } from "./auth/LoginScreen.js";
import { RepoListView } from "./routes/RepoListView.js";
import { RepoDetailLayout } from "./routes/RepoDetailLayout.js";
import type { ProjectSummary } from "./api/types.js";

function AuthGate() {
  const { auth } = useAuth();
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null);

  if (!auth) return <LoginScreen />;
  if (selectedProject) return <RepoDetailLayout project={selectedProject} onBack={() => setSelectedProject(null)} />;
  return <RepoListView onSelectProject={setSelectedProject} />;
}

export default function App() {
  return (
    <ServerProvider>
      <AuthGate />
    </ServerProvider>
  );
}
