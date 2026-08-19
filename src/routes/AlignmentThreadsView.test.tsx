import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { AlignmentThreadsView } from "./AlignmentThreadsView.js";

function renderWithAuth(onOpenDesign?: (designId: string) => void) {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <AlignmentThreadsView projectId="proj-1" onOpenDesign={onOpenDesign} />
    </ServerProvider>,
  );
}

const CLAIMS_PATH_THREAD = {
  id: "thread-1",
  projectId: "proj-1",
  symbolId: "src/net/retry.ts::RetryPolicy.backoff",
  developerId: "alice@example.com",
  otherDeveloperId: "bob@example.com",
  designId: "design-bob-1",
  status: "open",
  systemDescription: "Both sessions touched RetryPolicy.backoff within the same window.",
  openedAt: Date.now(),
};

// A design_semantic_conflict-originated thread (runSemanticComparatorPass,
// packages/server/src/app.ts): unlike the claims path above, symbolId here
// is repurposed to hold the *initiating* design's own id -- both sides name
// a real design.
const SEMANTIC_PATH_THREAD = {
  id: "thread-2",
  projectId: "proj-1",
  symbolId: "design-alice-1",
  developerId: "alice@example.com",
  otherDeveloperId: "carol@example.com",
  designId: "design-carol-1",
  status: "open",
  systemDescription: "Both plans independently build a sliding-window rate limiter.",
  openedAt: Date.now(),
};

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

  it("renders one card per thread with both parties and the system description as its headline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: DESIGNS_ITEMS }), { status: 200 });
        return new Response(JSON.stringify({ items: [CLAIMS_PATH_THREAD] }), { status: 200 });
      }),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText("Both sessions touched RetryPolicy.backoff within the same window.")).toBeInTheDocument());
    expect(screen.getByText(/alice@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/bob@example.com/)).toBeInTheDocument();
    expect(screen.getByText("open", { selector: ".status-badge" })).toBeInTheDocument();
  });

  // Claims-path origin: only the *other* party's design is a real design --
  // the triggering side is a raw claim, so it should render as a code
  // symbol, not a fabricated design link.
  it("a claims-path thread links only the other party's design, and shows the triggering symbol as code", async () => {
    const user = userEvent.setup();
    const onOpenDesign = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: DESIGNS_ITEMS }), { status: 200 });
        if (url.includes("/v1/alignment-threads?")) return new Response(JSON.stringify({ items: [CLAIMS_PATH_THREAD] }), { status: 200 });
        if (url.includes("/v1/alignment-threads/thread-1")) {
          return new Response(JSON.stringify({ thread: CLAIMS_PATH_THREAD, messages: [] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth(onOpenDesign);

    const card = await screen.findByRole("button", { name: /Both sessions touched RetryPolicy\.backoff/ });
    await user.click(card);

    const link = await screen.findByRole("button", { name: /Add exponential backoff to RetryPolicy/ });
    await user.click(link);
    expect(onOpenDesign).toHaveBeenCalledWith("design-bob-1");

    expect(screen.getByText("src/net/retry.ts::RetryPolicy.backoff")).toBeInTheDocument();
    // Only one design link -- the initiating side wasn't a registered design.
    expect(screen.getAllByRole("button", { name: /^→/ })).toHaveLength(1);
  });

  // Semantic-conflict origin: both sides are real designs, so both should
  // link -- this is the concrete fix for "link both designs."
  it("a semantic-conflict thread links both designs", async () => {
    const user = userEvent.setup();
    const onOpenDesign = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: DESIGNS_ITEMS }), { status: 200 });
        if (url.includes("/v1/alignment-threads?")) return new Response(JSON.stringify({ items: [SEMANTIC_PATH_THREAD] }), { status: 200 });
        if (url.includes("/v1/alignment-threads/thread-2")) {
          return new Response(JSON.stringify({ thread: SEMANTIC_PATH_THREAD, messages: [] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth(onOpenDesign);

    const card = await screen.findByRole("button", { name: /Both plans independently build a sliding-window rate limiter/ });
    await user.click(card);

    expect(await screen.findByRole("button", { name: /Add API-key rate limiter/ })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Add session-guard throttle/ })).toBeInTheDocument();
    // No raw symbol id shown -- there's nothing but designs to reference.
    expect(screen.queryByText("design-alice-1")).not.toBeInTheDocument();
  });

  it("shows past messages and lets a party reply, appending the new message", async () => {
    const user = userEvent.setup();
    let replied = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/v1/designs?")) return new Response(JSON.stringify({ items: DESIGNS_ITEMS }), { status: 200 });
        if (url.includes("/v1/alignment-threads?")) return new Response(JSON.stringify({ items: [CLAIMS_PATH_THREAD] }), { status: 200 });
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
          return new Response(JSON.stringify({ thread: CLAIMS_PATH_THREAD, messages }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    const card = await screen.findByRole("button", { name: /Both sessions touched RetryPolicy\.backoff/ });
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
          const items = [{ ...CLAIMS_PATH_THREAD, status: closed ? "closed" : "open" }];
          return new Response(JSON.stringify({ items }), { status: 200 });
        }
        if (url.includes("/v1/alignment-threads/thread-1")) {
          return new Response(JSON.stringify({ thread: { ...CLAIMS_PATH_THREAD, status: closed ? "closed" : "open" }, messages: [] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    const card = await screen.findByRole("button", { name: /Both sessions touched RetryPolicy\.backoff/ });
    await user.click(card);
    await user.click(await screen.findByRole("button", { name: "Close thread" }));

    await waitFor(() => expect(screen.getByText("closed", { selector: ".status-badge" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Close thread" })).not.toBeInTheDocument();
  });
});
