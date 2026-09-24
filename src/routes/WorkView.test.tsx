/**
 * `WorkView` -- the app's home screen, and until now the largest untested
 * file in it.
 *
 * Written *before* the phone layout work, deliberately: that change touches
 * selection, and "the desktop view does not change" needs to be a passing
 * test rather than a claim. Everything here describes behaviour as it is
 * today, on a desktop-width viewport (jsdom has no `matchMedia`, which the
 * phone hook reads as "not a phone"), so a regression shows up as a failure
 * instead of as something to notice by eye.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { WorkView } from "./WorkView.js";

function design(overrides: Record<string, unknown> = {}) {
  return {
    id: "design-1",
    projectId: "proj-1",
    developerId: "alice@example.com",
    sessionId: "7f3a1c42-9e21-4b6d-8a55-0c1e2d3f4a5b",
    status: "open",
    createdAt: Date.now(),
    summary: "Add retry backoff to the sync client",
    creates: [],
    touches: ["src/net/retry.ts"],
    dependsOn: [],
    ttlMs: 1000,
    scopeVersion: 1,
    lastActivityAt: Date.now(),
    justifiedConstraintIds: [],
    justifiedOverlaps: [],
    ...overrides,
  };
}

/** Routes every request this view makes. Anything unrecognised returns an
 * empty page rather than 404, so a new fetch added to the view degrades to
 * "no data" instead of failing every test here for an unrelated reason. */
function stubApi(designs: Record<string, unknown>[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/designs?") || url.includes("/v1/designs&")) {
        // Scoped by `projectId` the way the real endpoint is: the view fans
        // one fetch out per selected repo and merges the results, so an
        // unscoped stub returns every design once per repo and a
        // multi-repo test ends up with duplicate ids in one group.
        const projectId = new URL(url, "https://example.invalid").searchParams.get("projectId");
        return new Response(JSON.stringify({ items: designs.filter((d) => d.projectId === projectId) }), { status: 200 });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }),
  );
}

/** Re-queried per assertion rather than captured: React replaces the pane's
 * subtree when the selection resolves, so a held reference goes stale and
 * every `waitFor` against it times out. */
function detailPane(container: HTMLElement): HTMLElement {
  return container.querySelector(".work-pane-detail") as HTMLElement;
}

/** Which design the detail pane is showing. The summary appears twice in
 * that pane -- as the title and again in the Overview body -- so "is this
 * design open" has to ask the title rather than the pane as a whole. */
function openDesignTitle(container: HTMLElement): string {
  return container.querySelector(".work-detail-title")?.textContent?.trim() ?? "";
}

function listPane(container: HTMLElement): HTMLElement {
  return container.querySelector(".work-pane-list") as HTMLElement;
}

function renderWork(projectIds = ["proj-1"], query = "") {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <WorkView projectIds={projectIds} projectsById={{}} query={query} onQueryChange={() => {}} />
    </ServerProvider>,
  );
}

