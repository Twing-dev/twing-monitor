/**
 * Block-level markdown, parsed into runs that keep their exact position in
 * the source (2026-10-02).
 *
 * A design's overview used to be rendered by splitting it on sentence
 * boundaries (`designTitle.ts`'s `toDesignPoints`) -- a workaround for
 * LLM-extracted prose arriving as one unreadable wall. That is the wrong
 * default once a *human* authors the text: breaking an author's sentences
 * into bullets overrides the structure they chose. So an edited overview is
 * markdown, and the author decides what is a heading, a paragraph or a list.
 *
 * ## Why `offset` is the whole point
 *
 * Review comments anchor to a quote plus its offset inside the field's raw
 * text (`design-comment-anchor.ts`, server-side), and `DesignReview.tsx`'s
 * `HighlightableText` already renders one field as *several* runs at
 * different offsets -- which is exactly how the old bullets worked. Each
 * block here becomes one such run, so anchoring keeps working with no change
 * to the review machinery at all.
 *
 * That makes one invariant load-bearing: **`source.slice(block.offset,
 * block.offset + block.text.length) === block.text`** for every block. Its
 * own test asserts it over every fixture, because a drift of even one
 * character silently anchors every comment in that block to the wrong words
 * -- the text still renders correctly, so nothing looks wrong.
 *
 * ## Why inline formatting is deliberately absent
 *
 * `**bold**` rendered as "bold" would break that invariant: a reviewer
 * selecting across it produces a quote that does not occur in the source, and
 * the server refuses the comment. Block markers (`## `, `- `, `> `) sit at
 * line starts, so stripping them leaves the remaining text a verbatim slice.
 * Inline markers sit mid-sentence and cannot be stripped without rewriting
 * offsets *within* a run, which `segmentText` has no notion of. Emphasis is
 * therefore out until that mapping is built properly, rather than shipped in
 * a form that quietly loses comments.
 *
 * Pure, and free of React, so the rules are testable without rendering.
 */

export type MarkdownBlockKind = "paragraph" | "heading" | "listItem" | "orderedItem" | "quote" | "code";

export interface MarkdownBlock {
  kind: MarkdownBlockKind;
  /** The block's own text, markers stripped -- always a verbatim slice of the
   * source starting at `offset`. */
  text: string;
  /** Character index of `text` within the source string. */
  offset: number;
  /** Heading level 1-6; only set for `kind: "heading"`. */
  level?: number;
  /** The fence's info string (e.g. `ts`), when a code block carried one.
   * Kept rather than dropped so the parse stays lossless. */
  language?: string;
}

/** `#` through `######`, ATX style only. Setext underlining (`===`) is not
 * supported: it would put a block's marker on a different line from its text,
 * and nobody writes it in a design overview. */
const HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED = /^\s*([-*+])\s+(.*)$/;
const ORDERED = /^\s*(\d+[.)])\s+(.*)$/;
const QUOTE = /^\s*(>)\s?(.*)$/;
const FENCE = /^\s*```(\S*)\s*$/;

/**
 * Parses `source` into block-level markdown.
 *
 * Consecutive plain lines join into one paragraph, separated by blank lines,
 * the way markdown does -- *except* that a joined paragraph's `text` is one
 * slice of the source rather than lines re-joined with spaces, so the
 * invariant above holds and its internal newlines survive for CSS to wrap.
 *
 * Never throws, and never returns nothing for non-empty input: anything
 * unrecognised stays a paragraph. A renderer must always have something to
 * show, since this is the only place a design's own words appear.
 */
export function parseMarkdownBlocks(source: string | null | undefined): MarkdownBlock[] {
  const text = source ?? "";
  if (text.trim().length === 0) return [];

  const blocks: MarkdownBlock[] = [];
  const lines = text.split("\n");

  // Running index of the start of `lines[i]` within `text`. Tracked rather
  // than searched for: `indexOf` would find the *first* identical line, which
  // a repeated line (common in a list) makes wrong.
  let lineStart = 0;
  // The paragraph being accumulated, as source bounds rather than joined
  // text, so it can be sliced out verbatim when it closes.
  let paragraph: { start: number; end: number } | undefined;

  const flushParagraph = () => {
    if (!paragraph) return;
    blocks.push({ kind: "paragraph", text: text.slice(paragraph.start, paragraph.end), offset: paragraph.start });
    paragraph = undefined;
  };

  /** Offset of `body` within the current line, given the marker that precedes
   * it. Resolved by searching *after* the marker rather than from the line
   * start, so a body that repeats the marker character ("- -- dashes") still
   * lands on the body. An empty body has no position of its own; the line's
   * end is used, which renders as an empty run nothing can be selected in. */
  const bodyOffset = (line: string, marker: string, body: string): number => {
    if (body.length === 0) return lineStart + line.length;
    const afterMarker = line.indexOf(marker) + marker.length;
    return lineStart + line.indexOf(body, afterMarker);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLineStart = lineStart + line.length + 1; // +1 for the "\n" that `split` removed

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      // Scan to the closing fence, or to the end if the author never closed
      // one -- an unterminated fence renders as code rather than swallowing
      // the rest of the overview into nothing.
      const bodyStart = nextLineStart;
      let j = i + 1;
      let bodyEnd = bodyStart;
      while (j < lines.length && !FENCE.test(lines[j])) {
        bodyEnd += lines[j].length + 1;
        j++;
      }
      // Drop the trailing newline the loop counted, so the slice ends at the
      // last code character.
      const end = Math.max(bodyStart, bodyEnd - 1);
      blocks.push({ kind: "code", text: text.slice(bodyStart, end), offset: bodyStart, ...(fence[1] ? { language: fence[1] } : {}) });
      // Advance over the opening fence, the body, and the closing fence if
      // there was one.
      for (let k = i; k < j + 1 && k < lines.length; k++) lineStart += lines[k].length + 1;
      i = j;
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      lineStart = nextLineStart;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2], offset: bodyOffset(line, heading[1], heading[2]) });
      lineStart = nextLineStart;
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flushParagraph();
      blocks.push({ kind: "quote", text: quote[2], offset: bodyOffset(line, quote[1], quote[2]) });
      lineStart = nextLineStart;
      continue;
    }

    const unordered = UNORDERED.exec(line);
    if (unordered) {
      flushParagraph();
      blocks.push({ kind: "listItem", text: unordered[2], offset: bodyOffset(line, unordered[1], unordered[2]) });
      lineStart = nextLineStart;
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered) {
      flushParagraph();
      blocks.push({ kind: "orderedItem", text: ordered[2], offset: bodyOffset(line, ordered[1], ordered[2]) });
      lineStart = nextLineStart;
      continue;
    }

    // A plain line: open a paragraph, or extend the open one. `end` tracks the
    // line's last character and never the newline after it, so a closed
    // paragraph carries no trailing whitespace to make its quote unmatchable.
    if (paragraph) paragraph.end = lineStart + line.length;
    else paragraph = { start: lineStart, end: lineStart + line.length };
    lineStart = nextLineStart;
  }

  flushParagraph();
  return blocks;
}

/** Whether `source` carries markdown structure somebody deliberately wrote.
 *
 * This chooses between the two overview renderings, so it has to be
 * conservative in one specific direction: **several paragraphs is not
 * structure.** That is exactly the shape every amended LLM summary already
 * has -- `appendSummaryUpdate` (server-side) adds each amendment as its own
 * `Update (date): ...` paragraph -- and treating it as authored markdown
 * would quietly switch the whole existing corpus onto the markdown path and
 * lose the sentence-bulleting that makes machine prose readable.
 *
 * So this requires a real block *marker*: a heading, a list item, a
 * blockquote or a code fence. Those only appear because a person typed them.
 * Prose, however many paragraphs of it, keeps the bullet treatment that was
 * built for it. */
export function hasMarkdownStructure(source: string | null | undefined): boolean {
  return parseMarkdownBlocks(source).some((block) => block.kind !== "paragraph");
}
