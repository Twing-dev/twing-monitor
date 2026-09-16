import { useCallback, useEffect, useMemo, useState } from "react";
import { useApiFetch, ApiError, type Fetcher } from "../api/client.js";
import { fetchReviews, fetchReviewById, decideReview } from "../api/reviews.js";
import { fetchAlignmentThreads, fetchAlignmentThread } from "../api/alignmentThreads.js";
import type { AlignmentThread, PendingReview, ProjectSummary } from "../api/types.js";
import { useOnDemandDesigns } from "../hooks/useOnDemandDesigns.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { CopyLinkButton } from "../components/CopyLinkButton.js";
import { RepoBadge } from "../components/RepoBadge.js";
import { buildShareUrl } from "../lib/urlState.js";
import { buildConflictItems, type ConflictStage } from "../lib/aggregate.js";
import { ReviewCardHeaderContent, ReviewCardBody } from "./ReviewsView.js";
import { ThreadCardHeaderContent, ThreadDetail } from "./AlignmentThreadsView.js";

/** Reviews (admin approve/reject queue) and Alignment threads (party
 * reply/close conversation) merged into one tab (2026-09 conflict-tab
 * unification): both are "a conflict between two people's work, at some
 * stage of getting resolved" -- keeping them as two unrelated-sounding tabs
 * with no explanation of which one to check was the core "not intuitive"
 * complaint this addresses. The underlying records and their real actions
 * stay separate (`ReviewCardBody`/`ThreadDetail`, imported rather than
 * reimplemented) -- only the list they're browsed from is shared. */

const FILTERS: { value: ConflictStage | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open_discussion", label: "Open discussion" },
  { value: "awaiting_approval", label: "Awaiting approval" },
  { value: "resolved", label: "Resolved" },
];

export function stageBadgeText(stage: ConflictStage): string {
  switch (stage) {
    case "open_discussion":
      return "open discussion";
    case "awaiting_approval":
      return "needs admin approval";
    case "resolved":
      return "resolved";
  }
}

