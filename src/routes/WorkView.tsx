import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApiFetch, ApiError } from "../api/client.js";
import { fetchDesigns, fetchDesignById, reviseDesignOverview, resynthesizeDesignOverview, applyDesignRephrase, fetchGroupOverview } from "../api/designs.js";
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
import { repoLabel } from "../lib/repoLabel.js";
import { MemberPanel } from "../components/MemberPanel.js";
import { CopyLinkButton } from "../components/CopyLinkButton.js";
import { buildShareUrl } from "../lib/urlState.js";
import { LatestCheckOutcome, SemanticOverlapNote, ResolveActions, DeclaredChanges, PathList, type SemanticOverlap } from "../components/DesignDetail.js";
import { DesignReview, HighlightableText, useHasReviewAnchors } from "../components/DesignReview.js";
import { DesignChat } from "../components/DesignChat.js";
import { bulletOffsets } from "../lib/reviewAnchors.js";
import { relativeTime } from "../lib/time.js";
import { designTitle, toDesignPoints, DETAIL_TITLE_CHARS } from "../lib/designTitle.js";
import { developerLabel } from "../lib/developerLabel.js";
import { hasMarkdownStructure } from "../lib/markdown.js";
import { splitAmendments } from "../lib/amendments.js";
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
/** Whether one row belongs in a given view.
 *
 * Status-first, because that is the axis every option but `mine` and
 * `conflicts` selects on. `conflicts` stays on `section`, not on
 * `status === "flagged"`, because a design can need attention without being
 * flagged -- an unresolved file overlap or a live semantic thread both count,
 * and `designFlags` is what already knows that.
 *
 * `active` is open-or-flagged only. Dormant is excluded on purpose: twing
 * decided nobody has touched those inside their TTL, and 23 of the 40
 * not-finished designs here are dormant, so folding them in would make
 * "Active" mostly mean "stalled".
 */
function matchesView(row: { primary: DesignStatement; section: Section }, view: DesignView, isMineRow: boolean): boolean {
  switch (view) {
    case "everything":
      return true;
    case "mine":
      return isMineRow;
    case "active":
      return row.primary.status === "open" || row.primary.status === "flagged";
    default:
      return row.primary.status === view;
  }
}

/**
 * What the list is showing (2026-10-07).
 *
 * One value, where there used to be a row of mutually-exclusive section
 * pills *plus* an orthogonal Mine toggle. Two controls that each silently
 * narrowed the same list made "why am I seeing these rows" a question with
 * two places to look, and neither of them could express "the closed ones" --
 * closed, expired and superseded were lumped into a single Resolved bucket
 * with no way to tell them apart, let alone filter between them.
 *
 * `active` leads because it is the default: live work, which on a real
 * coordinator is a small fraction of what exists (189 designs across three
 * repos, 149 of them finished). Everything past the separator is finished or
 * abandoned work, which is now something you ask for by name.
 */
type DesignView = "active" | "mine" | "dormant" | "closed" | "expired" | "superseded" | "everything";

/** Split by how often a view is wanted, not by what it filters on.
 *
 * The two people actually use daily get pills -- one click, always visible,
 * countable at a glance. The archive is five options that matter rarely and
 * would otherwise take five pills of permanent chrome to serve a question
 * asked once a week, so it folds into a selector.
 *
 * A single dropdown for all of it was tried first and was worse: it buried
 * the default view one interaction deep and made the common case cost the
 * same as the rare one. */
const QUICK_VIEWS: { value: DesignView; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "mine", label: "Mine" },
];

const ARCHIVE_VIEWS: { value: DesignView; label: string }[] = [
  { value: "dormant", label: "Dormant" },
  { value: "closed", label: "Closed" },
  { value: "expired", label: "Expired" },
  { value: "superseded", label: "Superseded" },
  { value: "everything", label: "Everything" },
];

const VIEWS = [...QUICK_VIEWS, ...ARCHIVE_VIEWS];

const SECTION_HEADING: Record<Section, string> = {
  attention: "Conflicts",
  progress: "In progress",
  resolved: "Resolved",
};

const SECTION_PAGE_SIZE = 5;

/** How far an overview must have drifted before rephrasing it is offered
 * (2026-10-06). Mirrors the coordinator's own `rephraseAvailability`, which
 * enforces the same rule -- a disabled button is a courtesy, not a control.
 *
 * Two numbers, and the difference is the whole policy: nobody is attached to
 * prose a machine wrote unattended, so one amendment makes folding it
 * worthwhile. Text a person wrote, or read and accepted, is theirs -- and
 * rewriting their paragraph to absorb a single line is a bad trade. */
const REPHRASE_THRESHOLD_MACHINE_TEXT = 1;
const REPHRASE_THRESHOLD_HUMAN_TEXT = 2;

/** Revision sources that mean a person settled on this text, by writing it or
 * by accepting a proposal. Kept in step with the server's
 * `HUMAN_REVISION_SOURCES`. */
const HUMAN_REVISION_SOURCES = ["owner_edit", "rephrase_accepted"];

