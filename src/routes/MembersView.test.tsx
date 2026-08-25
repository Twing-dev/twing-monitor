import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { MembersView } from "./MembersView.js";
import type { ProjectSummary } from "../api/types.js";

function renderWithAuth(projectIds: string[] = ["proj-1"], projectsById: Record<string, ProjectSummary> = {}) {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <MembersView projectIds={projectIds} projectsById={projectsById} />
    </ServerProvider>,
  );
}

describe("MembersView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders an empty state when there are no members", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    renderWithAuth();

    await waitFor(() => expect(screen.getByText(/no members found/i)).toBeInTheDocument());
  });

  it("renders one row per member with a role badge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                { projectId: "proj-1", developerId: "alice@example.com", role: "admin" },
                { projectId: "proj-1", developerId: "bob@example.com", role: "member" },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText("alice@example.com")).toBeInTheDocument());
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("member")).toBeInTheDocument();
  });

  it("merges members from multiple repos, one row per (developer, repo) pair, with a RepoBadge only when >1 repo is in scope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const projectId = url.match(/projects\/([^/]+)\/developers/)?.[1];
        const items =
          projectId === "proj-1"
            ? [{ projectId: "proj-1", developerId: "alice@example.com", role: "admin" }]
            : [{ projectId: "proj-2", developerId: "alice@example.com", role: "member" }];
        return new Response(JSON.stringify({ items }), { status: 200 });
      }),
    );
    renderWithAuth(["proj-1", "proj-2"], {
      "proj-1": { projectId: "proj-1", orgId: "", role: "admin" },
      "proj-2": { projectId: "proj-2", orgId: "", role: "member" },
    });

    // Same developer, two rows -- once per repo, with their own role each.
    await waitFor(() => expect(screen.getAllByText("alice@example.com")).toHaveLength(2));
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("member")).toBeInTheDocument();
    expect(screen.getByText("proj-1", { selector: ".repo-badge" })).toBeInTheDocument();
    expect(screen.getByText("proj-2", { selector: ".repo-badge" })).toBeInTheDocument();
  });

  it("shows no RepoBadge when only one repo is in scope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [{ projectId: "proj-1", developerId: "alice@example.com", role: "admin" }] }), { status: 200 })));
    renderWithAuth();

    await screen.findByText("alice@example.com");
    expect(screen.queryByText("proj-1", { selector: ".repo-badge" })).not.toBeInTheDocument();
  });
});
