#!/usr/bin/env bash
# Hermes Agent on the production box (infra/hermes/docker-compose.yml; DEPLOY.md, "Hermes Agent").
# Manual only: Deploy workflow modes `hermes` and `hermes-stop`. A normal deploy never touches it.
#
#   bash scripts/hermes-deploy.sh              # pull the pinned digest, close the network, place config.yaml,
#                                              # start the gateway, wait for Telegram, probe the isolation
#   bash scripts/hermes-deploy.sh --stop       # compose down; the data volume (sessions, memory) is kept
#   bash scripts/hermes-deploy.sh --check-env  # only the .env key check (names in the error, never a value)
#
# Order, and why:
#   1. the three HERMES_* keys must be in .env, and the Telegram allow-list must be numeric ids: refuse otherwise,
#      naming the KEYS, never a value;
#   2. pull by digest (docker hub, public image; the box never follows a tag);
#   3. `up --no-start` makes the network and the container without starting it, so
#      scripts/hermes-firewall.sh can close that bridge BEFORE any Hermes process exists;
#   4. config.yaml is COPIED into the data volume on every deploy by a one-off container of the SAME pinned
#      image with its own entrypoint (no alpine/busybox pull). Not a read-only file mount: Hermes writes its
#      config.yaml at runtime (a model or approval mode chosen in chat), and the image's init chowns and
#      chmods it at boot, which a read-only mount would refuse. The cost: a setting changed from chat is
#      replaced by infra/hermes/config.yaml at the next deploy, so what should last is changed by PR;
#   5. `up -d --force-recreate`, so the new config and image are always the ones running;
#   6. wait for THIS container's log to say Telegram is connected, then probe from inside the container;
#   7. only when all of it held, .deploy/hermes.enabled is written: the host (scripts/hermes-ensure.sh, cron) starts
#      the container at boot and when it dies only while that flag exists. Any failure after step 5 stops the
#      container and removes the flag (fail closed).
# Prints names and results only, never a value.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { echo "[hermes-deploy] $*"; }
FILE=infra/hermes/docker-compose.yml
PROJECT=hydromart-hermes
SERVICE=hermes
FLAG=.deploy/hermes.enabled
ENV_FILE="${HERMES_ENV_FILE:-.env}"
KEYS=(HERMES_ANTHROPIC_API_KEY HERMES_TELEGRAM_BOT_TOKEN HERMES_TELEGRAM_ALLOWED_USERS)
# The line gateway/run_startup.py (v0.23.4) logs through logger.info("✓ %s connected%s") when an adapter
# is up, here for Telegram; "(degraded)" after it means the receive path is unconfirmed, which is not a pass.
STARTED='telegram connected'
WAIT_SECONDS="${HERMES_WAIT_SECONDS:-180}"
COMPOSE=(docker compose -p "$PROJECT" -f "$FILE" --env-file "$ENV_FILE")

if [ "${1:-}" = --stop ]; then
  rm -f "$FLAG"
  "${COMPOSE[@]}" down
  say "stopped; the hermes-data volume (sessions, memories, skills) is kept, and the host will not start it again"
  exit 0
fi

# 1. The keys, by name; the allow-list must be numeric Telegram user ids (a name or a stray character would
#    silently allow nobody, or something unintended).
missing=()
for key in "${KEYS[@]}"; do
  grep -qE "^${key}=.+" "$ENV_FILE" 2>/dev/null || missing+=("$key")
done
if [ "${#missing[@]}" -gt 0 ]; then
  say "!! refusing: missing or empty in $ENV_FILE: ${missing[*]} (set them through ENV_SET_BLOCK, deploy mode env-set). Nothing was started."
  exit 1
fi
allowed="$(sed -n 's/^HERMES_TELEGRAM_ALLOWED_USERS=//p' "$ENV_FILE" | tail -1 | tr -d "\"'\r")"
if ! [[ "$allowed" =~ ^[0-9]+(,[0-9]+)*$ ]]; then
  say "!! refusing: HERMES_TELEGRAM_ALLOWED_USERS must be numeric Telegram user ids separated by commas (from @userinfobot). Nothing was started."
  exit 1
fi
say "keys present: ${KEYS[*]}; HERMES_TELEGRAM_ALLOWED_USERS is numeric ids"
[ "${1:-}" != --check-env ] || exit 0

# Fail closed from here: stop the container and take the flag away.
problems=0
fail_closed() {
  say "!! $1"
  rm -f "$FLAG"
  "${COMPOSE[@]}" stop "$SERVICE" >/dev/null 2>&1 || true
  say "Hermes is stopped and will not be started by the host until a deploy passes"
  exit 1
}

# 2. Pull the pinned digest.
"${COMPOSE[@]}" pull "$SERVICE"

# 3. Network and container made, nothing started; then the firewall, before anything runs on that bridge.
rm -f "$FLAG"
"${COMPOSE[@]}" up --no-start "$SERVICE"
bash scripts/hermes-firewall.sh

# IPv6 off (the rules are IPv4): the daemon's config and this network's.
if grep -qsE '"ipv6"[[:space:]]*:[[:space:]]*true' /etc/docker/daemon.json; then
  fail_closed "/etc/docker/daemon.json turns Docker's IPv6 on: the firewall rules are IPv4 only; Hermes is not started (a running one was stopped)"
fi
if [ "$(docker network inspect "${PROJECT}_hermes" --format '{{.EnableIPv6}}')" != false ]; then
  fail_closed "the ${PROJECT}_hermes network has IPv6 on: the firewall rules are IPv4 only; Hermes is not started (a running one was stopped)"
fi

