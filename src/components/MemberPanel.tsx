import type { ReactNode } from "react";
import type { DesignStatement, ProjectSummary } from "../api/types.js";
import { uniqueBy } from "../lib/aggregate.js";
import { relativeTime } from "../lib/time.js";
import { RepoBadge } from "./RepoBadge.js";

/**
 * Labels one member's panel inside a grouped design's body, for a group
 * that has more than one member.
 *
 * Both views that expand a group stack one panel per member -- WorkView's
 * detail tabs and DesignsView's card body -- because comments, chat and
 * conformance are all per design even though a `--group`-linked chain is
 * one logical unit of work (`dedupeDesignsByGroup`). Nothing *visible* in
 * those panels varies with which member it is, though: `summary`
 * propagates across a shared `groupId` server-side (see
 * `DesignStatement.groupId`), and `DesignComments`/`DesignChat` each render
 * a fixed heading of their own ("Discussion", "Ask this design") -- so two
 * members read as one panel rendered twice rather than as two designs.
 * `developerId`, `lastActivityAt` and `status` stay per member (linking is
 * only a label) and are what actually tells them apart.
 *
 * The repo badge moved in here from each call site, and now renders only
 * when the group genuinely spans repos: per member it repeated the one repo
 * the card/detail header already names, once per member, which is most of
 * what read as duplication in the first place.
 *
 * A group of one renders its panel bare -- the header above it already says
 * whose design this is, when it last moved and which repo it's in.
 *
 * `members` is the whole sibling list, not just this one: whether a label
 * is needed at all is a property of the group, not of the member.
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
