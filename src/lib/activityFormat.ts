import type { ActivityEvent } from "../api/types.js";

export interface ActivityDetailField {
  label: string;
  value: string;
}

interface RawDesignConflict {
  conflictingDesignId: string;
  overlapKind: string;
  overlapDetail: string;
  conflictingSummary: string;
  overlapPaths?: string[];
}

interface RawConstraintMatch {
  id: string;
  statement: string;
  type: string;
}

export interface FormattedActivityEvent {
  label: string;
  details: ActivityDetailField[];
  /** Cross-references into the other views -- `RepoDetailLayout` turns
   * these into clickable jumps (Designs tab, expanded; Alignment threads/
   * Constraints tab, switched to). Deliberately separate from `developerId`
   * (always on the event itself, never derived from payload) since a link
   * here means "open a different record," not "filter this feed." */
  designId?: string;
  /** The linked design's own summary, when the event's payload happens to
   * carry it (design_registered/checked/flagged/amended all do -- see
   * design-store.ts's `flag`/app.ts's `design_checked` append). Lets a link
   * read "-> Add retry backoff to the sync client" instead of a bare
   * "View design ->" with nothing to distinguish which design that is. */
  designSummary?: string;
  constraintId?: string;
  threadId?: string;
  /** design_checked/design_flagged only (2026-08-19 severity split,
   * design-checks.ts): "warning" is display-only (the design stayed
   * "open", nothing blocked), "error" is today's original blocking
   * behavior. Absent on a "clean" verdict or a pre-split event. Surfaced
   * as its own field, not just a details row, so callers (DesignDetail's
   * conflict panel, in particular) can style/gate on it without
   * re-parsing `details`. */
  severity?: "warning" | "error";
}

/** design_checked/design_flagged share this shape (2026-08-19 enrichment:
 * both now carry the full `runDesignChecks` outcome, not just the bare
 * verdict string) -- factored out so "why was this non-clean" renders
 * identically wherever it shows up. */
function verdictDetails(p: unknown): ActivityDetailField[] {
  const conflicts = (p && typeof p === "object" && "conflicts" in p ? (p as Record<string, unknown>).conflicts : undefined) as RawDesignConflict[] | undefined;
  const constraint = (p && typeof p === "object" && "constraint" in p ? (p as Record<string, unknown>).constraint : undefined) as RawConstraintMatch | undefined;
  const fields: ActivityDetailField[] = [];
  if (conflicts && conflicts.length > 0) {
    fields.push({
      label: conflicts.length === 1 ? "Overlaps" : `Overlaps (${conflicts.length})`,
      value: conflicts.map((c) => `"${c.conflictingSummary || c.conflictingDesignId.slice(0, 8)}" -- ${c.overlapDetail}`).join("; "),
    });
  }
  if (constraint) {
    fields.push({ label: "Constraint", value: `[${constraint.type.replace(/_/g, " ")}] ${constraint.statement}` });
  }
  return fields;
}

function severityOf(p: unknown): "warning" | "error" | undefined {
  const v = str(p, "severity");
  return v === "warning" || v === "error" ? v : undefined;
}

function str(payload: unknown, key: string): string | undefined {
  if (payload && typeof payload === "object" && key in payload) {
    const v = (payload as Record<string, unknown>)[key];
    return typeof v === "string" ? v : undefined;
  }
  return undefined;
}

function arr(payload: unknown, key: string): string[] | undefined {
  if (payload && typeof payload === "object" && key in payload) {
    const v = (payload as Record<string, unknown>)[key];
    return Array.isArray(v) ? (v as string[]) : undefined;
  }
  return undefined;
}

function bool(payload: unknown, key: string): boolean | undefined {
  if (payload && typeof payload === "object" && key in payload) {
    const v = (payload as Record<string, unknown>)[key];
    return typeof v === "boolean" ? v : undefined;
  }
  return undefined;
}

function pathsField(label: string, paths: string[] | undefined): ActivityDetailField | undefined {
  if (!paths || paths.length === 0) return undefined;
  return { label, value: paths.join(", ") };
}

/** Per-kind label + structured detail fields + cross-reference links for
 * the activity feed. `ActivityEventKind` (packages/server/src/activity-log.ts)
 * is a closed union server-side, but this map is deliberately not
 * exhaustively type-checked against it -- `event.kind` here is `string`
 * (see types.ts's ActivityEvent doc comment), so an unrecognized future
 * kind falls through to the raw-JSON default instead of a type error
 * blocking a build over a kind this dashboard hasn't been taught yet. */
