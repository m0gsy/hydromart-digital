#!/usr/bin/env bash
# Reclaim Docker disk safely. The stack's disk fills mainly from OLD image
# versions left dangling after every `up --build` (each rebuild orphans the
# previous image) plus stale build cache. This removes both.
#
# NEVER touches volumes → Postgres/Redis data is safe. No `-a` on images, so
# only untagged/dangling layers go (the current running images stay tagged).
#
# Run weekly via cron (see DEPLOY / backup cron), and/or right after a deploy:
#   bash scripts/docker-gc.sh
set -euo pipefail

before=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')

docker image prune -f                          # dangling/orphaned images (rebuild leftovers)
docker builder prune -f --keep-storage 3g      # trim old build cache, keep 3G warm for fast rebuilds

after=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
echo "docker-gc: freed ~$((after - before))G — $(df -h / | awk 'NR==2{print $4" free ("$5" used)"}')"
