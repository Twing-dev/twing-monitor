/**
 * Hand-rolled mirrors of twing-cli's server response shapes -- twing-monitor
 * is a separate repo/package (MIT-licensed, talks to the coordinator over
 * HTTP only), so it doesn't import `packages/server`'s types directly.
 * Once `@twing/core` is added as an npm dependency, `DesignStatement`/
 * `PendingReview`/`DesignConstraint` here could be replaced by re-exports
 * from there instead -- kept hand-rolled for now to avoid adding a
 * dependency for this first pass. `ProjectSummary`/`AlignmentThread`/
 * `ProjectMember` have no `@twing/core` equivalent regardless (aggregates
 * or server-only shapes), so those stay hand-rolled either way.
 */

/** Mirrors GET /v1/projects's per-item shape (packages/server/src/app.ts). */
export interface ProjectSummary {
  projectId: string;
  /** "" for a GitHub-founded project with no twing org at all (§17 Phase 3). */
  orgId: string;
  role: "admin" | "member";
  foundedBy?: string;
  /** Epoch ms. */
  foundedAt?: number;
  githubOwner?: string;
  githubRepo?: string;
}

/** Mirrors @twing/core's DesignStatement (packages/core/src/types.ts). */
export interface DesignStatement {
  id: string;
  /** §17 design linking (2026-08, twing-cli): cross-project label --
   * self-assigned to this design's own `id` server-side when the
   * registering caller doesn't supply one, so every design has a non-null
   * `groupId` ("group of one" by default). A sibling design registered for
   * the same unit of work in a *different* project shares this value.
   * Linking is purely a label -- `projectId`/`status`/`reviewDecision`/
   * `creates`/`touches`/`dependsOn` all stay independent per row; only
   * `summary` and closing propagate across a shared `groupId`
   * server-side. `lib/aggregate.ts`'s `dedupeDesignsByGroup` is what
   * collapses every row sharing a `groupId` into one card in the
   * multi-repo view. Absent (not self-assigned) only on a design
   * registered before this field existed. */
  groupId?: string;
  projectId: string;
  developerId: string;
  sessionId: string;
  agentLabel?: string;
  status: "open" | "flagged" | "dormant" | "superseded" | "closed" | "expired";
  createdAt: number;
  closedAt?: number;
  summary: string;
  creates: string[];
  touches: string[];
  dependsOn: string[];
  /** The verbatim ExitPlanMode plan text, when this design came from one --
   * despite the "excerpt" name it's the full text, uncapped (core's own doc
   * comment explains the historical name). Never set on a `twing design
   * register` structured registration. */
  rawPlanExcerpt?: string;
  ttlMs: number;
  scopeVersion: number;
  lastActivityAt: number;
  reviewDecision?: "approve" | "reject";
  justifiedConstraintIds: string[];
  justifiedOverlaps: string[];
  /** Semantic comparator's counterpart to `justifiedOverlaps` -- entries are
   * bare conflicting design ids (an `llm_divergence` verdict has no path
   * evidence to key on). */
  justifiedConflicts: string[];
  /** `symbol_conflict`'s own approval memory (2026-08-26 terminology
   * simplification) -- same composite-key shape as `justifiedOverlaps`, kept
   * as its own field since a `file_overlap` warning and a `symbol_conflict`
   * block are philosophically different waivers even though the key shape
   * coincides. */
  justifiedSymbolConflicts: string[];
}

/** Mirrors @twing/core's Claim (packages/core/src/types.ts) -- the
 * advisory/capture-path record of a symbol a session actually touched,
 * shown in the design detail panel next to what the DesignStatement itself
 * declared up front (creates/touches). */
export interface Claim {
  projectId: string;
  developerId: string;
  sessionId: string;
  branch: string;
  symbolId: string;
  kind: "read" | "write";
  stage: "soft" | "firm";
  signatureChanged?: boolean;
  ts: number;
  ttlMs: number;
}

