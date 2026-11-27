#!/usr/bin/env bash
# Hermes Agent on the production box (infra/hermes/docker-compose.yml; DEPLOY.md, "Hermes Agent").
# Manual only: Deploy workflow modes `hermes` and `hermes-stop`. A normal deploy never touches it.
#
#   bash scripts/hermes-deploy.sh           # pull the pinned digest, close the network, place config.yaml,
#                                           # start the gateway, wait for Telegram, probe the isolation
#   bash scripts/hermes-deploy.sh --stop    # compose down; the data volume (sessions, memory) is kept
#
# Order, and why:
#   1. the three HERMES_* keys must be in .env: refuse otherwise, naming the KEYS, never a value;
#   2. pull by digest (docker hub, public image; the box never follows a tag);
#   3. `up --no-start` makes the network and the container without starting it, so
#      scripts/hermes-firewall.sh can close that bridge BEFORE any Hermes process exists;
#   4. config.yaml is COPIED into the data volume on every deploy by a one-off container of the SAME pinned
#      image with its own entrypoint (no alpine/busybox pull). Not a read-only file mount: Hermes writes its
#      config.yaml at runtime (a model or approval mode chosen in chat), and the image's init chowns and
#      chmods it at boot, which a read-only mount would refuse. The cost: a setting changed from chat is
#      replaced by infra/hermes/config.yaml at the next deploy, so what should last is changed by PR;
#   5. `up -d --force-recreate`, so the new config and image are always the ones running;
#   6. wait for the gateway to say Telegram is connected, then probe from inside the container.
# Prints names and results only, never a value.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { echo "[hermes-deploy] $*"; }
FILE=infra/hermes/docker-compose.yml
PROJECT=hydromart-hermes
SERVICE=hermes
KEYS=(HERMES_ANTHROPIC_API_KEY HERMES_TELEGRAM_BOT_TOKEN HERMES_TELEGRAM_ALLOWED_USERS)
# The line gateway/run_startup.py (v0.23.4) logs through logger.info("✓ %s connected%s") when an adapter
# is up, here for Telegram; "(degraded)" after it means the receive path is unconfirmed, which is not a pass.
STARTED='telegram connected'
WAIT_SECONDS="${HERMES_WAIT_SECONDS:-180}"
COMPOSE=(docker compose -p "$PROJECT" -f "$FILE" --env-file .env)

if [ "${1:-}" = --stop ]; then
  "${COMPOSE[@]}" down
  say "stopped; the hermes-data volume (sessions, memories, skills) is kept"
  exit 0
fi

# 1. The keys, by name.
missing=()
for key in "${KEYS[@]}"; do
  grep -qE "^${key}=.+" .env 2>/dev/null || missing+=("$key")
done
if [ "${#missing[@]}" -gt 0 ]; then
  say "!! refusing: missing or empty in .env: ${missing[*]} (set them through ENV_SET_BLOCK, deploy mode env-set). Nothing was started."
  exit 1
fi
say "keys present: ${KEYS[*]}"

# 2. Pull the pinned digest.
"${COMPOSE[@]}" pull "$SERVICE"

# 3. Network and container made, nothing started; then the firewall, before anything runs on that bridge.
"${COMPOSE[@]}" up --no-start "$SERVICE"
bash scripts/hermes-firewall.sh

# 4. config.yaml into the volume (see the header for why a copy and not a mount).
"${COMPOSE[@]}" run --rm -T --no-deps --entrypoint sh "$SERVICE" -c \
  'umask 027 && cat > /opt/data/config.yaml.new && chown 10000:10000 /opt/data/config.yaml.new && mv /opt/data/config.yaml.new /opt/data/config.yaml' \
  <infra/hermes/config.yaml
say "config.yaml placed in the data volume"

# 5. Start.
"${COMPOSE[@]}" up -d --force-recreate "$SERVICE"
cid="$("${COMPOSE[@]}" ps -q "$SERVICE")"
[ -n "$cid" ] || { say "!! compose started no $SERVICE container"; exit 1; }

# 6. Wait until it runs and says Telegram is connected (stdout, or the gateway's own log file).
ok=''
for _ in $(seq 1 $((WAIT_SECONDS / 3))); do
  state="$(docker inspect --format '{{.State.Status}}' "$cid" 2>/dev/null || echo gone)"
  if [ "$state" != running ]; then
    say "!! the container is $state; read its log on the box: docker logs $cid"
    exit 1
  fi
  if { docker logs "$cid" 2>&1; docker exec "$cid" sh -c 'cat /opt/data/logs/*.log 2>/dev/null' 2>/dev/null; } | grep -v '(degraded)' | grep -q "$STARTED"; then
    ok=1
    break
  fi
  sleep 3
done
if [ -z "$ok" ]; then
  say "!! no '$STARTED' line within ${WAIT_SECONDS}s (wrong bot token, Telegram unreachable, or a different log wording); read: docker logs $cid"
  exit 1
fi
say "gateway up: '$STARTED' seen"

# Probes from INSIDE the container with python's socket (the image's own): the box and the metadata
# service must NOT answer, the LLM provider and Telegram MUST.
gateway="$(docker network inspect "${PROJECT}_hermes" --format '{{range .IPAM.Config}}{{.Gateway}} {{end}}' | awk '{print $1}')"
public_host="${HERMES_PROBE_PUBLIC_HOST:-api.hydromart-digital.com}"
probe() { # <host> <port> -> open | closed
  docker exec "$cid" python3 -c '
import socket, sys
s = socket.socket()
s.settimeout(4)
try:
    s.connect((sys.argv[1], int(sys.argv[2])))
    print("open")
except OSError:
    print("closed")
' "$1" "$2" 2>/dev/null || echo closed
}
problems=0
expect() { # <label> <host> <port> <want>
  local got
  got="$(probe "$2" "$3")"
  if [ "$got" = "$4" ]; then say "probe $1: $got (as wanted)"; else say "!! probe $1: $got, wanted $4"; problems=$((problems + 1)); fi
}
[ -n "$gateway" ] || { say "!! could not read the network's gateway"; problems=$((problems + 1)); }
[ -z "$gateway" ] || { expect "host ssh at the gateway" "$gateway" 22 closed; expect "host docker api at the gateway" "$gateway" 2375 closed; }
expect "host ssh at the public address ($public_host)" "$public_host" 22 closed
expect "cloud metadata 169.254.169.254:80" 169.254.169.254 80 closed
expect "api.anthropic.com:443" api.anthropic.com 443 open
expect "api.telegram.org:443" api.telegram.org 443 open
if [ "$problems" -gt 0 ]; then
  say "!! $problems probe(s) failed: Hermes is running but its isolation is not proved. Stop it (deploy mode hermes-stop) until fixed."
  exit 1
fi
say "HERMES OK: running, config placed, isolation proved"
