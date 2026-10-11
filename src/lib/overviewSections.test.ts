import { describe, it, expect } from "vitest";
import { splitOverviewSections } from "./overviewSections.js";

describe("splitOverviewSections", () => {
  it("splits a Problem/Approach overview into two labelled sections", () => {
    const text = "Problem: Overviews drop the fix.\nApproach: Send the plan to the model.";
    expect(splitOverviewSections(text)).toEqual([
      { label: "Problem", body: "Overviews drop the fix.", offset: 9 },
      { label: "Approach", body: "Send the plan to the model.", offset: 43 },
    ]);
  });

  it("offsets point at each body inside the full text, so comment anchors still line up", () => {
    const text = "Problem: A.\nApproach: B and C.";
    for (const section of splitOverviewSections(text)) {
      expect(text.slice(section.offset, section.offset + section.body.length)).toBe(section.body);
    }
  });

  it("returns text without labels as one unlabelled section", () => {
    const text = "Adds a retry budget to the HTTP client.";
    expect(splitOverviewSections(text)).toEqual([{ body: text, offset: 0 }]);
  });

  it("keeps text before the first label instead of dropping it", () => {
    const sections = splitOverviewSections("Intro line.\nProblem: X.\nApproach: Y.");
    expect(sections.map((s) => s.label)).toEqual([undefined, "Problem", "Approach"]);
    expect(sections[0].body).toBe("Intro line.");
  });

  it("does not treat the word mid-sentence as a label", () => {
    const text = "The approach: keep it simple.";
    expect(splitOverviewSections(text)).toEqual([{ body: text, offset: 0 }]);
  });
});
