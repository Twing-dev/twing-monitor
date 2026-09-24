/**
 * The notification bell's feed (2026-09).
 *
 * Both routes are scoped to whoever holds the token -- there is no
 * `?developerId=` to pass, so there is no id with which to ask about someone
 * else's. That is the same shape `api/chat.ts` uses, and it is why neither
 * function here takes an identity argument.
 *
 * The server derives the feed from the activity log on every request rather
 * than storing it, so these are ordinary reads; the only state either of them
 * changes is one read cursor, in `markNotificationsSeen`.
 */

import type { Fetcher } from "./client.js";

/** The four event kinds that reach a bell. Agent activity is filtered out
 * server-side and never appears here -- see `notification-store.ts`. */
export type NotificationKind = "design_comment_posted" | "design_comment_replied" | "design_comment_escalated" | "design_comment_resolved";

export interface NotificationItem {
  /** The activity event's own id -- stable, so rows can key on it. */
  id: string;
  kind: NotificationKind;
  ts: number;
  /** Who did it. Never you: your own actions are filtered out server-side. */
  actorId: string;
  projectId: string;
  designId: string;
  designSummary: string;
  commentId: string;
  excerpt: string;
  /** Still counting toward the badge -- newer than the read cursor, or an
   * escalation still waiting on you. */
  unread: boolean;
}

export interface NotificationFeed {
  items: NotificationItem[];
  unreadCount: number;
  lastSeenAt: number;
}

/** `GET /v1/notifications`. */
export async function fetchNotifications(fetcher: Fetcher, limit = 50): Promise<NotificationFeed> {
  return fetcher<NotificationFeed>(`/v1/notifications?limit=${limit}`);
}

/**
 * `POST /v1/notifications/seen` -- marks everything currently visible read.
 *
 * Returns the feed already updated, so opening the panel is one round trip
 * rather than a write followed by a re-fetch. An escalation still waiting on
 * you deliberately survives this and keeps counting, which is why the
 * response is worth reading rather than assuming the count is now zero.
 */
export async function markNotificationsSeen(fetcher: Fetcher): Promise<NotificationFeed> {
  return fetcher<NotificationFeed>("/v1/notifications/seen", { method: "POST" });
}
