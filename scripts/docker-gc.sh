#!/usr/bin/env bash
# Reclaim Docker disk safely. The stack's disk fills mainly from OLD image
# versions left dangling after every `up --build` (each rebuild orphans the
# previous image) plus stale build cache. This removes both.
#
# NEVER touches volumes → the Postgres data directory is safe. No `-a` on images, so
# only untagged/dangling layers go (the current running images stay tagged).
#
# Run weekly via cron (see DEPLOY / backup cron), and/or right after a deploy:
#   bash scripts/docker-gc.sh
set -euo pipefail

#
# M13 — `--images-only` skips the BUILD CACHE prune.
#
# rebuild-stale.sh calls this between batches of three images, and pruning the builder
# there throws away the layers the NEXT batch is about to want: nineteen services share a
# base image, an `npm ci` layer and a `packages/` build, so every batch after the first was
# rebuilding what the one before it had just built. Between batches, only dangling images
# are worth reclaiming (that is where the disk pressure is); the build cache is trimmed once,
# at the end.
DOCKER="${DOCKER_BIN:-docker}"
IMAGES_ONLY=0
[ "${1:-}" = "--images-only" ] && IMAGES_ONLY=1

#
# `--old-images` — the weekly cron's job. Every deploy pulls/builds a TAGGED image per service
# and the previous tag stays on disk, which `image prune -f` (dangling only) never touches:
# on 2026-11-08 the VPS held 3315 images / 130 GB, 44 GB of them used by no container, and
# docker-gc.sh reclaimed 0B while the DiskSpaceLow alert fired. Unused tagged images older than
# 7 days go (a week of rollback targets stays; a container's image is never "unused"). This is
# NOT the default: rebuild-stale.sh calls this script between batches, and an image it has just
# built but not yet started is also "unused".
#
OLD_IMAGES=0
[ "${1:-}" = "--old-images" ] && OLD_IMAGES=1

#
# HD-1 — this project's images only. The box also runs another compose project (the AI web),
# and its rollback images are not ours to delete. Compose labels every image it BUILDS with
# com.docker.compose.project, and images.yml puts the same label on every image CI publishes.
#
# An image with NO project label belongs to nobody we can name: the CI images published before
# HD-1 (1972 on the box on 2026-11-21) and the third-party ones (postgres, prometheus, caddy).
# They are pruned only while no other compose project has a container here. Once one does, an
# unlabelled image may be its, and they stay.
PROJECT=hydromart
mine="label=com.docker.compose.project=$PROJECT"
# `|| true`: grep exits 1 when it selects nothing, which is the normal case, and under
# `set -euo pipefail` that would end this script before it pruned anything.
others="$($DOCKER ps -a --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null |
  grep -vx -e "$PROJECT" -e '' | sort -u | tr '\n' ' ' || true)"
# A project this repository deploys beside us is DECLARED by its compose file
# (infra/<dir>/docker-compose*.yml with its own `name:`, HD-9), and it counts as here even
# with no container at this moment: mid-redeploy or stopped, its pulled images are still
# its rollback. Asking only `docker ps` would prune them in exactly that window.
INFRA_DIR="${GC_INFRA_DIR:-$(cd "$(dirname "$0")/.." && pwd)/infra}"
declared="$(sed -n 's/^name:[[:space:]]*//p' "$INFRA_DIR"/*/docker-compose*.yml 2>/dev/null |
  tr -d "\"'\r" | grep -vx -e "$PROJECT" -e '' | sort -u | tr '\n' ' ' || true)"
others="$(printf '%s %s' "$others" "$declared" | tr ' ' '\n' | grep -v '^$' | sort -u |
  tr '\n' ' ' || true)"

prune_images() {
  $DOCKER image prune -f "$@" --filter "$mine"
  if [ -z "$others" ]; then
    $DOCKER image prune -f "$@" --filter 'label!=com.docker.compose.project'
  else
    echo "docker-gc: other compose project(s) here: ${others}— unlabelled images left alone"
  fi
}

