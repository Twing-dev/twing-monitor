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
import { DETAIL_TITLE_CHARS } from "../lib/designTitle.js";

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
      // Two paragraphs the *author* wrote. This fixture used to use an
      // appended `Update (date):` entry as its second point, which stopped
      // exercising this rule once amendments moved into their own disclosure
      // (2026-10-06) -- the body then had no second point to show. The rule
      // under test is unchanged: the header takes the first point and the
      // body takes what is left. Amendments have their own tests below.
      const summary = "Record the group a design was born into, so a stacked design is attributable.\n\nIt also bumps the packages so this ships under a version that identifies it.";
      stubApi([design({ summary })]);
      const { container } = renderWork();
      await waitFor(() => expect(openDesignTitle(container)).toBe("Record the group a design was born into, so a stacked design is attributable."));

      const pane = detailPane(container);
      // The headline is in the title and nowhere else in the pane...
      expect(within(pane).getAllByText(/Record the group a design was born into/)).toHaveLength(1);
      // ...and the second point, which the title can't show, is still readable.
      expect(within(pane).getByText(/also bumps the packages/)).toBeInTheDocument();
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

  it("narrows the list through the Showing selector", async () => {
    stubApi([design(), design({ id: "design-2", summary: "Second thing", status: "closed" })]);
    const { container } = renderWork();
    await waitFor(() => expect(screen.getByText("Add retry backoff to the sync client")).toBeInTheDocument());
    const list = listPane(container);
    // The list opens complete, so both are here.
    expect(within(list).getByText("Second thing")).toBeInTheDocument();

    // Asking for Closed genuinely narrows it rather than restyling a
    // control: the open design goes, the closed one stays.
    await userEvent.selectOptions(screen.getByLabelText("Finished work"), "closed");
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

    /* The overview panel used to render `group.members[0]` and nothing else, so
       a design spanning two repos showed one overview and dropped the other's
       prose entirely (found live 2026-10-07). The tests above do not catch it:
       they assert both summaries are reachable *somewhere* in the pane, which
       the member panels at the foot satisfy with a truncated card title while
       the overview itself is still missing. So these ask the overview sections
       specifically. */
    describe("overview, per linked design", () => {
      const twoRepos = [
        design({ id: "d-1", groupId: "g-1", projectId: "proj-1", summary: "Give the owner an inline way to edit a title. The sibling carries the route." }),
        design({ id: "d-2", groupId: "g-1", projectId: "proj-2", summary: "Carry the schema and the store method. Add the owner-only overview route." }),
      ];

      /** `stubApi`, but filtered by the `projectId` in the query -- which is
       * what `GET /v1/designs` actually does.
       *
       * The shared stub answers every project's query with the whole fixture
       * list, so a two-project selection fetches twice and the same design
       * arrives twice, landing in its group as two members. The existing
       * group tests never see it because they assert counts loosely
       * (`length > 0`); a test counting overview sections does, and would be
       * pinning that duplication rather than this fix. Collapsing a design
       * that arrives twice is its own open piece of work
       * (`fix/work-detail-duplicate-member-panels`), deliberately not
       * addressed here. */
      function stubApiByProject(designs: Record<string, unknown>[]) {
        vi.stubGlobal(
          "fetch",
          vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("/v1/designs?") || url.includes("/v1/designs&")) {
              const projectId = new URL(url, "https://example.test").searchParams.get("projectId");
              return new Response(JSON.stringify({ items: designs.filter((d) => d.projectId === projectId) }), { status: 200 });
            }
            return new Response(JSON.stringify({ items: [] }), { status: 200 });
          }),
        );
      }

      it("renders one overview section per member", async () => {
        stubApiByProject(twoRepos);
        const { container } = renderWork(["proj-1", "proj-2"]);
        await waitFor(() => expect(container.querySelectorAll(".work-overview-section").length).toBe(2));
      });

      /* One heading for the group, not one per design. A linked group is one
         piece of work spanning repos, so a heading above each half read as
         two unrelated designs and printed the same sentence twice. The repo
         label on each design's control row is what tells them apart. */
      it("heads the whole group with a single overview heading", async () => {
        stubApiByProject(twoRepos);
        const { container } = renderWork(["proj-1", "proj-2"]);
        await waitFor(() => expect(container.querySelectorAll(".work-overview-section").length).toBe(2));
        const headings = within(detailPane(container)).getAllByText(/what this design says it/i);
        expect(headings).toHaveLength(1);
      });

      /* The label has to sit with the buttons it qualifies: those act on one
         design, and a reader needs to know which before pressing one. */
      it("puts each design's repo label on its own control row", async () => {
        stubApiByProject(twoRepos);
        const { container } = renderWork(["proj-1", "proj-2"]);
        await waitFor(() => expect(container.querySelectorAll(".work-overview-section").length).toBe(2));
        const rows = container.querySelectorAll(".work-overview-section .overview-edit-row");
        expect(rows).toHaveLength(2);
        for (const row of rows) {
          expect(row.querySelector(".overview-repo-label")).toBeInTheDocument();
          expect(within(row as HTMLElement).getByRole("button", { name: /rephrase overview/i })).toBeInTheDocument();
        }
      });

      it("shows each member's own overview prose, not only the first's", async () => {
        stubApiByProject(twoRepos);
        const { container } = renderWork(["proj-1", "proj-2"]);
        await waitFor(() => expect(container.querySelectorAll(".work-overview-section").length).toBe(2));
        const sections = Array.from(container.querySelectorAll(".work-overview-section")) as HTMLElement[];
        expect(within(sections[0]).getByText(/The sibling carries the route/)).toBeInTheDocument();
        expect(within(sections[1]).getByText(/Carry the schema and the store method/)).toBeInTheDocument();
      });

      /* The sibling's text is never in the detail header, so -- unlike the
         primary -- it must not skip its own first sentence. Getting this wrong
         drops a line of the design with nothing on the page to show it was
         ever there, which is exactly the failure the header's
         `headerStandsAlone` rule exists to prevent for the primary. */
      it("keeps the sibling's first sentence, which the header never took", async () => {
        stubApiByProject(twoRepos);
        const { container } = renderWork(["proj-1", "proj-2"]);
        await waitFor(() => expect(container.querySelectorAll(".work-overview-section").length).toBe(2));
        const sections = Array.from(container.querySelectorAll(".work-overview-section")) as HTMLElement[];
        // The primary's first point went to the header, so its body starts at
        // the second -- the behaviour this fix had to preserve.
        expect(within(sections[0]).queryByText(/Give the owner an inline way to edit a title/)).not.toBeInTheDocument();
        expect(openDesignTitle(container)).toMatch(/Give the owner an inline way to edit a title/);
        // The sibling's keeps both.
        expect(within(sections[1]).getByText(/Carry the schema and the store method/)).toBeInTheDocument();
        expect(within(sections[1]).getByText(/Add the owner-only overview route/)).toBeInTheDocument();
      });

      /* The changes section had the same shape of duplication the overview
         did: a title per member (the same sentence the overview above
         already prints in full) and a "What's changing" heading per member.
         Both are said once now, with the repo cards telling the halves
         apart. */
      it("prints one What's changing heading for the whole group", async () => {
        // Structured `changes` deliberately: the heading belongs to
        // `DeclaredChanges`, and a design without them falls back to bare
        // Creates/Touches lists that carry their own titles instead.
        const withChanges = twoRepos.map((d, i) => ({
          ...d,
          changes: [{ id: "c1", action: "modify", kind: "code", target: `src/thing-${i}.ts`, intent: "Do the thing." }],
        }));
        stubApiByProject(withChanges);
        const { container } = renderWork(["proj-1", "proj-2"]);
        await waitFor(() => expect(container.querySelectorAll(".member-panel").length).toBe(2));
        expect(within(detailPane(container)).getAllByText(/what.s changing/i)).toHaveLength(1);
      });

      it("drops the per-member title the overview already shows", async () => {
        stubApiByProject(twoRepos);
        const { container } = renderWork(["proj-1", "proj-2"]);
        await waitFor(() => expect(container.querySelectorAll(".member-panel").length).toBe(2));
        expect(container.querySelector(".member-panel-title")).toBeNull();
      });

      it("badges each overview with its repo when the group spans repos", async () => {
        stubApiByProject(twoRepos);
        const { container } = renderWork(["proj-1", "proj-2"]);
        await waitFor(() => expect(container.querySelectorAll(".work-overview-section").length).toBe(2));
        for (const section of container.querySelectorAll(".work-overview-section")) {
          expect(section.querySelector(".overview-repo-label")).toBeInTheDocument();
        }
      });

      /* **No discrepancy between a one-repo design and a cross-repo one**
         (2026-10-07). The card used to appear only when a group straddled
         repos, so the same tab was drawn two different ways depending on
         where somebody's work happened to land -- bare prose in one case,
         labelled cards in the other. A reader should not have to learn a
         second layout for that. The card is unconditional now; only the label
         follows the view's own `showRepoBadge` rule, like every other repo
         label on this page. */
      it("labels every card, including a group living in one repo", async () => {
        stubApiByProject([
          design({ id: "d-1", groupId: "g-1", projectId: "proj-1", summary: "First half of the work. It lands in the server." }),
          design({ id: "d-2", groupId: "g-1", projectId: "proj-1", summary: "Second half of the work. It lands in the CLI." }),
        ]);
        const { container } = renderWork(["proj-1", "proj-2"]);
        await waitFor(() => expect(container.querySelectorAll(".work-overview-section").length).toBe(2));
        for (const section of container.querySelectorAll(".work-overview-section")) {
          expect(section.querySelector(".overview-repo-label")).toBeInTheDocument();
        }
      });

      it("draws a lone design exactly as it draws a linked one", async () => {
        stubApiByProject([design()]);
        const { container } = renderWork(["proj-1", "proj-2"]);
        await waitFor(() => expect(container.querySelector(".work-overview-section")).toBeInTheDocument());
        const sections = container.querySelectorAll(".work-overview-section");
        expect(sections).toHaveLength(1);
        // Same card, same header band, same label as any member of a group.
        expect(sections[0]).toHaveClass("work-scope-card");
        expect(sections[0].querySelector(".overview-edit-row")).toBeInTheDocument();
        expect(sections[0].querySelector(".overview-repo-label")).toBeInTheDocument();
      });

      /* A single-repo *view* still shows no repo labels anywhere -- the
         selection already says which repo you are in. That rule belongs to the
         view, not to the group, which is the point of keying off
         `showRepoBadge`: the card, and so the layout, is identical either
         way. */
      it("drops the label in a single-repo view, keeping the card", async () => {
        stubApiByProject([design()]);
        const { container } = renderWork(["proj-1"]);
        await waitFor(() => expect(container.querySelector(".work-overview-section")).toBeInTheDocument());
        expect(container.querySelector(".work-overview-section")).toHaveClass("work-scope-card");
        expect(container.querySelector(".overview-repo-label")).toBeNull();
      });

      /* Rephrasing one design must not appear to rephrase the other. The pane
         held one set of proposal/skeleton/error states, so two overviews on
         screen would have shown one design's proposal under both; the state
         lives per section now. */
      it("confines a rephrase to the design whose button was pressed", async () => {
        stubApiByProject(twoRepos);
        const { container } = renderWork(["proj-1", "proj-2"]);
        await waitFor(() => expect(container.querySelectorAll(".work-overview-section").length).toBe(2));
        const sections = Array.from(container.querySelectorAll(".work-overview-section")) as HTMLElement[];
        expect(within(sections[0]).getByRole("button", { name: /rephrase overview/i })).toBeInTheDocument();
        expect(within(sections[1]).getByRole("button", { name: /rephrase overview/i })).toBeInTheDocument();
      });
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

    /* The label moved out of the panel heading and onto the card that
       encloses it (2026-10-07) -- same job, one level up, so the repo now
       labels everything belonging to that design rather than just the
       metadata line. What matters is still that a cross-repo group says
       which repo each panel is for. */
    it("labels each panel's repo when the group really does span repos", async () => {
      stubApi([linked[0], design({ id: "d-2", groupId: "g-1", projectId: "proj-2", summary: "Sibling in another repo" })]);
      const { container } = renderWork(["proj-1", "proj-2"]);
      await waitFor(() => expect(container.querySelectorAll(".member-panel").length).toBeGreaterThan(0));
      for (const panel of container.querySelectorAll(".member-panel")) {
        expect(panel.closest(".work-scope-card")?.querySelector(".overview-repo-label")).toBeInTheDocument();
      }
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
  it("shows an unsplittable summary in the body, under a shorter title", async () => {
    const long =
      "Resolve PR #17's conflict with its rebased base so the six UI defect fixes and the linked-group labels plus review rail all survive";
    stubApi([design({ summary: long })]);
    const { container } = renderWork();
    await waitFor(() => expect(within(detailPane(container)).getByText(/what this design says/i)).toBeInTheDocument());

    // The summary is the design's content, and the only text in this pane a
    // reviewer can highlight, so it has to be on screen in full.
    const pane = detailPane(container);
    expect(within(pane).getAllByText(long)).toHaveLength(1);

    // The header above it is a title, not a second copy of it.
    const title = openDesignTitle(container);
    expect(title).not.toBe(long);
    expect(title.length).toBeLessThan(long.length);
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

  // The boundary that let the duplicated summary through, pinned from both
  // sides.
  //
  // An unsplittable summary is shown twice or once depending on whether the
  // header's title was clamped: unclamped, the header already *is* the whole
  // summary and a body under it would repeat it exactly; clamped, the header
  // is a heading and the body carries the content. That made the detail
  // header's budget the thing that decided it -- at the list row's 120 a
  // 190-character design got a 113-character "title" over the same sentence,
  // which is the duplication people saw.
  //
  // It survived a suite that already covered it because both halves were
  // tested apart and never together: `designTitle.test.ts` covers the clamp,
  // the detail-pane tests covered the guard, and every summary fixture here
  // was 36 characters or shorter -- so nothing ever made `deriveTitle`
  // modify anything. Real summaries run 125-190.
  //
  // The length assertions are part of the test on purpose. A fixture edited
  // back under the budget would otherwise keep passing while covering
  // nothing, which is exactly how this was missed the first time.
  describe("an unsplittable summary either side of the detail title budget", () => {
    const SHORT = "Move the retry budget into the shared transport layer";
    const LONG = "Move the retry budget out of the sync client and into the shared transport layer so that every caller shares one policy";

    it("keeps its fixtures either side of DETAIL_TITLE_CHARS", () => {
      expect(SHORT.length).toBeLessThanOrEqual(DETAIL_TITLE_CHARS);
      expect(LONG.length).toBeGreaterThan(DETAIL_TITLE_CHARS);
    });

    it("shows a short one in the header alone -- a body would repeat it exactly", async () => {
      stubApi([design({ summary: SHORT })]);
      const { container } = renderWork();
      await waitFor(() => expect(openDesignTitle(container)).toBe(SHORT));

      const pane = detailPane(container);
      expect(within(pane).getAllByText(SHORT)).toHaveLength(1);
      expect(within(pane).queryByText(/what this design says it/i)).not.toBeInTheDocument();
    });

    it("shows a long one in the body, with the header clamped to a title", async () => {
      stubApi([design({ summary: LONG })]);
      const { container } = renderWork();
      await waitFor(() => expect(within(detailPane(container)).getByText(/what this design says it/i)).toBeInTheDocument());

      const pane = detailPane(container);
      // Once -- in the body. The header is a clamped title, so it does not
      // match the full text and this stays at one.
      expect(within(pane).getAllByText(LONG)).toHaveLength(1);
      expect(openDesignTitle(container).length).toBeLessThan(LONG.length);
    });
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

  // Found live: twing-monitor has 291 designs, 13 of them in progress, and
  // the list loaded only the 20 most recently created -- so it showed 5 of
  // the 13 (every dormant one sat on a later page) and counted 5. Active
  // designs are few and are the point of the screen; they are loaded in
  // full, and only the resolved history is paged.
  it("shows every active design, however far back it was created, without loading older history", async () => {
    const history = Array.from({ length: 20 }, (_, i) => design({ id: `closed-${i}`, status: "closed", summary: `Finished work ${i}`, createdAt: 2000 + i, lastActivityAt: 2000 + i }));
    const oldOpen = design({ id: "old-open", status: "dormant", summary: "Long-running work started weeks ago", createdAt: 1000, lastActivityAt: 1000 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname === "/v1/designs") {
          const status = url.searchParams.get("status");
          if (!status) return new Response(JSON.stringify({ items: history, nextBefore: 2000 }), { status: 200 });
          return new Response(JSON.stringify({ items: status === "dormant" ? [oldOpen] : [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }),
    );
    const { container } = renderWork();

    // The invariant this test found live is about *loading*, not about which
    // view shows it: a design that went dormant weeks ago sits on a later
    // created-at page, and the list used to miss it entirely. It is fetched
    // in full regardless, so asking for Dormant finds it without paging.
    await waitFor(() => expect(screen.getByRole("option", { name: /^Dormant \(1\)$/ })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Finished work"), "dormant");
    await waitFor(() => expect(listPane(container)).toHaveTextContent("Long-running work started weeks ago"));

    // Dormant is no longer part of the default view (2026-10-07): twing
    // decided nobody has touched these inside their TTL, so they are asked
    // for by name like any other finished-ish state.
    await userEvent.click(screen.getByRole("button", { name: /^Active \d+$/ }));
    await waitFor(() => expect(listPane(container)).not.toHaveTextContent("Long-running work started weeks ago"));
  });

  /* The list opens on everything and the filters narrow it (2026-10-07).
     Defaulting to live work only was tried first and overshot: on a real
     coordinator `active` can be a single design, and a one-row list reads as
     broken rather than focused. Finished work is a scroll away; an empty
     screen is a support question. */
  describe("filtering finished work", () => {
    const closedDesigns = Array.from({ length: 8 }, (_, i) => design({ id: `done-${i}`, summary: `Finished thing ${i}`, status: "closed" }));
    const liveDesign = design({ id: "live-1", summary: "Still being worked on", status: "open" });

    it("shows them by default, alongside the live work", async () => {
      stubApi([liveDesign, ...closedDesigns]);
      const { container } = renderWork();
      await waitFor(() => expect(listPane(container)).toHaveTextContent("Still being worked on"));
      expect(listPane(container)).toHaveTextContent("Finished thing");
    });

    it("drops them when Active is chosen", async () => {
      stubApi([liveDesign, ...closedDesigns]);
      const { container } = renderWork();
      await waitFor(() => expect(listPane(container)).toHaveTextContent("Finished thing"));

      await userEvent.click(screen.getByRole("button", { name: /^Active \d+$/ }));

      await waitFor(() => expect(listPane(container)).not.toHaveTextContent("Finished thing"));
      expect(listPane(container)).toHaveTextContent("Still being worked on");
    });

    /* A pill reading 9 that lists 1 would be a worse lie than the clutter
       this removes. */
    it("counts each view against what selecting it would show", async () => {
      stubApi([liveDesign, ...closedDesigns]);
      renderWork();
      await waitFor(() => expect(screen.getByRole("button", { name: /^Active 1$/ })).toBeInTheDocument());
      expect(screen.getByRole("option", { name: /^Closed \(8\)$/ })).toBeInTheDocument();
    });

    it("shows every one of them when their own filter is selected", async () => {
      stubApi([liveDesign, ...closedDesigns]);
      const { container } = renderWork();
      await waitFor(() => expect(listPane(container)).toHaveTextContent("Still being worked on"));

      await userEvent.selectOptions(screen.getByLabelText("Finished work"), "closed");

      await waitFor(() => expect(listPane(container)).toHaveTextContent("Finished thing 0"));
      // Capped at five with the rest behind the filtered view's own expander.
      expect(screen.getByRole("button", { name: /^Load 3 more$/ })).toBeInTheDocument();
    });

    it("caps a section at five, with the rest behind its heading", async () => {
      stubApi(Array.from({ length: 7 }, (_, i) => design({ id: `open-${i}`, summary: `Live thing ${i}`, status: "open" })));
      const { container } = renderWork();
      await waitFor(() => expect(listPane(container)).toHaveTextContent("Live thing 0"));
      // The default view spans sections, so the expander belongs to the
      // section heading rather than to the filtered list as a whole.
      expect(screen.getByRole("button", { name: /^\+2 more$/ })).toBeInTheDocument();
    });
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

/**
 * The "Mine" toggle. `renderWork` signs in as alice@example.com, so "mine"
 * means alice throughout.
 *
 * Deliberately paired with the pill counts in two of these: the toggle is
 * only trustworthy if the numbers move with it. A filter that visibly drops
 * rows while the pills keep reporting the project's totals reads as the
 * filter having failed, which is what the counts did under search before
 * this change.
 */
describe("WorkView mine filter", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** `stubApi` answers every unrecognised route with an empty page, which
   * covers alignment threads for the ownership-only cases; this is for the
   * one case that needs a real thread. */
  function stubApiWithThreads(designs: Record<string, unknown>[], threads: Record<string, unknown>[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/alignment-threads?")) return new Response(JSON.stringify({ items: threads }), { status: 200 });
        if (url.includes("/v1/designs?") || url.includes("/v1/designs&")) return new Response(JSON.stringify({ items: designs }), { status: 200 });
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }),
    );
  }

  /** "Mine" is a pill again in the hybrid bar (2026-10-07) -- daily views
   * get pills, the archive gets the selector. */
  async function showMine() {
    await userEvent.click(screen.getByRole("button", { name: /^Mine \d+$/ }));
  }

  it("keeps my designs and drops everyone else's", async () => {
    stubApi([design({ summary: "Mine to do" }), design({ id: "design-2", developerId: "bob@example.com", summary: "Bob's work" })]);
    const { container } = renderWork();
    await waitFor(() => expect(within(listPane(container)).getByText("Bob's work")).toBeInTheDocument());

    await showMine();

    await waitFor(() => expect(within(listPane(container)).queryByText("Bob's work")).not.toBeInTheDocument());
    expect(within(listPane(container)).getByText("Mine to do")).toBeInTheDocument();
  });

  it("counts each view against the searched list, not the whole project", async () => {
    stubApi([
      design({ summary: "Mine to do" }),
      design({ id: "design-2", developerId: "bob@example.com", summary: "Bob's work" }),
      design({ id: "design-3", developerId: "bob@example.com", summary: "Bob's other work" }),
    ]);
    const { container } = renderWork();
    await waitFor(() => expect(within(listPane(container)).getByText("Bob's other work")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^Active 3$/ })).toBeInTheDocument();

    // Mine reports 1 of the 3 -- the count describes the list selecting it
    // would produce, not the project's totals.
    expect(screen.getByRole("button", { name: /^Mine 1$/ })).toBeInTheDocument();

    await showMine();
    await waitFor(() => expect(within(listPane(container)).queryByText("Bob's work")).not.toBeInTheDocument());
    expect(within(listPane(container)).getByText("Mine to do")).toBeInTheDocument();
  });

  it("counts someone else's design as mine when an open thread puts me on the other side of it", async () => {
    stubApiWithThreads(
      [design({ summary: "Mine to do" }), design({ id: "design-2", developerId: "bob@example.com", summary: "Collides with mine" })],
      [
        {
          id: "thread-1",
          projectId: "proj-1",
          symbolId: "",
          symbolIds: [],
          developerId: "bob@example.com",
          otherDeveloperId: "alice@example.com",
          designId: "design-2",
          status: "open",
          systemDescription: "two plans, one module",
          category: "llm_divergence",
          openedAt: Date.now(),
          lastActivityAt: Date.now(),
        },
      ],
    );
    const { container } = renderWork();
    await waitFor(() => expect(within(listPane(container)).getByText("Collides with mine")).toBeInTheDocument());

    await showMine();

    // Bob authored it, but alice has to answer for it -- so it stays.
    await waitFor(() => expect(within(listPane(container)).getByText("Mine to do")).toBeInTheDocument());
    expect(within(listPane(container)).getByText("Collides with mine")).toBeInTheDocument();
  });

  it("composes the Conflicts pill with the selected view", async () => {
    stubApi([
      design({ summary: "My conflict", status: "flagged" }),
      design({ id: "design-2", summary: "My ongoing work" }),
      design({ id: "design-3", developerId: "bob@example.com", summary: "Bob's conflict", status: "flagged" }),
    ]);
    const { container } = renderWork();
    await waitFor(() => expect(within(listPane(container)).getByText("Bob's conflict")).toBeInTheDocument());

    await showMine();
    await userEvent.click(screen.getByRole("button", { name: /^Conflicts/ }));

    // "My conflicts" -- both axes at once. The Conflicts pill narrows
    // whatever the dropdown selected rather than replacing it, which is what
    // keeps this expressible now that Mine is one of the dropdown's values.
    await waitFor(() => expect(within(listPane(container)).getByText("My conflict")).toBeInTheDocument());
    expect(within(listPane(container)).queryByText("Bob's conflict")).not.toBeInTheDocument();
    expect(within(listPane(container)).queryByText("My ongoing work")).not.toBeInTheDocument();
  });

  it("restores everyone's designs when the default view is chosen again", async () => {
    stubApi([design({ summary: "Mine to do" }), design({ id: "design-2", developerId: "bob@example.com", summary: "Bob's work" })]);
    const { container } = renderWork();
    await waitFor(() => expect(within(listPane(container)).getByText("Bob's work")).toBeInTheDocument());

    await showMine();
    await waitFor(() => expect(within(listPane(container)).queryByText("Bob's work")).not.toBeInTheDocument());

    // A dropdown is not a toggle: you go back by choosing the default view,
    // not by picking the same option twice.
    await userEvent.click(screen.getByRole("button", { name: /^Active \d+$/ }));
    await waitFor(() => expect(within(listPane(container)).getByText("Bob's work")).toBeInTheDocument());
  });

  it("is hidden for the read-only observe viewer, which owns nothing", async () => {
    stubApi([design()]);
    saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
    render(
      <ServerProvider>
        <WorkView projectIds={["proj-1"]} projectsById={{}} query="" onQueryChange={() => {}} readOnly />
      </ServerProvider>,
    );
    await waitFor(() => expect(screen.getByText("Add retry backoff to the sync client")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Mine" })).not.toBeInTheDocument();
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

/**
 * Owner-editable title and overview (2026-10-02).
 *
 * `renderWork` signs in as `alice@example.com`, which is also `design()`'s
 * default `developerId` -- so the default fixture is one the viewer owns, and
 * the not-owner cases say so explicitly.
 */
describe("WorkView: owner-editable title and overview", () => {
  afterEach(() => vi.unstubAllGlobals());

  const EDIT_BUTTON = /edit title & overview/i;

  /** Captures every non-GET request, so a test can assert what was actually
   * sent rather than only what the UI did afterwards. */
  function stubApiCapturing(designs: Record<string, unknown>[]) {
    const sent: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method && init.method !== "GET") {
          sent.push({ url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
          return new Response(JSON.stringify({ design: designs[0] }), { status: 200 });
        }
        if (url.includes("/v1/designs?") || url.includes("/v1/designs&")) {
          return new Response(JSON.stringify({ items: designs }), { status: 200 });
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }),
    );
    return sent;
  }

  it("offers the edit affordance to the design's owner", async () => {
    stubApi([design()]);
    const { container } = renderWork();
    await waitFor(() => expect(detailPane(container)).toHaveTextContent("Add retry backoff to the sync client"));
    expect(within(detailPane(container)).getByRole("button", { name: EDIT_BUTTON })).toBeInTheDocument();
  });

  it("hides it from anyone who does not own the design", async () => {
    stubApi([design({ developerId: "bob@example.com" })]);
    const { container } = renderWork();
    await waitFor(() => expect(detailPane(container)).toHaveTextContent("Add retry backoff to the sync client"));
    // The server refuses a non-owner with 403 regardless; this keeps the
    // dashboard from offering an action that could only ever fail.
    expect(within(detailPane(container)).queryByRole("button", { name: EDIT_BUTTON })).toBeNull();
  });

  it("renders a stored title in the list row and the detail header, in place of a derived one", async () => {
    stubApi([design({ title: "Retry policy for the net layer" })]);
    const { container } = renderWork();
    await waitFor(() => expect(listPane(container)).toHaveTextContent("Retry policy for the net layer"));
    // Waited separately: the detail pane resolves through its own
    // fetchDesignById after the row renders, so asserting it inline passes
    // on a fast run and fails under load.
    await waitFor(() => expect(openDesignTitle(container)).toBe("Retry policy for the net layer"));
  });

  // The bullet-offset hazard, pinned from both sides. Without a stored title
  // the header consumes the summary's first sentence and the body must skip
  // it; with one, skipping would hide a sentence that appears nowhere else.
  it("shows every summary point in the body once an explicit title exists", async () => {
    stubApi([design({ title: "A real title", summary: "First sentence of the plan. Second sentence of the plan." })]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".summary-bullets")).not.toBeNull());
    const bullets = container.querySelector(".summary-bullets") as HTMLElement;
    expect(bullets).toHaveTextContent("First sentence of the plan.");
    expect(bullets).toHaveTextContent("Second sentence of the plan.");
  });

  it("still skips the header's sentence in the body when there is no stored title", async () => {
    stubApi([design({ summary: "First sentence of the plan. Second sentence of the plan." })]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".summary-bullets")).not.toBeNull());
    const bullets = container.querySelector(".summary-bullets") as HTMLElement;
    expect(bullets).not.toHaveTextContent("First sentence of the plan.");
    expect(bullets).toHaveTextContent("Second sentence of the plan.");
    expect(openDesignTitle(container)).toBe("First sentence of the plan.");
  });

  it("sends only the fields that changed, and clears an emptied title with null", async () => {
    const sent = stubApiCapturing([design({ title: "Old title" })]);
    const { container } = renderWork();
    await waitFor(() => expect(detailPane(container)).toHaveTextContent("Add retry backoff to the sync client"));
    await userEvent.click(within(detailPane(container)).getByRole("button", { name: EDIT_BUTTON }));

    const titleInput = container.querySelector(".overview-editor-field input") as HTMLInputElement;
    await userEvent.clear(titleInput);
    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0].method).toBe("PATCH");
    expect(sent[0].url).toContain("/v1/designs/design-1/overview");
    // An emptied title is a *clear* instruction, not a blank title -- and the
    // untouched summary is omitted rather than counting as a revision.
    expect(sent[0].body).toEqual({ title: null });
  });

  it("refuses to save a blank overview rather than letting the server reject it", async () => {
    const sent = stubApiCapturing([design()]);
    const { container } = renderWork();
    await waitFor(() => expect(detailPane(container)).toHaveTextContent("Add retry backoff to the sync client"));
    await userEvent.click(within(detailPane(container)).getByRole("button", { name: EDIT_BUTTON }));

    const textarea = container.querySelector(".overview-editor-field textarea") as HTMLTextAreaElement;
    await userEvent.clear(textarea);
    expect(within(detailPane(container)).getByRole("button", { name: /^save$/i })).toBeDisabled();
    expect(sent.length).toBe(0);
  });

  // Pinned as an absence (2026-10-02). An edited design showed "Edited by X ·
  // 2m ago" plus a "view the original overview" disclosure here; both were
  // removed as restatement -- the header already carries the owner and the
  // timestamp, only the owner can edit, and an outdated comment shows its own
  // quoted text in the rail. The fields stay populated for the resynthesis
  // guard and for Julian's "revised since you commented" marker, and the
  // Activity tab is where a revision's history belongs.
  it("keeps edit provenance out of the overview panel, however many revisions", async () => {
    stubApi([
      design({
        summary: "The owner's own words.",
        summaryExtracted: "The LLM's original paraphrase.",
        overviewRevision: 2,
        overviewRevisedBy: "alice@example.com",
        overviewRevisedAt: Date.now(),
        overviewRevisionSource: "owner_edit",
      }),
    ]);
    const { container } = renderWork();
    await waitFor(() => expect(detailPane(container)).toHaveTextContent("The owner's own words."));

    expect(detailPane(container)).not.toHaveTextContent(/edited by/i);
    // And the original is not disclosed here either -- it would have sat
    // beside "View original plan text" with a near-identical label.
    expect(detailPane(container)).not.toHaveTextContent("The LLM's original paraphrase.");
    expect(container.querySelector(".overview-provenance")).toBeNull();
  });
});

/**
 * Markdown overview and the GitHub-style editor (2026-10-02).
 *
 * The rendering is chosen by whether the text carries a real block marker, so
 * both branches are pinned here: an author's markdown renders as markdown,
 * and machine prose keeps the sentence bullets built for it.
 */
describe("WorkView: markdown overview", () => {
  afterEach(() => vi.unstubAllGlobals());

  const MARKDOWN = "## Approach\n\nResume from the last acknowledged offset.\n\n- Add a per-session resume token\n- Keep the retry budget unchanged";

  it("renders an authored overview as markdown, not as sentence bullets", async () => {
    stubApi([design({ summary: MARKDOWN })]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".md")).not.toBeNull());

    const md = container.querySelector(".md") as HTMLElement;
    expect(md.querySelector(".md-heading")?.textContent).toBe("Approach");
    expect(md.querySelectorAll(".md-list li")).toHaveLength(2);
    // The sentence-splitting path must not also run.
    expect(container.querySelector(".summary-bullets")).toBeNull();
  });

  it("strips markdown syntax out of the derived title", async () => {
    stubApi([design({ summary: MARKDOWN })]);
    const { container } = renderWork();
    // "## Approach" would be the title if it were derived from raw source.
    await waitFor(() => expect(openDesignTitle(container)).toBe("Approach"));
  });

  it("keeps sentence bullets for machine prose with an appended amendment", async () => {
    // What `appendSummaryUpdate` produces, i.e. most of the existing corpus.
    // The design's own text needs more than one sentence for bullets to be
    // the right rendering at all -- before amendments were folded out
    // (2026-10-06) the appended entry supplied the second point, so this
    // fixture carried only one sentence of its own and still bulleted.
    stubApi([
      design({
        summary: "Adds retry logic to the sync client, with a capped budget. It resumes from the last acknowledged offset.\n\nUpdate (2026-09-29): also bumps the packages.",
      }),
    ]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".summary-bullets")).not.toBeNull());
    expect(container.querySelector(".md")).toBeNull();
    // ...and the appended entry is in the fold, not among the bullets.
    expect(container.querySelector(".summary-bullets")?.textContent).not.toContain("also bumps the packages");
    expect(container.querySelector(".work-amendments")).not.toBeNull();
  });

  // Each markdown block is its own review run at its own source offset --
  // that is what keeps comment anchoring working. Asserted structurally,
  // since the offsets themselves are covered in markdown.test.ts.
  it("makes every markdown block its own review run, at its source offset", async () => {
    stubApi([design({ summary: MARKDOWN })]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".md")).not.toBeNull());

    const runs = [...container.querySelectorAll(".md [data-review-block]")];
    expect(runs.length).toBeGreaterThanOrEqual(4); // heading, paragraph, two list items
    const offsets = runs.map((r) => Number(r.getAttribute("data-offset")));
    expect(offsets.every((o) => Number.isFinite(o))).toBe(true);
    // Distinct and increasing: two blocks sharing an offset would anchor
    // their comments to each other's text.
    expect(new Set(offsets).size).toBe(offsets.length);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    // Each run's text must be findable in the raw summary, or the server
    // refuses the comment.
    for (const run of runs) expect(MARKDOWN).toContain(run.textContent);
  });

  it("offers Write and Preview tabs, and previews the markdown being typed", async () => {
    stubApi([design()]);
    const { container } = renderWork();
    await waitFor(() => expect(detailPane(container)).toHaveTextContent("Add retry backoff to the sync client"));
    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /edit title & overview/i }));

    const textarea = container.querySelector(".overview-editor-source") as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "## Heading{Enter}{Enter}- an item");

    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /^preview$/i }));
    const preview = container.querySelector(".overview-editor-preview") as HTMLElement;
    expect(preview.querySelector(".md-heading")?.textContent).toBe("Heading");
    expect(preview.querySelectorAll(".md-list li")).toHaveLength(1);
    // A draft is not commentable -- wiring the preview to the review context
    // would let it write into the rail.
    expect(preview.querySelector("[data-review-block]")).toBeNull();
  });

  it("goes back to the source when Write is re-selected, without losing the draft", async () => {
    stubApi([design()]);
    const { container } = renderWork();
    await waitFor(() => expect(detailPane(container)).toHaveTextContent("Add retry backoff to the sync client"));
    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /edit title & overview/i }));

    const textarea = container.querySelector(".overview-editor-source") as HTMLTextAreaElement;
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "## Draft heading");
    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /^preview$/i }));
    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /^write$/i }));

    expect((container.querySelector(".overview-editor-source") as HTMLTextAreaElement).value).toBe("## Draft heading");
  });
});

