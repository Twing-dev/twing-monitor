import { useCallback, useEffect, useMemo, useState } from "react";
import { useApiFetch, ApiError } from "../api/client.js";
import { fetchReviews, fetchReviewById, decideReview, type ReviewStatus } from "../api/reviews.js";
import type { ProjectSummary, PendingReview } from "../api/types.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { StatusBadge, type BadgeTone } from "../components/StatusBadge.js";
import { RepoBadge } from "../components/RepoBadge.js";
import { CopyLinkButton } from "../components/CopyLinkButton.js";
import { relativeTime } from "../lib/time.js";
import { buildShareUrl } from "../lib/urlState.js";

const STATUSES: ReviewStatus[] = ["pending", "decided", "all"];

/** Roughly the length at which the clamp actually hides something -- below
 * it, a "Show all" control costs more attention than the text it saves. */
const SAID_CLAMP_CHARS = 220;

/** The stored value is the verb the API takes ("approve"), but a badge is
 * reporting state, not offering an action -- "APPROVE" sitting next to
 * Approve/Reject buttons reads as a third button. */
function decisionLabel(decision?: "approve" | "reject"): string {
  if (decision === "approve") return "approved";
  if (decision === "reject") return "rejected";
  return "pending";
}

function toneForDecision(decision?: "approve" | "reject"): BadgeTone {
  if (decision === "approve") return "good";
  if (decision === "reject") return "critical";
  return "warning";
}

/** The machine names for a constraint type say nothing to someone who has
 * never opened `.twing/twing.yml`. Only meaningful for a pre-2026-08-26
 * constraint row, which may still carry one of these three old type strings
 * verbatim (no migration touched existing rows -- see `DesignConstraintType`'s
 * doc comment, api/types.ts). A new row's `type` is always the single value
 * `"constraint"`, which is no longer informative enough to show -- mirrors
 * the CLI dropping the same per-constraint-type text entirely
 * (`hook/design_gate.go`'s `constraintTypeText`, removed 2026-08-26).
 * Returns `undefined` rather than the raw type string so the caller can
 * skip rendering the sub-line at all in that case. */
function constraintTypeText(type: string): string | undefined {
  switch (type) {
    case "review_required":
      return "a human must review changes here";
    case "canonical_abstraction":
      return "use the existing approach, don't add a second one";
    case "domain_fact":
      return "a fact about this codebase you shouldn't contradict";
    default:
      return undefined;
  }
}

/** The header row shared by a card's collapsible list form and its
 * standalone focused-page form. `expanded` hides the rule/collision count
 * hints once the full detail (ReviewCardBody) is already showing them. */
function ReviewCardHeaderContent({ review, expanded, repoBadge }: { review: PendingReview; expanded: boolean; repoBadge?: React.ReactNode }) {
  const design = review.design;
  const blockers = review.constraints ?? [];
  const conflicts = review.conflicts ?? [];
  return (
    <>
      <div className="card-top-row">
        <span className="review-headline">{design?.summary ?? review.justification}</span>
        <div className="card-badges">
          {repoBadge}
          {!expanded && blockers.length > 0 && <span className="card-hint">{blockers.length === 1 ? "1 rule" : `${blockers.length} rules`}</span>}
          {!expanded && conflicts.length > 0 && <span className="card-hint">{conflicts.length === 1 ? "1 collision" : `${conflicts.length} collisions`}</span>}
          <StatusBadge label={decisionLabel(review.decision)} tone={toneForDecision(review.decision)} />
        </div>
      </div>
      <div className="card-meta">
        {design?.developerId && <span>{design.developerId}</span>}
        <span>{relativeTime(review.createdAt)}</span>
      </div>
    </>
  );
}

/**
 * The expanded body shared by both render paths -- what is being built, why
 * it stopped, and what the requester says, in that order (see the original
 * doc comment this replaced: an admin needs enough to answer "do I want
 * this to happen?", not just the argument for letting it through).
 */
