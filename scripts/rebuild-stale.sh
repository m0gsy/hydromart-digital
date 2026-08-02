#!/usr/bin/env bash
# Rebuild service images in SMALL SERIAL batches so the VPS never hits ENOSPC/OOM.
# `docker compose up --build` of all services builds them CONCURRENTLY — each bakes
# the full monorepo node_modules, so parallel builds spike RAM (OOM) and pile up
# orphan layers (ENOSPC). This builds a few at a time, prunes between batches
# (docker-gc.sh), then starts them.
#
# Usage:
#   bash scripts/rebuild-stale.sh                 # rebuild the known-stale set
#   bash scripts/rebuild-stale.sh crm payout      # rebuild only these
#   BATCH=1 bash scripts/rebuild-stale.sh         # one image at a time (tightest disk/RAM)
#   BATCH=6 bash scripts/rebuild-stale.sh         # more parallelism (bigger VPS)
#
# Safe to re-run: it only builds + `up -d` the named services; volumes untouched.
set -euo pipefail

cd "$(dirname "$0")/.."

# COMPOSE (incl. the tls profile that keeps Caddy visible) comes from here.
. scripts/lib/deploy-common.sh

# ponytail: 4 fits the current 16GB/8vCPU VPS (a build peaks ~1.5GB). Lower it to
# 1-2 if the host is ever downsized again.
#
# Parallel builds are also what tripped the dockerd crash on 2026-08-02 ("concurrent
# map iteration and map write" in BuildKit's solver — see DEPLOY.md), so this number is
# a race window as well as a memory knob. The daemon-side answer is `live-restore`,
# which keeps prod serving through a crash; drop this to 1 if the panic ever repeats
# and the engine has no fix yet — a full `--all` rebuild then runs well past the
# deploy workflow's 40m command_timeout, so raise that too.
BATCH="${BATCH:-4}"

# Services still on old images (current as of the last deploy: auth product order
# payment delivery depot gateway web were already rebuilt). Override via args.
DEFAULT_STALE=(customer dashboard loyalty promo referral crm recommendation forecast payout scheduler)
# Every deployable service, for `rebuild-stale.sh --all` (used by deploy.sh on a
# shared-package change). Order is build order; gateway/web last so upstreams exist.
# `hr` was missing here, so `--all` (what deploy.sh runs on a shared-package change)
# quietly skipped hr-service and left it on an old image.
ALL_SERVICES=(auth customer product order payment delivery depot dashboard loyalty \
  promo referral crm recommendation forecast payout admin hr scheduler gateway web)

if [ "${1:-}" = "--all" ]; then
  SERVICES=("${ALL_SERVICES[@]}")
elif [ "$#" -gt 0 ]; then
  SERVICES=("$@")
else
  SERVICES=("${DEFAULT_STALE[@]}")
fi

echo "rebuild-stale: ${#SERVICES[@]} service(s), batch size ${BATCH}"
df -h / | awk 'NR==2{print "  disk: "$4" free ("$5" used)"}'

# Warm the shared base image ONCE (all Dockerfiles use node:20-alpine). Without
# this, every parallel batch re-fetches its manifest from Docker Hub at the same
# time — that contention is what triggers "TLS handshake timeout". Retry, since
# the registry is flaky under load.
pull_base() {
  local n=1
  until docker pull node:20-alpine; do
    [ "$n" -ge 5 ] && { echo "!! could not pull node:20-alpine after 5 tries"; return 1; }
    echo "   base pull failed (try $n) — retrying in 10s"; sleep 10; n=$((n + 1))
  done
}
pull_base

i=0
batch=()
flush() {
  [ "${#batch[@]}" -eq 0 ] && return 0
  echo ">> building: ${batch[*]}"
  # Build is serial across flushes. Retry: BuildKit still HEADs the registry for
  # the base manifest, so a flaky Docker Hub can still TLS-timeout mid-build.
  local n=1
  until $COMPOSE build "${batch[@]}"; do
    [ "$n" -ge 3 ] && { echo "!! build failed for ${batch[*]} after 3 tries"; return 1; }
    echo "   build failed (try $n) — retrying in 15s"; sleep 15; n=$((n + 1))
  done
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
