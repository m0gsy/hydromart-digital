#!/usr/bin/env bash
# Self-check for the crontab block scripts/install-host-cron.sh installs.
#
#   bash scripts/install-host-cron.test.sh
#
# The three jobs in that block are the nightly backup, the weekly restore drill and the
# 5-minute watchdog — the things that notice when production is broken. Nothing here
# touches a real crontab: `--show` prints the block and this asserts its shape.
set -uo pipefail
cd "$(dirname "$0")/.."

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

echo "install-host-cron.sh:"

block="$(bash scripts/install-host-cron.sh --show 2>/dev/null)"

# C1b: the host runs UTC and a bare crontab follows the host, so "0 3" meant 10:00 WIB.
case "$block" in
  *"CRON_TZ=Asia/Jakarta"*) ok "declares the business zone, so 03:00 means 03:00 WIB" ;;
  *) bad "declares the business zone — block was: $block" ;;
esac

# One variable moves the container clock and this one together.
override="$(SCHEDULER_TZ=Pacific/Auckland bash scripts/install-host-cron.sh --show 2>/dev/null)"
case "$override" in
  *"CRON_TZ=Pacific/Auckland"*) ok "follows SCHEDULER_TZ when the operator sets one" ;;
  *) bad "follows SCHEDULER_TZ when the operator sets one" ;;
esac

# CRON_TZ only works ahead of the job lines: cron applies it to entries that FOLLOW it.
tz_line="$(printf '%s\n' "$block" | grep -n '^CRON_TZ=' | cut -d: -f1)"
first_job="$(printf '%s\n' "$block" | grep -n '^[0-9*]' | head -1 | cut -d: -f1)"
if [ -n "$tz_line" ] && [ -n "$first_job" ] && [ "$tz_line" -lt "$first_job" ]; then
  ok "declares it BEFORE the first job, which is the only place cron reads it"
else
  bad "declares it before the first job (CRON_TZ at $tz_line, first job at $first_job)"
fi

for job in backup-db.sh restore-db.sh watchdog.sh; do
  case "$block" in
    *"$job"*) ok "still schedules $job" ;;
    *) bad "still schedules $job" ;;
  esac
done

# Sourcing .env would run it; every one of these lines reads it instead (see load-env.sh).
case "$block" in
  *'. ./scripts/load-env.sh'*) ok "each job reads .env rather than executing it" ;;
  *) bad "each job reads .env rather than executing it" ;;
esac

if [ "$fails" -gt 0 ]; then
  echo "install-host-cron.sh: $fails check(s) failed" >&2
  exit 1
fi
echo "install-host-cron.sh: all checks passed"