/**
 * The amendment fold (2026-10-06).
 *
 * `twing design amend` appends each amendment to `summary` as a dated
 * `Update (date):` entry, and the overview used to render those entries as
 * peers of the design's own sentences. These pin the two halves of the fix:
 * the body shows the design, the disclosure shows its history -- and every
 * amendment still renders at its true offset, which is what keeps review
 * comments anchored.
 */
describe("WorkView: amendment fold", () => {
  afterEach(() => vi.unstubAllGlobals());

  const SHORT_BASE = "Add retry backoff to the sync client";
  const LONG_BASE = "Add retry backoff to the sync client. It resumes from the last acknowledged offset.";
  const amended = (base: string) =>
    `${base}\n\nUpdate (2026-09-29): Also touches src/net/timeout.ts.\n\nUpdate (2026-09-30): Drop the jitter experiment.`;

  it("renders the amendments in a disclosure, not in the overview body", async () => {
    const summary = amended(LONG_BASE);
    stubApi([design({ summary })]);
    const { container } = renderWork();
    await waitFor(() => expect(detailPane(container)).toHaveTextContent(/resumes from the last acknowledged offset/i));

    const fold = container.querySelector(".work-amendments") as HTMLElement;
    expect(fold).toBeTruthy();
    expect(within(fold).getByText(/2 amendments since this was written/i)).toBeInTheDocument();
    expect(fold.querySelectorAll(".work-amendment-list li")).toHaveLength(2);

    // The body renders the design and nothing of its changelog.
    const body = container.querySelector(".summary-bullets") as HTMLElement;
    expect(body.textContent).toContain("resumes from the last acknowledged offset");
    expect(body.textContent).not.toContain("Also touches");
    expect(body.textContent).not.toContain("Drop the jitter experiment");
  });

  // THE property the whole fold rests on. If an amendment renders at the
  // wrong offset, every comment anchored in it resolves against the wrong
  // words -- and the page still looks perfectly correct.
  it("renders each amendment at its true offset in the summary", async () => {
    const summary = amended(LONG_BASE);
    stubApi([design({ summary })]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".work-amendments")).toBeTruthy());

    const blocks = [...container.querySelectorAll(".work-amendment-list [data-review-block]")] as HTMLElement[];
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      const offset = Number(block.dataset.offset);
      const text = block.textContent ?? "";
      expect(summary.slice(offset, offset + text.length)).toBe(text);
    }
  });

  it("shows each amendment's date", async () => {
    stubApi([design({ summary: amended(LONG_BASE) })]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".work-amendments")).toBeTruthy());

    const dates = [...container.querySelectorAll(".work-amendment-date")].map((d) => d.textContent);
    expect(dates).toEqual(["2026-09-29", "2026-09-30"]);
  });

  // A short base is promoted into the header and the body section is
  // suppressed (it would just repeat the heading). The amendments are
  // separate content and must survive that.
  it("still folds the amendments when the base was consumed by the header", async () => {
    stubApi([design({ summary: amended(SHORT_BASE) })]);
    const { container } = renderWork();
    await waitFor(() => expect(openDesignTitle(container)).toBe(SHORT_BASE));

    expect(container.querySelector(".summary-bullets")).toBeNull();
    expect(container.querySelector(".work-amendments")).toBeTruthy();
    expect(container.querySelectorAll(".work-amendment-list li")).toHaveLength(2);
  });

  it("titles the design from its own text, never from an amendment", async () => {
    stubApi([design({ summary: amended(SHORT_BASE) })]);
    const { container } = renderWork();

    await waitFor(() => expect(openDesignTitle(container)).toBe(SHORT_BASE));
    // ...and the list row agrees, since both read the one fallback helper.
    expect(within(listPane(container)).getByText(SHORT_BASE)).toBeInTheDocument();
  });

  it("renders no disclosure for a design that has never been amended", async () => {
    stubApi([design({ summary: LONG_BASE })]);
    const { container } = renderWork();
    await waitFor(() => expect(detailPane(container)).toHaveTextContent(/resumes from the last acknowledged offset/i));

    expect(container.querySelector(".work-amendments")).toBeNull();
  });

  it("keeps an authored markdown base on the markdown path, with the fold beside it", async () => {
    const base = "## Context\n\nThe sync client drops its offset.\n\n## Approach\n\n- Resume from the last acknowledged offset";
    stubApi([design({ summary: amended(base) })]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".md-heading")).toBeTruthy());

    const headings = [...container.querySelectorAll(".md-heading")].map((h) => h.textContent);
    expect(headings).toEqual(["Context", "Approach"]);
    // The appended entries are not markdown blocks in the body any more.
    expect((container.querySelector(".md") as HTMLElement).textContent).not.toContain("Also touches");
    expect(container.querySelectorAll(".work-amendment-list li")).toHaveLength(2);
  });
});

