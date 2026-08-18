#!/usr/bin/env bash
# Rebuild only the services this pass touched. One at a time: a parallel build of this
# monorepo exhausts memory on this box (see memory: uat-environment-gotchas).
set -u
cd /g/VsCode/Hydromart
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml -f .uat/docker-compose.uat.yml"
for s in delivery order; do
  echo "===== building $s ====="
  $C build "$s" 2>&1 | tail -4 || echo "BUILD FAILED: $s"
done
echo "===== recreating ====="
$C up -d --no-deps delivery order 2>&1 | tail -12
echo "DONE"
