import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApiFetch, ApiError } from "../api/client.js";
import { fetchDesigns, fetchDesignById, reviseDesignOverview } from "../api/designs.js";
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
import { designTitle, toDesignPoints, DETAIL_TITLE_CHARS } from "../lib/designTitle.js";
import { hasMarkdownStructure } from "../lib/markdown.js";
import { Markdown } from "../components/Markdown.js";
import { dedupeDesignsByGroup, uniqueBy, type DesignGroup } from "../lib/aggregate.js";
import { hasStructuredChanges, kindOf, pathOfTarget } from "../lib/designConformance.js";
import { conflictKindInfo } from "../lib/conflictKind.js";
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
function changeTiles(changes: DesignChange[]): { n: string; label: string; tone?: "warn" }[] {
  const files = new Set(changes.map((c) => pathOfTarget(c.target)));
  const renames = changes.filter((c) => c.action === "rename" || c.action === "move").length;
  const kinds = new Set(changes.map(kindOf));
  const tiles: { n: string; label: string; tone?: "warn" }[] = [
    { n: String(changes.length), label: changes.length === 1 ? "change" : "changes" },
    { n: String(files.size), label: files.size === 1 ? "file" : "files" },
  ];
  if (renames > 0) tiles.push({ n: String(renames), label: renames === 1 ? "rename" : "renames" });
  // Reach, not a count. These used to render as `✓` over "schema"/"API" --
  // a tick in the same slot that holds "8" beside it, which reads as a check
  // that passed when the fact is the opposite one: this design reaches a
  // contract other people's work depends on. Named and toned as a warning
  // instead, since it's the highest-signal thing in the row when present.
  if (kinds.has("schema")) tiles.push({ n: "Schema", label: "touched", tone: "warn" });
  if (kinds.has("api")) tiles.push({ n: "API", label: "touched", tone: "warn" });
  return tiles;
}

function sectionFor(primary: DesignStatement, flags: { anyUnresolvedWarning: boolean; anySemanticOverlap: boolean }): Section {
  if (primary.status === "flagged" || flags.anyUnresolvedWarning || flags.anySemanticOverlap) return "attention";
  if (primary.status === "closed" || primary.status === "superseded" || primary.status === "expired") return "resolved";
  return "progress";
}

/**
 * The one-line answer to "so what do I do about this design", for the top
 * of the detail pane.
 *
 * Reads the same three inputs as `sectionFor`, in the same order, on
 * purpose: a pane that said "nothing to do" while the list had filed the
 * row under Conflicts would be worse than the silence it replaces. If it
 * renders, the row is in the attention section, and vice versa.
 *
 * Labels and explanations come from `conflictKindInfo` rather than being
 * written again here -- that module exists specifically because four
 * copies of this vocabulary had already drifted apart (see its doc
 * comment), and a banner is not the place to start a fifth.
 *
 * Returns null for a design with nothing wrong. A "nothing to do" note on
 * every healthy design would train people to skip the banner on the ones
 * where it says something.
 */
