#!/usr/bin/env bash
# Self-check for the scheduler's lock, heartbeat and healthcheck (H-38).
# Run: bash scripts/scheduler/sweep.test.sh
#
# ponytail: asserts in a script, no framework — same shape as
# scripts/lib/deploy-common.test.sh, which CI already runs. `wget` is stubbed on PATH so
# no HTTP, no container and no service are needed; what is under test is the concurrency
# and staleness logic, not the request.
set -uo pipefail
cd "$(dirname "$0")/../.."

fail=0
ok() { echo "  ok: $1"; }
bad() { echo "FAIL $1"; fail=1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export SWEEP_STATE_DIR="$TMP/state"
export SWEEP_ENV_FILE="$TMP/sweep.env"
printf 'export INTERNAL_SERVICE_KEY=test-key\n' > "$SWEEP_ENV_FILE"

# wget stub: exits 0 or 1 depending on $TMP/wget-exit, prints whatever $TMP/wget-body
# holds (the sweep endpoint's response), and records that it was called.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/wget" <<'STUB'
#!/bin/sh
echo called >> "$TMP/wget-calls"
cat "$TMP/wget-body" 2>/dev/null
exit "$(cat "$TMP/wget-exit" 2>/dev/null || echo 0)"
STUB
chmod +x "$TMP/bin/wget"
export TMP
export PATH="$TMP/bin:$PATH"

run() { sh scripts/scheduler/sweep.sh "$@" >/dev/null 2>&1; }
health() { sh scripts/scheduler/healthcheck.sh >/dev/null 2>&1; }

# --- heartbeat -------------------------------------------------------------------
echo 0 > "$TMP/wget-exit"
run subscriptions/process-due
[ -f "$SWEEP_STATE_DIR/last-success" ] && ok "a successful sweep writes the shared heartbeat" \
  || bad "a successful sweep must write last-success"
[ -f "$SWEEP_STATE_DIR/subscriptions-process-due.ok" ] && ok "and a per-job marker" \
  || bad "expected a per-job .ok marker"

# A failing sweep must NOT refresh the heartbeat — otherwise a job that has been failing
# every 5 minutes keeps the container looking healthy forever, which is the exact
# invisibility H-38 is about.
rm -f "$SWEEP_STATE_DIR/last-success"
echo 1 > "$TMP/wget-exit"
run orders/reminders/reorder
[ -f "$SWEEP_STATE_DIR/last-success" ] && bad "a FAILED sweep must not write last-success" \
  || ok "a failed sweep leaves the heartbeat alone"
[ -f "$SWEEP_STATE_DIR/orders-reminders-reorder.failed" ] && ok "failure is recorded per job" \
  || bad "expected a per-job .failed marker"

# --- J7: a 200 that reports a dead round is not a success -------------------------
#
# The transport said OK, so everything above was satisfied. What the body SAID went
# unread: `{"placed":0}` from a sweep where every subscription threw is byte-identical
# to a sweep where nothing was due, and both wrote the heartbeat. Sweeps now answer with
# `ok`, and this is the script reading it.
rm -rf "$SWEEP_STATE_DIR"; mkdir -p "$SWEEP_STATE_DIR"
echo 0 > "$TMP/wget-exit"
printf '{"placed":0,"failed":12,"ok":false}' > "$TMP/wget-body"
run subscriptions/process-due
[ -f "$SWEEP_STATE_DIR/last-success" ] && bad "a 200 reporting ok:false must not write last-success" \
  || ok "a round that failed every row leaves the heartbeat alone"
[ -f "$SWEEP_STATE_DIR/subscriptions-process-due.failed" ] && ok "and is recorded as a failure" \
  || bad "expected a per-job .failed marker for ok:false"
[ -f "$SWEEP_STATE_DIR/subscriptions-process-due.ok" ] && bad "ok:false must not write the per-job .ok marker" \
  || ok "no success marker for a dead round"

# The other half of the same rule: a round that did work while losing one row is a
# working sweep. Marking it failed would put the scheduler permanently unhealthy, which
# is the same blindness in the other direction.
rm -rf "$SWEEP_STATE_DIR"; mkdir -p "$SWEEP_STATE_DIR"
printf '{"placed":41,"failed":1,"ok":true}' > "$TMP/wget-body"
run subscriptions/process-due
[ -f "$SWEEP_STATE_DIR/last-success" ] && ok "a productive round with one bad row stays healthy" \
  || bad "ok:true must still write last-success"

# An endpoint that says nothing about itself keeps the old contract — the exit code.
# Nothing that is not a sweep gets reinterpreted by this change.
rm -rf "$SWEEP_STATE_DIR"; mkdir -p "$SWEEP_STATE_DIR"
printf '{"cancelled":0}' > "$TMP/wget-body"
run orders/internal/expire-abandoned
[ -f "$SWEEP_STATE_DIR/last-success" ] && ok "a body with no verdict falls back to the exit code" \
  || bad "a 200 without an ok field must still count as success"
: > "$TMP/wget-body"

# --- lock ------------------------------------------------------------------------
echo 0 > "$TMP/wget-exit"
rm -f "$TMP/wget-calls"
mkdir -p "$SWEEP_STATE_DIR/webhooks-deliveries-process.lock"
run webhooks/deliveries/process admin:3017
[ -f "$TMP/wget-calls" ] && bad "a held lock must skip the request entirely" \
  || ok "a held lock skips the sweep instead of running it twice"

# A container killed mid-sweep leaves the directory behind. Without the age check that
# job would never run again — silently, forever.
touch -d '3 hours ago' "$SWEEP_STATE_DIR/webhooks-deliveries-process.lock" 2>/dev/null ||
  touch -t "$(date -d '3 hours ago' +%Y%m%d%H%M 2>/dev/null || echo 202001010000)" \
    "$SWEEP_STATE_DIR/webhooks-deliveries-process.lock"
run webhooks/deliveries/process admin:3017
[ -f "$TMP/wget-calls" ] && ok "a stale lock is reclaimed rather than blocking forever" \
  || bad "expected the stale lock to be broken and the sweep to run"

# The lock is released on the way out, or the next tick would skip too.
[ -d "$SWEEP_STATE_DIR/webhooks-deliveries-process.lock" ] && bad "lock must be released after a run" \
  || ok "the lock is released when the sweep finishes"

# --- healthcheck -----------------------------------------------------------------
rm -rf "$SWEEP_STATE_DIR"; mkdir -p "$SWEEP_STATE_DIR"
health && bad "no heartbeat at all must be unhealthy" || ok "no heartbeat at all is unhealthy"

: > "$SWEEP_STATE_DIR/started"
health && ok "a just-started container is healthy before its first sweep" \
  || bad "a fresh container must not be reported unhealthy"

: > "$SWEEP_STATE_DIR/last-success"
health && ok "a recent success is healthy" || bad "a recent success must be healthy"

touch -d '2 hours ago' "$SWEEP_STATE_DIR/last-success" 2>/dev/null ||
  touch -t "$(date -d '2 hours ago' +%Y%m%d%H%M 2>/dev/null || echo 202001010000)" \
    "$SWEEP_STATE_DIR/last-success"
rm -f "$SWEEP_STATE_DIR/started"
health && bad "a stale heartbeat must be unhealthy" \
  || ok "crond up but nothing sweeping for 2h is unhealthy"

[ "$fail" -eq 0 ] && echo "scheduler sweep: all checks passed"
exit "$fail"
