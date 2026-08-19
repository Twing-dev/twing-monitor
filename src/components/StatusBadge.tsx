export type BadgeTone = "neutral" | "good" | "warning" | "critical" | "accent";

/** A small uppercase pill -- design/review/thread status, verdicts,
 * constraint types, all reduce to "a short label with a semantic tone."
 * Semantic tone (good/warning/critical) is deliberately its own thing,
 * separate from the page's accent hue (index.css's `--accent`) -- see
 * artifact-design conventions this app otherwise follows: severity color
 * shouldn't double as the brand accent. */
export function StatusBadge({ label, tone }: { label: string; tone: BadgeTone }) {
  return <span className={`status-badge tone-${tone}`}>{label}</span>;
}
