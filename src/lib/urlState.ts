export type TabId = "designs" | "reviews" | "activity" | "threads" | "members" | "constraints";

const TAB_IDS: readonly TabId[] = ["designs", "reviews", "activity", "threads", "members", "constraints"];

export interface UrlViewState {
  /** Empty -- list view. One or more -- detail view (one repo is just the N=1 case of an aggregate). */
  repoIds: string[];
  /** Meaningless/ignored when `repoIds` is empty. */
  tab: TabId;
  /** A design id (tab === "designs") or review id (tab === "reviews") to auto-expand. */
  focusId?: string;
}

function isTabId(value: string | null): value is TabId {
  return value !== null && (TAB_IDS as readonly string[]).includes(value);
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
  const tabRaw = params.get("tab");
  return { repoIds, tab: isTabId(tabRaw) ? tabRaw : "designs", focusId: params.get("focus") ?? undefined };
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
