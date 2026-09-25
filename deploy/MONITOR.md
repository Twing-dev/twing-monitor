# Install and upgrade twing-monitor

`twing-monitor` is a static dashboard for a twing coordinator. The installer
builds the current dashboard from source, creates a Docker Compose stack, and
stores its lifecycle command at `~/.twing/monitor/twing-monitor`.

Requirements: Docker Engine/Desktop with Docker Compose v2. For HTTPS, point
the dashboard DNS name at this host and allow inbound TCP ports 80 and 443.
Caddy obtains and renews the certificate.

## Install

Install a public HTTPS dashboard. `--coordinator` is compiled into the static
bundle as the initial URL on the login screen:

```sh
curl -fsSL https://raw.githubusercontent.com/Twing-dev/twing-monitor/main/deploy/install-monitor.sh | sh -s -- \
  --domain monitor.example.com \
  --coordinator https://twing.example.com
```

The coordinator must allow the dashboard origin in CORS. The supported server
installer updates that setting for you:

```sh
curl -fsSL https://raw.githubusercontent.com/Twing-dev/twing-cli/main/deploy/install-server.sh | sh -s -- upgrade \
  --monitor-url https://monitor.example.com
```

Without this setting, browsers block the dashboard's `/v1/*` API calls even
though both URLs are reachable.

For a trusted private network, expose the dashboard directly without TLS:

```sh
curl -fsSL https://raw.githubusercontent.com/Twing-dev/twing-monitor/main/deploy/install-monitor.sh | sh -s -- \
  --insecure-http --bind 0.0.0.0 --port 8080 \
  --coordinator http://10.0.0.25:8787
```

Configure the matching origin with the server installer:

```sh
curl -fsSL https://raw.githubusercontent.com/Twing-dev/twing-cli/main/deploy/install-server.sh | sh -s -- upgrade \
  --monitor-url http://<monitor-host>:8080
```

HTTP exposes personal access tokens and API traffic; do not publish this mode
to the internet.

Use a custom installation directory when required:

```sh
curl -fsSL https://raw.githubusercontent.com/Twing-dev/twing-monitor/main/deploy/install-monitor.sh | sh -s -- \
  --domain monitor.example.com --coordinator https://twing.example.com \
  --dir /srv/twing-monitor
```

## Upgrade and operate

An upgrade rebuilds the current main branch with the saved coordinator URL,
then replaces the dashboard. HTTPS domain, ports, and CORS guidance remain the
same.

```sh
curl -fsSL https://raw.githubusercontent.com/Twing-dev/twing-monitor/main/deploy/install-monitor.sh | sh -s -- upgrade
~/.twing/monitor/twing-monitor status
~/.twing/monitor/twing-monitor stop
```

Add `--dir /srv/twing-monitor` to every lifecycle command for a custom
installation.

## Uninstall

Uninstall stops the generated Compose stack, removes its volumes and network,
then removes only the monitor installation directory. It refuses directories
without the installation marker created by this installer.
Installations created before this marker was introduced are intentionally not
deleted automatically.

```sh
curl -fsSL https://raw.githubusercontent.com/Twing-dev/twing-monitor/main/deploy/install-monitor.sh | sh -s -- uninstall
```

For a custom installation directory:

```sh
curl -fsSL https://raw.githubusercontent.com/Twing-dev/twing-monitor/main/deploy/install-monitor.sh | sh -s -- uninstall \
  --dir /srv/twing-monitor
```
