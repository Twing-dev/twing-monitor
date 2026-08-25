import { describe, it, expect } from "vitest";
import { repoLabel } from "./repoLabel.js";

describe("repoLabel", () => {
  it("renders owner/repo when GitHub-bound", () => {
    expect(repoLabel({ githubOwner: "acme", githubRepo: "widgets", projectId: "proj-1" })).toBe("acme/widgets");
  });

  it("falls back to the raw projectId when not GitHub-bound", () => {
    expect(repoLabel({ projectId: "proj-1" })).toBe("proj-1");
  });

  it("falls back to projectId when only one of owner/repo is present", () => {
    expect(repoLabel({ githubOwner: "acme", projectId: "proj-1" })).toBe("proj-1");
  });
});
