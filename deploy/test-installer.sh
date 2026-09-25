#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"

cat >"$tmp/bin/docker" <<'EOF'
#!/bin/sh
if [ "$1" = "compose" ] && [ "$2" = "version" ]; then
  exit 0
fi
printf '%s\n' "$*" >> "$DOCKER_LOG"
EOF
chmod 700 "$tmp/bin/docker"

cat >"$tmp/bin/curl" <<'EOF'
#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    cp "$WRAPPER_SOURCE" "$2"
    exit 0
  fi
  shift
done
exit 1
EOF
chmod 700 "$tmp/bin/curl"

export PATH="$tmp/bin:$PATH"
export DOCKER_LOG="$tmp/docker.log"
export WRAPPER_SOURCE="$root/deploy/twing-monitor"

owned="$tmp/owned"
"$root/deploy/twing-monitor" install --insecure-http --dir "$owned"
[[ -f "$owned/.twing-monitor-installation" ]]
"$root/deploy/twing-monitor" uninstall --dir "$owned"
[[ ! -e "$owned" ]]
grep -Fq 'down --volumes --remove-orphans' "$DOCKER_LOG"

unowned="$tmp/unowned"
mkdir "$unowned"
touch "$unowned/.env" "$unowned/compose.yaml" "$unowned/keep"
if "$root/deploy/twing-monitor" uninstall --dir "$unowned" >/dev/null 2>&1; then
  echo "uninstall accepted an unowned directory" >&2
  exit 1
fi
[[ -f "$unowned/keep" ]]

missing="$tmp/not-created"
if TWING_MONITOR_WRAPPER_URL=https://example.invalid/wrapper "$root/deploy/install-monitor.sh" uninstall --dir "$missing" >/dev/null 2>&1; then
  echo "uninstall accepted a missing directory" >&2
  exit 1
fi
[[ ! -e "$missing" ]]
