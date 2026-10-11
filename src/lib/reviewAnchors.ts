/**
 * Finding a comment's highlighted words in a design as it reads *now*
 * (design review, 2026-09-27).
 *
 * A design is edited in place after comments are left on it: `amend` appends
 * to the summary and to the declared changes, and a plan-mode retry rewrites
 * both. So a comment stores the words it was about (`CommentAnchor.quote`),
 * not character offsets, and every render looks them up again:
 *
 *  - found -> highlight them;
 *  - found more than once -> the occurrence whose surroundings best match
 *    the stored `prefix`/`suffix`;
 *  - not found -> the comment is *outdated*: it is still shown, with the
 *    words it was about, but nothing in the design is highlighted for it.
 *
 * Whitespace is matched loosely (any run matches any run) because the
 * overview renders the summary as bullets, a browser normalizes line breaks
 * in a selection, and the server collapses whitespace when it checks the
 * quote. Nothing else is loosened: case and punctuation are what was said.
 *
 * Pure -- no DOM -- so the rules are testable on their own.
 */

import type { CommentAnchor, CommentAnchorField, DesignComment, DesignDocumentResponse, DesignDocumentSection, DesignStatement } from "../api/types.js";

export interface TextRange {
  start: number;
  end: number;
}

/** How much context to capture either side of a highlight. Matches the
 * server's `MAX_CONTEXT_CHARS`, which clips anything longer. */
export const CONTEXT_CHARS = 64;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Length of the common suffix of `a` and `b`. */
function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** Length of the common prefix of `a` and `b`. */
function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Where `quote` sits in `source`, or `null` when the source no longer says
 * it. See the file header for how repeats and whitespace are handled. */
export function locateQuote(source: string | undefined, quote: string, prefix?: string, suffix?: string): TextRange | null {
  if (!source) return null;
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const pattern = new RegExp(words.map(escapeRegExp).join("\\s+"), "g");

  const matches: TextRange[] = [];
  for (let m = pattern.exec(source); m; m = pattern.exec(source)) {
    matches.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) pattern.lastIndex++;
  }
  if (matches.length <= 1) return matches[0] ?? null;

  const wantBefore = collapse(prefix ?? "");
  const wantAfter = collapse(suffix ?? "");
  let best = matches[0];
  let bestScore = -1;
  for (const match of matches) {
    const before = collapse(source.slice(Math.max(0, match.start - CONTEXT_CHARS * 2), match.start));
    const after = collapse(source.slice(match.end, match.end + CONTEXT_CHARS * 2));
    const score = commonSuffix(before, wantBefore) + commonPrefix(after, wantAfter);
    if (score > bestScore) {
      best = match;
      bestScore = score;
    }
  }
  return best;
}

/** The text a field names on this design, as the dashboard renders it. A
 * change anchor is taken from its intent -- the one part of a change row
 * that is prose rather than a path. */
export function anchorSourceText(design: Pick<DesignStatement, "summary" | "rawPlanExcerpt" | "changes">, field: CommentAnchorField, changeId?: string): string | undefined {
  switch (field) {
    case "summary":
      return design.summary;
    case "plan":
      return design.rawPlanExcerpt;
    case "change":
      return design.changes?.find((c) => c.id === changeId)?.intent;
  }
}

/** Identifies one highlightable text: a field of a design, and for a change
 * which one. */
export function blockKey(designId: string, field: CommentAnchorField, changeId?: string, documentGroupId?: string): string {
  return `${field.startsWith("document:") ? documentGroupId ?? designId : designId}|${field}|${changeId ?? ""}`;
}

export interface LocatedComment {
  comment: DesignComment;
  /** Where its words are now, when it is anchored and they are still there. */
  range: TextRange | null;
  /** Anchored, but the words are gone -- show it with its quote, highlight
   * nothing. */
  outdated: boolean;
  /** The design has been edited since this comment was left, whether or not
   * its words survived. */
  designChanged: boolean;
}

export function locateComment(comment: DesignComment, design: DesignStatement | undefined, document?: DesignDocumentResponse): LocatedComment {
  const anchor = comment.anchor;
  if (anchor?.field.startsWith("document:")) {
    const matchesGroup = !!document?.content && document.groupId === anchor.documentGroupId;
    const source = matchesGroup ? document.content!.sections[anchor.field.slice("document:".length) as DesignDocumentSection] : undefined;
    const range = locateQuote(source, anchor.quote, anchor.prefix, anchor.suffix);
    return { comment, range, outdated: range === null,
      designChanged: matchesGroup && document.revision !== anchor.documentRevision };
  }
  const designChanged = !!design && typeof comment.designVersion === "number" && design.scopeVersion > comment.designVersion;
  if (!comment.anchor || !design) return { comment, range: null, outdated: false, designChanged };
  const originalAnchor: CommentAnchor = comment.anchor;
  const range = locateQuote(anchorSourceText(design, originalAnchor.field, originalAnchor.changeId), originalAnchor.quote, originalAnchor.prefix, originalAnchor.suffix);
  return { comment, range, outdated: range === null, designChanged };
}

/** One run of a rendered block: plain, or highlighted for these comments. */
export interface Segment {
  text: string;
  commentIds: string[];
}

/**
 * Cuts `text` -- which sits at `offset` inside its field's source -- into
 * plain and highlighted runs.
 *
 * The overview renders one field as several bullets, so a block is a window
 * onto the source rather than the whole of it; each range is intersected
 * with the window. Overlapping highlights are split at every boundary, and
 * each run carries every comment that covers it.
 */
export function segmentText(text: string, offset: number, ranges: { range: TextRange; commentId: string }[]): Segment[] {
  const local = ranges
    .map(({ range, commentId }) => ({ start: Math.max(0, range.start - offset), end: Math.min(text.length, range.end - offset), commentId }))
    .filter((r) => r.end > r.start);
  if (local.length === 0) return [{ text, commentIds: [] }];

  const cuts = new Set<number>([0, text.length]);
  for (const r of local) {
    cuts.add(r.start);
    cuts.add(r.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [from, to] = [points[i], points[i + 1]];
    if (to <= from) continue;
    const commentIds = local.filter((r) => r.start <= from && r.end >= to).map((r) => r.commentId);
    const previous = segments[segments.length - 1];
    if (previous && previous.commentIds.join() === commentIds.join()) previous.text += text.slice(from, to);
    else segments.push({ text: text.slice(from, to), commentIds });
  }
  return segments;
}

/**
 * Where each overview bullet sits in the summary it was cut from, so a
 * highlight located in the summary can be drawn on the right bullet.
 *
 * `toDesignPoints` only ever splits and trims, so every bullet is a verbatim
 * substring; searched from a running cursor so a repeated sentence maps to
 * its own occurrence. A bullet that somehow is not found gets -1, which
 * draws no highlights on it rather than wrong ones.
 */
export function bulletOffsets(summary: string, bullets: string[]): number[] {
  let cursor = 0;
  return bullets.map((bullet) => {
    const at = summary.indexOf(bullet, cursor);
    if (at < 0) return -1;
    cursor = at + bullet.length;
    return at;
  });
}
