#!/usr/bin/env bash
# The runnable check for scripts/check-scheduler-targets.mjs.
#
#   bash scripts/check-scheduler-targets.test.sh
#
# A gate that has never gone red proves nothing. This builds a throwaway repo tree — two services
# with their own ports and routes — and shows the gate red for the defect that shipped (a sweep
# aimed at another service's port), for a route the target does not have, for a service that does
# not exist, and green for a correct crontab, including a line that relies on sweep.sh's default host.
set -uo pipefail
# CI invokes this as `bash -e file`; the negative cases below are SUPPOSED to exit non-zero.
set +e
cd "$(dirname "$0")/.."
GATE="$PWD/scripts/check-scheduler-targets.mjs"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

mkservice() { # name port  — a service with one internal POST route
  local dir="$WORK/services/$1-service/src"
  mkdir -p "$dir/config" "$dir/modules"
  echo "export const schema = { $(echo "$1" | tr a-z A-Z)_SERVICE_PORT: Joi.number().port().default($2) };" > "$dir/config/env.validation.ts"
  cat > "$dir/modules/$1.controller.ts" <<TS
import { Controller, Post } from '@nestjs/common';
@Controller({ path: '$1', version: '1' })
export class ${1^}Controller {
  @Post('internal/sweep')
  sweep() {}
}
TS
}
mkservice order 3004
mkservice loyalty 3009
mkservice promo 3010

run() { # crontab lines...
  printf '%s\n' "$@" > "$WORK/crontab"
  HYDROMART_ROOT="$WORK" SCHEDULER_CRONTAB="$WORK/crontab" node "$GATE" > "$WORK/out" 2>&1
  RC=$?
}

run '# a comment mentioning sweep.sh nothing/at/all' \
  '0 * * * * sh /scripts/sweep.sh order/internal/sweep' \
  '45 3 * * * sh /scripts/sweep.sh loyalty/internal/sweep loyalty:3009'
[ "$RC" = 0 ] && ok "a correct crontab passes, including the default host (order:3004) and comments" || bad "a correct crontab must pass: $(cat "$WORK/out")"

run '45 3 * * * sh /scripts/sweep.sh loyalty/internal/sweep loyalty:3010'
[ "$RC" = 1 ] && grep -q 'loyalty-service listens on 3009, not 3010' "$WORK/out" && ok "the shipped defect: loyalty's sweep aimed at promo's port is red, and says which port is right" || bad "a wrong port must fail (rc=$RC): $(cat "$WORK/out")"

run '45 3 * * * sh /scripts/sweep.sh loyalty/internal/nothing loyalty:3009'
[ "$RC" = 1 ] && grep -q 'declares no POST /api/v1/loyalty/internal/nothing' "$WORK/out" && ok "a route the target service does not have is red" || bad "a missing route must fail (rc=$RC): $(cat "$WORK/out")"

run '45 3 * * * sh /scripts/sweep.sh order/internal/sweep ghost:3999'
[ "$RC" = 1 ] && grep -q 'no service named ghost-service' "$WORK/out" && ok "a host that is not a service is red" || bad "an unknown service must fail (rc=$RC): $(cat "$WORK/out")"

run '0 * * * * sh /scripts/sweep.sh loyalty/internal/sweep'
[ "$RC" = 1 ] && grep -q 'order-service declares no POST /api/v1/loyalty/internal/sweep' "$WORK/out" && ok "a line with no host is checked against the DEFAULT host, not skipped" || bad "the default host must be checked (rc=$RC): $(cat "$WORK/out")"

# And the real tree: the gate must pass on this repository as committed.
node "$GATE" > "$WORK/real" 2>&1
[ "$?" = 0 ] && ok "the committed crontab passes" || bad "the committed crontab fails: $(cat "$WORK/real")"

[ "$fails" -eq 0 ] && echo "scheduler targets: all checks passed" || {
  echo "scheduler targets: $fails check(s) failed"
  exit 1
}
