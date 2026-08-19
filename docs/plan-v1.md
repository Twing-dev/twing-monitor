# twing-monitor: a web dashboard for repos/designs/activity/reviews

## Context

Everything in twing today is CLI/hook-driven — there's no way to see a
project's designs, activity, or review history without querying the
coordinator by hand. This plan builds **twing-monitor**, a separate,
not-yet-public web dashboard where a developer logs in once and sees all
their repos/projects, designs, activity, and reviews in one place.

Decisions locked in during planning:
- **Separate repo**: `/Users/mb/Projects/twing-monitor` (sibling to
  `twing-cli`, empty, not git-initialized yet) — not a workspace inside
  twing-cli, not public.
- **Auth (v1)**: paste-your-PAT. The dashboard stores it in `localStorage`
  (confirmed: persists across browser restarts, no repeat pasting) —
  deliberately not a GitHub OAuth web flow or a session/cookie system,
  neither of which exist anywhere in this codebase today. Reusing the exact
  credential the CLI already mints (`twing keygen`/`twing login`).
- **Tooling**: React + Vite SPA.
- **Scope, v1**: **read-only**. View repos/designs/activity/reviews; no
  approve/reject/resolve/close actions from the UI yet. Easy to relax later
  (`POST /v1/reviews/:id/decide` already exists server-side) — flagged here
  so it's an explicit, overridable choice, not an oversight.
- **Deploy**: twing-monitor gets its own repo, its own Docker Compose
  project, and its own Caddy site block — sharing twing-cli's existing
  Caddy instance via a shared external Docker network, rather than either
  bolting a 3rd service into twing-cli's own `docker-compose.yml` (its
  build context already reaches outside itself in a way that doesn't
  extend cleanly to a sibling repo) or standing up a second TLS-terminating
  Caddy (wasteful for a static SPA, and a literal port-80/443 conflict on
  the same box).

Three real gaps in today's API block this: there's no "list my
projects/repos" endpoint, `GET /v1/reviews` can never see decided/historical
reviews (hardcoded `pendingOnly=true`), and there's no read route for the
activity log at all (`eventsForProject` exists, unrouted). All three get
closed as part of this work.

## A. Server-side changes (twing-cli, `packages/server`)

All in `packages/server/src/app.ts` unless noted — this file (plus
`design-store.ts`/`identity-store.ts`) is `require_human_review`-flagged in
this repo's own `.twing/twing.yml`; expect the design gate to fire when this
is actually implemented (register a design, justify, get it approved —
same pattern as everywhere else this session).

1. **`GET /v1/projects`** (new route) — `{items: ProjectSummary[]}`, one
   entry per project in `identity.projects` (from the resolved token),
   merging in `identities.getProjectRecord(projectId)` (already exists,
   single-id only today) for `githubOwner`/`githubRepo`/`foundedBy`/
   `foundedAt`. No new `IdentityStore` method needed. A dedicated route
   rather than bloating `whoami`'s response — `whoami` is a
   CLI/hook-consumed identity primitive, not a UI listing endpoint.

2. **`GET /v1/reviews?status=`** (extend existing route) — `design-store.ts`'s
   `listReviews(projectId, pendingOnly = true)` becomes
   `listReviews(projectId, filter: "pending" | "decided" | "all" = "pending")`.
   `decided` is a new SQL branch (`isNotNull(reviewsTable.decision)`,
   `isNotNull` newly imported from `drizzle-orm`). The route reads
   `?status=`, defaults to `"pending"` — fully backward-compatible, no
   existing caller (CLI, hook) breaks.

3. **`GET /v1/activity?projectId=&before=&limit=&kind=`** (new route, new
   store method) — `activity-log.ts`'s `DrizzleActivityLog` gains
   `eventsForProjectPage(projectId, { before?, limit, kinds? })`: newest-first
   (`ORDER BY ts DESC`), `limit` (default 50, hard cap 200), optional
   `before` (ms epoch, exclusive) and `kind` (comma-separated
   `ActivityEventKind` filter). Response: `{items: ActivityEvent[],
   nextBefore?: number}` (`nextBefore` = oldest returned `ts`, present only
   when a fuller page suggests more history exists). Gated by
   `isProjectMember`, same as `/v1/designs`. The existing
   `activity_events_project_ts_idx` composite index already covers this
   query — confirmed in `db/schema.ts`, no new index needed. `payload`
   stays untyped JSON server-side (matches this codebase's existing
   hand-written-interface style, no schema-validation library anywhere) —
   the dashboard owns a per-`ActivityEventKind` formatter map with a
   raw-JSON fallback, so new event kinds degrade gracefully without a
   shared-type dependency between the two repos.

4. **CORS** — `createApp`'s options gain `corsOrigins?: string[]`
   (undefined/empty = no CORS middleware mounted at all, zero behavior
   change for existing self-hosted deployments). `main.ts` reads a new
   `TWING_SERVE_CORS_ORIGINS` env var (comma-separated) and passes it
   through. Mount `hono/cors` (already available — `hono` is an existing
   dependency, no new package) scoped to that explicit allowlist, never
   `*` (PATs ride as a real bearer credential, not public data) —
   registered **before** the existing auth middleware in source order, so
   an `OPTIONS` preflight (no `Authorization` header) doesn't hit the
   401 path first. No change to the auth mechanism itself — CORS only
   controls whether a browser may attach the header cross-origin.

