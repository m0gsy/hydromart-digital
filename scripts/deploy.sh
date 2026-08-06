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

# Held for the whole deploy: the watchdog must not converge the containers this is in the
# middle of recreating, and two deploys must not interleave. Waits rather than fails,
# because the only thing normally holding it is one watchdog pass.
if ! stack_lock 900; then
  log "!! the stack lock is still held after 15 minutes — refusing to deploy over it"
  exit 1
fi

PREV_SHA="$(git rev-parse HEAD)"
log "current HEAD $PREV_SHA"

log "backing up databases first (rollback safety net)"
bash scripts/backup-db.sh

git fetch origin "$BRANCH"
NEW_SHA="$(git rev-parse "origin/$BRANCH")"

# Decide which services to rebuild BEFORE moving the working tree. The diff is computed
# unconditionally now — --all changes what gets rebuilt, not whether the incoming commit
# carries migrations.
# Diff against what the CONTAINERS were built from, not against the tree. After a deploy
# that died past the reset, those two are different commits, and only the first one gives
# the real rebuild set. PREV_SHA stays the tree's HEAD because that is the rollback target.
CHANGED="$(git diff --name-only "$(rebuild_base "$LAST_GOOD" "$PREV_SHA")" "$NEW_SHA")"
if [ "${1:-}" = "--all" ]; then
  SERVICES=(--all)
else
  if needs_full_rebuild "$CHANGED"; then
    log "shared package or root build input changed → full rebuild"
    SERVICES=(--all)
  else
    mapfile -t SERVICES < <(echo "$CHANGED" | while read -r f; do svc_of "$f"; done | sort -u | grep -v '^$' || true)
  fi
fi

git reset --hard "$NEW_SHA"

# A rebuild is not atomic: rebuild-stale.sh builds and `up -d`s in serial batches, so a
# failure in batch 3 of 5 leaves the first two services running NEW code against services
# still on the OLD image. `set -e` used to end the script right there — no converge, no
# health check, no rollback — so the workflow went red while production sat in a state
# nobody chose and nothing reported. Roll back on that failure exactly as on a failed
# health check, because it is the same situation: this commit is not serving. (H-17)
rebuild_or_rollback() {
  if bash scripts/rebuild-stale.sh "$@"; then return 0; fi
  log "!! rebuild FAILED partway — services may be split across two commits"
  log "!! rolling back to $PREV_SHA"
  alert "deploy rebuild failed at $NEW_SHA; rolling back to $PREV_SHA"
  bash scripts/rollback.sh "$PREV_SHA"
  exit 1
}

# B-20 — schema before code, enforced instead of remembered.
#
# Migration execution used to be a separate manual button in the Deploy workflow, so a
# merge carrying both a migration and the code that reads it shipped the code now and the
# schema whenever someone remembered. New containers then ran against the old schema.
#
# This runs AFTER the reset because the migration files only exist in the incoming tree,
# and BEFORE any container is rebuilt or started, so the new code never meets the old
# schema. If it fails, the tree goes back and the running stack is never touched at all.
#
# Direction of the remaining risk is deliberate: a later health failure rolls the CODE
# back to $PREV_SHA and leaves the schema ahead of it. That is the repo's own convention
# (a column ships one release before its reader) and is the survivable half.
MIGRATIONS="$(pending_migrations "$CHANGED")"
if [ -n "$MIGRATIONS" ]; then
  log "incoming commit adds migrations:"
  echo "$MIGRATIONS" | sed 's/^/  /'
  if [ "${DEPLOY_MIGRATE:-apply}" = "apply" ]; then
    log "applying them before any container starts on the new code"
    # The backup at the top of this script is minutes old — do not take a second one.
    if ! MIGRATE_SKIP_BACKUP=1 bash scripts/migrate-prod.sh; then
      log "!! migration FAILED — restoring the tree to $PREV_SHA, running stack untouched"
      git reset --hard "$PREV_SHA"
      alert "deploy aborted: migration failed on $NEW_SHA (stack still serving $PREV_SHA)"
      exit 1
    fi
  else
    log "!! DEPLOY_MIGRATE=${DEPLOY_MIGRATE} — refusing to start new code against an un-migrated schema"
    log "   apply them yourself (bash scripts/migrate-prod.sh), then re-run this deploy"
    git reset --hard "$PREV_SHA"
    exit 1
  fi
fi

if registry_mode; then
  # H-31/H-35: images were built in CI and tagged with this exact commit. Nothing is
  # compiled on the box that serves customers — no 1.5 GB build peak beside Postgres, no
  # layers on the production disk, and no repeat of the BuildKit daemon panic that stopped
  # all 25 containers on 2026-08-02.
  log "registry mode (IMAGE_PREFIX=$IMAGE_PREFIX) — pulling images tagged $NEW_SHA"
  if ! pull_images "$NEW_SHA"; then
    log "!! could not pull images for $NEW_SHA — the Images workflow has not published them"
    log "   restoring the tree to $PREV_SHA; the running stack was not touched"
    git reset --hard "$PREV_SHA"
    alert "deploy aborted: no images published for $NEW_SHA (stack still serving $PREV_SHA)"
    exit 1
  fi
elif [ "${SERVICES[0]:-}" = "--all" ]; then
  log "rebuilding ALL services"
  rebuild_or_rollback --all
elif [ "${#SERVICES[@]}" -eq 0 ]; then
  # No image is stale — but that is NOT "nothing to do". docker-compose.prod.yml,
  # .env.example, Caddyfile and the scripts themselves all change how the stack RUNS
  # while matching no service, and the old early `exit 0` here meant every one of those
  # deploys reported success without a single container being touched. It was also the
  # reason a fix to these very scripts only took effect on some later, unrelated deploy.
  log "no service image is stale — converging config only"
else
  log "rebuilding: ${SERVICES[*]}"
  rebuild_or_rollback "${SERVICES[@]}"
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
  # Alertmanager reads its destination from a file the operator creates (it is a secret,
  # so it is not in the repo). Without it every alert is routed, rendered and dropped —
  # silently, because a monitoring stack that alerts nobody looks exactly like a quiet
  # week. It was in that state on this box from the day monitoring shipped.
  if [ ! -s ops/alertmanager.webhook-url ]; then
    log "!! ops/alertmanager.webhook-url is empty — every Prometheus alert goes nowhere."
    log "   Fix: printf '%s' \"\$ALERT_WEBHOOK_URL\" > ops/alertmanager.webhook-url && \\"
    log "        $COMPOSE restart alertmanager"
  fi
else
  log "!! health check FAILED after deploy — auto-rolling back to $PREV_SHA"
  bash scripts/rollback.sh "$PREV_SHA"
  exit 1
fi
