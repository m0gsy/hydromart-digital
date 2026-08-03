#!/bin/sh
# POST an internal sweep endpoint on a service, authed by the shared key.
# Invoked by crond (see crontab). Arg 1 is the route after /api/v1/; arg 2 is the
# target service host:port (default order:3004).
#   sh sweep.sh subscriptions/process-due
#   sh sweep.sh proofs/purge-expired delivery:3006
#
# H-38 — this used to be a bare wget with none of the three things a scheduler needs:
#
#   no LOCK      a sweep slower than its own interval overlapped with the next tick,
#                so two runs of the same job ran concurrently against the same rows
#   no TIMEOUT   a hung service held the wget open forever; crond then stacked one
#                stuck process per tick until the container ran out of them
#   no HEARTBEAT nothing anywhere recorded that a sweep had run, so a scheduler that
#                had stopped sweeping looked exactly like one with nothing to do —
#                which is how a broken cron sidecar stays broken for weeks
set -eu
. "${SWEEP_ENV_FILE:-/tmp/sweep.env}"   # exports INTERNAL_SERVICE_KEY (crond children do not inherit it)

path="$1"
host="${2:-order:3004}"
slug="$(echo "$path" | tr '/' '-')"
now="$(date -u +%FT%TZ)"

# Overridable so the self-check (sweep.test.sh) can run without /var/run.
STATE="${SWEEP_STATE_DIR:-/var/run/sweep}"
mkdir -p "$STATE"

# One request may not outlive its own schedule. The tightest cadence is every 5 minutes
# (webhook fan-out), and the widest job is the nightly retention purge, so the cap is set
# by the slowest legitimate sweep rather than by the fastest tick.
TIMEOUT="${SWEEP_TIMEOUT:-600}"

# Lock: `mkdir` is atomic on every filesystem busybox runs on, which flock is not
# guaranteed to be in this image. Per job, not global — the hourly subscription sweep and
# the 5-minute webhook fan-out are unrelated and must not block each other.
LOCK="$STATE/$slug.lock"

# A container killed mid-sweep leaves the directory behind, and a stale lock silently
# disables that job forever. Anything older than twice the timeout is a corpse.
if [ -d "$LOCK" ]; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +"$(( (TIMEOUT * 2) / 60 + 1 ))" 2>/dev/null)" ]; then
    echo "${now} stale lock for ${path} removed" >&2
    rmdir "$LOCK" 2>/dev/null || true
  else
    echo "${now} SKIPPED ${path} — previous run still in progress" >&2
    exit 0
  fi
fi

if ! mkdir "$LOCK" 2>/dev/null; then
  echo "${now} SKIPPED ${path} — lost the lock race" >&2
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT INT TERM

# Fire-and-forget ops ping on failure, same webhook the services use. A sweep failing
# every hour into a container log nobody tails is the definition of a silent outage.
notify_failure() {
  [ -z "${ALERT_WEBHOOK_URL:-}" ] && return 0
  text="Hydromart scheduler: sweep ${path} on ${host} FAILED"
  wget -q -O- -T 10 --header='content-type: application/json' \
    --post-data="{\"text\":\"${text}\",\"content\":\"${text}\"}" \
    "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
}

if wget -q -O- -T "$TIMEOUT" --header="x-internal-key: ${INTERNAL_SERVICE_KEY}" \
    --post-data='' "http://${host}/api/v1/${path}"; then
  echo "${now} swept ${path}"
  # Two heartbeats: one per job for diagnosis, one shared for the container healthcheck.
  : > "$STATE/$slug.ok"
  : > "$STATE/last-success"
else
  echo "${now} FAILED ${path}" >&2
  : > "$STATE/$slug.failed"
  notify_failure
fi
