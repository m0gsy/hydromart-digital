#!/usr/bin/env bash
# Roll the deploy back to a known-good commit and rebuild the services that
# differ. Called automatically by deploy.sh on a failed health check, or by
# hand: `bash scripts/rollback.sh [<sha>]` (defaults to .deploy/prev-sha).
#
# Code rollback only. If a migration must also be undone, restore the DB with
# scripts/restore-db.sh from the pre-deploy backup (deploy.sh takes one first).
set -euo pipefail

cd "$(dirname "$0")/.."
. scripts/lib/deploy-common.sh

STATE_DIR=".deploy"

log() { echo "[rollback] $*"; }

# A no-op when deploy.sh already holds it — that is how a failed health check gets here.
# A hand-run rollback takes it, so the watchdog cannot converge halfway through one.
if ! stack_lock 900; then
  log "!! another deploy holds the stack lock — refusing to roll back underneath it"
  exit 1
fi

TARGET="${1:-$(cat "$STATE_DIR/prev-sha" 2>/dev/null || true)}"
[ -z "$TARGET" ] && { echo "no rollback target (pass a SHA or run a deploy first)"; exit 2; }

CUR="$(git rev-parse HEAD)"
log "rolling back $CUR → $TARGET"

CHANGED="$(git diff --name-only "$TARGET" "$CUR")"
git reset --hard "$TARGET"

if registry_mode; then
  # H-35: the point of immutable SHA tags. Rolling back is pulling the images that were
  # already built for the target commit — seconds, and byte-identical to what ran before,
  # rather than a fresh build on a box that is currently unhealthy.
  log "registry mode — pulling images tagged $TARGET"
  if ! pull_images "$TARGET"; then
    log "!! no images published for $TARGET — cannot roll back to it"
    alert "rollback to $TARGET impossible: no images published for that commit"
    exit 1
  fi
elif needs_full_rebuild "$CHANGED"; then
  log "shared package or root build input differs → full rebuild"
  bash scripts/rebuild-stale.sh --all
else
  mapfile -t SERVICES < <(echo "$CHANGED" | while read -r f; do svc_of "$f"; done | sort -u | grep -v '^$' || true)
  if [ "${#SERVICES[@]}" -eq 0 ]; then
    # Same trap deploy.sh used to have: "no service differs" is not "nothing to do".
    # A rollback runs because the stack is unhealthy, so exiting here left it exactly
    # as broken as it was found — and reported success doing it.
    log "no service image differs — converging only"
  else
    log "rebuilding: ${SERVICES[*]}"
    bash scripts/rebuild-stale.sh "${SERVICES[@]}"
  fi
fi

log "converging the full stack"
converge

# Same gate as the deploy: gateway alone answering 200 is what let 19 stopped
# containers pass for a healthy stack.
if health_ok; then
  log "ROLLBACK OK → $TARGET"
  echo "$TARGET" > "$STATE_DIR/last-good-sha"
  exit 0
fi
log "!! still unhealthy after rollback to $TARGET — manual intervention needed"
alert "rollback to $TARGET did not restore the stack — manual intervention needed"
exit 1
