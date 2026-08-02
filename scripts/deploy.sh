#!/usr/bin/env bash
# Zero-drama CD for the single-VPS deploy. Runs ON the VPS, in the repo root.
# Reuses the existing serial rebuild + db backup so a build never OOMs the box
# and every deploy is recoverable. On a failed health check it auto-rolls-back
# to the last-good commit — so a bad merge can't leave the site down.
#
# Usage (on VPS):
#   bash scripts/deploy.sh            # fetch origin/main, rebuild changed svcs
#   bash scripts/deploy.sh --all      # force-rebuild every service
#
# ponytail: no blue-green / no image registry. Single box, compose-built images,
# in-place restart with auto-rollback. Add a registry + swap when there's a 2nd node.
set -euo pipefail

# Caddy sits behind `profiles: ["tls"]`, so a plain compose call excludes it: never
# started, never converged, absent from `ps`. That is how a "successful" deploy left
# 80/443 dead for four hours while the gateway answered fine on 8080. Enable the
# profile only when a domain is configured, so the documented bare-IP (no-TLS) path
# still works and does not try to bind 80/443 without a hostname.
TLS_PROFILE=""
if [ -n "${WEB_DOMAIN:-}" ] || grep -qsE '^WEB_DOMAIN=.+' .env; then
  TLS_PROFILE="--profile tls"
fi
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml $TLS_PROFILE"
STATE_DIR=".deploy"; mkdir -p "$STATE_DIR"
LAST_GOOD="$STATE_DIR/last-good-sha"
GATEWAY_HEALTH="${GATEWAY_HEALTH:-http://localhost:8080/health}"
BRANCH="${DEPLOY_BRANCH:-main}"

log() { echo "[deploy] $*"; }

# Map a changed path to its compose service name; echo nothing if not a service.
# services/foo-service/... -> foo ; apps/web/... -> web
svc_of() {
  case "$1" in
    services/*/*) echo "$1" | cut -d/ -f2 | sed 's/-service$//' ;;
    apps/*/*)     echo "$1" | cut -d/ -f2 ;;
  esac
}

# Every service the compose project defines must be RUNNING. The gateway probe
# alone is not a deploy gate: gateway is built last, so it can be healthy while
# every batch before it sits stopped. Returns the stopped names, empty if none.
stopped_services() {
  $COMPOSE ps --all --format '{{.Service}} {{.State}}' 2>/dev/null |
    awk '$2 != "running" { print $1 }' | sort -u | tr '
' ' '
}

health_ok() {
  local ok=1
  for _ in $(seq 1 30); do
    if curl -fsS "$GATEWAY_HEALTH" >/dev/null 2>&1; then ok=0; break; fi
    sleep 2
  done
  [ "$ok" -eq 0 ] || { log "!! gateway health probe never answered"; return 1; }

  # Give slow starters a moment before declaring the stack incomplete.
  local down
  for _ in $(seq 1 15); do
    down="$(stopped_services)"
    [ -z "$down" ] && return 0
    sleep 4
  done
  log "!! these services are not running: $down"
  return 1
}

PREV_SHA="$(git rev-parse HEAD)"
log "current HEAD $PREV_SHA"

log "backing up databases first (rollback safety net)"
bash scripts/backup-db.sh

git fetch origin "$BRANCH"
NEW_SHA="$(git rev-parse "origin/$BRANCH")"
if [ "$PREV_SHA" = "$NEW_SHA" ] && [ "${1:-}" != "--all" ]; then
  log "already at origin/$BRANCH ($NEW_SHA) — nothing to deploy"; exit 0
fi

# Decide which services to rebuild BEFORE moving the working tree.
if [ "${1:-}" = "--all" ]; then
  SERVICES=(--all)
else
  CHANGED="$(git diff --name-only "$PREV_SHA" "$NEW_SHA")"
  # A shared-package change invalidates every image → full rebuild.
  if echo "$CHANGED" | grep -qE '^packages/'; then
    log "shared package changed → full rebuild"
    SERVICES=(--all)
  else
    mapfile -t SERVICES < <(echo "$CHANGED" | while read -r f; do svc_of "$f"; done | sort -u | grep -v '^$' || true)
  fi
fi

git reset --hard "$NEW_SHA"

if [ "${SERVICES[0]:-}" = "--all" ]; then
  log "rebuilding ALL services"
  bash scripts/rebuild-stale.sh --all
elif [ "${#SERVICES[@]}" -eq 0 ]; then
  log "no service code changed (docs/config only) — restarting nothing"; echo "$NEW_SHA" > "$LAST_GOOD"; exit 0
else
  log "rebuilding: ${SERVICES[*]}"
  bash scripts/rebuild-stale.sh "${SERVICES[@]}"
fi

# rebuild-stale only `up -d`s the services it rebuilt, so anything outside that
# set (Caddy, and any container an earlier batch left down) stays stopped. One
# idempotent converge brings the whole project to its declared state.
log "converging the full stack (starts anything still stopped, incl. Caddy)"
$COMPOSE up -d --remove-orphans

if health_ok; then
  echo "$PREV_SHA" > "$STATE_DIR/prev-sha"   # one step back, for manual rollback
  echo "$NEW_SHA" > "$LAST_GOOD"
  log "DEPLOY OK → $NEW_SHA (previous good: $PREV_SHA)"
else
  log "!! health check FAILED after deploy — auto-rolling back to $PREV_SHA"
  bash scripts/rollback.sh "$PREV_SHA"
  exit 1
fi