/**
 * The Rewrite button and the nudge (2026-10-06).
 *
 * The coordinator proposes; a person saves. These pin that split: the button
 * never writes on its own, the proposal lands in the editor for approval, and
 * an overview its owner wrote is only ever *offered* a rewrite.
 */
describe("WorkView: rewrite overview", () => {
  afterEach(() => vi.unstubAllGlobals());

  const BASE = "Add retry backoff to the sync client. It resumes from the last acknowledged offset.";
  const amendedTimes = (n: number) =>
    Array.from({ length: n }, (_, i) => `\n\nUpdate (2026-09-${20 + i}): amendment ${i + 1}.`).reduce((acc, u) => acc + u, BASE);

  /** Like `stubApi`, plus an answer for the resynthesize route and a record
   * of every call made to it. */
  function stubApiWithRewrite(designs: Record<string, unknown>[], answer: { status?: number; summary?: string | null } = {}) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/resynthesize")) {
          calls.push(url);
          if (answer.status && answer.status !== 200) return new Response(JSON.stringify({ error: "not found" }), { status: answer.status });
          return new Response(JSON.stringify({ summary: answer.summary ?? "One current overview." }), { status: 200 });
        }
        if (url.includes("/resynthesize/apply")) {
          calls.push("POST apply");
          return new Response(JSON.stringify({ design: designs[0] }), { status: 200 });
        }
        if (url.includes("/overview") && init?.method === "PATCH") {
          calls.push(`PATCH ${url}`);
          return new Response(JSON.stringify({ design: designs[0] }), { status: 200 });
        }
        if (url.includes("/v1/designs?") || url.includes("/v1/designs&")) {
          return new Response(JSON.stringify({ items: designs }), { status: 200 });
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }),
    );
    return calls;
  }

  it("shows the proposal instead of saving it", async () => {
    const calls = stubApiWithRewrite([design({ summary: amendedTimes(2) })], { summary: "The design, as it now stands." });
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".work-amendments")).toBeTruthy());

    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /rephrase overview/i }));

    // The proposal is shown, not saved. It used to land in the editor's
    // textarea (2026-10-06): that form is identical to "Edit title &
    // overview", so a finished rewrite read as an empty form. It now renders
    // as a proposal card where the overview was -- see the proposal-card
    // tests below for the accept/discard behaviour.
    await waitFor(() => expect(container.querySelector(".overview-proposal")).toBeTruthy());
    expect(container.querySelector(".overview-proposal-body")?.textContent).toContain("The design, as it now stands.");
    expect(container.querySelector(".overview-editor-source")).toBeNull();
    expect(calls.filter((c) => c.startsWith("PATCH") || c === "POST apply")).toHaveLength(0);
  });

  // Changed 2026-10-06: rephrasing is reading work, and accepting a proposal
  // stores the coordinator's words rather than the reader's, so it is offered
  // to everyone. Editing -- arbitrary text -- stays the owner's alone.
  it("offers the button on someone else's design, but not the editor", async () => {
    stubApiWithRewrite([design({ summary: amendedTimes(2), developerId: "someone-else@example.com" })]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".work-amendments")).toBeTruthy());

    const rephrase = within(detailPane(container)).getByRole("button", { name: /rephrase overview/i });
    expect(rephrase).toBeEnabled();
    expect(within(detailPane(container)).queryByRole("button", { name: /edit title & overview/i })).not.toBeInTheDocument();
  });

  // Kept on screen and disabled rather than hidden: a button that appears and
  // disappears teaches a rule nobody can see.
  it("keeps the button visible but inert when there is nothing to fold", async () => {
    stubApiWithRewrite([design({ summary: BASE })]);
    const { container } = renderWork();
    await waitFor(() => expect(detailPane(container)).toHaveTextContent(/resumes from the last acknowledged offset/i));

    const button = within(detailPane(container)).getByRole("button", { name: /rephrase overview/i });
    expect(button).toBeDisabled();
    // The reason lives on the tooltip rather than on the page (2026-10-07).
    expect(button).toHaveAttribute("title", expect.stringMatching(/nothing to rephrase yet/i));
  });

  it("needs two amendments before offering to replace text a person wrote", async () => {
    stubApiWithRewrite([design({ summary: amendedTimes(1), overviewRevision: 1, overviewRevisionSource: "owner_edit" })]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".work-amendments")).toBeTruthy());

    const button = within(detailPane(container)).getByRole("button", { name: /rephrase overview/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringMatching(/not enough has changed/i));
  });

  it("offers it again once a second amendment lands on that text", async () => {
    stubApiWithRewrite([design({ summary: amendedTimes(2), overviewRevision: 1, overviewRevisionSource: "rephrase_accepted" })]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".work-amendments")).toBeTruthy());

    expect(within(detailPane(container)).getByRole("button", { name: /rephrase overview/i })).toBeEnabled();
  });

  // One amendment is enough when nobody has claimed the text.
  it("offers it after a single amendment on a machine-written overview", async () => {
    stubApiWithRewrite([design({ summary: amendedTimes(1) })]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".work-amendments")).toBeTruthy());

    expect(within(detailPane(container)).getByRole("button", { name: /rephrase overview/i })).toBeEnabled();
  });

  it("shows a skeleton where the overview is while it waits", async () => {
    stubApiWithRewrite([design({ summary: amendedTimes(2) })]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".work-amendments")).toBeTruthy());

    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /rephrase overview/i }));
    await waitFor(() => expect(container.querySelector(".overview-proposal")).toBeTruthy());
    // The skeleton is gone once the proposal lands; its markup is what the
    // wait looks like, asserted structurally rather than by timing.
    expect(container.querySelector(".overview-skeleton")).toBeNull();
  });

  // The mixed-deploy case: the coordinator ships before the dashboard, so a
  // 404 here is an old server rather than a broken page, and says so.
  it("names an older coordinator rather than showing a bare failure", async () => {
    stubApiWithRewrite([design({ summary: amendedTimes(2) })], { status: 404 });
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".work-amendments")).toBeTruthy());

    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /rephrase overview/i }));
    await waitFor(() => expect(within(detailPane(container)).getByText(/too old to rewrite overviews/i)).toBeInTheDocument());
    // ...and the editor never opened on a proposal that does not exist.
    expect(container.querySelector(".overview-editor-source")).toBeNull();
  });

  it("nudges the owner once their own overview has drifted", async () => {
    stubApiWithRewrite([design({ summary: amendedTimes(3), overviewRevisionSource: "owner_edit" })]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".work-amendments")).toBeTruthy());

    expect(within(detailPane(container)).getByText(/3 amendments since you wrote this overview/i)).toBeInTheDocument();
  });

  // The coordinator rewrites a machine-written overview on its own, so
  // nagging about one would be noise about work already in hand.
  it("does not nudge when the overview is not the owner's own text", async () => {
    stubApiWithRewrite([design({ summary: amendedTimes(3) })]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".work-amendments")).toBeTruthy());

    expect(container.querySelector(".overview-nudge")).toBeNull();
  });

  it("does not nudge before the pile is deep enough", async () => {
    stubApiWithRewrite([design({ summary: amendedTimes(1), overviewRevisionSource: "owner_edit" })]);
    const { container } = renderWork();
    await waitFor(() => expect(container.querySelector(".work-amendments")).toBeTruthy());

    expect(container.querySelector(".overview-nudge")).toBeNull();
    // The button is still there -- an owner may fold two amendments if they
    // want to; the nudge is about when to *suggest* it.
    expect(within(detailPane(container)).getByRole("button", { name: /rephrase overview/i })).toBeInTheDocument();
  });
});

