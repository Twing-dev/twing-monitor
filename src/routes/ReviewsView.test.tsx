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
    expect(within(memberCard).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(adminCard).getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });
});
