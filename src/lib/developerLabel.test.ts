import { describe, it, expect } from "vitest";
import { developerLabel } from "./developerLabel.js";

describe("developerLabel", () => {
  // The case this exists for: 49 characters whose first 22 are a number
  // GitHub assigned, which is all a 440px row had room to show.
  it("drops GitHub's numeric prefix and domain from a noreply address", () => {
    expect(developerLabel("206395444+ayushsingh4522@users.noreply.github.com")).toBe("ayushsingh4522");
  });

  it("drops the domain from an ordinary address", () => {
    expect(developerLabel("mbhattacharyarules@gmail.com")).toBe("mbhattacharyarules");
    expect(developerLabel("juliancarax@twing.dev")).toBe("juliancarax");
  });

  // A plus in an address is usually the author's own tag, not GitHub's
  // prefix -- the digits are what distinguish the two.
  it("keeps a plus tag that isn't GitHub's numeric prefix", () => {
    expect(developerLabel("me+twing@example.com")).toBe("me+twing");
  });

  // Nothing mechanical to strip: returned untouched rather than guessed at.
  it("passes through anything that isn't an address", () => {
    expect(developerLabel("alice")).toBe("alice");
    expect(developerLabel("57282919-051d-4e9b-9cc7-cc7a0070c62d")).toBe("57282919-051d-4e9b-9cc7-cc7a0070c62d");
    expect(developerLabel("public-viewer")).toBe("public-viewer");
  });

  // Degenerate shapes must not throw or silently empty the row.
  it("leaves a leading-@ or bare @ value alone", () => {
    expect(developerLabel("@example.com")).toBe("@example.com");
    expect(developerLabel("")).toBe("");
  });
});
