import { useEffect, useState } from "react";
import { useApiFetch } from "../api/client.js";
import type { ProjectSummary } from "../api/types.js";

export type ProjectsLoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: ProjectSummary[] };

/** Relocated from `RepoListView`'s own fetch effect (same shape, same
 * behavior) so `App.tsx` can resolve a `repos` URL param against the same
 * data without a second `/v1/projects` call. */
export function useProjectsList(): ProjectsLoadState {
  const apiFetch = useApiFetch();
  const [state, setState] = useState<ProjectsLoadState>({ status: "loading" });

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

  return state;
}
