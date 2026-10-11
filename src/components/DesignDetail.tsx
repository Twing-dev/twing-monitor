import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchClaims } from "../api/claims.js";
import { fetchActivity } from "../api/activity.js";
import { fetchReviews } from "../api/reviews.js";
import { resolveDesign } from "../api/designs.js";
import type { AlignmentThread, Claim, DesignChange, DesignStatement } from "../api/types.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AsyncSection } from "./AsyncSection.js";
import { formatActivityEvent } from "../lib/activityFormat.js";
import { relativeTime } from "../lib/time.js";
import {
  computeConformance,
  computeConformanceAcrossMembers,
  groupByKind,
  groupByKindAcrossMembers,
  hasStructuredChanges,
  kindColor,
  kindDescription,
  kindLabel,
  pathOfTarget,
  type MemberSlice,
  type MergedChangeRow,
  type MergedKindGroup,
} from "../lib/designConformance.js";
import { conflictKindInfo, isConflictBucket } from "../lib/conflictKind.js";
import { StatusBadge } from "./StatusBadge.js";
import { DesignReview, HighlightableText, useHasReviewAnchors, useHasReviewAnchorsAcrossDesigns } from "./DesignReview.js";
import { DesignChat } from "./DesignChat.js";

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

/** One declared change: verb, target, and why -- in that order, because
 * that is the order the sentence reads in ("modify RetryPolicy.backoff:
 * exponential growth, capped at 30s").
 *
 * The symbol is emphasised over its path: within a section a reader is
 * scanning for *what* changed, and the repeated directory prefix in front
 * of it is the least informative part of the line. A `rename`/`move` shows
 * its `from` inline rather than in the intent text, because "only the name
 * changed" is the actual claim being made and it is what a reviewer checks.
 */
function ChangeRow({ change, conformance, designId }: { change: DesignChange; conformance?: "matched" | "not_yet_edited"; designId?: string }) {
  const path = pathOfTarget(change.target);
  const symbol = change.target.length > path.length ? change.target.slice(path.length + 2) : undefined;
  return (
    <li className={`change-row change-${change.action}`}>
      <div className="change-head">
        <span className={`change-action action-${change.action}`}>{change.action}</span>
        <code className="change-target">
          <span className="change-path">{path}</span>
          {symbol && <span className="change-symbol">{symbol}</span>}
        </code>
        {change.from && <span className="change-from">← {change.from}</span>}
        {/* Only the satisfied case gets a marker. An unbuilt declaration is
            the normal state of an open design -- flagging it here would put
            a warning on almost every row of every in-progress design. The
            conformance section below is where "not yet" is counted. */}
        {conformance === "matched" && (
          <span className="change-conformance" title="a recorded edit matches this target">
            ✓
          </span>
        )}
      </div>
      {/* The intent is the prose half of a change, so it is what a reviewer
          highlights to comment on this one change (design review). */}
      <p className="change-intent">{designId ? <HighlightableText designId={designId} field="change" changeId={change.id} text={change.intent} /> : change.intent}</p>
    </li>
  );
}

/**
 * One kind's row: always present, whether or not it has changes.
 *
 * Closed by default, showing only the answer to "is there anything here" --
 * that's the first-glance read, and opening a row is the deliberate act of
 * going deeper. A row with no changes isn't a button at all: there is
 * nothing behind it to reveal, and making it look clickable teaches people
 * that clicking sometimes does nothing.
 */
