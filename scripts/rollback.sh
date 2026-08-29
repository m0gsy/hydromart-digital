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

# Audit [G] H-18 alleged shell injection through this argument. It was not
# reproducible: TARGET is quoted at every use, never eval'd, never interpolated
# into a `sh -c`, and the script runs under `set -euo pipefail`. Rather than
# argue the point in a comment, resolve it by construction — anything that is
# not a commit this repository actually has is refused here, before it reaches
# git, the rebuild, or the alert text.
git rev-parse --verify --quiet "$TARGET^{commit}" >/dev/null || {
  echo "not a commit in this repository: $TARGET"; exit 2; }

CUR="$(git rev-parse HEAD)"
log "rolling back $CUR → $TARGET"
# Say up front which of the two very different things this is about to do. Measured: with
# IMAGE_PREFIX empty this recompiles images on a box that is already unhealthy; with it set
# it pulls what CI built. deploy.sh's rollback-cost probe reports the same fact on every
# healthy release so that nobody first reads it here, at 2am.
registry_mode ||
  log "!! IMAGE_PREFIX is empty, so this rollback REBUILDS images on this box (see DEPLOY.md 'Registry mode')"

CHANGED="$(git diff --name-only "$TARGET" "$CUR")"
git reset --hard "$TARGET"

if registry_mode; then
  # H-35: the point of immutable SHA tags. Rolling back is pulling the images that were
  # already built for the target commit — seconds, and byte-identical to what ran before,
  # rather than a fresh build on a box that is currently unhealthy.
  log "registry mode — pulling images tagged $TARGET (a pull, not a build on a sick box)"
  if ! pull_images "$TARGET"; then
    log "!! no images published for $TARGET — cannot roll back to it"
    alert "rollback to $TARGET impossible: no images published for that commit"
    exit 1
  fi
  # deploy.sh has always done this after its pull (deploy.sh:225) and this script never did.
  # deploy-common.sh:63 says why it matters: .env is the only place a bare `docker compose`
  # reads IMAGE_TAG from. So a rollback used to leave .env still naming the release it had
  # just rolled BACK — and the runbook's own remedy for a stale container,
  # `up -d --force-recreate <svc>`, would then re-deploy the broken images by hand, during
  # the incident, silently. Written AFTER the pull, never before, for the same reason
  # deploy.sh writes it there: a tag naming images nobody has is worse than no tag.
  persist_image_tag "$TARGET" ||
    log '!! could not write IMAGE_TAG to .env — manual compose calls will ask for the OLD tag'
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
