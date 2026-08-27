import { useState, type FormEvent } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchAlignmentThreads, fetchAlignmentThread, postAlignmentMessage, closeAlignmentThread } from "../api/alignmentThreads.js";
import { fetchDesigns } from "../api/designs.js";
import type { AlignmentThread, AlignmentCategory, AlignmentSubKind, DesignStatement, ProjectSummary } from "../api/types.js";
import { resolveAlignmentBucket } from "../api/types.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AsyncSection } from "../components/AsyncSection.js";
import { StatusBadge, type BadgeTone } from "../components/StatusBadge.js";
import { RepoBadge } from "../components/RepoBadge.js";
import { relativeTime } from "../lib/time.js";

const STATUSES = ["open", "dormant", "closed", "all"] as const;
type StatusFilter = (typeof STATUSES)[number];

/** `"dormant"` (2026-08-27, tightening alignment threads item 4) shares
 * `"closed"`'s calm/no-action-needed tone rather than getting a distinct
 * one of its own -- there's no "paused"-flavored tone in `BadgeTone`, and
 * the label text itself ("dormant" vs "closed") is what actually
 * distinguishes them; a louder tone here would misleadingly suggest
 * dormancy needs attention the way `"open"` does. */
function toneForStatus(status: "open" | "closed" | "dormant"): BadgeTone {
  return status === "open" ? "warning" : "neutral";
}

/** Display label for a thread's detail -- `subKind` going forward (2026-08-26
 * terminology simplification: `category` collapsed to the two bucket names,
 * `subKind` carries what used to be the whole `category` value), falling
 * back to interpreting a pre-2026-08-26 thread's legacy `category` string
 * directly for a row that predates the `subKind` column entirely. Undefined
 * only for a thread with neither -- renders no badge rather than an
 * "uncategorized" placeholder. */
function categoryLabel(thread: { category?: AlignmentCategory; subKind?: AlignmentSubKind }): string | undefined {
  switch (thread.subKind) {
    case "duplication":
      return "Duplication";
    case "contradictory_assumptions":
      return "Contradiction";
    case "tension":
      return "Tension";
    case "real_edit_collision":
      return "Real edit collision";
    case "scope_intrusion":
      return "Scope intrusion";
    case "contract_break":
      return "Contract break";
  }
  switch (thread.category as string | undefined) {
    case "duplication":
      return "Duplication";
    case "contradictory_assumptions":
      return "Contradiction";
    case "tension":
      return "Tension";
    case "symbol_claim":
      return "Overlapping files";
    default:
      return undefined;
  }
}

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

export function AlignmentThreadsView({
  projectIds,
  projectsById,
  onOpenDesign,
}: {
  projectIds: string[];
  projectsById: Record<string, ProjectSummary>;
  onOpenDesign?: (designId: string) => void;
}) {
  const apiFetch = useApiFetch();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Bumped when a card's own ThreadDetail closes its thread -- the list's
  // status badge/filter both need to reflect that.
  const [refreshKey, setRefreshKey] = useState(0);

  const state = useAsyncData(
    () =>
      Promise.all(projectIds.map((pid) => fetchAlignmentThreads(apiFetch, pid, status === "all" ? undefined : status))).then((lists) =>
        lists.flat().sort((a, b) => (b.lastActivityAt ?? b.openedAt) - (a.lastActivityAt ?? a.openedAt)),
      ),
    [apiFetch, projectIds.join(","), status, refreshKey],
  );
  // See ThreadDetail's own doc comment for why this is needed at all --
  // fetched once per project (every status) rather than per-thread, same
  // "avoid an N-fan-out of lookups" reasoning as ActivityView's own
  // session->design map.
  const designsState = useAsyncData(
    () => Promise.all(projectIds.map((pid) => fetchDesigns(apiFetch, pid))).then((lists) => lists.flat()),
    [apiFetch, projectIds.join(",")],
  );
  const designsById: Record<string, DesignStatement> = designsState.status === "ready" ? Object.fromEntries(designsState.data.map((d) => [d.id, d])) : {};

  const showRepoBadge = projectIds.length > 1;

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
                      <span className="card-summary">{t.summary ?? t.systemDescription}</span>
                      {showRepoBadge && <RepoBadge project={projectsById[t.projectId] ?? { projectId: t.projectId }} />}
                      {categoryLabel(t) && <StatusBadge label={categoryLabel(t)!} tone="accent" />}
                      <StatusBadge label={t.status} tone={toneForStatus(t.status)} />
                    </div>
                    <div className="card-meta">
                      <span>
                        {t.developerId} &amp; {t.otherDeveloperId}
                      </span>
                      <span>{relativeTime(t.lastActivityAt ?? t.openedAt)}</span>
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
