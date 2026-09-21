import { useApiFetch } from "../api/client.js";
import { fetchReviews } from "../api/reviews.js";
import { fetchAlignmentThreads } from "../api/alignmentThreads.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { buildHotspots } from "../lib/aggregate.js";
import { relativeTime } from "../lib/time.js";

/** Every other view organizes conflicts by developer or by status -- this
 * is the one axis nothing else shows: which *files* keep generating
 * conflicts. A file that's collided more than once is a signal about the
 * code itself (needs splitting up, needs clearer ownership), not just
 * another item to clear from a queue -- so this only surfaces repeats
 * (`count > 1`), not every path any conflict has ever touched (that's what
 * Conflicts' "Collides with"/"Overlapping files" already show, per
 * conflict). Built entirely from `paths`/`symbolIds` fields Reviews and
 * Alignment threads already carry -- no new endpoint, just aggregated by
 * path instead of by conflict (`buildHotspots`, lib/aggregate.ts). */
export function HotspotsView({ projectIds, readOnly }: { projectIds: string[]; readOnly?: boolean }) {
  const apiFetch = useApiFetch();

  const state = useAsyncData(
    () =>
      Promise.all([
        readOnly ? Promise.resolve([]) : Promise.all(projectIds.map((pid) => fetchReviews(apiFetch, pid, "all"))),
        Promise.all(projectIds.map((pid) => fetchAlignmentThreads(apiFetch, pid, {}))),
      ]).then(([reviewPages, threadPages]) => ({
        reviews: reviewPages.flatMap((p) => p.items),
        threads: threadPages.flatMap((p) => p.items),
      })),
    [apiFetch, projectIds.join(","), readOnly],
  );

  if (state.status === "loading") return <p className="empty-state">Loading…</p>;
  if (state.status === "error") {
    return (
      <p className="empty-state error" role="alert">
        Couldn't load: {state.message}
      </p>
    );
  }

  const hotspots = buildHotspots(state.data.reviews, state.data.threads).filter((h) => h.count > 1);

  return (
    <div className="list-view">
      <p className="panel-sub">Files that have collided more than once -- a repeat hotspot is usually worth a closer look at ownership or structure, not just resolving the conflict in front of you.</p>
      {hotspots.length === 0 ? (
        <p className="empty-state">No repeat hotspots -- nothing has collided more than once.</p>
      ) : (
        <ul className="card-list">
          {hotspots.map((h) => (
            <li key={h.path} className="design-card">
              <div className="card-top-row">
                <code className="hotspot-path">{h.path}</code>
                <span className="hotspot-count">
                  {h.count} conflict{h.count === 1 ? "" : "s"}
                </span>
              </div>
              <div className="card-meta">
                <span>{h.developers.join(", ")}</span>
                <span>last {relativeTime(h.lastActivityAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
