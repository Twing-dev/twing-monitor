import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApiFetch, ApiError } from "../api/client.js";
import { fetchDesigns, fetchDesignById } from "../api/designs.js";
import { fetchActivity } from "../api/activity.js";
import { fetchAlignmentThreads } from "../api/alignmentThreads.js";
import { fetchClaims } from "../api/claims.js";
import type { ActivityEvent, AlignmentThread, DesignChange, DesignStatement, ProjectSummary } from "../api/types.js";
import { resolveAlignmentBucket } from "../api/types.js";
import { useAuth } from "../auth/useAuth.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { useIsPhone } from "../hooks/useIsPhone.js";
import { useOnDemandDesigns } from "../hooks/useOnDemandDesigns.js";
import { RepoBadge } from "../components/RepoBadge.js";
import { MemberPanel } from "../components/MemberPanel.js";
import { CopyLinkButton } from "../components/CopyLinkButton.js";
import { buildShareUrl } from "../lib/urlState.js";
import { LatestCheckOutcome, SemanticOverlapNote, ResolveActions, DeclaredChanges, PathList, type SemanticOverlap } from "../components/DesignDetail.js";
import { DesignReview, HighlightableText, useHasReviewAnchors } from "../components/DesignReview.js";
import { DesignChat } from "../components/DesignChat.js";
import { bulletOffsets } from "../lib/reviewAnchors.js";
import { relativeTime } from "../lib/time.js";
import { deriveTitle, toDesignPoints } from "../lib/designTitle.js";
import { dedupeDesignsByGroup, uniqueBy, type DesignGroup } from "../lib/aggregate.js";
import { hasStructuredChanges, kindOf, pathOfTarget } from "../lib/designConformance.js";
import { formatActivityEvent } from "../lib/activityFormat.js";

/** The unified "list of designs, click one, work from its tabs" home screen
 * (2026-09): replaces the old Overview + Designs + Conflicts three-tab split
 * with one always-visible list (left) and one always-visible detail pane
 * (right) -- selecting a row updates the right pane instead of navigating
 * away, and a design's conflict (if it has one) lives under a tab on its own
 * row instead of a separate page you have to know to go check. Conflicts
 * (Reviews/Alignment threads) stay reachable as their own page too -- a
 * review's admin queue and a thread's *other* party aren't always "this one
 * design you're looking at," so the exhaustive browse view didn't go away,
 * it just moved off the primary nav (see RepoDetailLayout's top bar). */

type Section = "attention" | "progress" | "resolved";
// "conflicts" is not a `Section` -- it's a narrower cut across "attention"
// (a real two-side collision: a live file-overlap warning or semantic
// overlap) is a narrower cut of "attention" (flagged for any reason,
// including a rule violation with no other party involved at all) --
// dropped as a separate pill (2026-09) after testing against real
// production data showed the two sets are the same often enough that
// the split just reads as two labels for one thing, not two different
// things worth filtering to separately.
type FilterPill = "all" | Section;