function KindSection({
  group,
  stateByChangeId,
  designId,
}: {
  group: { kind: string; changes: DesignChange[] };
  stateByChangeId: Map<string, "matched" | "not_yet_edited">;
  designId?: string;
}) {
  const [open, setOpen] = useState(false);
  // A section holding an open review comment's highlight opens by itself:
  // a highlight nobody can see is a comment nobody can place. Once only --
  // after that, open and closed are the reader's to choose.
  const hasAnchors = useHasReviewAnchors(
    designId,
    "change",
    group.changes.map((c) => c.id),
  );
  const openedForAnchors = useRef(false);
  useEffect(() => {
    if (hasAnchors && !openedForAnchors.current) {
      openedForAnchors.current = true;
      setOpen(true);
    }
  }, [hasAnchors]);
  const count = group.changes.length;
  const label = kindLabel(group.kind);
  const description = kindDescription(group.kind);

  if (count === 0) {
    return (
      <div className="kind-section kind-empty">
        <div className="kind-head" title={description}>
          <span className="kind-caret" aria-hidden="true" />
          <span className="kind-label">{label}</span>
          <span className="kind-count kind-count-none">no changes</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`kind-section${open ? " open" : ""}`}>
      <button type="button" className="kind-head kind-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)} title={description}>
        <span className="kind-caret" aria-hidden="true">
          ▸
        </span>
        <span className="kind-label">{label}</span>
        <span className="kind-count">
          {count} change{count === 1 ? "" : "s"}
        </span>
        <span className="kind-hint">{open ? "hide" : "show files"}</span>
      </button>
      {open && (
        <div className="kind-body">
          {description && <p className="kind-description">{description}</p>}
          <ul className="change-list">
            {group.changes.map((change) => (
              <ChangeRow key={change.id} change={change} conformance={stateByChangeId.get(change.id)} designId={designId} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The declared changes: one row per kind, every kind, expandable where
 * there's something to expand. See `groupByKind`'s doc comment for why the
 * empty ones are shown rather than omitted -- "no database changes" is the
 * answer a reader came for, and an omitted section can't say it. */
export function DeclaredChanges({
  changes,
  claims,
  designId,
  /** Whether to print the section's own heading (2026-10-07).
   *
   * Default true, so the standalone design view is unchanged. A view
   * stacking one of these per design in a linked group passes false and
   * prints the heading once above the group instead -- four designs used to
   * mean four identical "What's changing" headings, which read as one panel
   * rendered four times rather than as four designs. */
  showHeading = true,
}: {
  changes: DesignChange[];
  claims: Claim[];
  designId?: string;
  showHeading?: boolean;
}) {
  const [conformanceOpen, setConformanceOpen] = useState(false);
  const report = computeConformance(changes, claims);
  const stateByChangeId = new Map(report.declared.map((row) => [row.change.id, row.state]));
  const drifted = report.undeclared.length > 0;

  return (
    <>
      <div className="detail-field">
        {showHeading && <h3>What&rsquo;s changing</h3>}
        <div className="kind-list">
          {groupByKind(changes).map((group) => (
            <KindSection key={group.kind} group={group} stateByChangeId={stateByChangeId} designId={designId} />
          ))}
        </div>
      </div>

      {/* Always rendered, including when everything lines up: "nothing
          undeclared" is a real answer, and a section that appears only when
          something is wrong trains people to read its absence as "not
          checked" rather than "checked, and fine". Opens by default only
          when there's drift -- the one case worth interrupting someone
          for. */}
      <div className={`detail-field conformance${drifted ? " conformance-drift" : ""}`}>
        <button
          type="button"
          className="kind-head kind-toggle conformance-toggle"
          aria-expanded={conformanceOpen || drifted}
          onClick={() => setConformanceOpen((v) => !v)}
        >
          <span className="kind-caret" aria-hidden="true">
            ▸
          </span>
          <span className="kind-label">Did the code match the plan?</span>
          <span className={`kind-count${drifted ? " kind-count-drift" : " kind-count-ok"}`}>
            {drifted ? `${report.undeclared.length} not planned` : "no surprises"}
          </span>
        </button>
        {(conformanceOpen || drifted) && (
          <div className="kind-body">
            <p className="kind-description">
              {report.matchedCount} of {changes.length} planned change{changes.length === 1 ? "" : "s"} {report.matchedCount === 1 ? "has" : "have"} been
              edited so far
              {report.matchedCount < changes.length && <> · {changes.length - report.matchedCount} not started yet</>}
            </p>
            {drifted ? (
              <ul className="path-list undeclared-list">
                {report.undeclared.map((symbolId) => (
                  <li key={symbolId}>
                    <code>{symbolId}</code>
                    <span className="undeclared-note">edited, but the plan never mentioned it</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="conformance-summary">Everything edited so far was part of the plan.</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** `ChangeRow`, for a merged row that may belong to any member of a linked
 * group -- same markup, plus the owning repo's label when the kind it's in
 * actually spans more than one repo (`showRepoTag`; see `MergedKindGroup`'s
 * own doc comment for why that's decided per kind, not once for the whole
 * group). */
function GroupChangeRow({ row, showRepoTag }: { row: MergedChangeRow; showRepoTag: boolean }) {
  const { change, designId, repoLabel, state } = row;
  const path = pathOfTarget(change.target);
  const symbol = change.target.length > path.length ? change.target.slice(path.length + 2) : undefined;
  return (
    <li className={`change-row change-${change.action}`}>
      <div className="change-head">
        {showRepoTag && <span className="change-repo-tag">{repoLabel}</span>}
        <span className={`change-action action-${change.action}`}>{change.action}</span>
        <code className="change-target">
          <span className="change-path">{path}</span>
          {symbol && <span className="change-symbol">{symbol}</span>}
        </code>
        {change.from && <span className="change-from">← {change.from}</span>}
        {state === "matched" && (
          <span className="change-conformance" title="a recorded edit matches this target">
            ✓
          </span>
        )}
      </div>
      <p className="change-intent">
        <HighlightableText designId={designId} field="change" changeId={change.id} text={change.intent} />
      </p>
    </li>
  );
}

/** `KindSection`, for one kind merged across every member of a group. Rows
 * carry their own `designId`/`repoLabel` already (`MergedChangeRow`), so
 * this differs from `KindSection` only in: filtering by `activeRepo`, the
 * repo-chip breakdown under the header when this kind actually spans more
 * than one repo, and checking review anchors across however many distinct
 * designs this kind's rows belong to instead of just one. */
function GroupKindSection({ group, activeRepo }: { group: MergedKindGroup; activeRepo: string | null }) {
  const [open, setOpen] = useState(false);
  const visibleRows = activeRepo ? group.rows.filter((r) => r.repoLabel === activeRepo) : group.rows;
  const repoTagNeeded = group.repoCounts.length > 1;

  const anchorPairs = useMemo(() => {
    const byDesign = new Map<string, string[]>();
    for (const r of group.rows) byDesign.set(r.designId, [...(byDesign.get(r.designId) ?? []), r.change.id]);
    return [...byDesign.entries()].map(([designId, changeIds]) => ({ designId, changeIds }));
  }, [group.rows]);
  const hasAnchors = useHasReviewAnchorsAcrossDesigns(anchorPairs);
  const openedForAnchors = useRef(false);
  useEffect(() => {
    if (hasAnchors && !openedForAnchors.current) {
      openedForAnchors.current = true;
      setOpen(true);
    }
  }, [hasAnchors]);

  const label = kindLabel(group.kind);
  const description = kindDescription(group.kind);
  const count = visibleRows.length;

  if (count === 0) {
    return (
      <div className="kind-section kind-empty">
        <div className="kind-head" title={description}>
          <span className="kind-caret" aria-hidden="true" />
          <span className="kind-label">{label}</span>
          <span className="kind-count kind-count-none">no changes</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`kind-section${open ? " open" : ""}`}>
      <button type="button" className="kind-head kind-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)} title={description}>
        <span className="kind-caret" aria-hidden="true">
          ▸
        </span>
        <span className="kind-label">{label}</span>
        <span className="kind-count">
          {count} change{count === 1 ? "" : "s"}
        </span>
        <span className="kind-hint">{open ? "hide" : "show files"}</span>
      </button>
      {open && (
        <div className="kind-body">
          {description && <p className="kind-description">{description}</p>}
          {repoTagNeeded && (
            <div className="kind-repo-split">
              {group.repoCounts.map((rc) => (
                <span key={rc.label} className="repo-chip-mini">
                  {rc.label} · {rc.count}
                </span>
              ))}
            </div>
          )}
          <ul className="change-list">
            {visibleRows.map((row) => (
              <GroupChangeRow key={`${row.designId}:${row.change.id}`} row={row} showRepoTag={repoTagNeeded} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * `DeclaredChanges`, across every member of a linked group at once (2026-10-11,
 * "Option A" -- `whats-changing-redesign.html`). Kind is the primary axis,
 * merged across repos first; a repo only shows up as a chip or a filter when
 * the group actually spans more than one, and only on the specific kinds
 * that do. A group of one (every design's `groupId` defaults to its own id)
 * passes a single-member `members` array and renders identically to the old
 * per-design `DeclaredChanges` -- there is deliberately no separate "linked
 * group" layout.
 *
 * Takes already-fetched `claims` per member rather than fetching them itself
 * -- same reason `DeclaredChanges` always has: claims are session-scoped,
 * the caller already knows which project/session each member needs, and a
 * component that fetched its own would duplicate that per repo.
 */
export function GroupDeclaredChanges({ members, showHeading = true }: { members: MemberSlice[]; showHeading?: boolean }) {
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const [conformanceOpen, setConformanceOpen] = useState(false);

  const kindGroups = groupByKindAcrossMembers(members);
  const nonEmptyKinds = kindGroups.filter((g) => g.rows.length > 0);
  const totalChanges = members.reduce((n, m) => n + m.changes.length, 0);
  const totalFiles = new Set(members.flatMap((m) => m.changes.map((c) => pathOfTarget(c.target)))).size;
  const repos = [...new Map(members.map((m) => [m.repoLabel, true])).keys()];
  const spansRepos = repos.length > 1;

  const conformance = computeConformanceAcrossMembers(members);
  const drifted = conformance.undeclared.length > 0;

  // Reach, not a count -- this design touches a contract other people's work
  // depends on. Used to be its own full-size warning tile in the stat grid
  // above this section; moved here (2026-10-11) once that grid's other two
  // tiles ("N changes"/"N files") became pure duplicates of the diffstat
  // line right below, which made the whole grid read as mostly restating
  // this section rather than adding to it. The bar's own legend already
  // colors schema/api like every other kind, which isn't the same as
  // flagging them -- a reader scanning colors has no reason to know red
  // means "ordinary" while this one amber word means "pay attention".
  const reachKinds = nonEmptyKinds.filter((g) => g.kind === "schema" || g.kind === "api").map((g) => g.kind);

  return (
    <>
      <div className="detail-field">
        {showHeading && (
          <div className="whats-changing-head">
            <h3>What&rsquo;s changing</h3>
            {reachKinds.map((kind) => (
              <span key={kind} className="reach-badge">
                {kind === "schema" ? "Schema" : "API"} touched
              </span>
            ))}
          </div>
        )}

        <div className="diffstat-head">
          <span className="diffstat-total">
            {totalChanges} change{totalChanges === 1 ? "" : "s"} · {totalFiles} file{totalFiles === 1 ? "" : "s"}
            {spansRepos && ` · ${repos.length} repos`}
          </span>
        </div>
        <div className="diffstat-bar">
          {nonEmptyKinds.map((g) => (
            <span key={g.kind} className="diffstat-seg" style={{ width: `${(g.rows.length / totalChanges) * 100}%`, background: kindColor(g.kind) }} />
          ))}
        </div>
        <div className="diffstat-legend">
          {nonEmptyKinds.map((g) => (
            <span key={g.kind} className="diffstat-legend-item">
              <i className="diffstat-dot" style={{ background: kindColor(g.kind) }} />
              {kindLabel(g.kind)} · {g.rows.length}
            </span>
          ))}
        </div>

        {/* Narrows which files show under each kind below -- the group-wide
            bar/legend/totals above stay as they are regardless of this,
            since they answer "what's the shape of the whole change", not
            "show me one repo's files" (see Option A's own rationale note). */}
        {spansRepos && (
          <div className="repo-filter" role="tablist" aria-label="Filter by repo">
            <button type="button" className={activeRepo === null ? "active" : ""} onClick={() => setActiveRepo(null)}>
              All repos
            </button>
            {repos.map((r) => (
              <button key={r} type="button" className={activeRepo === r ? "active" : ""} onClick={() => setActiveRepo(r)}>
                {r}
              </button>
            ))}
          </div>
        )}

        <div className="kind-list">
          {kindGroups.map((g) => (
            <GroupKindSection key={g.kind} group={g} activeRepo={activeRepo} />
          ))}
        </div>
      </div>

      <div className={`detail-field conformance${drifted ? " conformance-drift" : ""}`}>
        <button
          type="button"
          className="kind-head kind-toggle conformance-toggle"
          aria-expanded={conformanceOpen || drifted}
          onClick={() => setConformanceOpen((v) => !v)}
        >
          <span className="kind-caret" aria-hidden="true">
            ▸
          </span>
          <span className="kind-label">Did the code match the plan?</span>
          <span className={`kind-count${drifted ? " kind-count-drift" : " kind-count-ok"}`}>
            {drifted ? `${conformance.undeclared.length} not planned` : "no surprises"}
          </span>
        </button>
        {(conformanceOpen || drifted) && (
          <div className="kind-body">
            <p className="kind-description">
              {conformance.matchedCount} of {totalChanges} planned change{totalChanges === 1 ? "" : "s"}{" "}
              {conformance.matchedCount === 1 ? "has" : "have"} been edited so far
              {conformance.matchedCount < totalChanges && <> · {totalChanges - conformance.matchedCount} not started yet</>}
              {spansRepos && <> · across {repos.length} repos</>}
            </p>
            {drifted ? (
              <ul className="path-list undeclared-list">
                {conformance.undeclared.map((u) => (
                  <li key={`${u.repoLabel}:${u.symbolId}`}>
                    <code>{u.symbolId}</code>
                    <span className="undeclared-note">
                      {spansRepos && `${u.repoLabel} · `}
                      edited, but the plan never mentioned it
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="conformance-summary">Everything edited so far was part of the plan.</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export function PathList({ title, paths }: { title: string; paths: string[] }) {
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

/** Rendered whenever there's a non-"clean" check outcome to explain.
 * `status: "flagged"` can come from either a synchronous `design_checked`
 * (`constraint_violation`, register/amend/resume) or an async
 * `design_flagged` with no matching `design_checked` at all
 * (`symbol_conflict`/`llm_divergence`, flagged later from `/v1/claims` or
 * the semantic comparator pass -- see DesignVerdict's doc comment,
 * packages/core/src/types.ts) -- so this queries both kinds and takes
 * whichever is most recent, rather than assuming `design_checked` always
 * exists. `status: "open"` with a `file_overlap` verdict is the other case:
 * always advisory, display-only, never demotes out of "open". Reuses the
 * same per-kind formatter the Activity feed uses so the text reads
 * identically in both places. A design's `status` field alone never
 * explains *why* -- this is the only place that answer lives. Renders
 * nothing once the latest check came back clean (or a design that was
 * never non-clean to begin with). */
export function LatestCheckOutcome({ design }: { design: DesignStatement }) {
  const apiFetch = useApiFetch();
  const state = useAsyncData(
    () => fetchActivity(apiFetch, design.projectId, { relatedId: design.id, kinds: ["design_checked", "design_flagged"], limit: 1 }),
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
  // The shared conflictKind vocabulary, when the verdict is one of the four
  // real buckets (it always should be, once past the "clean" check above --
  // isConflictBucket is just a type guard, not expected to ever fail here).
  const info = isConflictBucket(verdictField.value) ? conflictKindInfo(verdictField.value) : undefined;
  // file_overlap never blocks (2026-08-26) -- the only verdict that can
  // reach this panel while `status` stays "open" rather than "flagged".
  const isAdvisoryOnly = info ? !info.blocking : verdictField.value === "file_overlap";
  return (
    <div className={`detail-field why-flagged${isAdvisoryOnly ? " why-flagged-warning" : ""}`}>
      <h3>{isAdvisoryOnly ? "Heads up (non-blocking)" : design.status === "flagged" ? "Why flagged" : "Unresolved conflict"}</h3>
      <dl className="detail-kv">
        {formatted.details.map((d) => (
          <Fragment key={d.label}>
            <dt>{d.label}</dt>
            <dd>{d.label === "Verdict" && info ? <StatusBadge label={info.label} tone={info.tone} /> : d.value}</dd>
          </Fragment>
        ))}
      </dl>
      {info && <p className="sub-explain">{info.explanation}</p>}
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
export function SemanticOverlapNote({
  overlap,
  onOpenDesign,
  onOpenTab,
}: {
  overlap: SemanticOverlap;
  onOpenDesign?: (designId: string) => void;
  onOpenTab?: (tab: "conflicts") => void;
}) {
  const { thread, counterpart } = overlap;
  const info = conflictKindInfo("llm_divergence");
  return (
    <div className="detail-field resolve-actions resolve-pending">
      <h3>{info.label}</h3>
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
          <button type="button" className="link-chip" onClick={() => onOpenTab("conflicts")}>
            View conflict →
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
 * panel's. Which one(s) make sense depends entirely on *why* it's flagged
 * (see DesignVerdict's doc comment, packages/core/src/types.ts, for the
 * four-bucket model): `constraint_violation` names a rule, not another
 * design, so there's nothing to adopt -- justify is the only path (and
 * still needs a project admin to decide it -- §17's one bucket where
 * approval isn't the flagged developer's own to give). `symbol_conflict`
 * names one or more specific conflicting designs -- like `file_overlap`
 * before it, but sourced from real `Claim`s via an async `design_flagged`
 * rather than the synchronous `design_checked` -- so adopting one of those
 * (superseding this one outright, no review needed) is offered alongside a
 * self-clearing justify. `llm_divergence` names a conflicting design too,
 * but with no specific paths behind it (a judgement about intent, not
 * files) -- adopt is still offered since `resolve`'s `adopted` path is
 * generic (`designs.supersede`, no verdict-specific logic server-side), but
 * there's nothing path-level to show for why. Own fetches for the latest
 * check payload and this project's pending reviews -- same "independent
 * bonus panel" shape as `LatestCheckOutcome` above, deliberately not
 * sharing its query (it only keeps formatted strings, not the raw
 * conflict/constraint ids this needs). Renders nothing once the design
 * isn't `"flagged"` -- `file_overlap` never needed resolving in the first
 * place. */
export function ResolveActions({ design, onResolved, readOnly }: { design: DesignStatement; onResolved: () => void; readOnly?: boolean }) {
  const apiFetch = useApiFetch();
  // This component's own refresh signal, separate from the parent list's:
  // an "adopted" resolve changes `design.status`, which the parent's own
  // refetch (via `onResolved`) picks up and re-renders this component away
  // entirely -- but "justified_divergence" leaves `status: "flagged"`
  // unchanged (only a new pending review exists), so *this* component has
  // to re-query its own `reviewsState` itself to notice that, or it'd be
  // stuck showing the just-submitted form forever.
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  // 2026-08-26: also fetch `design_flagged` -- `symbol_conflict`/
  // `llm_divergence` are only ever set via `DesignRegistry.flag()` from an
  // async pass (`/v1/claims`, the semantic comparator), which never fires a
  // matching `design_checked` event at all; `constraint_violation` still
  // fires both (design_checked first, then flag() from the same request),
  // so this always finds the newest of whichever exists.
  const checkState = useAsyncData(
    () => fetchActivity(apiFetch, design.projectId, { relatedId: design.id, kinds: ["design_checked", "design_flagged"], limit: 1 }),
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
  const pendingReview = reviewsState.data.items.find((r) => r.designId === design.id);

  if (pendingReview) {
    return (
      <div className="detail-field resolve-actions resolve-pending">
        <h3>Justified -- pending review</h3>
        <p className="resolve-pending-note">&ldquo;{pendingReview.justification}&rdquo;</p>
        <p className="resolve-pending-note">Waiting on a project admin&apos;s decision (see the Reviews tab).</p>
      </div>
    );
  }

  // Public "observe twing getting built" demo (2026-08-28): the server
  // already rejects any POST from this identity regardless of what renders
  // here (the publicProjectId auth branch is GET-only by construction) --
  // this is purely the UX nicety of not showing a form a visitor can't use.
  if (readOnly) return null;

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
      {payload.conflicts && payload.conflicts.length > 0 && (
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
            payload.verdict === "constraint_violation"
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
  readOnly,
}: {
  design: DesignStatement;
  onResolved: () => void;
  semanticOverlap?: SemanticOverlap;
  onOpenDesign?: (designId: string) => void;
  onOpenTab?: (tab: "conflicts") => void;
  readOnly?: boolean;
}) {
  const apiFetch = useApiFetch();
  const claimsState = useAsyncData(() => fetchClaims(apiFetch, design.projectId, design.sessionId), [apiFetch, design.projectId, design.sessionId]);

  return (
    <div className="design-detail">
      <LatestCheckOutcome design={design} />
      {semanticOverlap && <SemanticOverlapNote overlap={semanticOverlap} onOpenDesign={onOpenDesign} onOpenTab={onOpenTab} />}
      <ResolveActions design={design} onResolved={onResolved} readOnly={readOnly} />

      {/* The design's own words are what a reviewer highlights and comments
          on, so they sit inside the review scope with its rail beside them
          -- above the bookkeeping block, which is reference material. */}
      <DesignReview designs={[design]} readOnly={readOnly}>
        {/* The design's architecture: an ExitPlanMode plan, or a template's
            `plan:` -- every design has one since 2026-09-29, when the
            coordinator started refusing registrations without. Shown beside
            the structured changes, not instead of them: the plan says how
            and why, the changes say which files. (It used to be hidden
            whenever `changes` existed, back when `register --from` sent its
            YAML here as a carrier for coordinators with no `changes`
            column.) */}
        {design.rawPlanExcerpt && (
          <div className="detail-field">
            <h3>Plan text</h3>
            <pre className="plan-text">
              <HighlightableText designId={design.id} field="plan" text={design.rawPlanExcerpt} />
            </pre>
          </div>
        )}

        {/* Two renderings of the same question, chosen by whether this
            design was registered from a template. The structured one
            supersedes the path lists entirely rather than sitting alongside
            them -- `creates`/`touches` are *derived* from `changes` for a
            --from registration (core's `deriveScope`), so showing both would
            print the same paths twice, once with the verb and once without.
            `dependsOn` has no structured equivalent and is shown either
            way. */}
        {hasStructuredChanges(design.changes) ? (
          <DeclaredChanges designId={design.id} changes={design.changes} claims={claimsState.status === "ready" ? claimsState.data : []} />
        ) : (
          <>
            <PathList title="Creates" paths={design.creates} />
            <PathList title="Touches" paths={design.touches} />
          </>
        )}
        <PathList title="Depends on" paths={design.dependsOn} />
      </DesignReview>

      {/* Below the review, not above it: feedback the developer will act on
          is the point of this page, and a private chat is the thing you do
          on the way to leaving some. */}
      <DesignChat design={design} readOnly={readOnly} />

      <div className="detail-field detail-bookkeeping">
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
          {/* `?? []` -- defensive, not expected in practice (the server
              always defaults both to `[]`, never omits them): guards
              against an older/incomplete fixture or hand-built object that
              predates these two fields existing at all. */}
          {(design.justifiedConflicts ?? []).length > 0 && (
            <>
              <dt>Justified llm divergences</dt>
              <dd>{design.justifiedConflicts.length}</dd>
            </>
          )}
          {(design.justifiedSymbolConflicts ?? []).length > 0 && (
            <>
              <dt>Justified symbol conflicts</dt>
              <dd>{design.justifiedSymbolConflicts.length}</dd>
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
