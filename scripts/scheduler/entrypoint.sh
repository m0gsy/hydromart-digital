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
