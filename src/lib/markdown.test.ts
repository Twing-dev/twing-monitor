import { describe, it, expect } from "vitest";
import { parseMarkdownBlocks, hasMarkdownStructure, type MarkdownBlock } from "./markdown.js";

/** Every fixture in this file runs through the offset invariant below, so
 * they live in one place rather than inline per test. */
const FIXTURES: Record<string, string> = {
  plainParagraph: "Reworks the sync client so a dropped connection resumes.",
  twoParagraphs: "First paragraph, one sentence.\n\nSecond paragraph, also one.",
  wrappedParagraph: "A paragraph the author hard-wrapped\nacross two source lines.",
  headingAndList: "## Approach\n\n- Resume from the last acknowledged offset\n- Keep the retry budget unchanged",
  orderedList: "1. Add the resume token\n2. Thread it through the client\n3) Mixed delimiter still parses",
  quote: "> Decided on review: drop the jitter experiment.",
  code: "Before:\n\n```ts\nconst retries = 3;\nconst backoff = 2;\n```\n\nAfter the change.",
  unterminatedFence: "Here is some code:\n\n```\nnever closed",
  repeatedLines: "- same line\n- same line\n- same line",
  markerInBody: "- -- leading dashes in the body\n- > not a quote here",
  headingLevels: "# One\n## Two\n###### Six",
  emptyListItem: "- \n- real item",
  mixedEverything: "# Title\n\nIntro paragraph here.\n\n## Detail\n\n- point one\n- point two\n\n> a note\n\nClosing paragraph.",
};

describe("parseMarkdownBlocks", () => {
  // THE load-bearing property. Comment anchors are (quote, offset) into the
  // raw summary; if a block's reported offset does not point at its own text,
  // every comment in that block resolves against the wrong words while the
  // page still renders perfectly. Nothing else in this file matters as much.
  it("reports an offset that points at the block's own text, for every fixture", () => {
    for (const [name, source] of Object.entries(FIXTURES)) {
      for (const block of parseMarkdownBlocks(source)) {
        const slice = source.slice(block.offset, block.offset + block.text.length);
        expect(slice, `${name}: ${block.kind} block at ${block.offset}`).toBe(block.text);
      }
    }
  });

  it("treats a lone paragraph as one block", () => {
    const blocks = parseMarkdownBlocks(FIXTURES.plainParagraph);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("paragraph");
    expect(blocks[0].text).toBe(FIXTURES.plainParagraph);
    expect(blocks[0].offset).toBe(0);
  });

  it("splits paragraphs on a blank line", () => {
    const blocks = parseMarkdownBlocks(FIXTURES.twoParagraphs);
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph"]);
    expect(blocks[1].text).toBe("Second paragraph, also one.");
  });

  it("keeps a hard-wrapped paragraph as one block, newline and all", () => {
    const blocks = parseMarkdownBlocks(FIXTURES.wrappedParagraph);
    expect(blocks).toHaveLength(1);
    // Sliced verbatim rather than re-joined with a space: re-joining would
    // break the offset invariant for everything after the newline.
    expect(blocks[0].text).toContain("\n");
  });

  it("parses headings with their level, marker stripped", () => {
    const blocks = parseMarkdownBlocks(FIXTURES.headingLevels);
    expect(blocks.map((b) => [b.kind, b.level, b.text])).toEqual([
      ["heading", 1, "One"],
      ["heading", 2, "Two"],
      ["heading", 6, "Six"],
    ]);
  });

  it("parses unordered and ordered list items", () => {
    expect(parseMarkdownBlocks(FIXTURES.headingAndList).map((b) => b.kind)).toEqual(["heading", "listItem", "listItem"]);
    const ordered = parseMarkdownBlocks(FIXTURES.orderedList);
    expect(ordered.map((b) => b.kind)).toEqual(["orderedItem", "orderedItem", "orderedItem"]);
    expect(ordered[0].text).toBe("Add the resume token");
    expect(ordered[2].text).toBe("Mixed delimiter still parses");
  });

  it("parses a blockquote", () => {
    const blocks = parseMarkdownBlocks(FIXTURES.quote);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("quote");
    expect(blocks[0].text).toBe("Decided on review: drop the jitter experiment.");
  });

  it("parses a fenced code block, keeping its language and dropping the fences", () => {
    const blocks = parseMarkdownBlocks(FIXTURES.code);
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "code", "paragraph"]);
    const code = blocks[1];
    expect(code.language).toBe("ts");
    expect(code.text).toBe("const retries = 3;\nconst backoff = 2;");
    expect(blocks[2].text).toBe("After the change.");
  });

  it("renders an unterminated fence as code instead of swallowing the rest", () => {
    const blocks = parseMarkdownBlocks(FIXTURES.unterminatedFence);
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "code"]);
    expect(blocks[1].text).toBe("never closed");
  });

  // The bug a naive `source.indexOf(line)` would introduce: three identical
  // list items would all report the first one's offset, so a comment on the
  // third would highlight the first.
  it("gives repeated identical lines distinct, increasing offsets", () => {
    const blocks = parseMarkdownBlocks(FIXTURES.repeatedLines);
    expect(blocks).toHaveLength(3);
    const offsets = blocks.map((b) => b.offset);
    expect(offsets[0]).toBeLessThan(offsets[1]);
    expect(offsets[1]).toBeLessThan(offsets[2]);
  });

  it("locates a body that repeats its own marker character", () => {
    const blocks = parseMarkdownBlocks(FIXTURES.markerInBody);
    expect(blocks.map((b) => b.text)).toEqual(["-- leading dashes in the body", "> not a quote here"]);
  });

  it("survives an empty list item", () => {
    const blocks = parseMarkdownBlocks(FIXTURES.emptyListItem);
    expect(blocks.map((b) => b.text)).toEqual(["", "real item"]);
  });

  it("handles a document mixing every block kind", () => {
    expect(parseMarkdownBlocks(FIXTURES.mixedEverything).map((b) => b.kind)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "listItem",
      "listItem",
      "quote",
      "paragraph",
    ]);
  });

  it("returns nothing for empty or whitespace-only input", () => {
    for (const input of ["", "   ", "\n\n", null, undefined]) {
      expect(parseMarkdownBlocks(input as string)).toEqual([] as MarkdownBlock[]);
    }
  });
});

