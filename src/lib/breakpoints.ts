/**
 * The one place the phone breakpoint is written down.
 *
 * It is used twice -- by `@media (max-width: 640px)` in `index.css` and by
 * `useIsPhone` -- and the two must agree exactly. They decide different
 * halves of the same thing: the CSS decides which pane is visible, the hook
 * decides whether a row is auto-selected and whether the back control does
 * anything. If they drift, you get a back button on a two-pane desktop
 * layout, or a phone that shows an empty detail pane with no way back to
 * the list.
 *
 * 640px, not the 860px the existing query uses: that one is the tablet
 * behaviour (panes stack, both still visible) and is deliberately left
 * alone. Below 640px there is no room for two of anything.
 */
export const PHONE_MAX_WIDTH = 640;

/** The media query string, so the hook cannot phrase it differently from
 * the stylesheet. */
export const PHONE_MEDIA_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;
