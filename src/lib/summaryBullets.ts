/**
 * Splits a design summary into sentences, for rendering as bullets instead
 * of one long paragraph (2026-08-25).
 *
 * A design's `summary` is whatever plan extraction produced. For a real
 * plan that's routinely 700+ characters of dense prose describing four or
 * five separate things, and as a single block it's unreadable -- you can't
 * tell where one claim ends and the next begins. Sentences are exactly
 * those boundaries, so splitting on them recovers the structure the text
 * already has rather than inventing one.
 *
 * Deliberately conservative: a split needs terminal punctuation, then
 * whitespace, then something that actually looks like the start of a new
 * sentence. That's what keeps the things these summaries are full of
 * intact --
 *
 *   packages/cli/src/diff-claims.ts into    no space after the dot
 *   e.g. the retry path                     lowercase follows
 *   version 0.2.5 onwards                   no space after the dot
 *   §15 step 6): deterministic ...          colon, not a full stop
 *
 * A wrong split here is worse than no split at all: it would silently
 * misrepresent someone's plan on a screen people use to approve work. When
 * in doubt it leaves the text alone.
 */

/** Terminal punctuation, whitespace, then an opening character that starts
 * a real sentence -- a capital, a backticked identifier, or a bracket. */
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z`("[])/;

/** Below this, a "paragraph" is just a sentence and bullets add noise. */
const MIN_BULLETS = 2;

/** Guards against a pathological split producing dozens of fragments -- if
 * that happens the heuristic has clearly misfired, so fall back to prose. */
const MAX_BULLETS = 12;

/**
 * Returns the summary as bullet points, or an empty array when it shouldn't
 * be bulleted at all -- a single sentence, or a split that looks wrong.
 * Callers render prose when this is empty.
 */
export function toBullets(summary: string): string[] {
  const text = summary.trim();
  if (!text) return [];

  const parts = text
    .split(SENTENCE_BOUNDARY)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length < MIN_BULLETS || parts.length > MAX_BULLETS) return [];

  // A fragment this short is almost always a bad split (a stray initial, an
  // abbreviation the lookahead didn't catch) rather than a real sentence.
  if (parts.some((p) => p.length < 12)) return [];

  return parts;
}