/** Mirrors @twing/core's EnrichedPendingReview -- the shape `GET /v1/reviews`
 * returns as of 2026-08-25.
 *
 * `constraintIds` was declared here as a singular `constraintId` until then,
 * left behind when the server pluralised it (2026-08-22, plural: one
 * justified divergence can settle several distinct constraint matches at
 * once). Because this type is hand-rolled rather than imported from
 * @twing/core, nothing caught the drift: `ReviewsView` read `r.constraintId`,
 * which was always `undefined`, so the constraint-waiver marker on a review
 * card never rendered once. `conflictWaivers`/`symbolConflictWaivers`
 * (2026-08-26: the semantic comparator's llm_divergence judgement, and
 * symbol_conflict's counterpart to `overlapWaivers` naming the specific
 * symbols that collided) were likewise missing until now. Worth remembering
 * when deciding whether to keep hand-rolling these -- see this file's header
 * comment. */
export interface PendingReview {
  id: string;
  designId: string;
  projectId: string;
  justification: string;
  createdAt: number;
  decision?: "approve" | "reject";
  constraintIds?: string[];
  overlapWaivers?: { conflictingDesignId: string; paths: string[] }[];
  conflictWaivers?: { conflictingDesignId: string }[];
  symbolConflictWaivers?: { conflictingDesignId: string; symbolIds: string[] }[];

  /** Everything below is server-assembled and optional. A coordinator
   * predating the enrichment simply omits it, and the review card falls
   * back to its previous justification-led rendering. */
  design?: {
    summary: string;
    creates: string[];
    touches: string[];
    developerId: string;
    status: string;
  };
  constraints?: { id: string; statement: string; type: string }[];
  /** `kind` mirrors @twing/core's `ReviewConflictSummary` -- `"overlap"`/
   * `"conflict"` are this field's own waiver-kind labels, not `DesignVerdict`
   * values (`"conflict"` here means what's now called the `llm_divergence`
   * bucket; left unrenamed server-side to keep that diff bounded). */
  conflicts?: {
    designId: string;
    kind: "overlap" | "conflict" | "symbol_conflict";
    summary?: string;
    developerId?: string;
    paths?: string[];
  }[];
}

/** Mirrors @twing/core's DesignConstraintType/DesignConstraint. `type`
 * collapsed from a three-way union to this single value (2026-08-26
 * terminology simplification) -- kept on the wire rather than removed, same
 * reasoning as the `constraints` payload-key rename before it. A
 * pre-2026-08-26 row may still carry its old `"canonical_abstraction"` /
 * `"domain_fact"` / `"review_required"` value verbatim server-side (no
 * migration touched existing rows), same "never backfilled" convention
 * twing-cli's own server-side type applies to itself -- see
 * DesignConstraintType's doc comment in packages/core/src/types.ts. */
export type DesignConstraintType = "constraint";

export interface DesignConstraint {
  id: string;
  projectId: string;
  type: DesignConstraintType;
  statement: string;
  scope: string[];
  source: string;
  createdAt: number;
}

/** Mirrors packages/server/src/activity-log.ts's ActivityEvent. `kind` is
 * left as `string` rather than the full closed union server-side owns --
 * a dashboard rendering an unrecognized future kind should degrade to a
 * raw-JSON fallback (see ActivityEventRow's per-kind formatter map), not
 * fail a type check that has to be kept in lockstep with every new kind
 * the server ever adds. */
export interface ActivityEvent {
  id: string;
  projectId: string;
  developerId?: string;
  sessionId?: string;
  kind: string;
  relatedId?: string;
  ts: number;
  payload?: unknown;
}

/** 2026-08-26 terminology simplification -- mirrors packages/server/src/
 * alignment-store.ts's AlignmentCategory: which of the two self-approvable
 * design-conflict buckets a thread represents (see DesignVerdict's doc
 * comment, packages/core/src/types.ts, for the full four-bucket model).
 * Collapsed from the four-way `"duplication" | "contradictory_assumptions" |
 * "tension" | "symbol_claim"` union below -- those were a bucket name and
 * its sub-reason tangled into one field. The old four values survive as
 * `AlignmentSubKind`/`AlignmentThread.subKind`, detail text under the
 * bucket rather than a competing top-level name. A pre-2026-08-26 thread
 * keeps its old value in `category` unconverted (never backfilled) -- use
 * `legacyCategoryBucket` to treat old and new rows uniformly. */
