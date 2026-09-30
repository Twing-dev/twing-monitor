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
        return new Response(JSON.stringify({ items: designs }), { status: 200 });
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

/** Which design the detail pane is showing. Asks the title specifically
 * rather than the pane as a whole: the pane also holds the rest of the
 * summary, the declared changes and the discussion, any of which can quote
 * the same words back. */
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

  // The detail pane used to print a design's opening sentence twice: once
  // ellipsised into the title, once in full as the first thing under "What
  // this design says it's doing". Both halves of the fix are pinned here --
  // the title carries the first point, and the body carries only what's
  // left of the summary.
  describe("detail pane summary", () => {
    it("shows a single-sentence summary once, with no empty overview section under it", async () => {
      stubApi([design()]);
      const { container } = renderWork();
      await waitFor(() => expect(openDesignTitle(container)).toBe("Add retry backoff to the sync client"));

      const pane = detailPane(container);
      expect(within(pane).getAllByText("Add retry backoff to the sync client")).toHaveLength(1);
      expect(within(pane).queryByText(/what this design says it/i)).not.toBeInTheDocument();
    });

    it("puts the first point in the title and only the remaining ones in the body", async () => {
      const summary = "Record the group a design was born into, so a stacked design is attributable.\n\nUpdate (2026-09-29): also bump the packages so this ships under a version that identifies it.";
      stubApi([design({ summary })]);
      const { container } = renderWork();
      await waitFor(() => expect(openDesignTitle(container)).toBe("Record the group a design was born into, so a stacked design is attributable."));

      const pane = detailPane(container);
      // The headline is in the title and nowhere else in the pane...
      expect(within(pane).getAllByText(/Record the group a design was born into/)).toHaveLength(1);
      // ...and the amendment, which the title can't show, is still readable.
      expect(within(pane).getByText(/also bump the packages/)).toBeInTheDocument();
    });
  });

  // The pane used to state a design's status, its section and its conflict
  // count without ever saying what any of it meant you should do.
  describe("detail pane verdict", () => {
    it("leads with what a flagged design needs, on every tab", async () => {
      stubApi([design({ status: "flagged" })]);
      const { container } = renderWork();
      await waitFor(() => expect(openDesignTitle(container)).toBe("Add retry backoff to the sync client"));

      const pane = detailPane(container);
      expect(within(pane).getByText(/needs a decision/i)).toBeInTheDocument();

      // Sits above the tab strip, so switching tabs doesn't hide it.
      await userEvent.click(within(pane).getByRole("button", { name: "Activity" }));
      await waitFor(() => expect(within(detailPane(container)).getByText(/needs a decision/i)).toBeInTheDocument());
    });

    it("stays silent on a design with nothing wrong", async () => {
      stubApi([design()]);
      const { container } = renderWork();
      await waitFor(() => expect(openDesignTitle(container)).toBe("Add retry backoff to the sync client"));
      expect(detailPane(container).querySelector(".work-verdict")).not.toBeInTheDocument();
    });
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

  // A `--group`-linked chain renders one panel per member, because comments
  // and declared changes are per design. Until now those panels carried no
  // name, status or date, so four designs read as one panel rendered four
  // times -- see MemberPanel.
  describe("a linked group's stacked member panels", () => {
    const linked = [
      design({ id: "d-1", groupId: "g-1", summary: "Add enforced release workflows", status: "flagged" }),
      design({ id: "d-2", groupId: "g-1", summary: "Make Codex trust tests independent", status: "open" }),
    ];

    it("names every member, not just the one the header uses", async () => {
      stubApi(linked);
      const { container } = renderWork();
      await waitFor(() => expect(container.querySelectorAll(".member-panel").length).toBeGreaterThan(0));
      const pane = detailPane(container);
      // Both summaries reachable without expanding anything. The header shows
      // only `members[0]`, so the second one is the regression this pins.
      expect(within(pane).getAllByText("Add enforced release workflows").length).toBeGreaterThan(0);
      expect(within(pane).getAllByText("Make Codex trust tests independent").length).toBeGreaterThan(0);
    });

    it("shows each member's own status", async () => {
      stubApi(linked);
      const { container } = renderWork();
      await waitFor(() => expect(container.querySelectorAll(".member-panel-heading").length).toBeGreaterThan(0));
      const headings = Array.from(container.querySelectorAll(".member-panel-heading")).map((h) => h.textContent ?? "");
      expect(headings.some((h) => h.includes("flagged"))).toBe(true);
      expect(headings.some((h) => h.includes("open"))).toBe(true);
    });

    it("says how many designs are linked", async () => {
      stubApi(linked);
      const { container } = renderWork();
      await waitFor(() => expect(within(detailPane(container)).getByText(/2 linked designs/i)).toBeInTheDocument());
    });

    // The common case, and the one that must not regress: a lone design keeps
    // the bare rendering it has always had.
    it("labels nothing when the group has one member", async () => {
      stubApi([design()]);
      const { container } = renderWork();
      await waitFor(() => expect(container.querySelector(".work-detail-changes")).toBeInTheDocument());
      expect(container.querySelector(".member-panel")).not.toBeInTheDocument();
      expect(within(detailPane(container)).queryByText(/linked designs/i)).not.toBeInTheDocument();
    });

    // The badge is a cross-repo label (that is what groupId is for). Within one
    // repo it repeated the header's own repo once per member, which was most of
    // what read as duplication.
    it("omits the repo badge when every member is in the same repo", async () => {
      stubApi(linked);
      const { container } = renderWork(["proj-1", "proj-2"]);
      await waitFor(() => expect(container.querySelectorAll(".member-panel").length).toBeGreaterThan(0));
      for (const panel of container.querySelectorAll(".member-panel-heading")) {
        expect(panel.querySelector(".repo-badge")).toBeNull();
      }
    });

    it("keeps the repo badge when the group really does span repos", async () => {
      stubApi([linked[0], design({ id: "d-2", groupId: "g-1", projectId: "proj-2", summary: "Sibling in another repo" })]);
      const { container } = renderWork(["proj-1", "proj-2"]);
      await waitFor(() => expect(container.querySelectorAll(".member-panel").length).toBeGreaterThan(0));
      expect(container.querySelector(".member-panel-heading .repo-badge")).toBeInTheDocument();
    });
  });

  it("renders the detail tab strip for the selected design", async () => {
    stubApi([design()]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".work-tabs")).toBeInTheDocument());
    const tabs = container.querySelector(".work-tabs") as HTMLElement;
    expect(within(tabs).getByText(/overview/i)).toBeInTheDocument();
    expect(within(tabs).getByText(/ask/i)).toBeInTheDocument();
  });

  // A summary with no split in it goes in the header and nowhere else.
  // Regression: the header used a 120-character clamp, so a longer
  // unsplittable summary always differed from its own text, the "is there
  // anything left to show" test passed, and the body reprinted the whole
  // thing -- 11 characters of new information under a near-identical title.
  it("does not reprint an unsplittable summary under the header", async () => {
    const long =
      "Resolve PR #17's conflict with its rebased base so the six UI defect fixes and the linked-group labels plus review rail all survive";
    expect(long.length).toBeGreaterThan(120); // the clamp is what used to trip
    stubApi([design({ summary: long })]);
    const { container } = renderWork();
    await waitFor(() => expect(openDesignTitle(container)).toBe(long));

    // The header carries it whole, so the Overview body says nothing further.
    expect(within(detailPane(container)).queryByText(/what this design says/i)).not.toBeInTheDocument();
    expect(container.querySelector(".summary-bullets")).not.toBeInTheDocument();
    // And it appears once in the detail pane, not twice.
    expect(within(detailPane(container)).getAllByText(long)).toHaveLength(1);
  });

  // The splittable case still splits: header takes point one, body takes the
  // rest. Pinned alongside the above so "don't reprint" can't be satisfied by
  // rendering nothing at all.
  it("still puts the remaining points in the body when the summary splits", async () => {
    stubApi([design({ summary: "Add retry backoff to the sync client. Cap the delay at thirty seconds." })]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".summary-bullets")).toBeInTheDocument());
    expect(openDesignTitle(container)).toContain("Add retry backoff");
    expect(container.querySelector(".summary-bullets")?.textContent).toContain("Cap the delay");
  });

  // Design change stopped being its own tab (2026-09) -- its content is a
  // section at the bottom of Overview now. These two pin both halves of that:
  // the tab is gone, and the content it held still renders without one.
  it("no longer offers a Design change tab", async () => {
    stubApi([design()]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".work-tabs")).toBeInTheDocument());
    const tabs = container.querySelector(".work-tabs") as HTMLElement;
    expect(within(tabs).queryByText(/design change/i)).not.toBeInTheDocument();
  });

  it("shows the declared scope in Overview, with no tab to click", async () => {
    // Two points on purpose. The header takes the first and the body renders
    // what's left, so a one-sentence summary (the bare `design()` fixture)
    // renders no summary block at all, and there would be no "above" for the
    // ordering assertion below to mean anything against.
    stubApi([design({ summary: "Add retry backoff to the sync client. Cap the delay at thirty seconds." })]);
    const { container } = renderWork();
    // The fixture declares `touches` and no structured `changes`, and the stub
    // answers /v1/claims with an empty page -- so this is the legacy
    // `PathList` rendering, reached without touching the tab strip.
    await waitFor(() => expect(within(detailPane(container)).getByText("src/net/retry.ts")).toBeInTheDocument());
    const changes = container.querySelector(".work-detail-changes")!;
    expect(changes).toBeInTheDocument();

    // Order is the point of the merge, not just presence: what it changes
    // reads after the summary saying what it's doing.
    // DOCUMENT_POSITION_FOLLOWING (4) means the changes come after.
    const summary = container.querySelector('[data-field="summary"]')!;
    expect(summary.compareDocumentPosition(changes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // And it sits inside the review scope, not merely below it: a declared
    // change has to be highlightable like the summary is, which only holds
    // while it renders within `DesignReview`'s content side.
    expect(container.querySelector(".review-content")).toContainElement(changes as HTMLElement);
  });

  // The seam between the de-duplicated header and anchored review comments:
  // the body renders `points` minus the one the header took, so a bullet's
  // highlight offset has to be read one further along the unsliced list. Off
  // by one here and every summary comment resolves against the wrong bullet --
  // silently, with nothing failing anywhere.
  it("offsets a body bullet past the point the header took", async () => {
    stubApi([design({ summary: "Add retry backoff to the sync client. Cap the delay at thirty seconds." })]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector('[data-field="summary"]')).toBeInTheDocument());

    const blocks = Array.from(container.querySelectorAll('.summary-bullets [data-field="summary"]'));
    expect(blocks).toHaveLength(1);
    // The header shows the first point, so the single body bullet is the
    // second -- its offset must be where that sentence actually starts, not 0.
    expect(blocks[0].textContent).toContain("Cap the delay");
    expect(Number(blocks[0].getAttribute("data-offset"))).toBeGreaterThan(0);
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
