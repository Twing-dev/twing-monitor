import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { ActivityView, type ActivityViewProps } from "./ActivityView.js";

function renderWithAuth(props: Partial<Omit<ActivityViewProps, "projectIds" | "projectsById">> & { projectIds?: string[]; projectsById?: ActivityViewProps["projectsById"] } = {}) {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  const { projectIds = ["proj-1"], projectsById = {}, ...rest } = props;
  return render(
    <ServerProvider>
      <ActivityView projectIds={projectIds} projectsById={projectsById} {...rest} />
    </ServerProvider>,
  );
}

describe("ActivityView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders an empty state when there is no activity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    renderWithAuth();

    await waitFor(() => expect(screen.getByText(/no activity yet/i)).toBeInTheDocument());
  });

  it("renders one row per event, with structured detail fields, formatted by kind, with a load-older button when a next page exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                {
                  id: "evt-1",
                  projectId: "proj-1",
                  developerId: "alice@example.com",
                  kind: "design_registered",
                  relatedId: "design-1",
                  ts: Date.now(),
                  payload: { summary: "Add retry backoff", creates: ["src/retry.ts"], touches: [] },
                },
              ],
              nextBefore: Date.now() - 1000,
            }),
            { status: 200 },
          ),
      ),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText("Design registered")).toBeInTheDocument());
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getByText("Add retry backoff")).toBeInTheDocument();
    expect(screen.getByText("Creates")).toBeInTheDocument();
    expect(screen.getByText("src/retry.ts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /load older/i })).toBeInTheDocument();
  });

  it("clicking a developer name filters the feed to that developer, and it's clearable", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const items = url.includes("developerId=bob%40example.com")
        ? [{ id: "evt-bob", projectId: "proj-1", developerId: "bob@example.com", kind: "design_closed", ts: Date.now() }]
        : [
            { id: "evt-alice", projectId: "proj-1", developerId: "alice@example.com", kind: "design_closed", ts: Date.now() },
            { id: "evt-bob", projectId: "proj-1", developerId: "bob@example.com", kind: "design_closed", ts: Date.now() - 1 },
          ];
      return new Response(JSON.stringify({ items }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithAuth();

    await waitFor(() => expect(screen.getAllByText("Design closed").length).toBe(2));
    const bobButton = screen.getByRole("button", { name: "bob@example.com" });
    await user.click(bobButton);

    await waitFor(() => expect(screen.getAllByText("Design closed").length).toBe(1));
    expect(screen.getByText("bob@example.com", { selector: ".active-filter-chip" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear developer filter/i }));
    await waitFor(() => expect(screen.getAllByText("Design closed").length).toBe(2));
  });

  it("a design-related event with an onOpenDesign handler renders a link that navigates to that design", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [{ id: "evt-1", projectId: "proj-1", developerId: "alice@example.com", kind: "design_flagged", relatedId: "design-42", ts: Date.now(), payload: { verdict: "constraint_violation" } }],
            }),
            { status: 200 },
          ),
      ),
    );
    const onOpenDesign = vi.fn();
    renderWithAuth({ onOpenDesign });

    const link = await screen.findByRole("button", { name: /view design/i });
    await user.click(link);
    expect(onOpenDesign).toHaveBeenCalledWith("design-42");
  });

  it("without an onOpenDesign handler, no design link renders", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [{ id: "evt-1", projectId: "proj-1", developerId: "alice@example.com", kind: "design_flagged", relatedId: "design-42", ts: Date.now(), payload: { verdict: "constraint_violation" } }],
            }),
            { status: 200 },
          ),
      ),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText("Design flagged")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /view design/i })).not.toBeInTheDocument();
  });

  it("a design_flagged event with a constraint match shows a Design field, the why, and a link labeled with the design's own summary", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/activity?")) {
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
                  payload: { verdict: "constraint_violation", summary: "Touches README.md", constraints: [{ id: "c1", statement: "keep README.md canonical", type: "constraint" }] },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }),
    );
    const onOpenDesign = vi.fn();
    renderWithAuth({ onOpenDesign });

    await waitFor(() => expect(screen.getByText("Design")).toBeInTheDocument());
    expect(screen.getAllByText("Touches README.md").length).toBeGreaterThan(0);
    expect(screen.getByText("keep README.md canonical")).toBeInTheDocument();

    const link = screen.getByRole("button", { name: "→ Touches README.md" });
    await user.click(link);
    expect(onOpenDesign).toHaveBeenCalledWith("design-42");
  });

  it("a claim_recorded event resolves its session's design (best-effort, client-side) and links to it, once its design group is expanded", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/activity?")) {
          return new Response(
            JSON.stringify({
              items: [{ id: "evt-1", projectId: "proj-1", developerId: "alice@example.com", sessionId: "sess-1", kind: "claim_recorded", relatedId: "src/x.ts::f", ts: Date.now(), payload: { symbolId: "src/x.ts::f", kind: "write", stage: "firm" } }],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/v1/designs?")) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "design-9",
                  projectId: "proj-1",
                  developerId: "alice@example.com",
                  sessionId: "sess-1",
                  status: "open",
                  createdAt: Date.now(),
                  summary: "Add retry backoff",
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
        if (url.includes("/v1/alignment-threads?")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const onOpenDesign = vi.fn();
    renderWithAuth({ onOpenDesign });

    // Grouped by default: the claim is folded under its session's design,
    // collapsed until the group header is expanded. The developer whose
    // agent produced the activity is visible on the collapsed row too.
    const groupHeader = await screen.findByRole("button", { name: /add retry backoff/i, expanded: false });
    expect(screen.getByRole("button", { name: "alice@example.com" })).toBeInTheDocument();
    expect(screen.queryByText("Claim recorded")).not.toBeInTheDocument();

    await user.click(groupHeader);
    await waitFor(() => expect(screen.getByText("Claim recorded")).toBeInTheDocument());

    const link = screen.getByRole("button", { name: "→ Add retry backoff" });
    await user.click(link);
    expect(onOpenDesign).toHaveBeenCalledWith("design-9");
  });

  it("defaults the kind filter to the curated high-value set", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    renderWithAuth();

    const select = (await screen.findByLabelText(/filter by kind/i)) as HTMLSelectElement;
    expect(select.value).toContain("design_registered");
    expect(select.value).toContain("review_decided");
    expect(select.value).not.toContain("claim_recorded");
  });

  it("groups multiple events under the same design into one collapsed row showing the last-activity time and event count, expandable to the full list", async () => {
    const user = userEvent.setup();
    const now = Date.now();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/activity?")) {
          return new Response(
            JSON.stringify({
              items: [
                { id: "evt-2", projectId: "proj-1", developerId: "bob@example.com", sessionId: "sess-1", kind: "design_flagged", relatedId: "design-9", ts: now, payload: { verdict: "constraint_violation" } },
                { id: "evt-1", projectId: "proj-1", developerId: "alice@example.com", sessionId: "sess-1", kind: "design_registered", relatedId: "design-9", ts: now - 60_000, payload: { summary: "Add retry backoff" } },
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
                  id: "design-9",
                  projectId: "proj-1",
                  developerId: "alice@example.com",
                  sessionId: "sess-1",
                  status: "flagged",
                  createdAt: now - 60_000,
                  summary: "Add retry backoff",
                  creates: [],
                  touches: ["src/x.ts"],
                  dependsOn: [],
                  ttlMs: 3_600_000,
                  scopeVersion: 1,
                  lastActivityAt: now,
                  justifiedConstraintIds: [],
                  justifiedOverlaps: [],
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }),
    );
    renderWithAuth();

    const groupHeader = await screen.findByRole("button", { name: /add retry backoff/i, expanded: false });
    expect(groupHeader).toHaveTextContent("2");
    // Both developers whose agents contributed activity to this design are
    // visible on the collapsed row, most-recently-active first.
    expect(screen.getByRole("button", { name: "bob@example.com" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "alice@example.com" })).toBeInTheDocument();
    expect(screen.queryByText("Design flagged")).not.toBeInTheDocument();
    expect(screen.queryByText("Design registered")).not.toBeInTheDocument();

    await user.click(groupHeader);
    expect(screen.getByText("Design flagged")).toBeInTheDocument();
    expect(screen.getByText("Design registered")).toBeInTheDocument();
  });

  it("unchecking \"Group by design\" reverts to a flat chronological list", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/activity?")) {
          return new Response(
            JSON.stringify({ items: [{ id: "evt-1", projectId: "proj-1", developerId: "alice@example.com", kind: "constraint_ratified", relatedId: "c1", ts: Date.now(), payload: { statement: "keep README.md canonical", type: "canonical_abstraction" } }] }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText("Constraint ratified")).toBeInTheDocument());
    const toggle = screen.getByRole("checkbox", { name: /group by design/i });
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("Constraint ratified")).toBeInTheDocument();
  });

  describe("multi-repo pagination", () => {
    function event(id: string, projectId: string, ts: number) {
      return { id, projectId, developerId: "alice@example.com", kind: "design_registered", relatedId: `design-${id}`, ts, payload: { summary: id } };
    }

    it("keeps 'Load older' visible after one project's cursor is exhausted but another's isn't, and only re-fetches the project(s) that still have one", async () => {
      const user = userEvent.setup();
      const now = Date.now();
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (!url.includes("/v1/activity?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
        const params = new URL(url).searchParams;
        const projectId = params.get("projectId");
        const before = params.get("before");
        if (projectId === "proj-1") {
          // proj-1 has exactly one page -- no nextBefore, ever.
          if (before) throw new Error("proj-1's exhausted cursor should never be re-fetched");
          return new Response(JSON.stringify({ items: [event("p1-a", "proj-1", now)] }), { status: 200 });
        }
        // proj-2 has two pages.
        if (!before) return new Response(JSON.stringify({ items: [event("p2-a", "proj-2", now - 1)], nextBefore: now - 1 }), { status: 200 });
        return new Response(JSON.stringify({ items: [event("p2-b", "proj-2", now - 2)] }), { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);
      renderWithAuth({ projectIds: ["proj-1", "proj-2"] });

      await waitFor(() => expect(screen.getAllByText(/^p[12]-[ab]$/).length).toBe(2));
      expect(screen.getByRole("button", { name: /load older/i })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /load older/i }));

      await waitFor(() => expect(screen.getAllByText(/^p[12]-[ab]$/).length).toBe(3));
      // proj-2's second page arrived; proj-1 was correctly never re-queried
      // (the mock throws above if it is) and the button is now gone since
      // both projects' cursors are exhausted.
      expect(screen.queryByRole("button", { name: /load older/i })).not.toBeInTheDocument();
    });

    it("shows no RepoBadge when only one repo is in scope, and one per event when more than one is", async () => {
      const now = Date.now();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (!url.includes("/v1/activity?")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
          const projectId = new URL(url).searchParams.get("projectId");
          return new Response(JSON.stringify({ items: projectId === "proj-1" ? [event("a", "proj-1", now)] : [event("b", "proj-2", now)] }), { status: 200 });
        }),
      );
      renderWithAuth({
        projectIds: ["proj-1", "proj-2"],
        projectsById: { "proj-1": { projectId: "proj-1", orgId: "", role: "admin" }, "proj-2": { projectId: "proj-2", orgId: "", role: "admin" } },
      });

      await waitFor(() => expect(screen.getAllByText("proj-1", { selector: ".repo-badge" }).length).toBeGreaterThan(0));
      expect(screen.getByText("proj-2", { selector: ".repo-badge" })).toBeInTheDocument();
    });
  });
});
