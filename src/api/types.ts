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

/** Mirrors @twing/core's PendingReview. */
export interface PendingReview {
  id: string;
  designId: string;
  projectId: string;
  justification: string;
  createdAt: number;
  decision?: "approve" | "reject";
  constraintId?: string;
  overlapWaivers?: { conflictingDesignId: string; paths: string[] }[];
}

/** Mirrors @twing/core's DesignConstraint. */
export interface DesignConstraint {
  id: string;
  projectId: string;
  type: "canonical_abstraction" | "review_required";
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

/** 2026-08-23 categorization redesign -- mirrors SemanticConflictKind
 * (packages/server/src/design-semantic-check.ts) for the three semantic
 * values; "symbol_claim" is the claims-path (design-divergence.ts)
 * equivalent. Absent on a pre-2026-08-23 AlignmentThread. */
export type AlignmentCategory = "duplication" | "contradictory_assumptions" | "tension" | "symbol_claim";

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
  /** Short list-view label, distinct from `systemDescription`'s full text.
   * Absent on a pre-2026-08-23 thread. */
  summary?: string;
  /** Every overlapping path/symbol accumulated across amendments -- only
   * meaningful for `category: "symbol_claim"`. Falls back to `[symbolId]`
   * server-side for a pre-2026-08-23 row. */
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
