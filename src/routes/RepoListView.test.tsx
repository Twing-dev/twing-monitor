import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { RepoListView } from "./RepoListView.js";
import type { ProjectSummary } from "../api/types.js";

const twoProjects: ProjectSummary[] = [
  { projectId: "proj-1", orgId: "", role: "admin", githubOwner: "acme", githubRepo: "widgets", foundedBy: "alice@example.com", foundedAt: Date.now() },
  { projectId: "proj-2", orgId: "org-1", role: "member", foundedBy: "bob@example.com", foundedAt: Date.now() },
];

function stubProjectsFetch(items: ProjectSummary[]) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items }), { status: 200 })));
}

function renderWithAuth(
  onSelectProject: (project: ProjectSummary) => void = () => {},
  onViewAggregate: (projects: ProjectSummary[]) => void = () => {},
) {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <RepoListView onSelectProject={onSelectProject} onViewAggregate={onViewAggregate} />
    </ServerProvider>,
  );
}

describe("RepoListView", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders an empty state when the developer has no projects", async () => {
    stubProjectsFetch([]);
    renderWithAuth();

    await waitFor(() => expect(screen.getByText(/no repos yet/i)).toBeInTheDocument());
  });

  it("renders one card per project -- owner/repo label when GitHub-bound, projectId otherwise, role badge, founder", async () => {
    stubProjectsFetch(twoProjects);
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

  it("defaults to every repo checked -- the view button covers all of them", async () => {
    stubProjectsFetch(twoProjects);
    renderWithAuth();

    expect(await screen.findByRole("button", { name: "View 2 repos" })).toBeInTheDocument();
    expect(screen.getByLabelText(/include acme\/widgets/i)).toBeChecked();
    expect(screen.getByLabelText(/include proj-2/i)).toBeChecked();
  });

  it("unchecking one repo narrows the view button's count and its own selection", async () => {
    const user = userEvent.setup();
    stubProjectsFetch(twoProjects);
    renderWithAuth();

    await user.click(await screen.findByLabelText(/include proj-2/i));
    expect(await screen.findByRole("button", { name: "View 1 repo" })).toBeInTheDocument();
  });

  it("clicking 'View N repos' calls onViewAggregate with exactly the checked subset", async () => {
    const user = userEvent.setup();
    const onViewAggregate = vi.fn();
    stubProjectsFetch(twoProjects);
    renderWithAuth(() => {}, onViewAggregate);

    await user.click(await screen.findByLabelText(/include proj-2/i));
    await user.click(screen.getByRole("button", { name: "View 1 repo" }));

    expect(onViewAggregate).toHaveBeenCalledTimes(1);
    expect(onViewAggregate.mock.calls[0][0].map((p: ProjectSummary) => p.projectId)).toEqual(["proj-1"]);
  });

  it("a card's own click still opens that single repo, unaffected by checkbox state", async () => {
    const user = userEvent.setup();
    const onSelectProject = vi.fn();
    stubProjectsFetch(twoProjects);
    renderWithAuth(onSelectProject);

    await user.click(await screen.findByLabelText(/include proj-2/i)); // uncheck it
    await user.click(screen.getByText("proj-2")); // still opens it directly

    expect(onSelectProject).toHaveBeenCalledTimes(1);
    expect(onSelectProject.mock.calls[0][0].projectId).toBe("proj-2");
  });

  it("selection round-trips through localStorage across a remount", async () => {
    const user = userEvent.setup();
    stubProjectsFetch(twoProjects);
    const first = renderWithAuth();

    await user.click(await screen.findByLabelText(/include proj-2/i));
    await waitFor(() => expect(screen.getByRole("button", { name: "View 1 repo" })).toBeInTheDocument());
    first.unmount();

    renderWithAuth();
    expect(await screen.findByRole("button", { name: "View 1 repo" })).toBeInTheDocument();
    expect(screen.getByLabelText(/include acme\/widgets/i)).toBeChecked();
    expect(screen.getByLabelText(/include proj-2/i)).not.toBeChecked();
  });

  it("intersects a stored selection against the live repo list, dropping ids for repos that no longer exist", async () => {
    localStorage.setItem("twing-monitor:selectedRepos", JSON.stringify(["proj-1", "proj-stale"]));
    stubProjectsFetch(twoProjects);
    renderWithAuth();

    // proj-1 was still valid, so only it stays selected; proj-stale has no
    // checkbox to apply to, and proj-2 (never in the stored set) stays off.
    expect(await screen.findByLabelText(/include acme\/widgets/i)).toBeChecked();
    expect(screen.getByLabelText(/include proj-2/i)).not.toBeChecked();
  });

  it("falls back to every repo checked when the stored selection has nothing valid left", async () => {
    localStorage.setItem("twing-monitor:selectedRepos", JSON.stringify(["proj-stale"]));
    stubProjectsFetch(twoProjects);
    renderWithAuth();

    expect(await screen.findByRole("button", { name: "View 2 repos" })).toBeInTheDocument();
  });
});
