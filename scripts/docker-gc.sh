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
# `--old-images` � the weekly cron's job. Every deploy pulls/builds a TAGGED image per service
# and the previous tag stays on disk, which `image prune -f` (dangling only) never touches:
# on 2026-11-08 the VPS held 3315 images / 130 GB, 44 GB of them used by no container, and
# docker-gc.sh reclaimed 0B while the DiskSpaceLow alert fired. Unused tagged images older than
# 7 days go (a week of rollback targets stays; a container's image is never "unused"). This is
# NOT the default: rebuild-stale.sh calls this script between batches, and an image it has just
# built but not yet started is also "unused".
#
OLD_IMAGES=0
[ "${1:-}" = "--old-images" ] && OLD_IMAGES=1

before=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')

$DOCKER image prune -f                          # dangling/orphaned images (rebuild leftovers)
if [ "$OLD_IMAGES" -eq 1 ]; then
  $DOCKER image prune -a -f --filter "until=168h" # unused tagged images older than 7 days
fi
if [ "$IMAGES_ONLY" -eq 0 ]; then
  $DOCKER builder prune -f --keep-storage 3g    # trim old build cache, keep 3G warm for fast rebuilds
fi

after=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
echo "docker-gc: freed ~$((after - before))G — $(df -h / | awk 'NR==2{print $4" free ("$5" used)"}')"