/**
 * The proposal card and the activity details (2026-10-06).
 *
 * Both exist because the first cut of the rewrite feature *worked* and still
 * read as broken: the proposal arrived in a form identical to the ordinary
 * editor, and the activity tab that was supposed to hold the folded-away
 * history showed only labels.
 */
describe("WorkView: rewrite proposal card", () => {
  afterEach(() => vi.unstubAllGlobals());

  const BASE = "Add retry backoff to the sync client. It resumes from the last acknowledged offset.";
  const AMENDED = `${BASE}\n\nUpdate (2026-09-29): Also touches src/net/timeout.ts.\n\nUpdate (2026-09-30): Drop the jitter experiment.`;
  const PROPOSAL = "Reworks the sync client to resume from the last acknowledged offset, also touching the timeout path.";

  function stubApiWithRewrite(designs: Record<string, unknown>[], answer: { summary?: string | null; saveStatus?: number } = {}) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/resynthesize/apply")) {
          calls.push("POST apply");
          return new Response(JSON.stringify({ design: designs[0] }), { status: answer.saveStatus ?? 200 });
        }
        if (url.includes("/resynthesize")) {
          calls.push("POST resynthesize");
          return new Response(JSON.stringify({ summary: answer.summary ?? PROPOSAL }), { status: 200 });
        }
        if (url.includes("/overview") && init?.method === "PATCH") {
          calls.push(`PATCH overview ${String(init.body)}`);
          return new Response(JSON.stringify({ design: designs[0] }), { status: 200 });
        }
        if (url.includes("/v1/designs?") || url.includes("/v1/designs&")) {
          return new Response(JSON.stringify({ items: designs }), { status: 200 });
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }),
    );
    return calls;
  }

  async function openProposal(container: HTMLElement) {
    await waitFor(() => expect(container.querySelector(".work-amendments")).toBeTruthy());
    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /rephrase overview/i }));
    await waitFor(() => expect(container.querySelector(".overview-proposal")).toBeTruthy());
  }

  // THE fix. The proposal is the outcome, shown where the overview was -- not
  // a textarea the reader has to recognise as a result.
  it("shows the rewrite in place, not in an edit form", async () => {
    stubApiWithRewrite([design({ summary: AMENDED })]);
    const { container } = renderWork();
    await openProposal(container);

    expect(container.querySelector(".overview-proposal-body")?.textContent).toContain("resume from the last acknowledged offset");
    // Not the editor: no textarea, and the ordinary Save is nowhere.
    expect(container.querySelector(".overview-editor-source")).toBeNull();
    expect(within(detailPane(container)).getByText(/nothing is saved yet/i)).toBeInTheDocument();
  });

  it("replaces the overview and its amendments while the proposal is up", async () => {
    stubApiWithRewrite([design({ summary: AMENDED })]);
    const { container } = renderWork();
    await openProposal(container);

    // The old text and the fold step aside, so the pane reads as rewritten
    // rather than as two competing versions.
    expect(container.querySelector(".summary-bullets")).toBeNull();
    expect(container.querySelector(".work-amendments")).toBeNull();
  });

  it("saves in one click, through the apply route that carries no text", async () => {
    const calls = stubApiWithRewrite([design({ summary: AMENDED })]);
    const { container } = renderWork();
    await openProposal(container);

    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /keep it/i }));

    await waitFor(() => expect(calls).toContain("POST apply"));
    // Nothing is sent but the design id: the coordinator saves its own
    // proposal, which is what lets a non-owner accept one without being able
    // to write words of their own.
    expect(calls.some((c) => c.startsWith("PATCH overview"))).toBe(false);
  });

  it("puts the old overview back on Discard, saving nothing", async () => {
    const calls = stubApiWithRewrite([design({ summary: AMENDED })]);
    const { container } = renderWork();
    await openProposal(container);

    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /discard/i }));

    await waitFor(() => expect(container.querySelector(".overview-proposal")).toBeNull());
    expect(container.querySelector(".work-amendments")).toBeTruthy();
    expect(calls.filter((c) => c.startsWith("PATCH") || c === "POST apply")).toHaveLength(0);
  });

  it("hands the proposal to the editor on Edit first", async () => {
    stubApiWithRewrite([design({ summary: AMENDED })]);
    const { container } = renderWork();
    await openProposal(container);

    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /edit first/i }));

    await waitFor(() => expect(container.querySelector(".overview-editor-source")).toBeTruthy());
    expect((container.querySelector(".overview-editor-source") as HTMLTextAreaElement).value).toBe(PROPOSAL);
  });

  // The proposal is the only copy -- throwing it away because a save failed
  // would make the owner ask for it twice.
  it("keeps the proposal on screen when saving fails", async () => {
    stubApiWithRewrite([design({ summary: AMENDED })], { saveStatus: 500 });
    const { container } = renderWork();
    await openProposal(container);

    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /keep it/i }));

    await waitFor(() => expect(within(detailPane(container)).getByText(/couldn't save that rewrite/i)).toBeInTheDocument());
    expect(container.querySelector(".overview-proposal-body")?.textContent).toContain("resume from the last acknowledged offset");
  });
});

