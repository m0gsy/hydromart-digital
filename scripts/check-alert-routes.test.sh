#!/usr/bin/env bash
# The runnable check for scripts/check-alert-routes.mjs.
#
#   bash scripts/check-alert-routes.test.sh
#
# Shows the gate red for the defect that shipped — an alert (and a fixture) naming a route
# that does not exist — and for the neighbours that would slip past a looser check: the right
# path with the wrong method, and an invented label that only the fixtures use.
set -uo pipefail
# CI invokes this as `bash -e file`; the negative cases below are SUPPOSED to exit non-zero.
set +e
cd "$(dirname "$0")/.."
GATE="$PWD/scripts/check-alert-routes.mjs"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

SRC="$WORK/services/demo-service/src/modules"
mkdir -p "$SRC"
cat > "$SRC/orders.controller.ts" <<'TS'
import { Controller, Get, Post } from '@nestjs/common';
@Controller({ path: 'orders', version: '1' })
export class OrdersController {
  @Get()
  list() {}
  @Post('checkout')
  checkout() {}
}
TS

RULES="$WORK/rules.yml"
TESTS="$WORK/tests.yml"
run() {
  OUT="$(HYDROMART_ROOT="$WORK" ALERT_RULES="$RULES" ALERT_TESTS="$TESTS" node "$GATE" 2>&1)"
  RC=$?
}

echo "check-alert-routes:"

# 1. Real routes everywhere -> green.
cat > "$RULES" <<'Y'
groups:
  - name: g
    rules:
      - alert: A
        expr: sum(rate(http_request_duration_seconds_count{route=~"/api/v1/orders/(checkout)", method="POST"}[5m])) > 0
Y
cat > "$TESTS" <<'Y'
tests:
  - input_series:
      - series: 'http_request_duration_seconds_count{route="/api/v1/orders/checkout", method="POST", status="201"}'
Y
run
[ "$RC" = 0 ] && ok "green when every selector and label is a real route" || bad "should pass: $OUT"

# 2. The shipped defect: a route ending in /orders that no controller declares as POST.
sed -i 's#/api/v1/orders/(checkout)#.*/orders#' "$RULES"
run
[ "$RC" = 1 ] && ok "RED when an alert selects a route nothing declares" || bad "the invented selector must fail (rc=$RC)"
case "$OUT" in *".*/orders"*) ok "  ...and quotes the selector" ;; *) bad "  expected the selector in: $OUT" ;; esac

# 3. Right path, wrong method: /api/v1/orders exists, but only as GET.
cat > "$RULES" <<'Y'
groups:
  - name: g
    rules:
      - alert: A
        expr: sum(rate(http_request_duration_seconds_count{route="/api/v1/orders", method="POST"}[5m])) > 0
Y
run
[ "$RC" = 1 ] && ok "RED when the route exists but not with that method" || bad "a wrong method must fail (rc=$RC)"

# 4. The fixture is the one inventing it (the alert itself is fine).
cat > "$RULES" <<'Y'
groups:
  - name: g
    rules:
      - alert: A
        expr: sum(rate(http_request_duration_seconds_count{route="/api/v1/orders/checkout", method="POST"}[5m])) > 0
Y
cat > "$TESTS" <<'Y'
tests:
  - input_series:
      - series: 'http_request_duration_seconds_count{route="/orders", method="POST", status="201"}'
Y
run
[ "$RC" = 1 ] && ok "RED when only a fixture invents its label" || bad "an invented fixture label must fail (rc=$RC)"

# 5. Prose that quotes a bad selector while explaining it is not a selector.
cat > "$TESTS" <<'Y'
# this used to be {route="/orders", method="POST"} and matched nothing
tests:
  - input_series:
      - series: 'http_request_duration_seconds_count{route="/api/v1/orders/checkout", method="POST", status="201"}'
Y
run
[ "$RC" = 0 ] && ok "comments are not selectors" || bad "a comment must not count: $OUT"

# 6. The real repository passes today.
OUT="$(node "$GATE" 2>&1)"
RC=$?
[ "$RC" = 0 ] && ok "the repository itself passes" || bad "repo should pass: $OUT"

if [ "$fails" -gt 0 ]; then
  echo "check-alert-routes: $fails check(s) failed" >&2
  exit 1
fi
echo "check-alert-routes: all checks passed"
