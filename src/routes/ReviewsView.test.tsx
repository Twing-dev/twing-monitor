import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { ReviewsView } from "./ReviewsView.js";
import type { ProjectSummary } from "../api/types.js";

function renderWithAuth(canDecide = false, projectIds: string[] = ["proj-1"], projectsByIdOverride?: Record<string, ProjectSummary>) {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  const projectsById =
    projectsByIdOverride ?? Object.fromEntries(projectIds.map((id) => [id, { projectId: id, orgId: "", role: canDecide ? "admin" : "member" } as ProjectSummary]));
  return render(
    <ServerProvider>
      <ReviewsView projectIds={projectIds} projectsById={projectsById} />
    </ServerProvider>,
  );
}

/** The review card is collapsed to its headline by default, so the bands,
 * the file lists and Approve/Reject all sit behind one click. Tests that
 * assert on any of those open the first card first. */
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

describe("ReviewsView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders an empty state when nothing is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    renderWithAuth();

    await waitFor(() => expect(screen.getByText(/nothing pending review/i)).toBeInTheDocument());
  });

  it("renders one card per review with a pending badge", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [PENDING_REVIEW] }), { status: 200 })));
    renderWithAuth();

    await waitFor(() => expect(screen.getByText("Overlaps an approved sibling design, same touched path")).toBeInTheDocument());
    expect(screen.getByText("pending", { selector: ".status-badge" })).toBeInTheDocument();
  });

  // Pagination (monitor UI load-time fix, 2026-08-29): GET /v1/reviews now
  // returns {items, nextBefore} instead of the whole project's history --
  // mirrors ActivityView's/DesignsView's own "load-older" test.
  it("shows a 'Load older' button when a next page exists, and appends the next page on click", async () => {
    const user = userEvent.setup();
    const review = (id: string, justification: string) => ({ id, designId: `design-${id}`, projectId: "proj-1", justification, createdAt: Date.now() });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (!url.pathname.endsWith("/v1/reviews")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        const before = url.searchParams.get("before");
        if (!before) return new Response(JSON.stringify({ items: [review("r-new", "The newer review")], nextBefore: 500 }), { status: 200 });
        return new Response(JSON.stringify({ items: [review("r-old", "The older review")] }), { status: 200 });
      }),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText("The newer review")).toBeInTheDocument());
    expect(screen.queryByText("The older review")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load older" }));

    await waitFor(() => expect(screen.getByText("The older review")).toBeInTheDocument());
    expect(screen.getByText("The newer review")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load older" })).not.toBeInTheDocument();
  });

  // §17.10: deciding a review is admin-gated server-side -- the UI must not
  // even offer the buttons to a plain member, who'd just get a 403.
  it("does not show Approve/Reject to a non-admin (canDecide: false)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [PENDING_REVIEW] }), { status: 200 })));
    renderWithAuth(false);

    await waitFor(() => expect(screen.getByText("Overlaps an approved sibling design, same touched path")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("an admin can approve a pending review, which then drops out of the pending list", async () => {
    const user = userEvent.setup();
    let decided = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/decide")) {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toEqual({ decision: "approve" });
          decided = true;
          return new Response(JSON.stringify({ review: { ...PENDING_REVIEW, decision: "approve" } }), { status: 200 });
        }
        // Pending-status query returns the review until it's been decided --
        // this is what proves the refetch-after-decide wiring actually works,
        // not just that the button click fired a request.
        const items = decided ? [] : [PENDING_REVIEW];
        return new Response(JSON.stringify({ items }), { status: 200 });
      }),
    );
    renderWithAuth(true);
    await openFirstCard();

    await waitFor(() => expect(screen.getByText("Overlaps an approved sibling design, same touched path")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(screen.getByText(/nothing pending review/i)).toBeInTheDocument());
  });

  it("shows an inline error if deciding fails, without crashing the list", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/decide")) {
          return new Response(JSON.stringify({ error: "not an admin of this project" }), { status: 403 });
        }
        return new Response(JSON.stringify({ items: [PENDING_REVIEW] }), { status: 200 });
      }),
    );
    renderWithAuth(true);
    await openFirstCard();

    await waitFor(() => expect(screen.getByText("Overlaps an approved sibling design, same touched path")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("not an admin of this project"));
    // The review is still there -- a failed decide doesn't silently drop it.
    expect(screen.getByText("Overlaps an approved sibling design, same touched path")).toBeInTheDocument();
  });

  it("resolves canDecide per-review from that review's own project role, not one setting for the whole list", async () => {
    const memberReview = { ...PENDING_REVIEW, id: "review-member-side", projectId: "proj-1", justification: "Review in the member-role repo" };
    const adminReview = { ...PENDING_REVIEW, id: "review-admin-side", projectId: "proj-2", justification: "Review in the admin-role repo" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const projectId = new URL(url).searchParams.get("projectId");
        const items = projectId === "proj-1" ? [memberReview] : projectId === "proj-2" ? [adminReview] : [];
        return new Response(JSON.stringify({ items }), { status: 200 });
      }),
    );
    renderWithAuth(false, ["proj-1", "proj-2"], {
      "proj-1": { projectId: "proj-1", orgId: "", role: "member" },
      "proj-2": { projectId: "proj-2", orgId: "", role: "admin" },
    });

    await waitFor(() => expect(screen.getByText("Review in the member-role repo")).toBeInTheDocument());
    expect(screen.getByText("Review in the admin-role repo")).toBeInTheDocument();

    const memberCard = screen.getByText("Review in the member-role repo").closest("li")!;
    const adminCard = screen.getByText("Review in the admin-role repo").closest("li")!;

    // Cards are collapsed by default, so open both -- the point of this
    // test is that the two resolve differently, not that either is hidden.
    const user = userEvent.setup();
    await user.click(within(memberCard).getByRole("button", { expanded: false }));
    await user.click(within(adminCard).getByRole("button", { expanded: false }));

    expect(within(memberCard).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(adminCard).getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });
});

