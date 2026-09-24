/**
 * The bell's own rules. The feed's rules -- who is notified of what, and why
 * an agent's answer never is -- belong to the server and are tested there
 * (`notification-store.test.ts` in twing-cli); these are the things that can
 * only go wrong in the browser.
 *
 * The one that matters most is the escalation case: a stray click on the
 * bell marks everything seen, and the badge going quiet while somebody is
 * still blocked waiting on you is the failure this whole feature exists to
 * prevent.
 */

import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { NotificationBell } from "./NotificationBell.js";

afterEach(() => vi.unstubAllGlobals());

/** One feed item, overridable per test. */
function makeItem(over: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    kind: "design_comment_posted",
    ts: Date.now(),
    actorId: "reviewer@example.com",
    projectId: "p1",
    designId: "d1",
    designSummary: "Improve the bell",
    commentId: "c1",
    excerpt: "Could this show a count?",
    unread: true,
    ...over,
  };
}

/** Stubs both routes with one feed for GET and another for the POST that
 * marks everything seen -- the two are deliberately different, because the
 * component is supposed to render what `seen` hands back rather than assume
 * the count is now zero. */
function stubFeed(read: { items: unknown[]; unreadCount: number }, seen = { items: read.items, unreadCount: 0 }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input).endsWith("/v1/notifications/seen") ? seen : read;
    return new Response(JSON.stringify({ ...body, lastSeenAt: 0 }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  saveAuth("https://coordinator.example", "a-pat", "owner@example.com");
  return fetchMock;
}

function renderBell(onOpenDesign = vi.fn()) {
  render(
    <ServerProvider>
      <NotificationBell onOpenDesign={onOpenDesign} />
    </ServerProvider>,
  );
  return onOpenDesign;
}

it("shows unread discussion, marks it seen on open, and opens its design", async () => {
  const user = userEvent.setup();
  const openDesign = vi.fn();
  const item = {
    id: "evt-1", kind: "design_comment_posted", ts: Date.now(),
    actorId: "reviewer@example.com", projectId: "p1", designId: "d1",
    designSummary: "Improve the bell", commentId: "c1",
    excerpt: "Could this show a count?", unread: true,
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const seen = String(input).endsWith("/v1/notifications/seen");
    return new Response(JSON.stringify({ items: [{ ...item, unread: !seen }], unreadCount: seen ? 0 : 1, lastSeenAt: seen ? Date.now() : 0 }), { status: 200 });
  }));
  saveAuth("https://coordinator.example", "a-pat", "owner@example.com");

  render(<ServerProvider><NotificationBell onOpenDesign={openDesign} /></ServerProvider>);
  const bell = await screen.findByRole("button", { name: "Notifications, 1 unread" });
  await user.click(bell);
  expect(await screen.findByText("Could this show a count?")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Notifications" })).toHaveAttribute("aria-expanded", "true"));
  await user.click(screen.getByRole("button", { name: /reviewer@example.com commented on Improve the bell/ }));
  expect(openDesign).toHaveBeenCalledWith("d1", "p1");
});

// The badge is a fixed-width dot; an unbounded number would stretch the
// button and shove the rest of the top bar sideways.
it("caps the badge at 9+ rather than growing the button", async () => {
  stubFeed({ items: [makeItem()], unreadCount: 42 });
  renderBell();

  await screen.findByRole("button", { name: "Notifications, 42 unread" });
  expect(screen.getByText("9+")).toBeInTheDocument();
});

it("shows no badge at all when nothing is waiting", async () => {
  stubFeed({ items: [], unreadCount: 0 });
  renderBell();

  const bell = await screen.findByRole("button", { name: "Notifications" });
  expect(bell).toBeInTheDocument();
  expect(screen.queryByText("0")).not.toBeInTheDocument();
});

it("explains the empty state instead of opening a blank panel", async () => {
  const user = userEvent.setup();
  stubFeed({ items: [], unreadCount: 0 });
  renderBell();

  await user.click(await screen.findByRole("button", { name: "Notifications" }));
  expect(await screen.findByText(/Nothing waiting on you/)).toBeInTheDocument();
});

/**
 * The whole point of the escalation exemption: opening the panel marks
 * everything seen, but an escalation is *state* -- somebody is blocked --
 * and has to keep counting until it is acknowledged or resolved. The server
 * decides that and says so in the `seen` response; this asserts the
 * component believes the response rather than assuming zero.
 */
it("keeps the badge when the server says an escalation is still waiting", async () => {
  const user = userEvent.setup();
  const escalation = makeItem({ id: "evt-2", kind: "design_comment_escalated", unread: true });
  stubFeed({ items: [escalation], unreadCount: 1 }, { items: [escalation], unreadCount: 1 });
  renderBell();

  await user.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
  await screen.findByText(/escalated a question on/);
  expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
});

it("says so in the panel when the coordinator can't be reached, and leaves the rest of the page alone", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
  saveAuth("https://coordinator.example", "a-pat", "owner@example.com");
  renderBell();

  await user.click(await screen.findByRole("button", { name: "Notifications" }));
  expect(await screen.findByText(/Couldn't load notifications/)).toBeInTheDocument();
});

it("closes on Escape", async () => {
  const user = userEvent.setup();
  stubFeed({ items: [makeItem()], unreadCount: 1 });
  renderBell();

  await user.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
  expect(await screen.findByText("Could this show a count?")).toBeInTheDocument();

  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByText("Could this show a count?")).not.toBeInTheDocument());
});

// The bell spans every repo you're in, while the view around it is scoped to
// one -- so a row has to hand back the project as well as the design, or
// RepoDetailLayout cannot tell an in-place focus from a cross-repo jump.
it("hands back the project as well as the design, for a row from another repo", async () => {
  const user = userEvent.setup();
  stubFeed({ items: [makeItem({ projectId: "some-other-repo", designId: "d9" })], unreadCount: 1 });
  const onOpenDesign = renderBell();

  await user.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
  await user.click(await screen.findByRole("button", { name: /reviewer@example.com commented on/ }));
  expect(onOpenDesign).toHaveBeenCalledWith("d9", "some-other-repo");
});
