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

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
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

health_ok() {
  for _ in $(seq 1 30); do
    curl -fsS "$GATEWAY_HEALTH" >/dev/null 2>&1 && return 0
    sleep 2
  done
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

if health_ok; then
  echo "$PREV_SHA" > "$STATE_DIR/prev-sha"   # one step back, for manual rollback
  echo "$NEW_SHA" > "$LAST_GOOD"
  log "DEPLOY OK → $NEW_SHA (previous good: $PREV_SHA)"
else
  log "!! health check FAILED after deploy — auto-rolling back to $PREV_SHA"
  bash scripts/rollback.sh "$PREV_SHA"
  exit 1
fi
