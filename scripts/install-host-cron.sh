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
block() {
  cat <<EOF
$BEGIN
# Managed by scripts/install-host-cron.sh. Edit that file, not this block.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Nightly full-cluster dump + offsite copy. Reports OK/FAILED to admin-service (H-37).
0 3 * * * cd $REPO && . ./scripts/load-env.sh && bash scripts/backup-db.sh >> /var/log/hydromart-backup.log 2>&1

# Weekly tested restore into a scratch container (H-36/Q-10). Non-destructive. Verifies
# the newest dump against the LIVE cluster and alerts loudly when it does not match.
30 4 * * 1 cd $REPO && . ./scripts/load-env.sh && bash scripts/restore-db.sh --drill >> /var/log/hydromart-restore-drill.log 2>&1

# Converge anything that stopped between deploys, and record why it stopped.
*/5 * * * * cd $REPO && . ./scripts/load-env.sh && bash scripts/watchdog.sh >> /var/log/hydromart-watchdog.log 2>&1
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
for f in hydromart-backup hydromart-restore-drill hydromart-watchdog; do
  if [ ! -w "/var/log/$f.log" ]; then
    sudo -n touch "/var/log/$f.log" 2>/dev/null && sudo -n chown "$(id -u):$(id -g)" "/var/log/$f.log" 2>/dev/null || {
      echo "!! /var/log/$f.log is not writable and passwordless sudo is unavailable." >&2
      echo "   Run once as root:  touch /var/log/$f.log && chown $(id -un) /var/log/$f.log" >&2
      exit 1
    }
  fi
done

{
  crontab -l 2>/dev/null | sed "\|^$BEGIN\$|,\|^$END\$|d"
  block
} | crontab -

echo "installed:"
crontab -l | sed -n "\|^$BEGIN\$|,\|^$END\$|p"
