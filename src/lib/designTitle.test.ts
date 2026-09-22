import { describe, it, expect } from "vitest";
import { deriveTitle } from "./designTitle.js";

describe("deriveTitle", () => {
  it("cuts at the first ' -- ' separator, dropping everything after", () => {
    expect(deriveTitle("Add a RetryPolicy -- exponential backoff on the sync client, capped at 30s")).toBe("Add a RetryPolicy");
  });

  it("drops every amendment appended after the headline, not just the first", () => {
    const summary =
      "Fix the nine defects found reviewing the Codex harness work -- trust stamping that silently never happens " +
      "Update (2026-09-21): hook-version-stamp modify packages/cli/src/install-hook.ts -- Record which CLI installed the hook binary " +
      "Update (2026-09-21): docs-stale-binary modify CLAUDE.md -- Document the version stamp";
    expect(deriveTitle(summary)).toBe("Fix the nine defects found reviewing the Codex harness work");
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
});
