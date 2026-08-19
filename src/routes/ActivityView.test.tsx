import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { ActivityView, type ActivityViewProps } from "./ActivityView.js";

function renderWithAuth(props: Partial<Omit<ActivityViewProps, "projectId">> = {}) {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <ActivityView projectId="proj-1" {...props} />
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
              items: [{ id: "evt-1", projectId: "proj-1", developerId: "alice@example.com", kind: "design_flagged", relatedId: "design-42", ts: Date.now(), payload: { verdict: "overlap" } }],
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
              items: [{ id: "evt-1", projectId: "proj-1", developerId: "alice@example.com", kind: "design_flagged", relatedId: "design-42", ts: Date.now(), payload: { verdict: "overlap" } }],
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
                  payload: { verdict: "constraint_flag", summary: "Touches README.md", constraint: { id: "c1", statement: "keep README.md canonical", type: "canonical_abstraction" } },
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
    expect(screen.getByText("[canonical abstraction] keep README.md canonical")).toBeInTheDocument();

    const link = screen.getByRole("button", { name: "→ Touches README.md" });
    await user.click(link);
    expect(onOpenDesign).toHaveBeenCalledWith("design-42");
  });

  it("a claim_recorded event resolves its session's design (best-effort, client-side) and links to it", async () => {
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
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const onOpenDesign = vi.fn();
    renderWithAuth({ onOpenDesign });

    await waitFor(() => expect(screen.getByText("Claim recorded")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Add retry backoff")).toBeInTheDocument());

    const link = screen.getByRole("button", { name: "→ Add retry backoff" });
    await user.click(link);
    expect(onOpenDesign).toHaveBeenCalledWith("design-9");
  });
});
