#!/usr/bin/env bash
# Self-check for scripts/env-doctor.sh. Runs in CI beside the other shell self-checks.
#
#   bash scripts/env-doctor.test.sh
#
# --fix rewrites the live .env, so every branch of it is pinned here: it must join a PEM
# that was pasted with real newlines into the single \n-escaped line the format wants, must
# leave an already-correct file alone, must never touch a file whose PEM has no END line,
# and must never print the key itself.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

echo "env-doctor.sh:"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

P=PRIVATE
BEGIN="-----BEGIN $P KEY-----"
END="-----END $P KEY-----"
BODY1=MIIEvQIBADANBgkqhkiG9w0BAQEFAASCfake
BODY2=Zm9vYmFyYmF6cXV1eGZha2VrZXliYXNlNjQ=

fresh() {
  {
    echo '# managed by hand'
    echo 'POSTGRES_PASSWORD=s3cr3t'
    printf 'FCM_PRIVATE_KEY=%s\n%s\n%s\n%s\n' "$BEGIN" "$BODY1" "$BODY2" "$END"
    echo 'AFTER=still-here'
  } >.env
}

# ── the broken shape ──────────────────────────────────────────────────
fresh
out="$(bash "$ROOT/scripts/env-doctor.sh" --fix 2>&1)"
rc=$?
[ "$rc" = 0 ] && ok "--fix succeeds on a multi-line PEM" || bad "--fix succeeds on a multi-line PEM (rc=$rc)"

expected="FCM_PRIVATE_KEY=\"${BEGIN}\\n${BODY1}\\n${BODY2}\\n${END}\""
got="$(grep '^FCM_PRIVATE_KEY=' .env)"
[ "$got" = "$expected" ] && ok "joins the key into one \\n-escaped line" ||
  bad "joins the key into one \\n-escaped line — got [$got]"

[ "$(wc -l <.env)" = 4 ] && ok "the body lines are gone, the rest stays" ||
  bad "the body lines are gone, the rest stays — $(wc -l <.env) lines left"
grep -q '^AFTER=still-here$' .env && ok "lines after the key survive" || bad "lines after the key survive"

case "$out" in
  *"$BODY1"* | *"$BODY2"*) bad "never prints the key material" ;;
  *) ok "never prints the key material" ;;
esac
case "$out" in
  *FCM_PRIVATE_KEY*3*) ok "names the variable and the line it fixed" ;;
  *) bad "names the variable and the line it fixed — said: [$out]" ;;
esac

ls .env.bak.* >/dev/null 2>&1 && ok "keeps a backup of the file it rewrote" ||
  bad "keeps a backup of the file it rewrote"

# ── already correct: nothing to do, and nothing touched ───────────────
before="$(cat .env)"
bash "$ROOT/scripts/env-doctor.sh" --fix >/dev/null 2>&1
rc=$?
[ "$rc" = 4 ] && ok "a file with nothing to join reports 'nothing to do' (4)" ||
  bad "a file with nothing to join reports 'nothing to do' (4), got $rc"
[ "$before" = "$(cat .env)" ] && ok "and leaves the file byte-identical" ||
  bad "and leaves the file byte-identical"

# ── truncated key: refuse, do not guess ───────────────────────────────
rm -f .env.bak.*
{
  echo 'POSTGRES_PASSWORD=s3cr3t'
  printf 'FCM_PRIVATE_KEY=%s\n%s\n' "$BEGIN" "$BODY1"
} >.env
before="$(cat .env)"
bash "$ROOT/scripts/env-doctor.sh" --fix >/dev/null 2>&1
rc=$?
[ "$rc" = 3 ] && ok "a PEM with no END line is refused (3)" || bad "a PEM with no END line is refused (3), got $rc"
[ "$before" = "$(cat .env)" ] && ok "and the file is left untouched" || bad "and the file is left untouched"

# ── inspect: the diagnostic, truncated, read-only ─────────────────────
fresh
before="$(cat .env)"
out="$(bash "$ROOT/scripts/env-doctor.sh" --inspect 2>&1)"
case "$out" in
  *"$BODY1"*) bad "--inspect truncates what it shows" ;;
  *) ok "--inspect truncates what it shows" ;;
esac
case "$out" in
  *' 4: '*) ok "--inspect names the offending line numbers" ;;
  *) bad "--inspect names the offending line numbers — said: [$out]" ;;
esac
[ "$before" = "$(cat .env)" ] && ok "--inspect changes nothing" || bad "--inspect changes nothing"

if [ "$fails" -gt 0 ]; then
  echo "env-doctor.sh: $fails check(s) failed" >&2
  exit 1
fi
echo "env-doctor.sh: all checks passed"
