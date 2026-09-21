import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { ConflictsView } from "./ConflictsView.js";
import type { ProjectSummary } from "../api/types.js";

/** Every test below must branch its fetch mock on URL -- unlike the old
 * single-source ReviewsView/AlignmentThreadsView tests, ConflictsView always
 * fetches *both* /v1/reviews and /v1/alignment-threads in parallel, so a
 * catch-all mock would return the same payload for both and produce a
 * spurious extra item. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function emptyReviews() {
  return jsonResponse({ items: [] });
}
function emptyThreads() {
  return jsonResponse({ items: [] });
}

function renderWithAuth(opts: {
  projectIds?: string[];
  projectsById?: Record<string, ProjectSummary>;
  onOpenDesign?: (designId: string) => void;
  focusConflictId?: string;
  readOnly?: boolean;
} = {}) {
  const { projectIds = ["proj-1"], projectsById = { "proj-1": { projectId: "proj-1", orgId: "", role: "admin" } }, onOpenDesign, focusConflictId, readOnly } = opts;
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <ConflictsView projectIds={projectIds} projectsById={projectsById} onOpenDesign={onOpenDesign} focusConflictId={focusConflictId} readOnly={readOnly} />
    </ServerProvider>,
  );
}

async function openFirstCard() {
  const user = userEvent.setup();
  const toggles = await screen.findAllByRole("button", { expanded: false });
  await user.click(toggles[0]);
  return user;
}

const PENDING_REVIEW = {
  id: "review-1",
  designId: "design-1",
  projectId: "proj-1",
  justification: "Overlaps an approved sibling design, same touched path",
  createdAt: Date.now(),
};

const ENRICHED_REVIEW = {
  ...PENDING_REVIEW,
  constraintIds: ["c-1"],
  design: {
    summary: "add retry with exponential backoff to the webhook client",
    creates: ["src/net/retry.ts"],
    touches: ["src/billing/charge.ts"],
    developerId: "priya@team.dev",
    status: "flagged",
  },
  constraints: [{ id: "c-1", statement: "money paths need a second pair of eyes", type: "review_required" }],
  conflicts: [
    { designId: "design-2", kind: "overlap" as const, summary: "billing retry work", developerId: "ayush@team.dev", paths: ["src/billing/charge.ts"] },
  ],
};

const OPEN_THREAD = {
  id: "thread-1",
  projectId: "proj-1",
  symbolId: "src/net/retry.ts::RetryPolicy.backoff",
  symbolIds: ["src/net/retry.ts::RetryPolicy.backoff"],
  developerId: "alice@example.com",
  otherDeveloperId: "bob@example.com",
  status: "open" as const,
  systemDescription: "Both sessions touched RetryPolicy.backoff within the same window.",
  summary: '1 overlapping path with "Add exponential backoff to RetryPolicy"',
  category: "symbol_conflict" as const,
  subKind: "real_edit_collision" as const,
  openedAt: Date.now(),
  lastActivityAt: Date.now(),
};

const LEGACY_THREAD = {
  id: "thread-legacy",
  projectId: "proj-1",
  symbolId: "src/legacy.ts::Old.thing",
  symbolIds: ["src/legacy.ts::Old.thing"],
  developerId: "alice@example.com",
  otherDeveloperId: "dave@example.com",
  status: "open" as const,
  systemDescription: "A thread from before the 2026-08-23 redesign.",
  category: "symbol_claim" as const, // pre-2026-08-26 raw value
  openedAt: Date.now(),
  lastActivityAt: Date.now(),
};

describe("ConflictsView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders an empty state when there's nothing to show", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/reviews?")) return emptyReviews();
        if (url.includes("/v1/alignment-threads?")) return emptyThreads();
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText(/no conflicts match this filter/i)).toBeInTheDocument());
  });

  it("renders a review card with a pending badge alongside a thread card, merged into one list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/reviews?")) return jsonResponse({ items: [PENDING_REVIEW] });
        if (url.includes("/v1/alignment-threads?")) return jsonResponse({ items: [OPEN_THREAD] });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText("Overlaps an approved sibling design, same touched path")).toBeInTheDocument());
    expect(screen.getByText("pending", { selector: ".status-badge" })).toBeInTheDocument();
    expect(screen.getByText(OPEN_THREAD.summary)).toBeInTheDocument();
    // The thread's real_edit_collision subKind resolves to the shared
    // "Edits collide" bucket label, same vocabulary a review's "Collides
    // with" band or a Designs-tab badge would use for the same conflict.
    expect(screen.getByText("Edits collide", { selector: ".status-badge" })).toBeInTheDocument();
  });

  it("shows the coordinator's own specific conflict reason when a thread is expanded, even though it also has a summary", async () => {
    // OPEN_THREAD has both `summary` (short list-view label) and
    // `systemDescription` (the coordinator's specific finding text) set --
    // this asserts the latter isn't silently dropped just because the
    // former exists.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/reviews?")) return emptyReviews();
        if (url.includes("/v1/alignment-threads?")) return jsonResponse({ items: [OPEN_THREAD] });
        if (url.includes("/v1/alignment-threads/thread-1")) return jsonResponse({ thread: OPEN_THREAD, messages: [] });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderWithAuth();

    const card = await screen.findByRole("button", { name: /overlapping path with/i });
    await user.click(card);

    expect(await screen.findByText("Why this conflict")).toBeInTheDocument();
    expect(screen.getByText(OPEN_THREAD.systemDescription)).toBeInTheDocument();
  });

  it("a pre-2026-08-26 legacy-category thread still resolves a conflict badge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/reviews?")) return emptyReviews();
        if (url.includes("/v1/alignment-threads?")) return jsonResponse({ items: [LEGACY_THREAD] });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    // symbol_claim (legacy) resolves to the symbol_conflict bucket -> "Edits collide".
    expect(await screen.findByText("Edits collide", { selector: ".status-badge" })).toBeInTheDocument();
  });

  it("filter chips isolate each stage, with counts", async () => {
    const decidedReview = { ...PENDING_REVIEW, id: "review-decided", justification: "Already decided", decision: "approve" as const };
    const closedThread = { ...OPEN_THREAD, id: "thread-closed", status: "closed" as const, summary: "A closed thread" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/reviews?")) return jsonResponse({ items: [PENDING_REVIEW, decidedReview] });
        if (url.includes("/v1/alignment-threads?")) return jsonResponse({ items: [OPEN_THREAD, closedThread] });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderWithAuth();

    await waitFor(() => expect(screen.getByText("All (4)")).toBeInTheDocument());
    expect(screen.getByText("Open discussion (1)")).toBeInTheDocument();
    expect(screen.getByText("Awaiting approval (1)")).toBeInTheDocument();
    expect(screen.getByText("Resolved (2)")).toBeInTheDocument();

    await user.click(screen.getByText("Awaiting approval (1)"));
    expect(screen.getByText("Overlaps an approved sibling design, same touched path")).toBeInTheDocument();
    expect(screen.queryByText("Already decided")).not.toBeInTheDocument();
    expect(screen.queryByText(OPEN_THREAD.summary)).not.toBeInTheDocument();

    await user.click(screen.getByText("Resolved (2)"));
    expect(screen.getByText("Already decided")).toBeInTheDocument();
    expect(screen.getByText("A closed thread")).toBeInTheDocument();
    expect(screen.queryByText("Overlaps an approved sibling design, same touched path")).not.toBeInTheDocument();
  });

  it("'Mine only' keeps items where the signed-in developer is a party, and updates the stage counts to match", async () => {
    // renderWithAuth signs in as alice@example.com. She's a party to
    // OPEN_THREAD (developerId) but not the author of ENRICHED_REVIEW's
    // design (priya@team.dev) -- so "Mine only" should drop the review and
    // keep the thread.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/reviews?")) return jsonResponse({ items: [ENRICHED_REVIEW] });
        if (url.includes("/v1/alignment-threads?")) return jsonResponse({ items: [OPEN_THREAD] });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderWithAuth();

    await waitFor(() => expect(screen.getByText("All (2)")).toBeInTheDocument());
    expect(screen.getByText("add retry with exponential backoff to the webhook client")).toBeInTheDocument();
    expect(screen.getByText(OPEN_THREAD.summary)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Mine only" }));

    expect(screen.getByText("All (1)")).toBeInTheDocument();
    expect(screen.getByText("Open discussion (1)")).toBeInTheDocument();
    expect(screen.getByText(OPEN_THREAD.summary)).toBeInTheDocument();
    expect(screen.queryByText("add retry with exponential backoff to the webhook client")).not.toBeInTheDocument();
  });

  it("does not show Approve/Reject to a non-admin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/reviews?")) return jsonResponse({ items: [PENDING_REVIEW] });
        if (url.includes("/v1/alignment-threads?")) return emptyThreads();
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth({ projectsById: { "proj-1": { projectId: "proj-1", orgId: "", role: "member" } } });
    await openFirstCard();

    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("an admin can approve a pending review, which then moves to Resolved", async () => {
    let decided = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/decide")) {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toEqual({ decision: "approve" });
          decided = true;
          return jsonResponse({ review: { ...PENDING_REVIEW, decision: "approve" } });
        }
        if (url.includes("/v1/reviews?")) return jsonResponse({ items: [decided ? { ...PENDING_REVIEW, decision: "approve" } : PENDING_REVIEW] });
        if (url.includes("/v1/alignment-threads?")) return emptyThreads();
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderWithAuth();
    await openFirstCard();

    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(screen.getByText("approved", { selector: ".status-badge" })).toBeInTheDocument());
  });

  it("shows an inline error if deciding fails, without dropping the review", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/decide")) return jsonResponse({ error: "not an admin of this project" }, 403);
        if (url.includes("/v1/reviews?")) return jsonResponse({ items: [PENDING_REVIEW] });
        if (url.includes("/v1/alignment-threads?")) return emptyThreads();
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderWithAuth();
    await openFirstCard();

    await user.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("not an admin of this project"));
    expect(screen.getByText("Overlaps an approved sibling design, same touched path")).toBeInTheDocument();
  });

  it("an enriched review names what it collides with, using the shared conflict vocabulary, and what blocked it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/reviews?")) return jsonResponse({ items: [ENRICHED_REVIEW] });
        if (url.includes("/v1/alignment-threads?")) return emptyThreads();
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();
    await openFirstCard();

    await waitFor(() => expect(screen.getByText("Blocked by")).toBeInTheDocument());
    expect(screen.getByText(/money paths need a second pair of eyes/)).toBeInTheDocument();

    expect(screen.getByText("Collides with")).toBeInTheDocument();
    expect(screen.getByText("billing retry work")).toBeInTheDocument();
    expect(screen.getByText("Planning overlap", { selector: ".status-badge" })).toBeInTheDocument();
  });

  it("a claims-path thread with no design behind the initiating edit shows an honest note and links only the other party", async () => {
    const onOpenDesign = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/reviews?")) return emptyReviews();
        const designIdMatch = url.match(/\/v1\/designs\/([^/?]+)$/);
        if (designIdMatch) {
          if (designIdMatch[1] === "design-bob-1") {
            return jsonResponse({
              design: { id: "design-bob-1", projectId: "proj-1", developerId: "bob@example.com", sessionId: "s2", status: "open", createdAt: Date.now(), summary: "Add exponential backoff to RetryPolicy", creates: [], touches: [], dependsOn: [], ttlMs: 1, scopeVersion: 1, lastActivityAt: Date.now(), justifiedConstraintIds: [], justifiedOverlaps: [] },
              groupMembers: [],
            });
          }
          return jsonResponse({ error: "not found" }, 404);
        }
        if (url.includes("/v1/alignment-threads/thread-1")) return jsonResponse({ thread: { ...OPEN_THREAD, designId: "design-bob-1" }, messages: [] });
        if (url.includes("/v1/alignment-threads?")) return jsonResponse({ items: [{ ...OPEN_THREAD, designId: "design-bob-1" }] });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderWithAuth({ onOpenDesign });

    const card = await screen.findByRole("button", { name: /overlapping path with/i });
    await user.click(card);
    // Linked designs is collapsed by default -- open it before its content is reachable.
    await user.click(screen.getByRole("button", { name: /Linked designs/ }));

    expect(screen.getByText("No design registered for alice@example.com's edit.")).toBeInTheDocument();
    const link = await screen.findByRole("button", { name: /bob@example.com's design: Add exponential backoff to RetryPolicy/ });
    await user.click(link);
    expect(onOpenDesign).toHaveBeenCalledWith("design-bob-1");
  });

  it("shows past messages and lets a party reply, appending the new message", async () => {
    let replied = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/v1/reviews?")) return emptyReviews();
        if (url.includes("/v1/alignment-threads?")) return jsonResponse({ items: [OPEN_THREAD] });
        if (url.includes("/v1/alignment-threads/thread-1/messages")) {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toEqual({ message: "Let's coordinate." });
          replied = true;
          return jsonResponse({ message: { authorId: "alice@example.com", message: "Let's coordinate.", ts: Date.now() } });
        }
        if (url.includes("/v1/alignment-threads/thread-1")) {
          const messages = replied
            ? [{ authorId: "twing", message: "auto-opened", ts: Date.now() - 1000 }, { authorId: "alice@example.com", message: "Let's coordinate.", ts: Date.now() }]
            : [{ authorId: "twing", message: "auto-opened", ts: Date.now() - 1000 }];
          return jsonResponse({ thread: OPEN_THREAD, messages });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderWithAuth();

    const card = await screen.findByRole("button", { name: /overlapping path with/i });
    await user.click(card);
    // Messages is collapsed by default -- open it before its content is reachable.
    await user.click(await screen.findByRole("button", { name: /Messages/ }));

    expect(await screen.findByText("auto-opened")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Message"), "Let's coordinate.");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() => expect(screen.getByText("Let's coordinate.")).toBeInTheDocument());
  });

  it("closing a thread updates its status badge and removes the reply form", async () => {
    let closed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/v1/reviews?")) return emptyReviews();
        if (url.includes("/close")) {
          expect(init?.method).toBe("PATCH");
          closed = true;
          return jsonResponse({ status: "closed" });
        }
        if (url.includes("/v1/alignment-threads?")) return jsonResponse({ items: [{ ...OPEN_THREAD, status: closed ? "closed" : "open" }] });
        if (url.includes("/v1/alignment-threads/thread-1")) return jsonResponse({ thread: { ...OPEN_THREAD, status: closed ? "closed" : "open" }, messages: [] });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderWithAuth();

    const card = await screen.findByRole("button", { name: /overlapping path with/i });
    await user.click(card);
    await user.click(await screen.findByRole("button", { name: "Close thread" }));

    await waitFor(() => expect(screen.getByText("closed", { selector: ".status-badge" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Close thread" })).not.toBeInTheDocument();
  });

  it("readOnly skips fetching reviews entirely and hides a thread's reply/close UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/reviews?")) throw new Error("should not fetch reviews when readOnly");
        if (url.includes("/v1/alignment-threads?")) return jsonResponse({ items: [OPEN_THREAD] });
        if (url.includes("/v1/alignment-threads/thread-1")) return jsonResponse({ thread: OPEN_THREAD, messages: [{ authorId: "twing", message: "auto-opened", ts: Date.now() }] });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const user = userEvent.setup();
    renderWithAuth({ readOnly: true });

    const card = await screen.findByRole("button", { name: /overlapping path with/i });
    await user.click(card);
    // Messages is collapsed by default -- open it before its content is reachable.
    await user.click(await screen.findByRole("button", { name: /Messages/ }));

    expect(await screen.findByText("auto-opened")).toBeInTheDocument();
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close thread" })).not.toBeInTheDocument();
  });

  it("merges reviews and threads from multiple repos and labels each card with a RepoBadge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const projectId = new URL(url, "https://x").searchParams.get("projectId");
        if (url.includes("/v1/reviews?")) return jsonResponse({ items: projectId === "proj-1" ? [{ ...PENDING_REVIEW, projectId: "proj-1" }] : [] });
        if (url.includes("/v1/alignment-threads?")) return jsonResponse({ items: projectId === "proj-2" ? [{ ...OPEN_THREAD, id: "thread-2", projectId: "proj-2" }] : [] });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth({
      projectIds: ["proj-1", "proj-2"],
      projectsById: { "proj-1": { projectId: "proj-1", orgId: "", role: "admin" }, "proj-2": { projectId: "proj-2", orgId: "", role: "admin" } },
    });

    await waitFor(() => expect(screen.getByText("Overlaps an approved sibling design, same touched path")).toBeInTheDocument());
    expect(screen.getByText(OPEN_THREAD.summary)).toBeInTheDocument();
    expect(screen.getByText("proj-1", { selector: ".repo-badge" })).toBeInTheDocument();
    expect(screen.getByText("proj-2", { selector: ".repo-badge" })).toBeInTheDocument();
  });

  it("a copy-link id resolves as a review first, falling back to a thread when no review matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/reviews/thread-1")) return jsonResponse({ error: "not found" }, 404);
        if (url.includes("/v1/alignment-threads/thread-1")) return jsonResponse({ thread: OPEN_THREAD, messages: [] });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth({ focusConflictId: "thread-1" });

    expect(await screen.findByText(OPEN_THREAD.summary)).toBeInTheDocument();
  });
});
