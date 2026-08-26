import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { ConstraintsView } from "./ConstraintsView.js";
import type { ProjectSummary } from "../api/types.js";

function renderWithAuth(projectIds: string[] = ["proj-1"], projectsById: Record<string, ProjectSummary> = {}) {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <ConstraintsView projectIds={projectIds} projectsById={projectsById} />
    </ServerProvider>,
  );
}

describe("ConstraintsView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders an empty state when no constraints are registered", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    renderWithAuth();

    await waitFor(() => expect(screen.getByText(/no constraints registered/i)).toBeInTheDocument());
  });

  it("renders one card per constraint with its statement and scope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                {
                  id: "constraint-1",
                  projectId: "proj-1",
                  type: "constraint",
                  statement: "hook/main.go carries the capture edge and must stay a trivial socket client",
                  scope: ["hook/main.go", "hook/socket.go"],
                  source: "twing.yml",
                  createdAt: Date.now(),
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText(/hook\/main\.go carries the capture edge/)).toBeInTheDocument());
    expect(screen.getByText("hook/main.go, hook/socket.go")).toBeInTheDocument();
  });

  it("merges constraints from multiple repos, RepoBadge only when >1 repo is in scope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const projectId = new URL(url).searchParams.get("projectId");
        const items =
          projectId === "proj-1"
            ? [{ id: "c1", projectId: "proj-1", type: "constraint", statement: "Constraint in proj-1", scope: [], source: "twing.yml", createdAt: Date.now() }]
            : [{ id: "c2", projectId: "proj-2", type: "constraint", statement: "Constraint in proj-2", scope: [], source: "twing.yml", createdAt: Date.now() - 1 }];
        return new Response(JSON.stringify({ items }), { status: 200 });
      }),
    );
    renderWithAuth(["proj-1", "proj-2"], {
      "proj-1": { projectId: "proj-1", orgId: "", role: "admin" },
      "proj-2": { projectId: "proj-2", orgId: "", role: "admin" },
    });

    await waitFor(() => expect(screen.getByText("Constraint in proj-1")).toBeInTheDocument());
    expect(screen.getByText("Constraint in proj-2")).toBeInTheDocument();
    expect(screen.getByText("proj-1", { selector: ".repo-badge" })).toBeInTheDocument();
    expect(screen.getByText("proj-2", { selector: ".repo-badge" })).toBeInTheDocument();
  });

  it("shows no RepoBadge when only one repo is in scope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ items: [{ id: "c1", projectId: "proj-1", type: "constraint", statement: "Solo repo constraint", scope: [], source: "twing.yml", createdAt: Date.now() }] }),
          { status: 200 },
        ),
      ),
    );
    renderWithAuth();

    await screen.findByText("Solo repo constraint");
    expect(screen.queryByText("proj-1", { selector: ".repo-badge" })).not.toBeInTheDocument();
  });
});
