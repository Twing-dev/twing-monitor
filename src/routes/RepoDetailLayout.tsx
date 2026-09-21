import { useEffect, useState } from "react";
import type { ProjectSummary } from "../api/types.js";
import { useApiFetch } from "../api/client.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { fetchReviews } from "../api/reviews.js";
import { fetchAlignmentThreads } from "../api/alignmentThreads.js";
import { repoLabel } from "../lib/repoLabel.js";
import { type TabId, parseUrlState, pushUrlState } from "../lib/urlState.js";
import { OverviewView } from "./OverviewView.js";
import { DesignsView } from "./DesignsView.js";
import { ConflictsView } from "./ConflictsView.js";
import { HotspotsView } from "./HotspotsView.js";
import { ActivityView } from "./ActivityView.js";
import { MembersView } from "./MembersView.js";
import { ConstraintsView } from "./ConstraintsView.js";

/** 2026-09 revamp: a dark sidebar replacing the old top tab bar (scales
 * better as a landmark than a horizontal bar, and reads as more deliberate
 * for a tool people are meant to check regularly -- see the redesign plan
 * for the research this followed). "Live" is what changes as agents work;
 * "Settings" is static/config info that doesn't belong at the same visual
 * weight as live conflict data. */
const LIVE_NAV: { id: TabId; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "◆" },
  { id: "designs", label: "Work in progress", icon: "▣" },
  { id: "conflicts", label: "Conflicts", icon: "⚠" },
  { id: "hotspots", label: "Hotspots", icon: "◈" },
  { id: "activity", label: "History", icon: "≡" },
];
const SETTINGS_NAV: { id: TabId; label: string; icon: string }[] = [
  { id: "members", label: "Team", icon: "◐" },
  { id: "constraints", label: "Rules", icon: "▤" },
];

/** Title + one-line explanation for the page header -- the "what is this
 * tab for" answer the old flat tab bar never gave anyone (the redesign's
 * whole point: a first-time viewer shouldn't have to guess what "Alignment
 * threads" means). */
const PAGE_INFO: Record<TabId, { title: string; sub: string }> = {
  overview: { title: "Overview", sub: "What's happening right now." },
  designs: { title: "Work in progress", sub: "What every active session has declared it's building, right now." },
  conflicts: { title: "Conflicts", sub: "Every place two developers' (or agents') work is colliding, and what stage it's at." },
  hotspots: { title: "Hotspots", sub: "Files that keep generating conflicts -- a repeat collision is a signal, not just another item to clear." },
  activity: { title: "History", sub: "The full timeline -- every claim, check, decision, and rule change, in order." },
  members: { title: "Team", sub: "Who's on this repo, and their role." },
  constraints: { title: "Rules", sub: "Fixed project rules every edit gets checked against." },
};

/**
 * A single repo's tab view is the `projects.length === 1` case of the same
 * component that renders a multi-repo aggregated view -- every tab view
 * below takes `projectIds`/`projectsById` regardless of how many repos are
 * in scope, so there's exactly one code path instead of a
 * single-repo/aggregate pair that can drift apart. Only this layout's own
 * header branches on the count.
 */