describe("WorkView: activity details", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubApiWithActivity(designs: Record<string, unknown>[], events: Record<string, unknown>[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/activity")) return new Response(JSON.stringify({ items: events }), { status: 200 });
        if (url.includes("/v1/designs?") || url.includes("/v1/designs&")) return new Response(JSON.stringify({ items: designs }), { status: 200 });
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }),
    );
  }

  const amendEvent = (id: string, summary: string) => ({
    id,
    projectId: "proj-1",
    kind: "design_amended",
    relatedId: "design-1",
    ts: Date.now(),
    payload: { addedTouches: ["src/net/timeout.ts"], addedCreates: [], addedDependsOn: [], newSummary: summary },
  });

  // Before this, an amended design showed "Design amended" three times and
  // said nothing about any of them -- and once a rewrite removes that text
  // from the overview, this tab is the only place it survives.
  it("says what each amendment changed, not just that one happened", async () => {
    stubApiWithActivity([design()], [amendEvent("e1", "the rewritten summary")]);
    const { container } = renderWork();
    await waitFor(() => expect(detailPane(container)).toHaveTextContent("Add retry backoff to the sync client"));
    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /^activity$/i }));

    await waitFor(() => expect(container.querySelector(".activity-details")).toBeTruthy());
    const details = container.querySelector(".activity-details") as HTMLElement;
    expect(details.textContent).toContain("src/net/timeout.ts");
    expect(details.textContent).toContain("the rewritten summary");
  });

  it("clamps a long payload until the row is opened", async () => {
    stubApiWithActivity([design()], [amendEvent("e1", "a very long rewritten summary ".repeat(20))]);
    const { container } = renderWork();
    await waitFor(() => expect(detailPane(container)).toHaveTextContent("Add retry backoff to the sync client"));
    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /^activity$/i }));

    await waitFor(() => expect(container.querySelector(".activity-details")).toBeTruthy());
    expect(container.querySelector(".activity-details")?.className).toContain("clamped");

    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /design amended/i }));
    expect(container.querySelector(".activity-details")?.className).not.toContain("clamped");
  });

  it("leaves a detail-free event as a plain row", async () => {
    // `design_closed` carries no detail fields of its own; `design_registered`
    // does (it reports the summary), so it is the wrong fixture for this.
    stubApiWithActivity([design()], [{ id: "e2", projectId: "proj-1", kind: "design_closed", relatedId: "design-1", ts: Date.now(), payload: {} }]);
    const { container } = renderWork();
    await waitFor(() => expect(detailPane(container)).toHaveTextContent("Add retry backoff to the sync client"));
    await userEvent.click(within(detailPane(container)).getByRole("button", { name: /^activity$/i }));

    await waitFor(() => expect(within(detailPane(container)).getByText(/design closed/i)).toBeInTheDocument());
    expect(container.querySelector(".work-activity-body")).toBeNull();
  });
});