describe("WorkView (desktop baseline)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders a row per design in the list pane", async () => {
    stubApi([design(), design({ id: "design-2", summary: "Second thing" })]);
    renderWork();
    await waitFor(() => expect(screen.getByText("Add retry backoff to the sync client")).toBeInTheDocument());
    expect(screen.getByText("Second thing")).toBeInTheDocument();
  });

  it("says so when nothing matches the filter", async () => {
    stubApi([]);
    renderWork();
    await waitFor(() => expect(screen.getByText(/no designs match this filter/i)).toBeInTheDocument());
  });

  // The behaviour the phone layout has to change, pinned here as it is on a
  // desktop: both panes are visible at once, so the detail pane must never
  // sit empty.
  it("auto-selects the first row, so the detail pane is never blank", async () => {
    stubApi([design(), design({ id: "design-2", summary: "Second thing" })]);
    const { container } = renderWork();
    // Waited on the *list*, not the document: once a row is auto-selected the
    // summary is in both panes, and `getByText` throws on multiple matches --
    // so a global wait here times out rather than passing.
    await waitFor(() => expect(within(listPane(container)).getByText("Add retry backoff to the sync client")).toBeInTheDocument());

    // Scoped to the pane, not the document: the summary appears in the list
    // too, so a global query proves nothing about which pane rendered it.
    // Re-queried inside `waitFor` rather than captured once -- React
    // replaces the subtree when the selection resolves, and a captured node
    // goes stale.
    await waitFor(() => expect(openDesignTitle(container)).toBe("Add retry backoff to the sync client"));
    expect(within(detailPane(container)).queryByText(/select a design to see its details/i)).not.toBeInTheDocument();
  });

  it("shows both panes at once", async () => {
    stubApi([design()]);
    const { container } = renderWork();
    await waitFor(() => expect(screen.getByText("Add retry backoff to the sync client")).toBeInTheDocument());
    expect(container.querySelector(".work-pane-list")).toBeInTheDocument();
    expect(container.querySelector(".work-pane-detail")).toBeInTheDocument();
  });

  it("opens a clicked row in the detail pane", async () => {
    stubApi([design(), design({ id: "design-2", summary: "Second thing" })]);
    const { container } = renderWork();
    await waitFor(() => expect(within(listPane(container)).getByText("Second thing")).toBeInTheDocument());

    // The first row is auto-selected, so assert the detail actually moves.
    await waitFor(() => expect(openDesignTitle(container)).toBe("Add retry backoff to the sync client"));

    await userEvent.click(within(listPane(container)).getByText("Second thing"));
    await waitFor(() => expect(openDesignTitle(container)).toBe("Second thing"));
  });

  it("offers the filter pills and narrows the list with them", async () => {
    stubApi([design(), design({ id: "design-2", summary: "Second thing", status: "closed" })]);
    const { container } = renderWork();
    await waitFor(() => expect(screen.getByText("Add retry backoff to the sync client")).toBeInTheDocument());
    // The pills themselves are part of the list pane's chrome; clicking one
    // must not throw or empty the view.
    const list = listPane(container);
    const pills = within(list)
      .getAllByRole("button")
      .filter((b) => b.className.includes("work-pill"));
    expect(pills.length).toBeGreaterThan(1);

    // "Resolved" holds the closed design and not the open one -- the pills
    // genuinely narrow the list rather than just restyling themselves.
    const resolved = pills.find((p) => /resolved/i.test(p.textContent ?? ""))!;
    await userEvent.click(resolved);
    await waitFor(() => expect(within(list).queryByText("Add retry backoff to the sync client")).not.toBeInTheDocument());
    expect(within(list).getByText("Second thing")).toBeInTheDocument();
  });

  it("filters by the search query it is given", async () => {
    stubApi([design(), design({ id: "design-2", summary: "Completely unrelated" })]);
    renderWork(["proj-1"], "retry backoff");
    await waitFor(() => expect(screen.getByText("Add retry backoff to the sync client")).toBeInTheDocument());
    expect(screen.queryByText("Completely unrelated")).not.toBeInTheDocument();
  });

  it("renders the detail tab strip for the selected design", async () => {
    stubApi([design()]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".work-tabs")).toBeInTheDocument());
    const tabs = container.querySelector(".work-tabs") as HTMLElement;
    expect(within(tabs).getByText(/overview/i)).toBeInTheDocument();
    expect(within(tabs).getByText(/ask/i)).toBeInTheDocument();
  });

  // The panes are replaced wholesale by an error message -- worth pinning,
  // because the phone layout below keys off which pane is showing and must
  // not assume one is always present.
  it("replaces the panes with a readable error when the coordinator fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 500 })));
    const { container } = renderWork();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load/i));
    expect(container.querySelector(".work-body")).not.toBeInTheDocument();
  });
});

/**
 * A `--group`-linked chain is one row and one detail pane, but comments,
 * chat and conformance are all per design -- so each tab body stacks one
 * panel per member. Nothing inside those panels varies with which member it
 * is (`summary` propagates across a group server-side; DesignChat and
 * DesignComments each render a fixed heading), so before this they read as
 * the same panel rendered twice. These pin the labelling that tells them
 * apart, and pin that a group of one gains nothing.
 */