**Tests**: extend `packages/server/src/app.test.ts` with the same
`app.request(...)`-in-process convention already used throughout the file
— coverage for `/v1/projects` (multi-project, zero-project, unauthenticated),
`/v1/reviews?status=` (pending/decided/all across a resolved+decided review,
confirming the default is unchanged), `/v1/activity` (project-scoping, 403
for non-members, `before`/`limit` cursoring, `kind` filtering), and CORS
(preflight allowed-origin headers present when configured, absent when not).

## B. twing-monitor (new repo)

React + Vite, MIT-licensed (talks to the coordinator over HTTP only, links
no AGPL server code — no reason to inherit `packages/server`'s license).

```
twing-monitor/
  src/
    api/
      client.ts        # apiFetch(): attaches bearer token, centralizes 401 handling
      types.ts          # hand-rolled ProjectSummary/ActivityEvent/etc mirrors +
                         # re-exports DesignStatement/Claim/Finding from @twing/core
      projects.ts, designs.ts, reviews.ts, activity.ts
    auth/
      storage.ts         # localStorage, same {servers: {url: {authToken}}, activeServerUrl}
                          # shape as @twing/core's TwingConfig -- not shared storage
                          # (browser can't read ~/.twing/config.json), but same mental
                          # model and forward-compatible with a future multi-coordinator UI
      ServerContext.tsx, useAuth.ts
      LoginScreen.tsx    # paste PAT + editable server URL (prefilled from
                          # VITE_DEFAULT_SERVER_URL), validates via GET /v1/auth/whoami
                          # before persisting anything
    routes/
      RepoListView.tsx, RepoDetailLayout.tsx (Designs/Activity/Reviews tabs),
      DesignsView.tsx, ActivityView.tsx, ReviewsView.tsx
    components/
      StatusBadge.tsx, ActivityEventRow.tsx (per-kind formatter), Table.tsx, etc.
```

Coordinator URL is a configurable, persisted field (default
`https://coordination-server.twing.dev` via `VITE_DEFAULT_SERVER_URL`, but
editable) — matches the CLI's own no-single-hardcoded-server philosophy, so
a self-hosted `twing serve` operator can point the dashboard at their own
coordinator without a rebuild.

**Tests**: Vitest + React Testing Library (Vitest specifically because it
shares Vite's own transform pipeline — no second toolchain to configure).
Narrow, real coverage rather than a from-scratch heavy setup: `api/client.ts`
(URL-building, auth header, 401 handling), `auth/storage.ts` (localStorage
round-trip — "persists across restarts" is a locked-in requirement worth
testing directly), `LoginScreen` (valid-PAT and rejected-PAT paths), and one
render smoke test per list view (empty + populated states). No
Playwright/e2e layer for v1 — no other package in this monorepo has one
either, and it's not where the risk is for a read-only dashboard.

## C. Deploy

1. `docker network create twing-edge` once, on the deploy box (external
   network bridging the two independently-versioned compose projects).
2. twing-monitor's own `deploy/docker/docker-compose.yml`: one service,
   built from a multi-stage `Dockerfile` (`node:22` build → static
   `nginx:alpine`/`caddy:alpine` runtime, no TLS/ACME config in this
   container). No published host ports; joins `twing-edge`.
3. twing-cli's existing `caddy` service additionally joins `twing-edge`
   (alongside its default network, so it keeps reaching `twing-serve:8787`
   by existing service-name DNS).
4. twing-cli's existing `deploy/docker/Caddyfile` gets one more
   automatic-HTTPS site block reusing the already-provisioned cert
   storage/rate-limit module:
   ```
   app.twing.dev {
       reverse_proxy twing-monitor:80
   }
   ```

Keeps the two repos' deploys/CI/release cycles fully decoupled while
reusing the one piece of infra (Caddy's TLS/rate-limit edge) that's
genuinely wasteful to duplicate for a static SPA.

## D. Order of work

1. Server: `GET /v1/projects` + CORS middleware (nothing else works in a
   browser without CORS; Repos is the dashboard's entry view).
2. Dashboard skeleton: Vite+React scaffold, `auth/`, `api/client.ts`,
   `RepoListView.tsx` — first demoable slice (paste a PAT, see real repos),
   proves the whole auth+CORS+fetch path end to end.
3. `DesignsView.tsx` (server side needs no change — `?status=` already
   exists).
4. Server: `GET /v1/reviews?status=` extension + `ReviewsView.tsx` — small,
   additive, backward-compatible.
5. Server: `GET /v1/activity` (new route + store method + pagination) +
   `ActivityView.tsx` — largest, most novel piece, sequenced last so the
   simpler patterns (auth, api client, list-view shell) are already proven.
6. Deploy: shared `twing-edge` network + twing-monitor compose project +
   Caddyfile site block, once there's something worth deploying (after
   step 2 or 3).

## Verification

- Server: `npm run build && npm run test` in twing-cli — new
  `app.test.ts` coverage green, full existing suite still green (no
  regressions to `/v1/reviews`'s default behavior in particular).
- Dashboard: `npm run test` (Vitest) in twing-monitor; manual run
  (`npm run dev`) against a local `twing serve --no-auth` or a real PAT
  against the dogfood coordinator, confirming each view renders real data.
- End-to-end: paste a real PAT, confirm Repos → Designs/Activity/Reviews
  navigation all render actual project data with no CORS errors in the
  browser console.
- Deploy: `curl -I https://app.twing.dev/` returns a valid cert once
  live; confirm `coordination-server.twing.dev` is unaffected (existing
  Caddy site block untouched, new one purely additive).
