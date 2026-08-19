/** Coarse, human-readable relative time ("3h ago", "2d ago") -- mirrors
 * hook/design_gate.go's dormantSinceText and design.ts's own relativeTime
 * (CLI side), just enough to judge "recently" vs "a while ago." */
export function relativeTime(ms: number): string {
  const diffMs = Date.now() - ms;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
