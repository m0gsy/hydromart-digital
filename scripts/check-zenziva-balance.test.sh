#!/usr/bin/env bash
# The runnable check for scripts/check-zenziva-balance.sh.
#
#   bash scripts/check-zenziva-balance.test.sh
#
# Drives the real script against a stand-in for `docker compose exec` (prints whatever the
# scenario says Zenziva answered) and a stand-in for curl (records what would have been posted),
# and shows: silence while the credit is healthy, one message when it drops, no repeat while it
# stays low, a fresh message if it recovers and drops again, the expiry warning, and that an
# unreadable balance speaks only on the SECOND failure in a row.
set -uo pipefail
# CI invokes this as `bash -e file`; assertions below drive commands that exit non-zero on purpose.
set +e
cd "$(dirname "$0")/.."
ROOT="$PWD"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

# Stand-in for `docker compose ... exec -T -e ZENZIVA_MODE=monitor auth node -`: the scenario file
# is what the container would have printed; empty means the call failed and printed nothing.
cat > "$WORK/compose" <<'SH'
#!/usr/bin/env bash
echo "$*" >> "$CALLS"
cat "$SCENARIO"
SH
chmod +x "$WORK/compose"

mkdir -p "$WORK/bin"
cat > "$WORK/bin/curl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$SENT"
SH
chmod +x "$WORK/bin/curl"

export SCENARIO="$WORK/scenario" SENT="$WORK/sent" CALLS="$WORK/calls"
export COMPOSE="$WORK/compose" ALERT_MEMORY_DIR="$WORK/alerted"
export ALERT_WEBHOOK_URL="http://webhook.invalid/x" PATH="$WORK/bin:$PATH"
export OTP_DELIVERY_CHANNEL=zenziva ZENZIVA_MIN_BALANCE=250000 ZENZIVA_EXPIRY_WARN_DAYS=14

# Run a COPY laid out like the repo but with no .env beside it: load-env.sh would otherwise pull the
# developer's own OTP channel and webhook over the values this test exports.
mkdir -p "$WORK/repo/scripts/lib"
cp scripts/check-zenziva-balance.sh scripts/load-env.sh "$WORK/repo/scripts/"
cp scripts/lib/deploy-common.sh scripts/lib/zenziva-balance.cjs "$WORK/repo/scripts/lib/"
run() { bash "$WORK/repo/scripts/check-zenziva-balance.sh" > "$WORK/out" 2>&1; RC=$?; }
sent() { [ -f "$SENT" ] && wc -l < "$SENT" | tr -d ' ' || echo 0; }
said() { grep -q -- "$1" "$SENT" 2>/dev/null; }

echo "zenziva balance monitor:"

# A channel that is not Zenziva has no credit to watch, and must not even ask.
OTP_DELIVERY_CHANNEL=console run
[ "$RC" = 0 ] && [ ! -f "$CALLS" ] && [ "$(sent)" = 0 ] && ok "another OTP channel: says so, asks nothing, alerts nothing" ||
  bad "a non-zenziva channel must be a quiet no-op (rc=$RC)"

echo 'balance=1941690 days=none' > "$SCENARIO"
run
[ "$RC" = 0 ] && [ "$(sent)" = 0 ] && ok "healthy credit: exit 0, no message" ||
  bad "a healthy balance must be silent (rc=$RC, sent=$(sent))"

echo 'balance=120000 days=none' > "$SCENARIO"
run
[ "$RC" = 1 ] && [ "$(sent)" = 1 ] && said 'under Rp250000' && ok "credit under the floor: exit 1 and one message naming the floor" ||
  bad "a low balance should alert once (rc=$RC, sent=$(sent))"

run
[ "$(sent)" = 1 ] && ok "still low on the next run: no second message" || bad "a standing condition must not repeat (sent=$(sent))"

echo 'balance=900000 days=none' > "$SCENARIO"
run
[ "$RC" = 0 ] && [ "$(sent)" = 1 ] && ok "topped up: back to exit 0, quiet" || bad "recovery should be quiet (rc=$RC, sent=$(sent))"

echo 'balance=100000 days=none' > "$SCENARIO"
run
[ "$(sent)" = 2 ] && ok "drops again after a recovery: speaks again" || bad "a recurrence must alert again (sent=$(sent))"

echo 'balance=900000 days=10' > "$SCENARIO"
run
[ "$RC" = 1 ] && said 'ends within 14 days' && ok "credit expiring inside the window: warned" ||
  bad "an expiring credit should alert (rc=$RC)"

# Measured on production 2026-09-25: Zenziva's period was "21 Agustus 2026", a month in the past
# while the balance was still Rp1.9 million. An ended period must warn, not read as "far off".
echo 'balance=900000 days=-35' > "$SCENARIO"
run
[ "$RC" = 1 ] && grep -q 'ended 35 day' "$WORK/out" && ok "a credit period that already ended: warned, and says how long ago" ||
  bad "an ended credit period must alert (rc=$RC): $(cat "$WORK/out")"

echo 'balance=900000 days=90' > "$SCENARIO"
run
[ "$RC" = 0 ] && ok "credit expiring far off: no warning" || bad "a distant expiry must not warn (rc=$RC)"

: > "$SCENARIO"
BEFORE="$(sent)"
run
[ "$RC" = 1 ] && [ "$(sent)" = "$BEFORE" ] && ok "first unreadable answer: exit 1 but no message (could be a blip)" ||
  bad "one failed read must not page (rc=$RC, sent=$(sent), before=$BEFORE)"

run
[ "$(sent)" = $((BEFORE + 1)) ] && said 'Cannot read the Zenziva SMS balance' && ok "second unreadable answer in a row: one message" ||
  bad "two failed reads must alert (sent=$(sent), before=$BEFORE)"

echo 'balance=900000 days=none' > "$SCENARIO"
run
[ "$RC" = 0 ] && [ ! -f "$ALERT_MEMORY_DIR/zenziva-unreadable.count" ] && ok "readable again: the failure count is forgotten" ||
  bad "a good read must reset the failure count"

echo 'noise the auth container printed by mistake' > "$SCENARIO"
run
[ "$RC" = 1 ] && ok "a line that is not a balance is treated as unreadable, not as zero credit" ||
  bad "garbage output must not be parsed as a balance (rc=$RC)"

if grep -vE '^\s*#' scripts/check-zenziva-balance.sh | grep -qE '\$\{?ZENZIVA_(USERKEY|PASSKEY)'; then
  bad "the monitor script must never name the credentials — they stay inside the auth container"
else
  ok "the monitor script never touches the credentials"
fi

[ "$fails" -eq 0 ] && echo "zenziva balance monitor: all checks passed" || {
  echo "zenziva balance monitor: $fails check(s) failed"
  exit 1
}
