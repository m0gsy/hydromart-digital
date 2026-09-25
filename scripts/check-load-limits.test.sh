#!/usr/bin/env bash
# The runnable check for scripts/check-load-limits.mjs.
#
#   bash scripts/check-load-limits.test.sh
#
# A gate that has never gone red proves nothing. This builds a throwaway tree with a two-service
# test stack and shows the gate green for a complete overlay and red for each way the overlay can
# rot: a service added to the test stack and not to the overlay, a database URL with no pool limit,
# an unbounded postgres, and a load workflow that never layers the overlay in. Then it runs against
# the real repository.
set -uo pipefail
# CI invokes this as `bash -e file`; the negative cases below are SUPPOSED to exit non-zero.
set +e
cd "$(dirname "$0")/.."
GATE="$PWD/scripts/check-load-limits.mjs"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

mkdir -p "$WORK/.github/workflows"
cat > "$WORK/docker-compose.test.yml" <<'YML'
x-env: &env
  RATE_LIMIT_MAX: 1000000
services:
  auth:
    environment:
      AUTH_DATABASE_URL: postgresql://u:p@postgres:5432/hydromart_auth?schema=public
  gateway:
    environment:
      X: 1
YML
echo "      COMPOSE_EXTRA_FILES: docker-compose.cache.yml,docker-compose.load-limits.yml" > "$WORK/.github/workflows/load.yml"

good_overlay() {
  cat > "$WORK/docker-compose.load-limits.yml" <<'YML'
services:
  postgres:
    mem_limit: 2g
    cpus: 2.0
    command:
      - postgres
      - -c
      - max_connections=150

  auth:
    mem_limit: 512m
    cpus: 1.0
    environment:
      AUTH_DATABASE_URL: postgresql://u:p@postgres:5432/hydromart_auth?schema=public&connection_limit=5&pool_timeout=10

  gateway:
    mem_limit: 512m
    cpus: 1.0
YML
}
run() { HYDROMART_ROOT="$WORK" node "$GATE" > "$WORK/out" 2>&1; RC=$?; }

good_overlay
run
[ "$RC" = 0 ] && ok "a complete overlay passes" || bad "a complete overlay must pass: $(cat "$WORK/out")"

good_overlay
sed -i '/^  gateway:/,$d' "$WORK/docker-compose.load-limits.yml"
run
[ "$RC" = 1 ] && grep -q 'service "gateway"' "$WORK/out" && ok "a service missing from the overlay is red (it would run unbounded)" || bad "a missing service must fail (rc=$RC): $(cat "$WORK/out")"

good_overlay
sed -i 's/&connection_limit=5&pool_timeout=10//' "$WORK/docker-compose.load-limits.yml"
run
[ "$RC" = 1 ] && grep -q 'AUTH_DATABASE_URL is not overridden' "$WORK/out" && ok "a database URL with no pool limit is red" || bad "an unbounded pool must fail (rc=$RC): $(cat "$WORK/out")"

good_overlay
sed -i 's/max_connections=150/max_connections=100/' "$WORK/docker-compose.load-limits.yml"
run
[ "$RC" = 1 ] && grep -q 'postgres in the overlay' "$WORK/out" && ok "postgres off production's max_connections is red" || bad "a wrong postgres must fail (rc=$RC): $(cat "$WORK/out")"

good_overlay
echo "      COMPOSE_EXTRA_FILES: docker-compose.cache.yml" > "$WORK/.github/workflows/load.yml"
run
[ "$RC" = 1 ] && grep -q 'does not layer' "$WORK/out" && ok "a load workflow that never layers the overlay in is red" || bad "an unused overlay must fail (rc=$RC): $(cat "$WORK/out")"

node "$GATE" > "$WORK/real" 2>&1
[ "$?" = 0 ] && ok "the committed overlay passes" || bad "the committed overlay fails: $(cat "$WORK/real")"

[ "$fails" -eq 0 ] && echo "load limits: all checks passed" || {
  echo "load limits: $fails check(s) failed"
  exit 1
}
