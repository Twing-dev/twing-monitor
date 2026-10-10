/**
 * Design review (2026-09, reworked 2026-09-27): highlight part of a design,
 * comment on it, and resolve it when it is settled -- the way a shared
 * document works.
 *
 * `DesignReview` wraps whatever renders a design's text. Inside it:
 *
 *  - `HighlightableText` marks a run of text as commentable (which design,
 *    which field, which declared change) and draws the highlights of the open
 *    comments anchored in it.
 *  - Selecting text inside one of those runs offers a "Comment" button; the
 *    comment is posted with the highlighted words and a little context
 *    (`CommentAnchor`), not character offsets, because the design will be
 *    edited after this -- see `lib/reviewAnchors.ts` for how the words are
 *    found again, and what "outdated" means when they are not.
 *  - The rail beside it (below it, on a phone) holds the comments, their
 *    replies, and Resolve.
 *
 * Three things about the shape of this are deliberate:
 *
 * 1. **People answer.** Nothing replies on anyone's behalf. The design's
 *    owner is told there are open comments by their coding session (the
 *    hook) and answers here. An earlier version had the coordinator answer
 *    first, from a design it had no code for.
 *
 * 2. **A comment is never hidden because the design moved.** When its words
 *    are gone it stays in the rail, marked outdated, with the words it was
 *    about. When the design was edited after it -- whether or not the words
 *    survived -- the card says so, since the edit may be the answer.
 *
 * 3. **Resolving belongs to whoever asked** (or a project admin as an escape
 *    hatch). The server decides and says so per comment as `canResolve`;
 *    everyone else sees who closes it rather than a button that 403s.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchDesignComments, postCommentReply, postDesignComment, resolveComment } from "../api/comments.js";
import type { CommentAnchor, CommentAnchorField, DesignComment, DesignCommentReply, DesignStatement } from "../api/types.js";
import { relativeTime } from "../lib/time.js";
import { anchorSourceText, blockKey, CONTEXT_CHARS, locateComment, segmentText, type LocatedComment, type TextRange } from "../lib/reviewAnchors.js";

/**
 * How often an open review refreshes. The thing being waited on is a person
 * -- the design's owner answering, another reviewer commenting -- so this is
 * slow, and it only runs while somebody has the design open.
 */
const REVIEW_POLL_MS = 20000;

interface ReviewData {
  items: DesignComment[];
  replies: Record<string, DesignCommentReply[]>;
}

interface ReviewContextValue {
  /** Highlight ranges per block (`blockKey`), open comments only. */
  rangesByBlock: Map<string, { range: TextRange; commentId: string }[]>;
  /** Every block (`blockKey`) holding an open comment's anchor, found or not
   * -- what opens a collapsed section that has something to show. */
  anchoredBlocks: Set<string>;
  activeId?: string;
  setActiveId: (id: string | undefined) => void;
}

const ReviewContext = createContext<ReviewContextValue | null>(null);

/** Whether an open comment is anchored in this field of this design -- for a
 * `change` field, in any of these declared changes. False outside a
 * `DesignReview`. */
export function useHasReviewAnchors(designId: string | undefined, field: CommentAnchorField, changeIds: string[] = []): boolean {
  const ctx = useContext(ReviewContext);
  if (!ctx || !designId) return false;
  if (field === "change") return changeIds.some((id) => ctx.anchoredBlocks.has(blockKey(designId, "change", id)));
  return ctx.anchoredBlocks.has(blockKey(designId, field));
}

/** Where a comment's highlight lives, for a card whose highlight may be on
 * the other tab. */
function fieldLabel(field: CommentAnchorField): string {
  switch (field) {
    case "summary":
      return "in the overview";
    case "plan":
      return "in the plan";
    case "change":
      return "on a declared change";
    case "groupOverview":
      return "in the combined overview";
  }
}

/**
 * A run of design text that can be highlighted and commented on.
 *
 * `offset` is where `text` sits inside its field's full text -- the overview
 * renders the summary as several bullets, and a highlight is located against
 * the whole summary. A negative offset (a bullet that could not be placed)
 * draws no highlights rather than wrong ones.
 *
 * Outside a `DesignReview` it renders plain text, so shared components can
 * use it unconditionally.
 */
