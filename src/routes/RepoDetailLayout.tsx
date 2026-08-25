import { useState } from "react";
import type { ProjectSummary } from "../api/types.js";
import { useApiFetch } from "../api/client.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { fetchReviews } from "../api/reviews.js";
import { repoLabel } from "../lib/repoLabel.js";
import { DesignsView } from "./DesignsView.js";
import { ReviewsView } from "./ReviewsView.js";
import { ActivityView } from "./ActivityView.js";
import { AlignmentThreadsView } from "./AlignmentThreadsView.js";
import { MembersView } from "./MembersView.js";
import { ConstraintsView } from "./ConstraintsView.js";

type TabId = "designs" | "reviews" | "activity" | "threads" | "members" | "constraints";

const TABS: { id: TabId; label: string }[] = [
  { id: "designs", label: "Designs" },
  { id: "reviews", label: "Reviews" },
  { id: "activity", label: "Activity" },
  { id: "threads", label: "Alignment threads" },
  { id: "members", label: "Members" },
  { id: "constraints", label: "Constraints" },
];

/**
 * A single repo's tab view is the `projects.length === 1` case of the same
 * component that renders a multi-repo aggregated view -- every tab view
 * below takes `projectIds`/`projectsById` regardless of how many repos are
 * in scope, so there's exactly one code path instead of a
 * single-repo/aggregate pair that can drift apart. Only this layout's own
 * header branches on the count.
 */
export function RepoDetailLayout({ projects, onBack }: { projects: ProjectSummary[]; onBack: () => void }) {
  const apiFetch = useApiFetch();
  const [tab, setTab] = useState<TabId>("designs");
  // Set by ActivityView's "View design ->" link -- DesignsView consumes it
  // to force ?status=all (a flagged/closed design wouldn't otherwise be
  // visible under the default "open" filter) and auto-expand that card.
  const [focusDesignId, setFocusDesignId] = useState<string | undefined>(undefined);

  function openDesign(designId: string) {
    setFocusDesignId(designId);
    setTab("designs");
  }

  const projectIds = projects.map((p) => p.projectId);
  // A pending review means someone is blocked right now, waiting on a
  // human -- and nothing in twing tells that human. There's no email,
  // webhook or digest anywhere, so an admin only finds out by opening this
  // tab and looking. Surfacing the count on the tab itself is the cheapest
  // step toward closing that: a queue building up is visible from any tab.
  // Summed across every selected repo, matching what the Reviews tab
  // itself shows in the aggregated view. Deliberately not gated on role --
  // a member can't decide a review, but knowing the queue is backing up is
  // still worth seeing.
  const pending = useAsyncData(
    () => Promise.all(projectIds.map((pid) => fetchReviews(apiFetch, pid, "pending"))).then((lists) => lists.flat()),
    [apiFetch, projectIds.join(",")],
  );
  const pendingCount = pending.status === "ready" ? pending.data.length : 0;
  const projectsById: Record<string, ProjectSummary> = Object.fromEntries(projects.map((p) => [p.projectId, p]));
  const single = projects.length === 1 ? projects[0] : undefined;

  return (
    <div className="repo-detail-view">
      <header className="view-header">
        <div>
          <button type="button" className="link-button back-link" onClick={onBack}>
            ← All repos
          </button>
          {single ? (
            <h1>{repoLabel(single)}</h1>
          ) : (
            <>
              <h1>{projects.length} repos</h1>
              <div className="repo-chip-row">
                {projects.map((p) => (
                  <span key={p.projectId} className="repo-chip">
                    {repoLabel(p)}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
        {single && <span className={`role-badge role-${single.role}`}>{single.role}</span>}
      </header>

      <nav className="tab-bar" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`tab-button${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "reviews" && pendingCount > 0 && (
              <span className="tab-count" aria-label={`${pendingCount} waiting for a decision`}>
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="tab-panel">
        {tab === "designs" && <DesignsView projectIds={projectIds} projectsById={projectsById} focusDesignId={focusDesignId} onOpenTab={setTab} />}
        {tab === "reviews" && <ReviewsView projectIds={projectIds} projectsById={projectsById} />}
        {tab === "activity" && <ActivityView projectIds={projectIds} projectsById={projectsById} onOpenDesign={openDesign} onOpenTab={setTab} />}
        {tab === "threads" && <AlignmentThreadsView projectIds={projectIds} projectsById={projectsById} onOpenDesign={openDesign} />}
        {tab === "members" && <MembersView projectIds={projectIds} projectsById={projectsById} />}
        {tab === "constraints" && <ConstraintsView projectIds={projectIds} projectsById={projectsById} />}
      </div>
    </div>
  );
}
