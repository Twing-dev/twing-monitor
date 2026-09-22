/**
 * A short, single-line title for a design (`deriveTitle`), and its full
 * text broken into readable points instead of one wall of prose
 * (`toDesignPoints`) -- both derived from `summary`, never a
 * character-count truncation of it.
 *
 * A real summary routinely runs to hundreds of words: the initial
 * declaration plus every amendment's own text, all appended onto the same
 * field (only `summary` propagates across amendments -- see
 * `DesignStatement.groupId`'s doc comment, @twing/core). In practice each
 * amendment's text arrives on its own line, separated by a blank line from
 * whatever came before it -- e.g. a real design's:
 *
 *   Fix the nine defects found reviewing the Codex harness work -- trust
 *   stamping that silently never happens or overrides the user, ...
 *
 *   Update (2026-09-21): hook-version-stamp modify packages/cli/src/
 *   install-hook.ts -- Record which CLI installed the hook binary, ...
 *
 * Splitting on that blank line recovers the real structure the text
 * already has; splitting blindly at N characters (a CSS ellipsis, or a
 * single run-on paragraph) does not.
 */

import { toBullets } from "./summaryBullets.js";

/** Hard ceiling for the rare case even the extracted headline is still
 * long (a one-sentence summary with no newline, dash, or period break at
 * all) -- a safety net, not the primary mechanism. */
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

/** The first paragraph -- everything before the first blank line, or the
 * whole thing if there isn't one. Shared by both functions below: neither
 * a title nor a list of points should ever pull amendment text ahead of
 * finding a clean break in the part that's actually there. */
function firstParagraph(text: string): string {
  return text.split(/\n\s*\n/)[0].trim();
}

export function deriveTitle(summary: string): string {
  const text = summary.trim();
  if (!text) return text;
  const head = firstParagraph(text);

  // The " -- " separator is this codebase's own convention for "headline
  // -- elaboration" (see this file's own doc comment) -- the segment
  // before the first one is reliably the actual headline.
  const dashIndex = head.indexOf(" -- ");
  if (dashIndex !== -1) return hardClamp(head.slice(0, dashIndex).trim());

  // No dash -- fall back to the first sentence, when the paragraph
  // actually splits into more than one (toBullets returns [] for a single
  // sentence, which is exactly the case where "first sentence" and "whole
  // paragraph" are the same string anyway).
  const bullets = toBullets(head);
  if (bullets.length > 0) return hardClamp(bullets[0]);

  return hardClamp(head);
}

/** The summary's full text, as a list of points instead of one paragraph
 * -- the "Overview" tab's own rendering, so the whole thing stays readable
 * rather than raw. Returns `[]` (same convention `toBullets` uses) when
 * the text is short enough that a list would just repeat it back as a
 * single item; the caller falls back to plain prose in that case. */
export function toDesignPoints(summary: string): string[] {
  const text = summary.trim();
  if (!text) return [];

  // Each amendment's own paragraph, split at the blank line between them.
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Within a paragraph that's still one long run-on clause, break it
  // further -- sentence boundaries first, then this codebase's own
  // "headline -- elaboration" dash convention.
  const points = paragraphs.flatMap((paragraph) => {
    const sentences = toBullets(paragraph);
    if (sentences.length > 0) return sentences;
    const dashed = paragraph
      .split(" -- ")
      .map((s) => s.trim())
      .filter(Boolean);
    return dashed.length > 1 ? dashed : [paragraph];
  });

  return points.length > 1 ? points : [];
}