/**
 * A composed overview renders in full (2026-10-06).
 *
 * The header used to take the summary's first sentence whatever the summary
 * was. Harmless for machine-extracted fragments; wrong once a rewrite
 * produces flowing prose, where the body is then left opening "It also…"
 * about a subject that has been promoted into the heading.
 */
describe("WorkView: composed overview", () => {
  afterEach(() => vi.unstubAllGlobals());

  const COMPOSED =
    "This design documents the coordinator's version handshake in deploy/SERVER.md to ensure operators understand that a bumped version triggers self-healing. It also updates deploy/README.md to address the redeploy path.\n\nAdditionally, the monitor deploys separately and does not take part in the handshake.";

  it("keeps the first sentence in the body once the overview has been rewritten", async () => {
    stubApi([design({ summary: COMPOSED, overviewRevision: 1, overviewRevisionSource: "llm_resynthesis" })]);
    const { container } = renderWork();
    await waitFor(() => expect(detailPane(container)).toHaveTextContent(/deploy\/README\.md/));

    // The opening sentence is in the body, where the rest of the prose refers
    // back to it -- not only in the heading.
    const body = container.querySelector(".work-tab-panel") as HTMLElement;
    expect(body.textContent).toContain("This design documents the coordinator's version handshake");
    expect(body.textContent).toContain("It also updates deploy/README.md");
  });

  it("gives such a design a short derived title, not a paragraph", async () => {
    stubApi([design({ summary: COMPOSED, overviewRevision: 1 })]);
    const { container } = renderWork();
    await waitFor(() => expect(openDesignTitle(container)).not.toBe(""));

    // Clamped like any derived title, rather than the whole 150-character
    // opening sentence standing in as a heading.
    expect(openDesignTitle(container).length).toBeLessThanOrEqual(DETAIL_TITLE_CHARS + 1);
    expect(openDesignTitle(container)).toContain("This design documents");
  });

  // The rule this replaces still holds for everything it was built for.
  it("still lets the header take the first point of an un-rewritten summary", async () => {
    const extracted = "Record the group a design was born into, so a stacked design is attributable.\n\nIt also bumps the packages.";
    stubApi([design({ summary: extracted })]);
    const { container } = renderWork();
    await waitFor(() => expect(openDesignTitle(container)).toBe("Record the group a design was born into, so a stacked design is attributable."));

    const pane = detailPane(container);
    expect(within(pane).getAllByText(/Record the group a design was born into/)).toHaveLength(1);
  });
});


