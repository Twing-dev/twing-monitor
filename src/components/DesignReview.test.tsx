import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { DesignReview, HighlightableText } from "./DesignReview.js";
import type { DesignComment, DesignCommentReply, DesignStatement } from "../api/types.js";

const design: DesignStatement = {
  id: "design-1",
  projectId: "proj-1",
  developerId: "bob@example.com",
  sessionId: "sess-1",
  status: "open",
  createdAt: Date.now(),
  summary: "Add a retry budget to the HTTP client, capped at 30s.",
  creates: [],
  touches: ["src/net/retry.ts"],
  dependsOn: [],
  ttlMs: 1000,
  lastActivityAt: Date.now(),
  scopeVersion: 2,
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
    anchor: { field: "summary", quote: "capped at 30s", prefix: "HTTP client, " },
    designVersion: 2,
    status: "open",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    canResolve: true,
    ...overrides,
  };
}

type Call = { url: string; method: string; body?: string };

/** Stubs `GET /v1/designs/:id/comments` and records every other request.
 * `post` answers the comment POST, so a test can make it fail. */
function stubReview(items: DesignComment[], replies: Record<string, DesignCommentReply[]> = {}, post?: () => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.includes("/comments") && method === "GET") return new Response(JSON.stringify({ items, replies }), { status: 200 });
      if (url.endsWith("/comments") && method === "POST" && post) return post();
      return new Response(JSON.stringify({ comment: items[0] ?? null }), { status: 200 });
    }),
  );
  return calls;
}

function renderReview(options: { readOnly?: boolean; design?: DesignStatement } = {}) {
  const d = options.design ?? design;
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <DesignReview designs={[d]} readOnly={options.readOnly}>
        <p data-testid="summary">
          <HighlightableText designId={d.id} field="summary" text={d.summary} />
        </p>
        <p data-testid="outside">not part of the design</p>
      </DesignReview>
    </ServerProvider>,
  );
}

/** Selects `text` inside `element` the way a reader dragging over it would,
 * then releases -- which is what makes the review read the selection. */
function selectText(element: HTMLElement, text: string) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.textContent?.indexOf(text) ?? -1;
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + text.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.mouseUp(element);
    return;
  }
  throw new Error(`"${text}" not found`);
}