async function resolveConflict(
  apiFetch: Fetcher,
  id: string,
  readOnly: boolean | undefined,
): Promise<{ kind: "review"; review: PendingReview } | { kind: "thread"; thread: AlignmentThread } | undefined> {
  // A public "observe" viewer's identity gets a 404 from GET /v1/reviews/:id
  // by construction (app.ts's isPublicViewer guard is GET-only for threads,
  // not reviews) -- skip the doomed lookup rather than round-tripping a 404
  // every time, same reasoning RepoDetailLayout's own readOnly-gated
  // `pending` fetch already applies.
  if (!readOnly) {
    try {
      const { item } = await fetchReviewById(apiFetch, id);
      return { kind: "review", review: item };
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
  }
  try {
    const { thread } = await fetchAlignmentThread(apiFetch, id);
    return { kind: "thread", thread };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }
}

/** A copy-link URL names one conflict (review or thread id) to look at --
 * tries the review endpoint first, falls back to the thread endpoint, same
 * "resolve directly by id" convention the old ReviewFocusedPage/
 * ThreadFocusedPage each used independently before this merge. */
function ConflictFocusedPage({
  projectIds,
  projectsById,
  focusConflictId,
  onOpenDesign,
  onClearFocus,
  readOnly,
}: {
  projectIds: string[];
  projectsById: Record<string, ProjectSummary>;
  focusConflictId: string;
  onOpenDesign?: (designId: string) => void;
  onClearFocus?: () => void;
  readOnly?: boolean;
}) {
  const apiFetch = useApiFetch();
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const state = useAsyncData(() => resolveConflict(apiFetch, focusConflictId, readOnly), [apiFetch, focusConflictId, readOnly, refreshKey]);

  const resolved = state.status === "ready" ? state.data : undefined;
  const neededIds = useMemo(() => {
    if (!resolved || resolved.kind !== "thread") return [];
    const ids: string[] = [];
    if (resolved.thread.initiatingDesignId) ids.push(resolved.thread.initiatingDesignId);
    if (resolved.thread.designId) ids.push(resolved.thread.designId);
    return ids;
  }, [resolved]);
  const designsById = useOnDemandDesigns(apiFetch, neededIds);

  async function decide(id: string, decision: "approve" | "reject") {
    setDecidingId(id);
    setError(null);
    try {
      await decideReview(apiFetch, id, decision);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDecidingId(null);
    }
  }

  const showRepoBadge = projectIds.length > 1;

  return (
    <div className="list-view">
      {state.status === "loading" && <p className="empty-state">Loading…</p>}
      {state.status === "error" && (
        <p className="empty-state error" role="alert">
          Couldn't load: {state.message}
        </p>
      )}
      {state.status === "ready" && (
        <div className="focus-page">
          <button type="button" className="link-button back-link" onClick={onClearFocus}>
            ← Back to all conflicts
          </button>
          {error && (
            <p className="resolve-error" role="alert">
              {error}
            </p>
          )}
          {!resolved && <p className="empty-state">That conflict couldn't be found -- it may have been removed, or you may not have access.</p>}
          {resolved?.kind === "review" && (
            <div className="design-card expanded">
              <div className="design-card-header">
                <div className="design-card-toggle review-card-toggle has-copy-link">
                  <ReviewCardHeaderContent
                    review={resolved.review}
                    expanded
                    repoBadge={showRepoBadge ? <RepoBadge project={projectsById[resolved.review.projectId] ?? { projectId: resolved.review.projectId }} /> : undefined}
                  />
                </div>
                <CopyLinkButton url={buildShareUrl(resolved.review.projectId, "conflicts", resolved.review.id)} />
              </div>
              <ReviewCardBody
                review={resolved.review}
                canDecide={projectsById[resolved.review.projectId]?.role === "admin"}
                busy={decidingId !== null}
                onDecide={decide}
              />
            </div>
          )}
          {resolved?.kind === "thread" && (
            <div className="design-card expanded">
              <div className="design-card-header">
                <div className="design-card-toggle has-copy-link">
                  <ThreadCardHeaderContent thread={resolved.thread} showRepoBadge={showRepoBadge} projectsById={projectsById} />
                </div>
                <CopyLinkButton url={buildShareUrl(resolved.thread.projectId, "conflicts", resolved.thread.id)} />
              </div>
              <ThreadDetail
                thread={resolved.thread}
                designsById={designsById}
                onOpenDesign={onOpenDesign}
                onChanged={() => setRefreshKey((k) => k + 1)}
                readOnly={readOnly}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type ReviewPage = { items: PendingReview[]; nextBefore?: number };
type ThreadPage = { items: AlignmentThread[]; nextBefore?: number };
type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

export function ConflictsView({
  projectIds,
  projectsById,
  onOpenDesign,
  focusConflictId,
  onClearFocus,
  readOnly,
}: {
  projectIds: string[];
  projectsById: Record<string, ProjectSummary>;
  onOpenDesign?: (designId: string) => void;
  focusConflictId?: string;
  onClearFocus?: () => void;
  readOnly?: boolean;
}) {
  const apiFetch = useApiFetch();
  const [filter, setFilter] = useState<ConflictStage | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a review decision or a thread close -- both need the list
  // to refetch (a decided review drops out of "awaiting approval"; a closed
  // thread moves to "resolved").
  const [refreshKey, setRefreshKey] = useState(0);
  const [reviewPages, setReviewPages] = useState<Record<string, ReviewPage>>({});
  const [threadPages, setThreadPages] = useState<Record<string, ThreadPage>>({});
  const [listState, setListState] = useState<LoadState>({ status: "loading" });

  const projectIdsKey = projectIds.join(",");

  const loadFirstPage = useCallback(() => {
    let cancelled = false;
    setListState({ status: "loading" });
    Promise.all([
      Promise.all(
        projectIds.map((pid) =>
          (readOnly ? Promise.resolve<ReviewPage>({ items: [] }) : fetchReviews(apiFetch, pid, "all")).then((page) => [pid, page] as const),
        ),
      ),
      Promise.all(projectIds.map((pid) => fetchAlignmentThreads(apiFetch, pid, {}).then((page) => [pid, page] as const))),
    ])
      .then(([reviewResults, threadResults]) => {
        if (cancelled) return;
        setReviewPages(Object.fromEntries(reviewResults.map(([pid, page]) => [pid, { items: page.items, nextBefore: page.nextBefore }])));
        setThreadPages(Object.fromEntries(threadResults.map(([pid, page]) => [pid, { items: page.items, nextBefore: page.nextBefore }])));
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
  }, [apiFetch, projectIdsKey, readOnly, refreshKey]);

  useEffect(() => loadFirstPage(), [loadFirstPage]);

  async function loadMore() {
    const reviewsToFetch = readOnly ? [] : projectIds.filter((pid) => reviewPages[pid]?.nextBefore !== undefined);
    const threadsToFetch = projectIds.filter((pid) => threadPages[pid]?.nextBefore !== undefined);
    if (reviewsToFetch.length === 0 && threadsToFetch.length === 0) return;
    try {
      const [reviewResults, threadResults] = await Promise.all([
        Promise.all(reviewsToFetch.map((pid) => fetchReviews(apiFetch, pid, "all", { before: reviewPages[pid].nextBefore }).then((page) => [pid, page] as const))),
        Promise.all(threadsToFetch.map((pid) => fetchAlignmentThreads(apiFetch, pid, { before: threadPages[pid].nextBefore }).then((page) => [pid, page] as const))),
      ]);
      setReviewPages((prev) => {
        const next = { ...prev };
        for (const [pid, page] of reviewResults) next[pid] = { items: [...(prev[pid]?.items ?? []), ...page.items], nextBefore: page.nextBefore };
        return next;
      });
      setThreadPages((prev) => {
        const next = { ...prev };
        for (const [pid, page] of threadResults) next[pid] = { items: [...(prev[pid]?.items ?? []), ...page.items], nextBefore: page.nextBefore };
        return next;
      });
    } catch (err) {
      setListState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const allReviews = useMemo(() => Object.values(reviewPages).flatMap((p) => p.items), [reviewPages]);
  const allThreads = useMemo(() => Object.values(threadPages).flatMap((p) => p.items), [threadPages]);
  const allItems = useMemo(() => buildConflictItems(allReviews, allThreads), [allReviews, allThreads]);
  const items = filter === "all" ? allItems : allItems.filter((i) => i.stage === filter);
  const hasMore = Object.values(reviewPages).some((p) => p.nextBefore !== undefined) || Object.values(threadPages).some((p) => p.nextBefore !== undefined);

  const counts = useMemo(() => {
    const c: Record<ConflictStage, number> = { open_discussion: 0, awaiting_approval: 0, resolved: 0 };
    for (const item of allItems) c[item.stage]++;
    return c;
  }, [allItems]);

  // See ThreadDetail's own doc comment (AlignmentThreadsView.tsx) for why
  // this is needed -- bounded to just the currently-expanded thread's two
  // linked designs, not every design in every selected project.
  const expandedThread = items.find((i) => i.kind === "thread" && i.thread.id === expandedId);
  const neededIds = useMemo(() => {
    if (!expandedThread || expandedThread.kind !== "thread") return [];
    const ids: string[] = [];
    if (expandedThread.thread.initiatingDesignId) ids.push(expandedThread.thread.initiatingDesignId);
    if (expandedThread.thread.designId) ids.push(expandedThread.thread.designId);
    return ids;
  }, [expandedThread]);
  const designsById = useOnDemandDesigns(apiFetch, neededIds);

  async function decide(id: string, decision: "approve" | "reject") {
    setDecidingId(id);
    setError(null);
    try {
      await decideReview(apiFetch, id, decision);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDecidingId(null);
    }
  }

  const showRepoBadge = projectIds.length > 1;

  if (focusConflictId) {
    return (
      <ConflictFocusedPage
        projectIds={projectIds}
        projectsById={projectsById}
        focusConflictId={focusConflictId}
        onOpenDesign={onOpenDesign}
        onClearFocus={onClearFocus}
        readOnly={readOnly}
      />
    );
  }

  return (
    <div className="list-view">
      <div className="filter-chips">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" className={`filter-chip${filter === f.value ? " active" : ""}`} onClick={() => setFilter(f.value)}>
            {f.label} ({f.value === "all" ? allItems.length : counts[f.value]})
          </button>
        ))}
      </div>

      {error && (
        <p className="resolve-error" role="alert">
          {error}
        </p>
      )}

      {listState.status === "loading" && <p className="empty-state">Loading…</p>}
      {listState.status === "error" && (
        <p className="empty-state error" role="alert">
          Couldn't load: {listState.message}
        </p>
      )}
      {listState.status === "ready" && items.length === 0 && <p className="empty-state">No conflicts match this filter.</p>}
      {listState.status === "ready" && items.length > 0 && (
        <>
          <ul className="card-list">
            {items.map((item) => {
              const id = item.kind === "review" ? item.review.id : item.thread.id;
              const projectId = item.kind === "review" ? item.review.projectId : item.thread.projectId;
              const expanded = expandedId === id;
              return (
                <li key={id} className={`design-card${expanded ? " expanded" : ""}`}>
                  <div className="design-card-header">
                    <button
                      type="button"
                      className={`design-card-toggle${item.kind === "review" ? " review-card-toggle" : ""} has-copy-link`}
                      aria-expanded={expanded}
                      onClick={() => setExpandedId(expanded ? null : id)}
                    >
                      {item.kind === "review" ? (
                        <ReviewCardHeaderContent
                          review={item.review}
                          expanded={expanded}
                          repoBadge={showRepoBadge ? <RepoBadge project={projectsById[projectId] ?? { projectId }} /> : undefined}
                        />
                      ) : (
                        <ThreadCardHeaderContent thread={item.thread} showRepoBadge={showRepoBadge} projectsById={projectsById} />
                      )}
                      <span className="stage-pill">{stageBadgeText(item.stage)}</span>
                    </button>
                    <CopyLinkButton url={buildShareUrl(projectId, "conflicts", id)} />
                  </div>
                  {expanded && item.kind === "review" && (
                    <ReviewCardBody review={item.review} canDecide={projectsById[item.review.projectId]?.role === "admin"} busy={decidingId !== null} onDecide={decide} />
                  )}
                  {expanded && item.kind === "thread" && (
                    <ThreadDetail
                      thread={item.thread}
                      designsById={designsById}
                      onOpenDesign={onOpenDesign}
                      onChanged={() => setRefreshKey((k) => k + 1)}
                      readOnly={readOnly}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <button type="button" className="load-more-button" onClick={loadMore}>
              Load older
            </button>
          )}
        </>
      )}
    </div>
  );
}
