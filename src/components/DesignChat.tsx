/**
 * A reviewer's private chat with a design (design review phase 2, 2026-09).
 *
 * The design says *what* an agent intends to build. This panel answers *why*,
 * because the coordinator grounds each reply in the session that produced the
 * design -- the conversation the developer and their agent actually had.
 *
 * Three things about the shape of this are deliberate:
 *
 * 1. **It says what each answer was grounded in.** Every agent turn carries a
 *    provenance line: how many turns of which session, and how many of the
 *    design's declared files that session touched. An answer grounded in 200
 *    turns and one answered from the design alone read identically otherwise,
 *    and a reviewer who cannot tell them apart will trust both equally.
 *
 * 2. **The transcript is never here.** Provenance is counts and a session
 *    prefix; the conversation itself is assembled server-side, sent to the
 *    model and discarded. This panel is not a window into a colleague's
 *    session, and nothing here should become one.
 *
 * 3. **It is private, and says so.** Nobody else on the project sees this
 *    thread -- not other reviewers, not the design's own author, not an
 *    admin. Saying that in the UI is the point: a reviewer who thinks their
 *    half-formed question is public will not ask it, which defeats the
 *    surface.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchDesignChat, postDesignChatMessage } from "../api/chat.js";
import type { DesignChatMessage, DesignStatement } from "../api/types.js";
import { relativeTime } from "../lib/time.js";

export function DesignChat({ design, readOnly }: { design: DesignStatement; readOnly?: boolean }) {
  const apiFetch = useApiFetch();
  const [messages, setMessages] = useState<DesignChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await fetchDesignChat(apiFetch, design.id);
      // Normalized rather than trusted: this panel is mounted inside the
      // expanded design, so a malformed response throwing here would take
      // the whole design view down with it. The chat is additive; failing to
      // load it must never cost a reviewer the design itself.
      setMessages(Array.isArray(body?.messages) ? body.messages : []);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiFetch, design.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // No polling, unlike the comment panel: a chat has exactly one other
  // participant and it answers in the response. There is nobody else who
  // could add to this thread while it sits open.
  useEffect(() => {
    // Feature-detected, not assumed. `scrollIntoView` is absent in jsdom and
    // not guaranteed on every browser surface this renders in, and this
    // panel is mounted inside the expanded design -- so a throw here takes
    // the whole design view down over a scroll nicety. Keeping the view
    // still is a fine outcome; losing the design is not.
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages.length, asking]);

  async function ask(e: FormEvent): Promise<void> {
    e.preventDefault();
    const question = draft.trim();
    if (!question) return;
    setAsking(true);
    setError(undefined);
    // Shown immediately so the conversation reads as a conversation while the
    // model call is in flight, rather than the reviewer's own words vanishing
    // until the server answers.
    setMessages((prev) => [...prev, { role: "reviewer", message: question, ts: Date.now() }]);
    setDraft("");
    try {
      const body = await postDesignChatMessage(apiFetch, design.id, question);
      setMessages(Array.isArray(body?.messages) ? body.messages : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Put the question back in the box rather than losing it to a failed
      // request -- retyping it is the one thing that would make a reviewer
      // stop using this.
      setDraft(question);
      // Drop the turn shown optimistically above: the request failed, so the
      // server has no record of it, and leaving it on screen would show a
      // conversation that does not exist. Reverted locally rather than by
      // reloading, because `load` clears `error` on success -- which would
      // wipe the message explaining what just went wrong.
      setMessages((prev) => (prev.length > 0 && prev[prev.length - 1].role === "reviewer" ? prev.slice(0, -1) : prev));
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="detail-field design-chat">
      <h3>
        Ask this design
        <span className="chat-privacy">private to you</span>
      </h3>

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : messages.length === 0 ? (
        <p className="empty-state">
          Ask why it was built this way. Answers are grounded in the session that produced this design, so they can cover reasoning the design itself never wrote
          down. Nobody else sees this thread — to leave feedback the developer will see, use the discussion above.
        </p>
      ) : (
        <ul className="chat-log">
          {messages.map((m, i) => (
            <li key={i} className={`chat-turn chat-turn-${m.role}`}>
              <div className="chat-turn-meta">
                <span>{m.role === "agent" ? "agent" : "you"}</span>
                <span>{relativeTime(m.ts)}</span>
              </div>
              <p>{m.message}</p>
              {/* Counts and a session prefix, never transcript text. An
                  answer grounded in 200 turns and one answered from the
                  design alone are otherwise indistinguishable. */}
              {m.provenance && <p className="chat-provenance">{m.provenance}</p>}
            </li>
          ))}
        </ul>
      )}

      {asking && <p className="chat-thinking">Reading the session…</p>}
      <div ref={endRef} />

      {/* Hidden for the public /observe viewer. The server rejects an
          unauthenticated write anyway; this is the UX nicety of not offering
          a prompt that cannot answer. */}
      {!readOnly && (
        <form className="chat-composer" onSubmit={ask}>
          <label htmlFor={`chat-${design.id}`}>Your question</label>
          <textarea
            id={`chat-${design.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Why was it done this way?"
            rows={2}
            disabled={asking}
          />
          <button type="submit" disabled={asking || !draft.trim()}>
            {asking ? "Asking…" : "Ask"}
          </button>
        </form>
      )}

      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
