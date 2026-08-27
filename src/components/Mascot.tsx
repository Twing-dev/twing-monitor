/** A single Twing mascot figure -- the same round-bodied, stick-limbed
 * character from twing.dev's homepage hero (a whole crowd of these, each
 * ~300px tall), scaled way down and used one at a time here. Monitor is a
 * dense working dashboard, not a landing page, so this only shows up in
 * empty states (AsyncSection, RepoListView's first-run message) rather than
 * as a persistent decoration -- a small nod to the same brand rather than a
 * redecoration of the whole app. `color` is one of the homepage's own body
 * colors (#ff5c7a pink / #6ec3e6 blue / #ffb020 amber / #7dd0ac green /
 * #b29ae8 purple); limbs and face use `--text-dim` instead of the
 * homepage's fixed `#37324a` ink so the figure reads correctly in both
 * light and dark theme without a separate palette. No ground-shadow ellipse
 * at this size -- it read as a stray smudge once the figure was under
 * ~80px, and empty states already sit on plain background. */
export function Mascot({ color = "#6ec3e6", size = 44 }: { color?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 100 190"
      width={size}
      height={(size * 190) / 100}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="presentation"
      aria-hidden="true"
    >
      <line x1="36" y1="132" x2="26" y2="168" stroke="var(--text-dim)" strokeWidth={6} strokeLinecap="round" />
      <line x1="64" y1="132" x2="74" y2="168" stroke="var(--text-dim)" strokeWidth={6} strokeLinecap="round" />
      <line x1="20" y1="86" x2="8" y2="112" stroke="var(--text-dim)" strokeWidth={5} strokeLinecap="round" />
      <line x1="80" y1="86" x2="92" y2="112" stroke="var(--text-dim)" strokeWidth={5} strokeLinecap="round" />
      <ellipse cx="50" cy="82" rx="40" ry="46" fill={color} />
      <circle cx="37" cy="76" r="4" fill="var(--text-dim)" />
      <circle cx="63" cy="76" r="4" fill="var(--text-dim)" />
      <path d="M39 92 Q50 99 61 92" stroke="var(--text-dim)" strokeWidth={2.5} fill="none" strokeLinecap="round" />
    </svg>
  );
}