/** Whether rephrasing would do anything, and if not, what to tell the reader.
 * Says nothing about *who* is asking: anyone may rephrase any design they can
 * see, and only the overview's own state decides whether the button acts. */
function rephraseState(design: DesignStatement, amendmentCount: number): { allowed: true } | { allowed: false; because: string } {
  const human = HUMAN_REVISION_SOURCES.includes(design.overviewRevisionSource ?? "");
  const needed = human ? REPHRASE_THRESHOLD_HUMAN_TEXT : REPHRASE_THRESHOLD_MACHINE_TEXT;
  if (amendmentCount >= needed) return { allowed: true };
  if (human) return { allowed: false, because: "Written by a person — not enough has changed to rephrase it." };
  if ((design.overviewRevision ?? 0) > 0) return { allowed: false, because: "Already up to date — nothing new since the last rephrase." };
  return { allowed: false, because: "Nothing to rephrase yet — no amendments since this was written." };
}

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
  /* **Everything** by default (2026-10-07).
   *
   * `active` was tried first, on the argument that finished work is four
   * fifths of a real coordinator and should be asked for. True, but it
   * overshot: on this data `active` is a single design, and a list showing
   * one row reads as broken rather than focused -- the signal it removes is
   * the signal that the screen is working.
   *
   * So the list opens complete and the pills are there to narrow it. The
   * cost of showing too much is a scroll; the cost of showing too little is
   * someone concluding the dashboard is empty. */
  const [view, setView] = useState<DesignView>("everything");
  /* Narrows whatever the dropdown selected rather than replacing it. Keeping
     these two axes separate is what preserves "my conflicts" -- the question
     the old Mine toggle existed for, and one a single-value selector cannot
     express. It also buys a question nothing could ask before: the conflicts
     among *closed* designs. */
  const [conflictsOnly, setConflictsOnly] = useState(false);
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

  /* Search narrows before the view does, so a view's count always describes
     the list it switches to. A defect in its own right when it was the other
     way round: with a search active the pills read the whole project's totals
     beside a nine-row list, which reads as the filter having failed. */
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.primary.summary.toLowerCase().includes(q) || r.primary.developerId.toLowerCase().includes(q));
  }, [rows, query]);

  // Counted off the owner- and search-filtered rows rather than every row,
  // so a pill's number always describes the list it switches to. Found while
  // testing the toggle, and a defect in its own right: with a search active
  // the pills already read the whole project's totals (12/16/25/53 beside a
  // nine-row list), which reads as the filter having silently failed.
  const counts = useMemo(() => {
    const c = {} as Record<DesignView, number>;
    for (const v of VIEWS.map((x) => x.value)) {
      c[v] = searched.filter((r) => matchesView(r, v, isMine(r.group, openThreads, auth?.developerId))).length;
    }
    return c;
  }, [searched, openThreads, auth?.developerId]);

  /* The unfiltered view is **live work only** (2026-10-07).
   *
   * It used to mean literally everything, which on a real coordinator is
   * mostly a graveyard: 100 designs in twing-cli, 79 of them closed, expired
   * or superseded. Finished designs were the bulk of the list by a factor of
   * four, sitting between the reader and the work still in flight.
   *
   * Collapsing that section was tried first and was the wrong shape -- the
   * rows were still there, still counted, just folded. Finished work is not
   * something to tidy away; it is something you should have to *ask* for.
   * Selecting the Resolved pill is that ask, and it still shows every one of
   * them. */
  const visibleRows = useMemo(
    () =>
      searched.filter(
        (r) => matchesView(r, view, isMine(r.group, openThreads, auth?.developerId)) && (!conflictsOnly || r.section === "attention"),
      ),
    [searched, view, conflictsOnly, openThreads, auth?.developerId],
  );

  /* Section headings only earn their place when the list actually spans
     sections. Every view but these two selects a single status, so a heading
     above it would be one label for the whole list. */
  const grouped = !conflictsOnly && (view === "everything" || view === "mine");

  /* Counted inside the current view, not across the project: the pill has to
     describe the list pressing it produces. */
  const conflictCount = useMemo(
    () => searched.filter((r) => matchesView(r, view, isMine(r.group, openThreads, auth?.developerId)) && r.section === "attention").length,
    [searched, view, openThreads, auth?.developerId],
  );

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
    /* `everything`, not the default `active`: the design being jumped to is
       very often closed or superseded -- that is usually *why* it was the
       counterpart of a conflict -- and landing on a filter that excludes it
       would silently do nothing. */
    setView("everything");
    setConflictsOnly(false);
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
          {/* Conflicts keeps a pill of its own. It is why someone opens this
              screen, and a thing you open this screen for should never be a
              menu away. */}
          <button
            type="button"
            className={`work-pill${conflictsOnly ? " active" : ""}`}
            aria-pressed={conflictsOnly}
            onClick={() => setConflictsOnly((v) => !v)}
          >
            Conflicts {conflictCount}
          </button>
          {/* Everything else is one selector. Two controls that each silently
              narrowed the same list -- section pills plus an orthogonal Mine
              toggle -- made "why am I seeing these rows" a question with two
              places to look, and neither could express "the closed ones":
              closed, expired and superseded were one Resolved bucket with no
              way to tell them apart. */}
          {QUICK_VIEWS.map((v) => (
            <button key={v.value} type="button" className={`work-pill${view === v.value ? " active" : ""}`} onClick={() => setView(v.value)}>
              {v.label} {counts[v.value]}
            </button>
          ))}
          <span className="work-filter-divider" aria-hidden="true" />
          {/* The archive. Shown as a selector rather than five more pills:
              these are asked for rarely, and permanent chrome for a weekly
              question crowds out the daily ones. It carries the active style
              when one of its own values is selected, so the bar always shows
              where the list came from. */}
          <label className={`work-view-select${ARCHIVE_VIEWS.some((v) => v.value === view) ? " active" : ""}`}>
            <select value={ARCHIVE_VIEWS.some((v) => v.value === view) ? view : ""} onChange={(e) => setView(e.target.value as DesignView)} aria-label="Finished work">
              {/* No ellipsis: the caret already says there is more behind
                  it, and "Finished…" read as a truncated word. */}
              <option value="" disabled>
                Finished
              </option>
              {ARCHIVE_VIEWS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label} ({counts[v.value]})
                </option>
              ))}
            </select>
          </label>
          {/* `readOnly` is /observe, whose synthetic "public-viewer" identity
              owns nothing -- Mine would only ever empty the list for it. */}
          {readOnly && <span className="work-filter-note">viewing publicly</span>}
        </div>

        {visibleRows.length === 0 ? (
          <p className="empty-state">No designs match this filter.</p>
        ) : (
          <div className="work-rows">
            {(grouped ? (["attention", "progress", "resolved"] as Section[]) : (["progress"] as Section[])).map((section) => {
              const inSection = grouped ? visibleRows.filter((r) => r.section === section) : visibleRows;
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
                  {grouped && (
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
                        {showRepoBadge && uniqueBy(group.members, (m) => m.projectId).map((m) => <RepoBadge key={m.projectId} short project={projectsById[m.projectId] ?? { projectId: m.projectId }} />)}
                        {/* Shortened for the row, full id on hover -- see
                            lib/developerLabel.ts for why the raw value is
                            the wrong thing to clip. */}
                        <span className="dev" title={primary.developerId}>
                          {developerLabel(primary.developerId)}
                        </span>
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
                  {!grouped && remaining > 0 && (
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
function OverviewEditor({
  design,
  initialSummary,
  onCancel,
  onSaved,
}: {
  design: DesignStatement;
  /** Seeds the textarea with something other than the stored summary --
   * the coordinator's proposed rewrite (2026-10-06). The editor is where a
   * proposal is reviewed, rather than a dialog of its own, so the owner can
   * edit it before saving and the save is the same save as any other. */
  initialSummary?: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const apiFetch = useApiFetch();
  const [title, setTitle] = useState(design.title ?? "");
  const [summary, setSummary] = useState(initialSummary ?? design.summary ?? "");
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

function MemberChanges({ member, showHeading = true }: { member: DesignStatement; showHeading?: boolean }) {
  const apiFetch = useApiFetch();
  const claimsState = useAsyncData(() => fetchClaims(apiFetch, member.projectId, member.sessionId), [apiFetch, member.projectId, member.sessionId]);

  return (
    <>
      {hasStructuredChanges(member.changes) ? (
        <DeclaredChanges designId={member.id} changes={member.changes} claims={claimsState.status === "ready" ? claimsState.data : []} showHeading={showHeading} />
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

/**
 * One row of the design's activity (2026-10-06).
 *
 * This tab used to render `formatted.label` and drop `formatted.details` --
 * so an amended design showed "Design amended" three times and said nothing
 * about what any of them changed, while `ActivityView`, the standalone page,
 * rendered both halves from the same helper.
 *
 * That was cosmetic while the amendment text was still visible in the
 * overview. It stopped being cosmetic the moment a rewrite began *removing*
 * that text (`overview-resynthesis.ts`, server-side): the activity log is
 * then the only place the original wording survives, and a log that says
 * "Design amended" is no record at all. Reuses `.activity-details` from
 * `ActivityView`'s own markup rather than inventing a second look for the
 * same thing.
 *
 * Clamped, with the row expanding on click: a `newSummary` payload carries a
 * design's whole overview, and three of those at full height turn a list
 * meant for scanning into a wall.
 */
function ActivityRow({ event }: { event: ActivityEvent }) {
  const [expanded, setExpanded] = useState(false);
  const formatted = formatActivityEvent(event);
  if (formatted.details.length === 0) {
    return (
      <li className="work-activity-item">
        <span className="work-activity-time">{relativeTime(event.ts)}</span>
        <span>{formatted.label}</span>
      </li>
    );
  }
  return (
    <li className="work-activity-item">
      <span className="work-activity-time">{relativeTime(event.ts)}</span>
      <div className="work-activity-body">
        <button type="button" className="work-activity-label" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {formatted.label}
        </button>
        <dl className={`activity-details${expanded ? "" : " clamped"}`}>
          {formatted.details.map((d) => (
            <div key={d.label} className="activity-detail-field">
              <dt>{d.label}</dt>
              <dd>{d.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </li>
  );
}

/**
 * One design's overview, derived.
 *
 * Shared by the detail header -- which shows the group's first member as its
 * `headline` -- and by `DesignOverviewSection` below, so the rule deciding
 * whether the header already consumed the overview's first sentence lives in
 * one place instead of being restated either side of it.
 *
 * `isPrimary` is the whole reason this takes a flag. The header is built from
 * `group.members[0]`, so only that member's body has to skip the point the
 * header took. A linked sibling's text is never in the header at all, so it
 * always renders in full -- skipping its first sentence would drop a line of
 * its design with nothing on the page to show it had ever been there.
 */
function deriveOverview(design: DesignStatement, isPrimary: boolean) {
  const { base, amendments } = splitAmendments(design.summary);
  const points = toDesignPoints(base);
  const authoredMarkdown = hasMarkdownStructure(base);
  const overviewWasComposed = (design.overviewRevision ?? 0) > 0;
  const headerStandsAlone = !isPrimary || Boolean(design.title?.trim()) || authoredMarkdown || overviewWasComposed;
  const headline = headerStandsAlone || points.length === 0 ? designTitle(design, DETAIL_TITLE_CHARS) : points[0];
  const restPoints = headerStandsAlone ? points : points.slice(1);
  const restPointsOffset = headerStandsAlone ? 0 : 1;
  const showProse = points.length === 0 && (headerStandsAlone || headline !== base.trim());
  const pointOffsets = bulletOffsets(base, points);
  return { base, amendments, points, authoredMarkdown, headerStandsAlone, headline, restPoints, restPointsOffset, showProse, pointOffsets };
}

/**
 * Which repo one design in a linked group belongs to, as a section label.
 *
 * Deliberately **not** `RepoBadge` (2026-10-07). That is a chip, and a chip
 * is right where the repo is one more piece of metadata about a card -- a
 * list row, the detail header, a member panel. Here the repo is not metadata
 * about the block, it *is* the block's heading: it says which half of a
 * two-repo change you are reading. A pill in that position reads as a tag
 * somebody attached rather than as a title, which is what made the overview
 * look like two tagged cards instead of one change with two parts.
 *
 * The owner is dimmed because it repeats on every label in the group and
 * carries none of the distinction -- `twing-dev/` is the same on both lines,
 * and `twing-cli` versus `twing-monitor` is the whole message.
 */
function RepoScopeLabel({ project }: { project: Pick<ProjectSummary, "githubOwner" | "githubRepo" | "projectId"> }) {
  const label = repoLabel(project);
  const split = project.githubOwner && project.githubRepo ? { owner: project.githubOwner, repo: project.githubRepo } : undefined;
  return (
    <span className="overview-repo-label">
      {/* A project with no GitHub binding has only a raw projectId, which has
          no owner half to dim -- shown whole rather than split at a slash
          that isn't there. */}
      {split ? (
        <>
          <span className="overview-repo-owner">{split.owner}/</span>
          {split.repo}
        </>
      ) : (
        label
      )}
    </span>
  );
}

/** Whether this design has prose of its own left to render under the
 * overview heading -- the same test the body's own render guard makes.
 *
 * Exists so the panel can decide *which* design in a linked group carries the
 * single heading, without reaching into a section's state. A design whose
 * whole summary was promoted into the detail header has nothing below it, and
 * putting the heading there would leave it stranded. */
function hasOverviewBody(design: DesignStatement, isPrimary: boolean): boolean {
  const { authoredMarkdown, restPoints, showProse } = deriveOverview(design, isPrimary);
  return authoredMarkdown || restPoints.length > 0 || showProse;
}

/**
 * One design's overview prose, with the controls that act on it.
 *
 * Extracted from `DesignDetailPane` (2026-10-07) to fix a group rendering
 * only `group.members[0]`: a design spanning two repos showed the first
 * repo's overview and dropped the sibling's entirely, while the plan text and
 * the change tiles either side of it had been per-member all along. Found
 * live on a twing-cli + twing-monitor group whose two overviews were
 * different text -- the one on screen even said "the twing-cli sibling
 * carries the schema, store method and route", pointing at prose the page
 * then refused to show.
 *
 * **State is per instance, not keyed by design id in the pane.** Two
 * overviews on screen each need their own editor, proposal, skeleton and
 * error; one set of `useState`s above them would have put a rephrase of one
 * design under both. Rendered with `key={member.id}`, so moving to another
 * group remounts and the form collapses by derivation rather than by an
 * effect -- the same reasoning the pane's `editingId` was written for, now
 * carried by the component boundary itself.
 *
 * Every affordance here is per design, because none of them is a property of
 * the group: `isOwner` compares against *this* design's developer (repos can
 * have different owners), and `rephraseState` reads this design's own
 * revision source and amendment count.
 */
function DesignOverviewSection({
  design,
  isPrimary,
  showBadge,
  project,
  readOnly,
  onResolved,
}: {
  design: DesignStatement;
  isPrimary: boolean;
  showBadge: boolean;
  /** Whether this design carries the group's single overview heading -- true
   * for the first member with prose to show. See the call site. */
  project: ProjectSummary | { projectId: string };
  readOnly?: boolean;
  onResolved: () => void;
}) {
  const apiFetch = useApiFetch();
  const { auth } = useAuth();
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
  const isOwner = auth?.developerId === design.developerId;
  const [editing, setEditing] = useState(false);
  // The coordinator's proposed rewrite, held until it is kept or discarded
  // (2026-10-06). Nothing is saved from here.
  const [proposal, setProposal] = useState<string | undefined>();
  const [rewriting, setRewriting] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [rewriteError, setRewriteError] = useState<string | undefined>();

  // The design's own text, and the amendments appended to it (2026-10-06).
  // Everything below reads `base`, never the raw summary: an amended design
  // used to render its changelog as peers of its own sentences, so a design
  // amended five times read as one statement of intent and five dated lines
  // competing for the same attention. The amendments render in their own
  // disclosure at the foot of this section -- nothing is hidden, and because
  // `base` is a literal prefix at offset 0 and each amendment keeps its true
  // offset, not one review anchor moves. See `lib/amendments.ts`.
  const { base: overviewBase, amendments, authoredMarkdown, restPoints, restPointsOffset, showProse, pointOffsets } = deriveOverview(design, isPrimary);

  /** Whether to offer the owner a rewrite rather than wait for one
   * (2026-10-06). Both halves matter: the coordinator refuses to rewrite an
   * overview a person wrote (`owner_edit`), so without this the design most
   * worth folding -- someone's own text with a pile on top -- would be the
   * one nothing ever offers to fold. Computed from fields already on the row,
   * so it costs no request and needs no server flag. */
  const overviewIsOwnWork = design.overviewRevisionSource === "owner_edit";
  const rephrase = rephraseState(design, amendments.length);
  // The owner still gets told when their own text has drifted far enough to
  // be worth replacing -- the automatic path will never do it for them.
  const nudgeToRewrite = overviewIsOwnWork && rephrase.allowed;

  async function rewriteOverview() {
    setRewriting(true);
    setRewriteError(undefined);
    try {
      const { summary } = await resynthesizeDesignOverview(apiFetch, design.id);
      if (!summary) {
        // A 200 with nothing in it: no amendments to fold, or this
        // coordinator has no model configured. Neither is a failure, and
        // saying "try again" about either would be a lie.
        setRewriteError("Nothing to rewrite — this design's overview is already its own text.");
        return;
      }
      // Only the proposal -- the card renders it where the overview was. It
      // used to open the editor here too, which is exactly what made a
      // finished rewrite look like an empty form.
      setProposal(summary);
    } catch (e) {
      // The 404 is the mixed-deploy case: the server ships before the
      // dashboard, so a coordinator that predates this route is expected
      // rather than broken, and deserves to be named as such.
      setRewriteError(
        e instanceof ApiError && e.status === 404
          ? "This coordinator is too old to rewrite overviews — the rest of this page works as normal."
          : "Couldn't rewrite — try again.",
      );
    } finally {
      setRewriting(false);
    }
  }

  /** Accepting the proposal (2026-10-06). Goes through the apply route, which
   * carries no text and stores the coordinator's own proposal -- so a
   * teammate can accept a rephrase without being able to write arbitrary
   * words into someone else's design. One click, because the reading already
   * happened on screen. */
  async function keepProposal() {
    if (proposal === undefined) return;
    setKeeping(true);
    setRewriteError(undefined);
    try {
      await applyDesignRephrase(apiFetch, design.id);
      setProposal(undefined);
      onResolved();
    } catch {
      // Left on screen rather than discarded: the proposal is the only copy,
      // and throwing it away because a save failed would make the owner ask
      // for it a second time.
      setRewriteError("Couldn't save that rewrite — try again, or edit it first.");
    } finally {
      setKeeping(false);
    }
  }

  return (
    /* Scoped to a repo -> its own card (2026-10-07). A label on a row above
       loose prose did not say the prose was *that repo's*: the eye had
       nothing joining them, so the two halves of a change still read as one
       continuous overview with labels floating in it. Enclosing each half
       makes the boundary the thing you see first. Only when the group spans
       repos -- a lone design is the whole panel and needs no box drawn around
       it. */
    <div className="work-overview-section work-scope-card">
      {/* Which repo this overview belongs to. Only for a real group: a group
          of one already has the repo in the detail header above, so badging
          it again would be noise on the overwhelmingly common case.

          It shares a row with this design's own controls rather than sitting
          on a line of its own: the repo label and the buttons both answer
          "which design does this act on", so splitting them over two rows
          spent vertical space saying the same thing twice. */}
      {editing ? (
        <OverviewEditor
          design={design}
          initialSummary={proposal}
          onCancel={() => {
            setEditing(false);
            setProposal(undefined);
          }}
          onSaved={() => {
            setEditing(false);
            setProposal(undefined);
            onResolved();
          }}
        />
      ) : proposal !== undefined ? (
        /* The proposal, shown **in place of** the overview rather than
           as a form (2026-10-06).

           It used to open the ordinary editor seeded with the proposed
           text, which tested badly for an honest reason: that form is
           pixel-identical to "Edit title & overview", so the result read
           as "nothing happened, now type it yourself" even though the
           rewrite was sitting right there. The fix is to show the
           *outcome*, styled as a proposal, and make accepting it one
           click -- so it reads as rewritten the moment it arrives, while
           still being unsaved until somebody says so.

           Rendered through `Markdown` with no `designId`, the same rule
           the editor's preview follows: there is nothing to comment on
           in text that is not stored yet, and wiring it to the review
           context would let a draft write into the rail. */
        <div className="overview-proposal">
          <div className="overview-proposal-banner">
            <b>Proposed rewrite</b> — folds {amendments.length} amendment{amendments.length === 1 ? "" : "s"} into one current description. Nothing is saved yet.
          </div>
          <div className="overview-proposal-body">
            <Markdown source={proposal} />
          </div>
          {rewriteError && <p className="overview-editor-error">{rewriteError}</p>}
          <div className="overview-proposal-actions">
            <button type="button" className="overview-proposal-discard" onClick={() => setProposal(undefined)} disabled={keeping}>
              Discard
            </button>
            {/* Opens the ordinary editor already seeded with the
                proposal -- the escape hatch for "nearly right", without
                making everyone pass through a textarea to accept text
                they are happy with. */}
            <button type="button" className="overview-proposal-edit" onClick={() => setEditing(true)} disabled={keeping}>
              Edit first
            </button>
            <button type="button" className="overview-proposal-keep" onClick={keepProposal} disabled={keeping}>
              {keeping ? "Saving…" : "Keep it"}
            </button>
          </div>
        </div>
      ) : (
        !readOnly && (
          <>
            {/* Offered, never done to them: the coordinator leaves an
                overview its owner wrote alone however deep the pile
                gets, so a person pressing this is the only way that
                design ever gets folded. */}
            {nudgeToRewrite && (
              <div className="overview-nudge" role="status">
                <b>{amendments.length} amendments since you wrote this overview.</b> Rephrasing folds them into one current description. You see it before anything is saved.
              </div>
            )}
            <div className="overview-edit-row">
              {/* Which design the buttons on this row act on. Leads the row
                  rather than sitting above it, so a reader scanning a
                  two-repo group reads "twing-cli — rephrase / edit" as one
                  statement. */}
              {showBadge && <RepoScopeLabel project={project} />}
              {/* **Shown to everyone, always** (2026-10-06). Rephrasing
                  is reading work: it produces a proposal from text the
                  reader can already see, and accepting it stores the
                  coordinator's own words, never theirs. Hiding it when
                  inert only made people learn a rule they could not
                  see, so it stays on screen and carries its reason
                  instead -- which the server enforces independently. */}
              <button
                type="button"
                className="overview-rewrite-button"
                onClick={rewriteOverview}
                disabled={rewriting || !rephrase.allowed}
                title={rephrase.allowed ? undefined : rephrase.because}
              >
                {rewriting ? "Rephrasing…" : "Rephrase overview"}
              </button>
              {/* Editing is a different act: arbitrary words, owner
                  only, server-enforced. Unchanged by any of the above. */}
              {isOwner && (
                <button type="button" className="overview-edit-button" onClick={() => setEditing(true)}>
                  Edit title &amp; overview
                </button>
              )}
            </div>
            {rewriteError && <p className="overview-editor-error">{rewriteError}</p>}
          </>
        )
      )}

      {/* A skeleton where the overview is, not a line beside it
          (2026-10-06). The button's own label is too quiet for a call
          that takes a second or two -- the first round of this feature
          read as "nothing happened" partly because of that. Shaped like
          the text it is replacing, so the page says "this is being
          rewritten" rather than "something is loading somewhere".
          Cached proposals come back instantly and never show it. */}
      {rewriting && (
        <div className="overview-skeleton" role="status" aria-label="Rephrasing this overview">
          <span className="overview-skeleton-line" />
          <span className="overview-skeleton-line" />
          <span className="overview-skeleton-line short" />
        </div>
      )}

      {/* Nothing to render at all when the header above was the whole
          summary -- an empty heading over a repeat of the title is worse
          than no section, and repeating it in full is worse than both.
          Only ever reachable for the primary: a sibling's text is never in
          the header, so it always has something to say. */}
      {!editing && proposal === undefined && !rewriting && (authoredMarkdown || restPoints.length > 0 || showProse) && (
        <>
          {/* Two renderings, chosen by whether the text has structure in
              it (2026-10-02). An author who wrote headings, lists or
              several paragraphs gets exactly that back -- splitting
              their sentences into bullets would override the structure
              they chose. LLM-extracted prose has no structure to
              respect and genuinely is an unreadable wall, so it keeps
              the sentence-bullet treatment that was built for it. */}
          {authoredMarkdown ? (
            <Markdown source={overviewBase} designId={design.id} />
          ) : restPoints.length > 0 ? (
            <ul className="summary-bullets">
              {restPoints.map((line, i) => (
                <li key={i}>
                  {/* The offset has to be read at this bullet's index in
                      the *unsliced* `points`, or every highlight anchored
                      in the summary resolves one bullet early.
                      `restPointsOffset` is that shift: 1 when the header
                      consumed `points[0]`, 0 when a stored title -- or
                      being a linked sibling -- means every point renders
                      here. Hardcoding either value breaks the other case
                      silently: the text still renders, the comments just
                      land on the wrong sentence. */}
                  <HighlightableText designId={design.id} field="summary" text={line} offset={pointOffsets[i + restPointsOffset]} />
                </li>
              ))}
            </ul>
          ) : (
            <p>
              <HighlightableText designId={design.id} field="summary" text={overviewBase} />
            </p>
          )}
        </>
      )}

      {/* The amendments, folded (2026-10-06). Its own section rather
          than more bullets in the body above: an `Update (date):` entry
          is the design's history, and giving it the same bullet as the
          design's own sentences is what made an amended overview
          unreadable. Collapsed by default -- the current position is
          what a reviewer opens a design for; the trail is there when
          they want it.

          Each entry renders at its **true offset** in the summary, so
          any comment anchored inside an amendment still resolves. Sits
          inside the same `DesignReview` scope as everything else in the
          panel, so those comments land in the same rail.

          Rendered independently of the body section above, not nested
          in it: a design whose entire base was consumed by the header
          still has amendments worth showing.

          Hidden while a proposal is on screen: the proposal's whole
          claim is that it has folded these in, so showing them beside it
          invites a comparison the reader cannot act on until they decide.
          They come straight back on Discard. */}
      {!editing && proposal === undefined && !rewriting && amendments.length > 0 && (
        <details className="work-amendments">
          <summary>
            {amendments.length} amendment{amendments.length === 1 ? "" : "s"} since this was written
          </summary>
          <ul className="work-amendment-list">
            {amendments.map((amendment) => (
              <li key={amendment.offset}>
                <span className="work-amendment-date">{amendment.date}</span>
                <HighlightableText designId={design.id} field="summary" text={amendment.text} offset={amendment.offset} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* This design's own plan, inside this design's own card (moved here
          2026-10-07 from a block of its own below the overviews).

          Collapsed by default, on purpose: `summary` above is already an
          LLM-generated paraphrase of this, produced once at registration
          (design-extract.ts) -- most readers want that, not the raw plan.
          Every design carries one -- an ExitPlanMode plan or a template's
          `plan:`; the coordinator refuses to register a design without
          (2026-09-29).

          Hidden while the editor or a proposal is open, like everything else
          in this section: those replace the design's text, and leaving the
          plan behind under them invited a comparison against prose that is
          not saved yet. */}
      {!editing && proposal === undefined && !rewriting && design.rawPlanExcerpt && (
        <div className="work-raw-plans">
          <RawPlan designId={design.id} text={design.rawPlanExcerpt} />
        </div>
      )}
    </div>
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
  // The header takes the design's own first point, and the overview section
  // below takes what's left -- `deriveOverview` owns that split now, for this
  // design and for every linked sibling, so the two cannot disagree about
  // which sentence the header consumed. Only `headline` is needed up here;
  // the rest is the section's business.
  //
  // `DETAIL_TITLE_CHARS`, not the list row's budget: a row's title stands in
  // for a summary that is nowhere else on screen, while this one sits
  // directly above it. At the row's 120 the two were near-identical and the
  // pane read as the same sentence printed twice.
  const { headline } = deriveOverview(primary, true);
  const verdict = designVerdict(primary, flags);
  // The Conflict tab's own count badge -- how many members in this group
  // (a linked design can span repos) actually have something to show under
  // it, same "flagged, or a live overlap" test the tab's own visibility
  // already uses, just counted per member instead of collapsed to a
  // boolean.
  const conflictMemberCount = group.members.filter((m) => m.status === "flagged" || findSemanticOverlapThread(openThreads, m.id) || flags.anyUnresolvedWarning).length;
  /** Every member's declared changes, for the group-level stat tiles. A group
   * of one yields exactly `primary.changes`, so the common case is unchanged. */
  const groupChanges = group.members.flatMap((m) => m.changes ?? []);
  /** Whether each design's blocks carry a repo label (2026-10-07).
   *
   * The view's own rule, not the group's. This used to be `spansRepos` --
   * label and card only when a group straddled repos -- which meant a design
   * in one repo and a design across two were drawn as two different UIs: bare
   * prose in one, labelled cards in the other. A reader should not have to
   * learn a second layout because somebody's work happened to span
   * repositories, so the card is now unconditional and only the label follows
   * `showRepoBadge`, exactly as every other repo label on this page does.
   *
   * The cost is a same-repo group of several designs repeating one label per
   * card. That is accurate, if unhelpful; the card boundary is what separates
   * those, and the label is what names them. */
  const labelRepos = showRepoBadge;

  const activityState = useAsyncData(
    () =>
      Promise.all(group.members.map((m) => fetchActivity(apiFetch, m.projectId, { relatedId: m.id, limit: 50 }))).then((pages) =>
        pages.flatMap((p) => p.items).sort((a, b) => b.ts - a.ts),
      ),
    [apiFetch, group.key, tab === "activity"],
  );
  // One combined overview across the whole group, in place of one section per
  // member (2026-10-09). `group.members.length > 1` is the only new branch --
  // a group of one skips the request entirely and renders exactly as before.
  // Falls back to the existing per-member sections (below) whenever there's
  // nothing to show yet: loading, an error, or the coordinator genuinely has
  // no combined overview to offer (no model configured, or not enough members
  // this viewer can see) -- never a reason to hide the real, editable
  // per-member text that's still there underneath.
  const isGroup = group.members.length > 1;
  const groupOverviewState = useAsyncData(() => (isGroup ? fetchGroupOverview(apiFetch, primary.id) : Promise.resolve({ overview: null })), [apiFetch, group.key, isGroup]);
  const combinedOverview = isGroup && groupOverviewState.status === "ready" ? groupOverviewState.data.overview : null;

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
            {/* **One overview per linked design** (2026-10-07), not just
                `group.members[0]`. A design spanning two repos used to render
                the first repo's overview and drop the sibling's text
                entirely, while the plan text and the change tiles below had
                always been per-member. Which member won was arbitrary on top
                of that: `dedupeDesignsByGroup` pushes members in the order the
                projects' pages happened to return them and sorts only the
                groups, so a reload could change whose overview you read.

                A group of one renders exactly as before -- one section, no
                badge -- which is the overwhelmingly common case.

                **One heading for the whole group**, not one per design. A
                linked group is one piece of work that happens to span repos,
                so repeating "What this design says it's doing" above each
                half read as two unrelated designs stacked up, and said the
                same sentence twice on a page already short of room. The
                repo label on each design's own control row is what tells the
                two apart.

                It sits here, above the cards, always: it introduces the whole
                group, and printing it inside a card would make it that
                design's heading rather than the section's. */}
            {combinedOverview ? (
              <>
                <h3 className="work-changes-heading">What this design says it&rsquo;s doing</h3>
                <p className="work-combined-overview">{combinedOverview}</p>
              </>
            ) : (
              <>
                {group.members.some((m) => hasOverviewBody(m, m.id === primary.id)) && <h3 className="work-changes-heading">What this design says it&rsquo;s doing</h3>}
                {group.members.map((member) => (
                  <DesignOverviewSection
                    key={member.id}
                    design={member}
                    isPrimary={member.id === primary.id}
                    showBadge={labelRepos}
                    project={projectsById[member.projectId] ?? { projectId: member.projectId }}
                    readOnly={readOnly}
                    onResolved={onResolved}
                  />
                ))}
              </>
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

            {/* The raw plans used to sit here, as their own block of
                repo-pill-then-disclosure pairs (moved into each design's own
                section, 2026-10-07). On a cross-repo group that put the same
                repo on the page twice in two different idioms -- a card
                header above, a pill below -- for two things that belong to
                one design. Each design now carries its own plan inside its
                own card, so a repo appears once and everything under that
                label is that repo's. */}

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
                  it.

                  **The heading is printed once, here** (2026-10-07), not by
                  each member's `DeclaredChanges`. Two linked designs meant
                  two identical "What's changing" headings under two copies of
                  the same title, which read as one panel rendered twice. The
                  repo label on each card is what tells them apart, exactly as
                  in the overview above -- one idiom for the whole tab rather
                  than cards at the top and pill-tagged panels at the bottom.

                  Rendered only when some member actually has something to
                  show, since `MemberChanges` falls back to bare path lists
                  for a design with no structured changes and those carry
                  their own titles. */}
              {group.members.some((m) => hasStructuredChanges(m.changes)) && <h3 className="work-changes-heading">What&rsquo;s changing</h3>}
              {group.members.map((member) => (
                <div key={member.id} className="work-scope-card">
                  {labelRepos && (
                    <div className="overview-edit-row">
                      <RepoScopeLabel project={projectsById[member.projectId] ?? { projectId: member.projectId }} />
                    </div>
                  )}
                  <MemberPanel member={member} members={group.members} showRepoBadge={false} projectsById={projectsById}>
                    <MemberChanges member={member} showHeading={false} />
                  </MemberPanel>
                </div>
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
          {/* Carded, like Overview's blocks (2026-10-07). The entries were
              already separated by rules; what they lacked was an edge, so the
              list floated at the full width of the panel while every other
              tab's content sat inside something. Switching tabs read as
              moving between two differently-built pages. The card is the same
              `work-scope-card`, so its `overflow: hidden` clips the row rules
              to the radius exactly as it does the declared-changes rows. */}
          {activityState.status === "ready" && activityState.data.length > 0 && (
            <div className="work-scope-card work-activity-card">
              <ul className="work-activity-list">
                {activityState.data.map((event) => (
                  <ActivityRow key={event.id} event={event} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
