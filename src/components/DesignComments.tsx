/**
 * The design review discussion panel (2026-09).
 *
 * A reviewer reads a registered design -- what an agent said it will build,
 * before it has built any of it -- and asks about it here. The coordinator
 * answers first. Only if that answer isn't good enough does the reviewer
 * escalate, which reaches the design's owner as a non-blocking banner at the
 * start of their next coding session.
 *
 * Two things about the shape of this are deliberate and easy to "fix" wrongly:
 *
 * 1. **A new comment renders as `open` and polls.** The coordinator's answer
 *    is a model call running fire-and-forget behind the POST, so the comment
 *    genuinely is unanswered for a few seconds. Blocking the reviewer on it
 *    would make leaving a comment feel like submitting a form to a slow
 *    server, and the answer is not what they came to write.
 *
 * 2. **Escalate is a button a person presses.** The agent's own
 *    recommendation arrives as a `[needs a human]` reply and is surfaced, but
 *    it never acts. The person who asked the question is the only one who can
 *    judge whether it was answered, and the alternative -- a model deciding
 *    when to interrupt a developer's session -- is the thing this whole
 *    design keeps in human hands.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchDesignComments, postDesignComment, postCommentReply, escalateComment, resolveComment } from "../api/comments.js";
import type { DesignChange, DesignComment, DesignCommentReply, DesignStatement } from "../api/types.js";
import { relativeTime } from "../lib/time.js";
import { pathOfTarget } from "../lib/designConformance.js";

/** How often an unanswered comment re-checks for the agent's first pass. The
 * answer is one model call, so this is seconds of waiting, not minutes. */
const ANSWER_POLL_MS = 3000;

/**
 * How often an open panel refreshes when nothing is mid-answer.
 *
 * This existed as "don't poll at all once nothing is `open`", which was
 * wrong in a way that only shows up in the case this feature is *for*: a
 * discussion is a conversation with people who aren't in the browser. The
 * design's owner replies from their terminal (`twing design comment reply`),
 * acknowledges an escalation by reading it, or another reviewer comments --
 * and none of that reached a panel someone had left open. A reviewer waiting
 * for an answer would sit in front of a stale page.
 *
 * Much slower than the answer poll because the thing being waited on is a
 * person rather than a model call, and it only runs while somebody has the
 * discussion open in front of them.
 */
const DISCUSSION_POLL_MS = 20000;

/** The marker `runCommentAnswerPass` (twing-cli's app.ts) puts on the reply
 * carrying the agent's escalation recommendation. Matched rather than carried
 * as a field because it is genuinely a *message* -- the reviewer should read
 * the reason in full, and a boolean would throw it away. */
const NEEDS_HUMAN_PREFIX = "[needs a human]";

function isRecommendation(reply: DesignCommentReply): boolean {
  return reply.authorKind === "agent" && reply.message.startsWith(NEEDS_HUMAN_PREFIX);
}

function statusLabel(comment: DesignComment): { text: string; tone: string } {
  switch (comment.status) {
    case "open":
      return { text: "the agent is answering…", tone: "open" };
    case "answered":
      return { text: "answered by the agent", tone: "answered" };
    case "escalated":
      // Named, because "waiting" without a name is the state where everyone
      // assumes somebody else is dealing with it.
      return { text: comment.acknowledgedAt ? "with the developer" : "waiting on the developer", tone: "escalated" };
    case "resolved":
      return { text: "resolved", tone: "resolved" };
  }
}

/** The declared change a comment was left against, when it still resolves.
 *
 * An amendment can drop a change id out from under a comment that named it.
 * When that happens the comment is shown unanchored rather than hidden --
 * losing the anchor must never lose the question. */
function AnchoredChange({ change }: { change: DesignChange }) {
  const path = pathOfTarget(change.target);
  const symbol = change.target.length > path.length ? change.target.slice(path.length + 2) : undefined;
  return (
    <div className="comment-anchor">
      <span className={`change-action action-${change.action}`}>{change.action}</span>
      <code className="change-target">
        <span className="change-path">{path}</span>
        {symbol && <span className="change-symbol">{symbol}</span>}
      </code>
    </div>
  );
}

