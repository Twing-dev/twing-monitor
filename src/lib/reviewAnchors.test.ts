import { describe, expect, it } from "vitest";
import type { DesignComment, DesignDocumentResponse, DesignStatement } from "../api/types.js";
import { bulletOffsets, locateComment, locateQuote, segmentText } from "./reviewAnchors.js";

const design = {
  id: "d1",
  summary: "Add a retry budget to the HTTP client.\n\nUpdate (2026-09-27): Cap the retry budget per host.",
  rawPlanExcerpt: "## Plan\n1. Add RetryBudget",
  changes: [{ id: "c1", action: "modify", target: "src/net/retry.ts", intent: "cap exponential growth at 30s" }],
  scopeVersion: 3,
} as unknown as DesignStatement;

function comment(overrides: Partial<DesignComment> = {}): DesignComment {
  return {
    id: "cm1",
    projectId: "p1",
    designId: "d1",
    authorId: "reviewer@example.com",
    body: "why?",
    designVersion: 3,
    status: "open",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("locateQuote", () => {
  it("finds a quote, matching whitespace loosely", () => {
    const range = locateQuote(design.summary, "HTTP client. Update (2026-09-27):");
    expect(range).not.toBeNull();
    expect(design.summary.slice(range!.start, range!.end)).toBe("HTTP client.\n\nUpdate (2026-09-27):");
  });

  it("treats regex characters in the quote literally", () => {
    expect(locateQuote("a (b) c.*", "(b) c.*")).toEqual({ start: 2, end: 9 });
  });

  it("is case-sensitive -- case is part of what was said", () => {
    expect(locateQuote(design.summary, "add a retry budget")).toBeNull();
  });

  it("picks between repeats by the surrounding words", () => {
    const first = locateQuote(design.summary, "retry budget", "Add a ", " to the HTTP");
    const second = locateQuote(design.summary, "retry budget", "Cap the ", " per host");
    expect(first!.start).toBeLessThan(second!.start);
    expect(design.summary.slice(second!.start - 8, second!.start)).toBe("Cap the ");
  });

  it("is null when the words are gone, or there is nothing to search", () => {
    expect(locateQuote(design.summary, "gRPC")).toBeNull();
    expect(locateQuote(undefined, "anything")).toBeNull();
    expect(locateQuote("text", "   ")).toBeNull();
  });
});

describe("locateComment", () => {
  it("locates shared-document quotes from another member and tracks regeneration", () => {
    const document: DesignDocumentResponse = { groupId: "shared", revision: 2, status: "ready", stale: false,
      content: { schemaVersion: 1, title: "Shared budget", sections: { problemStatement: "A shared budget avoids starvation." } } };
    const shared = comment({ anchor: { field: "document:problemStatement", documentGroupId: "shared", documentRevision: 1, quote: "shared budget" } });
    expect(locateComment(shared, undefined, document)).toMatchObject({ outdated: false, designChanged: true });
    expect(locateComment(shared, design, { ...document, content: { ...document.content!, sections: { problemStatement: "Use separate budgets." } } }))
      .toMatchObject({ outdated: true, range: null, designChanged: true });
    expect(locateComment(shared, design, { ...document, groupId: "other" })).toMatchObject({ outdated: true, range: null });
  });
  it("locates an anchored comment in its field", () => {
    const located = locateComment(comment({ anchor: { field: "change", changeId: "c1", quote: "exponential growth" } }), design);
    expect(located.outdated).toBe(false);
    expect(located.range).not.toBeNull();
  });

  it("is outdated -- not hidden -- when the words or the change are gone", () => {
    expect(locateComment(comment({ anchor: { field: "summary", quote: "gRPC client" } }), design).outdated).toBe(true);
    expect(locateComment(comment({ anchor: { field: "change", changeId: "dropped", quote: "exponential growth" } }), design).outdated).toBe(true);
  });

  it("a comment on the whole design is never outdated", () => {
    expect(locateComment(comment(), design)).toMatchObject({ outdated: false, range: null });
  });

  it("says when the design was edited after the comment, whether or not the words survived", () => {
    expect(locateComment(comment({ designVersion: 2, anchor: { field: "summary", quote: "retry budget" } }), design)).toMatchObject({ designChanged: true, outdated: false });
    expect(locateComment(comment({ designVersion: 3 }), design).designChanged).toBe(false);
  });
});

describe("segmentText", () => {
  it("returns the text whole when nothing is highlighted", () => {
    expect(segmentText("hello world", 0, [])).toEqual([{ text: "hello world", commentIds: [] }]);
  });

  it("splits overlapping highlights at every boundary, carrying every comment that covers a run", () => {
    const segments = segmentText("abcdefgh", 0, [
      { range: { start: 1, end: 5 }, commentId: "x" },
      { range: { start: 3, end: 7 }, commentId: "y" },
    ]);
    expect(segments).toEqual([
      { text: "a", commentIds: [] },
      { text: "bc", commentIds: ["x"] },
      { text: "de", commentIds: ["x", "y"] },
      { text: "fg", commentIds: ["y"] },
      { text: "h", commentIds: [] },
    ]);
  });

  it("clips a range to the window a bullet occupies in its field", () => {
    // The bullet "cdef" sits at offset 2 of its source; the range covers 0..4.
    expect(segmentText("cdef", 2, [{ range: { start: 0, end: 4 }, commentId: "x" }])).toEqual([
      { text: "cd", commentIds: ["x"] },
      { text: "ef", commentIds: [] },
    ]);
  });
});

describe("bulletOffsets", () => {
  it("maps each bullet to its own occurrence, repeats included", () => {
    const summary = "Do it. Then check. Do it.";
    expect(bulletOffsets(summary, ["Do it.", "Then check.", "Do it."])).toEqual([0, 7, 19]);
  });

  it("gives -1 for a bullet it cannot place, rather than a wrong offset", () => {
    expect(bulletOffsets("abc", ["zzz"])).toEqual([-1]);
  });
});
