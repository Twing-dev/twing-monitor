import { describe, it, expect } from "vitest";
import { deriveTitle, toDesignPoints } from "./designTitle.js";

// The real shape a design's summary takes once it's been amended a few
// times: an initial "headline -- elaboration" paragraph, then one blank-
// line-separated paragraph per amendment (a real example, trimmed).
const AMENDED_SUMMARY =
  "Fix the nine defects found reviewing the Codex harness work -- trust stamping that silently never happens or overrides the user, a patch decode that can deny every edit, a resolver that cannot find the repo for a Codex patch, and capture that misattributes a moved session\n\n" +
  "Update (2026-09-21): hook-version-stamp modify packages/cli/src/install-hook.ts -- Record which CLI installed the hook binary, so the resolver can tell a stale binary from a current one before handing it an event\n\n" +
  "Update (2026-09-21): docs-stale-binary modify CLAUDE.md -- Document the version stamp and why the Codex path cannot self-heal without it";

describe("deriveTitle", () => {
  it("takes the first paragraph's headline before ' -- ', dropping every amendment paragraph after it", () => {
    expect(deriveTitle(AMENDED_SUMMARY)).toBe("Fix the nine defects found reviewing the Codex harness work");
  });

  it("cuts at the first ' -- ' separator for a single-paragraph summary", () => {
    expect(deriveTitle("Add a RetryPolicy -- exponential backoff on the sync client, capped at 30s")).toBe("Add a RetryPolicy");
  });

  it("falls back to the first sentence when there's no ' -- ' but the summary splits into several", () => {
    expect(
      deriveTitle("Adds a RetryPolicy class with exponential backoff. Wires it into the HTTP client so every outbound call retries."),
    ).toBe("Adds a RetryPolicy class with exponential backoff.");
  });

  it("returns a short single-sentence summary unchanged", () => {
    expect(deriveTitle("add keyboard shortcuts to the command palette")).toBe("add keyboard shortcuts to the command palette");
  });

  it("hard-clamps at a word boundary when even the extracted headline is very long", () => {
    const longSentence =
      "This is a single very long run-on sentence describing many different things all at once without any dash or period to break on anywhere near the start of it at all";
    const out = deriveTitle(longSentence);
    expect(out.length).toBeLessThanOrEqual(121); // 120 + the ellipsis character
    expect(out.endsWith("…")).toBe(true);
    expect(out.endsWith(" …")).toBe(false); // trims trailing space before the ellipsis
  });

  it("returns empty input unchanged", () => {
    expect(deriveTitle("")).toBe("");
    expect(deriveTitle("   ")).toBe("");
  });

  it("doesn't crash on null/undefined -- a real API response is a boundary, not a guaranteed string", () => {
    expect(deriveTitle(null)).toBe("");
    expect(deriveTitle(undefined)).toBe("");
  });

  // Real bug, found against production data: a paragraph can have a real
  // sentence break *before* its first " -- ", when the dash sits inside a
  // later sentence rather than the first one. Always preferring the dash
  // pulled in that whole extra sentence instead of stopping at the real
  // headline.
  it("stops at the first sentence when a ' -- ' appears later, inside a second sentence", () => {
    const summary =
      "Make session capture actually run under OpenCode. PRs #40 and #45 built the TranscriptSource seam and the OpenCode " +
      "implementation, but nothing constructs it -- the daemon still only ever reads Claude Code's JSONL, so OpenCode " +
      "capture is dead code today. This carries the information needed to pick a source from the harness to the daemon, " +
      "as one extensible property bag rather than a new field per harness.";
    expect(deriveTitle(summary)).toBe("Make session capture actually run under OpenCode.");
  });
});

describe("toDesignPoints", () => {
  it("splits an amended summary into one point per paragraph, sub-split on ' -- '", () => {
    const out = toDesignPoints(AMENDED_SUMMARY);
    expect(out).toEqual([
      "Fix the nine defects found reviewing the Codex harness work",
      "trust stamping that silently never happens or overrides the user, a patch decode that can deny every edit, a resolver that cannot find the repo for a Codex patch, and capture that misattributes a moved session",
      "Update (2026-09-21): hook-version-stamp modify packages/cli/src/install-hook.ts",
      "Record which CLI installed the hook binary, so the resolver can tell a stale binary from a current one before handing it an event",
      "Update (2026-09-21): docs-stale-binary modify CLAUDE.md",
      "Document the version stamp and why the Codex path cannot self-heal without it",
    ]);
  });

  it("splits ordinary multi-sentence prose the same way toBullets does", () => {
    const out = toDesignPoints("Adds a RetryPolicy class with exponential backoff. Wires it into the HTTP client so every outbound call retries.");
    expect(out).toHaveLength(2);
  });

  it("returns [] for a short single-clause summary, same convention as toBullets", () => {
    expect(toDesignPoints("add keyboard shortcuts to the command palette")).toEqual([]);
  });

  it("returns [] for empty input", () => {
    expect(toDesignPoints("")).toEqual([]);
  });

  it("doesn't crash on null/undefined", () => {
    expect(toDesignPoints(null)).toEqual([]);
    expect(toDesignPoints(undefined)).toEqual([]);
  });
});
