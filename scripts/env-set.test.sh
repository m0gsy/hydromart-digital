#!/usr/bin/env bash
# Self-check for scripts/env-set.sh. Runs in CI beside the other shell self-checks.
#
#   bash scripts/env-set.test.sh
#
# env-set.sh rewrites the live .env from values it must never print, so every branch is
# pinned here: it must replace a key in place rather than append a second line, must
# collapse duplicates a hand-edit left behind, must add a key that is missing, must leave
# an already-correct file untouched, must refuse a newline, and must keep the value out of
# its own output.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad() {
  FAIL=$((FAIL + 1))
  echo "  FAIL $1"
}

work() {
  WORK="$(mktemp -d)"
  cd "$WORK" || exit 1
  # deploy-common is only sourced with --restart, which no test uses.
  mkdir -p scripts/lib
}

cleanup() { cd /tmp && rm -rf "$WORK"; }

# 1. replaces in place, keeps position, does not append
work
printf 'A=1\nREVIEWER_PHONE=+620000\nB=2\n' > .env
OUT="$(REVIEWER_PHONE='+6281,+6282' bash "$ROOT/scripts/env-set.sh" REVIEWER_PHONE 2>&1)"
if [ "$(sed -n '2p' .env)" = 'REVIEWER_PHONE=+6281,+6282' ] && [ "$(grep -c '^REVIEWER_PHONE=' .env)" = 1 ] &&
  [ "$(wc -l < .env)" -eq 3 ]; then
  ok "replaces an existing key in place"
else
  bad "replaces an existing key in place: $(cat .env)"
fi
case "$OUT" in
  *'+6281'*) bad "printed the value" ;;
  *'REVIEWER_PHONE written (11 chars)'*) ok "reports the length, not the value" ;;
  *) bad "no length report: $OUT" ;;
esac
cleanup

# 2. collapses duplicates — compose reads the last, a human reads the first
work
printf 'REVIEWER_OTP_CODE=111111\nX=1\nREVIEWER_OTP_CODE=222222\n' > .env
REVIEWER_OTP_CODE=314159 bash "$ROOT/scripts/env-set.sh" REVIEWER_OTP_CODE > /dev/null 2>&1
if [ "$(grep -c '^REVIEWER_OTP_CODE=' .env)" = 1 ] && grep -q '^REVIEWER_OTP_CODE=314159$' .env; then
  ok "collapses duplicate keys to one"
else
  bad "collapses duplicate keys to one: $(cat .env)"
fi
cleanup

# 3. appends a key the file does not have
work
printf 'A=1\n' > .env
REVIEWER_PHONE='+6281' bash "$ROOT/scripts/env-set.sh" REVIEWER_PHONE > /dev/null 2>&1
if grep -q '^REVIEWER_PHONE=+6281$' .env && grep -q '^A=1$' .env; then
  ok "appends a missing key"
else
  bad "appends a missing key: $(cat .env)"
fi
cleanup

# 4. no-op on an already-correct file, and no backup left behind
work
printf 'REVIEWER_PHONE=+6281\n' > .env
REVIEWER_PHONE='+6281' bash "$ROOT/scripts/env-set.sh" REVIEWER_PHONE > /dev/null 2>&1
CODE=$?
if [ "$CODE" -eq 4 ] && [ -z "$(ls .env.bak.* 2> /dev/null)" ]; then
  ok "exits 4 and leaves no backup when nothing changes"
else
  bad "no-op path: exit $CODE, backups: $(ls .env.bak.* 2> /dev/null)"
fi
cleanup

# 5. refuses a newline rather than writing a broken second line
work
printf 'A=1\n' > .env
REVIEWER_PHONE=$'+6281\nEVIL=1' bash "$ROOT/scripts/env-set.sh" REVIEWER_PHONE > /dev/null 2>&1
CODE=$?
if [ "$CODE" -eq 1 ] && ! grep -q 'EVIL' .env; then
  ok "refuses a value containing a newline"
else
  bad "newline path: exit $CODE, file: $(cat .env)"
fi
cleanup

# 6. a backslash in the value survives verbatim
work
printf 'A=1\n' > .env
REVIEWER_PHONE='a\nb\\c' bash "$ROOT/scripts/env-set.sh" REVIEWER_PHONE > /dev/null 2>&1
if [ "$(sed -n 's/^REVIEWER_PHONE=//p' .env)" = 'a\nb\\c' ]; then
  ok "keeps backslashes verbatim"
else
  bad "backslash mangled: $(sed -n 's/^REVIEWER_PHONE=//p' .env)"
fi
cleanup

# 7. an unset key is an error, not an empty write
work
printf 'A=1\n' > .env
(
  unset REVIEWER_PHONE
  bash "$ROOT/scripts/env-set.sh" REVIEWER_PHONE > /dev/null 2>&1
)
CODE=$?
if [ "$CODE" -ne 0 ] && ! grep -q 'REVIEWER_PHONE' .env; then
  ok "refuses a key that is unset in the environment"
else
  bad "unset path: exit $CODE, file: $(cat .env)"
fi
cleanup

echo "env-set.test: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
