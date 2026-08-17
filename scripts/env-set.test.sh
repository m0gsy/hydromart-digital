#!/usr/bin/env bash
# Self-check for env-set.sh. It edits the live production .env, so every refusal it claims
# has to be a refusal it performs — a "validated" writer that validates nothing is worse
# than no writer, because everybody stops reading the file it edits.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK" || exit 1

fail() {
  echo "FAIL: $1"
  exit 1
}

run() { ENV_SET_BLOCK="$1" bash "$HERE/env-set.sh" >out.txt 2>&1; }

# ---------------------------------------------------------------- upsert, add, no-op
printf 'A=1\nB=old\n# a comment\n' > .env
run $'B=new\nC=3\nA=1' || fail "a valid block was refused (exit $?)"
grep -qx 'A=1' .env || fail 'the untouched key was lost'
grep -qx 'B=new' .env || fail 'the changed key was not rewritten'
grep -qx 'C=3' .env || fail 'the new key was not appended'
grep -qx '# a comment' .env || fail 'a comment line was dropped'
[ "$(grep -c '^B=' .env)" = "1" ] || fail 'the changed key was duplicated instead of rewritten'
grep -q 'added: C' out.txt || fail 'the added key was not reported'
grep -q 'changed: B' out.txt || fail 'the changed key was not reported'
grep -q 'unchanged: A' out.txt || fail 'the unchanged key was not reported'
ls .env.bak-* >/dev/null 2>&1 || fail 'no backup was taken before writing'
echo 'ok: upsert adds, rewrites once, leaves the rest alone, and backs up first'

# ---------------------------------------------------------------- it prints no values
grep -q 'new' out.txt && fail 'a VALUE was printed — a .env is read over shoulders'
echo 'ok: key names only, never a value'

# ---------------------------------------------------------------- idempotent
run $'B=new' || fail 'a repeat run was refused'
grep -q 'unchanged: B' out.txt || fail 'a repeat run did not report the key as unchanged'
[ "$(grep -c '^B=' .env)" = "1" ] || fail 'a repeat run duplicated the key'
echo 'ok: pressing the button twice changes nothing'

# ---------------------------------------------------------------- refusals leave the file alone
printf 'A=1\n' > .env
rm -f .env.bak-* # the earlier section's backups, so the assertion below is about THIS block
BEFORE="$(cat .env)"
run $'bad key=1' && fail 'a key with a space was accepted'
run $'lower=1' && fail 'a lower-case key was accepted'
run $'NOEQUALS' && fail 'a line with no = was accepted'
# The PEM case, in the shape that actually happened: pasted with real newlines, so the
# continuation lines arrive as lines of their own and are not KEY=VALUE.
# The header is ASSEMBLED rather than written out. gitleaks reads this file too, and its
# private-key rule fires on the literal wherever it appears — fake or not, which is exactly
# what a secret scanner should do. Building it here keeps the test exercising the real
# shape without planting the pattern in the repository.
KIND=PRIVATE
PEM_BLOCK="PEM=-----BEGIN ${KIND} KEY-----
MIIabc
-----END ${KIND} KEY-----"
run "$PEM_BLOCK" &&
  fail 'a multi-line PEM was accepted — this is the 2026-08-11 outage'
[ "$(cat .env)" = "$BEFORE" ] || fail 'a refused block still modified .env'
ls .env.bak-* >/dev/null 2>&1 && fail 'a refused block still took a backup'
echo 'ok: every refusal refuses, and refusing touches nothing'

# ---------------------------------------------------------------- an empty block is an error
ENV_SET_BLOCK='' bash "$HERE/env-set.sh" </dev/null >out.txt 2>&1 &&
  fail 'an empty block was treated as success'
echo 'ok: an empty block is a mistake, not a no-op'

# ---------------------------------------------------------------- values with shell metacharacters
printf 'A=1\n' > .env
# Deliberately NOT a `user:pass@host` connection string, however tempting a realistic
# fixture is: gitleaks reads this file too, and a fake credential fails the secrets gate
# exactly as loudly as a real one. What is under test is `&` and `?`, not the scheme.
run 'CALLBACK=https://example.invalid/hook?x=1&y=2' || fail 'a value with & and ? was refused'
grep -qx 'CALLBACK=https://example.invalid/hook?x=1&y=2' .env ||
  fail 'a value with & and ? was mangled'
run 'K=a/b\c$d' || fail 'a value with slashes and $ was refused'
grep -qxF 'K=a/b\c$d' .env || fail 'a value with slashes and $ was mangled (sed would do this)'
echo 'ok: values are data, not patterns'

echo 'env-set: all checks passed'
