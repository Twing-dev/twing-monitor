import { describe, it, expect } from "vitest";
import { splitBullets, splitOverviewSections } from "./overviewSections.js";

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

describe("splitBullets", () => {
  const overview = "Problem: Logs are missing.\nApproach:\n- Middleware logs each request, so one place sees all traffic.\n- The LLM client logs prompts.";

  it("splits an Approach written as bullets into items whose offsets point into the full text", () => {
    const approach = splitOverviewSections(overview)[1];
    const list = splitBullets(approach.body, approach.offset)!;
    expect(list.lead).toBeUndefined();
    expect(list.items.map((i) => i.text)).toEqual(["Middleware logs each request, so one place sees all traffic.", "The LLM client logs prompts."]);
    for (const item of list.items) {
      expect(overview.slice(item.offset, item.offset + item.text.length)).toBe(item.text);
    }
  });

  it("keeps text before the first bullet as a lead, and joins a wrapped line to its bullet", () => {
    const list = splitBullets("Two steps:\n- first step\n  continues here\n- second", 100)!;
    expect(list.lead).toEqual({ text: "Two steps:", offset: 100 });
    expect(list.items.map((i) => i.text)).toEqual(["first step\n  continues here", "second"]);
  });

  it("returns undefined for plain prose, so it renders as before", () => {
    expect(splitBullets("Implements logging with a middleware.", 0)).toBeUndefined();
  });
});
