import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { DesignComments } from "./DesignComments.js";
import type { DesignComment, DesignCommentReply, DesignStatement } from "../api/types.js";

const design: DesignStatement = {
  id: "design-1",
  projectId: "proj-1",
  developerId: "bob@example.com",
  sessionId: "sess-1",
  status: "open",
  createdAt: Date.now(),
  summary: "Add a retry budget to the HTTP client",
  creates: [],
  touches: ["src/net/retry.ts"],
  dependsOn: [],
  changes: [{ id: "c1", action: "modify", target: "src/net/retry.ts::RetryPolicy.backoff", intent: "cap exponential growth at 30s" }],
  ttlMs: 1000,
  lastActivityAt: Date.now(),
  scopeVersion: 1,
  justifiedConstraintIds: [],
  justifiedOverlaps: [],
  justifiedConflicts: [],
  justifiedSymbolConflicts: [],
};

function comment(overrides: Partial<DesignComment> = {}): DesignComment {
  return {
    id: "cm1",
    projectId: "proj-1",
    designId: "design-1",
    authorId: "alice@example.com",
    body: "why 30s and not 10s?",
    status: "answered",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    // The server decides who may close a comment; default the fixtures to
    // "yours" so the existing cases still exercise the control, and the
    // tests below override it to cover the other side.
    canResolve: true,
    ...overrides,
  };
}

function reply(overrides: Partial<DesignCommentReply> = {}): DesignCommentReply {
  return { commentId: "cm1", authorKind: "agent", message: "30s matches the upstream gateway timeout.", ts: Date.now(), ...overrides };
}

/** Stubs `GET /v1/designs/:id/comments` and records every other request, so a
 * test can assert both what was rendered and what was (or was not) sent. */
function stubComments(items: DesignComment[], replies: Record<string, DesignCommentReply[]> = {}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
      if (url.includes("/comments") && (init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ items, replies }), { status: 200 });
      }
      return new Response(JSON.stringify({ comment: items[0] ?? null }), { status: 200 });
    }),
  );
  return calls;
}

function renderComments(readOnly?: boolean) {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <DesignComments design={design} readOnly={readOnly} />
    </ServerProvider>,
  );
}

