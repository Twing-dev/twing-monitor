import type { ReactNode } from "react";
import type { DesignStatement, ProjectSummary } from "../api/types.js";
import { uniqueBy } from "../lib/aggregate.js";
import { deriveTitle } from "../lib/designTitle.js";
import { relativeTime } from "../lib/time.js";
import { RepoBadge } from "./RepoBadge.js";

/**
 * Labels one member's panel inside a grouped design's body, for a group that
 * has more than one member.
 *
 * `WorkView`'s detail tabs stack one panel per member -- comments, chat and
 * declared changes are all per design even though a `--group`-linked chain is
 * one logical unit of work (`dedupeDesignsByGroup`). Nothing in those panels
 * said *which* member it was, though: `DesignComments`/`DesignChat` each render
 * a fixed heading of their own ("Discussion", "Ask this design"), so four
 * members read as one panel rendered four times rather than as four designs.
 * Observed live on a real four-member group -- four "What's changing" and four
 * "Discussion" blocks under a single title taken from `members[0]`, with the
 * other three designs given no on-screen existence at all.
 *
 * **`summary` is the load-bearing label here**, not the metadata beside it. A
 * linked chain is typically one developer's consecutive work in one session, so
 * `developerId` is identical across members and `lastActivityAt` differs by
 * minutes -- neither distinguishes anything. The summaries genuinely differ
 * (they are separate designs), and they are the only field that always does.
 * Run through `deriveTitle` because a real summary accumulates each amendment's
 * text and runs to hundreds of words; that helper already extracts the headline.
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
      <div className="member-panel-title">{deriveTitle(member.summary)}</div>
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
