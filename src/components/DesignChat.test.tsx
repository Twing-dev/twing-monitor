import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { DesignChat } from "./DesignChat.js";
import type { DesignChatMessage, DesignStatement } from "../api/types.js";

const design: DesignStatement = {
  id: "design-1",
  projectId: "proj-1",
  developerId: "bob@example.com",
  sessionId: "7f3a1c42-9e21-4b6d-8a55-0c1e2d3f4a5b",
  status: "open",
  createdAt: Date.now(),
  summary: "Add a retry budget to the HTTP client",
  creates: [],
  touches: ["src/net/retry.ts"],
  dependsOn: [],
  ttlMs: 1000,
  lastActivityAt: Date.now(),
  scopeVersion: 1,
  justifiedConstraintIds: [],
  justifiedOverlaps: [],
  justifiedConflicts: [],
  justifiedSymbolConflicts: [],
};

/** Stubs both chat routes and records every request, so a test can assert
 * what was rendered and what was sent. */
function stubChat(initial: DesignChatMessage[], answer?: { answer: string; provenance?: string; messages: DesignChatMessage[] }) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url: String(input), method, body: typeof init?.body === "string" ? init.body : undefined });
      if (method === "GET") return new Response(JSON.stringify({ messages: initial }), { status: 200 });
      return new Response(JSON.stringify(answer ?? { answer: "ok", messages: initial }), { status: 200 });
    }),
  );
  return calls;
}

function renderChat(readOnly?: boolean) {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <DesignChat design={design} readOnly={readOnly} />
    </ServerProvider>,
  );
}

describe("DesignChat", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("explains what the chat is grounded in, and that nobody else can see it", async () => {
    stubChat([]);
    renderChat();
    await waitFor(() => expect(screen.getByText(/grounded in the session that produced this design/i)).toBeInTheDocument());
    // A reviewer who thinks their half-formed question is public will not ask
    // it, which defeats the whole surface.
    expect(screen.getByText(/nobody else sees this thread/i)).toBeInTheDocument();
    expect(screen.getByText(/private to you/i)).toBeInTheDocument();
  });

  it("points at the discussion for feedback the developer should actually see", async () => {
    stubChat([]);
    renderChat();
    await waitFor(() => expect(screen.getByText(/use the discussion above/i)).toBeInTheDocument());
  });

  it("renders a conversation, attributing each turn", async () => {
    stubChat([
      { role: "reviewer", message: "why 30s?", ts: Date.now() },
      { role: "agent", message: "the upstream gateway gives up at 31s", ts: Date.now() },
    ]);
    renderChat();
    await waitFor(() => expect(screen.getByText(/gives up at 31s/i)).toBeInTheDocument());
    expect(screen.getByText("you")).toBeInTheDocument();
    expect(screen.getByText("agent")).toBeInTheDocument();
  });

  // An answer grounded in 200 turns and one answered from the design alone
  // read identically otherwise, and a reviewer who cannot tell them apart
  // will trust both equally.
  it("shows what each answer was grounded in", async () => {
    stubChat([
      { role: "reviewer", message: "why 30s?", ts: Date.now() },
      { role: "agent", message: "because of the gateway", ts: Date.now(), provenance: "Grounded in 32 of 138 turns from session 7f3a1c42. Touched 1 of 1 declared file." },
    ]);
    renderChat();
    await waitFor(() => expect(screen.getByText(/Grounded in 32 of 138 turns/)).toBeInTheDocument());
  });

  it("says plainly when an answer had no session behind it", async () => {
    stubChat([
      { role: "reviewer", message: "why?", ts: Date.now() },
      { role: "agent", message: "the design does not say", ts: Date.now(), provenance: "Answered from the design alone — this repository has not opted into session capture." },
    ]);
    renderChat();
    await waitFor(() => expect(screen.getByText(/has not opted into session capture/i)).toBeInTheDocument());
  });

  it("sends the question and renders the answer that comes back", async () => {
    const calls = stubChat([], {
      answer: "because the gateway times out at 31s",
      provenance: "Grounded in 12 of 40 turns from session 7f3a1c42.",
      messages: [
        { role: "reviewer", message: "why 30s?", ts: Date.now() },
        { role: "agent", message: "because the gateway times out at 31s", ts: Date.now(), provenance: "Grounded in 12 of 40 turns from session 7f3a1c42." },
      ],
    });
    renderChat();
    await waitFor(() => expect(screen.getByLabelText(/your question/i)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/your question/i), "why 30s?");
    await userEvent.click(screen.getByRole("button", { name: /^ask$/i }));

    await waitFor(() => expect(screen.getByText(/times out at 31s/i)).toBeInTheDocument());
    const post = calls.find((c) => c.method === "POST");
    expect(JSON.parse(post!.body!)).toEqual({ message: "why 30s?" });
  });

  it("shows the reviewer's own question immediately, not after the model answers", async () => {
    let release: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ messages: [] }), { status: 200 });
        await new Promise<void>((resolve) => (release = resolve));
        return new Response(JSON.stringify({ answer: "later", messages: [] }), { status: 200 });
      }),
    );
    renderChat();
    await waitFor(() => expect(screen.getByLabelText(/your question/i)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/your question/i), "why 30s?");
    await userEvent.click(screen.getByRole("button", { name: /^ask$/i }));

    // Mid-flight: the question is on screen and the panel says it is working.
    await waitFor(() => expect(screen.getByText("why 30s?")).toBeInTheDocument());
    expect(screen.getByText(/reading the session/i)).toBeInTheDocument();
    release?.();
  });

  // Retyping a question is the one thing that would make a reviewer stop
  // using this.
  it("puts the question back in the box when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ messages: [] }), { status: 200 });
        return new Response(JSON.stringify({ error: "coordinator unreachable" }), { status: 502 });
      }),
    );
    renderChat();
    await waitFor(() => expect(screen.getByLabelText(/your question/i)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/your question/i), "why 30s?");
    await userEvent.click(screen.getByRole("button", { name: /^ask$/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/coordinator unreachable/i));
    expect(screen.getByLabelText(/your question/i)).toHaveValue("why 30s?");
    // And the optimistic turn is gone: the server has no record of it, so
    // leaving it on screen would show a conversation that does not exist.
    expect(screen.queryByText("you")).not.toBeInTheDocument();
  });

  it("offers no prompt to the read-only public viewer", async () => {
    stubChat([{ role: "agent", message: "an existing answer", ts: Date.now() }]);
    renderChat(true);
    await waitFor(() => expect(screen.getByText(/an existing answer/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/your question/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^ask$/i })).not.toBeInTheDocument();
  });

  // This panel is mounted inside the expanded design, so a throw here would
  // cost the reviewer the design itself.
  it("degrades to an empty chat rather than throwing on an unexpected response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 })));
    renderChat();
    await waitFor(() => expect(screen.getByText(/ask why it was built this way/i)).toBeInTheDocument());
  });

  it("surfaces a failed load instead of a permanent spinner", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "not a member of this project" }), { status: 403 })));
    renderChat();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/not a member of this project/i));
  });
});
