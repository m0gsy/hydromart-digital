#!/usr/bin/env bash
# Q-10 — install the host cron jobs this repo depends on.
#
# The schedules existed only as comments in the scripts they were meant to run. The
# nightly backup line was in backup-db.sh's header, the weekly restore drill's in
# restore-db.sh's, the watchdog's in watchdog.sh's — and a comment has never once run at
# 03:00. The restore drill in particular had never been scheduled anywhere, so "we have
# tested restores" was a capability nobody had turned on.
#
#   bash scripts/install-host-cron.sh          # install / update
#   bash scripts/install-host-cron.sh --show    # print what would be installed
#   bash scripts/install-host-cron.sh --remove  # take them out again
#
# Idempotent: the block is delimited by markers and replaced wholesale, so running it
# twice installs one copy and running it after an edit updates in place. Nothing outside
# the markers in the user's crontab is touched.
#
# Runs as the deploy user, not root — every job here only needs docker socket access,
# which that user already has (it is what deploy.sh uses).
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$(pwd)"
BEGIN="# >>> hydromart (scripts/install-host-cron.sh) >>>"
END="# <<< hydromart <<<"

# Jobs are ordered so nothing overlaps: the backup finishes long before the drill reads
# it, and the drill runs on Monday when the previous night's dump is the newest one.
# ALERT_WEBHOOK_URL is read from .env by each script's own loader where it matters; the
# drill needs it in the environment, so it is exported from .env here.
# C1b — the times below are business hours, so cron must read them as business hours.
# The host runs UTC, and a bare crontab follows the host: "03:00 nightly backup" fired at
# 10:00 WIB, in the middle of the working day, and the Monday-morning restore drill landed
# on Monday LUNCHTIME. Same class of bug as the scheduler container's missing zone files,
# in the other half of the scheduling — one is inside docker, this one is not.
#
# Read from the same .env the stack uses, so one variable moves both clocks. `.env` is only
# read, never sourced (that is what load-env.sh is for).
if [ -f .env ]; then
  . ./scripts/load-env.sh
fi
CRON_TZ_VALUE="${SCHEDULER_TZ:-${PRICING_TZ:-Asia/Jakarta}}"

block() {
  cat <<EOF
$BEGIN
# Managed by scripts/install-host-cron.sh. Edit that file, not this block.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# Every time in this block is local, not UTC.
CRON_TZ=$CRON_TZ_VALUE

# Nightly full-cluster dump + offsite copy. Reports OK/FAILED to admin-service (H-37).
0 3 * * * cd $REPO && . ./scripts/load-env.sh && bash scripts/backup-db.sh >> /var/log/hydromart-backup.log 2>&1

# Weekly tested restore into a scratch container (H-36/Q-10). Non-destructive. Verifies
# the newest dump against the LIVE cluster and alerts loudly when it does not match.
30 4 * * 1 cd $REPO && . ./scripts/load-env.sh && bash scripts/restore-db.sh --drill >> /var/log/hydromart-restore-drill.log 2>&1

# CMP-03 — get the dump OFF this box, and READ IT BACK. backup-db.sh's own S3 push fails
# soft (a WARN in a log nobody reads) and nothing ever verifies the object afterwards;
# backup-offsite.sh copies and then re-reads and compares SHA-256 — and it existed in this
# repo for weeks with NOTHING calling it: not cron, not deploy, not CI. Twenty minutes after
# the nightly dump, so it copies the file that job just wrote.
20 3 * * * cd $REPO && . ./scripts/load-env.sh && bash scripts/backup-offsite.sh >> /var/log/hydromart-backup.log 2>&1

# A database is not a system. Restored onto a fresh box it will not start, because .env holds
# the 68 keys that tell it what it is — database URLs, JWT secrets, S3 credentials, the OTP
# provider, every Sentry DSN. Measured on production 2026-08-31: 7,925 bytes, and the only
# copy of it lived on the box it describes.
#
# Encrypted to a PUBLIC certificate, so the box can write tomorrow's copy and cannot read
# yesterday's. Runs after the dump, not before: if the night is going to fail it should fail
# on the bigger artefact first.
25 3 * * * cd $REPO && . ./scripts/load-env.sh && bash scripts/backup-env.sh >> /var/log/hydromart-backup.log 2>&1

# The databases were going offsite every night and the FILES were not — not once. Seven
# services write to the object bucket, and two of those prefixes are evidence rather than
# decoration: `pod/` is the proof a delivery happened, `payment-proof/` is the proof money
# arrived. Restoring every database onto a fresh box would have produced orders pointing at
# photographs that no longer existed anywhere.
#
# Its own log, because its mtime is what check-backup-freshness.sh reads to notice the job
# has STOPPED — and a failed run must still touch it, or silence would read as success.
40 3 * * * cd $REPO && . ./scripts/load-env.sh && node scripts/backup-objects.mjs >> /var/log/hydromart-objects.log 2>&1

# CMP-04 — notice when the backups STOP. Every other job here reports an outcome; none of
# them reports an absence, so a cron block that was never installed on a rebuilt box, or a
# job that stopped being able to write, leaves /hq/retention showing the last OK forever.
# This reads the age of the newest dump and of the last drill, and is loud when either is
# too old. Daily, an hour after the offsite copy.
0 5 * * * cd $REPO && . ./scripts/load-env.sh && bash scripts/check-backup-freshness.sh >> /var/log/hydromart-ops-checks.log 2>&1

# Converge anything that stopped between deploys, and record why it stopped.
*/5 * * * * cd $REPO && . ./scripts/load-env.sh && bash scripts/watchdog.sh >> /var/log/hydromart-watchdog.log 2>&1

# N13 — TLS expiry. Renewal is automatic, which is exactly why nobody watches it: the
# failure is not a loud renewal error, it is renewal quietly stopping and every browser
# refusing the site three weeks later. Weekly is enough for a 21-day window.
15 5 * * 1 cd $REPO && . ./scripts/load-env.sh && bash scripts/check-tls-expiry.sh >> /var/log/hydromart-ops-checks.log 2>&1

# L1.3 — the rollbacks are RUN, not merely present. check-rollbacks.sh proves the file
# exists; this proves it works, against a throwaway copy of the live database with real
# rows in it. Monday, after the restore drill, on the newest migrations of every service.
30 6 * * 1 cd $REPO && . ./scripts/load-env.sh && bash scripts/rollback-drill.sh >> /var/log/hydromart-ops-checks.log 2>&1

# N14 — container log caps. `ops/docker-daemon.json` is a file somebody has to copy to the
# host by hand; nothing ever checked that they did, and the default is unbounded.
45 5 * * 1 cd $REPO && . ./scripts/load-env.sh && bash scripts/check-log-retention.sh >> /var/log/hydromart-ops-checks.log 2>&1

# Bind-mounted config a container is not actually running. deploy.sh checks this too, but
# only when a deploy happens: Prometheus sat on a pre-Q-9 ruleset from 5 August through
# many deploys, because converge never touches a container whose definition is unchanged,
# and the alerts it was missing were the two the on-call runbook calls customer-visible.
0 6 * * 1 cd $REPO && . ./scripts/load-env.sh && bash scripts/check-config-drift.sh >> /var/log/hydromart-ops-checks.log 2>&1

# L1.7 — query plans, read on the data volume that actually exists. Scheduled rather than
# left to whoever remembers, because its answer CHANGES on its own: on 2026-08-26 the
# largest table held 136 rows and every plan was a sequential scan over almost nothing. The
# script prints NOT A MEASUREMENT below EVIDENCE_FLOOR, so these weekly runs stay honestly
# useless until real traffic arrives — and then start reporting the plans that matter,
# without anybody having had to diarise it. Read-only: EXPLAIN, never EXPLAIN ANALYZE.
15 6 * * 1 cd $REPO && . ./scripts/load-env.sh && bash scripts/explain-hot-queries.sh >> /var/log/hydromart-ops-checks.log 2>&1
$END
EOF
}