describe("shared design documents in the work view", () => {
  afterEach(() => vi.unstubAllGlobals());

  for (const linked of [false, true]) {
    it(`shows one document for ${linked ? "linked repositories" : "a single repository"} and keeps originals expandable`, async () => {
      const designs = [design({ id: "doc-cli", groupId: "shared", projectId: "proj-1", summary: "Server contribution. Keep concurrent work.", rawPlanExcerpt: "Original server plan" })];
      if (linked) designs.push(design({ id: "doc-monitor", groupId: "shared", projectId: "proj-2", summary: "Monitor contribution. Preserve the user's draft.", rawPlanExcerpt: "Original monitor plan" }));
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/document")) return new Response(JSON.stringify({
          groupId: "shared", revision: 1, status: "ready", stale: false,
          content: { schemaVersion: 1, title: "Keep every contributor's work", sections: { problemStatement: "An old save loses newer work.", solutionAbstract: "Compare versions and reconcile updates." } },
        }));
        if (url.includes("/v1/designs?")) {
          const projectId = new URL(url).searchParams.get("projectId");
          return new Response(JSON.stringify({ items: designs.filter((d) => d.projectId === projectId) }));
        }
        return new Response(JSON.stringify({ items: [], comments: [], replies: {} }));
      }));
      const { container } = renderWork(linked ? ["proj-1", "proj-2"] : ["proj-1"]);
      await waitFor(() => expect(within(detailPane(container)).getByRole("heading", { name: "Problem statement" })).toBeInTheDocument());
      const pane = detailPane(container);
      expect(within(pane).getAllByRole("region", { name: "Design document" })).toHaveLength(1);
      const originals = pane.querySelector("details.work-original-designs")!;
      expect(originals).not.toHaveAttribute("open");
      expect(pane.querySelector(".work-detail-changes")!.compareDocumentPosition(originals) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      await userEvent.click(within(pane).getByText("Original designs"));
      expect(originals).toHaveAttribute("open");
      expect(originals.querySelectorAll(".work-overview-section")).toHaveLength(linked ? 2 : 1);
      expect(within(originals as HTMLElement).getAllByRole("button", { name: /edit title & overview/i })).toHaveLength(linked ? 2 : 1);
    });
  }
});


