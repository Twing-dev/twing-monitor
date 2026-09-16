import { useState, type FormEvent } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchAlignmentThread, postAlignmentMessage, closeAlignmentThread } from "../api/alignmentThreads.js";
import type { AlignmentThread, AlignmentCategory, AlignmentSubKind, DesignStatement, ProjectSummary } from "../api/types.js";
import { resolveAlignmentBucket } from "../api/types.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AsyncSection } from "../components/AsyncSection.js";
import { StatusBadge, type BadgeTone } from "../components/StatusBadge.js";
import { RepoBadge } from "../components/RepoBadge.js";
import { relativeTime } from "../lib/time.js";
import { conflictKindInfo, type ConflictKindInfo } from "../lib/conflictKind.js";

/** The pieces of an alignment thread's card -- header row and expanded
 * detail (messages, reply, close) -- kept here and exported for
 * `ConflictsView` (2026-09 conflict-tab unification: Alignment threads
 * merged with Reviews into one tab) to reuse verbatim. There is no longer a
 * standalone "Alignment threads" route; browsing threads now always goes
 * through `ConflictsView`. */

/** `"dormant"` (2026-08-27, tightening alignment threads item 4) shares
 * `"closed"`'s calm/no-action-needed tone rather than getting a distinct
 * one of its own -- there's no "paused"-flavored tone in `BadgeTone`, and
 * the label text itself ("dormant" vs "closed") is what actually
 * distinguishes them; a louder tone here would misleadingly suggest
 * dormancy needs attention the way `"open"` does. */
function toneForStatus(status: "open" | "closed" | "dormant"): BadgeTone {
  return status === "open" ? "warning" : "neutral";
}

/** A thread's conflict badge info, from the shared `conflictKind` vocabulary
 * -- the same label/tone a design card or a review's "Collides with" band
 * would use for the same underlying conflict (2026-09 conflict-vocabulary
 * unification). `resolveAlignmentBucket` already handles a pre-2026-08-26
 * thread's legacy `category` string; this just delegates to it instead of
 * carrying a second, drifting copy of that same switch. Undefined only for
 * a thread with no resolvable category at all -- renders no badge rather
 * than an "uncategorized" placeholder. */
function threadConflictInfo(thread: { category?: AlignmentCategory; subKind?: AlignmentSubKind }): ConflictKindInfo | undefined {
  const bucket = resolveAlignmentBucket(thread.category);
  if (!bucket) return undefined;
  return conflictKindInfo(bucket, thread.subKind);
}

/** The header row shared by a card's collapsible list form and its
 * standalone focused-page form. */
export function ThreadCardHeaderContent({ thread, showRepoBadge, projectsById }: { thread: AlignmentThread; showRepoBadge: boolean; projectsById: Record<string, ProjectSummary> }) {
  const info = threadConflictInfo(thread);
  return (
    <>
      <div className="card-top-row">
        <span className="card-summary">{thread.summary ?? thread.systemDescription}</span>
        {showRepoBadge && <RepoBadge project={projectsById[thread.projectId] ?? { projectId: thread.projectId }} />}
        {info && <StatusBadge label={info.label} tone={info.tone} />}
        <StatusBadge label={thread.status} tone={toneForStatus(thread.status)} />
      </div>
      <div className="card-meta">
        <span>
          {thread.developerId} &amp; {thread.otherDeveloperId}
        </span>
        <span>{relativeTime(thread.lastActivityAt ?? thread.openedAt)}</span>
      </div>
    </>
  );
}

