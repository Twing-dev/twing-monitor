import { describe, expect, test } from "vitest";
import { buildShareUrl, parseUrlState } from "./urlState.js";

/**
 * `buildShareUrl`'s shape is a cross-repository contract as of 2026-09.
 *
 * twing-cli mints a design's review link for commit-message trailers
 * (`buildDesignReviewUrl`, `packages/core/src/types.ts`) and has to produce
 * exactly what this router parses. The two repositories share no code, so
 * nothing but a test on each side keeps them in step -- twing-cli's
 * `design-review.test.ts` is the other half. If you change the query
 * parameter names here, every `Twing-Design:` trailer already written into
 * somebody's git history stops resolving.
 */
describe("buildShareUrl / parseUrlState round trip", () => {
  test("a design link has the shape twing-cli mints for commit trailers", () => {
    const url = buildShareUrl("proj123", "designs", "design456");
    // Origin varies with the deployment; the query is the contract.
    expect(url).toContain("?repos=proj123&tab=designs&focus=design456");
  });

  test("parseUrlState reads back what buildShareUrl wrote", () => {
    const url = buildShareUrl("proj123", "designs", "design456");
    const state = parseUrlState(url.slice(url.indexOf("?")));
    expect(state).toEqual({ repoIds: ["proj123"], tab: "designs", focusId: "design456" });
  });

  test("a share link is always scoped to one repo, whatever the sharer had selected", () => {
    const state = parseUrlState(buildShareUrl("only-this-one", "designs", "d1").slice(buildShareUrl("only-this-one", "designs", "d1").indexOf("?")));
    expect(state.repoIds).toEqual(["only-this-one"]);
  });

  test("ids needing encoding survive the round trip", () => {
    const url = buildShareUrl("a b&c", "designs", "d=e");
    const state = parseUrlState(url.slice(url.indexOf("?")));
    expect(state.repoIds).toEqual(["a b&c"]);
    expect(state.focusId).toEqual("d=e");
  });
});

describe("parseUrlState", () => {
  test("no repos means the list view, and the tab is ignored", () => {
    expect(parseUrlState("?tab=designs&focus=d1").repoIds).toEqual([]);
  });

  test("several repos parse as an aggregate selection", () => {
    expect(parseUrlState("?repos=a,b,c&tab=designs").repoIds).toEqual(["a", "b", "c"]);
  });

  test("an unknown tab falls back to overview rather than throwing", () => {
    expect(parseUrlState("?repos=a&tab=nonsense").tab).toBe("overview");
  });

  // A link pasted from before the 2026-09 Reviews/Alignment-threads merge
  // still resolves: `focusId` is a review or thread id either way, and
  // ConflictsView tries both lookups.
  test("pre-merge reviews/threads tabs map to conflicts, not silently to overview", () => {
    expect(parseUrlState("?repos=a&tab=reviews").tab).toBe("conflicts");
    expect(parseUrlState("?repos=a&tab=threads").tab).toBe("conflicts");
  });

  test("a missing focus is undefined rather than an empty string", () => {
    expect(parseUrlState("?repos=a&tab=designs").focusId).toBeUndefined();
  });
});
