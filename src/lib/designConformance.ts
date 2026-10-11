/**
 * Declared changes vs. what a session actually edited (2026-09).
 *
 * A `DesignChange.target` and a `Claim.symbolId` are the *same string
 * format* (`path::Symbol.method`, core's `computeSymbolId`). That shared
 * namespace is the entire reason this file is set arithmetic rather than a
 * model call:
 *
 *     declared − actual  =  declared, never built
 *     actual   − declared =  built, never declared
 *
 * Both directions matter and they are not symmetric in meaning. The first
 * is usually benign (work in progress, or a plan that changed); the second
 * is the one worth surfacing, because it is scope the design never claimed.
 *
 * **Pure, no I/O, no fetching.** Both inputs are already in the browser --
 * `DesignDetail` fetches claims today and renders them in a list that sits
 * disconnected from the declaration it should be compared against. This
 * only joins two things the component already has.
 *
 * Deliberately *not* a strict string equality on the whole target. Claims
 * arrive at whatever granularity Tree-sitter resolved: a localized `Edit`
 * produces `path::Symbol`, but a whole-file `Write`, an unparseable file
 * (Tree-sitter is JS/TS-only) or a failed edit-point lookup all fall back
 * to a bare `path` with no `::` at all. Comparing those literally would
 * report every whole-file write as undeclared scope. `matchesTarget` below
 * is what makes a file-level claim satisfy a symbol-level declaration in
 * the same file, and vice versa.
 */

import type { Claim, DesignChange, DesignChangeKind } from "../api/types.js";

/** `src/net/retry.ts::RetryPolicy.backoff` -> `src/net/retry.ts`.
 *
 * Mirrors `pathOfTarget` (@twing/core's design-scope.ts). Kept as a local
 * copy for the same reason the types above are mirrored rather than
 * imported -- twing-monitor talks to the coordinator over HTTP only and
 * doesn't depend on @twing/core. */
export function pathOfTarget(target: string): string {
  const separator = target.indexOf("::");
  return separator === -1 ? target : target.slice(0, separator);
}

/** The kind a change is treated as. Absent means `"code"` -- one place, so
 * no caller invents a different default. */
export function kindOf(change: DesignChange): DesignChangeKind {
  return change.kind ?? "code";
}

/**
 * Whether a design carries a structured declaration at all.
 *
 * The single place the absent-vs-empty distinction is decided, so no
 * component re-derives it: **absent** means this design was never
 * registered from a template (ExitPlanMode extraction, or plain
 * `--summary`/`--touches` flags) and must fall back to the legacy
 * creates/touches rendering. An empty array would mean "declared nothing",
 * which the CLI refuses to register -- but it is treated as "no structure"
 * here too rather than rendering a card of empty sections.
 */
export function hasStructuredChanges(changes: DesignChange[] | undefined): changes is DesignChange[] {
  return Array.isArray(changes) && changes.length > 0;
}

/** Whether a claim's symbolId and a declared target refer to the same work.
 *
 * Exact match first, then the granularity fallback described in this file's
 * header: either side may be file-level while the other is symbol-level,
 * and both directions are a match. Two *different* symbols in one file are
 * not -- that would make any claim anywhere in a declared file count as
 * satisfying every declaration in it, which is precisely the imprecision
 * the shared namespace exists to avoid. */
function matchesTarget(symbolId: string, target: string): boolean {
  if (symbolId === target) return true;
  const symbolIsFileLevel = !symbolId.includes("::");
  const targetIsFileLevel = !target.includes("::");
  if (!symbolIsFileLevel && !targetIsFileLevel) return false;
  return pathOfTarget(symbolId) === pathOfTarget(target);
}

export type ConformanceState = "matched" | "not_yet_edited";

export interface DeclaredRow {
  change: DesignChange;
  state: ConformanceState;
}

export interface ConformanceReport {
  declared: DeclaredRow[];
  /** Claims matching no declared target -- scope the design never claimed.
   * The direction worth a reader's attention. */
  undeclared: string[];
  matchedCount: number;
}

/**
 * Joins declared changes against the session's recorded claims.
 *
 * Only `kind: "write"` claims count. A `read` claim (`Read`/`Grep`/`Glob`,
 * per core's `stageForTool`) records that a session *looked* at a symbol,
 * which is not evidence anything was built and would otherwise mark every
 * file the agent merely opened as undeclared scope.
 *
 * `undeclared` is deduped and sorted for a stable render: several writes to
 * one symbol are one finding, not one per claim, and claim order is
 * arrival order rather than anything a reader would recognize.
 */