describe("WorkView grouped-design member panels", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Two designs sharing a `groupId` in the *same* repo -- registered by
   * hand with the same `--group`, the case that produced two identical Ask
   * sections both badged with the one repo. */
  function linkedPair() {
    return [
      design({ id: "design-1", groupId: "grp-1", developerId: "alice@example.com", lastActivityAt: 2_000_000 }),
      design({ id: "design-2", groupId: "grp-1", developerId: "bob@example.com", status: "closed", lastActivityAt: 1_000_000 }),
    ];
  }

  async function openAskTab(container: HTMLElement) {
    await waitFor(() => expect(container.querySelector(".work-tabs")).toBeInTheDocument());
    await userEvent.click(within(container.querySelector(".work-tabs") as HTMLElement).getByText(/^ask$/i));
    return container.querySelector(".work-tab-panel") as HTMLElement;
  }

  it("collapses a linked pair to one row", async () => {
    stubApi(linkedPair());
    const { container } = renderWork();
    await waitFor(() => expect(within(listPane(container)).getAllByText("Add retry backoff to the sync client")).toHaveLength(1));
  });

  it("labels each member's Ask panel so two of them are not the same panel twice", async () => {
    stubApi(linkedPair());
    const { container } = renderWork();
    const panel = await openAskTab(container);

    // Two chats, because chat is keyed by design id -- they are genuinely
    // two private threads, which is exactly why they need telling apart.
    await waitFor(() => expect(panel.querySelectorAll(".design-chat")).toHaveLength(2));

    const headings = panel.querySelectorAll(".work-member-heading");
    expect(headings).toHaveLength(2);
    expect(headings[0].textContent).toContain("alice@example.com");
    expect(headings[1].textContent).toContain("bob@example.com");
    // Per-member `status` does not propagate across a group, so it is a real
    // distinguisher rather than a repeat of the header's.
    expect(headings[1].textContent).toContain("closed");
  });

  it("labels the members' comment panels on Overview too", async () => {
    stubApi(linkedPair());
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".work-tab-panel")).toBeInTheDocument());
    const panel = container.querySelector(".work-tab-panel") as HTMLElement;
    await waitFor(() => expect(panel.querySelectorAll(".work-member-heading")).toHaveLength(2));
  });

  it("adds no heading for a group of one, where the detail header already says it all", async () => {
    stubApi([design()]);
    const { container } = renderWork();
    const panel = await openAskTab(container);
    await waitFor(() => expect(panel.querySelectorAll(".design-chat")).toHaveLength(1));
    expect(panel.querySelector(".work-member-heading")).not.toBeInTheDocument();
  });

  // The duplication the bug report actually named: the same repo badge
  // rendered once per member, under a header that already names that repo.
  it("badges a member only when the group spans repos", async () => {
    stubApi(linkedPair());
    const { container } = renderWork(["proj-1", "proj-2"]);
    const panel = await openAskTab(container);
    await waitFor(() => expect(panel.querySelectorAll(".work-member-heading")).toHaveLength(2));
    expect(panel.querySelector(".repo-badge")).not.toBeInTheDocument();
  });

  it("keeps the badge when the group really does span repos", async () => {
    stubApi([
      design({ id: "design-1", groupId: "grp-1", projectId: "proj-1", lastActivityAt: 2_000_000 }),
      design({ id: "design-2", groupId: "grp-1", projectId: "proj-2", lastActivityAt: 1_000_000 }),
    ]);
    const { container } = renderWork(["proj-1", "proj-2"]);
    const panel = await openAskTab(container);
    await waitFor(() => expect(panel.querySelectorAll(".work-member-heading")).toHaveLength(2));
    expect(panel.querySelectorAll(".repo-badge")).toHaveLength(2);
  });
});

/**
 * Phone layout. jsdom computes no layout, so these assert the *behaviour*
 * the stylesheet keys off -- which pane `data-phone-pane` names, and whether
 * a row is auto-selected -- rather than anything visual. The CSS itself is
 * verified in a browser.
 */
