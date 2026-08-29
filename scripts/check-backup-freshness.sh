#!/usr/bin/env bash
# CMP-04 — notice when the backups STOP.
#
# Everything around backups reported outcomes; nothing reported an absence. backup-db.sh
# writes OK or FAILED to /hq/retention when it runs, restore-db.sh --drill does the same
# weekly — and if either simply stops running (cron block removed, log file unwritable, the
# job erroring before it can report, the VPS rebuilt without `install-host-cron.sh`), the
# console keeps showing the LAST verdict, forever, with a date nobody reads as a date. The
# card says OK. It said OK three weeks ago too.
#
# This is the missing half: the age of the newest artefact, checked on a schedule, loud when
# it is too old. It reads the DUMPS THEMSELVES rather than the console — the file on disk is
# the thing a recovery needs, and it cannot be stale-and-green at the same time.
#
# It asked two questions and needed three. "Is there a recent dump" and "has a drill read one
# back" are both answered by files on the SAME DISK as the database, so both stay green
# through the failure that takes the disk — which is the failure backups exist for. The word
# "offsite" did not appear in this file at all, while backup-offsite.sh ran nightly and, on a
# box with no destination set, exited 2 into a log nobody reads. Green gate, zero copies
# anywhere else. The third question is below, and it is asked by re-running the verifier
# rather than by trusting its last verdict — same principle as the other two.
#
#   bash scripts/check-backup-freshness.sh
#
# Env:
#   BACKUP_DIR                 where the dumps live (default: whichever of the two holds them)
#   BACKUP_MAX_AGE_HOURS       default 26 — a nightly job plus two hours of slack
#   DRILL_MAX_AGE_DAYS         default 9  — a weekly drill plus two days
#   DRILL_LOG                  default /var/log/hydromart-restore-drill.log
#   BACKUP_OFFSITE_DEST        where a copy lives that is NOT this disk; unset is a failure
#   ALERT_WEBHOOK_URL          same webhook the services and the drill use; unset = log only
#
# Exit: 0 fresh, 1 stale or missing (the loud one), 2 nothing to check on this box.
set -uo pipefail
cd "$(dirname "$0")/.."
. ./scripts/lib/backup-dir.sh

MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
DRILL_MAX_AGE_DAYS="${DRILL_MAX_AGE_DAYS:-9}"
DRILL_LOG="${DRILL_LOG:-/var/log/hydromart-restore-drill.log}"
BACKUP_DIR="${BACKUP_DIR:-$(hydromart_backup_dir)}"

alert() {
  local url="${ALERT_WEBHOOK_URL:-}"
  [ -z "$url" ] && return 0
  local host text
  host="$(hostname 2>/dev/null || echo host)"
  text="🚨 Hydromart backups on ${host}: $1"
  curl -fsS -m 10 -X POST -H 'content-type: application/json' \
    --data "{\"text\":\"${text}\",\"content\":\"${text}\"}" "$url" >/dev/null 2>&1 || true
}

# Age in whole hours of the newest file matching a glob, or empty when there is none.
newest_age_hours() {
  local newest
  newest="$(ls -1t $1 2>/dev/null | head -1)"
  [ -z "$newest" ] && return 1
  local mtime now
  mtime="$(date -r "$newest" +%s 2>/dev/null)" || return 1
  now="$(date +%s)"
  echo $(( (now - mtime) / 3600 ))
}

fails=0

AGE="$(newest_age_hours "$BACKUP_DIR/hydromart-*.sql.gz")"
if [ -z "$AGE" ]; then
  echo "!! no dump at all in $BACKUP_DIR — nothing here has ever been backed up," >&2
  echo "   or backup-db.sh writes somewhere else. Neither is a state to leave running." >&2
  alert "no dump found in $BACKUP_DIR"
  fails=1
elif [ "$AGE" -gt "$MAX_AGE_HOURS" ]; then
  echo "!! newest dump in $BACKUP_DIR is ${AGE}h old (limit ${MAX_AGE_HOURS}h)." >&2
  echo "   The nightly job has stopped running, or stopped writing here." >&2
  alert "newest dump is ${AGE}h old (limit ${MAX_AGE_HOURS}h)"
  fails=1
else
  echo "ok   newest dump is ${AGE}h old (limit ${MAX_AGE_HOURS}h)"
fi

# The drill's own log is the signal: it appends on every run, so its mtime is when a drill
# last happened — including the runs that FAILED, which is the point. A box that has never
# run one has no log, and that is reported rather than passed.
if [ ! -f "$DRILL_LOG" ]; then
  echo "!! $DRILL_LOG does not exist — no restore drill has ever run on this box." >&2
  alert "no restore drill has ever run (no $DRILL_LOG)"
  fails=1
else
  DRILL_AGE="$(newest_age_hours "$DRILL_LOG")"
  DRILL_DAYS=$(( ${DRILL_AGE:-0} / 24 ))
  if [ "$DRILL_DAYS" -gt "$DRILL_MAX_AGE_DAYS" ]; then
    echo "!! the last restore drill was ${DRILL_DAYS}d ago (limit ${DRILL_MAX_AGE_DAYS}d)." >&2
    echo "   Until one passes again, these backups are UNVERIFIED." >&2
    alert "last restore drill was ${DRILL_DAYS}d ago (limit ${DRILL_MAX_AGE_DAYS}d)"
    fails=1
  else
    echo "ok   last restore drill was ${DRILL_DAYS}d ago (limit ${DRILL_MAX_AGE_DAYS}d)"
  fi
fi

# --- 3. is there a copy that is NOT on this disk, and are its bytes still the right bytes --
# backup-offsite.sh --verify is idempotent and never uploads: it reads the newest dump's
# remote twin back and compares size + sha256. Re-running it here costs one read-back a day
# and is the only thing in this repo that can distinguish "offsite is configured" from
# "offsite is working". Reused rather than reimplemented — a second checksum comparison
# would be a second thing to keep true.
if [ -z "${BACKUP_OFFSITE_DEST:-}" ]; then
  echo "!! BACKUP_OFFSITE_DEST is not set: every copy of this database is on the disk the" >&2
  echo "   database is on. The two checks above pass in exactly this state, which is why" >&2
  echo "   this one exists. Set it in .env — see scripts/backup-offsite.sh --help." >&2
  alert "no offsite destination — every backup is on the disk it backs up"
  fails=1
elif OFFSITE_OUT="$(bash scripts/backup-offsite.sh --verify 2>&1)"; then
  echo "ok   the newest dump is offsite and reads back byte-identical"
else
  echo "!! the newest dump is NOT verifiable at $BACKUP_OFFSITE_DEST:" >&2
  echo "$OFFSITE_OUT" | sed 's/^/   /' >&2
  alert "newest dump is not verifiable offsite — $(echo "$OFFSITE_OUT" | head -1)"
  fails=1
fi

exit "$fails"
