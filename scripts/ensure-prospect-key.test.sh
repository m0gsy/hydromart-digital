#!/usr/bin/env bash
# Self-check for ensure-prospect-key.sh: absent and blank are created (64 hex), a present value is
# never touched, and no output ever carries the value.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/scripts"
cp "$HERE/ensure-prospect-key.sh" "$HERE/env-set.sh" "$WORK/scripts/"
cd "$WORK" || exit 1

fail() {
  echo "FAIL: $1"
  exit 1
}
run() { bash scripts/ensure-prospect-key.sh > out.txt 2>&1; }
val() { sed -n 's/^PROSPECT_DNC_HMAC_KEY=//p' .env | tail -1; }

printf 'A=1\n' > .env
run || fail "absent: exit $?"
v="$(val)"
[[ "$v" =~ ^[0-9a-f]{64}$ ]] || fail 'absent: no 64-hex key was created'
grep -qx 'A=1' .env || fail 'absent: another line was lost'
grep -q "$v" out.txt && fail 'absent: the value was printed'
grep -q 'PROSPECT_DNC_HMAC_KEY' out.txt || fail 'absent: the key name was not logged'

printf 'A=1\nPROSPECT_DNC_HMAC_KEY=\nB=2\n' > .env
run || fail "blank: exit $?"
v="$(val)"
[[ "$v" =~ ^[0-9a-f]{64}$ ]] || fail 'blank: no 64-hex key was created'
[ "$(grep -c '^PROSPECT_DNC_HMAC_KEY=' .env)" = 1 ] || fail 'blank: the line was duplicated'
grep -qx 'B=2' .env || fail 'blank: another line was lost'

printf 'PROSPECT_DNC_HMAC_KEY="  "\n' > .env
run || fail "blank quotes: exit $?"
[[ "$(val)" =~ ^[0-9a-f]{64}$ ]] || fail 'blank-in-quotes was kept'

printf 'PROSPECT_DNC_HMAC_KEY=keep-this-existing-value-0123456789abcdef\n' > .env
cp .env before.env
run || fail "present: exit $?"
cmp -s .env before.env || fail 'present: an existing value was changed'
grep -q 'keep-this' out.txt && fail 'present: the value was printed'

rm .env
run && fail 'no .env should fail'
echo "ensure-prospect-key: all checks passed"
