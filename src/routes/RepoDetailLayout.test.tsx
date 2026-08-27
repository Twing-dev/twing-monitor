import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { RepoDetailLayout } from "./RepoDetailLayout.js";
import type { ProjectSummary } from "../api/types.js";

const project: ProjectSummary = { projectId: "proj-1", orgId: "org-1", role: "admin" };

function renderLayout(projects: ProjectSummary[] = [project]) {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <RepoDetailLayout projects={projects} onBack={() => {}} />
    </ServerProvider>,
  );
}

describe("RepoDetailLayout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clicking 'View design ->' on an Activity row switches to the Designs tab with that design expanded", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/activity")) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "evt-1",
                  projectId: "proj-1",
                  developerId: "alice@example.com",
                  kind: "design_flagged",
                  relatedId: "design-42",
                  ts: Date.now(),
                  payload: { verdict: "constraint_violation" },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/v1/designs?")) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "design-42",
                  projectId: "proj-1",
                  developerId: "bob@example.com",
                  sessionId: "sess-1",
                  status: "flagged",
                  createdAt: Date.now(),
                  summary: "A design owned by someone else, currently flagged",
                  creates: [],
                  touches: ["src/x.ts"],
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
        if (url.includes("/v1/claims") || url.includes("/v1/alignment-threads")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderLayout();

    await user.click(screen.getByRole("tab", { name: "Activity" }));
    // Activity groups by design by default -- expand the design's group
    // before its "View design ->" link is reachable.
    const groupHeader = await screen.findByRole("button", { name: /a design owned by someone else, currently flagged/i, expanded: false });
    await user.click(groupHeader);
    // The link now reads "-> <summary>" rather than a bare "View design ->"
    // -- design_flagged's own designsById fallback resolves the summary
    // even when (as this test's fixture deliberately does) the event's own
    // payload doesn't carry one. Matched on the leading arrow specifically
    // to disambiguate from the group header above, whose own accessible
    // name also now contains the same summary text.
    const link = await screen.findByRole("button", { name: /^→/ });
    await user.click(link);

    // Switched to the Designs tab automatically (no manual click needed).
    await waitFor(() => expect(screen.getByRole("tab", { name: "Designs", selected: true })).toBeInTheDocument());
    // The design is owned by someone else and is "flagged", not "open" --
    // only visible at all because focusDesignId forces status=all/mineOnly=false.
    // It also arrives pre-expanded (no extra click needed).
    await waitFor(() => expect(screen.getByText("A design owned by someone else, currently flagged")).toBeInTheDocument());
    expect(screen.getByText("src/x.ts")).toBeInTheDocument();
  });

  it("renders the single-repo header (name + role badge) unchanged when given exactly one project", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    renderLayout();

    expect(await screen.findByRole("heading", { name: "proj-1" })).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^\d+ repos$/ })).not.toBeInTheDocument();
  });

  it("renders an 'N repos' header with a chip per repo when given more than one project", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    const other: ProjectSummary = { projectId: "proj-2", orgId: "org-1", role: "member", githubOwner: "acme", githubRepo: "widgets" };
    renderLayout([project, other]);

    expect(await screen.findByRole("heading", { name: "2 repos" })).toBeInTheDocument();
    expect(screen.getByText("proj-1")).toBeInTheDocument();
    expect(screen.getByText("acme/widgets")).toBeInTheDocument();
    // No single-repo role badge when aggregating multiple repos.
    expect(screen.queryByText("admin")).not.toBeInTheDocument();
  });
});
