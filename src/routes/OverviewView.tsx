import { useApiFetch } from "../api/client.js";
import { fetchDesigns } from "../api/designs.js";
import { fetchReviews } from "../api/reviews.js";
import { fetchAlignmentThreads } from "../api/alignmentThreads.js";
import { fetchMembers } from "../api/members.js";
import { fetchActivity } from "../api/activity.js";
import type { ProjectSummary } from "../api/types.js";
import type { TabId } from "../lib/urlState.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { buildConflictItems, summarizeOverview } from "../lib/aggregate.js";
import { formatActivityEvent } from "../lib/activityFormat.js";
import { relativeTime } from "../lib/time.js";
import { RepoBadge } from "../components/RepoBadge.js";
import { stageBadgeText } from "./ConflictsView.js";

/** The landing page (2026-09): every KPI here is a count over a list some
 * other tab already fetches in full -- no new endpoint, just a reduction
 * (`summarizeOverview`/`buildConflictItems`, lib/aggregate.ts). Exists to
 * answer "what's happening here" without opening any tab, which nothing in
 * the previous flat six-tab layout could do. */
export function OverviewView({
  projectIds,
  projectsById,
  readOnly,
  onOpenTab,
}: {
  projectIds: string[];
  projectsById: Record<string, ProjectSummary>;
  readOnly?: boolean;
  onOpenTab: (tab: TabId) => void;
}) {
  const apiFetch = useApiFetch();

  const state = useAsyncData(
    () =>
      Promise.all([
        Promise.all(projectIds.map((pid) => fetchDesigns(apiFetch, pid, { status: "open" }))),
        Promise.all(projectIds.map((pid) => fetchDesigns(apiFetch, pid, { status: "flagged" }))),
        readOnly ? Promise.resolve([]) : Promise.all(projectIds.map((pid) => fetchReviews(apiFetch, pid, "pending"))),
        Promise.all(projectIds.map((pid) => fetchAlignmentThreads(apiFetch, pid, { status: "open" }))),
        readOnly ? Promise.resolve([]) : Promise.all(projectIds.map((pid) => fetchMembers(apiFetch, pid))),
        Promise.all(projectIds.map((pid) => fetchActivity(apiFetch, pid, { limit: 5 }))),
      ]).then(([openPages, flaggedPages, reviewPages, threadPages, memberLists, activityPages]) => ({
        openDesigns: openPages.flatMap((p) => p.items),
        flaggedDesigns: flaggedPages.flatMap((p) => p.items),
        pendingReviews: reviewPages.flatMap((p) => p.items),
        openThreads: threadPages.flatMap((p) => p.items),
        members: memberLists.flat(),
        recentActivity: activityPages
          .flatMap((p) => p.items)
          .sort((a, b) => b.ts - a.ts)
          .slice(0, 5),
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

  const { openDesigns, flaggedDesigns, pendingReviews, openThreads, members, recentActivity } = state.data;
  const summary = summarizeOverview(openDesigns, flaggedDesigns, pendingReviews, members);
  const attention = buildConflictItems(pendingReviews, openThreads).slice(0, 5);
  const showRepoBadge = projectIds.length > 1;

  return (
    <div className="list-view">
      <div className="kpi-row">
        <div className="kpi-tile tone-neutral">
          <div className="kpi-num">{summary.activeWork}</div>
          <div className="kpi-label">Active work items</div>
        </div>
        <div className={`kpi-tile ${summary.conflictsBlocking > 0 ? "tone-critical" : "tone-good"}`}>
          <div className="kpi-num">{summary.conflictsBlocking}</div>
          <div className="kpi-label">Conflicts blocking someone</div>
        </div>
        {!readOnly && (
          <div className={`kpi-tile ${summary.pendingApprovals > 0 ? "tone-warning" : "tone-good"}`}>
            <div className="kpi-num">{summary.pendingApprovals}</div>
            <div className="kpi-label">Awaiting admin approval</div>
          </div>
        )}
        {!readOnly && (
          <div className="kpi-tile tone-neutral">
            <div className="kpi-num">{summary.teamMembers}</div>
            <div className="kpi-label">Team members</div>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Needs attention</h2>
          <button type="button" className="see-all" onClick={() => onOpenTab("conflicts")}>
            View all conflicts →
          </button>
        </div>
        <p className="panel-sub">Two developers' work is colliding, or something is waiting on a decision.</p>
        {attention.length === 0 ? (
          <p className="empty-state">Nothing needs attention right now.</p>
        ) : (
          <ul className="preview-list">
            {attention.map((item) => {
              const id = item.kind === "review" ? item.review.id : item.thread.id;
              const projectId = item.kind === "review" ? item.review.projectId : item.thread.projectId;
              const summaryText = item.kind === "review" ? item.review.design?.summary ?? item.review.justification : item.thread.summary ?? item.thread.systemDescription;
              const who = item.kind === "review" ? item.review.design?.developerId : `${item.thread.developerId} & ${item.thread.otherDeveloperId}`;
              return (
                <li key={id}>
                  <button type="button" className="preview-row" onClick={() => onOpenTab("conflicts")}>
                    <span className="preview-summary">
                      {showRepoBadge && <RepoBadge project={projectsById[projectId] ?? { projectId }} />}
                      {summaryText}
                    </span>
                    <span className="preview-meta">
                      {who && <span>{who}</span>}
                      <span>{stageBadgeText(item.stage)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Recent history</h2>
          <button type="button" className="see-all" onClick={() => onOpenTab("activity")}>
            View full history →
          </button>
        </div>
        {recentActivity.length === 0 ? (
          <p className="empty-state">No activity yet.</p>
        ) : (
          <ul className="preview-list">
            {recentActivity.map((event) => {
              const formatted = formatActivityEvent(event);
              return (
                <li key={event.id} className="preview-row preview-row-static">
                  <span className="preview-summary">
                    {showRepoBadge && <RepoBadge project={projectsById[event.projectId] ?? { projectId: event.projectId }} />}
                    {formatted.label}
                  </span>
                  <span className="preview-meta">
                    {event.developerId && <span>{event.developerId}</span>}
                    <span>{relativeTime(event.ts)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
