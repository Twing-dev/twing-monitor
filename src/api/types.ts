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

/** Mirrors @twing/core's `DesignChangeAction` -- what happens to a target.
 * Split on one question: `rename`/`move` assert behaviour did NOT change
 * (only the name or the path did), the other four assert it did. That split
 * is why they render differently below: a rename shows its `from` inline,
 * because "only the name changed" is the claim being made. */
export type DesignChangeAction = "add" | "modify" | "rewrite" | "remove" | "rename" | "move";

/** Mirrors @twing/core's `DesignChangeKind` -- what *sort of thing* is being
 * changed, the axis that lets a reader ask "does this touch the database?"
 * without reading every path.
 *
 * Typed as a closed union but never exhaustively switched on: `kindLabel`
 * and the section ordering both fall back for an unrecognized value, so a
 * coordinator that promotes one of the spec's reserved kinds (`config`,
 * `dependency`, `build`) renders it in an "Other" section instead of
 * dropping it on the floor. Same reasoning `ActivityEvent.kind` gives for
 * staying `string` -- see its doc comment below. */
export type DesignChangeKind = "code" | "api" | "schema" | "test" | "docs" | "config";

/** Mirrors @twing/core's `DesignChange`.
 *
 * `target` is the load-bearing field: it uses the **same
 * `path::Symbol.method` namespace as `Claim.symbolId`**, which is what
 * makes "did they build what they declared" a set difference rather than a
 * judgement call (`lib/designConformance.ts`). If this ever diverges from
 * core's spelling, that comparison silently degrades to nonsense rather
 * than failing loudly -- the `constraintId`/`constraintIds` drift
 * documented on `PendingReview` below is the precedent for how that goes
 * unnoticed. */
export interface DesignChange {
  id: string;
  action: DesignChangeAction;
  /** Absent means `"code"`, which is what `kindOf` resolves it to -- the
   * common case is deliberately left unwritten in the template. */
  kind?: DesignChangeKind;
  target: string;
  intent: string;
  /** The previous name (`rename`) or path (`move`). Present on exactly
   * those two actions. */
  from?: string;
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
  /** The structured declaration, for a design registered from a template
   * (`twing design register --from`). Absent -- never `[]` -- for every
   * other registration path, and the two mean different things here:
   * absent falls back to the legacy `creates`/`touches` rendering, while an
   * empty list would mean "declared nothing", which the CLI refuses to
   * register in the first place. See `hasStructuredChanges` in
   * `lib/designConformance.ts`, the one place that distinction is
   * decided. */
  changes?: DesignChange[];
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
  /** Widened 2026-08-27 (tightening alignment threads item 4) to add
   * `"dormant"` -- distinct from `"closed"`: a thread goes dormant when the
   * design lifecycle behind it goes quiet on its own (inactivity), never as
   * a deliberate party action, and it's explicitly reversible (a resumed
   * design wakes its threads back to `"open"`; see
   * packages/server/src/alignment-store.ts's `dormant`/`wake`). */
  status: "open" | "closed" | "dormant";
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

/**
 * Design review comments (2026-09) -- mirrors `DesignComment` in twing-cli's
 * `packages/core/src/types.ts`.
 *
 * This is the first channel in twing that runs human -> agent, and the first
 * thing this dashboard *writes*. Everything else here reads: claims, designs
 * and alignment threads are all machine-produced records of what agents did.
 * A comment is a person asking a question about work that has not been done
 * yet, which is the one moment where redirecting an agent is nearly free.
 */
export type CommentAuthorKind = "human" | "agent";

/**
 * Four states on one axis: how far has this got toward being answered?
 *
 *  - `open` -- posted; the coordinator's first-pass answer hasn't landed yet.
 *  - `answered` -- the agent took its pass. The reviewer now decides whether
 *    that was enough.
 *  - `escalated` -- it wasn't, and the design's owner has been pulled in.
 *    The only state that reaches anyone's coding session.
 *  - `resolved` -- settled.
 *
 * `escalated` is not a failure and not terminal.
 */
export type DesignCommentStatus = "open" | "answered" | "escalated" | "resolved";

export interface DesignComment {
  id: string;
  projectId: string;
  designId: string;
  authorId: string;
  body: string;
  /** The `DesignChange.id` this comment was left against, when it was left
   * against one specific declared change rather than the design as a whole.
   *
   * Not guaranteed to resolve: an amendment can drop the change id out from
   * under a comment that named it. A reader that can't resolve it must show
   * the comment unanchored rather than hide it -- losing the anchor must
   * never lose the question. */
  targetChangeId?: string;
  status: DesignCommentStatus;
  agentAnsweredAt?: number;
  escalatedAt?: number;
  escalatedBy?: string;
  /** Set once the design's owner (or their agent, by running `twing design
   * comments`) has seen the escalation. Distinct from `resolvedAt`:
   * acknowledging is "I have seen this", resolving is "this is settled". */
  acknowledgedAt?: number;
  resolvedAt?: number;
  resolvedBy?: string;
  createdAt: number;
  updatedAt: number;
  /** Whether *this viewer* may close this comment -- computed server-side
   * from "the reviewer who asked, or a project admin".
   *
   * Sent per comment rather than left to the client to work out, for two
   * reasons: the rule lives in one place and cannot drift, and a full-auth
   * viewer has no reliable way to know their own identity here anyway -- it
   * lives behind their token, not in the browser. Absent on a coordinator
   * predating this, which reads as "not allowed" below; a hidden button on
   * an old server is a better failure than one that 403s on click. */
  canResolve?: boolean;
}

export interface DesignCommentReply {
  commentId: string;
  authorKind: CommentAuthorKind;
  /** Absent for the coordinator's own first-pass answer, which no developer
   * authored. */
  authorId?: string;
  message: string;
  ts: number;
}

/**
 * One turn in a reviewer's private chat with a design (design review phase 2,
 * 2026-09) -- mirrors `DesignChatMessage` in twing-cli's
 * `design-chat-store.ts`.
 *
 * `role` rather than an author id, because a chat has exactly two
 * participants: the reviewer who owns it and the coordinator answering. A
 * developer id would be the same value on every reviewer turn and absent on
 * every agent one.
 */
export interface DesignChatMessage {
  role: "reviewer" | "agent";
  message: string;
  ts: number;
  /** On an agent turn: one line saying what the answer was grounded in --
   * how many turns of which session, and how many of the design's declared
   * files that session touched.
   *
   * **Counts and ids only.** The session transcript itself never reaches
   * this browser: it is assembled server-side, sent to the model, and
   * discarded. A reviewer is entitled to an answer grounded in the session
   * and to know how well grounded it is, not to read a colleague's
   * conversation. */
  provenance?: string;
}