export function RepoDetailLayout({
  projects,
  onBack,
  readOnly,
}: {
  projects: ProjectSummary[];
  /** Optional only for the public "observe twing getting built" demo
   * (2026-08-28, `ObserveApp`) -- it skips `RepoListView` entirely (there's
   * only ever one project to show), so there's nowhere for "← All repos"
   * to go back to; the header hides the back link when this is absent. */
  onBack?: () => void;
  /** Set only by `ObserveApp`. Skips fetching reviews (GET /v1/reviews 404s
   * for this identity server-side, see app.ts's isPublicViewer guard) and
   * threads through to hide mutating UI in the tabs that stay -- the server
   * already rejects every POST/PATCH from this identity regardless (the
   * publicProjectId auth branch is GET-only by construction), so this is
   * purely the UX nicety of not showing dead-end forms/buttons. */
  readOnly?: boolean;
}) {
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
  // Same idea, for a conflict card's own copy-link URL -- a review or a
  // thread id either way; ConflictsView tries both (2026-09 merge).
  const [focusConflictId, setFocusConflictId] = useState<string | undefined>(() => {
    const u = parseUrlState();
    return u.tab === "conflicts" ? u.focusId : undefined;
  });

  const projectIds = projects.map((p) => p.projectId);

  function focusIdForTab(t: TabId): string | undefined {
    if (t === "designs") return focusDesignId;
    if (t === "conflicts") return focusConflictId;
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

  // A dedicated single-card page (DesignsView/ConflictsView, when their own
  // focusXId prop is set) offers this as its "back to the full list" link
  // -- drops the focus for the *current* tab only and returns to normal
  // browsing.
  function clearFocus() {
    if (tab === "designs") setFocusDesignId(undefined);
    else if (tab === "conflicts") setFocusConflictId(undefined);
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
      setFocusConflictId(url.tab === "conflicts" ? url.focusId : undefined);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIds.join(",")]);

  // The Conflicts nav badge: a pending review or an open thread each mean
  // someone is waiting, and nothing in twing pages that person -- an admin
  // or party only finds out by opening this tab and looking. Summed across
  // every selected repo, matching what Conflicts itself shows in the
  // aggregated view. Deliberately not gated on role -- a member can't
  // decide a review, but knowing the queue is backing up is still worth
  // seeing. Reviews skipped entirely when readOnly (GET /v1/reviews 404s
  // for the public viewer identity) -- no point making a fetch that can
  // only ever fail.
  const pendingReviews = useAsyncData(
    () => (readOnly ? Promise.resolve([]) : Promise.all(projectIds.map((pid) => fetchReviews(apiFetch, pid, "pending"))).then((lists) => lists.flat())),
    [apiFetch, projectIds.join(","), readOnly],
  );
  const openThreads = useAsyncData(
    () => Promise.all(projectIds.map((pid) => fetchAlignmentThreads(apiFetch, pid, { status: "open" }))).then((lists) => lists.flatMap((p) => p.items)),
    [apiFetch, projectIds.join(",")],
  );
  const conflictsCount = (pendingReviews.status === "ready" ? pendingReviews.data.length : 0) + (openThreads.status === "ready" ? openThreads.data.length : 0);

  const projectsById: Record<string, ProjectSummary> = Object.fromEntries(projects.map((p) => [p.projectId, p]));
  const single = projects.length === 1 ? projects[0] : undefined;

  function navItem(t: { id: TabId; label: string; icon: string }) {
    return (
      <button
        key={t.id}
        type="button"
        role="tab"
        aria-selected={tab === t.id}
        className={`nav-item${tab === t.id ? " active" : ""}`}
        onClick={() => openTab(t.id)}
      >
        <span className="icon" aria-hidden="true">
          {t.icon}
        </span>
        {t.label}
        {t.id === "conflicts" && conflictsCount > 0 && (
          <span className={`nav-count${pendingReviews.status === "ready" && pendingReviews.data.length === 0 ? " mild" : ""}`} aria-label={`${conflictsCount} conflicts`}>
            {conflictsCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="repo-detail-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="dot" aria-hidden="true" />
          twing monitor
        </div>

        {onBack && (
          <button type="button" className="link-button back-link sidebar-back-link" onClick={onBack}>
            ← All repos
          </button>
        )}
        <div className="repo-switcher">
          <span>{single ? repoLabel(single) : `${projects.length} repos`}</span>
          {single && <span className="role">{single.role}</span>}
        </div>

        <div className="nav-group-label">Live</div>
        {LIVE_NAV.map(navItem)}

        <div className="nav-group-label">Settings</div>
        {SETTINGS_NAV.map(navItem)}
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <h1>{PAGE_INFO[tab].title}</h1>
            <p className="page-sub">{PAGE_INFO[tab].sub}</p>
          </div>
        </div>

        <div className="content">
          {!single && (
            <div className="repo-chip-row repo-chip-row-content">
              {projects.map((p) => (
                <span key={p.projectId} className="repo-chip">
                  {repoLabel(p)}
                </span>
              ))}
            </div>
          )}

          {tab === "overview" && <OverviewView projectIds={projectIds} projectsById={projectsById} readOnly={readOnly} onOpenTab={openTab} />}
          {tab === "designs" && (
            <DesignsView projectIds={projectIds} projectsById={projectsById} focusDesignId={focusDesignId} onClearFocus={clearFocus} onOpenTab={openTab} readOnly={readOnly} />
          )}
          {tab === "conflicts" && (
            <ConflictsView
              projectIds={projectIds}
              projectsById={projectsById}
              onOpenDesign={openDesign}
              focusConflictId={focusConflictId}
              onClearFocus={clearFocus}
              readOnly={readOnly}
            />
          )}
          {tab === "hotspots" && <HotspotsView projectIds={projectIds} readOnly={readOnly} />}
          {tab === "activity" && <ActivityView projectIds={projectIds} projectsById={projectsById} onOpenDesign={openDesign} onOpenTab={openTab} />}
          {tab === "members" && <MembersView projectIds={projectIds} projectsById={projectsById} />}
          {tab === "constraints" && <ConstraintsView projectIds={projectIds} projectsById={projectsById} />}
        </div>
      </main>
    </div>
  );
}
