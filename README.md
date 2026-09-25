# twing-monitor

twing-monitor is the dashboard for a [twing](https://github.com/Twing-dev/twing-cli)
coordinator. It shows repositories, designs, reviews, activity, alignment
threads, members, and constraints.

## What You Can Do

- Inspect designs, their declared scope, and the claims made while implementing
  them.
- Review project activity, pending reviews, alignment threads, members, and
  constraints.
- Comment on a design or one declared change. The coordinator can answer from
  the design first; escalate the comment when a developer needs to respond.
- Ask a private question about a design. Answers are grounded in the captured
  session when the repository opted into session capture; transcripts are not
  sent to the browser.
- Resolve your own design-review comments. Project admins can resolve comments
  when the original reviewer is unavailable.

The dashboard does not approve reviews, close designs, or resolve alignment
threads. Use the CLI for those actions.

## Use The Hosted Dashboard

If your repository uses twing's public coordinator, open
[monitor.twing.dev](https://monitor.twing.dev). Do not install your own
monitor.

Sign in with GitHub to use the same identity as the CLI. A personal access
token is the fallback:

```sh
$HOME/.twing/bin/twing servers --show-token
```

For a no-auth coordinator, select **This server has no auth** and enter the
developer ID used for request attribution.

## Run Your Own Dashboard

Install a monitor only when you run your own twing server. The dashboard must
be served from an origin the coordinator allows through CORS.

For a public HTTPS server:

```sh
curl -fsSL https://raw.githubusercontent.com/Twing-dev/twing-monitor/main/deploy/install-monitor.sh | sh -s -- install \
  --domain monitor.example.com \
  --coordinator https://twing.example.com

curl -fsSL https://raw.githubusercontent.com/Twing-dev/twing-cli/main/deploy/install-server.sh | sh -s -- upgrade \
  --monitor-url https://monitor.example.com
```

For a trusted private network, use direct HTTP instead. HTTP exposes tokens
and API traffic, so never publish this mode to the internet:

```sh
curl -fsSL https://raw.githubusercontent.com/Twing-dev/twing-monitor/main/deploy/install-monitor.sh | sh -s -- install \
  --insecure-http --bind 0.0.0.0 --port 3000 \
  --coordinator http://server.internal:8787

curl -fsSL https://raw.githubusercontent.com/Twing-dev/twing-cli/main/deploy/install-server.sh | sh -s -- upgrade \
  --monitor-url http://monitor.internal:3000
```

See [the deployment guide](deploy/MONITOR.md) for custom directories, upgrade,
status, stop, and uninstall.

## Development

```sh
npm install
npm run dev
npm test
npm run build
```

`VITE_DEFAULT_SERVER_URL` sets the coordinator URL shown on the login screen.
