#!/usr/bin/env bash
# Self-check for scripts/load-env.sh. Runs in CI beside the other shell self-checks.
#
#   bash scripts/load-env.test.sh
#
# What it is guarding: on 2026-08-11 a secret was written into the live .env as a raw
# multi-line PEM. Every script that read that file did `set -a; . ./.env; set +a`, so the
# shell tried to RUN the key — `./.env: line 115: PRIVATE: command not found` — and the
# non-zero exit took the deploy's migration step down with it. The same `. ./.env` sits in
# front of the nightly backup, the weekly restore drill and the 5-minute watchdog in
# install-host-cron.sh, joined by `&&`, so a broken line silences those too.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}
check() {
  local name="$1" expected="$2" got="$3"
  if [ "$got" = "$expected" ]; then ok "$name"; else bad "$name — expected [$expected], got [$got]"; fi
}

echo "load-env.sh:"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The exact shape that broke production: a PEM pasted straight in, unquoted, plus the
# ordinary lines that must still survive it.
cat >"$TMP/.env" <<'FIXTURE'
# a comment
POSTGRES_PASSWORD=s3cr3t

QUOTED_NAME="Hydromart Depot"
SINGLE_QUOTED='satu'
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDfake
-----END PRIVATE KEY-----
AFTER_THE_KEY=still-read
URL_WITH_HASH=postgresql://u:p@h:5432/db?schema=public
FIXTURE

# Run the loader the way the callers do: from the repo root of that deployment.
out="$(cd "$TMP" && . "$ROOT/scripts/load-env.sh" >/dev/null 2>&1; echo "$?")"
check "returns 0 even with an unquoted PEM in the file" 0 "$out"

vals="$(cd "$TMP" && . "$ROOT/scripts/load-env.sh" 2>/dev/null; \
  printf '%s|%s|%s|%s|%s' "${POSTGRES_PASSWORD:-}" "${QUOTED_NAME:-}" "${SINGLE_QUOTED:-}" \
    "${AFTER_THE_KEY:-}" "${URL_WITH_HASH:-}")"
check "exports the values the scripts actually need" \
  's3cr3t|Hydromart Depot|satu|still-read|postgresql://u:p@h:5432/db?schema=public' "$vals"

# The whole point: the key body is data, never a command.
ran="$(cd "$TMP" && . "$ROOT/scripts/load-env.sh" 2>&1 >/dev/null; true)"
case "$ran" in
  *'command not found'*) bad "never executes a line of the file — got: $ran" ;;
  *) ok "never executes a line of the file" ;;
esac

# Skipping a line silently would hide a typo'd secret, so the loader names what it dropped:
# here the two body lines of the PEM (7 and 8), which point straight at the malformed entry.
case "$ran" in
  *'skipped 2 non-KEY=VALUE line(s)'*'7, 8'*) ok "names the lines it skipped" ;;
  *) bad "names the lines it skipped — stderr was: [$ran]" ;;
esac

# A file that is all comments is fine; a missing one is the caller's problem, loudly.
printf '# nothing here\n' >"$TMP/.env"
out="$(cd "$TMP" && . "$ROOT/scripts/load-env.sh" >/dev/null 2>&1; echo "$?")"
check "an empty file is not an error" 0 "$out"

rm -f "$TMP/.env"
out="$(cd "$TMP" && . "$ROOT/scripts/load-env.sh" >/dev/null 2>&1; echo "$?")"
check "a missing .env fails loudly" 1 "$out"

if [ "$fails" -gt 0 ]; then
  echo "load-env.sh: $fails check(s) failed" >&2
  exit 1
fi
echo "load-env.sh: all checks passed"
