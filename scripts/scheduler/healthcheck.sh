#!/bin/sh
# H-38 — the scheduler's last-success heartbeat, as a compose healthcheck.
#
# crond keeps running whether or not its jobs do anything, so `running` said nothing at
# all about whether sweeps were happening. This asserts that SOME sweep succeeded
# recently: the busiest job runs every 5 minutes, so a healthy scheduler touches the
# shared heartbeat well inside the window below.
#
# Until the first sweep lands, the container's own start marker stands in — a scheduler
# that has been up for two minutes is not unhealthy for having swept nothing yet.
set -eu

STATE="${SWEEP_STATE_DIR:-/var/run/sweep}"
MAX_AGE_MIN="${SWEEP_MAX_AGE_MIN:-45}"

REF="$STATE/last-success"
[ -f "$REF" ] || REF="$STATE/started"
[ -f "$REF" ] || exit 1   # entrypoint always writes `started`; its absence means crond never came up

# `find -mmin +N` prints the file only when it is OLDER than N minutes.
if [ -n "$(find "$REF" -maxdepth 0 -mmin +"$MAX_AGE_MIN" 2>/dev/null)" ]; then
  echo "no sweep has succeeded in over ${MAX_AGE_MIN}m — crond is up but nothing is running" >&2
  exit 1
fi
exit 0
