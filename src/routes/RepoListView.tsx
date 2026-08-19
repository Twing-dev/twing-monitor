import { useEffect, useState } from "react";
import { useApiFetch } from "../api/client.js";
import type { ProjectSummary } from "../api/types.js";
import { useAuth } from "../auth/useAuth.js";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: ProjectSummary[] };

function relativeTime(ms: number): string {
  const diffMs = Date.now() - ms;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function RepoListView({ onSelectProject }: { onSelectProject: (project: ProjectSummary) => void }) {
  const apiFetch = useApiFetch();
  const { auth, logout } = useAuth();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    apiFetch<{ items: ProjectSummary[] }>("/v1/projects")
      .then((body) => {
        if (!cancelled) setState({ status: "ready", items: body.items });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [apiFetch]);

  return (
    <div className="repo-list-view">
      <header className="view-header">
        <div>
          <h1>Repos</h1>
          <p className="view-subtitle">{auth?.serverUrl}</p>
        </div>
        <button type="button" className="link-button" onClick={logout}>
          Sign out
        </button>
      </header>

      {state.status === "loading" && <p className="empty-state">Loading…</p>}

      {state.status === "error" && (
        <p className="empty-state error" role="alert">
          Couldn't load your repos: {state.message}
        </p>
      )}

      {state.status === "ready" && state.items.length === 0 && (
        <p className="empty-state">
          No repos yet. Run <code>twing init</code> in a project to found or join one on this coordinator.
        </p>
      )}

      {state.status === "ready" && state.items.length > 0 && (
        <ul className="repo-list">
          {state.items.map((project) => (
            <li key={project.projectId}>
              <button type="button" className="repo-card" onClick={() => onSelectProject(project)}>
                <div className="repo-card-main">
                  <span className="repo-name">{project.githubOwner && project.githubRepo ? `${project.githubOwner}/${project.githubRepo}` : project.projectId}</span>
                  <span className={`role-badge role-${project.role}`}>{project.role}</span>
                </div>
                <div className="repo-card-meta">
                  {project.foundedAt !== undefined && <span>founded {relativeTime(project.foundedAt)}</span>}
                  {project.foundedBy && <span>by {project.foundedBy}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
