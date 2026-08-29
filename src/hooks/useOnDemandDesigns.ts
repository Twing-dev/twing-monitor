import { useEffect, useState } from "react";
import type { Fetcher } from "../api/client.js";
import { fetchDesignById } from "../api/designs.js";
import type { DesignStatement } from "../api/types.js";

/** On-demand cache of `DesignStatement`s fetched one id at a time
 * (`GET /v1/designs/:id`, monitor UI load-time fix 2026-08-29) --
 * replaces the old pattern of unconditionally fetching every design in a
 * project just to resolve a handful of specific ids referenced elsewhere
 * (a semantic-overlap counterpart in DesignsView, an alignment thread's
 * linked designs in AlignmentThreadsView). Callers pass exactly the ids
 * they need resolved right now; this only ever fetches what isn't already
 * cached. */
export function useOnDemandDesigns(apiFetch: Fetcher, ids: string[]): Record<string, DesignStatement> {
  const [cache, setCache] = useState<Record<string, DesignStatement>>({});
  const idsKey = ids.join(",");
  useEffect(() => {
    const missing = Array.from(new Set(ids)).filter((id) => !cache[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map((id) =>
        fetchDesignById(apiFetch, id)
          .then((r) => r.design)
          .catch(() => undefined), // best-effort: an inaccessible/deleted design just stays unresolved, not an error state
      ),
    ).then((fetched) => {
      if (cancelled) return;
      setCache((prev) => {
        const next = { ...prev };
        for (const d of fetched) if (d) next[d.id] = d;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // `cache` is read but deliberately not a dependency -- reacting to its
    // own writes would loop; this only needs to re-run when the set of ids
    // being asked for changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch, idsKey]);
  return cache;
}
