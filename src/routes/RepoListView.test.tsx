import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { RepoListView } from "./RepoListView.js";

function renderWithAuth(onSelectProject: (project: import("../api/types.js").ProjectSummary) => void = () => {}) {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <RepoListView onSelectProject={onSelectProject} />
    </ServerProvider>,
  );
}

describe("RepoListView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders an empty state when the developer has no projects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    renderWithAuth();

    await waitFor(() => expect(screen.getByText(/no repos yet/i)).toBeInTheDocument());
  });

  it("renders one card per project -- owner/repo label when GitHub-bound, projectId otherwise, role badge, founder", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                { projectId: "proj-1", orgId: "", role: "admin", githubOwner: "acme", githubRepo: "widgets", foundedBy: "alice@example.com", foundedAt: Date.now() },
                { projectId: "proj-2", orgId: "org-1", role: "member", foundedBy: "bob@example.com", foundedAt: Date.now() },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText("acme/widgets")).toBeInTheDocument());
    expect(screen.getByText("proj-2")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("member")).toBeInTheDocument();
  });

  it("renders an error state instead of hanging when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "not a member of this project" }), { status: 403 })));
    renderWithAuth();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("not a member of this project"));
  });
});
