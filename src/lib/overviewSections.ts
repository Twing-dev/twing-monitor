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
