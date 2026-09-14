import { describe, it, expect } from "vitest";
import { blastRadius, computeConformance, groupByKind, hasStructuredChanges, kindLabel, kindOf, pathOfTarget } from "./designConformance.js";
import type { Claim, DesignChange } from "../api/types.js";

function change(overrides: Partial<DesignChange> = {}): DesignChange {
  return { id: "c1", action: "modify", target: "src/net/retry.ts::RetryPolicy.backoff", intent: "does a thing", ...overrides };
}

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    projectId: "p1",
    developerId: "dev1",
    sessionId: "s1",
    branch: "main",
    symbolId: "src/net/retry.ts::RetryPolicy.backoff",
    kind: "write",
    stage: "firm",
    ts: 0,
    ttlMs: 0,
    ...overrides,
  };
}

describe("pathOfTarget", () => {
  it("strips the symbol half", () => {
    expect(pathOfTarget("src/net/retry.ts::RetryPolicy.backoff")).toBe("src/net/retry.ts");
  });

  it("leaves a bare path alone", () => {
    expect(pathOfTarget("drizzle/0017.sql")).toBe("drizzle/0017.sql");
  });
});

describe("kindOf", () => {
  it("defaults an unstated kind to code", () => {
    expect(kindOf(change())).toBe("code");
  });

  it("honours an explicit one", () => {
    expect(kindOf(change({ kind: "schema" }))).toBe("schema");
  });
});

describe("hasStructuredChanges", () => {
  // Absent and empty both mean "no structure to render" here, but only
  // absent is expected in practice -- the CLI refuses to register a
  // template declaring nothing.
  it("is false for absent", () => {
    expect(hasStructuredChanges(undefined)).toBe(false);
  });

  it("is false for empty", () => {
    expect(hasStructuredChanges([])).toBe(false);
  });

  it("is true for a real declaration", () => {
    expect(hasStructuredChanges([change()])).toBe(true);
  });
});

describe("computeConformance", () => {
  it("matches a declared target against an exact claim", () => {
    const report = computeConformance([change()], [claim()]);
    expect(report.matchedCount).toBe(1);
    expect(report.declared[0].state).toBe("matched");
    expect(report.undeclared).toEqual([]);
  });

  it("reports a declared change with no matching edit as not yet edited", () => {
    const report = computeConformance([change()], []);
    expect(report.matchedCount).toBe(0);
    expect(report.declared[0].state).toBe("not_yet_edited");
  });

  it("reports an edit outside the declared scope", () => {
    const report = computeConformance([change()], [claim({ symbolId: "src/net/limiter.ts::TokenBucket.take" })]);
    expect(report.undeclared).toEqual(["src/net/limiter.ts::TokenBucket.take"]);
  });

  // The granularity fallback this module exists to handle: a whole-file
  // Write, an unparseable file, or a failed edit-point lookup all produce a
  // bare path with no `::`. Comparing literally would report every one of
  // those as undeclared scope.
  it("lets a file-level claim satisfy a symbol-level declaration", () => {
    const report = computeConformance([change()], [claim({ symbolId: "src/net/retry.ts" })]);
    expect(report.matchedCount).toBe(1);
    expect(report.undeclared).toEqual([]);
  });

  it("lets a symbol-level claim satisfy a file-level declaration", () => {
    const report = computeConformance([change({ target: "src/net/retry.ts" })], [claim()]);
    expect(report.matchedCount).toBe(1);
  });

  // ...but two different symbols in one file are still two different
  // things. Collapsing these would make any claim anywhere in a declared
  // file satisfy every declaration in it.
  it("does not match two different symbols in the same file", () => {
    const report = computeConformance([change()], [claim({ symbolId: "src/net/retry.ts::RetryPolicy.jitter" })]);
    expect(report.matchedCount).toBe(0);
    expect(report.undeclared).toEqual(["src/net/retry.ts::RetryPolicy.jitter"]);
  });

  it("ignores read claims -- looking at a symbol is not building it", () => {
    const report = computeConformance([change()], [claim({ kind: "read" })]);
    expect(report.matchedCount).toBe(0);
    expect(report.undeclared).toEqual([]);
  });

  it("dedupes repeated writes to one symbol into a single finding", () => {
    const undeclared = claim({ symbolId: "src/other.ts::Thing.go" });
    const report = computeConformance([change()], [undeclared, { ...undeclared, ts: 1 }]);
    expect(report.undeclared).toEqual(["src/other.ts::Thing.go"]);
  });
});

describe("blastRadius", () => {
  it("counts changes and distinct files", () => {
    expect(
      blastRadius([change({ id: "a" }), change({ id: "b", target: "src/net/retry.ts::RetryPolicy.jitter" })]),
    ).toBe("2 changes · 1 file");
  });

  it("singularises a lone change", () => {
    expect(blastRadius([change()])).toBe("1 change · 1 file");
  });

  it("calls out renames, which assert behaviour did not change", () => {
    expect(blastRadius([change({ action: "rename", from: "old" })])).toContain("1 rename");
  });

  it("flags schema and api kinds", () => {
    const out = blastRadius([change({ id: "a", kind: "schema" }), change({ id: "b", kind: "api", target: "src/api.ts" })]);
    expect(out).toContain("schema");
    expect(out).toContain("API");
  });

  it("stays quiet about kinds that aren't present", () => {
    expect(blastRadius([change()])).not.toContain("schema");
  });
});

describe("groupByKind", () => {
  // The whole point of the section list: a reader asking "does this touch
  // the database" must see the word Database and the word none together.
  // An omitted section is indistinguishable from one they scrolled past.
  it("returns every kind, in fixed order, including empty ones", () => {
    const groups = groupByKind([change()]);
    expect(groups.map((g) => g.kind)).toEqual(["code", "schema", "config", "api", "test", "docs"]);
  });

  it("puts each change under its own kind and leaves the rest empty", () => {
    const groups = groupByKind([change({ id: "a", kind: "schema" }), change({ id: "b" })]);
    const byKind = Object.fromEntries(groups.map((g) => [g.kind, g.changes.length]));
    expect(byKind).toMatchObject({ code: 1, schema: 1, config: 0, api: 0, test: 0, docs: 0 });
  });

  // A coordinator that promotes one of the spec's remaining reserved kinds
  // must not have those changes silently vanish from the UI.
  it("appends an unrecognized kind rather than dropping it", () => {
    const groups = groupByKind([change({ id: "a", kind: "dependency" as never })]);
    expect(groups.map((g) => g.kind)).toContain("dependency");
    expect(groups.find((g) => g.kind === "dependency")?.changes).toHaveLength(1);
  });
});

describe("kindLabel", () => {
  // These are read by people who have never opened the schema doc.
  it("uses plain language, not the stored vocabulary", () => {
    expect(kindLabel("schema")).toBe("Database");
    expect(kindLabel("config")).toBe("Configuration");
  });

  it("falls back to the raw value for an unknown kind", () => {
    expect(kindLabel("dependency")).toBe("dependency");
  });
});
