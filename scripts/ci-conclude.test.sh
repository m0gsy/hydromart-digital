#!/usr/bin/env bash
# Self-check for ci-conclude.sh, in the shape scripts/check-launch-blockers.test.sh set:
# every way the gate is supposed to go RED gets fired at it here, because a gate nobody has
# ever seen fail is indistinguishable from a gate that cannot.
#
# The one this exists for: `integration` and `e2e` are conditional jobs, and GitHub reports
# a SKIPPED job as successful. So "skipped" has to be judged against whether it was allowed
# to skip — which is what `changes.outputs.docker` says — and never waved through on its own.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SUT="$HERE/ci-conclude.sh"

pass=0
fail=0

# want=0 expects the gate to go green, want=1 expects it to go red.
check() {
  local want="$1" name="$2"
  shift 2
  local out rc
  out="$(bash "$SUT" "$@" 2>&1)"
  rc=$?
  if [ "$rc" = "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL: $name"
    echo "      args   : $*"
    echo "      wanted : exit $want, got exit $rc"
    echo "      said   : $out"
  fi
}

# ---- the happy paths -------------------------------------------------------
check 0 'everything ran and passed' \
  --docker true --verify success --integration success --e2e success

check 0 'no docker change, so both heavy jobs are allowed to skip' \
  --docker false --verify success --integration skipped --e2e skipped

# ---- the hole this gate was written to close -------------------------------
check 1 'e2e red' \
  --docker true --verify success --integration success --e2e failure

check 1 'integration red' \
  --docker true --verify success --integration failure --e2e success

check 1 'e2e skipped even though the change touches docker' \
  --docker true --verify success --integration success --e2e skipped

check 1 'integration skipped even though the change touches docker' \
  --docker true --verify success --integration skipped --e2e success

check 1 'e2e cancelled — a timeout is not a pass' \
  --docker true --verify success --integration success --e2e cancelled

check 1 'verify red' \
  --docker true --verify failure --integration success --e2e success

check 1 'verify itself skipped' \
  --docker true --verify skipped --integration success --e2e success

# ---- the instrument's own failure modes ------------------------------------
# `changes` exits 1 when ci-affected.sh answers nothing, and an empty docker flag is
# exactly what that used to look like downstream. Unreadable must not read as "false".
check 1 'docker flag empty — the instrument could not answer' \
  --docker '' --verify success --integration skipped --e2e skipped

check 1 'docker flag is neither true nor false' \
  --docker maybe --verify success --integration success --e2e success

check 1 'a result GitHub never emits' \
  --docker true --verify success --integration success --e2e greenish

check 1 'a missing argument is not an assumption' \
  --docker true --verify success --integration success

echo ""
echo "ci-conclude self-check: $pass passed, $fail failed"
[ "$fail" = 0 ] || exit 1