// The enriched shape GET /v1/reviews returns as of 2026-08-25. Every test
// above uses a bare review with no `design`, which is now also the
// against-an-older-coordinator fallback -- so those double as the
// degradation coverage, and this block covers the real card.
const ENRICHED_REVIEW = {
  ...PENDING_REVIEW,
  constraintIds: ["c-1"],
  overlapWaivers: [{ conflictingDesignId: "design-2", paths: ["src/billing/charge.ts"] }],
  design: {
    summary: "add retry with exponential backoff to the webhook client",
    creates: ["src/net/retry.ts"],
    touches: ["src/billing/charge.ts"],
    developerId: "priya@team.dev",
    status: "flagged",
  },
  constraints: [{ id: "c-1", statement: "money paths need a second pair of eyes", type: "review_required" }],
  conflicts: [
    {
      designId: "design-2",
      kind: "overlap" as const,
      summary: "billing retry work",
      developerId: "ayush@team.dev",
      paths: ["src/billing/charge.ts"],
    },
  ],
};

describe("ReviewsView — enriched cards", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubEnriched() {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [ENRICHED_REVIEW] }), { status: 200 })));
  }

  // The point of the whole change: the card leads with the work, not with
  // the requester's argument for being allowed to do it.
  it("leads with what is being built, not the justification", async () => {
    stubEnriched();
    renderWithAuth();

    await waitFor(() =>
      expect(screen.getByText("add retry with exponential backoff to the webhook client")).toBeInTheDocument(),
    );
    expect(screen.getByText("priya@team.dev")).toBeInTheDocument();
  });

  it("still shows the justification, but as their argument rather than the headline", async () => {
    stubEnriched();
    renderWithAuth();
    await openFirstCard();

    await waitFor(() => expect(screen.getByText("They say")).toBeInTheDocument());
    expect(screen.getByText(/Overlaps an approved sibling design/)).toBeInTheDocument();
  });

  // Regression guard: ReviewsView read `r.constraintId` (singular) while the
  // server had long since sent `constraintIds`, so the constraint marker
  // never rendered once. The hand-rolled local type hid the drift.
  it("names the rule that blocked it, in plain language", async () => {
    stubEnriched();
    renderWithAuth();
    await openFirstCard();

    await waitFor(() => expect(screen.getByText("Blocked by")).toBeInTheDocument());
    expect(screen.getByText(/money paths need a second pair of eyes/)).toBeInTheDocument();
    expect(screen.getByText("a human must review changes here")).toBeInTheDocument();
  });

  it("names whose work it collides with", async () => {
    stubEnriched();
    renderWithAuth();
    await openFirstCard();

    await waitFor(() => expect(screen.getByText("Collides with")).toBeInTheDocument());
    expect(screen.getByText("billing retry work")).toBeInTheDocument();
    expect(screen.getByText(/ayush@team\.dev/)).toBeInTheDocument();
  });

  it("keeps file lists behind the card's own collapse, not a second toggle inside it", async () => {
    stubEnriched();
    renderWithAuth();
    await openFirstCard();

    // Opened by openFirstCard above -- everything is visible at once, with
    // no second disclosure to find.
    expect(screen.getByText("Creates")).toBeInTheDocument();
    expect(screen.getByText("src/net/retry.ts")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show detail/i })).not.toBeInTheDocument();
  });

  // A conflicting design deleted since the review was raised: the server
  // sends the id with no summary. The card must still say something
  // collided rather than rendering an empty line.
  it("reports a decision in the past tense, so the badge doesn't read as a button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ items: [{ ...ENRICHED_REVIEW, decision: "approve" }] }), { status: 200 })),
    );
    renderWithAuth();
    await openFirstCard();

    await waitFor(() => expect(screen.getByText("approved", { selector: ".status-badge" })).toBeInTheDocument());
    expect(screen.queryByText("approve", { selector: ".status-badge" })).not.toBeInTheDocument();
  });

  // Three review_required rules on one design printed the identical
  // translation under each -- the common case, and pure noise.
  it("states a shared rule type once, not once per rule", async () => {
    const threeSameType = {
      ...ENRICHED_REVIEW,
      constraints: [
        { id: "c-1", statement: "the hosted coordinator itself", type: "review_required" },
        { id: "c-2", statement: "coordinator's core verdict logic", type: "review_required" },
        { id: "c-3", statement: "the gate's own verdict/deny logic", type: "review_required" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [threeSameType] }), { status: 200 })));
    renderWithAuth();
    await openFirstCard();

    await waitFor(() => expect(screen.getByText(/3 rules/)).toBeInTheDocument());
    expect(screen.getAllByText(/a human must review changes here/)).toHaveLength(1);
  });

  it("keeps per-rule types when they genuinely differ", async () => {
    const mixed = {
      ...ENRICHED_REVIEW,
      constraints: [
        { id: "c-1", statement: "money paths need review", type: "review_required" },
        { id: "c-2", statement: "one HTTP wrapper only", type: "canonical_abstraction" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [mixed] }), { status: 200 })));
    renderWithAuth();
    await openFirstCard();

    await waitFor(() => expect(screen.getByText(/a human must review changes here/)).toBeInTheDocument());
    expect(screen.getByText(/use the existing approach/)).toBeInTheDocument();
  });

  // The justification is the requester's argument, not the finding -- left
  // unclamped it dwarfed the two bands a reviewer actually decides on.
  it("clamps a long justification behind a Show all toggle", async () => {
    const user = userEvent.setup();
    const long = { ...ENRICHED_REVIEW, justification: "x".repeat(400) };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [long] }), { status: 200 })));
    renderWithAuth();
    await openFirstCard();

    await waitFor(() => expect(screen.getByRole("button", { name: /show all/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /show all/i }));
    expect(screen.getByRole("button", { name: /show less/i })).toBeInTheDocument();
  });

  it("offers no toggle for a justification short enough to read as-is", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [ENRICHED_REVIEW] }), { status: 200 })));
    renderWithAuth();
    await openFirstCard();

    await waitFor(() => expect(screen.getByText("They say")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
  });

  it("survives a conflicting design that no longer exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [{ ...ENRICHED_REVIEW, conflicts: [{ designId: "design-gone", kind: "overlap" }] }],
            }),
            { status: 200 },
          ),
      ),
    );
    renderWithAuth();
    await openFirstCard();

    await waitFor(() => expect(screen.getByText("Collides with")).toBeInTheDocument());
    expect(screen.getByText(/design-gone/)).toBeInTheDocument();
  });
});