describe("hasMarkdownStructure", () => {
  // What decides whether an overview renders as the author's markdown or
  // falls back to sentence bullets. Plain prose must take the bullet path --
  // that is what machine-written summaries need.
  it("is false for plain prose, however long", () => {
    expect(hasMarkdownStructure(FIXTURES.plainParagraph)).toBe(false);
    expect(hasMarkdownStructure("One sentence. Two sentences. Three, even.")).toBe(false);
  });

  it("is false for empty input", () => {
    expect(hasMarkdownStructure("")).toBe(false);
    expect(hasMarkdownStructure(undefined)).toBe(false);
  });

  it("is true once there is a heading, a list, a quote or code", () => {
    expect(hasMarkdownStructure(FIXTURES.headingAndList)).toBe(true);
    expect(hasMarkdownStructure(FIXTURES.orderedList)).toBe(true);
    expect(hasMarkdownStructure(FIXTURES.quote)).toBe(true);
    expect(hasMarkdownStructure(FIXTURES.code)).toBe(true);
  });

  // Load-bearing negative. `appendSummaryUpdate` (server-side) adds every
  // amendment as its own `Update (date): ...` paragraph, so "more than one
  // paragraph" describes most of the existing corpus. Counting that as
  // authored markdown would switch all of it onto the markdown path and lose
  // the sentence-bulleting machine prose needs -- caught by WorkView's own
  // "first point in the title" test when this returned true.
  it("is false for several paragraphs -- that is what an appended amendment looks like", () => {
    expect(hasMarkdownStructure(FIXTURES.twoParagraphs)).toBe(false);
    expect(hasMarkdownStructure("A design summary.\n\nUpdate (2026-09-29): also bump the packages.")).toBe(false);
  });
});
