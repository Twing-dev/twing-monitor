import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { RepoDetailLayout } from "./RepoDetailLayout.js";
import type { ProjectSummary } from "../api/types.js";

const project: ProjectSummary = { projectId: "proj-1", orgId: "org-1", role: "admin" };

function renderLayout() {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <RepoDetailLayout project={project} onBack={() => {}} />
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
                  payload: { verdict: "constraint_flag" },
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
        if (url.includes("/v1/claims")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderLayout();

    await user.click(screen.getByRole("tab", { name: "Activity" }));
    const link = await screen.findByRole("button", { name: /view design/i });
    await user.click(link);

    // Switched to the Designs tab automatically (no manual click needed).
    await waitFor(() => expect(screen.getByRole("tab", { name: "Designs", selected: true })).toBeInTheDocument());
    // The design is owned by someone else and is "flagged", not "open" --
    // only visible at all because focusDesignId forces status=all/mineOnly=false.
    // It also arrives pre-expanded (no extra click needed).
    await waitFor(() => expect(screen.getByText("A design owned by someone else, currently flagged")).toBeInTheDocument());
    expect(screen.getByText("src/x.ts")).toBeInTheDocument();
  });
});
