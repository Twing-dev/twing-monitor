import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { AlignmentThreadsView } from "./AlignmentThreadsView.js";
import type { ProjectSummary } from "../api/types.js";

function renderWithAuth(onOpenDesign?: (designId: string) => void, projectIds: string[] = ["proj-1"], projectsById: Record<string, ProjectSummary> = {}) {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <AlignmentThreadsView projectIds={projectIds} projectsById={projectsById} onOpenDesign={onOpenDesign} />
    </ServerProvider>,
  );
}

// A claims-path (design_divergence) thread whose initiating developer
// (alice) had no design of her own behind the edit -- disable-gate, or the
// edit happened outside any gated session. Genuinely nothing to link on
// that side.
const CLAIMS_PATH_THREAD_NO_DESIGN = {
  id: "thread-1",
  projectId: "proj-1",
  symbolId: "src/net/retry.ts::RetryPolicy.backoff",
  symbolIds: ["src/net/retry.ts::RetryPolicy.backoff"],
  developerId: "alice@example.com",
  otherDeveloperId: "bob@example.com",
  designId: "design-bob-1",
  status: "open",
  systemDescription: "Both sessions touched RetryPolicy.backoff within the same window.",
  summary: '1 overlapping path with "Add exponential backoff to RetryPolicy"',
  category: "symbol_claim",
  openedAt: Date.now(),
  lastActivityAt: Date.now(),
};

// Same claims-path origin, but this time alice's own open design *does*
// resolve -- both sides should link, and the overlap has accumulated more
// than one path across amendments.
const CLAIMS_PATH_THREAD_WITH_DESIGN = {
  id: "thread-3",
  projectId: "proj-1",
  symbolId: "src/net/retry.ts::RetryPolicy.backoff",
  symbolIds: ["src/net/retry.ts::RetryPolicy.backoff", "src/net/retry.test.ts"],
  developerId: "alice@example.com",
  otherDeveloperId: "bob@example.com",
  designId: "design-bob-1",
  initiatingDesignId: "design-alice-1",
  status: "open",
  summary: '2 overlapping paths with "Add exponential backoff to RetryPolicy"',
  category: "symbol_claim",
  systemDescription: "Both sessions touched RetryPolicy.backoff within the same window.",
  openedAt: Date.now(),
  lastActivityAt: Date.now(),
};

// A design_semantic_conflict-originated thread (runSemanticComparatorPass,
// packages/server/src/app.ts): unlike the claims path above, both sides are
// always real designs.
const SEMANTIC_PATH_THREAD = {
  id: "thread-2",
  projectId: "proj-1",
  symbolId: "design-alice-1",
  symbolIds: [],
  developerId: "alice@example.com",
  otherDeveloperId: "carol@example.com",
  designId: "design-carol-1",
  initiatingDesignId: "design-alice-1",
  status: "open",
  systemDescription: "Both plans independently build a sliding-window rate limiter.",
  summary: 'Duplicate work with "Add session-guard throttle"',
  category: "duplication",
  openedAt: Date.now(),
  lastActivityAt: Date.now(),
};

// A pre-2026-08-23 thread -- none of the structured fields exist yet.
const LEGACY_THREAD = {
  id: "thread-4",
  projectId: "proj-1",
  symbolId: "src/legacy.ts::Old.thing",
  symbolIds: ["src/legacy.ts::Old.thing"], // server-side fromRow fallback would populate this
  developerId: "alice@example.com",
  otherDeveloperId: "dave@example.com",
  status: "open",
  systemDescription: "A thread from before the 2026-08-23 redesign.",
  openedAt: Date.now(),
  lastActivityAt: Date.now(),
};

// ThreadDetail's initiatingDesign/otherDesign links resolve via the
// on-demand GET /v1/designs/:id fetch now (useOnDemandDesigns,
// 2026-08-29), not the bulk list -- this is the mock response for that
// route, distinct from `/v1/designs?` (the list) below.
function designByIdResponse(id: string): Response {
  const design = DESIGNS_ITEMS.find((d) => d.id === id);
  return design ? new Response(JSON.stringify({ design, groupMembers: [] }), { status: 200 }) : new Response(JSON.stringify({ error: "not found" }), { status: 404 });
}