export function HighlightableText({ designId, field, changeId, text, offset = 0 }: { designId: string; field: CommentAnchorField; changeId?: string; text: string; offset?: number }) {
  const ctx = useContext(ReviewContext);
  if (!ctx) return <>{text}</>;
  const ranges = offset < 0 ? [] : (ctx.rangesByBlock.get(blockKey(designId, field, changeId)) ?? []);
  const segments = segmentText(text, Math.max(0, offset), ranges);
  return (
    <span className="review-block" data-review-block="" data-design-id={designId} data-field={field} data-change-id={changeId ?? ""} data-offset={offset}>
      {segments.map((segment, i) =>
        segment.commentIds.length === 0 ? (
          segment.text
        ) : (
          <mark
            key={i}
            className={`review-mark${ctx.activeId && segment.commentIds.includes(ctx.activeId) ? " active" : ""}`}
            data-comment-ids={segment.commentIds.join(" ")}
            onClick={() => ctx.setActiveId(segment.commentIds[0])}
          >
            {segment.text}
          </mark>
        ),
      )}
    </span>
  );
}

interface PendingSelection {
  designId: string;
  anchor: CommentAnchor;
  /** Where to float the "Comment" button, in viewport coordinates. */
  top: number;
  left: number;
}

function closestBlock(node: Node | null): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  return element?.closest<HTMLElement>("[data-review-block]") ?? null;
}

/**
 * Turns the browser's current selection into an anchor, or `null` when it is
 * not something that can be commented on: empty, outside the design's text,
 * or spanning two runs (a quote has to come from one field to be found
 * again).
 *
 * The context either side is taken from the field's *whole* text, not from
 * the run the selection is in. The overview renders the summary as bullets,
 * and a quote is later looked up across the whole summary: a reviewer who
 * selects an entire bullet that appears twice would otherwise send empty
 * context, and the lookup would settle on the first occurrence whichever one
 * they picked. Found in review. `sourceFor` returns the field's text; a run
 * with no known place in it (offset < 0) falls back to its own text.
 */
function readSelection(scope: HTMLElement, sourceFor: (designId: string, field: CommentAnchorField, changeId?: string) => string | undefined): PendingSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const block = closestBlock(range.startContainer);
  if (!block || block !== closestBlock(range.endContainer) || !scope.contains(block)) return null;

  const before = document.createRange();
  before.selectNodeContents(block);
  before.setEnd(range.startContainer, range.startOffset);
  const raw = range.toString();
  const quote = raw.trim();
  if (!quote) return null;

  const designId = block.dataset.designId ?? "";
  const field = block.dataset.field as CommentAnchorField;
  const changeId = block.dataset.changeId || undefined;
  const blockText = block.textContent ?? "";
  const localStart = before.toString().length + (raw.length - raw.trimStart().length);

  // Place the run inside its field's full text when it verifiably sits
  // there; otherwise its own text is the best context available.
  const offset = Number(block.dataset.offset ?? "0");
  const source = sourceFor(designId, field, changeId);
  const placed = source !== undefined && offset >= 0 && source.slice(offset, offset + blockText.length) === blockText;
  const text = placed ? source : blockText;
  const start = (placed ? offset : 0) + localStart;
  const end = start + quote.length;
  const rect = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : undefined;

  return {
    designId,
    anchor: {
      field,
      ...(field === "change" && changeId ? { changeId } : {}),
      quote,
      prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
      suffix: text.slice(end, end + CONTEXT_CHARS),
    },
    top: rect ? rect.bottom + 6 : 0,
    left: rect ? rect.left : 0,
  };
}

