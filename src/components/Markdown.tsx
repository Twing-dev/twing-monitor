import type { ReactNode } from "react";
import { parseMarkdownBlocks, type MarkdownBlock } from "../lib/markdown.js";
import { HighlightableText } from "./DesignReview.js";
import type { CommentAnchorField } from "../api/types.js";

/**
 * Renders a design's block-level markdown (2026-10-02).
 *
 * Built on React elements rather than `innerHTML`/`dangerouslySetInnerHTML`:
 * a design's text comes from whatever an agent extracted or a developer
 * typed, so handing it to the DOM as markup would be an injection sink, and
 * avoiding it means no sanitizer dependency either. This package still
 * depends on nothing but React.
 *
 * ## Every block is its own review run
 *
 * When `designId` is given, each block's text goes through
 * `HighlightableText` at the block's **own source offset** -- the same
 * many-runs-per-field shape the sentence bullets used, so comment anchoring
 * needs no change. `markdown.ts`'s offset invariant is what makes that safe;
 * see its header.
 *
 * Without `designId` (the editor's preview) the text renders plainly: there
 * is nothing to comment on in a draft, and wiring it to the review context
 * would let a preview mutate the rail.
 *
 * Consecutive list items are grouped into one `<ul>`/`<ol>` so a list reads
 * as a list, while each item stays a separate run.
 */
export function Markdown({ source, designId, field = "summary", documentGroupId, documentRevision }: {
  source: string | null | undefined; designId?: string; field?: CommentAnchorField;
  documentGroupId?: string; documentRevision?: number;
}) {
  const blocks = parseMarkdownBlocks(source);
  if (blocks.length === 0) return null;

  const text = (block: MarkdownBlock): ReactNode =>
    designId ? <HighlightableText designId={designId} field={field} documentGroupId={documentGroupId}
      documentRevision={documentRevision} text={block.text} offset={block.offset} /> : block.text;

  const rendered: ReactNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];

    // Runs of list items of the same kind collapse into one list element.
    if (block.kind === "listItem" || block.kind === "orderedItem") {
      const kind = block.kind;
      const items: MarkdownBlock[] = [];
      while (i < blocks.length && blocks[i].kind === kind) {
        items.push(blocks[i]);
        i++;
      }
      const children = items.map((item) => <li key={item.offset}>{text(item)}</li>);
      rendered.push(
        kind === "listItem" ? (
          <ul key={block.offset} className="md-list">
            {children}
          </ul>
        ) : (
          <ol key={block.offset} className="md-list">
            {children}
          </ol>
        ),
      );
      continue;
    }

    switch (block.kind) {
      case "heading": {
        // Clamped to h4-h6: the pane's own section headings are h3, so an
        // overview's `#` must not outrank the UI's own structure.
        const level = Math.min(6, 3 + (block.level ?? 1));
        const Tag = `h${level}` as "h4" | "h5" | "h6";
        rendered.push(
          <Tag key={block.offset} className="md-heading">
            {text(block)}
          </Tag>,
        );
        break;
      }
      case "quote":
        rendered.push(
          <blockquote key={block.offset} className="md-quote">
            {text(block)}
          </blockquote>,
        );
        break;
      case "code":
        // Not highlightable: a quote taken from inside code is as likely to
        // be a fragment of syntax as something a reviewer meant to discuss,
        // and `<pre>`'s whitespace is exactly what the anchor matcher
        // collapses. Rendered verbatim instead.
        rendered.push(
          <pre key={block.offset} className="md-code">
            <code>{block.text}</code>
          </pre>,
        );
        break;
      default:
        rendered.push(
          <p key={block.offset} className="md-paragraph">
            {text(block)}
          </p>,
        );
    }
    i++;
  }

  return <div className="md">{rendered}</div>;
}
