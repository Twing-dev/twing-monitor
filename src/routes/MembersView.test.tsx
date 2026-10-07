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

  it("merges the same developer's membership across multiple repos into one row, not one row per (developer, repo) pair", async () => {
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

    // One card for alice, not two -- her per-repo role shows up as a row per
    // membership inside it instead. The repo and the role became separate
    // elements when the rows became cards (2026-10-07), so each is asserted
    // on its own; what this test is actually about is unchanged, that both
    // memberships appear under a single developer.
    await waitFor(() => expect(screen.getAllByText("alice@example.com")).toHaveLength(1));
    expect(document.querySelectorAll(".member-repo")).toHaveLength(2);
    expect(screen.getByText("proj-1")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("proj-2")).toBeInTheDocument();
    expect(screen.getByText("member")).toBeInTheDocument();
  });

  /* Two layouts, because they answer different questions: by person, "what is
     X on"; by repo, "who is on X". Neither answers the other, so the reader
     picks. (2026-10-07) */
  describe("layout toggle", () => {
    function stubTwoRepos() {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const projectId = String(input).match(/projects\/([^/]+)\/developers/)?.[1];
          const items =
            projectId === "proj-1"
              ? [
                  { projectId: "proj-1", developerId: "alice@example.com", role: "admin" },
                  { projectId: "proj-1", developerId: "bob@example.com", role: "member" },
                ]
              : [{ projectId: "proj-2", developerId: "alice@example.com", role: "member" }];
          return new Response(JSON.stringify({ items }), { status: 200 });
        }),
      );
    }

    const twoProjects = {
      "proj-1": { projectId: "proj-1", orgId: "", role: "admin" } as unknown as ProjectSummary,
      "proj-2": { projectId: "proj-2", orgId: "", role: "member" } as unknown as ProjectSummary,
    };

    it("opens on the roster, one row per person", async () => {
      stubTwoRepos();
      renderWithAuth(["proj-1", "proj-2"], twoProjects);
      await waitFor(() => expect(document.querySelectorAll(".member-roster-row")).toHaveLength(2));
      expect(document.querySelector(".member-repo-groups")).toBeNull();
    });

    it("regroups by repo when asked, listing a person once per repo they are on", async () => {
      stubTwoRepos();
      renderWithAuth(["proj-1", "proj-2"], twoProjects);
      await waitFor(() => expect(document.querySelectorAll(".member-roster-row")).toHaveLength(2));

      screen.getByRole("button", { name: /by repo/i }).click();

      // One section per repo, and alice -- who is on both -- appears in each.
      await waitFor(() => expect(document.querySelectorAll(".member-repo-group")).toHaveLength(2));
      expect(screen.getAllByText("alice")).toHaveLength(2);
      expect(document.querySelector(".member-roster")).toBeNull();
    });

    it("separates admins from members under their own headings", async () => {
      stubTwoRepos();
      renderWithAuth(["proj-1", "proj-2"], twoProjects);
      await waitFor(() => expect(document.querySelectorAll(".member-roster-row")).toHaveLength(2));
      screen.getByRole("button", { name: /by repo/i }).click();
      await waitFor(() => expect(document.querySelectorAll(".member-repo-group")).toHaveLength(2));
      expect(screen.getAllByText("Admins").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Members").length).toBeGreaterThan(0);
    });

    /* A control whose two states look identical teaches people not to trust
       controls: with one repo, "by repo" is one section holding the whole
       list and "by person" is that same list again. */
    it("hides the toggle entirely when only one repo is in scope", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [{ projectId: "proj-1", developerId: "alice@example.com", role: "admin" }] }), { status: 200 })));
      renderWithAuth();
      await screen.findByText("alice@example.com");
      expect(screen.queryByRole("button", { name: /by repo/i })).not.toBeInTheDocument();
    });
  });

  it("shows a plain role badge (no repo label) when only one repo is in scope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [{ projectId: "proj-1", developerId: "alice@example.com", role: "admin" }] }), { status: 200 })));
    renderWithAuth();

    await screen.findByText("alice@example.com");
    expect(screen.getByText("admin", { selector: ".status-badge" })).toBeInTheDocument();
    expect(screen.queryByText(/proj-1 ·/)).not.toBeInTheDocument();
  });
});
