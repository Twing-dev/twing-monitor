import { useEffect, useState } from "react";
import type { ProjectSummary } from "../api/types.js";
import { useApiFetch } from "../api/client.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { fetchReviews } from "../api/reviews.js";
import { repoLabel } from "../lib/repoLabel.js";
import { type TabId, parseUrlState, pushUrlState } from "../lib/urlState.js";
import { DesignsView } from "./DesignsView.js";
import { ReviewsView } from "./ReviewsView.js";
import { ActivityView } from "./ActivityView.js";
import { AlignmentThreadsView } from "./AlignmentThreadsView.js";
import { MembersView } from "./MembersView.js";
import { ConstraintsView } from "./ConstraintsView.js";

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
  const [tab, setTab] = useState<TabId>(() => parseUrlState().tab);
  // Set by ActivityView's "View design ->" link, a card's own copy-link
  // URL, or a semantic-overlap jump -- DesignsView consumes it to force
  // ?status=all (a flagged/closed design wouldn't otherwise be visible
  // under the default "open" filter) and auto-expand that card.
  const [focusDesignId, setFocusDesignId] = useState<string | undefined>(() => {
    const u = parseUrlState();
    return u.tab === "designs" ? u.focusId : undefined;
  });
  // Same idea, for a review card's own copy-link URL.
  const [focusReviewId, setFocusReviewId] = useState<string | undefined>(() => {
    const u = parseUrlState();
    return u.tab === "reviews" ? u.focusId : undefined;
  });
  // Same idea, for an alignment-thread card's own copy-link URL.
  const [focusThreadId, setFocusThreadId] = useState<string | undefined>(() => {
    const u = parseUrlState();
    return u.tab === "threads" ? u.focusId : undefined;
  });

  const projectIds = projects.map((p) => p.projectId);

  function focusIdForTab(t: TabId): string | undefined {
    if (t === "designs") return focusDesignId;
    if (t === "reviews") return focusReviewId;
    if (t === "threads") return focusThreadId;
    return undefined;
  }

  function openDesign(designId: string) {
    setFocusDesignId(designId);
    setTab("designs");
    pushUrlState({ repoIds: projectIds, tab: "designs", focusId: designId });
  }

  function openTab(next: TabId) {
    setTab(next);
    pushUrlState({ repoIds: projectIds, tab: next, focusId: focusIdForTab(next) });
  }

  // A dedicated single-card page (DesignsView/ReviewsView/
  // AlignmentThreadsView, when their own focusXId prop is set) offers this
  // as its "back to the full list" link -- drops the focus for the
  // *current* tab only and returns to normal browsing.
  function clearFocus() {
    if (tab === "designs") setFocusDesignId(undefined);
    else if (tab === "reviews") setFocusReviewId(undefined);
    else if (tab === "threads") setFocusThreadId(undefined);
    pushUrlState({ repoIds: projectIds, tab });
  }

  // Browser back/forward within this repo's tabs/focus. A change in which
  // repo(s) are selected instead remounts this whole component (App.tsx
  // keys RepoDetailLayout by the repo-id set), so that case never reaches
  // here.
  useEffect(() => {
    function onPopState() {
      const url = parseUrlState();
      if (url.repoIds.join(",") !== projectIds.join(",")) return;
      setTab(url.tab);
      setFocusDesignId(url.tab === "designs" ? url.focusId : undefined);
      setFocusReviewId(url.tab === "reviews" ? url.focusId : undefined);
      setFocusThreadId(url.tab === "threads" ? url.focusId : undefined);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIds.join(",")]);
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
            onClick={() => openTab(t.id)}
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
        {tab === "designs" && <DesignsView projectIds={projectIds} projectsById={projectsById} focusDesignId={focusDesignId} onClearFocus={clearFocus} onOpenTab={openTab} />}
        {tab === "reviews" && <ReviewsView projectIds={projectIds} projectsById={projectsById} focusReviewId={focusReviewId} onClearFocus={clearFocus} />}
        {tab === "activity" && <ActivityView projectIds={projectIds} projectsById={projectsById} onOpenDesign={openDesign} onOpenTab={openTab} />}
        {tab === "threads" && <AlignmentThreadsView projectIds={projectIds} projectsById={projectsById} onOpenDesign={openDesign} focusThreadId={focusThreadId} onClearFocus={clearFocus} />}
        {tab === "members" && <MembersView projectIds={projectIds} projectsById={projectsById} />}
        {tab === "constraints" && <ConstraintsView projectIds={projectIds} projectsById={projectsById} />}
      </div>
    </div>
  );
}