export function formatActivityEvent(event: ActivityEvent): FormattedActivityEvent {
  const p = event.payload;
  const relatedId = event.relatedId;

  switch (event.kind) {
    case "design_registered": {
      const details = [
        { label: "Summary", value: str(p, "summary") || "(no summary)" },
        pathsField("Creates", arr(p, "creates")),
        pathsField("Touches", arr(p, "touches")),
        pathsField("Depends on", arr(p, "dependsOn")),
      ].filter((f): f is ActivityDetailField => f !== undefined);
      return { label: bool(p, "reregistered") ? "Design re-registered" : "Design registered", details, designId: relatedId, designSummary: str(p, "summary") };
    }
    case "design_checked": {
      const verdict = str(p, "verdict");
      const severity = severityOf(p);
      const details = [
        verdict ? { label: "Verdict", value: verdict } : undefined,
        // Only shown once there's something to distinguish -- a "clean"
        // check has no severity at all, and there's nothing to warn about.
        severity ? { label: "Severity", value: severity } : undefined,
        ...verdictDetails(p),
      ].filter((f): f is ActivityDetailField => f !== undefined);
      return { label: "Design checked", details, designId: relatedId, designSummary: str(p, "summary"), severity };
    }
    case "design_flagged": {
      const verdict = str(p, "verdict");
      // design_flagged is only ever logged for an error-severity verdict
      // (2026-08-19 -- a warning stays "open" and is never flagged), so
      // this defaults to "error" even for an older event that predates the
      // payload carrying severity explicitly.
      const severity = severityOf(p) ?? "error";
      const details = [verdict ? { label: "Verdict", value: verdict } : undefined, ...verdictDetails(p)].filter((f): f is ActivityDetailField => f !== undefined);
      return { label: "Design flagged", details, designId: relatedId, designSummary: str(p, "summary"), severity };
    }
    case "design_amended": {
      const details = [
        pathsField("Added creates", arr(p, "addedCreates")),
        pathsField("Added touches", arr(p, "addedTouches")),
        pathsField("Added depends-on", arr(p, "addedDependsOn")),
        str(p, "newSummary") ? { label: "New summary", value: str(p, "newSummary")! } : undefined,
      ].filter((f): f is ActivityDetailField => f !== undefined);
      return { label: "Design amended", details, designId: relatedId };
    }
    case "design_resolved": {
      const resolution = str(p, "resolution");
      return { label: "Divergence resolved", details: resolution ? [{ label: "Resolution", value: resolution }] : [], designId: relatedId };
    }
    case "design_closed":
      return { label: "Design closed", details: [], designId: relatedId };
    case "design_expired":
      return { label: "Design expired", details: [], designId: relatedId };
    case "design_dormant":
      return { label: "Design went dormant", details: [], designId: relatedId };
    case "design_resumed":
      return { label: "Design resumed", details: [], designId: relatedId };
    case "design_stale_sibling_suggested":
      return { label: "Stale sibling design flagged", details: [], designId: relatedId };
    case "design_semantic_conflict": {
      const reason = str(p, "reason");
      const otherDesignId = str(p, "otherDesignId");
      const details = [
        reason ? { label: "Reason", value: reason } : undefined,
        otherDesignId ? { label: "Conflicting design", value: otherDesignId.slice(0, 8) } : undefined,
      ].filter((f): f is ActivityDetailField => f !== undefined);
      return { label: "Semantic conflict detected", details, designId: otherDesignId, threadId: relatedId };
    }
    case "review_created": {
      const justification = str(p, "justification");
      const constraintId = str(p, "constraintId");
      const overlapWaivers = arr(p, "overlapWaivers");
      const details = [
        justification ? { label: "Justification", value: justification } : undefined,
        constraintId ? { label: "Constraint waiver", value: constraintId.slice(0, 8) } : undefined,
        overlapWaivers && overlapWaivers.length > 0 ? { label: "Overlap waivers", value: String(overlapWaivers.length) } : undefined,
      ].filter((f): f is ActivityDetailField => f !== undefined);
      return { label: "Review requested", details, designId: str(p, "designId") };
    }
    case "review_decided": {
      const decision = str(p, "decision");
      return { label: "Review decided", details: decision ? [{ label: "Decision", value: decision }] : [], designId: str(p, "designId") };
    }
    case "constraint_ratified": {
      const details = [
        { label: "Statement", value: str(p, "statement") || "(no statement)" },
        str(p, "type") ? { label: "Type", value: str(p, "type")!.replace(/_/g, " ") } : undefined,
      ].filter((f): f is ActivityDetailField => f !== undefined);
      return { label: "Constraint ratified", details, constraintId: relatedId };
    }
    case "constraint_updated": {
      const details = [
        { label: "Statement", value: str(p, "statement") || "(no statement)" },
        str(p, "type") ? { label: "Type", value: str(p, "type")!.replace(/_/g, " ") } : undefined,
        str(p, "previousType") && str(p, "previousType") !== str(p, "type") ? { label: "Previous type", value: str(p, "previousType")!.replace(/_/g, " ") } : undefined,
      ].filter((f): f is ActivityDetailField => f !== undefined);
      return { label: "Constraint updated", details, constraintId: relatedId };
    }
    case "claim_recorded": {
      const details = [
        { label: "Symbol", value: str(p, "symbolId") || relatedId || "(unknown)" },
        str(p, "kind") ? { label: "Kind", value: str(p, "kind")! } : undefined,
        str(p, "stage") ? { label: "Stage", value: str(p, "stage")! } : undefined,
      ].filter((f): f is ActivityDetailField => f !== undefined);
      return { label: "Claim recorded", details };
    }
    case "call_edge_recorded": {
      const caller = str(p, "callerSymbolId");
      const callee = str(p, "calleeSymbolId");
      return { label: "Call edge recorded", details: caller && callee ? [{ label: "Edge", value: `${caller} -> ${callee}` }] : [] };
    }
    case "finding_raised": {
      const reason = str(p, "reason");
      const symbolId = str(p, "symbolId");
      const otherDeveloperId = str(p, "otherDeveloperId");
      const details = [
        reason ? { label: "Reason", value: reason } : undefined,
        symbolId ? { label: "Symbol", value: symbolId } : undefined,
        otherDeveloperId ? { label: "With", value: otherDeveloperId } : undefined,
      ].filter((f): f is ActivityDetailField => f !== undefined);
      return { label: "Divergence finding raised", details, threadId: relatedId };
    }
    case "alignment_thread_opened":
      return { label: "Alignment thread opened", details: [], threadId: relatedId };
    case "alignment_message_posted": {
      const message = str(p, "message");
      return { label: "Alignment message posted", details: message ? [{ label: "Message", value: message }] : [], threadId: relatedId };
    }
    case "alignment_thread_closed":
      return { label: "Alignment thread closed", details: [], threadId: relatedId };
    default:
      return { label: event.kind, details: p !== undefined ? [{ label: "Payload", value: JSON.stringify(p) }] : [] };
  }
}
