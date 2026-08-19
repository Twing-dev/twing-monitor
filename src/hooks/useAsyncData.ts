import { useEffect, useState, type DependencyList } from "react";

/** Same three-state shape `RepoListView` hand-rolled for itself -- factored
 * out once a second view needed the identical load/error/ready dance,
 * rather than re-copying it six more times. `RepoListView` is left as-is
 * (not migrated) since it already works and is already tested. */
export type AsyncState<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

export function useAsyncData<T>(load: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    load()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
    // `deps` is caller-supplied and intentionally the effect's real
    // dependency list -- `load` itself is a fresh closure every render by
    // design (it captures the current filter/page state), so it's
    // deliberately excluded here rather than added and wrapped in another
    // layer of useCallback at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
