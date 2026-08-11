#!/bin/sh
# crond starts jobs with a stripped environment, so the shared internal key never
# reaches sweep.sh. Snapshot it to a file the jobs source, then run crond in the
# foreground.
set -eu
: "${INTERNAL_SERVICE_KEY:?INTERNAL_SERVICE_KEY not set}"
{
  printf 'export INTERNAL_SERVICE_KEY=%s\n' "$INTERNAL_SERVICE_KEY"
  # H-38: the failure ping and the request timeout are read by every sweep, and crond
  # strips them the same way it strips the key.
  printf 'export ALERT_WEBHOOK_URL=%s\n' "${ALERT_WEBHOOK_URL:-}"
  printf 'export SWEEP_TIMEOUT=%s\n' "${SWEEP_TIMEOUT:-600}"
} > /tmp/sweep.env

# C1 — TZ needs a zone FILE, and alpine ships none. Compose has set
# `TZ=${SCHEDULER_TZ:-${PRICING_TZ:-Asia/Jakarta}}` on this container since H-16, but with
# no /usr/share/zoneinfo the C library silently falls back to UTC: crond then reads every
# line of the crontab as UTC, so the 08:00 "time to refill" nudge goes out at 15:00 WIB and
# the 03:30 retention purge runs at 10:30 WIB, in the middle of the working day. Exactly the
# bug H-16 believed it had fixed — the variable was right, the data behind it was missing.
#
# The mount comes first because it needs no network: the host has tzdata, and a container
# that must reach a CDN before it can schedule anything is a scheduler that stops working
# on a bad DNS day. `apk add` is the fallback for a host without zoneinfo.
TZ_NAME="${TZ:-UTC}"
if [ ! -f "/usr/share/zoneinfo/$TZ_NAME" ]; then
  echo "[scheduler] no zone file for $TZ_NAME — installing tzdata" >&2
  apk add --no-cache tzdata >/dev/null 2>&1 || true
fi
if [ ! -f "/usr/share/zoneinfo/$TZ_NAME" ]; then
  # Loudly, and fatally: crond would otherwise run every job seven hours out of place and
  # look perfectly healthy doing it. A scheduler nobody can trust the clock of is worse
  # than one that is visibly down — the healthcheck and the deploy gate both see this.
  echo "[scheduler] !! FATAL: $TZ_NAME has no zone file; every cron time would be UTC" >&2
  exit 1
fi
echo "[scheduler] clock: $(date '+%Y-%m-%d %H:%M:%S %Z%z') (TZ=$TZ_NAME)" >&2

# H-38: the heartbeat the healthcheck falls back to before the first sweep completes, so
# a freshly started container is not reported unhealthy for having swept nothing yet.
mkdir -p /var/run/sweep
: > /var/run/sweep/started

# busybox crond silently discards EVERY entry of a crontab that is not owned by the user
# it belongs to. It still starts, still reports the file through `crontab -l`, still wakes
# up once a minute — and schedules nothing. Bind-mounting the repo's crontab straight onto
# /etc/crontabs/root delivered it as the deploy user (uid 1000, not root), so production
# ran a scheduler that had never executed a single sweep: no subscription orders, no
# refill reminders, no retention purge, no HR announcements, no campaign batches. Copy it
# in and own it here, where the ownership is ours to set.
cp /scripts/crontab /etc/crontabs/root
chown root:root /etc/crontabs/root
chmod 600 /etc/crontabs/root

# -d, not -l: busybox crond defaults to syslog, and no syslog daemon runs in this image, so
# `-l 8` sent every job line and every sweep failure to nowhere. `docker compose logs
# scheduler` was empty for the whole time the scheduler was dead. -d logs to stderr.
exec crond -f -d 8