// Urgency-first: Conflicts is why someone opens this screen, so it leads.
// All trails rather than leads -- it's the no-filter reset, not a priority.
const PILLS: { value: FilterPill; label: string }[] = [
  { value: "attention", label: "Conflicts" },
  { value: "progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

const SECTION_HEADING: Record<Section, string> = {
  attention: "Conflicts",
  progress: "In progress",
  resolved: "Resolved",
};

const SECTION_PAGE_SIZE = 5;

/** Same "one project-wide `design_checked` fetch, newest wins per design"
 * approach DesignsView uses for its own list-level chip -- copied rather
 * than imported since DesignsView.tsx stays as an independent, still-tested
 * file this change doesn't touch. */
function latestCheckByDesign(events: ActivityEvent[]): Map<string, { verdict: string }> {
  const byDesign = new Map<string, { verdict: string }>();
  for (const event of events) {
    if (!event.relatedId || byDesign.has(event.relatedId)) continue;
    const payload = event.payload as { verdict?: string } | undefined;
    if (!payload?.verdict) continue;
    byDesign.set(event.relatedId, { verdict: payload.verdict });
  }
  return byDesign;
}

function findSemanticOverlapThread(threads: AlignmentThread[], designId: string): AlignmentThread | undefined {
  return threads.find((t) => resolveAlignmentBucket(t.category) === "llm_divergence" && (t.designId === designId || t.initiatingDesignId === designId));
}

function counterpartIdsForOverlaps(members: DesignStatement[], openThreads: AlignmentThread[]): string[] {
  const ids: string[] = [];
  for (const member of members) {
    const thread = findSemanticOverlapThread(openThreads, member.id);
    if (!thread) continue;
    const counterpartId = thread.initiatingDesignId === member.id ? thread.designId : thread.initiatingDesignId;
    if (counterpartId) ids.push(counterpartId);
  }
  return ids;
}

/** Whether the signed-in developer is a party to this design -- its author,
 * or the other side of an open alignment thread about it. Someone else's
 * design colliding with yours is the case "mine" most needs to catch: it is
 * work you have to answer for, and filtering it out would hide exactly the
 * rows worth acting on. Same "either side counts" test ConflictsView's own
 * `isMine` applies to a conflict, read across a group's members since a
 * groupId-linked design can span repos (and developers).
 *
 * `openThreads` is already fetched for the conflict badges, so this costs
 * no request of its own. */
function isMine(group: DesignGroup, openThreads: AlignmentThread[], me: string | undefined): boolean {
  if (!me) return false;
  return group.members.some(
    (m) => m.developerId === me || openThreads.some((t) => (t.designId === m.id || t.initiatingDesignId === m.id) && (t.developerId === me || t.otherDeveloperId === me)),
  );
}

function designFlags(group: DesignGroup, latestChecks: Map<string, { verdict: string }>, openThreads: AlignmentThread[]): { anyUnresolvedWarning: boolean; anySemanticOverlap: boolean } {
  const anyUnresolvedWarning = group.members.some((m) => {
    const check = latestChecks.get(m.id);
    return m.status === "open" && check?.verdict === "file_overlap";
  });
  const anySemanticOverlap = group.members.some((m) => findSemanticOverlapThread(openThreads, m.id));
  return { anyUnresolvedWarning, anySemanticOverlap };
}

/** The "N changes / N files / N renames / schema" stat tiles for the Design
 * change tab -- same underlying counts `blastRadius` (designConformance.ts)
 * joins into one line for a list row, just kept as separate tiles here since
 * the detail pane has the room for them. */
function changeTiles(changes: DesignChange[]): { n: string; label: string }[] {
  const files = new Set(changes.map((c) => pathOfTarget(c.target)));
  const renames = changes.filter((c) => c.action === "rename" || c.action === "move").length;
  const kinds = new Set(changes.map(kindOf));
  const tiles = [
    { n: String(changes.length), label: changes.length === 1 ? "change" : "changes" },
    { n: String(files.size), label: files.size === 1 ? "file" : "files" },
  ];
  if (renames > 0) tiles.push({ n: String(renames), label: renames === 1 ? "rename" : "renames" });
  if (kinds.has("schema")) tiles.push({ n: "✓", label: "schema" });
  if (kinds.has("api")) tiles.push({ n: "✓", label: "API" });
  return tiles;
}

function sectionFor(primary: DesignStatement, flags: { anyUnresolvedWarning: boolean; anySemanticOverlap: boolean }): Section {
  if (primary.status === "flagged" || flags.anyUnresolvedWarning || flags.anySemanticOverlap) return "attention";
  if (primary.status === "closed" || primary.status === "superseded" || primary.status === "expired") return "resolved";
  return "progress";
}

type ProjectPage = { items: DesignStatement[]; nextBefore?: number };

/** Every status that puts a design in Conflicts or In progress. */
const ACTIVE_STATUSES: DesignStatement["status"][] = ["open", "flagged", "dormant"];

/** Every design in one status, following the cursor to the end -- only for
 * the active statuses, which stay small, never for the history. */
async function fetchAllDesigns(apiFetch: Parameters<typeof fetchDesigns>[0], projectId: string, status: string): Promise<DesignStatement[]> {
  const out: DesignStatement[] = [];
  let before: number | undefined;
  for (;;) {
    const page = await fetchDesigns(apiFetch, projectId, { status, before, limit: 100 });
    out.push(...page.items);
    // Stops on a cursor that doesn't move back, not only on none: one bad
    // response must not spin this forever and hang the page.
    if (page.nextBefore === undefined || (before !== undefined && page.nextBefore >= before)) return out;
    before = page.nextBefore;
  }
}
type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };
/** "changes" was its own tab until 2026-09: Overview said what a design
 * *says* it's doing and Design change said what it *declares it will change*,
 * which are two halves of one question -- a reviewer needs both at once, and a
 * tab made them compare from memory. The change content now renders at the
 * bottom of Overview instead, inside the same review scope as the summary, so
 * a declared change can be highlighted and commented on too. Same components
 * and the same order `DesignDetail.tsx` (the older single-page composite)
 * already rendered them in. */
type DetailTab = "overview" | "conflict" | "ask" | "activity";

export function WorkView({
  projectIds,
  projectsById,
  focusDesignId,
  onClearFocus,
  onSelectionChange,
  readOnly,
  query,
  onQueryChange,
}: {
  projectIds: string[];
  projectsById: Record<string, ProjectSummary>;
  focusDesignId?: string;
  onClearFocus?: () => void;
  /** The design now open in the detail pane (its group's first member), or
   * `undefined` when none is. The layout writes it to the URL, so a link
   * copied from the address bar opens this design rather than the first
   * row. */
  onSelectionChange?: (designId: string | undefined) => void;
  readOnly?: boolean;
  /** Rendered in the shared top bar (RepoDetailLayout), not here -- lifted
   * up so it can sit next to the repo switcher the way the design mockup
   * has it, rather than duplicating a second search box inside this pane. */
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const apiFetch = useApiFetch();
  const { auth } = useAuth();
  // Phone layout (2026-09): one pane at a time instead of two side by side.
  // False on every desktop render and in jsdom, so every branch below that
  // reads it is inert there -- see `useIsPhone`.
  const isPhone = useIsPhone();
  const [pill, setPill] = useState<FilterPill>("all");
  // Orthogonal to `pill`, not a fifth value of it: "my conflicts" is the
  // question someone actually arrives with, and collapsing the two axes
  // into one row of mutually-exclusive pills would make that unaskable.
  const [mineOnly, setMineOnly] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [refreshKey, setRefreshKey] = useState(0);
  const [pages, setPages] = useState<Record<string, ProjectPage>>({});
  const [listState, setListState] = useState<LoadState>({ status: "loading" });
  // Each section (Conflicts/In progress/Resolved) starts capped at
  // SECTION_PAGE_SIZE rows -- a long Resolved list otherwise pushes
  // Conflicts and In progress off screen, the two sections someone actually
  // needs to act on. Expanded independently per section, not globally.
  const [expandedSections, setExpandedSections] = useState<Record<Section, boolean>>({ attention: false, progress: false, resolved: false });

  const projectIdsKey = projectIds.join(",");

  const loadFirstPage = useCallback(() => {
    let cancelled = false;
    setListState({ status: "loading" });
    // No `status` param at all -- the server takes it as a literal exact
    // match (app.ts), so sending the string "all" (rather than omitting the
    // key) would filter to zero designs every time, silently. Every status
    // is exactly what an omitted filter already means server-side.
    //
    // Every active design is loaded in full, and only the history is paged.
    // Found live: the first page is the 20 most recently *created* designs,
    // and active ones are a few among hundreds of resolved -- twing-monitor
    // showed 5 of its 13 in-progress designs (every dormant one sat on a
    // later page) and counted 5. They are the point of this screen, and
    // few enough to fetch whole.
    Promise.all(
      projectIds.map((pid) =>
        Promise.all([fetchDesigns(apiFetch, pid, {}), ...ACTIVE_STATUSES.map((status) => fetchAllDesigns(apiFetch, pid, status))]).then(
          ([page, ...active]) => [pid, { items: uniqueBy([...active.flat(), ...page.items], (d) => d.id), nextBefore: page.nextBefore }] as const,
        ),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        setPages(Object.fromEntries(results));
        setListState({ status: "ready" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setListState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch, projectIdsKey, refreshKey]);

  useEffect(() => loadFirstPage(), [loadFirstPage]);

  async function loadMore() {
    const toFetch = projectIds.filter((pid) => pages[pid]?.nextBefore !== undefined);
    if (toFetch.length === 0) return;
    try {
      const results = await Promise.all(
        toFetch.map((pid) => fetchDesigns(apiFetch, pid, { before: pages[pid].nextBefore }).then((page) => [pid, page] as const)),
      );
      setPages((prev) => {
        const next = { ...prev };
        // De-duplicated: the active designs on an older page are already
        // loaded.
        for (const [pid, page] of results) next[pid] = { items: uniqueBy([...(prev[pid]?.items ?? []), ...page.items], (d) => d.id), nextBefore: page.nextBefore };
        return next;
      });
    } catch (err) {
      setListState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const items = useMemo(() => Object.values(pages).flatMap((p) => p.items).sort((a, b) => b.lastActivityAt - a.lastActivityAt), [pages]);
  const hasMore = Object.values(pages).some((p) => p.nextBefore !== undefined);

  // A copy-link URL or a cross-link from another design's Conflict tab names
  // one specific design that may not be on an already-loaded page -- fetched
  // directly by id, same "resolve directly, don't paginate to find it"
  // convention DesignsView's own focus handling uses, and merged into the
  // list below rather than replacing it (split-pane always shows the whole
  // list; there's no separate "focus page" to switch into).
  const focusState = useAsyncData(
    () =>
      !focusDesignId
        ? Promise.resolve(undefined)
        : fetchDesignById(apiFetch, focusDesignId).catch((err: unknown) => {
            if (err instanceof ApiError && err.status === 404) return undefined;
            throw err;
          }),
    [apiFetch, focusDesignId, refreshKey],
  );

  const allItems = useMemo(() => {
    if (focusState.status !== "ready" || !focusState.data) return items;
    // Normalized rather than trusted: a response without `groupMembers` (an
    // older coordinator, a proxy's own JSON) must not take the pane down --
    // the focused design itself is still worth showing.
    const extra = [focusState.data.design, ...(Array.isArray(focusState.data.groupMembers) ? focusState.data.groupMembers : [])];
    const known = new Set(items.map((d) => d.id));
    return [...items, ...extra.filter((d) => !known.has(d.id))];
  }, [items, focusState]);

  const groups = useMemo(() => dedupeDesignsByGroup(allItems), [allItems]);

  const checksState = useAsyncData(
    () => Promise.all(projectIds.map((pid) => fetchActivity(apiFetch, pid, { kinds: ["design_checked"], limit: 200 }))).then((pages) => pages.flatMap((p) => p.items).sort((a, b) => b.ts - a.ts)),
    [apiFetch, projectIdsKey, refreshKey],
  );
  const latestChecks = checksState.status === "ready" ? latestCheckByDesign(checksState.data) : new Map<string, { verdict: string }>();
  const openThreadsState = useAsyncData(
    () => Promise.all(projectIds.map((pid) => fetchAlignmentThreads(apiFetch, pid, { status: "open" }))).then((pages) => pages.flatMap((p) => p.items)),
    [apiFetch, projectIdsKey, refreshKey],
  );
  const openThreads = openThreadsState.status === "ready" ? openThreadsState.data : [];

  const showRepoBadge = projectIds.length > 1;

  const rows = useMemo(
    () =>
      groups.map((group) => {
        const primary = group.members[0];
        const flags = designFlags(group, latestChecks, openThreads);
        return { group, primary, flags, section: sectionFor(primary, flags) };
      }),
    [groups, latestChecks, openThreads],
  );

  const mineRows = useMemo(() => (mineOnly ? rows.filter((r) => isMine(r.group, openThreads, auth?.developerId)) : rows), [rows, mineOnly, openThreads, auth?.developerId]);

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return mineRows;
    return mineRows.filter((r) => r.primary.summary.toLowerCase().includes(q) || r.primary.developerId.toLowerCase().includes(q));
  }, [mineRows, query]);

  // Counted off the owner- and search-filtered rows rather than every row,
  // so a pill's number always describes the list it switches to. Found while
  // testing the toggle, and a defect in its own right: with a search active
  // the pills already read the whole project's totals (12/16/25/53 beside a
  // nine-row list), which reads as the filter having silently failed.
  const counts = useMemo(() => {
    const c: Record<Exclude<FilterPill, "all">, number> = { attention: 0, progress: 0, resolved: 0 };
    for (const r of searched) c[r.section]++;
    return c;
  }, [searched]);

  const visibleRows = pill === "all" ? searched : searched.filter((r) => r.section === pill);

  // Auto-select the first visible row whenever the current selection drops
  // out of view (filter/search changed, or nothing selected yet) -- keeps
  // the detail pane from ever showing a row the list no longer displays.
  //
  // Not on a phone, where the two panes are one screen: selecting a row
  // *navigates* to it, so auto-selecting would open the first design over
  // the list every time the view loads or the filter changes, and the list
  // would be unreachable. Dropping a selection that has scrolled out of
  // view still applies -- that is the second branch below.
  useEffect(() => {
    if (focusDesignId) return; // the focus effect below owns selection while a focus id is active
    if (visibleRows.some((r) => r.group.key === selectedKey)) return;
    setSelectedKey(isPhone ? null : (visibleRows[0]?.group.key ?? null));
    setDetailTab("overview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows.map((r) => r.group.key).join(","), focusDesignId, isPhone]);

  useEffect(() => {
    if (!focusDesignId || focusState.status !== "ready" || !focusState.data) return;
    const key = focusState.data.design.groupId ?? focusState.data.design.id;
    setSelectedKey(key);
    setDetailTab("overview");
  }, [focusDesignId, focusState]);

  /**
   * The list pane's scroll offset, carried across the phone's hide/show.
   *
   * On a phone the list is hidden with `display: none` when a design opens,
   * which takes it out of the layout tree and resets its `scrollTop` -- so
   * bounding the pane (index.css) stops the *page* collapsing but does not
   * by itself bring you back to where you were. This remembers the offset;
   * the layout effect below puts it back.
   *
   * A ref rather than state: nothing renders from it, and writing it must
   * not cause a render in the middle of a scroll.
   */
  const listRef = useRef<HTMLDivElement | null>(null);
  const listScrollRef = useRef(0);

  function selectRow(key: string) {
    // Recorded before the selection changes, while the list is still the
    // visible pane and its offset is still real.
    if (listRef.current) listScrollRef.current = listRef.current.scrollTop;
    setSelectedKey(key);
    setDetailTab("overview");
    if (focusDesignId) onClearFocus?.();
  }

  /** A cross-link from another design's Conflict tab (its semantic-overlap
   * counterpart) -- jumps straight to that design regardless of the current
   * filter/search, same as DesignsView's own jumpToDesign. */
  function openDesign(designId: string) {
    setPill("all");
    onQueryChange("");
    const group = groups.find((g) => g.members.some((m) => m.id === designId));
    setSelectedKey(group?.key ?? designId);
    setDetailTab("conflict");
  }

  const selected = rows.find((r) => r.group.key === selectedKey);

  // Tell the layout which design is open, however it got opened -- a click,
  // the automatic first-row selection, or a focus link. Found live: nothing
  // wrote the selection to the URL, so a link copied from the address bar
  // opened the first design (or the one the page was first opened with)
  // instead of the one on screen.
  const selectedDesignId = selected?.group.members[0]?.id;
  useEffect(() => {
    onSelectionChange?.(selectedDesignId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDesignId]);

  // Restored in a *layout* effect so it happens before the browser paints --
  // in a plain effect the list appears at the top for a frame and then jumps,
  // which reads as a bug even though it lands correctly. Declared after
  // `selected`, which it reads.
  useLayoutEffect(() => {
    if (!isPhone || selected || !listRef.current) return;
    listRef.current.scrollTop = listScrollRef.current;
  }, [isPhone, selected]);

  const neededCounterpartIds = useMemo(() => counterpartIdsForOverlaps(selected ? selected.group.members : [], openThreads), [selected, openThreads]);
  const designsById = useOnDemandDesigns(apiFetch, neededCounterpartIds);

  if (listState.status === "loading" && groups.length === 0) return <p className="empty-state">Loading…</p>;
  if (listState.status === "error") {
    return (
      <p className="empty-state error" role="alert">
        Couldn't load: {listState.message}
      </p>
    );
  }

  return (
    // `data-phone-pane` is what the phone stylesheet keys off to show one
    // pane at a time. Always present, and ignored entirely above 640px --
    // the desktop rules never mention it, so both panes stay visible
    // whatever it says.
    <div className="work-body" data-phone-pane={selected ? "detail" : "list"}>
      <div className="work-pane-list" ref={listRef}>
        <div className="work-filter-row">
          {PILLS.map((p) => (
            <button key={p.value} type="button" className={`work-pill${pill === p.value ? " active" : ""}`} onClick={() => setPill(p.value)}>
              {p.label} {p.value === "all" ? searched.length : counts[p.value]}
            </button>
          ))}
          {/* Separated from the section pills: those pick one of three
              sections, this cuts across all of them, and sitting it in the
              same row without a divider would read as a fourth section.
              Hidden for the read-only /observe viewer, whose synthetic
              "public-viewer" identity (ObserveContext.tsx) owns nothing --
              the toggle would only ever empty the list for it. */}
          {!readOnly && (
            <>
              <span className="work-filter-divider" aria-hidden="true" />
              <button type="button" className={`work-pill${mineOnly ? " active" : ""}`} aria-pressed={mineOnly} onClick={() => setMineOnly((v) => !v)}>
                Mine
              </button>
            </>
          )}
        </div>

        {visibleRows.length === 0 ? (
          <p className="empty-state">No designs match this filter.</p>
        ) : (
          <div className="work-rows">
            {(pill === "all" ? (["attention", "progress", "resolved"] as Section[]) : [pill]).map((section) => {
              const inSection = pill === "all" ? visibleRows.filter((r) => r.section === section) : visibleRows;
              if (inSection.length === 0) return null;
              const expanded = expandedSections[section];
              const shown = expanded ? inSection : inSection.slice(0, SECTION_PAGE_SIZE);
              const remaining = inSection.length - shown.length;
              return (
                <div key={section}>
                  {pill === "all" && (
                    <div className={`work-section-heading${section === "attention" ? " attention" : ""}`}>
                      {SECTION_HEADING[section]} <span className="n">{inSection.length}</span>
                    </div>
                  )}
                  {shown.map(({ group, primary, flags, section: rowSection }) => (
                    <button
                      key={group.key}
                      type="button"
                      className={`work-row${selectedKey === group.key ? " selected" : ""}`}
                      onClick={() => selectRow(group.key)}
                    >
                      <div className="work-row-summary">{deriveTitle(primary.summary)}</div>
                      <div className="work-row-meta">
                        <span className={`work-status-dot ${rowSection}`} aria-hidden="true" />
                        {showRepoBadge && uniqueBy(group.members, (m) => m.projectId).map((m) => <RepoBadge key={m.projectId} project={projectsById[m.projectId] ?? { projectId: m.projectId }} />)}
                        <span>{primary.developerId}</span>
                        <span className="sep">{relativeTime(primary.lastActivityAt)}</span>
                        {primary.status === "flagged" && <span className="work-badge conflict">flagged</span>}
                        {primary.status !== "flagged" && flags.anySemanticOverlap && <span className="work-badge conflict">overlap</span>}
                        {primary.status !== "flagged" && !flags.anySemanticOverlap && flags.anyUnresolvedWarning && <span className="work-badge warn">file overlap</span>}
                      </div>
                    </button>
                  ))}
                  {remaining > 0 && (
                    <button
                      type="button"
                      className="section-load-more-button"
                      onClick={() => setExpandedSections((prev) => ({ ...prev, [section]: true }))}
                    >
                      Load {remaining} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {hasMore && (
          <button type="button" className="load-more-button" onClick={loadMore}>
            Load older
          </button>
        )}
      </div>

      <div className="work-pane-detail">
        {/* Rendered unconditionally and hidden by CSS on desktop, rather
            than gated on `isPhone`: it keeps the desktop render tree
            identical bar one hidden element, and it means the control
            exists the instant a rotation makes it relevant. */}
        <button type="button" className="work-back" onClick={() => setSelectedKey(null)}>
          ← All designs
        </button>
        {!selected ? (
          <p className="empty-state">Select a design to see its details.</p>
        ) : (
          <DesignDetailPane
            key={selected.group.key}
            group={selected.group}
            flags={selected.flags}
            showRepoBadge={showRepoBadge}
            projectsById={projectsById}
            openThreads={openThreads}
            designsById={designsById}
            tab={detailTab}
            onTabChange={setDetailTab}
            onResolved={() => setRefreshKey((k) => k + 1)}
            onOpenDesign={openDesign}
            readOnly={readOnly}
          />
        )}
      </div>
    </div>
  );
}

/** One member's declared changes, with its own claims fetched by session --
 * a linked group can span sessions (and projects), so conformance ("did the
 * code match the plan") has to be checked per member rather than once for
 * the group. Mirrors DesignDetail's own top-level claims fetch, just scoped
 * to whichever member this is. */
/** A member's original plan text -- collapsed, since the summary above is
 * the paraphrase most readers want, but opened by itself (once) when an open
 * review comment is anchored in it: a highlight nobody can see is a comment
 * nobody can place. */
function RawPlan({ designId, text }: { designId: string; text: string }) {
  const [open, setOpen] = useState(false);
  const hasAnchors = useHasReviewAnchors(designId, "plan");
  const openedForAnchors = useRef(false);
  useEffect(() => {
    if (hasAnchors && !openedForAnchors.current) {
      openedForAnchors.current = true;
      setOpen(true);
    }
  }, [hasAnchors]);

  return (
    <details className="work-raw-plan" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>View original plan text</summary>
      <pre className="plan-text">
        <HighlightableText designId={designId} field="plan" text={text} />
      </pre>
    </details>
  );
}

function MemberChanges({ member }: { member: DesignStatement }) {
  const apiFetch = useApiFetch();
  const claimsState = useAsyncData(() => fetchClaims(apiFetch, member.projectId, member.sessionId), [apiFetch, member.projectId, member.sessionId]);

  return (
    <>
      {hasStructuredChanges(member.changes) ? (
        <DeclaredChanges designId={member.id} changes={member.changes} claims={claimsState.status === "ready" ? claimsState.data : []} />
      ) : (
        <>
          <PathList title="Creates" paths={member.creates} />
          <PathList title="Touches" paths={member.touches} />
        </>
      )}
      <PathList title="Depends on" paths={member.dependsOn} />
    </>
  );
}

function DesignDetailPane({
  group,
  flags,
  showRepoBadge,
  projectsById,
  openThreads,
  designsById,
  tab,
  onTabChange,
  onResolved,
  onOpenDesign,
  readOnly,
}: {
  group: DesignGroup;
  flags: { anyUnresolvedWarning: boolean; anySemanticOverlap: boolean };
  showRepoBadge: boolean;
  projectsById: Record<string, ProjectSummary>;
  openThreads: AlignmentThread[];
  designsById: Record<string, DesignStatement>;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onResolved: () => void;
  onOpenDesign: (designId: string) => void;
  readOnly?: boolean;
}) {
  const apiFetch = useApiFetch();
  const primary = group.members[0];
  const hasConflict = primary.status === "flagged" || flags.anyUnresolvedWarning || flags.anySemanticOverlap;
  const points = toDesignPoints(primary.summary);
  // Where each bullet sits in the summary, so a highlight located against
  // the whole summary lands on the right bullet.
  const pointOffsets = bulletOffsets(primary.summary, points);
  // The Conflict tab's own count badge -- how many members in this group
  // (a linked design can span repos) actually have something to show under
  // it, same "flagged, or a live overlap" test the tab's own visibility
  // already uses, just counted per member instead of collapsed to a
  // boolean.
  const conflictMemberCount = group.members.filter((m) => m.status === "flagged" || findSemanticOverlapThread(openThreads, m.id) || flags.anyUnresolvedWarning).length;
  /** Every member's declared changes, for the group-level stat tiles. A group
   * of one yields exactly `primary.changes`, so the common case is unchanged. */
  const groupChanges = group.members.flatMap((m) => m.changes ?? []);

  const activityState = useAsyncData(
    () =>
      Promise.all(group.members.map((m) => fetchActivity(apiFetch, m.projectId, { relatedId: m.id, limit: 50 }))).then((pages) =>
        pages.flatMap((p) => p.items).sort((a, b) => b.ts - a.ts),
      ),
    [apiFetch, group.key, tab === "activity"],
  );

  return (
    <>
      <div className="work-detail-header">
        <div className="work-detail-title" title={primary.summary}>
          {deriveTitle(primary.summary)}
        </div>
        <div className="work-detail-meta">
          {showRepoBadge && uniqueBy(group.members, (m) => m.projectId).map((m) => <RepoBadge key={m.projectId} project={projectsById[m.projectId] ?? { projectId: m.projectId }} />)}
          <span>
            <b>{primary.developerId}</b>
          </span>
          <span>updated {relativeTime(primary.lastActivityAt)}</span>
          <span className={`status-badge tone-neutral`}>{primary.status}</span>
          {/* A link to this design for a teammate -- the same URL the address
              bar now carries, scoped to this design's own repo whatever the
              viewer's repo selection. */}
          <CopyLinkButton url={buildShareUrl(primary.projectId, "designs", primary.id)} />
        </div>
      </div>

      <div className="work-tabs">
        <button type="button" className={`work-tab${tab === "overview" ? " active" : ""}`} onClick={() => onTabChange("overview")}>
          Overview
        </button>
        <button type="button" className={`work-tab${tab === "ask" ? " active" : ""}`} onClick={() => onTabChange("ask")}>
          Ask
        </button>
        {hasConflict && (
          <button type="button" className={`work-tab${tab === "conflict" ? " active" : ""}`} onClick={() => onTabChange("conflict")}>
            Conflict <span className="tab-count">{conflictMemberCount}</span>
          </button>
        )}
        <button type="button" className={`work-tab${tab === "activity" ? " active" : ""}`} onClick={() => onTabChange("activity")}>
          Activity
        </button>
      </div>

      {/* One review scope around everything Overview renders -- the summary,
          the original plan text, and the declared changes -- so a reviewer can
          highlight any of it and every comment lands in the same rail. With
          "Design change" folded into Overview there is only one tab left to
          scope, but the wrapper stays outside `work-tab-panel`: the rail sits
          beside the whole panel, not inside its flow. */}
      {tab === "overview" && (
        <DesignReview designs={group.members} readOnly={readOnly}>
          <div className="work-tab-panel">
            <h3>What this design says it&rsquo;s doing</h3>
            {points.length > 0 ? (
              <ul className="summary-bullets">
                {points.map((line, i) => (
                  <li key={i}>
                    <HighlightableText designId={primary.id} field="summary" text={line} offset={pointOffsets[i]} />
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                <HighlightableText designId={primary.id} field="summary" text={primary.summary} />
              </p>
            )}

            {/* Collapsed by default, on purpose: `summary` above is already an
                LLM-generated paraphrase of this, produced once at registration
                (design-extract.ts) -- most readers want that, not the raw
                plan. Every design carries its plan here -- an ExitPlanMode plan
                or a template's `plan:`; the coordinator refuses to register one
                without (2026-09-29). */}
            {group.members.some((m) => m.rawPlanExcerpt) && (
              <div className="work-raw-plans">
                {group.members
                  .filter((m) => m.rawPlanExcerpt)
                  .map((member) => (
                    <div key={member.id}>
                      {showRepoBadge && (
                        <div className="repo-badge-row">
                          <RepoBadge project={projectsById[member.projectId] ?? { projectId: member.projectId }} />
                        </div>
                      )}
                      <RawPlan designId={member.id} text={member.rawPlanExcerpt ?? ""} />
                    </div>
                  ))}
              </div>
            )}

            {/* What the design declares it will change, merged in from its own
                "Design change" tab (2026-09) -- see DetailTab's doc comment for
                why. Sits last, so one scroll reads what the design says it's
                doing -> what it actually changes, which is the order a reviewer
                works in. Inside the review scope along with the rest: a
                declared change is as commentable as the summary above it. */}
            <div className="work-detail-changes">
              {/* Says up front that this row is several linked designs, so the
                  stacked panels below read as a list of designs rather than as
                  one design's content repeated. Absent for a group of one --
                  the overwhelmingly common case, unchanged. */}
              {group.members.length > 1 && <div className="work-group-count">{group.members.length} linked designs</div>}
              {/* Counted across every member, not just `primary`: with one
                  labelled panel per design below, tiles describing only the
                  first would be a headline number for a fraction of what
                  follows. Identical to `primary.changes` for a group of one. */}
              {hasStructuredChanges(groupChanges) && (
                <div className="work-change-grid">
                  {changeTiles(groupChanges).map((t) => (
                    <div key={t.label} className="work-change-stat">
                      <div className="n">{t.n}</div>
                      <div className="l">{t.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* One labelled panel per member, so a linked group's stacked
                  changes read as several designs rather than as one design's
                  content repeated. Only the declared changes sit in the panel
                  now: the discussion that used to share it became the review
                  rail, which spans the whole tab and is handed every member
                  (`designs={group.members}`), so it says which design a
                  comment is against itself rather than needing a panel to say
                  it. */}
              {group.members.map((member) => (
                <MemberPanel key={member.id} member={member} members={group.members} showRepoBadge={showRepoBadge} projectsById={projectsById}>
                  <MemberChanges member={member} />
                </MemberPanel>
              ))}
            </div>
          </div>
        </DesignReview>
      )}

      {/* The private Ask chat stays its own tab: a per-reviewer conversation
          reads oddly beside the public review, and a distinct tab says "this
          is a different, private space" better than proximity does. */}
      {tab === "ask" && (
        <div className="work-tab-panel">
          {group.members.map((member) => (
            <MemberPanel key={member.id} member={member} members={group.members} showRepoBadge={showRepoBadge} projectsById={projectsById}>
              <DesignChat design={member} readOnly={readOnly} />
            </MemberPanel>
          ))}
        </div>
      )}

      {tab === "conflict" && hasConflict && (
        <div className="work-tab-panel">
          {group.members.map((member) => {
            const semanticThread = findSemanticOverlapThread(openThreads, member.id);
            const semanticOverlap: SemanticOverlap | undefined = semanticThread
              ? { thread: semanticThread, counterpart: designsById[semanticThread.initiatingDesignId === member.id ? semanticThread.designId! : semanticThread.initiatingDesignId!] }
              : undefined;
            return (
              <MemberPanel key={member.id} member={member} members={group.members} showRepoBadge={showRepoBadge} projectsById={projectsById}>
                <LatestCheckOutcome design={member} />
                {semanticOverlap && <SemanticOverlapNote overlap={semanticOverlap} onOpenDesign={onOpenDesign} />}
                <ResolveActions design={member} onResolved={onResolved} readOnly={readOnly} />
              </MemberPanel>
            );
          })}
        </div>
      )}

      {tab === "activity" && (
        <div className="work-tab-panel">
          {activityState.status === "loading" && <p className="empty-state">Loading…</p>}
          {activityState.status === "error" && (
            <p className="empty-state error" role="alert">
              Couldn't load: {activityState.message}
            </p>
          )}
          {activityState.status === "ready" && activityState.data.length === 0 && <p className="empty-state">No activity yet.</p>}
          {activityState.status === "ready" && activityState.data.length > 0 && (
            <ul className="work-activity-list">
              {activityState.data.map((event) => {
                const formatted = formatActivityEvent(event);
                return (
                  <li key={event.id} className="work-activity-item">
                    <span className="work-activity-time">{relativeTime(event.ts)}</span>
                    <span>{formatted.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