export function computeConformance(changes: DesignChange[], claims: Claim[]): ConformanceReport {
  const writes = claims.filter((claim) => claim.kind === "write");

  const declared: DeclaredRow[] = changes.map((change) => ({
    change,
    state: writes.some((claim) => matchesTarget(claim.symbolId, change.target)) ? "matched" : "not_yet_edited",
  }));

  const undeclared = [
    ...new Set(
      writes
        .filter((claim) => !changes.some((change) => matchesTarget(claim.symbolId, change.target)))
        .map((claim) => claim.symbolId),
    ),
  ].sort();

  return {
    declared,
    undeclared,
    matchedCount: declared.filter((row) => row.state === "matched").length,
  };
}

/**
 * The collapsed card's one-line blast radius -- "4 changes · 2 files · 1
 * rename · schema".
 *
 * Replaces `"N created, M touched"`, which counted two bags of paths whose
 * difference a reader has no reason to care about. Every segment here
 * answers something someone scanning a list actually asks, and each is
 * omitted when it would say nothing: no rename count when there are no
 * renames, no schema flag when no schema is touched.
 *
 * Renames are called out separately because they are the one action
 * asserting behaviour did *not* change -- a card that is mostly renames is
 * a very different review from one that is mostly rewrites, and that is
 * invisible if both just count as "changes".
 */
export function blastRadius(changes: DesignChange[]): string {
  const files = new Set(changes.map((change) => pathOfTarget(change.target)));
  const renames = changes.filter((change) => change.action === "rename" || change.action === "move").length;
  const kinds = new Set(changes.map(kindOf));

  const parts = [
    `${changes.length} change${changes.length === 1 ? "" : "s"}`,
    `${files.size} file${files.size === 1 ? "" : "s"}`,
  ];
  if (renames > 0) parts.push(`${renames} rename${renames === 1 ? "" : "s"}`);
  if (kinds.has("schema")) parts.push("schema");
  if (kinds.has("api")) parts.push("API");
  return parts.join(" · ");
}

/** Section order for the detail view. Deliberately fixed rather than
 * derived from the data: a reader learns one shape and then knows where to
 * look, which is the entire point of a template. Schema and config sit
 * directly under code because "does this touch the database or change how
 * it's configured" is the first thing anyone reviewing a change asks. */
const KIND_ORDER: DesignChangeKind[] = ["code", "schema", "config", "api", "test", "docs"];

/** Plain-language section names. These are read by people who have never
 * opened the schema doc, so they say "Database" rather than "schema" and
 * "Configuration" rather than "config" -- the stored vocabulary is an
 * implementation detail, not a label. */
export function kindLabel(kind: string): string {
  switch (kind) {
    case "code":
      return "Code";
    case "schema":
      return "Database";
    case "config":
      return "Configuration";
    case "api":
      return "API / contracts";
    case "test":
      return "Tests";
    case "docs":
      return "Documentation";
    default:
      return kind;
  }
}

/** What each section means, for someone who shouldn't have to guess. Shown
 * under the heading once a section is opened, and as the tooltip on a
 * closed one. */
export function kindDescription(kind: string): string {
  switch (kind) {
    case "code":
      return "Functions, classes and modules";
    case "schema":
      return "Tables, columns, migrations and indexes";
    case "config":
      return "Environment variables, feature flags and deploy settings";
    case "api":
      return "Routes, exported signatures and anything outside callers depend on";
    case "test":
      return "Test files";
    case "docs":
      return "Prose, comments and README changes";
    default:
      return "";
  }
}

export interface KindGroup {
  kind: string;
  changes: DesignChange[];
}

/**
 * Every kind, in fixed order, including the ones with nothing in them.
 *
 * Reversed from the original "omit empty sections" design (2026-09), which
 * was wrong for the question this view exists to answer. A reader asking
 * "does this touch the database?" needs to see the word *Database* and the
 * word *none* next to each other. An omitted section is indistinguishable
 * from a section the reader simply scrolled past, so silence forced them
 * back to reading every target path -- exactly what the kind axis was
 * added to avoid.
 *
 * This is only honest because every kind here is one an author can actually
 * declare (see `DesignChangeKind`, @twing/core, on why `config` was
 * promoted for precisely this reason). A kind nobody can write down would
 * render a "none" that means "unsayable", not "absent".
 *
 * Unrecognized kinds -- a coordinator that promoted one of the spec's
 * remaining reserved names -- are appended rather than dropped, so their
 * changes never vanish silently.
 */
export function groupByKind(changes: DesignChange[]): KindGroup[] {
  const seen = [...new Set(changes.map(kindOf))];
  const extras = seen.filter((kind) => !KIND_ORDER.includes(kind)).sort();
  return [...KIND_ORDER, ...extras].map((kind) => ({
    kind,
    changes: changes.filter((change) => kindOf(change) === kind),
  }));
}

