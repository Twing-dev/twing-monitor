import type { ReactNode } from "react";
import type { DesignStatement, ProjectSummary } from "../api/types.js";
import { uniqueBy } from "../lib/aggregate.js";
import { relativeTime } from "../lib/time.js";
import { RepoBadge } from "./RepoBadge.js";

/**
 * Labels one member's panel inside a grouped design's body, for a group that
 * has more than one member.
 *
 * `WorkView`'s detail tabs stack one panel per member -- chat and declared
 * changes are per design even though a `--group`-linked chain is one logical
 * unit of work (`dedupeDesignsByGroup`). Nothing in those panels said *which*
 * member it was, though: `DesignChat` renders a fixed heading of its own
 * ("Ask this design"), so four members read as one panel rendered four times
 * rather than as four designs. Observed live on a real four-member group --
 * four "What's changing" and four "Discussion" blocks under a single title
 * taken from `members[0]`, with the other three designs given no on-screen
 * existence at all.
 *
 * The "Discussion" half of that is gone since design review v2 (2026-09):
 * comments left `DesignComments` for a rail beside the whole tab, which is
 * handed every member of the group and names the design each comment is
 * against. Changes and chat still stack per member, so the label is still
 * what tells them apart.
 *
 * **The design's own title is no longer printed here** (2026-10-07). It was
 * the load-bearing label while nothing else told the members apart, and it
 * stopped being so once the overview above began rendering every member's
 * prose under its own repo heading: the title is `designTitle(summary)`, so
 * the reader met the same sentence twice, truncated the second time. What is
 * left is the metadata that genuinely differs -- a closed half beside an open
 * one is worth seeing, and `status` is the field that says so.
 *
 * The repo label is what distinguishes the panels now, which is why the
 * badge below is the one piece of labelling that stayed.
 *
 * The repo badge moved in here from each call site and now renders only when
 * the group actually spans repos. `groupId` is a *cross-project* label by
 * design (see `DesignStatement.groupId`), and per member it was repeating the
 * one repo the detail header already names -- four times over, for a group
 * living inside a single repo, which is most of what read as duplication.
 *
 * A group of one renders its panel bare: the header above it already gives the
 * summary, status, developer and repo, so labelling it again would be pure
 * repetition. That keeps the overwhelmingly common case pixel-identical.
 *
 * `members` is the whole sibling list, not just this one -- whether a label is
 * needed at all is a property of the group, not of the member.
 */
export function MemberPanel({
  member,
  members,
  showRepoBadge,
  projectsById,
  children,
}: {
  member: DesignStatement;
  members: DesignStatement[];
  showRepoBadge: boolean;
  projectsById: Record<string, ProjectSummary>;
  children: ReactNode;
}) {
  if (members.length === 1) return <>{children}</>;
  const spansRepos = uniqueBy(members, (m) => m.projectId).length > 1;

  return (
    <div className="member-panel">
      <div className="member-panel-heading">
        {showRepoBadge && spansRepos && <RepoBadge project={projectsById[member.projectId] ?? { projectId: member.projectId }} />}
        <span>{member.developerId}</span>
        <span className="sep">{relativeTime(member.lastActivityAt)}</span>
        <span className="sep">{member.status}</span>
      </div>
      {children}
    </div>
  );
}
