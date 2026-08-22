# twing-monitor

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

It's deliberately v1/read-only: no approve/reject/resolve/close actions from
the UI yet (the server routes for those already exist — this is a scoping
choice, not a limitation of the API).

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
