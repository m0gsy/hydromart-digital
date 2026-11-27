#!/usr/bin/env bash
# The host's side of keeping Hermes Agent up (infra/hermes/docker-compose.yml has `restart: "no"` on purpose).
#
#   bash scripts/hermes-ensure.sh          # every 5 minutes (cron): close the network, start the container if it should run
#   bash scripts/hermes-ensure.sh --boot   # @reboot: first wait (bounded) for dockerd and the DOCKER-USER chain
#
# Why docker does not restart it: at boot dockerd starts containers before DOCKER-USER exists, so a restart policy
# would run Hermes for a while with its private ranges open. Here it is started only AFTER scripts/hermes-firewall.sh
# succeeded AND the jump into HERMES-NO-LAN is present, and only while .deploy/hermes.enabled exists: deploy mode
# `hermes` writes that flag once the deploy proved the isolation, `hermes-stop` (or a failed deploy) removes it.
#
# Exit: 0 nothing to do or started · 1 the firewall is not closed (nothing was started).
set -uo pipefail
cd "$(dirname "$0")/.."

FLAG=.deploy/hermes.enabled
PROJECT=hydromart-hermes
say() { echo "[hermes-ensure] $*"; }

if [ "${1:-}" = --boot ]; then
  for _ in $(seq 1 60); do
    if docker info >/dev/null 2>&1 && sudo -n iptables -w -S DOCKER-USER >/dev/null 2>&1; then break; fi
    sleep 3
  done
fi

bash scripts/hermes-firewall.sh || { say "!! the firewall is not closed: Hermes was not started"; exit 1; }
[ -f "$FLAG" ] || exit 0

# The firewall script succeeds softly while DOCKER-USER is missing; starting needs both halves in place.
sudo -n iptables -w -C INPUT -j HERMES-NO-HOST 2>/dev/null && sudo -n iptables -w -C DOCKER-USER -j HERMES-NO-LAN 2>/dev/null || {
  say "!! HERMES-NO-HOST / HERMES-NO-LAN are not both in place: Hermes was not started"
  exit 1
}
cid="$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=hermes | head -1)"
[ -n "$cid" ] || { say "the flag is set but there is no container: run deploy mode hermes"; exit 0; }
[ "$(docker inspect --format '{{.State.Running}}' "$cid" 2>/dev/null)" = true ] && exit 0
docker start "$cid" >/dev/null && say "started $cid (firewall closed)"
