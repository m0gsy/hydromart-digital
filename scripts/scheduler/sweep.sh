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

# CA-5-01 — tell somebody. The two heartbeats below this line are files inside THIS
# container: no console reads them, and the healthcheck reads one of them as a single
# yes/no for all seventeen jobs at once. So a job that had never run once looked exactly
# like one that ran a minute ago, as long as some OTHER job had recently succeeded.
#
# admin-service keeps one row per job, and /hq/health renders the crontab's own job list
# against it — so a sweep that never reports shows as NEVER RUN rather than not showing.
#
# Fire-and-forget, and deliberately so: the observer must never be able to fail the thing
# it observes. A sweep that worked but could not be reported is still a sweep that worked,
# and `|| true` keeps the exit code the round's own. The row simply goes stale, which the
# screen already renders as OVERDUE.
report_run() {
  [ -z "${ADMIN_SERVICE_HOST:-}" ] && return 0
  # busybox has no jq; the detail is truncated and stripped of the quotes and backslashes
  # that would break the hand-built JSON below.
  detail="$(printf '%s' "${2:-}" | tr -d '"\\' | tr '\n' ' ' | cut -c1-300)"
  wget -q -O- -T 10 --header='content-type: application/json' \
    --header="x-internal-key: ${INTERNAL_SERVICE_KEY}" \
    --post-data="{\"job\":\"${path}\",\"host\":\"${host}\",\"ok\":$1,\"detail\":\"${detail}\"}" \
    "http://${ADMIN_SERVICE_HOST}/api/v1/sweeps/internal/record" >/dev/null 2>&1 || true
}

# J7 — a 200 is not a verdict.
#
# Every check above this line is about the TRANSPORT. The body went straight to the
# container log unread, and that is where the answer was: `{"placed":0}` from a round in
# which every subscription threw is byte-for-byte the same as a round with nothing due,
# because the sweep catches per row and returns only what succeeded. Both wrote the
# shared heartbeat, so the healthcheck stayed green while the flow was dead — "alur mati"
# and "sistem tenang" were the same two files on disk.
#
# So sweeps now answer with `ok`, decided in the service where the counters have names:
# FALSE only when the round failed at something and accomplished nothing. A round that
# placed forty orders and lost one is still a working sweep — flagging that would pin the
# scheduler to unhealthy forever, which is the same blindness pointing the other way.
#
# `ok` absent means the endpoint makes no claim, and the exit code stands exactly as
# before. No jq in this image; the field is a flat boolean, so a fixed-string grep is the
# whole parser.
if body="$(wget -q -O- -T "$TIMEOUT" --header="x-internal-key: ${INTERNAL_SERVICE_KEY}" \
    --post-data='' "http://${host}/api/v1/${path}")"; then
  [ -n "$body" ] && echo "$body"
  if echo "$body" | tr -d ' ' | grep -q '"ok":false'; then
    echo "${now} FAILED ${path} — answered 200 but reported a dead round: ${body}" >&2
    : > "$STATE/$slug.failed"
    report_run false "$body"
    notify_failure
  else
    echo "${now} swept ${path}"
    # Two heartbeats: one per job for diagnosis, one shared for the container healthcheck.
    : > "$STATE/$slug.ok"
    : > "$STATE/last-success"
    report_run true "$body"
  fi
else
  echo "${now} FAILED ${path}" >&2
  : > "$STATE/$slug.failed"
  report_run false "tidak ada jawaban dari ${host}"
  notify_failure
fi
