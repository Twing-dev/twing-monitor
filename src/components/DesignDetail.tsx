import { Fragment, useState, type FormEvent } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchClaims } from "../api/claims.js";
import { fetchActivity } from "../api/activity.js";
import { fetchReviews } from "../api/reviews.js";
import { resolveDesign } from "../api/designs.js";
import type { AlignmentThread, DesignStatement } from "../api/types.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AsyncSection } from "./AsyncSection.js";
import { formatActivityEvent } from "../lib/activityFormat.js";
import { relativeTime } from "../lib/time.js";

/** A design's involvement in an open, semantic-conflict-origin alignment
 * thread (§7's async Bedrock comparator, `design-semantic-check.ts`) --
 * computed once by `DesignsView` (which already fetches every open thread
 * and every design in the project for its own list-level chip) and passed
 * down rather than re-fetched here, since both of those are already
 * project-wide bulk queries this component would otherwise duplicate.
 * `counterpart` is left `undefined` only if that design has since expired/
 * been deleted -- the thread itself still gets shown. */
export interface SemanticOverlap {
  thread: AlignmentThread;
  counterpart?: DesignStatement;
}

function PathList({ title, paths }: { title: string; paths: string[] }) {
  if (paths.length === 0) return null;
  return (
    <div className="detail-field">
      <h3>
        {title} <span className="detail-field-count">{paths.length}</span>
      </h3>
      <ul className="path-list">
        {paths.map((p) => (
          <li key={p}>
            <code>{p}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Rendered whenever there's a non-"clean" check outcome to explain --
 * `status: "flagged"` (error severity: overlap tier 4, constraint_flag) or
 * `status: "open"` with an unresolved warning (2026-08-19 severity split:
 * tier 1's exactOverlap, display-only, never demotes out of "open"). Pulls
 * the most recent `design_checked` event tied to this exact design --
 * fired on every registration/amend/resume regardless of verdict (unlike
 * `design_flagged`, only ever logged for an error severity) -- so this is
 * the one query that covers both cases uniformly, and reuses the same
 * per-kind formatter the Activity feed uses so the text reads identically
 * in both places. A design's `status` field alone never explains *why* --
 * this is the only place that answer lives. Renders nothing once the
 * latest check came back clean (a resolved warning, or a design that was
 * never non-clean to begin with). */
function LatestCheckOutcome({ design }: { design: DesignStatement }) {
  const apiFetch = useApiFetch();
  const state = useAsyncData(
    () => fetchActivity(apiFetch, design.projectId, { relatedId: design.id, kinds: ["design_checked"], limit: 1 }),
    [apiFetch, design.projectId, design.id],
  );
  // Silent on loading/error/empty -- this is a bonus panel on top of the
  // detail view's main content, not something worth its own loading
  // spinner or error message the way a primary list (AsyncSection's usual
  // job) is.
  if (state.status !== "ready" || state.data.items.length === 0) return null;
  const formatted = formatActivityEvent(state.data.items[0]);
  const verdictField = formatted.details.find((d) => d.label === "Verdict");
  if (!verdictField || verdictField.value === "clean") return null;
  const isWarning = formatted.severity === "warning";
  return (
    <div className={`detail-field why-flagged${isWarning ? " why-flagged-warning" : ""}`}>
      <h3>{isWarning ? "Heads up (non-blocking)" : design.status === "flagged" ? "Why flagged" : "Unresolved conflict"}</h3>
      <dl className="detail-kv">
        {formatted.details
          .filter((d) => d.label !== "Severity")
          .map((d) => (
            <Fragment key={d.label}>
              <dt>{d.label}</dt>
              <dd>{d.value}</dd>
            </Fragment>
          ))}
      </dl>
    </div>
  );
}

/** The semantic comparator (`design-semantic-check.ts`) is a completely
 * separate pipeline from `runDesignChecks` (`LatestCheckOutcome`/
 * `ResolveActions` above) -- it never touches `status`/severity, only opens
 * an alignment thread (§7), so without this a design with a live,
 * unresolved semantic duplication had no visible trace anywhere in the
 * Designs tab (only in Alignment threads). Names the specific overlapping
 * design/plan directly (not just "go check the thread") since that's the
 * one thing worth knowing at a glance; the thread link is there for the
 * full back-and-forth (reply/close, §7). */
function SemanticOverlapNote({
  overlap,
  onOpenDesign,
  onOpenTab,
}: {
  overlap: SemanticOverlap;
  onOpenDesign?: (designId: string) => void;
  onOpenTab?: (tab: "threads") => void;
}) {
  const { thread, counterpart } = overlap;
  return (
    <div className="detail-field resolve-actions resolve-pending">
      <h3>Semantic overlap</h3>
      <p className="resolve-pending-note">{thread.systemDescription}</p>
      <div className="thread-design-links">
        {counterpart && onOpenDesign ? (
          <button type="button" className="link-chip link-chip-accent" onClick={() => onOpenDesign(counterpart.id)}>
            → {counterpart.summary || counterpart.id.slice(0, 8)}
          </button>
        ) : (
          !counterpart && <p className="resolve-pending-note">The overlapping design has since expired or been deleted.</p>
        )}
        {onOpenTab && (
          <button type="button" className="link-chip" onClick={() => onOpenTab("threads")}>
            View alignment thread →
          </button>
        )}
      </div>
    </div>
  );
}

interface RawDesignConflict {
  conflictingDesignId: string;
  overlapKind: string;
  overlapDetail: string;
  conflictingSummary: string;
}

interface LatestCheckPayload {
  verdict?: string;
  conflicts?: RawDesignConflict[];
}

/** The two resolutions the server actually supports for a flagged design
 * (§17.5) -- there's no third "just dismiss it" option, so neither is this
 * panel's. Which one(s) make sense depends entirely on *why* it's flagged:
 * a `constraint_flag` names a rule, not another design, so there's nothing
 * to adopt -- justify is the only path. An `overlap` names one or more
 * specific conflicting designs, so adopting one of *those* (superseding
 * this one outright, no review needed) is offered alongside justify.
 * Own fetches for the latest check payload and this project's pending
 * reviews -- same "independent bonus panel" shape as `LatestCheckOutcome`
 * above, deliberately not sharing its query (it only keeps formatted
 * strings, not the raw conflict/constraint ids this needs). Renders
 * nothing once the design isn't `"flagged"` -- a warning never needed
 * resolving in the first place. */
function ResolveActions({ design, onResolved }: { design: DesignStatement; onResolved: () => void }) {
  const apiFetch = useApiFetch();
  // This component's own refresh signal, separate from the parent list's:
  // an "adopted" resolve changes `design.status`, which the parent's own
  // refetch (via `onResolved`) picks up and re-renders this component away
  // entirely -- but "justified_divergence" leaves `status: "flagged"`
  // unchanged (only a new pending review exists), so *this* component has
  // to re-query its own `reviewsState` itself to notice that, or it'd be
  // stuck showing the just-submitted form forever.
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const checkState = useAsyncData(
    () => fetchActivity(apiFetch, design.projectId, { relatedId: design.id, kinds: ["design_checked"], limit: 1 }),
    [apiFetch, design.projectId, design.id, localRefreshKey],
  );
  const reviewsState = useAsyncData(
    () => fetchReviews(apiFetch, design.projectId, "pending"),
    [apiFetch, design.projectId, design.id, localRefreshKey],
  );

  const [justification, setJustification] = useState("");
  const [submitting, setSubmitting] = useState<"adopt" | "justify" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (design.status !== "flagged") return null;
  if (checkState.status !== "ready" || reviewsState.status !== "ready") return null;

  const payload = (checkState.data.items[0]?.payload ?? {}) as LatestCheckPayload;
  const pendingReview = reviewsState.data.find((r) => r.designId === design.id);

  if (pendingReview) {
    return (
      <div className="detail-field resolve-actions resolve-pending">
        <h3>Justified -- pending review</h3>
        <p className="resolve-pending-note">&ldquo;{pendingReview.justification}&rdquo;</p>
        <p className="resolve-pending-note">Waiting on a project admin&apos;s decision (see the Reviews tab).</p>
      </div>
    );
  }

  async function adopt(conflictingDesignId: string) {
    setSubmitting("adopt");
    setError(null);
    try {
      await resolveDesign(apiFetch, design.id, { resolution: "adopted", adoptedDesignId: conflictingDesignId });
      setLocalRefreshKey((k) => k + 1);
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(null);
    }
  }

  async function justify(e: FormEvent) {
    e.preventDefault();
    const trimmed = justification.trim();
    if (!trimmed) return;
    setSubmitting("justify");
    setError(null);
    try {
      await resolveDesign(apiFetch, design.id, { resolution: "justified_divergence", justification: trimmed });
      setLocalRefreshKey((k) => k + 1);
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="detail-field resolve-actions">
      <h3>Resolve</h3>
      {payload.verdict === "overlap" && payload.conflicts && payload.conflicts.length > 0 && (
        <div className="resolve-adopt-list">
          {payload.conflicts.map((c) => (
            <button
              key={c.conflictingDesignId}
              type="button"
              className="resolve-button resolve-adopt"
              disabled={submitting !== null}
              onClick={() => adopt(c.conflictingDesignId)}
            >
              Adopt &ldquo;{c.conflictingSummary || c.conflictingDesignId.slice(0, 8)}&rdquo; instead
            </button>
          ))}
        </div>
      )}
      <form className="resolve-justify-form" onSubmit={justify}>
        <label htmlFor={`justify-${design.id}`}>Justify divergence</label>
        <textarea
          id={`justify-${design.id}`}
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          placeholder={
            payload.verdict === "constraint_flag"
              ? "Why this design needs to diverge from the constraint..."
              : "Why this design needs to coexist with the design(s) above..."
          }
          rows={3}
          disabled={submitting !== null}
        />
        <button type="submit" className="resolve-button resolve-justify" disabled={submitting !== null || !justification.trim()}>
          {submitting === "justify" ? "Submitting…" : "Submit for review"}
        </button>
      </form>
      {error && (
        <p className="resolve-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Expanded-card content for a single design -- the full record behind the
 * summary line: the verbatim plan text (when registered via ExitPlanMode),
 * every declared path (not just the creates+touches count the collapsed
 * card shows), justification/review state, and the session's actual
 * claims (§4/§11) fetched live so a viewer can compare what was *declared*
 * up front against what the session's edits actually *did*. `onResolved`
 * lets `ResolveActions` tell the parent list to refetch (a resolve action
 * changes this design's status, and possibly the design it adopted).
 * `semanticOverlap`/`onOpenDesign`/`onOpenTab` are `DesignsView`'s to
 * supply -- see `SemanticOverlapNote`'s own doc comment for why this
 * component doesn't fetch that data itself. */
export function DesignDetail({
  design,
  onResolved,
  semanticOverlap,
  onOpenDesign,
  onOpenTab,
}: {
  design: DesignStatement;
  onResolved: () => void;
  semanticOverlap?: SemanticOverlap;
  onOpenDesign?: (designId: string) => void;
  onOpenTab?: (tab: "threads") => void;
}) {
  const apiFetch = useApiFetch();
  const claimsState = useAsyncData(() => fetchClaims(apiFetch, design.projectId, design.sessionId), [apiFetch, design.projectId, design.sessionId]);

  return (
    <div className="design-detail">
      <LatestCheckOutcome design={design} />
      {semanticOverlap && <SemanticOverlapNote overlap={semanticOverlap} onOpenDesign={onOpenDesign} onOpenTab={onOpenTab} />}
      <ResolveActions design={design} onResolved={onResolved} />

      {design.rawPlanExcerpt && (
        <div className="detail-field">
          <h3>Plan text</h3>
          <pre className="plan-text">{design.rawPlanExcerpt}</pre>
        </div>
      )}

      <PathList title="Creates" paths={design.creates} />
      <PathList title="Touches" paths={design.touches} />
      <PathList title="Depends on" paths={design.dependsOn} />

      <div className="detail-field">
        <h3>Session</h3>
        <dl className="detail-kv">
          <dt>Developer</dt>
          <dd>{design.developerId}</dd>
          <dt>Session</dt>
          <dd>
            <code>{design.sessionId}</code>
          </dd>
          <dt>Registered</dt>
          <dd>{relativeTime(design.createdAt)}</dd>
          <dt>Last activity</dt>
          <dd>{relativeTime(design.lastActivityAt)}</dd>
          <dt>Scope version</dt>
          <dd>{design.scopeVersion}</dd>
          {design.reviewDecision && (
            <>
              <dt>Review decision</dt>
              <dd>{design.reviewDecision}</dd>
            </>
          )}
          {design.justifiedConstraintIds.length > 0 && (
            <>
              <dt>Justified constraints</dt>
              <dd>{design.justifiedConstraintIds.length}</dd>
            </>
          )}
          {design.justifiedOverlaps.length > 0 && (
            <>
              <dt>Justified overlaps</dt>
              <dd>{design.justifiedOverlaps.length}</dd>
            </>
          )}
        </dl>
      </div>

      <div className="detail-field">
        <h3>Claims (this session)</h3>
        <AsyncSection
          state={claimsState}
          isEmpty={(items) => items.length === 0}
          emptyMessage="No active claims for this session -- either nothing's been captured yet, or they've expired."
          render={(items) => (
            <ul className="claim-list">
              {items.map((c) => (
                <li key={`${c.symbolId}::${c.stage}`} className="claim-row">
                  <code>{c.symbolId}</code>
                  <span className={`claim-kind claim-${c.kind}`}>{c.kind}</span>
                  <span className="claim-stage">{c.stage}</span>
                  <span className="claim-meta">{relativeTime(c.ts)}</span>
                </li>
              ))}
            </ul>
          )}
        />
      </div>
    </div>
  );
}