case "${1:-}" in
  --show)
    block
    exit 0
    ;;
  --remove)
    # `crontab -l` exits non-zero when the user has no crontab at all.
    crontab -l 2>/dev/null | sed "\|^$BEGIN\$|,\|^$END\$|d" | crontab -
    echo "removed the hydromart cron block"
    exit 0
    ;;
  '')
    ;;
  *)
    echo "usage: $0 [--show|--remove]" >&2
    exit 2
    ;;
esac

# Log files must exist and be writable by this user before cron first appends to them —
# a redirect into an unwritable path fails the job silently, which is the failure mode
# this whole script exists to stop.
for f in hydromart-backup hydromart-restore-drill hydromart-watchdog hydromart-ops-checks hydromart-objects; do
  if [ ! -w "/var/log/$f.log" ]; then
    sudo -n touch "/var/log/$f.log" 2>/dev/null && sudo -n chown "$(id -u):$(id -g)" "/var/log/$f.log" 2>/dev/null || {
      echo "!! /var/log/$f.log is not writable and passwordless sudo is unavailable." >&2
      echo "   Run once as root:  touch /var/log/$f.log && chown $(id -un) /var/log/$f.log" >&2
      exit 1
    }
  fi
done

# Retire the hand-written lines this block replaces, not just an older copy of the block.
#
# Measured on the live box 2026-08-17: installing the block left the four pre-marker lines
# standing, so backup, restore-drill and watchdog were each scheduled TWICE — once in the
# correct form and once in the `set -a; . ./.env` form that has been failing since
# 2026-08-11. Two full pg_dumps at 03:00 and two watchdogs every five minutes is a worse
# state than before the fix, and nothing would have said so.
#
# The two markers are narrow on purpose: `set -a` is the exact defect being retired, and
# the home-dir BACKUP_DIR is the one override the old backup line carried. Anything else
# in the user's crontab (docker-gc, whatever ops added by hand) is left alone.
legacy='(set -a; *\. *\./\.env|BACKUP_DIR=.*/backups .*scripts/backup-db\.sh)'

{
  crontab -l 2>/dev/null | sed "\|^$BEGIN\$|,\|^$END\$|d" | grep -Ev "$legacy"
  block
} | crontab -

echo "installed:"
crontab -l | sed -n "\|^$BEGIN\$|,\|^$END\$|p"
