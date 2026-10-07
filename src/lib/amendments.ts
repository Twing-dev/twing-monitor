/**
 * A summary split into the design's own text and the amendments appended to
 * it (2026-10-06).
 *
 * `twing design amend` never rewrites a design's `summary`; the coordinator
 * appends each amendment to the end of it as one dated entry
 * (`appendSummaryUpdate`, server-side `design-checks.ts`):
 *
 * ```
 * `${existingSummary}\n\nUpdate (${YYYY-MM-DD}): ${update}`
 * ```
 *
 * That is the right thing to *store* -- it is the audit record, it keeps the
 * amend path synchronous and free of an LLM call, and every review comment
 * anchored in the summary is offset against it. It is the wrong thing to
 * *show* as-is: the overview renders each entry as a peer of the design's own
 * sentences, so a design amended five times reads as one statement of intent
 * and five changelog lines competing for the same attention. Found on a real
 * design whose summary was 3301 characters of which 326 were the original.
 *
 * So the reader gets the design's text as the overview and the amendments
 * folded beneath it. Nothing is hidden and nothing is rewritten -- the
 * grouping changes, the text does not.
 *
 * ## Why every offset here is load-bearing
 *
 * Review comments anchor to a quote plus its offset within the field's raw
 * text (`design-comment-anchor.ts`, server-side), and a field is already
 * rendered as *several* runs at different offsets -- see `Markdown`, which
 * renders every block through `HighlightableText` at the block's own source
 * offset, and `markdown.ts`'s header for the invariant that makes it safe.
 *
 * This module keeps the same promise, which is what lets the fold move runs
 * around the page without touching a single anchor:
 *
 * - **`base` is a literal prefix of the summary**, starting at offset 0, so
 *   every anchor already resolved against it is unmoved by construction.
 * - **`offset` on each amendment is its true index** in the summary, so
 *   `summary.slice(offset, offset + text.length) === text` holds. Its test
 *   asserts this over every fixture, because a drift of one character
 *   silently lands a comment on the wrong words while still looking right.
 *
 * Pure, and free of React, so the rules are testable without rendering.
 */

/** One appended amendment, in the order the coordinator wrote it. */
export interface Amendment {
  /** `YYYY-MM-DD`, exactly as the marker carried it. Deliberately not parsed
   * into a `Date`: the coordinator writes a bare day with no timezone, and
   * reading that as local time can move it across a boundary and show the
   * wrong one. The caller renders the string. */
  date: string;
  /** The amendment's own text, marker stripped -- always a verbatim slice of
   * the summary starting at `offset`. */
  text: string;
  /** Character index of `text` within the summary. */
  offset: number;
}

export interface SplitSummary {
  /** The design's own text: everything before the first amendment marker.
   * Always a prefix of the summary, so its offsets are already correct. */
  base: string;
  amendments: Amendment[];
}

/**
 * The marker `appendSummaryUpdate` writes, and nothing looser.
 *
 * Deliberately strict -- a blank line, the exact word, a full ISO day, the
 * colon and one space. The looser this gets, the more ordinary prose it
 * swallows: a paragraph that happens to begin "Update (see below):" would
 * start folding text the author meant as the design itself. The two failure
 * directions are not equal. A false negative leaves a line in the overview,
 * which is merely today's behaviour; a false positive hides a design's own
 * content behind a disclosure.
 */
const MARKER = /\n\nUpdate \((\d{4}-\d{2}-\d{2})\): /g;

/**
 * Splits `summary` into the design's own text and its appended amendments.
 *
 * Never throws, and never loses a character: `base` plus each marker and
 * amendment reproduces the input exactly. A summary with no amendments -- the
 * common case, and every design registered before any of this existed --
 * comes back as itself with an empty list, so callers need no special case.
 */
export function splitAmendments(summary: string | null | undefined): SplitSummary {
  const text = summary ?? "";
  if (text.length === 0) return { base: "", amendments: [] };

  // `matchAll` rather than a stateful `exec` loop: `MARKER` is a module-level
  // regex with `/g`, so a loop advancing `lastIndex` would carry state between
  // calls and make the second call on a given string behave differently from
  // the first. `matchAll` is required to be called with `/g` and does not
  // leak that state.
  const matches = [...text.matchAll(MARKER)];
  if (matches.length === 0) return { base: text, amendments: [] };

  const base = text.slice(0, matches[0].index);

  const amendments = matches.map((match, i) => {
    // This entry's own text starts past the whole marker...
    const start = match.index + match[0].length;
    // ...and ends where the next marker's leading blank line begins, or at the
    // end of the summary for the last one. An amendment whose own text runs to
    // several paragraphs therefore stays one amendment: only the marker splits.
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    return { date: match[1], text: text.slice(start, end), offset: start };
  });

  return { base, amendments };
}

/** How many amendments sit on `summary` -- the number the fold's disclosure
 * shows and the one the nudge threshold reads. Separate from
 * `splitAmendments` only so a caller that wants the count and not the text
 * reads as what it is. */
export function amendmentCount(summary: string | null | undefined): number {
  return splitAmendments(summary).amendments.length;
}