export function ThreadDetail({
  thread,
  designsById,
  onOpenDesign,
  onChanged,
  readOnly,
}: {
  thread: AlignmentThread;
  designsById: Record<string, DesignStatement>;
  onOpenDesign?: (designId: string) => void;
  onChanged: () => void;
  readOnly?: boolean;
}) {
  const apiFetch = useApiFetch();
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const state = useAsyncData(() => fetchAlignmentThread(apiFetch, thread.id), [apiFetch, thread.id, localRefreshKey]);

  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initiatingDesign = thread.initiatingDesignId ? designsById[thread.initiatingDesignId] : undefined;
  const otherDesign = thread.designId ? designsById[thread.designId] : undefined;
  // A claim genuinely can have no design behind it -- the design gate has
  // real, supported bypasses (`disable-gate`), and `Bash` skips both the
  // gate and claim capture entirely (`wire-hooks.ts`'s matchers), so it's
  // not even a Claim. Shown as an honest, labeled state below rather than
  // left blank or implying a symmetric pair that doesn't exist.
  const noInitiatingDesign = !thread.initiatingDesignId;

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    const trimmed = reply.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    try {
      await postAlignmentMessage(apiFetch, thread.id, trimmed);
      setReply("");
      setLocalRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function close() {
    setClosing(true);
    setError(null);
    try {
      await closeAlignmentThread(apiFetch, thread.id);
      setLocalRefreshKey((k) => k + 1);
      onChanged(); // the parent list's own status badge/filter needs to know too
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="design-detail">
      <div className="detail-field">
        <h3>Linked designs</h3>
        <div className="thread-design-links">
          {initiatingDesign && onOpenDesign ? (
            <button type="button" className="link-chip link-chip-accent" onClick={() => onOpenDesign(initiatingDesign.id)}>
              → {thread.developerId}'s design: {initiatingDesign.summary || initiatingDesign.id.slice(0, 8)}
            </button>
          ) : noInitiatingDesign ? (
            <p className="resolve-pending-note">No design registered for {thread.developerId}'s edit.</p>
          ) : (
            <p className="resolve-pending-note">{thread.developerId}'s design -- expired or since deleted.</p>
          )}
          {otherDesign && onOpenDesign ? (
            <button type="button" className="link-chip link-chip-accent" onClick={() => onOpenDesign(otherDesign.id)}>
              → {thread.otherDeveloperId}'s design: {otherDesign.summary || otherDesign.id.slice(0, 8)}
            </button>
          ) : thread.designId ? (
            <p className="resolve-pending-note">{thread.otherDeveloperId}'s design -- expired or since deleted.</p>
          ) : null}
        </div>
      </div>

      {resolveAlignmentBucket(thread.category) === "symbol_conflict" && thread.symbolIds.length > 0 && (
        <div className="detail-field">
          <h3>Overlapping files</h3>
          <ul className="thread-symbol-list">
            {thread.symbolIds.map((s) => (
              <li key={s}>
                <code>{s}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="detail-field">
        <h3>Messages</h3>
        <AsyncSection
          state={state}
          isEmpty={(d) => d.messages.length === 0}
          emptyMessage="No messages yet."
          render={(d) => (
            <ul className="thread-message-list">
              {d.messages.map((m, i) => (
                <li key={i} className="thread-message">
                  <div className="thread-message-meta">
                    <span>{m.authorId ?? "twing"}</span>
                    <span>{relativeTime(m.ts)}</span>
                  </div>
                  <p>{m.message}</p>
                </li>
              ))}
            </ul>
          )}
        />
      </div>

      {/* Every thread a signed-in developer's own view can render is one
          they're already a party to -- GET /v1/alignment-threads filters to
          canViewThread server-side before this list ever exists. The one
          exception is the public "observe twing getting built" demo
          (2026-08-28): that identity can view every thread in its one
          project (canViewThread's isPublicViewer carve-out) without being a
          party to any of them, so `readOnly` gates this form explicitly
          rather than relying on "is it still open" alone -- the server
          would reject the POST regardless (isThreadParty, unchanged, still
          fails it), this is just the UX nicety of not showing a dead-end
          form. */}
      {thread.status === "open" && !readOnly && (
        <div className="detail-field resolve-actions">
          <h3>Reply</h3>
          <form className="resolve-justify-form" onSubmit={sendReply}>
            <label htmlFor={`thread-reply-${thread.id}`}>Message</label>
            <textarea
              id={`thread-reply-${thread.id}`}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Reply to the other developer..."
              rows={3}
              disabled={sending}
            />
            <button type="submit" className="resolve-button resolve-justify" disabled={sending || !reply.trim()}>
              {sending ? "Sending…" : "Send reply"}
            </button>
          </form>
          <button type="button" className="resolve-button resolve-reject" disabled={closing} onClick={close}>
            {closing ? "Closing…" : "Close thread"}
          </button>
          {error && (
            <p className="resolve-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