describe("WorkView (phone)", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** jsdom has no matchMedia; the hook reads its absence as "desktop", so a
   * phone test has to supply one. */
  function asPhone() {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: "(max-width: 640px)",
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      })),
    );
  }

  // The reason this needed a JS change at all: auto-selecting on a phone
  // opens the first design over the list every time, and the list is then
  // unreachable.
  it("shows the list first, with nothing auto-selected", async () => {
    asPhone();
    stubApi([design(), design({ id: "design-2", summary: "Second thing" })]);
    const { container } = renderWork();

    await waitFor(() => expect(within(listPane(container)).getByText("Add retry backoff to the sync client")).toBeInTheDocument());
    expect(container.querySelector(".work-body")?.getAttribute("data-phone-pane")).toBe("list");
  });

  it("opens a design when a row is tapped", async () => {
    asPhone();
    stubApi([design(), design({ id: "design-2", summary: "Second thing" })]);
    const { container } = renderWork();
    await waitFor(() => expect(within(listPane(container)).getByText("Second thing")).toBeInTheDocument());

    await userEvent.click(within(listPane(container)).getByText("Second thing"));

    await waitFor(() => expect(container.querySelector(".work-body")?.getAttribute("data-phone-pane")).toBe("detail"));
    expect(openDesignTitle(container)).toBe("Second thing");
  });

  it("goes back to the list, and keeps it mounted rather than unmounting it", async () => {
    asPhone();
    stubApi([design(), design({ id: "design-2", summary: "Second thing" })]);
    const { container } = renderWork();
    await waitFor(() => expect(within(listPane(container)).getByText("Second thing")).toBeInTheDocument());
    await userEvent.click(within(listPane(container)).getByText("Second thing"));
    await waitFor(() => expect(container.querySelector(".work-body")?.getAttribute("data-phone-pane")).toBe("detail"));

    await userEvent.click(screen.getByRole("button", { name: /all designs/i }));

    await waitFor(() => expect(container.querySelector(".work-body")?.getAttribute("data-phone-pane")).toBe("list"));
    // Mounting is all this asserts. Scroll position is a separate mechanism
    // with its own test below -- the two were conflated in this test's
    // original name, which claimed a guarantee it never checked.
    expect(listPane(container)).toBeInTheDocument();
  });

  // The list is hidden with `display: none`, which takes it out of the
  // layout tree and resets `scrollTop` -- so bounding the pane stops the
  // page collapsing but does not on its own bring you back to where you
  // were. jsdom applies no CSS, so the reset is simulated here; what is
  // under test is that the offset is recorded on the way in and put back on
  // the way out.
  it("returns you to where you were in the list, not to the top", async () => {
    asPhone();
    stubApi([design(), design({ id: "design-2", summary: "Second thing" })]);
    const { container } = renderWork();
    await waitFor(() => expect(within(listPane(container)).getByText("Second thing")).toBeInTheDocument());

    listPane(container).scrollTop = 420;
    await userEvent.click(within(listPane(container)).getByText("Second thing"));
    await waitFor(() => expect(container.querySelector(".work-body")?.getAttribute("data-phone-pane")).toBe("detail"));

    // What the browser does to a `display: none` pane.
    listPane(container).scrollTop = 0;

    await userEvent.click(screen.getByRole("button", { name: /all designs/i }));
    await waitFor(() => expect(listPane(container).scrollTop).toBe(420));
  });

  it("does not touch scroll position on desktop, where the list never hides", async () => {
    // No `asPhone()` -- the restore is guarded, so a desktop render must
    // leave the pane's offset alone.
    stubApi([design(), design({ id: "design-2", summary: "Second thing" })]);
    const { container } = renderWork();
    await waitFor(() => expect(within(listPane(container)).getByText("Second thing")).toBeInTheDocument());

    listPane(container).scrollTop = 120;
    await userEvent.click(within(listPane(container)).getByText("Second thing"));
    await new Promise((r) => setTimeout(r, 20));
    expect(listPane(container).scrollTop).toBe(120);
  });

  it("does not re-open a design by itself after going back", async () => {
    asPhone();
    stubApi([design(), design({ id: "design-2", summary: "Second thing" })]);
    const { container } = renderWork();
    await waitFor(() => expect(within(listPane(container)).getByText("Second thing")).toBeInTheDocument());
    await userEvent.click(within(listPane(container)).getByText("Second thing"));
    await userEvent.click(screen.getByRole("button", { name: /all designs/i }));

    // The auto-select effect re-runs on every list change; on a phone it
    // must stay out of the way.
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector(".work-body")?.getAttribute("data-phone-pane")).toBe("list");
  });
});

// The control is in the desktop DOM too -- hidden by CSS, so the render tree
// differs by exactly one element and nothing is gated on a second branch.
describe("WorkView back control on desktop", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is present but leaves both panes rendered", async () => {
    stubApi([design()]);
    const { container } = renderWork();
    await waitFor(() => expect(within(listPane(container)).getByText("Add retry backoff to the sync client")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /all designs/i })).toBeInTheDocument();
    expect(listPane(container)).toBeInTheDocument();
    expect(detailPane(container)).toBeInTheDocument();
  });
});
