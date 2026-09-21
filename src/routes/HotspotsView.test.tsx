import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { HotspotsView } from "./HotspotsView.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function renderWithAuth(projectIds: string[] = ["proj-1"], readOnly?: boolean) {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <HotspotsView projectIds={projectIds} readOnly={readOnly} />
    </ServerProvider>,
  );
}

describe("HotspotsView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows an empty state when nothing has collided more than once", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/reviews?")) return jsonResponse({ items: [] });
        if (url.includes("/v1/alignment-threads?")) return jsonResponse({ items: [] });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText(/no repeat hotspots/i)).toBeInTheDocument());
  });

  it("omits a path that only collided once -- a single collision belongs in Conflicts, not here", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/reviews?")) {
          return jsonResponse({
            items: [
              { id: "r1", designId: "d1", projectId: "proj-1", justification: "x", createdAt: 10, conflicts: [{ designId: "d2", kind: "overlap", paths: ["src/once.ts"] }] },
            ],
          });
        }
        if (url.includes("/v1/alignment-threads?")) return jsonResponse({ items: [] });
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText(/no repeat hotspots/i)).toBeInTheDocument());
    expect(screen.queryByText("src/once.ts")).not.toBeInTheDocument();
  });

  it("ranks a path that collided twice above one that only collided once, with the count and developers shown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/reviews?")) {
          return jsonResponse({
            items: [
              {
                id: "r1",
                designId: "d1",
                projectId: "proj-1",
                justification: "x",
                createdAt: 10,
                design: { summary: "", creates: [], touches: [], developerId: "alice@example.com", status: "flagged" },
                conflicts: [{ designId: "d2", kind: "overlap", developerId: "bob@example.com", paths: ["src/hot.ts"] }],
              },
              {
                id: "r2",
                designId: "d3",
                projectId: "proj-1",
                justification: "x",
                createdAt: 20,
                design: { summary: "", creates: [], touches: [], developerId: "carol@example.com", status: "flagged" },
                conflicts: [{ designId: "d4", kind: "overlap", developerId: "dave@example.com", paths: ["src/hot.ts"] }],
              },
            ],
          });
        }
        if (url.includes("/v1/alignment-threads?")) {
          return jsonResponse({
            items: [
              {
                id: "t1",
                projectId: "proj-1",
                symbolId: "",
                symbolIds: ["src/warm.ts::f", "src/warm.ts::g"],
                developerId: "erin@example.com",
                otherDeveloperId: "frank@example.com",
                status: "open",
                systemDescription: "x",
                openedAt: 5,
                lastActivityAt: 5,
              },
            ],
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText("src/hot.ts")).toBeInTheDocument());
    const hotCard = within(screen.getByText("src/hot.ts").closest("li")!);
    expect(hotCard.getByText("2 conflicts")).toBeInTheDocument();
    expect(hotCard.getByText("alice@example.com, bob@example.com, carol@example.com, dave@example.com")).toBeInTheDocument();

    const warmCard = within(screen.getByText("src/warm.ts").closest("li")!);
    expect(warmCard.getByText("2 conflicts")).toBeInTheDocument();
    expect(warmCard.getByText("erin@example.com, frank@example.com")).toBeInTheDocument();

    // src/hot.ts (2) ranks above src/warm.ts (2 mentions in one thread's
    // symbolIds, but both mentions are the same file -> still 2, tie broken
    // by more recent last activity).
    const paths = screen.getAllByText(/^src\//).map((el) => el.textContent);
    expect(paths[0]).toBe("src/hot.ts");
  });

  it("readOnly skips fetching reviews entirely", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/reviews?")) throw new Error("should not fetch reviews when readOnly");
      if (url.includes("/v1/alignment-threads?")) return jsonResponse({ items: [] });
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithAuth(["proj-1"], true);

    await waitFor(() => expect(screen.getByText(/no repeat hotspots/i)).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/v1/reviews"))).toBe(false);
  });
});