/** One accent per kind, for the diffstat bar and its legend dots. A
 * dedicated small palette (`--kind-*`, index.css), not the app's existing
 * semantic colors -- `--accent-text`/`--danger`/`--warning`/`--good` already
 * mean something specific elsewhere on this same page (brand/selection,
 * error, drift-risk, matched), and reusing them categorically made two
 * unrelated kinds (code, schema) render as the same reddish blob in an 8px
 * bar. */
export function kindColor(kind: string): string {
  switch (kind) {
    case "code":
      return "var(--kind-code)";
    case "schema":
      return "var(--kind-schema)";
    case "api":
      return "var(--kind-api)";
    case "test":
      return "var(--kind-test)";
    case "docs":
      return "var(--kind-docs)";
    case "config":
      return "var(--kind-config)";
    default:
      return "var(--text-dim)";
  }
}

/** One group member's slice of the group-level "What's changing" merge: its
 * declared changes, its already-fetched claims, and a short label for which
 * repo it belongs to. Claims stay fetched per member (a linked group can
 * span sessions and projects, same reason `MemberChanges` always fetched its
 * own) -- this type is just what `groupByKindAcrossMembers` folds into one
 * kind-grouped view instead of stacking N per-member panels. */
export interface MemberSlice {
  designId: string;
  repoLabel: string;
  changes: DesignChange[];
  claims: Claim[];
}

export interface MergedChangeRow {
  change: DesignChange;
  designId: string;
  repoLabel: string;
  state: ConformanceState;
}

export interface RepoCount {
  label: string;
  count: number;
}

export interface MergedKindGroup {
  kind: string;
  rows: MergedChangeRow[];
  /** Every repo represented in this kind, each with its count -- length 1
   * for a kind that happens to live entirely in one repo, even inside a
   * group that spans several. This is the per-row cue for whether a repo
   * chip is worth printing (`length > 1`), rather than printing one on
   * every row just because the group as a whole spans repos -- see Option
   * A's own rationale note (`whats-changing-redesign.html`) for why that
   * distinction is the point. */
  repoCounts: RepoCount[];
}

/**
 * `groupByKind`, across every member of a group at once.
 *
 * Reuses `computeConformance` per member rather than re-deriving match state
 * here, so "matched" means exactly what it means in the single-design view
 * -- a merge of that same report, not a second definition of conformance
 * that could drift from the first. A member's claims are only ever compared
 * against that same member's declared targets (one `computeConformance`
 * call per member, never pooled across them), so a symbol built in one repo
 * can never "satisfy" a declaration in another.
 */
export function groupByKindAcrossMembers(members: MemberSlice[]): MergedKindGroup[] {
  const rows: MergedChangeRow[] = members.flatMap((member) => {
    const report = computeConformance(member.changes, member.claims);
    const stateByChangeId = new Map(report.declared.map((row) => [row.change.id, row.state]));
    return member.changes.map((change) => ({
      change,
      designId: member.designId,
      repoLabel: member.repoLabel,
      state: stateByChangeId.get(change.id) ?? ("not_yet_edited" as ConformanceState),
    }));
  });

  const seen = [...new Set(rows.map((r) => kindOf(r.change)))];
  const extras = seen.filter((kind) => !KIND_ORDER.includes(kind)).sort();
  return [...KIND_ORDER, ...extras].map((kind) => {
    const kindRows = rows.filter((r) => kindOf(r.change) === kind);
    const counts = new Map<string, number>();
    for (const r of kindRows) counts.set(r.repoLabel, (counts.get(r.repoLabel) ?? 0) + 1);
    return { kind, rows: kindRows, repoCounts: [...counts.entries()].map(([label, count]) => ({ label, count })) };
  });
}

export interface MergedUndeclared {
  symbolId: string;
  repoLabel: string;
}

export interface MergedConformanceReport {
  matchedCount: number;
  totalCount: number;
  undeclared: MergedUndeclared[];
}

/**
 * `computeConformance`'s "N of M edited so far" line, across every member of
 * a group at once -- one number for the whole group instead of one per
 * member, which is the number a reviewer actually wants (see this file's
 * module doc, and Option A's own rationale note on why two separate "3 of
 * 4" lines just make the reader do the addition themselves).
 */
export function computeConformanceAcrossMembers(members: MemberSlice[]): MergedConformanceReport {
  let matchedCount = 0;
  let totalCount = 0;
  const undeclared: MergedUndeclared[] = [];
  for (const member of members) {
    const report = computeConformance(member.changes, member.claims);
    matchedCount += report.matchedCount;
    totalCount += member.changes.length;
    undeclared.push(...report.undeclared.map((symbolId) => ({ symbolId, repoLabel: member.repoLabel })));
  }
  return { matchedCount, totalCount, undeclared };
}
