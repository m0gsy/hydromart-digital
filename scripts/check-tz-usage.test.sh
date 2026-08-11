#!/usr/bin/env bash
# Self-check for scripts/check-tz-usage.mjs. Runs in CI beside the other shell self-checks.
#
#   bash scripts/check-tz-usage.test.sh
#
# A guard that cannot fail is worse than no guard: it reports "clean" forever and everyone
# stops looking. These fixtures prove it catches both shapes, honours a REASONED excuse,
# and is not silenced by the word `tz-ok` on its own.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

echo "check-tz-usage.mjs:"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/src"

run() { (cd "$ROOT" && node scripts/check-tz-usage.mjs "$1" >/dev/null 2>&1); }

cat >"$TMP/src/bad-day.ts" <<'EOF'
export const today = (): string => new Date().toISOString().slice(0, 10);
EOF
run "$TMP" && bad "catches a UTC day key" || ok "catches a UTC day key"

cat >"$TMP/src/bad-day.ts" <<'EOF'
export const period = (): string => new Date().toISOString().slice(0, 7);
EOF
run "$TMP" && bad "catches a UTC month key" || ok "catches a UTC month key"

cat >"$TMP/src/bad-day.ts" <<'EOF'
export const q = (tz: string) => `SELECT date_trunc('day', "createdAt") FROM "orders" ${tz}`;
EOF
run "$TMP" && bad "catches date_trunc with no AT TIME ZONE" || ok "catches date_trunc with no AT TIME ZONE"

cat >"$TMP/src/bad-day.ts" <<'EOF'
export const q = (tz: string) =>
  `SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) FROM "orders"`;
EOF
run "$TMP" && ok "passes the two-hop form" || bad "passes the two-hop form"

cat >"$TMP/src/bad-day.ts" <<'EOF'
// tz-ok: workDate is @db.Date — the UTC slice IS the local day.
export const day = (d: Date): string => d.toISOString().slice(0, 10);
EOF
run "$TMP" && ok "accepts a REASONED excuse above the line" || bad "accepts a REASONED excuse above the line"

# The reason is the point. A bare marker is someone silencing the alarm.
cat >"$TMP/src/bad-day.ts" <<'EOF'
// tz-ok:
export const day = (d: Date): string => d.toISOString().slice(0, 10);
EOF
run "$TMP" && bad "rejects a bare tz-ok with no reason" || ok "rejects a bare tz-ok with no reason"

# Documentation that merely mentions the pattern must not trip it.
cat >"$TMP/src/bad-day.ts" <<'EOF'
// Never write toISOString().slice(0, 10) for a period key.
export const day = (d: Date): string => String(d);
EOF
run "$TMP" && ok "ignores a comment that only mentions the pattern" || bad "ignores a comment that only mentions the pattern"

# And the real tree must be clean, or this guard is being carried red.
(cd "$ROOT" && node scripts/check-tz-usage.mjs >/dev/null 2>&1) &&
  ok "the repository itself passes" || bad "the repository itself passes"

if [ "$fails" -gt 0 ]; then
  echo "check-tz-usage.mjs: $fails check(s) failed" >&2
  exit 1
fi
echo "check-tz-usage.mjs: all checks passed"
