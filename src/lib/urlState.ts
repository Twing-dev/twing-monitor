export type TabId = "overview" | "designs" | "conflicts" | "hotspots" | "activity" | "members" | "constraints";

const TAB_IDS: readonly TabId[] = ["overview", "designs", "conflicts", "hotspots", "activity", "members", "constraints"];

export interface UrlViewState {
  /** Empty -- list view. One or more -- detail view (one repo is just the N=1 case of an aggregate). */
  repoIds: string[];
  /** Meaningless/ignored when `repoIds` is empty. */
  tab: TabId;
  /** A design id (tab === "designs") or a conflict id -- review or thread,
   * tab === "conflicts" tries both (tab === "conflicts") -- to auto-expand. */
  focusId?: string;
}

/** `"reviews"`/`"threads"` (2026-09 conflict-tab unification: Reviews and
 * Alignment threads merged into one Conflicts tab) -- a pasted link from
 * before the merge still names one of the old tab ids. Mapped to
 * `"conflicts"` rather than silently falling back to `"designs"`, since
 * `focusId` (a review or thread id either way) still resolves correctly
 * there -- `ConflictsView` tries a review lookup then a thread lookup for
 * any focus id, regardless of which old tab it came from. */
function normalizeTabId(value: string | null): TabId {
  if (value === "reviews" || value === "threads") return "conflicts";
  return (TAB_IDS as readonly string[]).includes(value ?? "") ? (value as TabId) : "overview";
}

export function parseUrlState(search: string = window.location.search): UrlViewState {
  const params = new URLSearchParams(search);
  const reposRaw = params.get("repos");
  const repoIds = reposRaw
    ? reposRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return { repoIds, tab: normalizeTabId(params.get("tab")), focusId: params.get("focus") ?? undefined };
}

function buildUrlSearch(state: UrlViewState): string {
  if (state.repoIds.length === 0) return "";
  const params = new URLSearchParams({ repos: state.repoIds.join(","), tab: state.tab });
  if (state.focusId) params.set("focus", state.focusId);
  return `?${params.toString()}`;
}

function apply(method: "pushState" | "replaceState", state: UrlViewState): void {
  const search = buildUrlSearch(state);
  if (search === window.location.search) return;
  window.history[method](null, "", `${window.location.pathname}${search}`);
}

/** Adds a browser-history entry -- for real navigation (selecting a repo, switching tabs). */
export function pushUrlState(state: UrlViewState): void {
  apply("pushState", state);
}

/** No new history entry -- for restoring/normalizing the URL on load. */
export function replaceUrlState(state: UrlViewState): void {
  apply("replaceState", state);
}

/** Absolute, clipboard-ready URL for one card. Always scoped to a single repo
 * -- a card belongs to exactly one projectId regardless of the sharer's own
 * current multi-repo selection. */
export function buildShareUrl(repoId: string, tab: TabId, focusId: string): string {
  return `${window.location.origin}${window.location.pathname}${buildUrlSearch({ repoIds: [repoId], tab, focusId })}`;
}
