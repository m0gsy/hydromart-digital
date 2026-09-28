#!/usr/bin/env bash
# Install /etc/docker/daemon.json from ops/docker-daemon.json and restart the daemon so the
# 50m x 3 log cap it sets actually applies. `check-log-retention.sh` only ever REPORTS the gap
# (that is its job); this is the fix it points at, made runnable rather than a paragraph someone
# has to type by hand on the box.
#
# What a restart does and does not do:
#   - The daemon's DEFAULT log-opts change immediately, for every container CREATED from then on
#     — the next deploy of a service, a container restarted by hand, `docker compose up` on
#     something that changed.
#   - A container already RUNNING keeps whatever log-opts it was created with — the cap is read
#     once, at container CREATE time, never again. Fixing an already-running container's logs
#     needs it recreated; an ordinary deploy of that service does that on its own. This script
#     does not force a recreate of everything (that is `deploy.sh --all`, a separate and much
#     larger action, and not one this script decides to take).
#   - `ops/docker-daemon.json` also sets `live-restore: true`, so restarting the DAEMON does not
#     stop running containers — PROVIDED live-restore was already active before this restart.
#     If /etc/docker/daemon.json is missing entirely, or exists but does not yet say
#     `"live-restore": true`, THIS restart is the one that turns it on, and — same as any first
#     dockerd restart without it — containers go down for the few seconds the restart takes.
#     Every restart after this one is covered. --check says which case a box is in before
#     anything runs.
#
#   bash scripts/install-host-docker-daemon.sh --check   # say what is live and what would change
#   bash scripts/install-host-docker-daemon.sh           # install + restart (no-op if already correct)
set -euo pipefail

SRC="${DAEMON_JSON_SRC:-ops/docker-daemon.json}"
DEST="${DAEMON_JSON_DEST:-/etc/docker/daemon.json}"
PROBE_CONTAINER="${PROBE_CONTAINER:-hydromart-gateway}"
SUDO="${SUDO:-sudo -n}"
CHECK=false
[ "${1:-}" = "--check" ] && CHECK=true

command -v docker >/dev/null || { echo "!! docker is not on PATH" >&2; exit 2; }
[ -f "$SRC" ] || { echo "!! $SRC is missing from this checkout" >&2; exit 2; }
# A malformed daemon.json fails dockerd's own start, which is a much worse place to discover a
# syntax error than here — node is already required on this host (the nightly backup needs it).
node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$SRC" ||
  { echo "!! $SRC is not valid JSON" >&2; exit 2; }

want_size="$(grep -o '"max-size"[^,}]*' "$SRC" | cut -d'"' -f4)"
want_files="$(grep -o '"max-file"[^,}]*' "$SRC" | cut -d'"' -f4)"
[ -n "$want_size" ] && [ -n "$want_files" ] ||
  { echo "!! $SRC has no max-size/max-file to install" >&2; exit 2; }

dest_exists=false
[ -f "$DEST" ] && dest_exists=true
same_file=false
$dest_exists && diff -q "$SRC" "$DEST" >/dev/null 2>&1 && same_file=true
live_restore_now=false
$dest_exists && grep -qE '"live-restore"[[:space:]]*:[[:space:]]*true' "$DEST" 2>/dev/null && live_restore_now=true
current_opts="$(docker inspect --format '{{json .HostConfig.LogConfig.Config}}' "$PROBE_CONTAINER" 2>/dev/null || echo '{}')"
container_has_cap=false
case "$current_opts" in *"\"max-size\":\"$want_size\""*) container_has_cap=true ;; esac

echo "desired: $SRC (max-size=$want_size max-file=$want_files)"
echo "live at $DEST: $($dest_exists && echo present || echo MISSING)"
$dest_exists && echo "  identical to the repo copy: $same_file"
echo "live-restore currently in $DEST: $live_restore_now"
echo "$PROBE_CONTAINER's current log-opts: $current_opts"

if $same_file && $container_has_cap; then
  echo
  echo "ok — $DEST matches the repo and $PROBE_CONTAINER already carries the cap. Nothing to do."
  exit 0
fi

if $CHECK; then
  echo
  if ! $dest_exists; then
    echo "!! $DEST does not exist yet. This restart would be the ONE-TIME exception: live-restore"
    echo "   is not covered by anything yet, so every running container would briefly stop while"
    echo "   dockerd restarts. Every restart after this one is covered."
  elif ! $live_restore_now; then
    echo "!! $DEST exists but does not have live-restore on. Same one-time exception: this restart"
    echo "   would briefly stop every running container; restarts after it would not."
  else
    echo "live-restore is already on — restarting Docker will not stop running containers."
  fi
  echo
  echo "would: sudo cp $SRC $DEST && sudo systemctl restart docker"
  echo "would NOT change: log limits on containers already running (the cap is read once, at"
  echo "  container CREATE time) — only containers created AFTER this restart pick it up."
  exit 0
fi

$SUDO true 2>/dev/null || { echo "!! passwordless sudo is not available for $(id -un)" >&2; exit 2; }

backup=""
if $dest_exists && ! $same_file; then
  backup="${DEST}.bak.$(date +%Y%m%d%H%M%S)"
  $SUDO cp "$DEST" "$backup"
  echo "backed up the previous $DEST to $backup"
fi

$SUDO cp "$SRC" "$DEST"
echo "installed $SRC -> $DEST"

if ! $SUDO systemctl restart docker; then
  echo "!! dockerd failed to restart with the new config" >&2
  if [ -n "$backup" ]; then
    echo "!! restoring the previous $DEST and restarting again" >&2
    $SUDO cp "$backup" "$DEST"
    $SUDO systemctl restart docker || echo "!! restart with the OLD config also failed — docker may be down" >&2
  fi
  exit 1
fi

ok=false
for _ in $(seq 1 30); do
  docker info >/dev/null 2>&1 && { ok=true; break; }
  sleep 1
done
$ok || { echo "!! docker did not answer again within 30s of the restart" >&2; exit 1; }

echo "docker restarted and is answering. New containers now inherit max-size=$want_size max-file=$want_files."
echo "Containers created BEFORE this restart keep their previous (unbounded) log limits until they"
echo "are next recreated — an ordinary deploy of that service does this on its own."
