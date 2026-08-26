#!/usr/bin/env bash
# Every bind-mounted config file a container is RUNNING must match the file on disk.
#
# `docker compose up -d` recreates a container when its DEFINITION changes — image, env,
# mount spec. The CONTENT of a bind-mounted file is not part of that definition, so a
# release that only edits ops/prometheus.yml changes nothing compose can see: converge
# leaves the container running, and a single-file bind mount pins an inode, so the process
# keeps reading the file it opened at boot while the correct one sits on disk.
#
# The fix is cheap — MEASURED, not assumed: a plain `docker restart` re-resolves the mount
# and clears it (scripts/check-config-drift.test.sh asserts exactly that against a real
# container). An earlier draft of this file claimed restart was not enough and only a
# recreate would do; the self-check disproved it. Nothing here needs a recreate. What was
# missing was anything that restarts a container when only its config file changed.
#
# Found on 2026-08-26 by a Discord alert for a Redis exporter deleted weeks earlier. The
# alert was right and the monitoring was stale: Prometheus had been running a pre-Q-9
# ruleset since 5 August — 13 rules where the repo had 16, RedisDown still firing, and
# NoOrdersCreated and PaymentConfirmFailing, the only two alerts the on-call runbook calls
# customer-visible, NEVER LOADED. Caddy was worse: HSTS and the entire CSP landed on
# 6 August, the container started on the 5th, so the site served neither for twenty days.
#
# Nothing could see it. Compose was satisfied, the containers were healthy, the deploy was
# green, and the file on disk was correct the whole time — the check has to look INSIDE the
# container, which is the one place nothing was looking.
#
# Usage: scripts/check-config-drift.sh [--list]
#   (default) human report, exit 1 on drift
#   --list    print only the names of containers running a stale config, exit 0
set -uo pipefail

LIST_ONLY=false
[ "${1:-}" = "--list" ] && LIST_ONLY=true

drifted=()
unknown=()

while read -r container; do
  [ -z "$container" ] && continue
  # Bind mounts only. A DIRECTORY mount does not suffer the inode trap — new files inside
  # it are visible immediately — so only regular files are compared.
  while IFS='|' read -r src dst; do
    [ -z "$src" ] && continue
    [ -f "$src" ] || continue
    host="$(md5sum "$src" 2>/dev/null | cut -d' ' -f1)"
    guest="$(docker exec "$container" md5sum "$dst" 2>/dev/null | cut -d' ' -f1)"
    if [ -z "$guest" ]; then
      # Stated, never swallowed: an image without md5sum is a file this cannot vouch for,
      # and silence here would read exactly like a pass.
      unknown+=("$container:$dst")
    elif [ "$host" != "$guest" ]; then
      drifted+=("$container|$dst")
    fi
  done < <(docker inspect --format \
    '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}|{{.Destination}}{{println}}{{end}}{{end}}' \
    "$container" 2>/dev/null)
done < <(docker ps --format '{{.Names}}' 2>/dev/null)

if $LIST_ONLY; then
  for entry in "${drifted[@]:-}"; do [ -n "$entry" ] && echo "${entry%%|*}"; done | sort -u
  exit 0
fi

for entry in "${unknown[@]:-}"; do
  [ -n "$entry" ] && echo "?  ${entry} — no md5sum in this image, NOT checked"
done

if [ "${#drifted[@]}" -gt 0 ] && [ -n "${drifted[0]:-}" ]; then
  echo "${#drifted[@]} container(s) running a config that differs from the file on disk:"
  for entry in "${drifted[@]}"; do
    echo "  ${entry%%|*}  ${entry##*|}"
  done
  echo
  echo "Restart them — that re-resolves the mount and is the cheapest fix:"
  echo "  docker compose -f docker-compose.yml -f docker-compose.prod.yml restart <service>"
  exit 1
fi

echo "config drift OK — every bind-mounted file matches the copy inside its container."