# 4. config.yaml into the volume (see the header for why a copy and not a mount).
"${COMPOSE[@]}" run --rm -T --no-deps --entrypoint sh "$SERVICE" -c \
  'umask 027 && cat > /opt/data/config.yaml.new && chown 10000:10000 /opt/data/config.yaml.new && mv /opt/data/config.yaml.new /opt/data/config.yaml' \
  <infra/hermes/config.yaml
say "config.yaml placed in the data volume"

# 5. Start.
"${COMPOSE[@]}" up -d --force-recreate "$SERVICE"
cid="$("${COMPOSE[@]}" ps -q "$SERVICE")"
[ -n "$cid" ] || fail_closed "compose started no $SERVICE container"
started_at="$(docker inspect --format '{{.State.StartedAt}}' "$cid")"

# 6. Wait until THIS container (just recreated, its own log) says Telegram is connected.
ok=''
for _ in $(seq 1 $((WAIT_SECONDS / 3))); do
  state="$(docker inspect --format '{{.State.Status}}' "$cid" 2>/dev/null || echo gone)"
  [ "$state" = running ] || fail_closed "the container is $state; read its log on the box: docker logs $cid"
  # Captured first: under pipefail a `| grep -q` that exits early can SIGPIPE the writer and report a false failure.
  logs="$(docker logs --since "$started_at" "$cid" 2>&1 || true)"
  if grep -v '(degraded)' <<<"$logs" | grep -q "$STARTED"; then
    ok=1
    break
  fi
  sleep 3
done
[ -n "$ok" ] || fail_closed "no '$STARTED' line in this container's log within ${WAIT_SECONDS}s (wrong bot token, Telegram unreachable, or a different log wording); read: docker logs $cid"
say "gateway up: '$STARTED' seen"

# Probes from INSIDE the container with python's socket (the image's own). One outcome per target: open, closed
# (timeout, or host/network unreachable: a DROP or an ICMP-prohibited), refused or ERROR (no python, exec failed,
# name does not resolve). A REFUSED connection (RST) means the packet reached the host, so it is reachable, never
# blocked: "refused" matches no wanted outcome, so it fails every probe. An ERROR is never a pass either.
docker exec "$cid" python3 -c 'import socket' >/dev/null 2>&1 || fail_closed "python3 is not usable inside the container, so no probe can be trusted"
probe() { # <host> <port> -> open | closed | refused | error
  local out
  out="$(docker exec "$cid" python3 -c '
import errno, socket, sys
s = socket.socket()
s.settimeout(4)
try:
    s.connect((sys.argv[1], int(sys.argv[2])))
    print("open")
except ConnectionRefusedError:
    print("refused")
except socket.timeout:
    print("closed")
except socket.gaierror:
    print("error")
except OSError as e:
    print("closed" if e.errno in (errno.ENETUNREACH, errno.EHOSTUNREACH, errno.EACCES) else "error")
' "$1" "$2" 2>/dev/null)" || out=error
  case "$out" in open | closed | refused) echo "$out" ;; *) echo error ;; esac
}
expect() { # <label> <host> <port> <want>
  local got
  got="$(probe "$2" "$3")"
  if [ "$got" = "$4" ]; then say "probe $1: $got (as wanted)"; else say "!! probe $1: $got, wanted $4"; problems=$((problems + 1)); fi
}
gateway="$(docker network inspect "${PROJECT}_hermes" --format '{{range .IPAM.Config}}{{.Gateway}} {{end}}' | awk '{print $1}')"
# The box's own public IPv4 as the host sees it: the source address of its route to the internet, else the first
# global address. An IP, not a name, so a DNS answer cannot decide what is probed.
public="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1)"
[ -n "$public" ] || public="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
[ -n "$gateway" ] || fail_closed "could not read the network's gateway: the host probes cannot run"
[ -n "$public" ] || fail_closed "could not read the box's own public IPv4 (ip route/addr): the host probes cannot run"
say "probing the host at the network gateway $gateway and the box's own address $public"
for port in 22 5432 2375; do
  expect "host $gateway:$port" "$gateway" "$port" closed
  expect "host $public:$port" "$public" "$port" closed
done
expect "cloud metadata 169.254.169.254:80" 169.254.169.254 80 closed
expect "api.anthropic.com:443" api.anthropic.com 443 open
expect "api.telegram.org:443" api.telegram.org 443 open
[ "$problems" -eq 0 ] || fail_closed "$problems probe(s) failed: isolation not proved"

# The browser toolset must not be among the tools the Telegram gateway has (upstream: `hermes tools list --platform
# telegram`, hermes_cli/subcommands/tools.py v0.23.4). The line format is upstream's, so the browser lines are printed
# for the operator, and the deploy fails on one that says enabled. A failed or empty listing fails closed.
tools="$(docker exec "$cid" hermes tools list --platform telegram 2>&1)" ||
  fail_closed "'hermes tools list --platform telegram' failed, so no tool can be vouched for; check: docker exec $cid hermes tools list --platform telegram"
[ -n "$tools" ] || fail_closed "'hermes tools list --platform telegram' printed nothing, so no tool can be vouched for"
# ponytail: an allowlist comparison of the enabled tools is added once the real v0.23.4 output has been seen on the server; until then the enabled lines are logged and only the browser check gates.
say "tools enabled for Telegram (names only):"
{ grep -i enabled <<<"$tools" | grep -vi disabled || true; } | sed 's/^/[hermes-deploy]   /'
if grep -i browser <<<"$tools" | grep -i enabled | grep -viq disabled; then
  fail_closed "a browser tool is enabled for Telegram: infra/hermes/config.yaml must disable it"
fi

mkdir -p .deploy
: >"$FLAG"
say "HERMES OK: running, config placed, isolation proved; the host will keep it running (flag $FLAG)"
