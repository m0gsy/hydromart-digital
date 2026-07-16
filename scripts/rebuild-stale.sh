#!/usr/bin/env bash
# Rebuild service images in SMALL SERIAL batches so the 58G Lite VPS never hits
# ENOSPC/OOM. `docker compose up --build` of all services builds them CONCURRENTLY
# — each bakes the full monorepo node_modules, so parallel builds spike RAM (OOM)
# and pile up orphan layers (ENOSPC). This builds a few at a time, prunes between
# batches (docker-gc.sh), then starts them.
#
# Usage:
#   bash scripts/rebuild-stale.sh                 # rebuild the known-stale set
#   bash scripts/rebuild-stale.sh crm payout      # rebuild only these
#   BATCH=1 bash scripts/rebuild-stale.sh         # one image at a time (tightest disk/RAM)
#
# Safe to re-run: it only builds + `up -d` the named services; volumes untouched.
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
BATCH="${BATCH:-2}"

# Services still on old images (current as of the last deploy: auth product order
# payment delivery depot gateway web were already rebuilt). Override via args.
DEFAULT_STALE=(customer dashboard loyalty promo referral crm recommendation forecast payout scheduler)

if [ "$#" -gt 0 ]; then
  SERVICES=("$@")
else
  SERVICES=("${DEFAULT_STALE[@]}")
fi

echo "rebuild-stale: ${#SERVICES[@]} service(s), batch size ${BATCH}"
df -h / | awk 'NR==2{print "  disk: "$4" free ("$5" used)"}'

i=0
batch=()
flush() {
  [ "${#batch[@]}" -eq 0 ] && return 0
  echo ">> building: ${batch[*]}"
  # --pull keeps the base node:20-alpine current; build is serial across flushes.
  $COMPOSE build "${batch[@]}"
  echo ">> starting: ${batch[*]}"
  $COMPOSE up -d "${batch[@]}"
  echo ">> reclaiming orphaned layers"
  bash scripts/docker-gc.sh
  batch=()
}

for svc in "${SERVICES[@]}"; do
  batch+=("$svc")
  i=$((i + 1))
  if [ "$((i % BATCH))" -eq 0 ]; then flush; fi
done
flush  # remaining tail

echo "rebuild-stale: done"
df -h / | awk 'NR==2{print "  disk: "$4" free ("$5" used)"}'
$COMPOSE ps
