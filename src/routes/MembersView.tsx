import { useState, type CSSProperties } from "react";
import { useApiFetch } from "../api/client.js";
import { fetchMembers } from "../api/members.js";
import type { ProjectMember, ProjectSummary } from "../api/types.js";
import { useAsyncData } from "../hooks/useAsyncData.js";
import { AsyncSection } from "../components/AsyncSection.js";
import { StatusBadge, type BadgeTone } from "../components/StatusBadge.js";
import { dedupeMembersByDeveloper } from "../lib/aggregate.js";
import { repoLabel } from "../lib/repoLabel.js";
import { developerLabel } from "../lib/developerLabel.js";

function toneForRole(role: "admin" | "member"): BadgeTone {
  return role === "admin" ? "accent" : "neutral";
}

/** Up to two initials for the avatar.
 *
 * Taken from the *displayed* name rather than the raw id, so a GitHub
 * noreply address gives `ay` for `ayushsingh4522` instead of a digit from
 * the numeric prefix GitHub assigned. Splits on the separators real handles
 * use (`.`, `-`, `_`, `+`) when there is one, since `jc` reads as a person
 * where `ju` reads as a fragment; falls back to the first two characters. */
function initialsFor(label: string): string {
  const parts = label.split(/[.\-_+]/).filter(Boolean);
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

/** A stable hue per developer, so the same person is the same colour on
 * every visit and two people next to each other are reliably different.
 *
 * Deterministic from the id, never from list position -- a colour that moved
 * when somebody joined would be worse than no colour at all. The exact hash
 * does not matter beyond being well spread and cheap; this is the usual
 * djb2-style accumulate, taken mod 360.
 *
 * Colour is decoration here and carries no meaning on its own: role is said
 * in words on every chip, so nobody has to tell these hues apart to use the
 * page. */
function hueFor(developerId: string): number {
  let hash = 0;
  for (const char of developerId) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

/** The avatar, which both layouts use. `aria-hidden` because the initials are
 * a compressed form of the name rendered beside it -- a screen reader reading
 * "A Y, ayushsingh4522" is worse than reading the name once. */
function Avatar({ developerId, label, size }: { developerId: string; label: string; size: "sm" | "md" }) {
  return (
    <span className={`member-avatar member-avatar-${size}`} style={{ "--member-hue": hueFor(developerId) } as CSSProperties} aria-hidden="true">
      {initialsFor(label)}
    </span>
  );
}

/** Who someone is: the readable name, with the id it came from underneath.
 *
 * `developerLabel` can collide (same local part, different domains), so the
 * value that is actually unique stays on screen rather than only on a
 * tooltip -- see that helper's own doc comment. */
function Identity({ developerId }: { developerId: string }) {
  return (
    <span className="member-identity">
      <span className="member-name">{developerLabel(developerId)}</span>
      <span className="member-id" title={developerId}>
        {developerId}
      </span>
    </span>
  );
}

/** The two ways to read this page.
 *
 * `person` asks "what is X on", `repo` asks "who is on X". Neither answers
 * the other without the reader doing the work themselves: by person, a repo's
 * admins are scattered down the page; by repo, somebody on six repos appears
 * six times. They are genuinely different questions rather than two skins, so
 * both are offered rather than one being picked for everyone. */
type MemberLayout = "person" | "repo";

/** Members of one repo, admins first.
 *
 * Grouped from the flat list rather than from `dedupeMembersByDeveloper`'s
 * output: this view wants the original `(developer, repo)` pairs, which is
 * exactly what that helper collapses. Sorting by role then name keeps "who
 * runs this" at the top, which is the question with consequences. */
function byRepo(items: ProjectMember[]): Map<string, ProjectMember[]> {
  const out = new Map<string, ProjectMember[]>();
  for (const m of items) {
    const list = out.get(m.projectId) ?? [];
    list.push(m);
    out.set(m.projectId, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => (a.role === b.role ? developerLabel(a.developerId).localeCompare(developerLabel(b.developerId)) : a.role === "admin" ? -1 : 1));
  }
  return out;
}

/** One row per developer -- `dedupeMembersByDeveloper` collapses however
 * many of the selected repos they belong to into that developer's own
 * `memberships`, each rendered as its own repo/role chip (a developer can
 * be `admin` in one repo and `member` in another, so these aren't
 * collapsed further). A single-repo view has at most one membership per
 * developer already, so this renders identically to before aggregation
 * existed. */
export function MembersView({ projectIds, projectsById }: { projectIds: string[]; projectsById: Record<string, ProjectSummary> }) {
  const apiFetch = useApiFetch();
  const state = useAsyncData(
    () => Promise.all(projectIds.map((pid) => fetchMembers(apiFetch, pid))).then((lists) => lists.flat()),
    [apiFetch, projectIds.join(",")],
  );

  const showRepoLabel = projectIds.length > 1;
  /** Local, like `WorkView`'s own "Mine" toggle -- not in the URL. A shared
   * link should open on whatever the reader prefers rather than carrying the
   * sender's choice of layout, since both show the same facts. */
  const [layout, setLayout] = useState<MemberLayout>("person");

  return (
    <div className="list-view">
      {/* Only offered when there is more than one repo on screen. With one,
          "by repo" is a single section containing the whole list and "by
          person" is the same list again -- a control whose two states look
          identical teaches people not to trust controls. */}
      {showRepoLabel && (
        <div className="member-layout-toggle" role="group" aria-label="Group members by">
          <button type="button" className={`work-pill${layout === "person" ? " active" : ""}`} aria-pressed={layout === "person"} onClick={() => setLayout("person")}>
            By person
          </button>
          <button type="button" className={`work-pill${layout === "repo" ? " active" : ""}`} aria-pressed={layout === "repo"} onClick={() => setLayout("repo")}>
            By repo
          </button>
        </div>
      )}
      <AsyncSection
        state={state}
        isEmpty={(items) => items.length === 0}
        emptyMessage="No members found."
        render={(items: ProjectMember[]) => {
          if (layout === "repo" && showRepoLabel) {
            return (
              <div className="member-repo-groups">
                {[...byRepo(items).entries()]
                  .sort((a, b) => repoLabel(projectsById[a[0]] ?? { projectId: a[0] }).localeCompare(repoLabel(projectsById[b[0]] ?? { projectId: b[0] })))
                  .map(([projectId, members]) => {
                    const admins = members.filter((m) => m.role === "admin");
                    const plain = members.filter((m) => m.role !== "admin");
                    return (
                      <section key={projectId} className="member-repo-group">
                        <header className="member-repo-group-head">
                          <span className="member-repo-group-name">{repoLabel(projectsById[projectId] ?? { projectId })}</span>
                          <span className="member-repo-group-count">
                            {members.length} {members.length === 1 ? "person" : "people"} · {admins.length} admin{admins.length === 1 ? "" : "s"}
                          </span>
                        </header>
                        {/* Admins under their own heading rather than
                            distinguished by chip colour alone: "who runs this
                            repo" is the question with consequences, and
                            colour is the weakest way to answer it. */}
                        {[
                          { label: "Admins", list: admins },
                          { label: "Members", list: plain },
                        ]
                          .filter((section) => section.list.length > 0)
                          .map((section) => (
                            <div key={section.label}>
                              <h3 className="member-subhead">{section.label}</h3>
                              <ul className="member-chip-list">
                                {section.list.map((m) => (
                                  <li key={m.developerId} className={`member-chip${m.role === "admin" ? " member-chip-admin" : ""}`}>
                                    <Avatar developerId={m.developerId} label={developerLabel(m.developerId)} size="sm" />
                                    <span className="member-chip-name" title={m.developerId}>
                                      {developerLabel(m.developerId)}
                                    </span>
                                    <StatusBadge label={m.role} tone={toneForRole(m.role)} />
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                      </section>
                    );
                  })}
              </div>
            );
          }
          const developers = dedupeMembersByDeveloper(items);
          return (
            /* The roster: one line per person, repos inline (2026-10-07).
               Two fixed columns rather than a flex row, which is what makes
               the name un-squeezable -- it owns its column, the repos own
               theirs and wrap downward inside it, and neither can take width
               from the other. That is a different mechanism from clamping a
               flex item, and it is why the clipped names this page used to
               show cannot come back. */
            <div className="member-roster">
              <div className="member-roster-head">
                <span>Member</span>
                <span>{showRepoLabel ? "Repositories & role" : "Role"}</span>
              </div>
              <ul className="member-roster-list">
                {developers.map((dev) => {
                  const sorted = [...dev.memberships].sort((a, b) =>
                    repoLabel(projectsById[a.projectId] ?? { projectId: a.projectId }).localeCompare(repoLabel(projectsById[b.projectId] ?? { projectId: b.projectId })),
                  );
                  return (
                    <li key={dev.developerId} className="member-roster-row">
                      <div className="member-who">
                        <Avatar developerId={dev.developerId} label={developerLabel(dev.developerId)} size="md" />
                        <Identity developerId={dev.developerId} />
                      </div>
                      <ul className="member-repos">
                        {sorted.map((m) => (
                          <li key={m.projectId} className={`member-repo${m.role === "admin" ? " member-repo-admin" : ""}`}>
                            {/* The repo name is omitted in a single-repo view
                                for the same reason every other badge on this
                                page is: the view already says which repo you
                                are in. The role still shows -- it is the whole
                                point of the row. */}
                            {showRepoLabel && <span className="member-repo-name">{repoLabel(projectsById[m.projectId] ?? { projectId: m.projectId })}</span>}
                            <StatusBadge label={m.role} tone={toneForRole(m.role)} />
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        }}
      />
    </div>
  );
}