# HD-9b — the AI web's own images (labelled com.docker.compose.project=hydromart-ai by its CI),
# which nothing above ever removes: every release pulls an app, a migration and (AI-5) an n8n image
# by digest, and they piled up. Kept: the digests infra/aiweb/docker-compose.yml pins now (n8n's
# with the app's: every digest in the file counts, whichever service names it), the ones the
# file pinned before them (the previous release, a revert's rollback target, already here), and
# any image a container uses, running or stopped. Everything else of that project goes, with
# `docker rmi` and never -f, so the daemon refuses anything in use even if the list above missed
# it. Weekly only (--old-images): between rebuild batches nothing of the AI web changes.
#
# pinned_digests <file>: the sha256 digests a compose file pins, one per line.
pinned_digests() { grep -oE '@sha256:[0-9a-f]{64}' "$1" 2>/dev/null | cut -c2- | sort -u || true; }
aiweb_prune() {
  local file="$INFRA_DIR/aiweb/docker-compose.yml" repo project keep now prev rev used id refs digest kept=0 removed=0
  [ -f "$file" ] || return 0
  project="$(sed -n 's/^name:[[:space:]]*//p' "$file" | tr -d "\"' \r")"
  [ -n "$project" ] || return 0
  now="$(pinned_digests "$file")"
  # Nothing pinned by digest (tags, or no image at all) means nothing here to keep by: an empty
  # keep list would remove every AI web image no container uses, the rollback target included.
  if [ -z "$now" ]; then
    echo "docker-gc: the compose file pins no digest; AI web images left alone"
    return 0
  fi
  # The previous release: walk the file's history back to the first version whose pins differ.
  repo="$(cd "$INFRA_DIR/.." && pwd)"
  prev=''
  for rev in $(git -C "$repo" log --format=%H -- infra/aiweb/docker-compose.yml 2>/dev/null || true); do
    prev="$(git -C "$repo" show "$rev:infra/aiweb/docker-compose.yml" 2>/dev/null | grep -oE '@sha256:[0-9a-f]{64}' | cut -c2- | sort -u || true)"
    [ -n "$prev" ] && [ "$prev" != "$now" ] && break
    prev=''
  done
  [ -n "$prev" ] || echo "docker-gc: no earlier release of the AI web in this checkout's history; keeping only the current one"
  keep="$(printf '%s\n%s\n' "$now" "$prev" | sed '/^$/d' | sort -u)"
  # The image ids every container references, running or not.
  used="$($DOCKER ps -aq 2>/dev/null | xargs -r $DOCKER inspect --format '{{.Image}}' 2>/dev/null || true)"
  for id in $($DOCKER images -q --no-trunc --filter "label=com.docker.compose.project=$project" 2>/dev/null | sort -u || true); do
    if grep -qxF "$id" <<<"$used"; then
      kept=$((kept + 1))
      continue
    fi
    refs="$($DOCKER image inspect --format '{{range .RepoDigests}}{{.}} {{end}}' "$id" 2>/dev/null || true)"
    digest=''
    for r in $refs; do
      if grep -qxF "${r#*@}" <<<"$keep"; then digest="${r#*@}"; fi
    done
    if [ -n "$digest" ] || grep -qxF "$id" <<<"$keep"; then
      kept=$((kept + 1))
    elif $DOCKER rmi "$id" >/dev/null 2>&1; then
      removed=$((removed + 1))
    else
      kept=$((kept + 1))
    fi
  done
  echo "docker-gc: AI web images ($project): $removed removed, $kept kept (the pinned release, the one before it, and any in use)"
}

before=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')

prune_images                                    # dangling/orphaned images (rebuild leftovers)
if [ "$OLD_IMAGES" -eq 1 ]; then
  prune_images -a --filter "until=168h"         # unused tagged images older than 7 days
  # A deploy pulls the AI web's next release before it starts it, and in between that image is
  # pinned by a compose file this run may have read before the pull, and used by no container:
  # exactly what aiweb_prune removes. So never beside a deploy, and never waiting for one (the
  # stack lock, scripts/lib/deploy-common.sh); next week's run prunes instead.
  # shellcheck source=scripts/lib/deploy-common.sh
  . "$(dirname "$0")/lib/deploy-common.sh"
  if stack_lock 0; then
    aiweb_prune
    exec 9>&- # the lock's descriptor: a deploy waiting on it need not wait for the cache trim below
  else
    echo "docker-gc: a deploy holds the stack lock; AI web images left alone until next week's run"
  fi
fi
if [ "$IMAGES_ONLY" -eq 0 ]; then
  # Host-wide, and that is right: the build cache carries no project label, and only this
  # project builds on this box (the AI web is pull-only, Plan Eksekusi §4 decision 1).
  $DOCKER builder prune -f --keep-storage 3g    # trim old build cache, keep 3G warm for fast rebuilds
fi

after=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
echo "docker-gc: freed ~$((after - before))G — $(df -h / | awk 'NR==2{print $4" free ("$5" used)"}')"
