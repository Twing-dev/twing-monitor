import { describe, it, expect } from "vitest";
import { splitAmendments, amendmentCount } from "./amendments.js";

/** Built the way the coordinator builds one, rather than by hand, so a
 * change to the separator fails here instead of silently never matching.
 * Mirrors `appendSummaryUpdate` (server-side `design-checks.ts`). */
function appended(summary: string, date: string, update: string): string {
  return `${summary}\n\nUpdate (${date}): ${update}`;
}

const PLAIN = "Reworks the sync client so a dropped connection resumes from its last acknowledged offset.";
const MARKDOWN = "## Context\nThe Mine filter inherits across a linked group.\n\n## Approach\n- Add entry 6 to docs/bugs.md";

const FIXTURES: Record<string, string> = {
  noAmendments: PLAIN,
  oneAmendment: appended(PLAIN, "2026-09-29", "Also touches src/net/timeout.ts."),
  threeAmendments: appended(appended(appended(PLAIN, "2026-09-29", "first"), "2026-09-30", "second"), "2026-10-01", "third"),
  onMarkdown: appended(MARKDOWN, "2026-10-05", "Also version-control the status board."),
  multiParagraphUpdate: appended(PLAIN, "2026-10-05", "PRs raised:\n\ntwing-cli #57\ntwing-monitor #20"),
  sameDayTwice: appended(appended(PLAIN, "2026-10-04", "test 2"), "2026-10-04", "test 3"),
  updateWordInProse: "Update the sync client.\n\nIt resumes from the last offset.",
  looseMarkerInProse: "Rewrites the client.\n\nUpdate (see the ticket): not a real marker.",
};

describe("splitAmendments", () => {
  // THE load-bearing property, for the same reason it is in markdown.test.ts:
  // the fold moves these runs into a disclosure, and a drift of one character
  // lands every comment in that run on the wrong words while the page still
  // looks right.
  it("reports an offset that points at the amendment's own text, for every fixture", () => {
    for (const [name, summary] of Object.entries(FIXTURES)) {
      const { amendments } = splitAmendments(summary);
      for (const a of amendments) {
        const slice = summary.slice(a.offset, a.offset + a.text.length);
        expect(slice, `${name}: amendment at ${a.offset}`).toBe(a.text);
      }
    }
  });

  // The other half of the anchor promise: existing comments resolved against
  // the base must not move, which holds only while `base` is a literal prefix
  // starting at 0.
  it("returns a base that is a prefix of the summary, for every fixture", () => {
    for (const [name, summary] of Object.entries(FIXTURES)) {
      const { base } = splitAmendments(summary);
      expect(summary.startsWith(base), `${name}`).toBe(true);
    }
  });

  it("loses nothing: base plus every marker and amendment rebuilds the input", () => {
    for (const [name, summary] of Object.entries(FIXTURES)) {
      const { base, amendments } = splitAmendments(summary);
      const rebuilt = amendments.reduce((acc, a) => `${acc}\n\nUpdate (${a.date}): ${a.text}`, base);
      expect(rebuilt, `${name}`).toBe(summary);
    }
  });

  it("returns the summary unchanged when nothing has been amended", () => {
    const { base, amendments } = splitAmendments(PLAIN);
    expect(base).toBe(PLAIN);
    expect(amendments).toEqual([]);
  });

  it("splits one amendment off the end", () => {
    const { base, amendments } = splitAmendments(FIXTURES.oneAmendment);
    expect(base).toBe(PLAIN);
    expect(amendments).toHaveLength(1);
    expect(amendments[0].date).toBe("2026-09-29");
    expect(amendments[0].text).toBe("Also touches src/net/timeout.ts.");
  });

  it("keeps several amendments in the order they were appended", () => {
    const { base, amendments } = splitAmendments(FIXTURES.threeAmendments);
    expect(base).toBe(PLAIN);
    expect(amendments.map((a) => a.text)).toEqual(["first", "second", "third"]);
    expect(amendments.map((a) => a.date)).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
  });

  // Two amends on one day is the common real shape -- a deny/amend/retry loop
  // runs in minutes -- and the date is not what separates them.
  it("keeps two amendments made on the same day separate", () => {
    const { amendments } = splitAmendments(FIXTURES.sameDayTwice);
    expect(amendments.map((a) => a.text)).toEqual(["test 2", "test 3"]);
  });

  // The base keeps its own structure, so whichever renderer the overview was
  // already using for it keeps applying.
  it("leaves an authored markdown base intact", () => {
    const { base, amendments } = splitAmendments(FIXTURES.onMarkdown);
    expect(base).toBe(MARKDOWN);
    expect(amendments).toHaveLength(1);
  });

  it("keeps a multi-paragraph amendment as one amendment", () => {
    const { amendments } = splitAmendments(FIXTURES.multiParagraphUpdate);
    expect(amendments).toHaveLength(1);
    expect(amendments[0].text).toBe("PRs raised:\n\ntwing-cli #57\ntwing-monitor #20");
  });

  // The strictness of the marker, asserted from both sides: prose that merely
  // starts with the word, and a parenthesis that is not an ISO day. Folding
  // either would hide text the author meant as the design itself.
  it("does not fold prose that merely begins with the word Update", () => {
    const { base, amendments } = splitAmendments(FIXTURES.updateWordInProse);
    expect(base).toBe(FIXTURES.updateWordInProse);
    expect(amendments).toEqual([]);
  });

  it("does not fold a marker whose parenthesis is not a date", () => {
    const { base, amendments } = splitAmendments(FIXTURES.looseMarkerInProse);
    expect(base).toBe(FIXTURES.looseMarkerInProse);
    expect(amendments).toEqual([]);
  });

  it("is stable across repeated calls on the same string", () => {
    const first = splitAmendments(FIXTURES.threeAmendments);
    const second = splitAmendments(FIXTURES.threeAmendments);
    expect(second).toEqual(first);
  });

  it("survives a null or empty summary", () => {
    expect(splitAmendments(null)).toEqual({ base: "", amendments: [] });
    expect(splitAmendments(undefined)).toEqual({ base: "", amendments: [] });
    expect(splitAmendments("")).toEqual({ base: "", amendments: [] });
  });
});

describe("amendmentCount", () => {
  it("counts what splitAmendments found", () => {
    expect(amendmentCount(PLAIN)).toBe(0);
    expect(amendmentCount(FIXTURES.oneAmendment)).toBe(1);
    expect(amendmentCount(FIXTURES.threeAmendments)).toBe(3);
    expect(amendmentCount(null)).toBe(0);
  });
});