it("preserves an unsaved original overview when the shared document arrives", async () => {
  let finishDocument!: (response: Response) => void;
  const designs = [design({ summary: "Original title. Original overview text." })];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/document")) return new Promise<Response>((resolve) => { finishDocument = resolve; });
    return new Response(JSON.stringify({ items: url.includes("/v1/designs?") ? designs : [], replies: {} }));
  }));
  const { container } = renderWork();
  try {
    await userEvent.click(await screen.findByRole("button", { name: /edit title & overview/i }));
    const editor = container.querySelector("textarea.overview-editor-source") as HTMLTextAreaElement;
    await userEvent.clear(editor);
    await userEvent.type(editor, "Unsaved human wording");
    finishDocument(new Response(JSON.stringify({ groupId: "design-1", status: "ready", revision: 1, stale: false,
      content: { schemaVersion: 1, title: "Combined explanation", sections: { problemStatement: "A shared problem." } },
    })));
    await screen.findByRole("heading", { name: "Combined explanation" });
    await userEvent.click(screen.getByText("Original designs"));
    expect(screen.getByDisplayValue("Unsaved human wording")).toBeVisible();
    expect(container.querySelector("textarea.overview-editor-source")).toBe(editor);
  } finally { vi.unstubAllGlobals(); }
});
