#!/bin/sh
# crond starts jobs with a stripped environment, so the shared internal key never
# reaches sweep.sh. Snapshot it to a file the jobs source, then run crond in the
# foreground (-l 8 = log to stderr, visible in `docker compose logs scheduler`).
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

exec crond -f -l 8
