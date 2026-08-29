import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { DesignsView } from "./DesignsView.js";
import type { ProjectSummary } from "../api/types.js";

function renderWithAuth(onOpenTab?: (tab: "threads") => void, projectIds: string[] = ["proj-1"], projectsById: Record<string, ProjectSummary> = {}) {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <DesignsView projectIds={projectIds} projectsById={projectsById} onOpenTab={onOpenTab} />
    </ServerProvider>,
  );
}

describe("DesignsView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders an empty state when there are no designs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    renderWithAuth();

    await waitFor(() => expect(screen.getByText(/no designs match this filter/i)).toBeInTheDocument());
  });

  it("renders one card per design with summary and status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                {
                  id: "design-1",
                  projectId: "proj-1",
                  developerId: "alice@example.com",
                  sessionId: "sess-1",
                  status: "open",
                  createdAt: Date.now(),
                  summary: "Add retry backoff to the sync client",
                  creates: ["src/sync/retry.ts"],
                  touches: [],
                  dependsOn: [],
                  ttlMs: 3_600_000,
                  scopeVersion: 1,
                  lastActivityAt: Date.now(),
                  justifiedConstraintIds: [],
                  justifiedOverlaps: [],
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText("Add retry backoff to the sync client")).toBeInTheDocument());
    expect(screen.getByText("open", { selector: ".status-badge" })).toBeInTheDocument();
  });

  // Pagination (monitor UI load-time fix, 2026-08-29): GET /v1/designs now
  // returns {items, nextBefore} instead of the whole project's history --
  // mirrors ActivityView's own "load-older" test.
  it("shows a 'Load older' button when a next page exists, and appends the next page on click", async () => {
    const user = userEvent.setup();
    const design = (id: string, summary: string) => ({
      id,
      projectId: "proj-1",
      developerId: "alice@example.com",
      sessionId: "sess-1",
      status: "open",
      createdAt: Date.now(),
      summary,
      creates: [],
      touches: [],
      dependsOn: [],
      ttlMs: 3_600_000,
      scopeVersion: 1,
      lastActivityAt: Date.now(),
      justifiedConstraintIds: [],
      justifiedOverlaps: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (!url.pathname.endsWith("/v1/designs")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        const before = url.searchParams.get("before");
        if (!before) return new Response(JSON.stringify({ items: [design("design-new", "The newer design")], nextBefore: 500 }), { status: 200 });
        return new Response(JSON.stringify({ items: [design("design-old", "The older design")] }), { status: 200 });
      }),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText("The newer design")).toBeInTheDocument());
    expect(screen.queryByText("The older design")).not.toBeInTheDocument();

    const loadOlder = screen.getByRole("button", { name: "Load older" });
    await user.click(loadOlder);

    await waitFor(() => expect(screen.getByText("The older design")).toBeInTheDocument());
    expect(screen.getByText("The newer design")).toBeInTheDocument();
    // The older page carried no nextBefore -- the button drops away once
    // every project's cursor is exhausted.
    expect(screen.queryByRole("button", { name: "Load older" })).not.toBeInTheDocument();
  });

  it("expands a card on click to show the full plan text, scope, and the session's claims", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "design-1",
                  projectId: "proj-1",
                  developerId: "alice@example.com",
                  sessionId: "sess-1",
                  status: "open",
                  createdAt: Date.now(),
                  summary: "Add retry backoff to the sync client",
                  rawPlanExcerpt: "1. Add exponential backoff\n2. Wire it into the sync client",
                  creates: ["src/sync/retry.ts"],
                  touches: ["src/sync/client.ts"],
                  dependsOn: [],
                  ttlMs: 3_600_000,
                  scopeVersion: 1,
                  lastActivityAt: Date.now(),
                  justifiedConstraintIds: [],
                  justifiedOverlaps: [],
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/v1/claims?")) {
          return new Response(
            JSON.stringify({
              items: [
                { projectId: "proj-1", developerId: "alice@example.com", sessionId: "sess-1", branch: "main", symbolId: "src/sync/retry.ts::backoff", kind: "write", stage: "firm", ts: Date.now(), ttlMs: 3_600_000 },
              ],
            }),
            { status: 200 },
          );
        }
        // The list view's own bulk design_checked fetch (no relatedId) --
        // nothing to report here, this design is clean.
        if (url.includes("/v1/activity?")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    const card = await screen.findByRole("button", { name: /Add retry backoff to the sync client/ });
    await user.click(card);

    expect(screen.getByText(/Add exponential backoff/)).toBeInTheDocument();
    expect(screen.getByText("src/sync/retry.ts")).toBeInTheDocument();
    expect(screen.getByText("src/sync/client.ts")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("src/sync/retry.ts::backoff")).toBeInTheDocument());

    // Collapses again on a second click.
    await user.click(card);
    expect(screen.queryByText(/Add exponential backoff/)).not.toBeInTheDocument();
  });

  // 2026-08-26: `constraint_violation` is the one verdict that still fires a
  // synchronous `design_checked` on the very request that flags it (see
  // ResolveActions/LatestCheckOutcome's own doc comments, DesignDetail.tsx,
  // for why the detail panel queries both design_checked and design_flagged
  // now) -- this pins that the query really does ask for the right kinds,
  // not just that *some* activity event renders.
  it("a flagged design's expanded detail shows why it was flagged (fetched from its own design_checked activity event)", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "design-flagged-1",
                  projectId: "proj-1",
                  developerId: "alice@example.com",
                  sessionId: "sess-1",
                  status: "flagged",
                  createdAt: Date.now(),
                  summary: "Touches README.md",
                  creates: [],
                  touches: ["README.md"],
                  dependsOn: [],
                  ttlMs: 3_600_000,
                  scopeVersion: 1,
                  lastActivityAt: Date.now(),
                  justifiedConstraintIds: [],
                  justifiedOverlaps: [],
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/v1/activity?") && url.includes("relatedId=design-flagged-1")) {
          if (!url.includes("kind=design_checked")) throw new Error(`expected kind=design_checked in ${url}`);
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "evt-1",
                  projectId: "proj-1",
                  kind: "design_checked",
                  relatedId: "design-flagged-1",
                  ts: Date.now(),
                  payload: { verdict: "constraint_violation", summary: "Touches README.md", constraints: [{ id: "c1", statement: "keep README.md canonical", type: "constraint" }] },
                },
              ],
            }),
            { status: 200 },
          );
        }
        // The list view's own bulk design_checked fetch (no relatedId) --
        // this design already shows "flagged" via its status badge, no
        // separate chip needed, so an empty page is fine here.
        if (url.includes("/v1/activity?")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        if (url.includes("/v1/reviews?")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        if (url.includes("/v1/claims?")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    const card = await screen.findByRole("button", { name: /Touches README\.md/ });
    await user.click(card);

    expect(await screen.findByText("Why flagged")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("keep README.md canonical")).toBeInTheDocument());

    // A constraint_violation names a rule, not another design -- there's
    // nothing to adopt, so only the justify form should be offered.
    await waitFor(() => expect(screen.getByText("Resolve")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^Adopt/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Justify divergence")).toBeInTheDocument();
  });

  // file_overlap (2026-08-26, was "overlap" tier 1 at "warning" severity):
  // an "open" design (never demoted to "flagged") that still has an
  // unresolved overlap worth surfacing -- must show a distinct, clearly
  // non-blocking panel, not "Why flagged" (which implies the design was
  // actually demoted) and not silence.
  it("an open design with an unresolved file_overlap shows a non-blocking 'Heads up' panel, not 'Why flagged'", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "design-warned-1",
                  projectId: "proj-1",
                  developerId: "alice@example.com",
                  sessionId: "sess-1",
                  status: "open",
                  createdAt: Date.now(),
                  summary: "Add a shared cache helper",
                  creates: [],
                  touches: ["shared.ts"],
                  dependsOn: [],
                  ttlMs: 3_600_000,
                  scopeVersion: 1,
                  lastActivityAt: Date.now(),
                  justifiedConstraintIds: [],
                  justifiedOverlaps: [],
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/v1/activity?")) {
          // Same event answers both the list view's bulk (no relatedId)
          // fetch and the detail panel's own scoped (relatedId=) fetch --
          // it's the same underlying design_checked row either way.
          if (url.includes("relatedId=") && !url.includes("relatedId=design-warned-1")) {
            throw new Error(`unexpected relatedId in ${url}`);
          }
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "evt-1",
                  projectId: "proj-1",
                  kind: "design_checked",
                  relatedId: "design-warned-1",
                  ts: Date.now(),
                  payload: {
                    verdict: "file_overlap",
                    summary: "Add a shared cache helper",
                    conflicts: [{ conflictingDesignId: "design-other", overlapKind: "touches", overlapDetail: "both touch shared.ts", conflictingSummary: "another session's work" }],
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/v1/claims?")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    // The collapsed card itself gets a chip -- this is the list-level fix:
    // an "open" design with a live warning must not look identical to a
    // clean one before you ever expand it.
    await waitFor(() => expect(screen.getByText("overlap warning")).toBeInTheDocument());

    const card = await screen.findByRole("button", { name: /Add a shared cache helper/ });
    await user.click(card);

    expect(await screen.findByText("Heads up (non-blocking)")).toBeInTheDocument();
    expect(screen.queryByText("Why flagged")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/another session's work/)).toBeInTheDocument());
  });

  it("a clean, never-flagged design's expanded detail shows no conflict panel at all", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "design-clean-1",
                  projectId: "proj-1",
                  developerId: "alice@example.com",
                  sessionId: "sess-1",
                  status: "open",
                  createdAt: Date.now(),
                  summary: "A perfectly clean design",
                  creates: [],
                  touches: ["only-mine.ts"],
                  dependsOn: [],
                  ttlMs: 3_600_000,
                  scopeVersion: 1,
                  lastActivityAt: Date.now(),
                  justifiedConstraintIds: [],
                  justifiedOverlaps: [],
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/v1/activity?") && url.includes("relatedId=design-clean-1")) {
          return new Response(
            JSON.stringify({
              items: [{ id: "evt-1", projectId: "proj-1", kind: "design_checked", relatedId: "design-clean-1", ts: Date.now(), payload: { verdict: "clean", summary: "A perfectly clean design" } }],
            }),
            { status: 200 },
          );
        }
        // The list view's own bulk design_checked fetch (no relatedId) --
        // reuse the same clean event; the chip must not appear for it.
        if (url.includes("/v1/activity?")) {
          return new Response(
            JSON.stringify({
              items: [{ id: "evt-1", projectId: "proj-1", kind: "design_checked", relatedId: "design-clean-1", ts: Date.now(), payload: { verdict: "clean", summary: "A perfectly clean design" } }],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/v1/claims?")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    const card = await screen.findByRole("button", { name: /A perfectly clean design/ });
    await waitFor(() => expect(screen.queryByText("overlap warning")).not.toBeInTheDocument());
    await user.click(card);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Session" })).toBeInTheDocument()); // detail did render...
    expect(screen.queryByText("Why flagged")).not.toBeInTheDocument();
    expect(screen.queryByText("Heads up (non-blocking)")).not.toBeInTheDocument();
    expect(screen.queryByText("Unresolved conflict")).not.toBeInTheDocument();
  });

  const OVERLAP_FLAGGED_DESIGN = {
    id: "design-overlap-1",
    projectId: "proj-1",
    developerId: "alice@example.com",
    sessionId: "sess-1",
    status: "flagged",
    createdAt: Date.now(),
    summary: "Rewrite the invite email template",
    creates: [],
    touches: ["src/emails/invite.ts"],
    dependsOn: [],
    ttlMs: 3_600_000,
    scopeVersion: 1,
    lastActivityAt: Date.now(),
    justifiedConstraintIds: [],
    justifiedOverlaps: [],
  };

  // 2026-08-26: symbol_conflict, not file_overlap -- file_overlap never
  // flags at all now (always advisory), so a *flagged* design with named
  // conflicting designs to adopt is sourced from a real edit collision
  // instead, via an async `design_flagged` event rather than a synchronous
  // `design_checked` (see ResolveActions' own doc comment, DesignDetail.tsx).
  const OVERLAP_CHECK_EVENT = {
    id: "evt-1",
    projectId: "proj-1",
    kind: "design_flagged",
    relatedId: "design-overlap-1",
    ts: Date.now(),
    payload: {
      verdict: "symbol_conflict",
      summary: "Rewrite the invite email template",
      conflicts: [{ conflictingDesignId: "design-other-1", overlapKind: "symbol", overlapDetail: "both edited Inbox.tsx::sendInvite", conflictingSummary: "Also rewrite the invite email" }],
    },
  };

  // §17.5: symbol_conflict names specific conflicting design(s), so --
  // unlike constraint_violation -- there's something concrete to adopt
  // instead of this design, offered alongside the same justify escape
  // hatch (which is self-approvable for this bucket, no admin needed).
  it("a symbol_conflict-flagged design offers an Adopt button per conflict, plus justify", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: [OVERLAP_FLAGGED_DESIGN] }), { status: 200 });
        if (url.includes("/v1/activity?") && url.includes("relatedId=")) return new Response(JSON.stringify({ items: [OVERLAP_CHECK_EVENT] }), { status: 200 });
        if (url.includes("/v1/activity?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (url.includes("/v1/reviews?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (url.includes("/v1/claims?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    const card = await screen.findByRole("button", { name: /Rewrite the invite email template/ });
    await user.click(card);

    expect(await screen.findByRole("button", { name: /Adopt .*Also rewrite the invite email/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Justify divergence")).toBeInTheDocument();
  });

  it("clicking Adopt resolves the design as superseded and refreshes the list", async () => {
    const user = userEvent.setup();
    let resolved = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) {
          const items = resolved ? [{ ...OVERLAP_FLAGGED_DESIGN, status: "superseded" }] : [OVERLAP_FLAGGED_DESIGN];
          return new Response(JSON.stringify({ items }), { status: 200 });
        }
        if (url.includes("/resolve")) {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toEqual({ resolution: "adopted", adoptedDesignId: "design-other-1" });
          resolved = true;
          return new Response(JSON.stringify({ status: "superseded", adoptedDesignId: "design-other-1" }), { status: 200 });
        }
        if (url.includes("/v1/activity?") && url.includes("relatedId=")) return new Response(JSON.stringify({ items: [OVERLAP_CHECK_EVENT] }), { status: 200 });
        if (url.includes("/v1/activity?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (url.includes("/v1/reviews?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (url.includes("/v1/claims?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    const card = await screen.findByRole("button", { name: /Rewrite the invite email template/ });
    await user.click(card);
    await user.click(await screen.findByRole("button", { name: /Adopt .*Also rewrite the invite email/ }));

    await waitFor(() => expect(screen.getByText("superseded", { selector: ".status-badge" })).toBeInTheDocument());
  });

  it("submitting a justification switches the panel to a pending-review state", async () => {
    const user = userEvent.setup();
    let justified = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: [OVERLAP_FLAGGED_DESIGN] }), { status: 200 });
        if (url.includes("/resolve")) {
          expect(JSON.parse(String(init?.body))).toEqual({ resolution: "justified_divergence", justification: "Both are needed, coordinating with the other author." });
          justified = true;
          return new Response(JSON.stringify({ status: "pending_review", reviewId: "review-99" }), { status: 200 });
        }
        if (url.includes("/v1/activity?") && url.includes("relatedId=")) return new Response(JSON.stringify({ items: [OVERLAP_CHECK_EVENT] }), { status: 200 });
        if (url.includes("/v1/activity?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (url.includes("/v1/reviews?")) {
          const items = justified
            ? [{ id: "review-99", designId: "design-overlap-1", projectId: "proj-1", justification: "Both are needed, coordinating with the other author.", createdAt: Date.now() }]
            : [];
          return new Response(JSON.stringify({ items }), { status: 200 });
        }
        if (url.includes("/v1/claims?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    const card = await screen.findByRole("button", { name: /Rewrite the invite email template/ });
    await user.click(card);
    await user.type(screen.getByLabelText("Justify divergence"), "Both are needed, coordinating with the other author.");
    await user.click(screen.getByRole("button", { name: "Submit for review" }));

    expect(await screen.findByText("Justified -- pending review")).toBeInTheDocument();
    expect(screen.getByText(/Both are needed, coordinating with the other author\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit for review" })).not.toBeInTheDocument();
  });

  it("a design with an already-pending review shows the pending state directly, not the resolve form", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: [OVERLAP_FLAGGED_DESIGN] }), { status: 200 });
        if (url.includes("/v1/activity?") && url.includes("relatedId=")) return new Response(JSON.stringify({ items: [OVERLAP_CHECK_EVENT] }), { status: 200 });
        if (url.includes("/v1/activity?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (url.includes("/v1/reviews?")) {
          return new Response(
            JSON.stringify({ items: [{ id: "review-99", designId: "design-overlap-1", projectId: "proj-1", justification: "Already justified earlier.", createdAt: Date.now() }] }),
            { status: 200 },
          );
        }
        if (url.includes("/v1/claims?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    const card = await screen.findByRole("button", { name: /Rewrite the invite email template/ });
    await user.click(card);

    expect(await screen.findByText("Justified -- pending review")).toBeInTheDocument();
    expect(screen.getByText(/Already justified earlier\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Adopt/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Justify divergence")).not.toBeInTheDocument();
  });

  const ERIN_DESIGN = {
    id: "design-erin-1",
    projectId: "proj-1",
    developerId: "erin@example.com",
    sessionId: "s-erin",
    status: "open",
    createdAt: Date.now(),
    summary: "Add API-key rate limiter",
    creates: [],
    touches: [],
    dependsOn: [],
    ttlMs: 3_600_000,
    scopeVersion: 1,
    lastActivityAt: Date.now(),
    justifiedConstraintIds: [],
    justifiedOverlaps: [],
  };
  const FRANK_DESIGN = { ...ERIN_DESIGN, id: "design-frank-1", developerId: "frank@example.com", sessionId: "s-frank", summary: "Add session-guard throttle" };
  const SEMANTIC_THREAD = {
    id: "thread-semantic-1",
    projectId: "proj-1",
    symbolId: "", // real shape: runSemanticComparatorPass always passes symbolIds: [],
    // so the store computes symbolId as symbolIds[0] ?? "" -- never a design id.
    // initiatingDesignId is the real carrier of "which side actually got flagged."
    developerId: "erin@example.com",
    otherDeveloperId: "frank@example.com",
    designId: "design-frank-1",
    initiatingDesignId: "design-erin-1",
    category: "llm_divergence",
    status: "open",
    systemDescription: "Both plans independently build a sliding-window rate limiter.",
    openedAt: Date.now(),
  };

  // Regression coverage for the "I see two open semantic conflicts in
  // Alignment threads, but not in Designs" gap: a design_semantic_conflict
  // thread never touches status/design_checked, so without this both
  // designs would render as plain "open" cards with no trace of it.
  it("both designs in a semantic-conflict thread get a chip, and the expanded panel names the specific counterpart", async () => {
    const user = userEvent.setup();
    const onOpenTab = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: [ERIN_DESIGN, FRANK_DESIGN] }), { status: 200 });
        // DesignCardBody's semantic-overlap counterpart lookup resolves via
        // the on-demand GET /v1/designs/:id fetch (useOnDemandDesigns,
        // 2026-08-29), even when the counterpart is itself already on the
        // current page -- the hook always fetches by id, it doesn't cross-
        // reference the list it was given.
        if (url.includes("/v1/designs/design-erin-1")) return new Response(JSON.stringify({ design: ERIN_DESIGN, groupMembers: [] }), { status: 200 });
        if (url.includes("/v1/designs/design-frank-1")) return new Response(JSON.stringify({ design: FRANK_DESIGN, groupMembers: [] }), { status: 200 });
        if (url.includes("/v1/alignment-threads?")) return new Response(JSON.stringify({ items: [SEMANTIC_THREAD] }), { status: 200 });
        if (url.includes("/v1/activity?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (url.includes("/v1/claims?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth(onOpenTab);

    // Both cards get the chip, not just the one the thread's own symbolId names.
    await waitFor(() => expect(screen.getAllByText("semantic overlap", { selector: ".status-badge" })).toHaveLength(2));

    const erinCard = screen.getByRole("button", { name: /Add API-key rate limiter/ });
    await user.click(erinCard);

    expect(await screen.findByText("Semantic overlap")).toBeInTheDocument();
    expect(screen.getByText("Both plans independently build a sliding-window rate limiter.")).toBeInTheDocument();
    // The counterpart link's own text is prefixed with "→ " -- anchor on
    // that so this doesn't ambiguously also match frank's own card-toggle
    // button, which contains the same summary text without the arrow.
    const counterpartLink = screen.getByRole("button", { name: /^→ Add session-guard throttle/ });

    // Clicking the counterpart jumps straight to *that* design's own card,
    // expanded, whose own Semantic overlap panel points back the other way.
    await user.click(counterpartLink);
    await waitFor(() => expect(screen.getByRole("button", { name: /^→ Add API-key rate limiter/ })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Add session-guard throttle/ })).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "View alignment thread →" }));
    expect(onOpenTab).toHaveBeenCalledWith("threads");
  });

  it("a design with no open alignment thread gets no semantic overlap chip", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: [ERIN_DESIGN] }), { status: 200 });
        if (url.includes("/v1/alignment-threads?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (url.includes("/v1/activity?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    await screen.findByText("Add API-key rate limiter");
    expect(screen.queryByText("semantic overlap", { selector: ".status-badge" })).not.toBeInTheDocument();
  });

  describe("multi-repo aggregation", () => {
    function mockMultiProjectFetch(designsByProject: Record<string, unknown[]>) {
      return vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const projectId = new URL(url).searchParams.get("projectId") ?? "";
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: designsByProject[projectId] ?? [] }), { status: 200 });
        if (url.includes("/v1/activity?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (url.includes("/v1/alignment-threads?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (url.includes("/v1/claims?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        throw new Error(`unexpected fetch: ${url}`);
      });
    }

    const PROJECTS = {
      "proj-1": { projectId: "proj-1", orgId: "", role: "admin" as const, githubOwner: "acme", githubRepo: "widgets" },
      "proj-2": { projectId: "proj-2", orgId: "", role: "admin" as const },
    };

    it("collapses two designs sharing a groupId across repos into one card with a RepoBadge per member, and expands into one detail panel each", async () => {
      const user = userEvent.setup();
      const cliSide = { ...ERIN_DESIGN, id: "design-cli", projectId: "proj-1", groupId: "grp-1", summary: "Add groupId to DesignStatement", touches: ["packages/core/src/types.ts"] };
      const monitorSide = { ...ERIN_DESIGN, id: "design-monitor", projectId: "proj-2", groupId: "grp-1", summary: "Add groupId to DesignStatement", touches: ["src/api/types.ts"] };
      vi.stubGlobal("fetch", mockMultiProjectFetch({ "proj-1": [cliSide], "proj-2": [monitorSide] }));
      renderWithAuth(undefined, ["proj-1", "proj-2"], PROJECTS);

      // One card, not two.
      expect(await screen.findAllByText("Add groupId to DesignStatement")).toHaveLength(1);
      expect(screen.getByText("acme/widgets")).toBeInTheDocument();
      expect(screen.getByText("proj-2")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /Add groupId to DesignStatement/ }));
      expect(await screen.findByText("packages/core/src/types.ts")).toBeInTheDocument();
      expect(screen.getByText("src/api/types.ts")).toBeInTheDocument();
    });

    it("collapses a group's badges to one per distinct repo/status, not one per member", async () => {
      // Two members in proj-1 (same repo) plus one in proj-2, all closed --
      // the collapsed header should show "acme/widgets" once, "proj-2"
      // once, and "closed" once, never three of any of them.
      const first = { ...ERIN_DESIGN, id: "design-1", projectId: "proj-1", groupId: "grp-3", status: "closed", summary: "Three-way linked design" };
      const second = { ...ERIN_DESIGN, id: "design-2", projectId: "proj-1", groupId: "grp-3", status: "closed", summary: "Three-way linked design" };
      const third = { ...ERIN_DESIGN, id: "design-3", projectId: "proj-2", groupId: "grp-3", status: "closed", summary: "Three-way linked design" };
      vi.stubGlobal("fetch", mockMultiProjectFetch({ "proj-1": [first, second], "proj-2": [third] }));
      renderWithAuth(undefined, ["proj-1", "proj-2"], PROJECTS);

      await screen.findByText("Three-way linked design");
      expect(screen.getAllByText("acme/widgets")).toHaveLength(1);
      expect(screen.getAllByText("proj-2")).toHaveLength(1);
      expect(screen.getAllByText("closed", { selector: ".status-badge" })).toHaveLength(1);
    });

    it("shows one badge per distinct status when a group's members disagree", async () => {
      const openMember = { ...ERIN_DESIGN, id: "design-open", projectId: "proj-1", groupId: "grp-4", status: "open", summary: "Mixed-status group" };
      const closedMember = { ...ERIN_DESIGN, id: "design-closed", projectId: "proj-2", groupId: "grp-4", status: "closed", summary: "Mixed-status group" };
      vi.stubGlobal("fetch", mockMultiProjectFetch({ "proj-1": [openMember], "proj-2": [closedMember] }));
      renderWithAuth(undefined, ["proj-1", "proj-2"], PROJECTS);

      await screen.findByText("Mixed-status group");
      expect(screen.getByText("open", { selector: ".status-badge" })).toBeInTheDocument();
      expect(screen.getByText("closed", { selector: ".status-badge" })).toBeInTheDocument();
    });

    it("renders two unrelated designs in different repos as two separate cards", async () => {
      const a = { ...ERIN_DESIGN, id: "design-a", projectId: "proj-1", summary: "Unrelated design A" };
      const b = { ...ERIN_DESIGN, id: "design-b", projectId: "proj-2", summary: "Unrelated design B" };
      vi.stubGlobal("fetch", mockMultiProjectFetch({ "proj-1": [a], "proj-2": [b] }));
      renderWithAuth(undefined, ["proj-1", "proj-2"], PROJECTS);

      expect(await screen.findByText("Unrelated design A")).toBeInTheDocument();
      expect(screen.getByText("Unrelated design B")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /Unrelated design/ })).toHaveLength(2);
    });

    it("shows no RepoBadge at all when only one repo is in scope", async () => {
      vi.stubGlobal("fetch", mockMultiProjectFetch({ "proj-1": [ERIN_DESIGN] }));
      renderWithAuth();

      await screen.findByText("Add API-key rate limiter");
      expect(screen.queryByText("acme/widgets")).not.toBeInTheDocument();
    });
  });
});
