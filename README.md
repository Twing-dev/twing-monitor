# twing-monitor

Live at [monitor.twing.dev](https://monitor.twing.dev).

A read-only web dashboard for [twing](https://github.com/Twing-dev/twing-cli)'s
coordination server. Everything in twing is otherwise CLI/hook-driven — there's
no way to see a project's designs, activity, or review history without
querying the coordinator by hand. twing-monitor is that missing view: sign in
once with a personal access token and see every repo/project you're a member
of, and drill into each one.

Per repo, six tabs:

- **Designs** — every registered `DesignStatement` (open/flagged/dormant/
  closed/etc.), what it declared it `creates`/`touches`/`dependsOn`, and the
  `Claim`s a session actually made against it.
- **Reviews** — pending and decided `PendingReview`s from the §17
  adopt-or-justify flow (constraint flags and structural design-vs-design
  overlaps that got justified and sent for approval).
- **Activity** — the project's append-only activity log (claims, designs,
  reviews, constraint changes), paginated newest-first.
- **Alignment threads** — the async reply channel for cross-session
  divergence findings surfaced by `twing align`.
- **Members** — who's on the project and their role (`admin`/`member`).
- **Constraints** — the project's registered `DesignConstraint`s
  (`review_required`/`canonical_abstraction`/`domain_fact`) that the design
  gate checks every `Edit`/`Write` against.

Still mostly read-only: no approve/reject/resolve/close actions on designs,
reviews or threads from the UI (the server routes for those already exist —
this is a scoping choice, not a limitation of the API).

**Design review comments are the one exception** (2026-09), and the one place
this dashboard writes. Open a design and you get a discussion panel:

- Leave a comment on the design, or on one specific declared change.
- The **agent answers first** — the coordinator takes a pass at every comment
  from the design itself, so most questions never reach a person. Its answer
  appears within a few seconds, tinted so you never have to read a label to
  know a model wrote it.
- If that answer isn't enough, **you** decide. "Needs the developer" escalates
  it to whoever owns the design; they see it as a **non-blocking** banner at
  the start of their next Claude Code / Codex / OpenCode session, never as an
  interruption and never as a blocked edit. Their agent reads and replies with
  `twing design comments`.

The agent also recommends whether a comment needs a human, and that
recommendation is shown — but it never acts on it. The person who asked the
question is the only one who can judge whether it was answered.

Commits made by an agent carry a `Twing-Design:` trailer linking back to the
design here, so a reviewer reading `git log` can open it and comment. Those
links keep working after a design closes, which is the normal case rather than
the exception.

## Auth

Paste a personal access token (the same one `twing keygen`/`twing login`
mints) — stored in `localStorage` so you don't re-paste it every visit.
There's no GitHub OAuth web flow or session/cookie system here; the
dashboard is a thin client over the coordinator's existing `/v1/*` API,
authenticated exactly the way the CLI and hook already are.

## Development

```sh
npm install
npm run dev       # vite dev server
npm run test       # vitest
npm run build      # tsc -b && vite build
```

By default the dashboard points at whatever coordinator you log into (paste
its URL on the login screen); `VITE_DEFAULT_SERVER_URL` can bake in a default
at build time — see `deploy/docker/README.md`.

## Deploy

See `deploy/docker/README.md` — a static build served by Caddy, deployed
alongside twing-cli's own coordinator on the same box via a shared Docker
network (`monitor.twing.dev` reverse-proxying to this container,
`coordination-server.twing.dev` reverse-proxying to `twing-serve`).