const DESIGNS_ITEMS = [
  { id: "design-alice-1", projectId: "proj-1", developerId: "alice@example.com", sessionId: "s1", status: "open", createdAt: Date.now(), summary: "Add API-key rate limiter", creates: [], touches: [], dependsOn: [], ttlMs: 1, scopeVersion: 1, lastActivityAt: Date.now(), justifiedConstraintIds: [], justifiedOverlaps: [] },
  { id: "design-bob-1", projectId: "proj-1", developerId: "bob@example.com", sessionId: "s2", status: "open", createdAt: Date.now(), summary: "Add exponential backoff to RetryPolicy", creates: [], touches: [], dependsOn: [], ttlMs: 1, scopeVersion: 1, lastActivityAt: Date.now(), justifiedConstraintIds: [], justifiedOverlaps: [] },
  { id: "design-carol-1", projectId: "proj-1", developerId: "carol@example.com", sessionId: "s3", status: "open", createdAt: Date.now(), summary: "Add session-guard throttle", creates: [], touches: [], dependsOn: [], ttlMs: 1, scopeVersion: 1, lastActivityAt: Date.now(), justifiedConstraintIds: [], justifiedOverlaps: [] },
];

describe("AlignmentThreadsView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders an empty state when there are no threads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    renderWithAuth();

    await waitFor(() => expect(screen.getByText(/no alignment threads match this filter/i)).toBeInTheDocument());
  });

  it("renders one card per thread with both parties, the short summary as its headline, and a category badge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: DESIGNS_ITEMS }), { status: 200 });
        return new Response(JSON.stringify({ items: [CLAIMS_PATH_THREAD_NO_DESIGN] }), { status: 200 });
      }),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText(CLAIMS_PATH_THREAD_NO_DESIGN.summary)).toBeInTheDocument());
    expect(screen.queryByText(CLAIMS_PATH_THREAD_NO_DESIGN.systemDescription)).not.toBeInTheDocument();
    expect(screen.getByText(/alice@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/bob@example.com/)).toBeInTheDocument();
    expect(screen.getByText("open", { selector: ".status-badge" })).toBeInTheDocument();
    expect(screen.getByText("Overlapping files", { selector: ".status-badge" })).toBeInTheDocument();
  });

  // 2026-08-26 terminology simplification: category collapsed to the two
  // bucket names ("symbol_conflict"/"llm_divergence"), subKind carries the
  // old four-way detail -- this is the shape a fresh thread carries going
  // forward, distinct from the legacy `category: "symbol_claim"`/
  // `"duplication"` fixtures used elsewhere in this file (which exercise
  // the pre-2026-08-26 fallback, still exactly as before).
  it("a new-shape thread reads its category badge from subKind, not the collapsed top-level category", async () => {
    const thread = { ...SEMANTIC_PATH_THREAD, category: "llm_divergence" as const, subKind: "contradictory_assumptions" as const };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: DESIGNS_ITEMS }), { status: 200 });
        return new Response(JSON.stringify({ items: [thread] }), { status: 200 });
      }),
    );
    renderWithAuth();

    expect(await screen.findByText("Contradiction", { selector: ".status-badge" })).toBeInTheDocument();
    expect(screen.queryByText("Duplication", { selector: ".status-badge" })).not.toBeInTheDocument();
  });

  it("a pre-redesign (legacy) thread falls back to the full systemDescription as its headline, with no category badge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: DESIGNS_ITEMS }), { status: 200 });
        return new Response(JSON.stringify({ items: [LEGACY_THREAD] }), { status: 200 });
      }),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText(LEGACY_THREAD.systemDescription)).toBeInTheDocument());
    expect(screen.queryByText("Overlapping files", { selector: ".status-badge" })).not.toBeInTheDocument();
    expect(screen.queryByText("Duplication", { selector: ".status-badge" })).not.toBeInTheDocument();
  });

  // Pagination (monitor UI load-time fix, 2026-08-29): GET /v1/alignment-threads
  // now returns {items, nextBefore} instead of the whole project's history --
  // mirrors ActivityView's/DesignsView's own "load-older" test.
  it("shows a 'Load older' button when a next page exists, and appends the next page on click", async () => {
    const user = userEvent.setup();
    const thread = (id: string, systemDescription: string) => ({
      id,
      projectId: "proj-1",
      symbolId: "",
      symbolIds: [],
      developerId: "alice@example.com",
      otherDeveloperId: "bob@example.com",
      status: "open" as const,
      systemDescription,
      openedAt: Date.now(),
      lastActivityAt: Date.now(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (!url.pathname.endsWith("/v1/alignment-threads")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        const before = url.searchParams.get("before");
        if (!before) return new Response(JSON.stringify({ items: [thread("t-new", "The newer thread")], nextBefore: 500 }), { status: 200 });
        return new Response(JSON.stringify({ items: [thread("t-old", "The older thread")] }), { status: 200 });
      }),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText("The newer thread")).toBeInTheDocument());
    expect(screen.queryByText("The older thread")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load older" }));

    await waitFor(() => expect(screen.getByText("The older thread")).toBeInTheDocument());
    expect(screen.getByText("The newer thread")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load older" })).not.toBeInTheDocument();
  });

  it("a claims-path thread with no design behind the initiating edit shows an honest note, links only the other party's design, and lists the overlapping file", async () => {
    const user = userEvent.setup();
    const onOpenDesign = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: DESIGNS_ITEMS }), { status: 200 });
        const designIdMatch = url.match(/\/v1\/designs\/([^/?]+)$/);
        if (designIdMatch) return designByIdResponse(designIdMatch[1]);
        if (url.includes("/v1/alignment-threads?")) return new Response(JSON.stringify({ items: [CLAIMS_PATH_THREAD_NO_DESIGN] }), { status: 200 });
        if (url.includes("/v1/alignment-threads/thread-1")) {
          return new Response(JSON.stringify({ thread: CLAIMS_PATH_THREAD_NO_DESIGN, messages: [] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth(onOpenDesign);

    const card = await screen.findByRole("button", { name: /overlapping path with/i });
    await user.click(card);

    expect(screen.getByText("No design registered for alice@example.com's edit.")).toBeInTheDocument();

    const link = await screen.findByRole("button", { name: /bob@example.com's design: Add exponential backoff to RetryPolicy/ });
    await user.click(link);
    expect(onOpenDesign).toHaveBeenCalledWith("design-bob-1");

    // Only one design link -- the initiating side genuinely has none.
    expect(screen.getAllByRole("button", { name: /^→/ })).toHaveLength(1);
    expect(screen.getByText("src/net/retry.ts::RetryPolicy.backoff")).toBeInTheDocument();
  });

  it("a claims-path thread whose initiating developer does have an open design links both sides and lists every accumulated overlapping path", async () => {
    const user = userEvent.setup();
    const onOpenDesign = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: DESIGNS_ITEMS }), { status: 200 });
        const designIdMatch = url.match(/\/v1\/designs\/([^/?]+)$/);
        if (designIdMatch) return designByIdResponse(designIdMatch[1]);
        if (url.includes("/v1/alignment-threads?")) return new Response(JSON.stringify({ items: [CLAIMS_PATH_THREAD_WITH_DESIGN] }), { status: 200 });
        if (url.includes("/v1/alignment-threads/thread-3")) {
          return new Response(JSON.stringify({ thread: CLAIMS_PATH_THREAD_WITH_DESIGN, messages: [] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth(onOpenDesign);

    const card = await screen.findByRole("button", { name: /overlapping paths with/i });
    await user.click(card);

    expect(await screen.findByRole("button", { name: /alice@example.com's design: Add API-key rate limiter/ })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /bob@example.com's design: Add exponential backoff to RetryPolicy/ })).toBeInTheDocument();
    expect(screen.queryByText(/No design registered/)).not.toBeInTheDocument();

    expect(screen.getByText("src/net/retry.ts::RetryPolicy.backoff")).toBeInTheDocument();
    expect(screen.getByText("src/net/retry.test.ts")).toBeInTheDocument();
  });

  // Semantic-conflict origin: both sides are always real designs.
  it("a semantic-conflict thread links both designs, shows its category, and has no overlapping-files section", async () => {
    const user = userEvent.setup();
    const onOpenDesign = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: DESIGNS_ITEMS }), { status: 200 });
        const designIdMatch = url.match(/\/v1\/designs\/([^/?]+)$/);
        if (designIdMatch) return designByIdResponse(designIdMatch[1]);
        if (url.includes("/v1/alignment-threads?")) return new Response(JSON.stringify({ items: [SEMANTIC_PATH_THREAD] }), { status: 200 });
        if (url.includes("/v1/alignment-threads/thread-2")) {
          return new Response(JSON.stringify({ thread: SEMANTIC_PATH_THREAD, messages: [] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth(onOpenDesign);

    expect(await screen.findByText("Duplication", { selector: ".status-badge" })).toBeInTheDocument();
    const card = await screen.findByRole("button", { name: /Duplicate work with/ });
    await user.click(card);

    expect(await screen.findByRole("button", { name: /alice@example.com's design: Add API-key rate limiter/ })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /carol@example.com's design: Add session-guard throttle/ })).toBeInTheDocument();
    // No raw design/symbol id shown -- there's nothing but designs to reference.
    expect(screen.queryByText("design-alice-1")).not.toBeInTheDocument();
    expect(screen.queryByText("Overlapping files")).not.toBeInTheDocument();
  });

  it("shows past messages and lets a party reply, appending the new message", async () => {
    const user = userEvent.setup();
    let replied = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: DESIGNS_ITEMS }), { status: 200 });
        if (url.includes("/v1/alignment-threads?")) return new Response(JSON.stringify({ items: [CLAIMS_PATH_THREAD_NO_DESIGN] }), { status: 200 });
        if (url.includes("/v1/alignment-threads/thread-1/messages")) {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toEqual({ message: "Let's coordinate, I'll adopt yours." });
          replied = true;
          return new Response(JSON.stringify({ message: { authorId: "alice@example.com", message: "Let's coordinate, I'll adopt yours.", ts: Date.now() } }), { status: 200 });
        }
        if (url.includes("/v1/alignment-threads/thread-1")) {
          const messages = replied
            ? [
                { authorId: "twing", message: "auto-opened", ts: Date.now() - 1000 },
                { authorId: "alice@example.com", message: "Let's coordinate, I'll adopt yours.", ts: Date.now() },
              ]
            : [{ authorId: "twing", message: "auto-opened", ts: Date.now() - 1000 }];
          return new Response(JSON.stringify({ thread: CLAIMS_PATH_THREAD_NO_DESIGN, messages }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    const card = await screen.findByRole("button", { name: /overlapping path with/i });
    await user.click(card);

    expect(await screen.findByText("auto-opened")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Message"), "Let's coordinate, I'll adopt yours.");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => expect(screen.getByText("Let's coordinate, I'll adopt yours.")).toBeInTheDocument());
  });

  it("closing a thread updates its status badge and removes the reply form", async () => {
    const user = userEvent.setup();
    let closed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: DESIGNS_ITEMS }), { status: 200 });
        if (url.includes("/close")) {
          expect(init?.method).toBe("PATCH");
          closed = true;
          return new Response(JSON.stringify({ status: "closed" }), { status: 200 });
        }
        if (url.includes("/v1/alignment-threads?")) {
          const items = [{ ...CLAIMS_PATH_THREAD_NO_DESIGN, status: closed ? "closed" : "open" }];
          return new Response(JSON.stringify({ items }), { status: 200 });
        }
        if (url.includes("/v1/alignment-threads/thread-1")) {
          return new Response(JSON.stringify({ thread: { ...CLAIMS_PATH_THREAD_NO_DESIGN, status: closed ? "closed" : "open" }, messages: [] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    const card = await screen.findByRole("button", { name: /overlapping path with/i });
    await user.click(card);
    await user.click(await screen.findByRole("button", { name: "Close thread" }));

    await waitFor(() => expect(screen.getByText("closed", { selector: ".status-badge" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Close thread" })).not.toBeInTheDocument();
  });

  // Public "observe twing getting built" demo (2026-08-28): the public-viewer
  // identity can view every thread in its one project (canViewThread's
  // isPublicViewer carve-out, app.ts) without being a party to any of them
  // -- readOnly hides the reply/close UI explicitly rather than relying on
  // "is it still open" alone, since the server would reject the POST anyway
  // but the form would otherwise still render.
  it("readOnly hides the reply form and Close thread button on an open thread, even though it still renders past messages", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: DESIGNS_ITEMS }), { status: 200 });
        if (url.includes("/v1/alignment-threads?")) return new Response(JSON.stringify({ items: [CLAIMS_PATH_THREAD_NO_DESIGN] }), { status: 200 });
        if (url.includes("/v1/alignment-threads/thread-1")) {
          return new Response(JSON.stringify({ thread: CLAIMS_PATH_THREAD_NO_DESIGN, messages: [{ authorId: "twing", message: "auto-opened", ts: Date.now() }] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
    render(
      <ServerProvider>
        <AlignmentThreadsView projectIds={["proj-1"]} projectsById={{}} readOnly />
      </ServerProvider>,
    );

    const card = await screen.findByRole("button", { name: /overlapping path with/i });
    await user.click(card);

    expect(await screen.findByText("auto-opened")).toBeInTheDocument();
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send reply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close thread" })).not.toBeInTheDocument();
  });

  it("merges threads from multiple repos and labels each card with a RepoBadge, absent for a single-repo view", async () => {
    const threadIn = (projectId: string, id: string) => ({
      id,
      projectId,
      symbolId: "src/x.ts::f",
      developerId: "alice@example.com",
      otherDeveloperId: "bob@example.com",
      designId: undefined,
      initiatingDesignId: undefined,
      status: "open" as const,
      systemDescription: `Thread in ${projectId}`,
      symbolIds: ["src/x.ts::f"],
      openedAt: Date.now(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        if (url.includes("/v1/alignment-threads?")) {
          const projectId = new URL(url).searchParams.get("projectId");
          return new Response(JSON.stringify({ items: [threadIn(projectId!, `thread-${projectId}`)] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth(undefined, ["proj-1", "proj-2"], {
      "proj-1": { projectId: "proj-1", orgId: "", role: "admin" },
      "proj-2": { projectId: "proj-2", orgId: "", role: "admin" },
    });

    await waitFor(() => expect(screen.getByText("Thread in proj-1")).toBeInTheDocument());
    expect(screen.getByText("Thread in proj-2")).toBeInTheDocument();
    expect(screen.getByText("proj-1", { selector: ".repo-badge" })).toBeInTheDocument();
    expect(screen.getByText("proj-2", { selector: ".repo-badge" })).toBeInTheDocument();
  });

  // Tightening alignment threads, item 4 (2026-08-27): the new "dormant"
  // status -- a thread whose parties have both gone quiet, distinct from
  // "closed" (deliberate) even though it shares the same calm badge tone.
  it("a dormant thread shows a 'dormant' status badge and no reply form, same as a closed one", async () => {
    const dormantThread = { ...CLAIMS_PATH_THREAD_NO_DESIGN, status: "dormant" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: DESIGNS_ITEMS }), { status: 200 });
        if (url.includes("/v1/alignment-threads/thread-1")) return new Response(JSON.stringify({ thread: dormantThread, messages: [] }), { status: 200 });
        return new Response(JSON.stringify({ items: [dormantThread] }), { status: 200 });
      }),
    );
    renderWithAuth();

    const card = await screen.findByRole("button", { name: /overlapping path with/i });
    expect(screen.getByText("dormant", { selector: ".status-badge" })).toBeInTheDocument();
    expect(screen.queryByText("open", { selector: ".status-badge" })).not.toBeInTheDocument();

    await userEvent.setup().click(card);
    expect(screen.queryByRole("button", { name: "Close thread" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send reply" })).not.toBeInTheDocument();
  });

  it("the status filter offers dormant alongside open/closed/all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    renderWithAuth();

    const select = await screen.findByLabelText("Filter by status");
    const optionValues = Array.from(select.querySelectorAll("option")).map((o) => (o as HTMLOptionElement).value);
    expect(optionValues).toEqual(["open", "dormant", "closed", "all"]);
  });
});