describe("DesignComments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("invites a comment when a design has none, naming what the channel actually does", async () => {
    stubComments([]);
    renderComments();
    await waitFor(() => expect(screen.getByText(/the agent answers first/i)).toBeInTheDocument());
  });

  // The four states, which are the whole product surface here.
  it("shows an unanswered comment as still being answered", async () => {
    stubComments([comment({ status: "open" })]);
    renderComments();
    await waitFor(() => expect(screen.getByText(/the agent is answering/i)).toBeInTheDocument());
  });

  it("shows the agent's answer alongside the question", async () => {
    stubComments([comment()], { cm1: [reply()] });
    renderComments();
    await waitFor(() => expect(screen.getByText(/upstream gateway timeout/i)).toBeInTheDocument());
    expect(screen.getByText(/answered by the agent/i)).toBeInTheDocument();
  });

  it("shows an escalated comment as waiting on the design's owner, by name", async () => {
    stubComments([comment({ status: "escalated" })]);
    renderComments();
    await waitFor(() => expect(screen.getByText(/waiting on the developer/i)).toBeInTheDocument());
    // "Waiting" with no name is the state where everyone assumes somebody
    // else is dealing with it.
    expect(screen.getByText(/bob@example\.com/)).toBeInTheDocument();
  });

  it("says the escalation will not interrupt the developer before their next session", async () => {
    stubComments([comment({ status: "escalated" })]);
    renderComments();
    await waitFor(() => expect(screen.getByText(/won't interrupt them/i)).toBeInTheDocument());
  });

  it("reports when the owner has read an escalation", async () => {
    stubComments([comment({ status: "escalated", acknowledgedAt: Date.now() })]);
    renderComments();
    await waitFor(() => expect(screen.getByText(/has read this/i)).toBeInTheDocument());
  });

  it("offers no decision buttons on a resolved comment", async () => {
    stubComments([comment({ status: "resolved" })]);
    renderComments();
    await waitFor(() => expect(screen.getByText(/^resolved$/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /needs the developer/i })).not.toBeInTheDocument();
  });

  // The agent recommends; a person decides. The recommendation is surfaced
  // (it is the reviewer's best evidence) but nothing acts on it.
  it("surfaces the agent's escalation recommendation without escalating", async () => {
    stubComments([comment()], { cm1: [reply({ message: "[needs a human] the design does not state the author's intent" })] });
    renderComments();
    await waitFor(() => expect(screen.getByText(/does not state the author's intent/i)).toBeInTheDocument());
    // Stripped of its marker for display, and the comment is still merely
    // answered -- the reviewer has to press the button.
    expect(screen.queryByText(/\[needs a human\]/)).not.toBeInTheDocument();
    expect(screen.getByText(/answered by the agent/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /needs the developer/i })).toBeInTheDocument();
  });

  it("escalates only when the reviewer presses the button", async () => {
    const calls = stubComments([comment()], { cm1: [reply()] });
    renderComments();
    await waitFor(() => expect(screen.getByRole("button", { name: /needs the developer/i })).toBeInTheDocument());
    expect(calls.some((c) => c.url.includes("/escalate"))).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: /needs the developer/i }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/escalate") && c.method === "POST")).toBe(true));
  });

  it("posts a new comment, anchored to a declared change when one is picked", async () => {
    const calls = stubComments([]);
    renderComments();
    await waitFor(() => expect(screen.getByLabelText(/add a comment/i)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/add a comment/i), "is 30s right?");
    await userEvent.selectOptions(screen.getByLabelText(/which change is this about/i), "c1");
    await userEvent.click(screen.getByRole("button", { name: /^comment$/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/comments"));
      expect(post).toBeDefined();
      expect(JSON.parse(post!.body!)).toEqual({ body: "is 30s right?", targetChangeId: "c1" });
    });
  });

  it("shows the declared change a comment was left against", async () => {
    stubComments([comment({ targetChangeId: "c1" })]);
    renderComments();
    await waitFor(() => expect(screen.getByText("RetryPolicy.backoff")).toBeInTheDocument());
  });

  // An amendment can drop the change a comment was anchored to. Losing the
  // anchor must never lose the question.
  it("still shows a comment whose anchored change no longer exists", async () => {
    stubComments([comment({ targetChangeId: "gone" })]);
    renderComments();
    await waitFor(() => expect(screen.getByText(/why 30s and not 10s/i)).toBeInTheDocument());
  });

  // The public /observe viewer reads the whole discussion and writes none of
  // it. The server rejects these writes regardless; hiding the controls is
  // the UX nicety of not showing a dead-end form.
  it("hides every control from the read-only public viewer but keeps the discussion", async () => {
    stubComments([comment()], { cm1: [reply()] });
    renderComments(true);
    await waitFor(() => expect(screen.getByText(/why 30s and not 10s/i)).toBeInTheDocument());
    expect(screen.getByText(/upstream gateway timeout/i)).toBeInTheDocument();

    expect(screen.queryByLabelText(/add a comment/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /needs the developer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^resolved$/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/reply to this comment/i)).not.toBeInTheDocument();
  });

  it("offers no change picker for a design registered without a structured template", async () => {
    stubComments([]);
    saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
    render(
      <ServerProvider>
        <DesignComments design={{ ...design, changes: undefined }} />
      </ServerProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText(/add a comment/i)).toBeInTheDocument());
    // An empty dropdown is worse than no dropdown.
    expect(screen.queryByLabelText(/which change is this about/i)).not.toBeInTheDocument();
  });

  // Found in review: polling stopped once nothing was `open`, so a panel left
  // open never saw the design owner's CLI reply, their acknowledgement, or
  // another reviewer's comment -- which is precisely the conversation this
  // feature exists to carry.
  it("keeps refreshing a settled discussion, so a reply from the CLI shows up", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let replies: DesignCommentReply[] = [];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [comment()], replies: { cm1: replies } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    renderComments();
    // Nothing is `open` here -- the comment is already `answered`, which is
    // exactly the state the old code stopped polling in.
    await waitFor(() => expect(screen.getByText(/why 30s and not 10s/i)).toBeInTheDocument());

    replies = [reply({ authorKind: "human", authorId: "bob@example.com", message: "because the gateway times out at 30" })];
    await vi.advanceTimersByTimeAsync(21000);

    await waitFor(() => expect(screen.getByText(/because the gateway times out at 30/i)).toBeInTheDocument());
  });

  it("surfaces a failed request instead of silently dropping the comment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "not a member of this project" }), { status: 403 })),
    );
    renderComments();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/not a member of this project/i));
  });
});

// Membership used to be the only check, so any project member saw a Resolve
// button on everyone's comments -- including the design's own author, on a
// question about their own design.
describe("DesignComments resolve permission", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers Resolved to the reviewer whose question it is", async () => {
    stubComments([comment({ canResolve: true })], { cm1: [reply()] });
    renderComments();
    await waitFor(() => expect(screen.getByRole("button", { name: /^resolved$/i })).toBeInTheDocument());
  });

  it("hides it from everyone else, and says whose call it is", async () => {
    stubComments([comment({ canResolve: false, authorId: "reviewer@example.com" })], { cm1: [reply()] });
    renderComments();
    await waitFor(() => expect(screen.getByText(/why 30s and not 10s/i)).toBeInTheDocument());

    expect(screen.queryByRole("button", { name: /^resolved$/i })).not.toBeInTheDocument();
    // A missing control with no explanation is the worst way to answer
    // "why can't I close this?".
    expect(screen.getByText(/reviewer@example\.com closes this one/i)).toBeInTheDocument();
  });

  // A hidden button on an older coordinator is a better failure than one
  // that 403s on click.
  it("treats a coordinator that does not say as 'not yours'", async () => {
    stubComments([comment({ canResolve: undefined })], { cm1: [reply()] });
    renderComments();
    await waitFor(() => expect(screen.getByText(/why 30s and not 10s/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^resolved$/i })).not.toBeInTheDocument();
  });

  // Escalating is not the same act: anyone reviewing can say this needs the
  // developer, only the asker can say it is settled.
  it("still offers Needs the developer to someone who cannot close it", async () => {
    stubComments([comment({ canResolve: false })], { cm1: [reply()] });
    renderComments();
    await waitFor(() => expect(screen.getByRole("button", { name: /needs the developer/i })).toBeInTheDocument());
  });
});
