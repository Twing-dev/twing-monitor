import { useState } from "react";
import type { ProjectSummary } from "../api/types.js";
import { useApiFetch } from "../api/client.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { fetchReviews } from "../api/reviews.js";
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

function repoLabel(project: ProjectSummary): string {
  return project.githubOwner && project.githubRepo ? `${project.githubOwner}/${project.githubRepo}` : project.projectId;
}

export function RepoDetailLayout({ project, onBack }: { project: ProjectSummary; onBack: () => void }) {
  const apiFetch = useApiFetch();
  const [tab, setTab] = useState<TabId>("designs");
  // A pending review means someone is blocked right now, waiting on a human
  // -- and nothing in twing tells that human. There's no email, webhook or
  // digest anywhere, so an admin only finds out by opening this tab and
  // looking. Surfacing the count on the tab itself is the cheapest possible
  // step toward closing that: you now see it from any tab, without going
  // hunting. Deliberately not gated on `role` -- a member can't decide a
  // review, but knowing the queue is backing up is still worth seeing.
  const pending = useAsyncData(() => fetchReviews(apiFetch, project.projectId, "pending"), [apiFetch, project.projectId]);
  const pendingCount = pending.status === "ready" ? pending.data.length : 0;
  // Set by ActivityView's "View design ->" link -- DesignsView consumes it
  // to force ?status=all (a flagged/closed design wouldn't otherwise be
  // visible under the default "open" filter) and auto-expand that card.
  const [focusDesignId, setFocusDesignId] = useState<string | undefined>(undefined);

  function openDesign(designId: string) {
    setFocusDesignId(designId);
    setTab("designs");
  }

  return (
    <div className="repo-detail-view">
      <header className="view-header">
        <div>
          <button type="button" className="link-button back-link" onClick={onBack}>
            ← All repos
          </button>
          <h1>{repoLabel(project)}</h1>
        </div>
        <span className={`role-badge role-${project.role}`}>{project.role}</span>
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
        {tab === "designs" && <DesignsView projectId={project.projectId} focusDesignId={focusDesignId} onOpenTab={setTab} />}
        {tab === "reviews" && <ReviewsView projectId={project.projectId} canDecide={project.role === "admin"} />}
        {tab === "activity" && <ActivityView projectId={project.projectId} onOpenDesign={openDesign} onOpenTab={setTab} />}
        {tab === "threads" && <AlignmentThreadsView projectId={project.projectId} onOpenDesign={openDesign} />}
        {tab === "members" && <MembersView projectId={project.projectId} />}
        {tab === "constraints" && <ConstraintsView projectId={project.projectId} />}
      </div>
    </div>
  );
}
