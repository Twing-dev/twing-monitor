/**
 * The coordinator writes design overviews as two lines (2026-10-11):
 *
 *   Problem: <what's wrong and why it matters>
 *   Approach: <how the change solves it>
 *
 * Rendered as one paragraph, the line break is lost and "Approach:" lands
 * mid-sentence, where readers miss it. This splits the text so each part can
 * be shown under its own label.
 *
 * Each section carries `offset`, the position of its body in the full text,
 * so review comments -- anchored by character offset into the whole overview
 * -- still land on the same characters after the split.
 *
 * Text without these labels (older overviews, a human-edited one) comes back
 * as a single unlabelled section, so it renders exactly as before.
 */

export interface OverviewSection {
  /** "Problem" or "Approach"; absent for unlabelled text. */
  label?: string;
  body: string;
  offset: number;
}

const LABEL = /^(problem|approach):[ \t]*/gim;

export function splitOverviewSections(text: string): OverviewSection[] {
  const matches = [...text.matchAll(LABEL)];
  if (matches.length === 0) return [{ body: text, offset: 0 }];

  const sections: OverviewSection[] = [];
  // Anything before the first label stays, unlabelled, rather than vanishing.
  const lead = text.slice(0, matches[0].index).trim();
  if (lead) sections.push({ body: lead, offset: text.indexOf(lead) });

  matches.forEach((match, i) => {
    const start = match.index + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const body = text.slice(start, end).trimEnd();
    const word = match[1].toLowerCase();
    sections.push({ label: word[0].toUpperCase() + word.slice(1), body, offset: start });
  });
  return sections;
}

export interface OverviewBullet {
  text: string;
  /** Position of `text` in the full overview, for comment anchoring. */
  offset: number;
}

/**
 * The Approach is written as `- ` bullet lines (2026-10-11). Splits a
 * section body into its items so they render as a real list instead of one
 * run-on paragraph. Any text before the first bullet comes back as `lead`;
 * a non-bullet line after a bullet continues that bullet. Returns undefined
 * when the body has no bullets, so plain prose renders as before.
 *
 * `offset` is the body's own offset in the full overview; every returned
 * offset is absolute, like the section offsets above.
 */
export function splitBullets(body: string, offset: number): { lead?: OverviewBullet; items: OverviewBullet[] } | undefined {
  const items: { start: number; end: number }[] = [];
  let leadEnd = body.length;
  let position = 0;
  for (const line of body.split("\n")) {
    const bullet = /^\s*[-*•]\s+/.exec(line);
    if (bullet) {
      if (items.length === 0) leadEnd = position;
      items.push({ start: position + bullet[0].length, end: position + line.length });
    } else if (items.length > 0 && line.trim()) {
      items[items.length - 1].end = position + line.length;
    }
    position += line.length + 1;
  }
  if (items.length === 0) return undefined;

  const trimmed = (start: number, end: number): OverviewBullet | undefined => {
    const raw = body.slice(start, end);
    const text = raw.trim();
    return text ? { text, offset: offset + start + raw.indexOf(text) } : undefined;
  };
  return {
    lead: trimmed(0, leadEnd),
    items: items.map((i) => trimmed(i.start, i.end)).filter((i): i is OverviewBullet => i !== undefined),
  };
}
