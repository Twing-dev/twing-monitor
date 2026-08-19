# deploy/docker/

Runs the twing-monitor dashboard as a static site, built by `node:22` and
served by a bare `caddy:2` (no TLS/ACME in this container). Deployed
alongside `coordination-server.twing.dev`'s own `twing-cli/deploy/docker`
compose project on the same box, joined by a shared external Docker
network -- see `docs/plan-v1.md` section C for why it's split this way
(two independently versioned compose projects, one TLS-terminating Caddy).

## Setup (once per box)

```sh
docker network create twing-edge
```

Idempotent-ish in intent, but `docker network create` errors if it already
exists -- only run this the first time either project sets it up. Whichever
of twing-cli/twing-monitor gets deployed first on a given box creates it;
the other just joins.

twing-cli's own `deploy/docker/docker-compose.yml` needs its `caddy`
service added to this network (alongside its default network, so it keeps
reaching `twing-serve:8787` by existing service-name DNS) and its
`deploy/docker/Caddyfile` needs one more site block:

```
app.twing.dev {
	reverse_proxy twing-monitor:80
}
```

Point `app.twing.dev` at the box's public IP (DNS A record) before
starting -- Caddy needs that to issue a Let's Encrypt cert, same as
`coordination-server.twing.dev` already required.

## Start

```sh
git clone git@github.com:mahulb/twing-monitor.git
cd twing-monitor/deploy/docker
docker compose up -d --build
```

Then (re)start twing-cli's own `caddy` service so it picks up the network
membership + new site block:

```sh
cd ../../twing-cli/deploy/docker
docker compose up -d --build caddy
```

## Redeploy (ship a change)

```sh
cd twing-monitor && git pull
cd deploy/docker && docker compose up -d --build
```

Only rebuilds/replaces the `twing-monitor` container -- the TLS-terminating
`caddy` in twing-cli's own compose project is untouched by this, since the
site block it needs was already added once during setup.

## Pointing at a different coordinator

`VITE_DEFAULT_SERVER_URL` bakes into the static bundle at build time (Vite
inlines `import.meta.env`, there's no server-side runtime to read an env
var from once this is static files) -- override it in `.env` next to this
compose file (`cp .env.example .env` first) rather than passing `-e`, since
`docker compose up` won't otherwise see it on a plain rebuild:

```sh
echo "VITE_DEFAULT_SERVER_URL=https://your-coordinator.example.com" > .env
docker compose up -d --build
```

Defaults to `https://coordination-server.twing.dev` if unset -- correct for
this deployment, so no `.env` is required in the common case.
