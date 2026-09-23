#!/bin/sh
set -eu

WRAPPER_URL="${TWING_MONITOR_WRAPPER_URL:-https://raw.githubusercontent.com/Twing-dev/twing-monitor/main/deploy/twing-monitor}"
install_dir="${HOME}/.twing/monitor"
previous=""
action="install"

case "${1:-}" in
  install|upgrade) action="$1"; shift ;;
  --*|'') ;;
  *) echo "install-monitor: expected install or upgrade" >&2; exit 1 ;;
esac

for argument in "$@"; do
  if [ "$previous" = "--dir" ]; then
    install_dir="$argument"
    previous=""
  elif [ "$argument" = "--dir" ]; then
    previous="--dir"
  fi
done

case "$install_dir" in
  /*) ;;
  *) install_dir="$PWD/$install_dir" ;;
esac

command -v curl >/dev/null 2>&1 || { echo "install-monitor: curl is required" >&2; exit 1; }
mkdir -p "$install_dir"
installer="$install_dir/twing-monitor"
curl -fsSL "$WRAPPER_URL" -o "$installer"
chmod 700 "$installer"
exec "$installer" "$action" "$@"