export type AlignmentCategory = "symbol_conflict" | "llm_divergence";

/** Detail label shown under the bucket name -- `duplication` /
 * `contradictory_assumptions` / `tension` for `llm_divergence` (mirrors
 * `SemanticConflictKind`, design-semantic-check.ts's only producer), or
 * `real_edit_collision` / `scope_intrusion` / `contract_break` for
 * `symbol_conflict`. Undefined on any thread that predates this column. */
export type AlignmentSubKind =
  | "duplication"
  | "contradictory_assumptions"
  | "tension"
  | "real_edit_collision"
  | "scope_intrusion"
  | "contract_break";

/** Legacy pre-2026-08-26 `category` strings, mapped to which of the two
 * current buckets they represent -- mirrors alignment-store.ts's function of
 * the same name. Use for any reader that needs to treat old rows uniformly
 * with new ones (list-view filtering, etc.) without a backfill. */
export function legacyCategoryBucket(raw: string): AlignmentCategory | undefined {
  switch (raw) {
    case "duplication":
    case "contradictory_assumptions":
    case "tension":
      return "llm_divergence";
    case "symbol_claim":
      return "symbol_conflict";
    default:
      return undefined;
  }
}

/** Resolves a thread's raw `category` to which of the two current buckets
 * it represents, old or new row alike -- `legacyCategoryBucket` handles the
 * pre-2026-08-26 four-way strings, anything else already in the new shape
 * passes through unchanged. Extracted out of `AlignmentThreadsView.tsx`
 * (originally `bucketOf`, its only caller) so `DesignsView.tsx` can filter
 * threads by bucket the same way instead of a second, drifting copy of this
 * same two-line resolution (2026-08-26, alongside fixing
 * `findSemanticOverlapThread`'s dead-`symbolId` bug -- see its own doc
 * comment). */
export function resolveAlignmentBucket(category?: string): AlignmentCategory | undefined {
  if (!category) return undefined;
  return legacyCategoryBucket(category) ?? (category as AlignmentCategory);
}

/** Mirrors packages/server/src/alignment-store.ts's AlignmentThread. */
export interface AlignmentThread {
  id: string;
  projectId: string;
  /** Legacy single-symbol field -- see `symbolIds` below, the source of
   * truth going forward. */
  symbolId: string;
  developerId: string;
  otherDeveloperId: string;
  designId?: string;
  status: "open" | "closed";
  systemDescription: string;
  openedAt: number;
  closedAt?: number;
  closedBy?: string;
  category?: AlignmentCategory;
  /** Detail label under the bucket name -- see `AlignmentSubKind`'s own doc
   * comment. Undefined on any thread that predates this column. */
  subKind?: AlignmentSubKind;
  /** Short list-view label, distinct from `systemDescription`'s full text.
   * Absent on a pre-2026-08-23 thread. */
  summary?: string;
  /** Every overlapping path/symbol accumulated across amendments -- only
   * meaningful for `category: "symbol_conflict"` (was `"symbol_claim"`
   * before the 2026-08-26 rename). Falls back to `[symbolId]` server-side
   * for a pre-2026-08-23 row. */
  symbolIds: string[];
  /** The initiating developer's own open design, when one resolves --
   * best-effort; genuinely absent (not a bug) when the initiating edit had
   * no design behind it at all (the design gate has real, supported
   * bypasses). */
  initiatingDesignId?: string;
  /** Falls back to `openedAt` server-side when a thread's never been
   * amended (or predates this column). */
  lastActivityAt: number;
}

export interface AlignmentMessage {
  authorId?: string;
  message: string;
  ts: number;
}

/** Mirrors GET /v1/projects/:id/developers's per-item shape. */
export interface ProjectMember {
  projectId: string;
  developerId: string;
  role: "admin" | "member";
}
