/**
 * The notification bell (2026-09): design discussions waiting on you.
 *
 * Until this existed, the only way to learn that a review had reached you was
 * a banner at the start of your next coding session -- and only for
 * escalations on designs you own. A reviewer who asked a question never found
 * out it had been answered. The dashboard is where people already are, and it
 * said nothing.
 *
 * **Only human actions appear here**, filtered server-side. That is the whole
 * reason the feed is usable: every comment automatically triggers the
 * coordinator's answer and often a second `[needs a human]` reply after it,
 * so a bell that counted agent activity would show three items for every one
 * thing that actually happened.
 *
 * The panel polls only while it is open. Closed, the badge refreshes on the
 * slow cadence -- a number nobody is looking at does not need to be seconds
 * fresh, and this runs for every signed-in dashboard user.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchNotifications, markNotificationsSeen, type NotificationFeed, type NotificationItem } from "../api/notifications.js";
import { relativeTime } from "../lib/time.js";

/** Closed: the badge is the only thing on screen, so this is slow on
 * purpose. Open: someone is reading, and a reply arriving while they look
 * should appear. */
const BADGE_POLL_MS = 60_000;
const OPEN_POLL_MS = 15_000;

/** Past this the badge reads "9+" rather than growing the button. */
const BADGE_MAX = 9;

const EMPTY: NotificationFeed = { items: [], unreadCount: 0, lastSeenAt: 0 };

function verb(item: NotificationItem): string {
  switch (item.kind) {
    case "design_comment_posted":
      return "commented on";
    case "design_comment_replied":
      return "replied on";
    case "design_comment_escalated":
      return "escalated a question on";
    case "design_comment_resolved":
      return "resolved a question on";
  }
}

export function NotificationBell({ onOpenDesign }: { onOpenDesign: (designId: string, projectId: string) => void }): React.JSX.Element {
  const apiFetch = useApiFetch();
  const [feed, setFeed] = useState<NotificationFeed>(EMPTY);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const panelRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const next = await fetchNotifications(apiFetch);
      if (id !== requestId.current) return;
      setFeed(next);
      setError(undefined);
    } catch (err) {
      if (id !== requestId.current) return;
      // A bell that cannot reach the coordinator says so in the panel, but
      // never takes the rest of the dashboard down with it -- everything
      // else on this screen is still perfectly usable.
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiFetch]);

  // `loadRef` so the interval below can change cadence without tearing down
  // and re-creating the timer on every render -- the pattern DesignComments
  // uses for the same reason. Assigned from an effect rather than during
  // render: a ref write during render is not a render-safe operation, and
  // the interval only ever reads it from a callback, long after this runs.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    void loadRef.current();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => void loadRef.current(), open ? OPEN_POLL_MS : BADGE_POLL_MS);
    return () => clearInterval(timer);
  }, [open]);

  // Clicking anywhere else closes the panel. Registered only while it is
  // open, so the app carries no listener the rest of the time.
  useEffect(() => {
    if (!open) return;
    function onDocumentClick(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocumentClick);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  async function toggle(): Promise<void> {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    const id = ++requestId.current;
    try {
      // Marking seen returns the feed already updated, so the badge clears
      // in one round trip. An escalation still waiting on you survives it
      // and keeps counting -- which is why this takes the response rather
      // than assuming zero.
      const next = await markNotificationsSeen(apiFetch);
      if (id !== requestId.current) return;
      setFeed(next);
      setError(undefined);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const badge = feed.unreadCount > BADGE_MAX ? `${BADGE_MAX}+` : String(feed.unreadCount);

  return (
    <div className="notif" ref={panelRef}>
      <button
        type="button"
        className={`icon-btn${open ? " active" : ""}`}
        aria-label={feed.unreadCount > 0 ? `Notifications, ${feed.unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        title="Notifications"
        onClick={() => void toggle()}
      >
        🔔
        {feed.unreadCount > 0 && (
          <span className="notif-badge" aria-hidden="true">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-head">
            <strong>Discussions</strong>
            <span className="notif-panel-sub">Only people's comments, escalations and replies — never the agent's answers.</span>
          </div>

          {error && <p className="notif-empty">Couldn't load notifications: {error}</p>}

          {!error && feed.items.length === 0 && <p className="notif-empty">Nothing waiting on you. Comments on your designs, and replies on discussions you're in, land here.</p>}

          {!error &&
            feed.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`notif-row${item.unread ? " unread" : ""}`}
                onClick={() => {
                  setOpen(false);
                  onOpenDesign(item.designId, item.projectId);
                }}
              >
                <span className="notif-row-head">
                  <span className="notif-actor">{item.actorId}</span> {verb(item)} <span className="notif-design">{item.designSummary}</span>
                </span>
                <span className="notif-excerpt">{item.excerpt}</span>
                <span className="notif-when">{relativeTime(item.ts)}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
