/** A `developerId` rendered for display, the way `repoLabel` renders a
 * project -- a derived string for a list row, never a replacement for the id
 * itself.
 *
 * The ids this dashboard actually carries are addresses, and a
 * GitHub-founded one is the worst case: `twing join --github` mints
 * `206395444+ayushsingh4522@users.noreply.github.com`, 49 characters, which
 * in a 440px list pane truncates to `206395444+ayushsingh45...`. That clip
 * is the problem this solves -- not the width (the row stops overflowing
 * either way), but the fact that what survives the clip is a numeric prefix
 * GitHub assigned, so two owners can render an identical visible string
 * while differing past the ellipsis.
 *
 * Deliberately conservative: strip the parts that are known-mechanical (the
 * `<numeric-id>+` noreply prefix, the domain) and pass anything else through
 * untouched. A bare username, a uuid, or a label with an unexpected shape is
 * returned as-is rather than guessed at -- a wrong name is worse than a long
 * one, and the caller keeps the full id on a `title` regardless, so nothing
 * here is the only way to see who someone is.
 *
 * Shortening can collide (two addresses, same local part, different
 * domains). That is accepted for a list row and is why the full value stays
 * one hover away; anywhere the exact identity carries weight should render
 * `developerId` itself.
 */
export function developerLabel(developerId: string): string {
  const at = developerId.lastIndexOf("@");
  // No domain to drop: a bare username or an opaque id. Nothing mechanical
  // to strip, so nothing to do.
  if (at <= 0) return developerId;

  const local = developerId.slice(0, at);

  // GitHub's noreply form is `<numeric-id>+<login>@users.noreply.github.com`.
  // The digits are GitHub's, not the person's, and they are what the clip
  // used to leave visible. Matched on the whole local part rather than a bare
  // `+` split so an address that merely contains a plus (`me+twing@host`)
  // keeps its tag.
  const noreply = local.match(/^\d+\+(.+)$/);
  if (noreply) return noreply[1];

  return local;
}
