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

cd "$(dirname "$0")/.."
. scripts/lib/deploy-common.sh

STATE_DIR=".deploy"; mkdir -p "$STATE_DIR"
LAST_GOOD="$STATE_DIR/last-good-sha"
BRANCH="${DEPLOY_BRANCH:-main}"

log() { echo "[deploy] $*"; }

PREV_SHA="$(git rev-parse HEAD)"
log "current HEAD $PREV_SHA"

log "backing up databases first (rollback safety net)"
bash scripts/backup-db.sh

git fetch origin "$BRANCH"
NEW_SHA="$(git rev-parse "origin/$BRANCH")"

# Decide which services to rebuild BEFORE moving the working tree.
if [ "${1:-}" = "--all" ]; then
  SERVICES=(--all)
else
  CHANGED="$(git diff --name-only "$PREV_SHA" "$NEW_SHA")"
  if needs_full_rebuild "$CHANGED"; then
    log "shared package or root build input changed → full rebuild"
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
  # No image is stale — but that is NOT "nothing to do". docker-compose.prod.yml,
  # .env.example, Caddyfile and the scripts themselves all change how the stack RUNS
  # while matching no service, and the old early `exit 0` here meant every one of those
  # deploys reported success without a single container being touched. It was also the
  # reason a fix to these very scripts only took effect on some later, unrelated deploy.
  log "no service image is stale — converging config only"
else
  log "rebuilding: ${SERVICES[*]}"
  bash scripts/rebuild-stale.sh "${SERVICES[@]}"
fi

# rebuild-stale only `up -d`s the services it rebuilt, so anything outside that set
# (Caddy, and any container an earlier batch or anything else left down) stays stopped.
# One idempotent converge brings the whole project to its declared state — and is what
# makes a compose/env change actually recreate the containers it affects.
log "converging the full stack (recreates changed containers, starts anything stopped)"
converge

if health_ok; then
  echo "$PREV_SHA" > "$STATE_DIR/prev-sha"   # one step back, for manual rollback
  echo "$NEW_SHA" > "$LAST_GOOD"
  log "DEPLOY OK → $NEW_SHA (previous good: $PREV_SHA)"
  MISSING="$(missing_env_keys)"
  if [ -n "$MISSING" ]; then
    log "!! .env.example declares keys the live .env does not set: $MISSING"
  fi
else
  log "!! health check FAILED after deploy — auto-rolling back to $PREV_SHA"
  bash scripts/rollback.sh "$PREV_SHA"
  exit 1
fi