describe("DesignReview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.getSelection()?.removeAllRanges();
  });

  it("explains how to comment when a design has none, and who answers", async () => {
    stubReview([]);
    renderReview();
    expect(await screen.findByText(/No comments yet/)).toBeInTheDocument();
    expect(screen.getByText(/Highlight any part of the design/)).toBeInTheDocument();
    expect(screen.getByText(/Its developer is told in their coding session, and answers here/)).toBeInTheDocument();
  });

  it("highlights an open comment's words in the design and shows them on its card", async () => {
    stubReview([comment()]);
    renderReview();
    const mark = await waitFor(() => {
      const found = screen.getByTestId("summary").querySelector("mark");
      expect(found).not.toBeNull();
      return found!;
    });
    expect(mark.textContent).toBe("capped at 30s");
    expect(screen.getByText("why 30s and not 10s?")).toBeInTheDocument();
    expect(screen.getByText("in the overview")).toBeInTheDocument();
  });

  // The design moved on. Losing the anchor must never lose the question.
  it("keeps a comment whose words are gone, marked outdated, highlighting nothing", async () => {
    stubReview([comment({ anchor: { field: "summary", quote: "capped at 10s" } })]);
    renderReview();
    expect(await screen.findByText("outdated")).toBeInTheDocument();
    expect(screen.getByText("capped at 10s")).toBeInTheDocument();
    expect(screen.getByTestId("summary").querySelector("mark")).toBeNull();
  });

  it("says when the design was edited after the comment -- the edit may be the answer", async () => {
    stubReview([comment({ designVersion: 1 })]);
    renderReview();
    expect(await screen.findByText(/design changed since this comment/)).toBeInTheDocument();
  });

  it("offers Comment on a highlight, and posts the words with their context", async () => {
    const user = userEvent.setup();
    const calls = stubReview([]);
    renderReview();
    await screen.findByText(/No comments yet/);

    selectText(screen.getByTestId("summary"), "retry budget");
    await user.click(await screen.findByRole("button", { name: "Comment" }));
    await user.type(screen.getByLabelText("Your comment"), "per host or global?");
    await user.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toContain("/v1/designs/design-1/comments");
    expect(JSON.parse(post.body!)).toEqual({
      body: "per host or global?",
      anchor: { field: "summary", quote: "retry budget", prefix: "Add a ", suffix: " to the HTTP client, capped at 30s." },
    });
  });

  it("offers nothing for a selection outside the design's text", async () => {
    stubReview([]);
    renderReview();
    await screen.findByText(/No comments yet/);
    selectText(screen.getByTestId("outside"), "not part");
    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
  });

  it("can comment on the design as a whole, with no anchor", async () => {
    const user = userEvent.setup();
    const calls = stubReview([]);
    renderReview();
    await user.click(await screen.findByRole("button", { name: "Comment on the whole design" }));
    await user.type(screen.getByLabelText("Your comment"), "is this the right approach?");
    await user.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === "POST")!.body!)).toEqual({ body: "is this the right approach?" });
  });

  // An agent amended the design while the reviewer was reading it.
  it("shows the coordinator's reason when the highlighted words have just gone", async () => {
    const user = userEvent.setup();
    stubReview([], {}, () => new Response(JSON.stringify({ error: "the design has changed since you highlighted that -- reload it and highlight again" }), { status: 409 }));
    renderReview();
    await screen.findByText(/No comments yet/);
    selectText(screen.getByTestId("summary"), "retry budget");
    await user.click(await screen.findByRole("button", { name: "Comment" }));
    await user.type(screen.getByLabelText("Your comment"), "?");
    await user.click(screen.getByRole("button", { name: "Comment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/reload it and highlight again/);
  });

  it("offers Resolve only to whoever may close the comment, and names them otherwise", async () => {
    stubReview([comment({ canResolve: false })]);
    renderReview();
    expect(await screen.findByText(/alice@example.com resolves this one/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();
  });

  it("resolves when the asker presses Resolve", async () => {
    const user = userEvent.setup();
    const calls = stubReview([comment()]);
    renderReview();
    await user.click(await screen.findByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/v1/comments/cm1/resolve") && c.method === "POST")).toBe(true));
  });

  it("shows replies under the comment, and posts a reply", async () => {
    const user = userEvent.setup();
    const calls = stubReview([comment()], { cm1: [{ commentId: "cm1", authorId: "bob@example.com", message: "30s matches the gateway", ts: Date.now() }] });
    renderReview();
    expect(await screen.findByText("30s matches the gateway")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Reply to this comment"), "makes sense");
    await user.click(screen.getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/v1/comments/cm1/replies") && c.body === JSON.stringify({ message: "makes sense" }))).toBe(true));
  });

  it("tucks resolved comments away and stops highlighting them", async () => {
    const user = userEvent.setup();
    stubReview([comment({ status: "resolved", resolvedBy: "alice@example.com" })]);
    renderReview();
    const toggle = await screen.findByRole("button", { name: /Show 1 resolved/ });
    expect(screen.getByTestId("summary").querySelector("mark")).toBeNull();
    expect(screen.queryByText("why 30s and not 10s?")).toBeNull();
    await user.click(toggle);
    expect(screen.getByText(/Resolved by alice@example.com/)).toBeInTheDocument();
  });

  // The public /observe viewer reads the whole review and writes none of it.
  it("read-only: shows highlights and comments, offers no way to write", async () => {
    stubReview([comment()]);
    renderReview({ readOnly: true });
    expect(await screen.findByText("why 30s and not 10s?")).toBeInTheDocument();
    expect(screen.getByTestId("summary").querySelector("mark")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Comment on the whole design" })).toBeNull();
    expect(screen.queryByLabelText("Reply to this comment")).toBeNull();
    expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();

    selectText(screen.getByTestId("summary"), "retry budget");
    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
  });

  // Comments are additive: failing to load them must never cost a reviewer
  // the design itself.
  it("still renders the design when the comments cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    renderReview();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("summary")).toHaveTextContent(design.summary);
  });
});
