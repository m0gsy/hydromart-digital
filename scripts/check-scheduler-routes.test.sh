#!/usr/bin/env bash
# Proof that check-scheduler-routes.mjs can go red.
#
#   bash scripts/check-scheduler-routes.test.sh
#
# A gate is only worth its runtime if it fails on the thing it exists to catch. This one
# exists because PAR-05 and PAR-01 were fully built and callable by nobody on a schedule —
# so the two failure shapes below are exactly the two that hid them:
#
#   1. a crontab path that resolves to no route at all   -> every tick 404s
#   2. a path whose route needs a JWT, not the internal key -> every tick 401/403
#
# Both are run against a throwaway fixture tree, never against the real crontab: a test
# that mutates the repo's own scheduler config to prove a point is a test that can leave
# the repo broken when it is interrupted.
set -uo pipefail
# CI invokes shell checks as `bash -e file`, and every case here runs a command that is
# SUPPOSED to exit 1. Under -e the first one kills the run and reports it as this script's
# own failure.
set +e
cd "$(dirname "$0")/.."

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A miniature repo: the checker resolves paths relative to its own location, so the fixture
# needs the same shape — scripts/ next to services/.
mkdir -p "$WORK/scripts/scheduler" "$WORK/services/fixture-service/src/modules"
cp scripts/check-scheduler-routes.mjs "$WORK/scripts/"

cat > "$WORK/services/fixture-service/src/modules/thing.controller.ts" <<'TS'
@Controller({ path: 'things', version: '1' })
export class ThingController {
  @ApiOkResponse({ type: Dto })
  @Post('internal/sweep')
  @Public()
  @UseGuards(InternalAuthGuard)
  sweepable(): Promise<void> {
    return this.things.sweep();
  }

  @Post('human-only')
  @Roles(Role.SUPER_ADMIN)
  humanOnly(): Promise<void> {
    return this.things.sweep();
  }
}
TS

run_fixture() {
  printf '%s\n' "$1" > "$WORK/scripts/scheduler/crontab"
  ( cd "$WORK" && node scripts/check-scheduler-routes.mjs 2>&1 )
}

# --- case 1: the happy path, so a red below means something ------------------
OUT="$(run_fixture '0 7 * * * sh /scripts/sweep.sh things/internal/sweep fixture:3000')"
RC=$?
if [ "$RC" = "0" ]; then
  ok "a sweep whose route exists and takes the internal key passes"
else
  bad "the good fixture failed (rc=$RC): $OUT"
fi

# Note the decorator ORDER in the fixture: @UseGuards sits BELOW @Post, the way hr-service
# writes it. The first version of the checker only looked at decorators above the @Post and
# called that route unguarded. If this case ever goes red for that reason again, the
# checker regressed, not the fixture.

# --- case 2: a path that resolves to nothing --------------------------------
OUT="$(run_fixture '0 7 * * * sh /scripts/sweep.sh things/internal/swep fixture:3000')"
RC=$?
if [ "$RC" = "1" ] && echo "$OUT" | grep -q "resolves to no route"; then
  ok "a typo'd sweep path is caught"
else
  bad "a path matching no route did not fail as expected (rc=$RC): $OUT"
fi

# --- case 3: the PAR-05 / PAR-01 shape — built, but JWT-only ----------------
OUT="$(run_fixture '0 7 * * * sh /scripts/sweep.sh things/human-only fixture:3000')"
RC=$?
if [ "$RC" = "1" ] && echo "$OUT" | grep -q "no InternalAuthGuard"; then
  ok "a route the scheduler cannot authenticate to is caught"
else
  bad "a JWT-only sweep target did not fail as expected (rc=$RC): $OUT"
fi

# --- case 4: a service that does not exist ----------------------------------
OUT="$(run_fixture '0 7 * * * sh /scripts/sweep.sh things/internal/sweep nosuch:3000')"
RC=$?
if [ "$RC" = "1" ] && echo "$OUT" | grep -q "no such service"; then
  ok "a sweep aimed at a service that does not exist is caught"
else
  bad "an unknown host did not fail as expected (rc=$RC): $OUT"
fi

# --- case 5: an empty crontab must not read as "all good" -------------------
OUT="$(run_fixture '# nothing scheduled')"
RC=$?
if [ "$RC" = "1" ]; then
  ok "a crontab with no sweeps fails rather than passing vacuously"
else
  bad "an empty crontab exited $RC — a check that passes on no input proves nothing"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "PASS — the scheduler-route gate fails on all four shapes it exists to catch."
  exit 0
fi
echo "FAIL — $fails assertion(s) above."
exit 1