function ReviewCardBody({
  review,
  canDecide,
  busy,
  onDecide,
}: {
  review: PendingReview;
  canDecide: boolean;
  busy: boolean;
  onDecide: (id: string, decision: "approve" | "reject") => void;
}) {
  const [saidExpanded, setSaidExpanded] = useState(false);
  const design = review.design;
  const blockers = review.constraints ?? [];
  // Every rule carries a type, but a card whose rules all share one (the
  // common case -- three `review_required` paths on the same design) was
  // printing the identical translation under each of them. Show it once,
  // as a heading for the group, and only fall back to per-rule when the
  // types genuinely differ.
  const blockerTypes = [...new Set(blockers.map((c) => c.type))];
  const oneBlockerType = blockerTypes.length === 1 ? blockerTypes[0] : undefined;
  // A new-style row's type is always "constraint" -- constraintTypeText
  // returns undefined for it (nothing worth heading a group with), so the
  // dedup heading only ever appears for a shared *old*-style type.
  const oneBlockerTypeText = oneBlockerType ? constraintTypeText(oneBlockerType) : undefined;
  const conflicts = review.conflicts ?? [];

  return (
    <div className="review-card-inner">
      {blockers.length > 0 && (
        <div className="review-band review-band-blocked">
          <span className="review-band-label">Blocked by</span>
          <div>
            {oneBlockerTypeText && (
              <p className="review-band-sub review-band-heading">
                {blockers.length > 1 ? `${blockers.length} rules — ` : ""}
                {oneBlockerTypeText}
              </p>
            )}
            {blockers.map((c) => {
              const typeText = constraintTypeText(c.type);
              return (
                <p key={c.id} className="review-band-line">
                  “{c.statement}”
                  {!oneBlockerTypeText && typeText && <span className="review-band-sub">{typeText}</span>}
                </p>
              );
            })}
          </div>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="review-band review-band-blocked">
          <span className="review-band-label">Collides with</span>
          <div>
            {conflicts.map((c) => (
              <p key={`${c.kind}-${c.designId}`} className="review-band-line">
                {c.summary ?? <span className="review-band-sub">design {c.designId}</span>}
                <span className="review-band-sub">
                  {c.developerId ? `${c.developerId} · ` : ""}
                  {c.kind === "overlap" ? "same files" : c.kind === "symbol_conflict" ? "same real edits" : "same work, judged by content"}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Only worth a band of its own once there's something above it to
          contrast against -- on a bare card the headline already is the
          justification, and repeating it reads as a bug. */}
      {design && (
        <div className="review-band review-band-says">
          <span className="review-band-label">They say</span>
          <div>
            {/* Clamped by default. A justification written by an agent runs
                to several hundred words of implementation detail, and left
                open it dwarfs the two bands above it -- which are the ones
                a reviewer actually decides on. It's their argument, not the
                finding, so it earns less room until asked for. */}
            <p className={`review-band-line${saidExpanded ? "" : " clamped"}`}>“{review.justification}”</p>
            {review.justification.length > SAID_CLAMP_CHARS && (
              <button type="button" className="review-expand" onClick={() => setSaidExpanded((v) => !v)} aria-expanded={saidExpanded}>
                {saidExpanded ? "Show less" : "Show all"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* No nested "Show detail" any more. The card itself is the
          disclosure now, and a second one inside it meant opening a card
          still didn't show you the card -- which is the bloat this whole
          change is removing. Everything below appears on open. */}
      {design && (
        <dl className="review-detail">
          {design.creates.length > 0 && (
            <>
              <dt>Creates</dt>
              <dd>{design.creates.join(", ")}</dd>
            </>
          )}
          {design.touches.length > 0 && (
            <>
              <dt>Touches</dt>
              <dd>{design.touches.join(", ")}</dd>
            </>
          )}
          {conflicts.some((c) => c.paths?.length) && (
            <>
              <dt>Overlapping</dt>
              <dd>{conflicts.flatMap((c) => c.paths ?? []).join(", ")}</dd>
            </>
          )}
          <dt>Plan</dt>
          <dd>{review.designId}</dd>
        </dl>
      )}

      {canDecide && !review.decision && (
        <div className="review-actions">
          <button type="button" className="resolve-button resolve-approve" disabled={busy} onClick={() => onDecide(review.id, "approve")}>
            {busy ? "…" : "Approve"}
          </button>
          <button type="button" className="resolve-button resolve-reject" disabled={busy} onClick={() => onDecide(review.id, "reject")}>
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function ReviewCard({
  review,
  canDecide,
  busy,
  repoBadge,
  onDecide,
}: {
  review: PendingReview;
  canDecide: boolean;
  busy: boolean;
  repoBadge?: React.ReactNode;
  onDecide: (id: string, decision: "approve" | "reject") => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className={`design-card${expanded ? " expanded" : ""}`}>
      <div className="design-card-header">
        {/* Collapsed to a headline by default. A single expanded card fills a
            viewport once the rules and the justification are real, so a list
            of them can't be scanned at all -- you have to read one to reach
            the next. The header alone answers "is this mine, is it urgent,
            do I care", which is what a queue is for; everything needed to
            actually decide is one click away. */}
        <button
          type="button"
          className="design-card-toggle review-card-toggle has-copy-link"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <ReviewCardHeaderContent review={review} expanded={expanded} repoBadge={repoBadge} />
        </button>
        <CopyLinkButton url={buildShareUrl(review.projectId, "reviews", review.id)} />
      </div>
      {expanded && <ReviewCardBody review={review} canDecide={canDecide} busy={busy} onDecide={onDecide} />}
    </li>
  );
}

/** A copy-link URL (or any other external jump) names one specific review
 * to look at -- resolved directly by id (`GET /v1/reviews/:id`, monitor UI
 * load-time fix 2026-08-29) rather than fetching every review in the
 * project to find it by scanning, which for anything but the most recent
 * review meant landing on the list and having to scroll to find it. A 404
 * resolves to `undefined` (not an error), same convention the other two
 * focus pages use, so the "couldn't be found" copy below renders the same
 * way it always has. */
function ReviewFocusedPage({
  projectIds,
  projectsById,
  focusReviewId,
  onClearFocus,
}: {
  projectIds: string[];
  projectsById: Record<string, ProjectSummary>;
  focusReviewId: string;
  onClearFocus?: () => void;
}) {
  const apiFetch = useApiFetch();
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const state = useAsyncData(
    () =>
      fetchReviewById(apiFetch, focusReviewId).catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) return undefined;
        throw err;
      }),
    [apiFetch, focusReviewId, refreshKey],
  );

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
  const review = state.status === "ready" ? state.data?.item : undefined;

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
            ← Back to all reviews
          </button>
          {error && (
            <p className="resolve-error" role="alert">
              {error}
            </p>
          )}
          {review ? (
            <div className="design-card expanded">
              <div className="design-card-header">
                <div className="design-card-toggle review-card-toggle has-copy-link">
                  <ReviewCardHeaderContent
                    review={review}
                    expanded
                    repoBadge={showRepoBadge ? <RepoBadge project={projectsById[review.projectId] ?? { projectId: review.projectId }} /> : undefined}
                  />
                </div>
                <CopyLinkButton url={buildShareUrl(review.projectId, "reviews", review.id)} />
              </div>
              <ReviewCardBody review={review} canDecide={projectsById[review.projectId]?.role === "admin"} busy={decidingId !== null} onDecide={decide} />
            </div>
          ) : (
            <p className="empty-state">That review couldn't be found -- it may have been removed, or you may not have access.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** `POST /v1/reviews/:id/decide` requires that review's *own* project
 * `admin` role server-side (§17.10 hardening) -- a developer can be
 * `admin` in one repo and `member` in another, so "can I decide" is
 * resolved per-review from `projectsById[review.projectId]`, not a single
 * boolean for the whole view (unlike the pre-aggregation version of this
 * component). Hiding the buttons for a `member` is purely UX either way;
 * the server is the real enforcement. */
type ProjectPage = { items: PendingReview[]; nextBefore?: number };
type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

export function ReviewsView({
  projectIds,
  projectsById,
  focusReviewId,
  onClearFocus,
}: {
  projectIds: string[];
  projectsById: Record<string, ProjectSummary>;
  focusReviewId?: string;
  onClearFocus?: () => void;
}) {
  const apiFetch = useApiFetch();
  const [status, setStatus] = useState<ReviewStatus>("pending");
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a successful decide -- a decided review needs to drop out
  // of the "pending" filter (or pick up its new badge under "decided"/
  // "all").
  const [refreshKey, setRefreshKey] = useState(0);
  const [pages, setPages] = useState<Record<string, ProjectPage>>({});
  const [listState, setListState] = useState<LoadState>({ status: "loading" });

  const projectIdsKey = projectIds.join(",");

  // Paginated (monitor UI load-time fix, 2026-08-29): same per-project
  // page/cursor shape ActivityView/DesignsView/AlignmentThreadsView all
  // use. A status filter change resets to page 1 by construction -- it's a
  // dependency of `loadFirstPage`, which always replaces `pages` wholesale.
  const loadFirstPage = useCallback(() => {
    let cancelled = false;
    setListState({ status: "loading" });
    Promise.all(projectIds.map((pid) => fetchReviews(apiFetch, pid, status).then((page) => [pid, page] as const)))
      .then((results) => {
        if (cancelled) return;
        setPages(Object.fromEntries(results.map(([pid, page]) => [pid, { items: page.items, nextBefore: page.nextBefore }])));
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
  }, [apiFetch, projectIdsKey, status, refreshKey]);

  useEffect(() => loadFirstPage(), [loadFirstPage]);

  async function loadMore() {
    const toFetch = projectIds.filter((pid) => pages[pid]?.nextBefore !== undefined);
    if (toFetch.length === 0) return;
    try {
      const results = await Promise.all(
        toFetch.map((pid) => fetchReviews(apiFetch, pid, status, { before: pages[pid].nextBefore }).then((page) => [pid, page] as const)),
      );
      setPages((prev) => {
        const next = { ...prev };
        for (const [pid, page] of results) {
          next[pid] = { items: [...(prev[pid]?.items ?? []), ...page.items], nextBefore: page.nextBefore };
        }
        return next;
      });
    } catch (err) {
      setListState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  const items = useMemo(() => Object.values(pages).flatMap((p) => p.items).sort((a, b) => b.createdAt - a.createdAt), [pages]);
  const hasMore = Object.values(pages).some((p) => p.nextBefore !== undefined);

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

  if (focusReviewId) {
    return <ReviewFocusedPage projectIds={projectIds} projectsById={projectsById} focusReviewId={focusReviewId} onClearFocus={onClearFocus} />;
  }

  return (
    <div className="list-view">
      <div className="filter-bar">
        <select value={status} onChange={(e) => setStatus(e.target.value as ReviewStatus)} aria-label="Filter by status">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
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
      {listState.status === "ready" && items.length === 0 && (
        <p className="empty-state">{status === "pending" ? "Nothing pending review." : "No reviews match this filter."}</p>
      )}
      {listState.status === "ready" && items.length > 0 && (
        <>
          <ul className="card-list">
            {items.map((r) => (
              <ReviewCard
                key={r.id}
                review={r}
                canDecide={projectsById[r.projectId]?.role === "admin"}
                busy={decidingId !== null}
                repoBadge={showRepoBadge ? <RepoBadge project={projectsById[r.projectId] ?? { projectId: r.projectId }} /> : undefined}
                onDecide={decide}
              />
            ))}
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
