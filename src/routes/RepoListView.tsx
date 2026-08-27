import { useEffect, useState } from "react";
import type { ProjectSummary } from "../api/types.js";
import { useAuth } from "../auth/useAuth.js";
import { repoLabel } from "../lib/repoLabel.js";
import type { ProjectsLoadState } from "../hooks/useProjectsList.js";
import { Mascot } from "../components/Mascot.js";

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

const SELECTION_STORAGE_KEY = "twing-monitor:selectedRepos";

/** Best-effort only -- a viewer with localStorage blocked (private window,
 * cleared site data) just gets "everything selected" every time, same as a
 * first-ever visit, never a broken selection UI. */
function loadStoredSelection(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? new Set(parsed.filter((id): id is string => typeof id === "string")) : null;
  } catch {
    return null;
  }
}

function saveStoredSelection(selected: Set<string>): void {
  try {
    localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(Array.from(selected)));
  } catch {
    // Best-effort persistence -- a viewer's selection just doesn't survive
    // a reload, nothing else depends on this write succeeding.
  }
}

/**
 * `onSelectProject` (an existing card's own click) opens that one repo
 * alone, unchanged from before multi-repo aggregation existed.
 * `onViewAggregate` is the new path: every checked repo, opened together --
 * see RepoDetailLayout, which now always takes a `projects: ProjectSummary[]`
 * and treats a single repo as the `N=1` case of the same view.
 */
export function RepoListView({
  state,
  onSelectProject,
  onViewAggregate,
}: {
  state: ProjectsLoadState;
  onSelectProject: (project: ProjectSummary) => void;
  onViewAggregate: (projects: ProjectSummary[]) => void;
}) {
  const { auth, logout } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (state.status !== "ready") return;
    // Default: every repo checked. A stored selection only ever narrows
    // that default, and only for ids that are still real (dropping a
    // since-removed/inaccessible repo id rather than carrying it forward
    // forever).
    const stored = loadStoredSelection();
    const liveIds = new Set(state.items.map((p) => p.projectId));
    const restored = stored ? new Set(Array.from(stored).filter((id) => liveIds.has(id))) : null;
    setSelected(restored && restored.size > 0 ? restored : liveIds);
  }, [state]);

  function toggle(projectId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      saveStoredSelection(next);
      return next;
    });
  }

  function selectAll(items: ProjectSummary[]) {
    const all = new Set(items.map((p) => p.projectId));
    setSelected(all);
    saveStoredSelection(all);
  }

  function selectNone() {
    setSelected(new Set());
    saveStoredSelection(new Set());
  }

  const items = state.status === "ready" ? state.items : [];
  const selectedItems = items.filter((p) => selected.has(p.projectId));

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
        <div className="empty-state empty-state-figure">
          <Mascot color="#7dd0ac" size={56} />
          <p>
            No repos yet. Run <code>twing init</code> in a project to found or join one on this coordinator.
          </p>
        </div>
      )}

      {state.status === "ready" && state.items.length > 0 && (
        <>
          <div className="repo-select-bar">
            <div className="checkbox-filter-group">
              <button type="button" className="link-button" onClick={() => selectAll(items)}>
                Select all
              </button>
              <button type="button" className="link-button" onClick={selectNone}>
                Select none
              </button>
            </div>
            <button type="button" className="resolve-button" disabled={selectedItems.length === 0} onClick={() => onViewAggregate(selectedItems)}>
              View {selectedItems.length} {selectedItems.length === 1 ? "repo" : "repos"}
            </button>
          </div>

          <ul className="repo-list">
            {items.map((project) => (
              <li key={project.projectId} className="repo-list-item">
                <label className="repo-select-checkbox" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(project.projectId)} onChange={() => toggle(project.projectId)} aria-label={`Include ${repoLabel(project)} in the aggregated view`} />
                </label>
                <button type="button" className="repo-card" onClick={() => onSelectProject(project)}>
                  <div className="repo-card-main">
                    <span className="repo-name">{repoLabel(project)}</span>
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
        </>
      )}
    </div>
  );
}
