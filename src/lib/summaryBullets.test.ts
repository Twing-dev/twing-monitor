import { describe, it, expect } from "vitest";
import { toBullets } from "./summaryBullets.js";

describe("toBullets", () => {
  it("splits a multi-sentence summary into one bullet per sentence", () => {
    const out = toBullets(
      "Adds a RetryPolicy class with exponential backoff. Wires it into the HTTP client so every outbound call retries. Leaves the webhook path alone for now.",
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("Adds a RetryPolicy class with exponential backoff.");
    expect(out[2]).toBe("Leaves the webhook path alone for now.");
  });

  // Below are the things these summaries are actually full of. A wrong
  // split would silently misrepresent someone's plan on a screen used to
  // approve work, so each one is worth pinning.
  it("does not split inside a file path", () => {
    expect(
      toBullets("Extracts the walk out of packages/cli/src/diff-claims.ts into a shared packages/core/src/diff-files.ts helper."),
    ).toEqual([]);
  });

  it("does not split on an abbreviation followed by a lowercase word", () => {
    expect(toBullets("Covers the retry paths, e.g. the webhook client and the billing poller, without touching auth.")).toEqual([]);
  });

  it("does not split inside a version number", () => {
    expect(toBullets("Requires better-sqlite3 0.2.5 or later because of the prebuilt binary change on Node 26.")).toEqual([]);
  });

  it("does not treat a colon as a sentence end", () => {
    expect(toBullets("Build twing review (design doc §15 step 6): deterministic AST test-delta integrity over the merge-base diff.")).toEqual([]);
  });

  it("returns nothing for a single sentence, so short summaries stay prose", () => {
    expect(toBullets("add keyboard shortcuts to the command palette")).toEqual([]);
    expect(toBullets("Cache invoice PDFs on disk to cut S3 egress.")).toEqual([]);
  });

  it("returns nothing for empty or whitespace-only input", () => {
    expect(toBullets("")).toEqual([]);
    expect(toBullets("   \n  ")).toEqual([]);
  });

  it("splits on ? and ! as well as .", () => {
    expect(
      toBullets("Should the cache be per-request or global? The current plan assumes per-request for now."),
    ).toHaveLength(2);
  });

  it("bails out rather than emitting a suspiciously tiny fragment", () => {
    // "No." is a real sentence by the regex, and a bad bullet by any human
    // standard -- the whole thing falls back to prose.
    expect(toBullets("Does this need a migration? No. The enrichment is assembled per request from existing rows.")).toEqual([]);
  });

  it("handles the real 700-character summary this was built for", () => {
    const real =
      "Build twing review (P1 / design doc §15 step 6): deterministic AST test-delta integrity over the merge-base diff. " +
      "Detects test cases deleted, skip/only introduced, assertion counts dropped, assertions weakened down a matcher-strength ladder, and mocks newly introduced. " +
      "Extracts the merge-base git-diff walk out of packages/cli/src/diff-claims.ts into a shared packages/core/src/diff-files.ts. " +
      "No network, no auth, no daemon, no server or hook changes.";
    const out = toBullets(real);
    expect(out).toHaveLength(4);
    // The file paths in bullet 3 must have survived intact.
    expect(out[2]).toContain("diff-claims.ts into a shared");
  });
});
