#!/usr/bin/env bash
# The runnable check for CMP-04 — scripts/check-backup-freshness.sh.
#
#   bash scripts/check-backup-freshness.test.sh
#
# The thing being closed is an ABSENCE: backups that stop happening. Every assertion here is
# therefore about the script going RED on a state that used to be invisible — a directory
# with no dump in it, a dump that is a week old, a box where no drill has ever run. The
# happy path is asserted too, because a check that is red on everything is the same useless
# instrument in the other direction.
set -uo pipefail
# NOTE: CI invokes this as `bash -e file`, which sets -e for the whole script regardless of
# what the line below asks for — and this file runs commands that are SUPPOSED to fail
# (pg_isready while Postgres is still starting exits 2; every negative case exits 1). Under
# -e the first of those killed the run and reported the failure as the script's own. So -e
# is switched off explicitly here: the assertions below are the verdict, not the shell's.
set +e
cd "$(dirname "$0")/.."

export ALERT_WEBHOOK_URL=''   # no ops pings from a test that fails on purpose
fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}
check() {
  local label="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then ok "$label"; else bad "$label (want exit $want, got $got)"; fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
DUMPS="$WORK/backups"
mkdir -p "$DUMPS"
DRILL_LOG="$WORK/drill.log"

# The five cases below each assert ONE reason for going red. Now that the script also asks
# whether a copy exists off-box, they need a destination that works — otherwise every one of
# them would go red for the new reason and still look like it passed its own assertion.
OFFSITE="$WORK/offsite"
mkdir -p "$OFFSITE"

# `touch` alone is not enough any more: backup-offsite.sh refuses a 0-byte dump, correctly,
# because sha256 of nothing matches sha256 of nothing. So a dump gets bytes, and the offsite
# twin is written at the same time — the cases below assert staleness and drills, and must
# not go red for a reason they are not testing.
make_dump() {
  printf 'hydromart-fake-dump-%s
' "$1" >"$DUMPS/$1"
  cp "$DUMPS/$1" "$OFFSITE/$1"
}

run_check() {
  set +e
  BACKUP_DIR="$DUMPS" DRILL_LOG="$DRILL_LOG"     BACKUP_OFFSITE_DEST="${OFFSITE_OVERRIDE-$OFFSITE}"     BACKUP_OFFSITE_ALLOW_SAME_FS=1     bash scripts/check-backup-freshness.sh >"$WORK/out" 2>&1
  RC=$?
  set -e
  OUT="$(cat "$WORK/out")"
}

echo "backup freshness:"

# 1. The state a rebuilt VPS is in, and the state this whole script exists for.
run_check
check "an empty backup directory is a failure" 1 "$RC"
case "$OUT" in *"no dump at all"*) ok "  ...and it says which directory it looked in" ;; *) bad "  expected 'no dump at all': $OUT" ;; esac

# 2. A fresh dump and a fresh drill: the only green state.
make_dump hydromart-20260827-030000.sql.gz
touch "$DRILL_LOG"
run_check
check "a fresh dump plus a fresh drill passes" 0 "$RC"

# 3. Backups stopped three days ago. The console would still be showing the last OK.
touch -d '3 days ago' "$DUMPS/hydromart-20260827-030000.sql.gz" 2>/dev/null ||
  touch -t "$(date -v-3d +%Y%m%d%H%M 2>/dev/null || echo 202608240300)" "$DUMPS/hydromart-20260827-030000.sql.gz"
run_check
check "a three-day-old dump is a failure" 1 "$RC"
case "$OUT" in *"has stopped running"*) ok "  ...and it names the cause in words" ;; *) bad "  expected 'has stopped running': $OUT" ;; esac

# 4. Dumps are fine, but nothing has verified one in a month: they are unverified backups,
#    which is the claim this repo has been burned by before.
touch "$DUMPS/hydromart-20260827-030000.sql.gz"
touch -d '30 days ago' "$DRILL_LOG" 2>/dev/null ||
  touch -t "$(date -v-30d +%Y%m%d%H%M 2>/dev/null || echo 202607280300)" "$DRILL_LOG"
run_check
check "a month-old restore drill is a failure" 1 "$RC"
case "$OUT" in *UNVERIFIED*) ok "  ...and it calls the backups UNVERIFIED" ;; *) bad "  expected UNVERIFIED: $OUT" ;; esac

# 5. A box that has never drilled at all.
rm -f "$DRILL_LOG"
run_check
check "no drill log at all is a failure" 1 "$RC"

# 6. The state the production box is in right now: dumps fresh, drill recent, and not one
#    byte of this database anywhere except the disk it lives on. Both checks above pass.
#    This is the whole reason the third one was added, so it is asserted from the outside:
#    a green gate here for five months would have been a green gate over zero offsite copies.
touch "$DUMPS/hydromart-20260827-030000.sql.gz" "$DRILL_LOG"
OFFSITE_OVERRIDE=''
run_check
check "fresh dumps + recent drill still FAIL with no offsite destination" 1 "$RC"
case "$OUT" in
  *"on the disk the"*) ok "  ...and it says the copies are on the disk they back up" ;;
  *) bad "  expected the disk sentence: $OUT" ;;
esac

# 7. Configured but the copy is not actually there — a destination that is set and empty is
#    worse than one that is unset, because the operator believes it works.
OFFSITE_OVERRIDE="$WORK/empty-offsite" ; mkdir -p "$OFFSITE_OVERRIDE"
run_check
check "a destination with no copy in it is a failure" 1 "$RC"
case "$OUT" in
  *"NOT verifiable"*) ok "  ...and it says the dump is not verifiable" ;;
  *) bad "  expected 'NOT verifiable': $OUT" ;;
esac
unset OFFSITE_OVERRIDE

# 8. And the happy path, so this is not an instrument that is red on everything: the copy
#    make_dump wrote is still sitting at $OFFSITE, and the same gate goes green.
run_check
check "a real offsite copy passes" 0 "$RC"
case "$OUT" in
  *"reads back byte-identical"*) ok "  ...by reading the bytes back, not by trusting a log" ;;
  *) bad "  expected the read-back line: $OUT" ;;
esac

exit "$fails"
