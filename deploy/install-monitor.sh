#!/bin/sh
set -eu

WRAPPER_URL="${TWING_MONITOR_WRAPPER_URL:-https://raw.githubusercontent.com/Twing-dev/twing-monitor/main/deploy/twing-monitor}"
install_dir="${HOME}/.twing/monitor"
previous=""
action="install"

case "${1:-}" in
  install|upgrade|uninstall) action="$1"; shift ;;
  --*|'') ;;
  *) echo "install-monitor: expected install, upgrade, or uninstall" >&2; exit 1 ;;
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
if [ "$action" = "uninstall" ]; then
  installer="$(mktemp "${TMPDIR:-/tmp}/twing-monitor.XXXXXX")" || { echo "install-monitor: could not create temporary file" >&2; exit 1; }
  trap 'rm -f "$installer"' EXIT HUP INT TERM
  curl -fsSL "$WRAPPER_URL" -o "$installer"
  chmod 700 "$installer"
  "$installer" "$action" "$@"
  exit $?
fi

if [ "$action" = "install" ] && [ -e "$install_dir" ]; then
  [ -d "$install_dir" ] && [ ! -L "$install_dir" ] || { echo "install-monitor: $install_dir must be an empty directory" >&2; exit 1; }
  for entry in "$install_dir"/* "$install_dir"/.[!.]* "$install_dir"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    echo "install-monitor: $install_dir must be empty" >&2
    exit 1
  done
fi

mkdir -p "$install_dir"
installer="$install_dir/twing-monitor"
curl -fsSL "$WRAPPER_URL" -o "$installer"
chmod 700 "$installer"
exec "$installer" "$action" "$@"
