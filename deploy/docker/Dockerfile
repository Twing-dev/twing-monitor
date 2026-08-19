# Multi-stage build: `node:22` compiles the static Vite bundle, a bare
# `caddy:2` serves it -- no TLS/ACME config in this image at all, that's
# twing-cli's own `deploy/docker/caddy` service's job (see this repo's
# docs/plan-v1.md section C). This container is never published to the
# host network directly; it's only reachable from that other compose
# project's caddy, over the shared external `twing-edge` network, by
# service name (`twing-monitor:80`).
#
# VITE_DEFAULT_SERVER_URL bakes in at build time (Vite inlines import.meta.env
# into the bundle -- there's no server-side runtime to read an env var from
# once this is static files), so it's declared as a build ARG here rather
# than left to docker-compose.yml's `environment:`. .env.example's default
# (the real production coordinator) is exactly right for this build, so no
# override is required in the common case.
FROM node:22-bookworm AS builder
WORKDIR /app
ARG VITE_DEFAULT_SERVER_URL=https://coordination-server.twing.dev
ENV VITE_DEFAULT_SERVER_URL=$VITE_DEFAULT_SERVER_URL
COPY . .
RUN npm ci
RUN npm run build

FROM caddy:2 AS runtime
COPY --from=builder /app/dist /usr/share/caddy
COPY deploy/docker/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
