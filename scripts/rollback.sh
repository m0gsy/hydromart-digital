#!/usr/bin/env bash
# Roll the deploy back to a known-good commit and rebuild the services that
# differ. Called automatically by deploy.sh on a failed health check, or by
# hand: `bash scripts/rollback.sh [<sha>]` (defaults to .deploy/prev-sha).
#
# Code rollback only. If a migration must also be undone, restore the DB with
# scripts/restore-db.sh from the pre-deploy backup (deploy.sh takes one first).
set -euo pipefail

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
STATE_DIR=".deploy"
GATEWAY_HEALTH="${GATEWAY_HEALTH:-http://localhost:8080/health}"

log() { echo "[rollback] $*"; }
svc_of() {
  case "$1" in
    services/*/*) echo "$1" | cut -d/ -f2 | sed 's/-service$//' ;;
    apps/*/*)     echo "$1" | cut -d/ -f2 ;;
  esac
}

TARGET="${1:-$(cat "$STATE_DIR/prev-sha" 2>/dev/null || true)}"
[ -z "$TARGET" ] && { echo "no rollback target (pass a SHA or run a deploy first)"; exit 2; }

CUR="$(git rev-parse HEAD)"
log "rolling back $CUR → $TARGET"

CHANGED="$(git diff --name-only "$TARGET" "$CUR")"
git reset --hard "$TARGET"

if echo "$CHANGED" | grep -qE '^packages/'; then
  log "shared package differs → full rebuild"
  bash scripts/rebuild-stale.sh --all
else
  mapfile -t SERVICES < <(echo "$CHANGED" | while read -r f; do svc_of "$f"; done | sort -u | grep -v '^$' || true)
  [ "${#SERVICES[@]}" -eq 0 ] && { log "no service code differs — nothing to rebuild"; exit 0; }
  log "rebuilding: ${SERVICES[*]}"
  bash scripts/rebuild-stale.sh "${SERVICES[@]}"
fi

for _ in $(seq 1 30); do curl -fsS "$GATEWAY_HEALTH" >/dev/null 2>&1 && { log "ROLLBACK OK → $TARGET"; echo "$TARGET" > "$STATE_DIR/last-good-sha"; exit 0; }; sleep 2; done
log "!! still unhealthy after rollback to $TARGET — manual intervention needed"; exit 1