function scrollIntoViewIfPossible(element: Element | null | undefined) {
  if (element && typeof (element as HTMLElement).scrollIntoView === "function") (element as HTMLElement).scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/**
 * The review scope: everything inside `children` that renders through
 * `HighlightableText` becomes commentable, and the rail is rendered beside
 * it. `designs` is usually one design, or a linked group's members -- each
 * member's comments are loaded and anchored to its own text.
 */
export function DesignReview({
  designs,
  readOnly,
  children,
  groupOverviewText,
}: {
  designs: DesignStatement[];
  readOnly?: boolean;
  children: ReactNode;
  /** The combined overview's current text (2026-10-10), when this scope
   * includes one -- threaded through to `locateComment`/`anchorSourceText`
   * so a `groupOverview`-anchored comment can be matched against it. Not
   * derivable from `designs` alone: the combined text is synthesized, not
   * stored on any one `DesignStatement`. */
  groupOverviewText?: string;
}) {
  const apiFetch = useApiFetch();
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState<Record<string, ReviewData>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [composer, setComposer] = useState<{ designId: string; anchor?: CommentAnchor } | null>(null);
  const [activeId, setActiveId] = useState<string | undefined>();

  const designIds = designs.map((d) => d.id).join(",");
  const load = useCallback(async () => {
    try {
      const results = await Promise.all(designs.map(async (d) => [d.id, await fetchDesignComments(apiFetch, d.id)] as const));
      const next: Record<string, ReviewData> = {};
      for (const [id, body] of results) {
        // Normalized rather than trusted: this is mounted around the whole
        // design view, so a malformed response throwing here would take the
        // design down with it. Comments are additive; failing to load them
        // must never cost a reviewer the design itself.
        next[id] = {
          items: Array.isArray(body?.items) ? body.items : [],
          replies: body?.replies && typeof body.replies === "object" ? body.replies : {},
        };
      }
      setData(next);
      setLoadError(undefined);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // `designs` is keyed by `designIds`: a new array of the same designs on
    // every parent render must not restart the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiFetch, designIds]);

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
    void load();
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => void loadRef.current(), REVIEW_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const designsById = useMemo(() => new Map(designs.map((d) => [d.id, d])), [designs]);
  const located = useMemo(() => {
    const all: LocatedComment[] = [];
    for (const [designId, review] of Object.entries(data)) {
      for (const comment of review.items) all.push(locateComment(comment, designsById.get(designId), groupOverviewText));
    }
    return all.sort((a, b) => a.comment.createdAt - b.comment.createdAt);
  }, [data, designsById, groupOverviewText]);

  const context = useMemo<ReviewContextValue>(() => {
    const rangesByBlock = new Map<string, { range: TextRange; commentId: string }[]>();
    const anchoredBlocks = new Set<string>();
    for (const { comment, range } of located) {
      if (comment.status !== "open" || !comment.anchor) continue;
      const key = blockKey(comment.designId, comment.anchor.field, comment.anchor.changeId);
      anchoredBlocks.add(key);
      if (!range) continue;
      rangesByBlock.set(key, [...(rangesByBlock.get(key) ?? []), { range, commentId: comment.id }]);
    }
    return { rangesByBlock, anchoredBlocks, activeId, setActiveId };
  }, [located, activeId]);

  // Selection is read on release rather than on every `selectionchange`, so
  // the button appears once the reviewer has finished dragging.
  const onSelectionDone = useCallback(() => {
    if (readOnly || !scopeRef.current) return;
    setPending(
      readSelection(scopeRef.current, (designId, field, changeId) => {
        const design = designsById.get(designId);
        return design ? anchorSourceText(design, field, changeId, groupOverviewText) : undefined;
      }),
    );
  }, [readOnly, designsById, groupOverviewText]);

  // A click anywhere that is not the button itself dismisses it.
  useEffect(() => {
    if (!pending) return;
    const dismiss = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(".review-float")) setPending(null);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [pending]);

  const startComment = () => {
    if (!pending) return;
    setComposer({ designId: pending.designId, anchor: pending.anchor });
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <ReviewContext.Provider value={context}>
      <div className="review-layout">
        <div className="review-content" ref={scopeRef} onMouseUp={onSelectionDone} onKeyUp={onSelectionDone} onTouchEnd={onSelectionDone}>
          {children}
        </div>
        <ReviewRail
          designs={designs}
          located={located}
          replies={data}
          loading={loading}
          loadError={loadError}
          readOnly={readOnly}
          composer={composer}
          onComposerClose={() => setComposer(null)}
          onCommentWholeDesign={() => setComposer({ designId: designs[0].id })}
          onChanged={() => void load()}
          activeId={activeId}
          onActivate={setActiveId}
        />
      </div>
      {pending && !readOnly && (
        <button type="button" className="review-float" style={{ top: pending.top, left: pending.left }} onClick={startComment}>
          Comment
        </button>
      )}
    </ReviewContext.Provider>
  );
}

function ReviewRail({
  designs,
  located,
  replies,
  loading,
  loadError,
  readOnly,
  composer,
  onComposerClose,
  onCommentWholeDesign,
  onChanged,
  activeId,
  onActivate,
}: {
  designs: DesignStatement[];
  located: LocatedComment[];
  replies: Record<string, ReviewData>;
  loading: boolean;
  loadError?: string;
  readOnly?: boolean;
  composer: { designId: string; anchor?: CommentAnchor } | null;
  onComposerClose: () => void;
  onCommentWholeDesign: () => void;
  onChanged: () => void;
  activeId?: string;
  onActivate: (id: string | undefined) => void;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const open = located.filter((l) => l.comment.status === "open");
  const resolved = located.filter((l) => l.comment.status === "resolved");
  const repliesFor = (c: DesignComment) => replies[c.designId]?.replies[c.id] ?? [];

  return (
    <aside className="review-rail" aria-label="Design review">
      <div className="review-rail-head">
        <h3>Design review</h3>
        <span className="review-count">{open.length > 0 ? `${open.length} open` : located.length > 0 ? "all resolved" : ""}</span>
      </div>

      {!readOnly && (
        <p className="review-hint">
          Highlight any part of the design to comment on it. Its developer is told in their coding session, and answers here.
          <button type="button" className="review-link" onClick={onCommentWholeDesign}>
            Comment on the whole design
          </button>
        </p>
      )}

      {composer && !readOnly && <Composer key={`${composer.designId}|${composer.anchor?.quote ?? ""}`} target={composer} designs={designs} onClose={onComposerClose} onPosted={onChanged} />}

      {loadError && (
        <p className="comment-error" role="alert">
          {loadError}
        </p>
      )}

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : located.length === 0 ? (
        !composer && <p className="empty-state">No comments yet.</p>
      ) : (
        <>
          <ul className="review-list">
            {open.map((l) => (
              <CommentCard key={l.comment.id} located={l} replies={repliesFor(l.comment)} readOnly={readOnly} active={activeId === l.comment.id} onActivate={onActivate} onChanged={onChanged} />
            ))}
          </ul>
          {resolved.length > 0 && (
            <>
              <button type="button" className="review-link review-resolved-toggle" aria-expanded={showResolved} onClick={() => setShowResolved((v) => !v)}>
                {showResolved ? "Hide" : "Show"} {resolved.length} resolved
              </button>
              {showResolved && (
                <ul className="review-list review-list-resolved">
                  {resolved.map((l) => (
                    <CommentCard key={l.comment.id} located={l} replies={repliesFor(l.comment)} readOnly={readOnly} active={false} onActivate={onActivate} onChanged={onChanged} />
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </aside>
  );
}

function Quote({ anchor, outdated }: { anchor: CommentAnchor; outdated: boolean }) {
  return (
    <blockquote className={`review-quote${outdated ? " outdated" : ""}`}>
      <span className="review-quote-where">
        {fieldLabel(anchor.field)}
        {outdated && (
          <span className="review-tag review-tag-outdated" title="The design no longer says this -- it was edited after the comment was left.">
            outdated
          </span>
        )}
      </span>
      {anchor.quote}
    </blockquote>
  );
}

function Composer({
  target,
  designs,
  onClose,
  onPosted,
}: {
  target: { designId: string; anchor?: CommentAnchor };
  designs: DesignStatement[];
  onClose: () => void;
  onPosted: () => void;
}) {
  const apiFetch = useApiFetch();
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const ref = useRef<HTMLFormElement | null>(null);

  // On a phone the rail sits below the design, so the composer a reviewer
  // just opened can be a screen away from the text they highlighted.
  useEffect(() => scrollIntoViewIfPossible(ref.current), []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    setError(undefined);
    try {
      await postDesignComment(apiFetch, target.designId, body, target.anchor);
      onPosted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPosting(false);
    }
  }

  const repoNote = designs.length > 1 && !target.anchor ? designs.find((d) => d.id === target.designId)?.projectId : undefined;

  return (
    <form className="review-composer" onSubmit={submit} ref={ref}>
      {target.anchor ? <Quote anchor={target.anchor} outdated={false} /> : <p className="review-whole">On the whole design{repoNote ? ` (${repoNote})` : ""}</p>}
      <textarea aria-label="Your comment" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What's unclear or wrong here?" rows={3} disabled={posting} autoFocus />
      <div className="review-composer-actions">
        <button type="submit" disabled={posting || !draft.trim()}>
          {posting ? "Posting…" : "Comment"}
        </button>
        <button type="button" className="review-link" onClick={onClose} disabled={posting}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="comment-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function CommentCard({
  located,
  replies,
  readOnly,
  active,
  onActivate,
  onChanged,
}: {
  located: LocatedComment;
  replies: DesignCommentReply[];
  readOnly?: boolean;
  active: boolean;
  onActivate: (id: string | undefined) => void;
  onChanged: () => void;
}) {
  const { comment, outdated, designChanged } = located;
  const apiFetch = useApiFetch();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const ref = useRef<HTMLLIElement | null>(null);

  // Clicking a highlight activates its card; bring it into view.
  useEffect(() => {
    if (active) scrollIntoViewIfPossible(ref.current);
  }, [active]);

  function activate() {
    onActivate(comment.id);
    // Comment ids are server-minted UUIDs, so they are safe inside a quoted
    // attribute selector as they are.
    scrollIntoViewIfPossible(document.querySelector(`mark[data-comment-ids~="${comment.id}"]`));
  }

  async function run(action: () => Promise<unknown>) {
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

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    const text = reply.trim();
    if (!text) return;
    await run(async () => {
      await postCommentReply(apiFetch, comment.id, text);
      setReply("");
    });
  }

  return (
    <li ref={ref} className={`review-card review-card-${comment.status}${active ? " active" : ""}`} onClick={activate}>
      <div className="review-card-head">
        <span className="comment-author">{comment.authorId}</span>
        <span className="comment-meta">{relativeTime(comment.createdAt)}</span>
      </div>
      {comment.anchor ? <Quote anchor={comment.anchor} outdated={outdated} /> : <p className="review-whole">On the whole design</p>}
      {designChanged && comment.status === "open" && (
        <p className="review-tag review-tag-changed" title="The design was amended or re-planned after this comment was left -- that may be the answer.">
          design changed since this comment
        </p>
      )}
      <p className="comment-body">{comment.body}</p>

      {replies.length > 0 && (
        <ul className="comment-replies">
          {replies.map((r, i) => (
            <li key={i} className="comment-reply">
              <div className="comment-reply-meta">
                <span>{r.authorId ?? "someone"}</span>
                <span>{relativeTime(r.ts)}</span>
              </div>
              <p>{r.message}</p>
            </li>
          ))}
        </ul>
      )}

      {comment.status === "resolved" && <p className="review-resolved-note">Resolved{comment.resolvedBy ? ` by ${comment.resolvedBy}` : ""}</p>}

      {/* Hidden for the public /observe viewer, which can read the whole
          review and write none of it. The server rejects these writes
          regardless; this is the nicety of not showing a dead end. */}
      {!readOnly && comment.status === "open" && (
        <div className="comment-actions" onClick={(e) => e.stopPropagation()}>
          <form className="comment-reply-form" onSubmit={sendReply}>
            <textarea aria-label="Reply to this comment" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" rows={2} disabled={busy} />
            <button type="submit" disabled={busy || !reply.trim()}>
              Reply
            </button>
          </form>
          {comment.canResolve ? (
            <button type="button" className="comment-resolve" disabled={busy} onClick={() => void run(() => resolveComment(apiFetch, comment.id))}>
              Resolve
            </button>
          ) : (
            <span className="comment-resolve-note">{comment.authorId} resolves this one</span>
          )}
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
