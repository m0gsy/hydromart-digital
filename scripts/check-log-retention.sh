#!/usr/bin/env bash
# N14 — the log limits in this repo are a file somebody has to copy by hand.
#
# `ops/docker-daemon.json` says 50 MB × 3 per container. It only means anything if it is
# actually installed at /etc/docker/daemon.json on the box, and nothing has ever checked:
# a host that never got the file keeps Docker's default (unbounded json-file), which fills
# the disk, and a host that got an older copy keeps whatever it had. Both look identical
# from inside the repo.
#
#   bash scripts/check-log-retention.sh
#
# Reports what the live daemon is ACTUALLY doing — `docker info` rather than the file, so a
# file that was edited without restarting Docker cannot pass this.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=/dev/null
[ -f .env ] && . ./scripts/load-env.sh
# shellcheck source=scripts/lib/deploy-common.sh
. ./scripts/lib/deploy-common.sh

want_size="$(grep -o '"max-size"[^,}]*' ops/docker-daemon.json | cut -d'"' -f4)"
want_files="$(grep -o '"max-file"[^,}]*' ops/docker-daemon.json | cut -d'"' -f4)"

driver="$(docker info --format '{{.LoggingDriver}}' 2>/dev/null || echo unknown)"
# `docker info` does not print log-opts, so ask a container what it was actually created
# with — that is the value in force, not the value on disk.
opts="$(docker inspect --format '{{json .HostConfig.LogConfig.Config}}' hydromart-gateway 2>/dev/null || echo '{}')"

echo "daemon log driver: $driver"
echo "gateway log opts:  $opts"
echo "repo expects:      max-size=$want_size max-file=$want_files"

problems=()
[ "$driver" = "json-file" ] || problems+=("log driver is '$driver', repo assumes json-file")
case "$opts" in
  *"\"max-size\":\"$want_size\""*) ;;
  *) problems+=("running containers do not carry max-size=$want_size — /etc/docker/daemon.json is missing, stale, or Docker was never restarted after installing it") ;;
esac
case "$opts" in
  *"\"max-file\":\"$want_files\""*) ;;
  *) problems+=("running containers do not carry max-file=$want_files") ;;
esac

if [ "${#problems[@]}" -gt 0 ]; then
  printf '!! %s\n' "${problems[@]}"
  echo
  echo "   Fix: sudo cp ops/docker-daemon.json /etc/docker/daemon.json && sudo systemctl restart docker"
  echo "   (a restart is required — the setting is applied at container CREATE time)"
  alert "Container log retention is not what the repo says: ${problems[0]}"
  exit 1
fi

echo "ok — logs are capped at $want_size × $want_files per container"
