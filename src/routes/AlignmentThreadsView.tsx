import { useState, type FormEvent } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchAlignmentThreads, fetchAlignmentThread, postAlignmentMessage, closeAlignmentThread } from "../api/alignmentThreads.js";
import { fetchDesigns } from "../api/designs.js";
import type { AlignmentThread, DesignStatement } from "../api/types.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AsyncSection } from "../components/AsyncSection.js";
import { StatusBadge, type BadgeTone } from "../components/StatusBadge.js";
import { relativeTime } from "../lib/time.js";

const STATUSES = ["open", "closed", "all"] as const;
type StatusFilter = (typeof STATUSES)[number];

function toneForStatus(status: "open" | "closed"): BadgeTone {
  return status === "open" ? "warning" : "neutral";
}

/** A thread can name one or two designs, depending on what opened it (both
 * write to the same `AlignmentThread` row -- packages/server/src/app.ts):
 *
 * - A claims-path `design_divergence` finding (`POST /v1/claims`): the
 *   *other* party's registered design is `thread.designId`. The developer
 *   who triggered it made a raw claim, not necessarily a design of their
 *   own -- `thread.symbolId` there is a real code symbol (e.g.
 *   `src/x.ts::foo`), not a design.
 * - A `design_semantic_conflict` (the async Bedrock comparator,
 *   `runSemanticComparatorPass`): *both* sides are designs --
 *   `thread.designId` is the other one, and `thread.symbolId` is
 *   repurposed to hold the *initiating* design's own id (there's no real
 *   symbol to name for a design-vs-design finding, see that call site's own
 *   comment).
 *
 * Rather than threading origin metadata through just to tell these apart,
 * this looks `symbolId` up in the project's own design map: a design id is
 * a `crypto.randomUUID()`, a real symbolId always looks like
 * `path::Name` (`symbol-id.ts`) -- the two never collide, so "does it
 * resolve to a known design" is a reliable enough test either way. */
function ThreadDetail({
  thread,
  designsById,
  onOpenDesign,
  onChanged,
}: {
  thread: AlignmentThread;
  designsById: Record<string, DesignStatement>;
  onOpenDesign?: (designId: string) => void;
  onChanged: () => void;
}) {
  const apiFetch = useApiFetch();
  const [localRefreshKey, setLocalRefreshKey] = useState(0);
  const state = useAsyncData(() => fetchAlignmentThread(apiFetch, thread.id), [apiFetch, thread.id, localRefreshKey]);

  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initiatingDesign = designsById[thread.symbolId];
  const otherDesign = thread.designId ? designsById[thread.designId] : undefined;
  const hasSymbolReference = !initiatingDesign;

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
        {(initiatingDesign || otherDesign) && (
          <div className="thread-design-links">
            {initiatingDesign && onOpenDesign && (
              <button type="button" className="link-chip link-chip-accent" onClick={() => onOpenDesign(initiatingDesign.id)}>
                → {initiatingDesign.summary || initiatingDesign.id.slice(0, 8)}
              </button>
            )}
            {otherDesign && onOpenDesign && (
              <button type="button" className="link-chip link-chip-accent" onClick={() => onOpenDesign(otherDesign.id)}>
                → {otherDesign.summary || otherDesign.id.slice(0, 8)}
              </button>
            )}
          </div>
        )}
        {!initiatingDesign && !otherDesign && (
          <p className="resolve-pending-note">No linked design found -- it may have since expired or been deleted.</p>
        )}
        {hasSymbolReference && (
          <p className="resolve-pending-note">
            Triggering symbol: <code>{thread.symbolId}</code>
          </p>
        )}
      </div>

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

      {/* Every thread this view can render is one the signed-in developer is
          already a party to -- GET /v1/alignment-threads filters to
          isThreadParty server-side before this list ever exists -- so
          there's no separate "can I act" gate needed here, only "is it
          still open." */}
      {thread.status === "open" && (
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

export function AlignmentThreadsView({ projectId, onOpenDesign }: { projectId: string; onOpenDesign?: (designId: string) => void }) {
  const apiFetch = useApiFetch();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Bumped when a card's own ThreadDetail closes its thread -- the list's
  // status badge/filter both need to reflect that.
  const [refreshKey, setRefreshKey] = useState(0);

  const state = useAsyncData(
    () => fetchAlignmentThreads(apiFetch, projectId, status === "all" ? undefined : status),
    [apiFetch, projectId, status, refreshKey],
  );
  // See ThreadDetail's own doc comment for why this is needed at all --
  // fetched once per project (every status) rather than per-thread, same
  // "avoid an N-fan-out of lookups" reasoning as ActivityView's own
  // session->design map.
  const designsState = useAsyncData(() => fetchDesigns(apiFetch, projectId), [apiFetch, projectId]);
  const designsById: Record<string, DesignStatement> = designsState.status === "ready" ? Object.fromEntries(designsState.data.map((d) => [d.id, d])) : {};

  return (
    <div className="list-view">
      <div className="filter-bar">
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Filter by status">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s}
            </option>
          ))}
        </select>
      </div>

      <AsyncSection
        state={state}
        isEmpty={(items) => items.length === 0}
        emptyMessage="No alignment threads match this filter."
        render={(items) => (
          <ul className="card-list">
            {items.map((t) => {
              const expanded = expandedId === t.id;
              return (
                <li key={t.id} className={`design-card${expanded ? " expanded" : ""}`}>
                  <button
                    type="button"
                    className="design-card-toggle"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : t.id)}
                  >
                    <div className="card-top-row">
                      <span className="card-summary">{t.systemDescription}</span>
                      <StatusBadge label={t.status} tone={toneForStatus(t.status)} />
                    </div>
                    <div className="card-meta">
                      <span>
                        {t.developerId} &amp; {t.otherDeveloperId}
                      </span>
                      <span>{relativeTime(t.openedAt)}</span>
                    </div>
                  </button>
                  {expanded && (
                    <ThreadDetail thread={t} designsById={designsById} onOpenDesign={onOpenDesign} onChanged={() => setRefreshKey((k) => k + 1)} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      />
    </div>
  );
}
