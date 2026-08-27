#!/usr/bin/env bash
# The runnable check for PAR-20's gate — scripts/check-route-parity.mjs.
#
#   bash scripts/check-route-parity.test.sh
#
# The gate exists because nothing in this repo measured the server→UI direction, and the
# check that sounded like it did (check-endpoint-contracts) only ever walked from the client.
# So the first thing proved here is that this one goes RED when a route is added with no way
# in — the exact shape of the eight capabilities the audit found built and unreachable.
set -uo pipefail
# NOTE: CI invokes this as `bash -e file`, which sets -e for the whole script regardless of
# what the line below asks for — and this file runs commands that are SUPPOSED to fail
# (pg_isready while Postgres is still starting exits 2; every negative case exits 1). Under
# -e the first of those killed the run and reported the failure as the script's own. So -e
# is switched off explicitly here: the assertions below are the verdict, not the shell's.
set +e
cd "$(dirname "$0")/.."

WORK="$(mktemp -d)"
VICTIM=services/loyalty-service/src/modules/reward.controller.ts
BASELINE=scripts/route-parity-baseline.json
cp "$VICTIM" "$WORK/victim.orig"
cp "$BASELINE" "$WORK/baseline.orig"
trap 'cp "$WORK/victim.orig" "$VICTIM"; cp "$WORK/baseline.orig" "$BASELINE"; rm -rf "$WORK"' EXIT

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}
run_check() {
  set +e
  OUT="$(node scripts/check-route-parity.mjs 2>&1)"
  RC=$?
  set -e
}

echo "check-route-parity (PAR-20):"

run_check
[ "$RC" = 0 ] && ok "passes on the repository as it stands" || bad "the repo should pass: $OUT"

# 1. A new route nobody can reach. This is the whole point: it is written, guarded, and has
#    no screen, no adapter, no cron line — exactly like the birthday-points sweep.
python - "$VICTIM" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding='utf-8').read()
marker = "export class RewardController {"
i = s.index(marker) + len(marker)
route = """

  @Get('a-capability-with-no-way-in')
  async orphanedOnPurpose(): Promise<{ ok: true }> {
    return { ok: true };
  }
"""
io.open(p, 'w', encoding='utf-8', newline='\n').write(s[:i] + route + s[i:])
PY
run_check
[ "$RC" = 1 ] && ok "goes RED on a route with no way in" || bad "a new orphan must fail (rc=$RC)"
case "$OUT" in *a-capability-with-no-way-in*) ok "  ...and names the route" ;; *) bad "  expected the route in the message: $OUT" ;; esac
cp "$WORK/victim.orig" "$VICTIM"

# 2. A recorded orphan that stopped being one, with the baseline left behind. A ratchet that
#    is never re-recorded stops being a ratchet — it becomes a list of excuses.
python - "$BASELINE" <<'PY'
import io, json, sys
p = sys.argv[1]
data = json.load(io.open(p, encoding='utf-8'))
data['orphans'].append('GET loyalty: /a-route-that-does-not-exist')
io.open(p, 'w', encoding='utf-8', newline='\n').write(json.dumps(data, indent=2) + '\n')
PY
run_check
[ "$RC" = 1 ] && ok "goes RED when the baseline names a route that is no longer orphaned" || bad "a stale baseline must fail (rc=$RC)"
cp "$WORK/baseline.orig" "$BASELINE"

# 3. And the classification itself is asserted, not assumed: an internal route is not an
#    orphan, or every sweep endpoint in the repo would be one and the gate would be noise.
run_check
case "$OUT" in *"internal"*) ok "reports internal routes as their own class" ;; *) bad "expected an internal count: $OUT" ;; esac

# 4. The partner API is its own class too, and for the same reason pointed outward: a route
#    behind ApiKeyGuard is called by an INTEGRATOR, from their own system. Its caller is not
#    in this repo and never will be, so hunting for one can only ever fail — `partner/deliveries`
#    and its replay sat in the orphan list for exactly that reason.
#
#    The guard is written on the CLASS, above `@Controller(...)`, so a reader that looks only
#    inside the controller body misses it. That is the regression this case pins.
case "$OUT" in
  *"partner API"*) ok "reports partner-API routes as their own class" ;;
  *) bad "expected a partner-API count: $OUT" ;;
esac
case "$OUT" in
  *"0 partner API"*) bad "the partner count is zero — the class-level ApiKeyGuard is not being read" ;;
  *) ok "  ...and it is not zero" ;;
esac

exit "$fails"
