import { useEffect, useState } from "react";
import type { ProjectSummary } from "../api/types.js";
import { repoLabel } from "../lib/repoLabel.js";
import { type TabId, parseUrlState, pushUrlState } from "../lib/urlState.js";
import { WorkView } from "./WorkView.js";
import { ConflictsView } from "./ConflictsView.js";
import { HotspotsView } from "./HotspotsView.js";
import { ActivityView } from "./ActivityView.js";
import { MembersView } from "./MembersView.js";
import { ConstraintsView } from "./ConstraintsView.js";

/** 2026-09, second pass: the dark sidebar (one row per tab) replaced again --
 * once Overview/Designs/Conflicts collapsed into one always-visible list +
 * detail pane (WorkView), a whole vertical rail for what's now a single
 * destination was the wrong shape, and it was eating a fixed 232px + the
 * content column's own 900px cap regardless of how wide the window actually
 * was. This is that destination's home screen. Only Team/Rules keep a
 * top-bar icon (matches the design mockup exactly, top-bar down to the
 * icon count) -- Conflicts/Hotspots/History have no icon anymore and are
 * only reachable by an in-app cross-link (a Conflict tab's "View conflict
 * ->") or a copy-link URL; their own page code is untouched. */
const SECONDARY_NAV: { id: TabId; label: string; icon: string }[] = [
  { id: "members", label: "Team", icon: "👥" },
  { id: "constraints", label: "Rules", icon: "▤" },
];

/** Title + one-line explanation, shown above a secondary page only -- the
 * unified list (tab "overview"/"designs") is the home screen and doesn't
 * need to announce what it is the way a page you clicked into does. */
const PAGE_INFO: Partial<Record<TabId, { title: string; sub: string }>> = {
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
  const [tab, setTab] = useState<TabId>(() => parseUrlState().tab);
  // Set by an Activity row's "View design ->" link, a card's own copy-link
  // URL, or a semantic-overlap jump -- WorkView consumes it to select that
  // design (regardless of the list's current filter) as soon as it loads.
  const [focusDesignId, setFocusDesignId] = useState<string | undefined>(() => {
    const u = parseUrlState();
    return u.tab === "designs" || u.tab === "overview" ? u.focusId : undefined;
  });
  // Same idea, for a conflict card's own copy-link URL on the standalone
  // Conflicts page -- a review or a thread id either way; ConflictsView
  // tries both.
  const [focusConflictId, setFocusConflictId] = useState<string | undefined>(() => {
    const u = parseUrlState();
    return u.tab === "conflicts" ? u.focusId : undefined;
  });

  const projectIds = projects.map((p) => p.projectId);
  const isHome = tab === "overview" || tab === "designs";
  // Lives here, not in WorkView, because it renders in the shared top bar
  // (next to the repo switcher) rather than WorkView's own filter row --
  // only meaningful on the home screen, so it's dropped whenever isHome
  // goes false rather than persisted across a trip to another tab.
  const [query, setQuery] = useState("");

  function focusIdForTab(t: TabId): string | undefined {
    if (t === "designs" || t === "overview") return focusDesignId;
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

  function goHome() {
    openTab("designs");
  }

  // The standalone Conflicts page's own "back to the full list" link --
  // drops its focus id and returns to normal browsing there. WorkView
  // manages its own selection instead of a focus/unfocus pair (see its own
  // onClearFocus prop), since split-pane browsing never leaves a "focused
  // page" to back out of the way the old flat list did.
  function clearConflictFocus() {
    setFocusConflictId(undefined);
    pushUrlState({ repoIds: projectIds, tab: "conflicts" });
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
      setFocusDesignId(url.tab === "designs" || url.tab === "overview" ? url.focusId : undefined);
      setFocusConflictId(url.tab === "conflicts" ? url.focusId : undefined);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIds.join(",")]);

  const projectsById: Record<string, ProjectSummary> = Object.fromEntries(projects.map((p) => [p.projectId, p]));
  const single = projects.length === 1 ? projects[0] : undefined;

  return (
    <div className="work-shell">
      <div className="work-topbar">
        <button type="button" className="work-brand" onClick={goHome} aria-label="twing monitor, go to designs">
          <span className="dot" aria-hidden="true" />
          twing monitor
        </button>

        {onBack && (
          <button type="button" className="link-button back-link" onClick={onBack}>
            ← All repos
          </button>
        )}

        <div className="work-repo-switcher">
          <span>{single ? repoLabel(single) : `${projects.length} repos`}</span>
          {single && <span className="role">{single.role}</span>}
        </div>

        <div className="work-topbar-spacer" />

        {isHome && (
          <input
            className="work-search"
            type="text"
            placeholder="Search designs, people…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search designs"
          />
        )}

        <div className="work-topbar-icons">
          {SECONDARY_NAV.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`icon-btn${tab === t.id ? " active" : ""}`}
              aria-label={t.label}
              title={t.label}
              onClick={() => openTab(t.id)}
            >
              {t.icon}
            </button>
          ))}
        </div>
      </div>

      {!isHome && PAGE_INFO[tab] && (
        <div className="work-page-header">
          <h1>{PAGE_INFO[tab]!.title}</h1>
          <p className="page-sub">{PAGE_INFO[tab]!.sub}</p>
        </div>
      )}

      {!single && (
        <div className="repo-chip-row repo-chip-row-content">
          {projects.map((p) => (
            <span key={p.projectId} className="repo-chip">
              {repoLabel(p)}
            </span>
          ))}
        </div>
      )}

      {isHome && (
        <WorkView
          projectIds={projectIds}
          projectsById={projectsById}
          focusDesignId={focusDesignId}
          onClearFocus={() => setFocusDesignId(undefined)}
          onOpenTab={openTab}
          readOnly={readOnly}
          query={query}
          onQueryChange={setQuery}
        />
      )}
      {!isHome && (
        <div className="content">
          {tab === "conflicts" && (
            <ConflictsView
              projectIds={projectIds}
              projectsById={projectsById}
              onOpenDesign={openDesign}
              focusConflictId={focusConflictId}
              onClearFocus={clearConflictFocus}
              readOnly={readOnly}
            />
          )}
          {tab === "hotspots" && <HotspotsView projectIds={projectIds} readOnly={readOnly} />}
          {tab === "activity" && <ActivityView projectIds={projectIds} projectsById={projectsById} onOpenDesign={openDesign} onOpenTab={openTab} />}
          {tab === "members" && <MembersView projectIds={projectIds} projectsById={projectsById} />}
          {tab === "constraints" && <ConstraintsView projectIds={projectIds} projectsById={projectsById} />}
        </div>
      )}
    </div>
  );
}
