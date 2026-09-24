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
    // A "View design ->" click pushes `?focus=<id>` onto jsdom's shared
    // window.location (urlState.ts's pushUrlState) -- without resetting it,
    // the next test's fresh RepoDetailLayout instance still picks it up on
    // mount and tries to resolve that id via the focus page's own
    // GET /v1/designs/:id fetch, which that test's own fetch mock was never
    // written to expect.
    window.history.replaceState(null, "", "/");
  });

  it("clicking 'View design ->' on an Activity row switches to the unified list with that design selected", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/activity") && !url.includes("relatedId")) {
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
        const design42 = {
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
        };
        if (url.includes("/v1/designs?")) {
          return new Response(JSON.stringify({ items: [design42] }), { status: 200 });
        }
        // The focus page's own single-item lookup (GET /v1/designs/:id,
        // 2026-08-29) -- distinct from the list route above.
        if (url.includes("/v1/designs/design-42")) {
          return new Response(JSON.stringify({ design: design42, groupMembers: [] }), { status: 200 });
        }
        if (url.includes("/v1/claims") || url.includes("/v1/alignment-threads") || url.includes("/v1/activity") || url.includes("/v1/reviews")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    // History has no top-bar icon anymore (matches the design mockup,
    // which only keeps Team/Rules) -- land on it directly via URL, the same
    // way a copy-link/bookmark would.
    window.history.pushState(null, "", "?repos=proj-1&tab=activity");
    renderLayout();

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

    // Switched back to the unified home screen automatically (no manual
    // click needed), with that design selected in the detail pane -- it's
    // owned by someone else and is "flagged", not "open", so it's only
    // visible at all because focusDesignId bypasses the list's filters.
    await waitFor(() => expect(screen.getAllByText("A design owned by someone else, currently flagged").length).toBeGreaterThan(0));
    // Touches live under the "Design change" tab now, not inline with
    // everything else -- arrives on Overview by default, same as any other
    // freshly-selected row.
    await user.click(screen.getByRole("button", { name: "Design change" }));
    expect(await screen.findByText("src/x.ts")).toBeInTheDocument();
  });

  it("renders the single-repo name + role badge in the top bar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    renderLayout();

    expect(await screen.findByText("proj-1")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ repos$/)).not.toBeInTheDocument();
  });

  it("renders an 'N repos' switcher with a chip per repo when given more than one project", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    const other: ProjectSummary = { projectId: "proj-2", orgId: "org-1", role: "member", githubOwner: "acme", githubRepo: "widgets" };
    renderLayout([project, other]);

    expect(await screen.findByText("2 repos")).toBeInTheDocument();
    expect(screen.getByText("proj-1")).toBeInTheDocument();
    expect(screen.getByText("acme/widgets")).toBeInTheDocument();
    // No single-repo role badge when aggregating multiple repos.
    expect(screen.queryByText("admin")).not.toBeInTheDocument();
  });

  // Public "observe twing getting built" demo (2026-08-28)
  describe("readOnly", () => {
    it("keeps Conflicts reachable (threads are still viewable) but never fetches /v1/reviews", async () => {
      const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ items: [] }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
      // Conflicts has no top-bar icon anymore (matches the design mockup) --
      // land on it directly via URL, same as a copy-link.
      window.history.pushState(null, "", "?repos=proj-1&tab=conflicts");
      render(
        <ServerProvider>
          <RepoDetailLayout projects={[project]} readOnly />
        </ServerProvider>,
      );

      await screen.findByRole("heading", { name: "Conflicts" });
      await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/v1/alignment-threads"))).toBe(true));
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/v1/reviews"))).toBe(false);
    });

    it("hides the '← All repos' back link when onBack is absent (ObserveApp's own case -- there's nowhere to go back to)", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
      saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
      render(
        <ServerProvider>
          <RepoDetailLayout projects={[project]} readOnly />
        </ServerProvider>,
      );

      await screen.findByRole("button", { name: "twing monitor, go to designs" });
      expect(screen.queryByRole("button", { name: "← All repos" })).not.toBeInTheDocument();
    });

    // The phone stylesheet bounds `.work-shell-home` to the viewport so
    // WorkView's two panes scroll inside themselves. The secondary tabs
    // render into `.content`, which has no overflow of its own, so wearing
    // that modifier clipped them at one viewport with nothing to scroll --
    // `overflow: hidden` still answers a programmatic scrollTop, so the
    // content was present but unreachable by any gesture. jsdom evaluates
    // no CSS, so this pins the class the stylesheet keys off instead.
    it("wears the bounded-shell modifier on the home tab only", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
      const { container } = renderLayout();

      const shell = () => container.querySelector(".work-shell")!;
      await screen.findByRole("button", { name: "twing monitor, go to designs" });
      expect(shell().classList.contains("work-shell-home")).toBe(true);

      await userEvent.setup().click(screen.getByRole("button", { name: "Team" }));
      await screen.findByRole("heading", { name: "Team" });
      expect(shell().classList.contains("work-shell-home")).toBe(false);
    });

    it("still shows the back link when onBack is given, readOnly or not", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
      renderLayout();

      expect(await screen.findByRole("button", { name: "← All repos" })).toBeInTheDocument();
    });
  });
});