function designVerdict(
  primary: DesignStatement,
  flags: { anyUnresolvedWarning: boolean; anySemanticOverlap: boolean },
): { tone: "critical" | "warn"; label: string; text: string } | null {
  // `flagged` is the coordinator's own block. It can come from more than
  // one bucket and the status alone doesn't say which, so this points at
  // the Conflict tab -- which fetches the verdict and names it -- instead
  // of guessing a bucket here.
  if (primary.status === "flagged") {
    return { tone: "critical", label: "Needs a decision.", text: "This design is flagged and won't clear until someone resolves it. The Conflict tab has the specifics." };
  }
  if (flags.anySemanticOverlap) {
    const info = conflictKindInfo("llm_divergence");
    return { tone: "critical", label: `${info.label}.`, text: `${info.explanation} Worth settling before more of this gets built.` };
  }
  if (flags.anyUnresolvedWarning) {
    const info = conflictKindInfo("file_overlap");
    return { tone: "warn", label: `${info.label}.`, text: info.explanation };
  }
  return null;
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
                  {/* No count here: the filter pill directly above this
                      carries the same number for the same set, and the two
                      sat close enough to read as one control repeated. The
                      heading earns its place as a scroll landmark, so it
                      keeps the label and hosts the expander. */}
                  {pill === "all" && (
                    <div className={`work-section-heading${section === "attention" ? " attention" : ""}`}>
                      {SECTION_HEADING[section]}
                      {remaining > 0 && (
                        <button type="button" className="section-expand" onClick={() => setExpandedSections((prev) => ({ ...prev, [section]: true }))}>
                          +{remaining} more
                        </button>
                      )}
                    </div>
                  )}
                  {shown.map(({ group, primary, flags, section: rowSection }) => (
                    <button
                      key={group.key}
                      type="button"
                      className={`work-row${selectedKey === group.key ? " selected" : ""}`}
                      onClick={() => selectRow(group.key)}
                    >
                      <div className="work-row-summary">{designTitle(primary)}</div>
                      <div className="work-row-meta">
                        <span className={`work-status-dot ${rowSection}`} aria-hidden="true" />
                        {showRepoBadge && uniqueBy(group.members, (m) => m.projectId).map((m) => <RepoBadge key={m.projectId} project={projectsById[m.projectId] ?? { projectId: m.projectId }} />)}
                        <span className="dev">{primary.developerId}</span>
                        <span className="sep">{relativeTime(primary.lastActivityAt)}</span>
                        {primary.status === "flagged" && <span className="work-badge flagged">flagged</span>}
                        {primary.status !== "flagged" && flags.anySemanticOverlap && <span className="work-badge conflict">overlap</span>}
                        {primary.status !== "flagged" && !flags.anySemanticOverlap && flags.anyUnresolvedWarning && <span className="work-badge warn">file overlap</span>}
                      </div>
                    </button>
                  ))}
                  {/* Only when a pill is active, since then there's no
                      heading to hang the expander off -- and only one
                      section is on screen, so it's one button rather than
                      the three that used to stack up in the "all" view
                      alongside the server-side "Load older". */}
                  {pill !== "all" && remaining > 0 && (
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
/**
 * The owner's inline editor for a design's title and overview (2026-10-02).
 *
 * Edits the **raw `summary`**, not the bullets the Overview tab renders:
 * `toDesignPoints` splits on sentence and blank-line boundaries, so
 * round-tripping its output would quietly reflow the owner's paragraphs.
 *
 * Only ever rendered when the viewer owns the design and the view is not
 * read-only (see `isOwner` at its call site); the server's own owner check
 * is the actual enforcement, so a stale client can't write anything here.
 *
 * `title` is sent as `null` when the field is emptied, which is the server's
 * "clear it" instruction -- distinct from omitting it, which means "leave it
 * alone". That's what makes the field's placeholder honest: clearing it
 * really does restore the derived title rather than storing a blank one.
 */
function OverviewEditor({ design, onCancel, onSaved }: { design: DesignStatement; onCancel: () => void; onSaved: () => void }) {
  const apiFetch = useApiFetch();
  const [title, setTitle] = useState(design.title ?? "");
  const [summary, setSummary] = useState(design.summary ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pane, setPane] = useState<"write" | "preview">("write");

  const trimmedSummary = summary.trim();
  const trimmedTitle = title.trim();
  const summaryChanged = trimmedSummary !== (design.summary ?? "").trim();
  const titleChanged = trimmedTitle !== (design.title ?? "").trim();
  // A blank summary is the one thing the server refuses outright, so the
  // button is disabled rather than letting the request round-trip to a 400.
  const canSave = trimmedSummary.length > 0 && (summaryChanged || titleChanged) && !saving;

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      await reviseDesignOverview(apiFetch, design.id, {
        // Only send what actually changed: an unchanged field would still
        // count as a revision server-side and bump the counter for nothing.
        ...(titleChanged ? { title: trimmedTitle.length > 0 ? trimmedTitle : null } : {}),
        ...(summaryChanged ? { summary: trimmedSummary } : {}),
      });
      onSaved();
    } catch (e) {
      // Includes the 404 an older coordinator returns for this route -- the
      // server ships before the dashboard, but a mixed deploy shouldn't look
      // like a silent no-op.
      setError(e instanceof ApiError ? e.message : "could not save -- try again");
      setSaving(false);
    }
  }

  return (
    <div className="overview-editor">
      <label className="overview-editor-field">
        <span>Title</span>
        <input type="text" value={title} maxLength={120} placeholder="Leave empty to derive one from the overview" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="overview-editor-field">
        {/* Write/Preview, after GitHub -- a bare textarea gives no way to tell
            what the saved text will look like, which matters now that the
            overview is markdown rather than auto-bulleted prose. The preview
            uses the same renderer the Overview tab does, minus the review
            wiring: there is nothing to comment on in a draft. */}
        <div className="overview-editor-tabs">
          <button type="button" className={`overview-editor-tab${pane === "write" ? " active" : ""}`} onClick={() => setPane("write")}>
            Write
          </button>
          <button type="button" className={`overview-editor-tab${pane === "preview" ? " active" : ""}`} onClick={() => setPane("preview")}>
            Preview
          </button>
          <span className="overview-editor-hint"># heading &nbsp;·&nbsp; - list &nbsp;·&nbsp; &gt; quote &nbsp;·&nbsp; ``` code</span>
        </div>
        {pane === "write" ? (
          <textarea className="overview-editor-source" value={summary} rows={12} spellCheck onChange={(e) => setSummary(e.target.value)} />
        ) : (
          <div className="overview-editor-preview">{trimmedSummary.length > 0 ? <Markdown source={summary} /> : <p className="overview-editor-empty">Nothing to preview yet.</p>}</div>
        )}
      </div>
      {error && <p className="overview-editor-error">{error}</p>}
      <div className="overview-editor-actions">
        <button type="button" className="overview-editor-cancel" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="overview-editor-save" onClick={save} disabled={!canSave}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

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
  const { auth } = useAuth();
  const primary = group.members[0];
  // Owner-editable title/overview (2026-10-02). The server is the real gate
  // (403 for anyone but the owner, project admins included); this only
  // decides whether to show the affordance. `readOnly` covers /observe,
  // whose synthetic "public-viewer" identity could never match anyway --
  // belt and braces, since a public page offering an edit button that always
  // fails would be worse than not offering one.
  // `auth` is nullable (`AuthContextValue`) -- null before login, and the
  // optional chain is the whole guard: a null identity owns nothing, so the
  // comparison is false and the affordance stays hidden, which is the right
  // answer rather than something to branch on separately.
  const isOwner = auth?.developerId === primary.developerId;
  // Which design the open editor belongs to, rather than a bare boolean:
  // switching rows mid-edit then collapses the form by *derivation*, with no
  // effect to reset it. A boolean plus a reset effect would leave the next
  // design showing a form seeded from the previous one's text for one render,
  // which is exactly the cascading-render case oxlint's set-state-in-effect
  // rule is pointing at.
  const [editingId, setEditingId] = useState<string | undefined>();
  const editing = editingId === primary.id;
  const setEditing = (open: boolean) => setEditingId(open ? primary.id : undefined);
  const hasConflict = primary.status === "flagged" || flags.anyUnresolvedWarning || flags.anySemanticOverlap;
  const points = toDesignPoints(primary.summary);
  // The header takes the design's own first point, and the summary below
  // takes what's left. A summary that doesn't split into points has no
  // "rest", so the header shows a short title of it and the body shows the
  // whole thing -- that is the design's content, and the only text in this
  // pane a reviewer can highlight, so it has to be on screen.
  //
  // `DETAIL_TITLE_CHARS`, not the list row's budget: a row's title stands in
  // for a summary that is nowhere else on screen, while this one sits
  // directly above it. At the row's 120 the two were near-identical and the
  // pane read as the same sentence printed twice.
  // Whether the overview carries block-level structure the author put there
  // (2026-10-02). Decides markdown-vs-sentence-bullets at the render site
  // below, and suppresses the header stealing `points[0]`: a markdown body
  // renders in full, so taking its first line for the header would print
  // that line twice.
  const authoredMarkdown = hasMarkdownStructure(primary.summary);
  // A stored title (2026-10-02) changes this whole block: the header is then
  // the owner's own words rather than a slice of the summary, so there is
  // nothing for the body to avoid repeating and the summary renders in full.
  const headerStandsAlone = Boolean(primary.title?.trim()) || authoredMarkdown;
  const headline = headerStandsAlone ? designTitle(primary, DETAIL_TITLE_CHARS) : points.length > 0 ? points[0] : designTitle(primary, DETAIL_TITLE_CHARS);
  // **Keep this in step with `pointOffsets` below.** Without a stored title
  // the header took `points[0]`, so the body must skip it; with one, dropping
  // a point would hide a sentence of the design that appears nowhere else.
  const restPoints = headerStandsAlone ? points : points.slice(1);
  // Index of `restPoints[0]` within the unsliced `points`, which is what the
  // bullets' offset lookup has to be shifted by -- 0 when every point
  // renders, 1 when the header consumed the first.
  const restPointsOffset = headerStandsAlone ? 0 : 1;
  // Nothing to add when the header already shows the summary in full: a
  // short one is never clamped, so the body would repeat it exactly. A stored
  // title is never the summary, so the prose always has something to say.
  const showProse = points.length === 0 && (headerStandsAlone || headline !== (primary.summary ?? "").trim());
  const verdict = designVerdict(primary, flags);
  // Where each bullet sits in the summary, so a highlight located against
  // the whole summary lands on the right bullet. Indexed against `points`,
  // which still holds the one the header took -- see where the bullets
  // render for why that matters.
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
          {headline}
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

      {/* Above the tabs rather than inside Overview: the thing this design
          needs from you doesn't stop being true because you clicked
          Activity. */}
      {verdict && (
        <div className={`work-verdict ${verdict.tone}`} role="status">
          <b>{verdict.label}</b> {verdict.text}
        </div>
      )}

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
            {editing ? (
              <OverviewEditor
                design={primary}
                onCancel={() => setEditing(false)}
                onSaved={() => {
                  setEditing(false);
                  onResolved();
                }}
              />
            ) : (
              isOwner &&
              !readOnly && (
                <div className="overview-edit-row">
                  <button type="button" className="overview-edit-button" onClick={() => setEditing(true)}>
                    Edit title &amp; overview
                  </button>
                </div>
              )
            )}
            {/* No edit provenance in this panel, deliberately (removed
                2026-10-02, the day it was added). An "Edited by X · 2m ago"
                line restated what the detail header already says -- the
                owner's id and `updated 2m ago` are both up there, and only
                the owner can edit, so "by whom" was never in question. The
                "view the original overview" disclosure went with it: it was
                justified as the way to recover wording an `outdated` comment
                referred to, but such a comment already displays its own
                quoted text in the review rail, so it answered a question
                nobody had -- while sitting next to "View original plan text"
                below with a near-identical label.
                `overviewRevision`/`summaryExtracted` are still populated and
                still load-bearing (the guard against a future resynthesis
                overwriting human text, and Julian's "revised since you
                commented" marker); a revision's full history, text included,
                renders in the Activity tab as `design_overview_revised`,
                which is where "what changed when" belongs. */}
            {/* Nothing to render at all when the header above was the whole
                summary -- an empty heading over a repeat of the title is worse
                than no section, and repeating it in full is worse than both. */}
            {!editing && (authoredMarkdown || restPoints.length > 0 || showProse) && (
              <>
                <h3>What this design says it&rsquo;s doing</h3>
                {/* Two renderings, chosen by whether the text has structure in
                    it (2026-10-02). An author who wrote headings, lists or
                    several paragraphs gets exactly that back -- splitting
                    their sentences into bullets would override the structure
                    they chose. LLM-extracted prose has no structure to
                    respect and genuinely is an unreadable wall, so it keeps
                    the sentence-bullet treatment that was built for it. */}
                {authoredMarkdown ? (
                  <Markdown source={primary.summary} designId={primary.id} />
                ) : restPoints.length > 0 ? (
                  <ul className="summary-bullets">
                    {restPoints.map((line, i) => (
                      <li key={i}>
                        {/* The offset has to be read at this bullet's index in
                            the *unsliced* `points`, or every highlight anchored
                            in the summary resolves one bullet early.
                            `restPointsOffset` is that shift: 1 when the header
                            consumed `points[0]`, 0 when a stored title means
                            every point renders here (2026-10-02). Hardcoding
                            either value breaks the other case silently -- the
                            text still renders, the comments just land on the
                            wrong sentence. */}
                        <HighlightableText designId={primary.id} field="summary" text={line} offset={pointOffsets[i + restPointsOffset]} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    <HighlightableText designId={primary.id} field="summary" text={primary.summary} />
                  </p>
                )}
              </>
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
                    /* Keyed on value *and* label: "Schema touched" and "API
                       touched" share a label, so the label alone stopped being
                       unique once those two became named warnings rather than
                       ticks. */
                    <div key={`${t.n}-${t.label}`} className={`work-change-stat${t.tone ? ` ${t.tone}` : ""}`}>
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