function CommentCard({
  comment,
  replies,
  design,
  readOnly,
  onChanged,
}: {
  comment: DesignComment;
  replies: DesignCommentReply[];
  design: DesignStatement;
  readOnly?: boolean;
  onChanged: () => void;
}) {
  const apiFetch = useApiFetch();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const anchor = comment.targetChangeId ? design.changes?.find((c) => c.id === comment.targetChangeId) : undefined;
  const recommendation = replies.find(isRecommendation);
  const status = statusLabel(comment);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(e: FormEvent): Promise<void> {
    e.preventDefault();
    const text = reply.trim();
    if (!text) return;
    await run(async () => {
      await postCommentReply(apiFetch, comment.id, text);
      setReply("");
    });
  }

  return (
    <li className={`comment-card comment-${comment.status}`}>
      <div className="comment-head">
        <span className="comment-author">{comment.authorId}</span>
        <span className={`comment-status comment-status-${status.tone}`}>{status.text}</span>
        <span className="comment-meta">{relativeTime(comment.createdAt)}</span>
      </div>
      {anchor && <AnchoredChange change={anchor} />}
      <p className="comment-body">{comment.body}</p>

      {replies.length > 0 && (
        <ul className="comment-replies">
          {replies.map((r, i) => (
            <li key={i} className={`comment-reply comment-reply-${r.authorKind}${isRecommendation(r) ? " comment-reply-recommendation" : ""}`}>
              <div className="comment-reply-meta">
                <span>{r.authorKind === "agent" ? "agent" : (r.authorId ?? "someone")}</span>
                <span>{relativeTime(r.ts)}</span>
              </div>
              <p>{isRecommendation(r) ? r.message.slice(NEEDS_HUMAN_PREFIX.length).trim() : r.message}</p>
            </li>
          ))}
        </ul>
      )}

      {comment.status === "escalated" && (
        <p className="comment-escalated-note">
          {comment.acknowledgedAt
            ? `${design.developerId} has read this.`
            : `Sent to ${design.developerId}. They'll see it when they next start a coding session — it won't interrupt them before that.`}
        </p>
      )}

      {/* Hidden for the public /observe viewer, which can read the whole
          discussion and write none of it. The server rejects these writes
          regardless (an unauthenticated POST never reaches the route); this
          is the UX nicety of not showing a dead-end control. */}
      {!readOnly && comment.status !== "resolved" && (
        <div className="comment-actions">
          <form className="comment-reply-form" onSubmit={sendReply}>
            <textarea
              aria-label="Reply to this comment"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Reply…"
              rows={2}
              disabled={busy}
            />
            <button type="submit" disabled={busy || !reply.trim()}>
              Reply
            </button>
          </form>
          <div className="comment-decision">
            {comment.status !== "escalated" && (
              <button
                type="button"
                className="comment-escalate"
                disabled={busy}
                // `recommendation` only ever pre-fills the reason -- the
                // reviewer still has to press this. See the header.
                onClick={() => void run(() => escalateComment(apiFetch, comment.id, recommendation?.message.slice(NEEDS_HUMAN_PREFIX.length).trim()))}
              >
                Needs the developer
              </button>
            )}
            {/* Only the reviewer who asked (or a project admin) may close a
                comment -- the server decides and says so per comment. Anyone
                else gets the reason rather than a button that 403s, because
                "why can't I close this?" is a real question with a real
                answer: it is not yours to close. */}
            {comment.canResolve ? (
              <button type="button" className="comment-resolve" disabled={busy} onClick={() => void run(() => resolveComment(apiFetch, comment.id))}>
                Resolved
              </button>
            ) : (
              <span className="comment-resolve-note">{comment.authorId} closes this one</span>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="comment-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

export function DesignComments({ design, readOnly }: { design: DesignStatement; readOnly?: boolean }) {
  const apiFetch = useApiFetch();
  const [data, setData] = useState<{ items: DesignComment[]; replies: Record<string, DesignCommentReply[]> }>({ items: [], replies: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [anchorId, setAnchorId] = useState("");
  const [posting, setPosting] = useState(false);

  // Kept in a ref so the poll effect below doesn't re-subscribe every time a
  // load finishes -- `load` changing identity would restart the interval on
  // each tick, which is the classic way a 3s poll becomes a tight loop.
  const loadRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    try {
      const body = await fetchDesignComments(apiFetch, design.id);
      // Normalized rather than trusted. A coordinator predating this route,
      // an edge proxy returning its own JSON, or a partial response would
      // otherwise put `undefined` where an array belongs -- and because this
      // panel is mounted inside the expanded design, a throw here takes the
      // whole design view down with it. Comments are additive; failing to
      // load them must never cost a reviewer the design itself.
      setData({
        items: Array.isArray(body?.items) ? body.items : [],
        replies: body?.replies && typeof body.replies === "object" ? body.replies : {},
      });
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiFetch, design.id]);

  useEffect(() => {
    loadRef.current = () => void load();
    void load();
  }, [load]);

  // Two cadences, because two different things are being waited on: a model
  // call that lands in seconds, and a person who replies from their terminal
  // minutes or hours later. Both only run while this panel is mounted, which
  // means while somebody actually has the discussion open.
  const awaitingAnswer = data.items.some((c) => c.status === "open");
  useEffect(() => {
    const timer = setInterval(() => loadRef.current(), awaitingAnswer ? ANSWER_POLL_MS : DISCUSSION_POLL_MS);
    return () => clearInterval(timer);
  }, [awaitingAnswer]);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    setError(undefined);
    try {
      await postDesignComment(apiFetch, design.id, body, anchorId || undefined);
      setDraft("");
      setAnchorId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPosting(false);
    }
  }

  const unresolved = data.items.filter((c) => c.status !== "resolved").length;

  return (
    <div className="detail-field design-comments">
      <h3>
        Discussion
        {data.items.length > 0 && (
          <span className="comment-count">
            {data.items.length} comment{data.items.length === 1 ? "" : "s"}
            {unresolved > 0 && `, ${unresolved} open`}
          </span>
        )}
      </h3>

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="empty-state">
          No comments yet. Ask about this design before it gets built — the agent answers first, and a developer is only pulled in if that isn&apos;t enough.
        </p>
      ) : (
        <ul className="comment-list">
          {data.items.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              replies={data.replies[comment.id] ?? []}
              design={design}
              readOnly={readOnly}
              onChanged={() => void load()}
            />
          ))}
        </ul>
      )}

      {!readOnly && (
        <form className="comment-new-form" onSubmit={submit}>
          <label htmlFor={`comment-new-${design.id}`}>Add a comment</label>
          <textarea
            id={`comment-new-${design.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What's unclear or wrong about this design?"
            rows={3}
            disabled={posting}
          />
          {/* Only offered for a design registered from a structured template
              -- one extracted from plan prose has no change ids to anchor to,
              and an empty dropdown is worse than none. */}
          {design.changes && design.changes.length > 0 && (
            <label className="comment-anchor-picker">
              About
              <select value={anchorId} onChange={(e) => setAnchorId(e.target.value)} disabled={posting} aria-label="Which change is this about?">
                <option value="">the design as a whole</option>
                {design.changes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.action} {c.target}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" disabled={posting || !draft.trim()}>
            {posting ? "Posting…" : "Comment"}
          </button>
        </form>
      )}

      {error && (
        <p className="comment-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
