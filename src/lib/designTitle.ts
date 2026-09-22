/**
 * A short, single-line title for a design, derived from its `summary` --
 * not a character-count truncation of it. A real summary routinely runs to
 * several hundred words: the initial declaration plus every amendment's
 * own "Update (date): ... -- ..." text, all concatenated onto the same
 * field (only `summary` propagates across amendments -- see
 * `DesignStatement.groupId`'s doc comment, @twing/core). Cutting that
 * blindly at N characters (the CSS ellipsis this replaces) lands mid-word
 * in whatever amendment happened to be there, not at anything resembling
 * a title. This instead finds the actual headline the summary already
 * has and cuts there -- the full, untruncated text still shows in full
 * under the Overview tab; this is only ever the row/header label.
 */

import { toBullets } from "./summaryBullets.js";

/** Hard ceiling for the rare case even the extracted headline is still
 * long (a one-sentence summary with no natural break at all) -- a safety
 * net, not the primary mechanism. */
const MAX_TITLE_CHARS = 120;

function hardClamp(text: string): string {
  if (text.length <= MAX_TITLE_CHARS) return text;
  const cut = text.slice(0, MAX_TITLE_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  // Only break on a word boundary if there's a reasonable amount of text
  // left after doing so -- otherwise a single very-long leading word would
  // clip down to almost nothing.
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function deriveTitle(summary: string): string {
  const text = summary.trim();
  if (!text) return text;

  // The " -- " separator is this codebase's own convention for "headline
  // -- elaboration" (see this file's own doc comments, or a real design's
  // "Fix the nine defects ... -- trust stamping that silently never
  // happens ..."), and it's what amendment text is appended after -- the
  // segment before the first one is reliably the actual headline.
  const dashIndex = text.indexOf(" -- ");
  if (dashIndex !== -1) return hardClamp(text.slice(0, dashIndex).trim());

  // No dash -- fall back to the first sentence, when the summary actually
  // splits into more than one (toBullets returns [] for a single sentence,
  // which is exactly the case where "first sentence" and "whole thing" are
  // the same string anyway).
  const bullets = toBullets(text);
  if (bullets.length > 0) return hardClamp(bullets[0]);

  return hardClamp(text);
}
