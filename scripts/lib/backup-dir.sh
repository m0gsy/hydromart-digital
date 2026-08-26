#!/usr/bin/env bash
# CMP-02 — one answer to "where do the dumps live".
#
# There were two. backup-db.sh writes to /var/backups/hydromart when it can create it and
# falls back to $HOME/backups when it cannot (the deploy user is not root, which is the
# normal case) — so on the production box the dumps land in ~/backups. restore-db.sh had
# `BACKUP_DIR="${BACKUP_DIR:-/var/backups/hydromart}"` hardcoded, looked there every Monday
# at 04:30, found nothing, and failed for a reason that had nothing to do with the backups.
# The nightly job reported OK the same week. Two scripts, two answers, one directory that
# actually holds the files.
#
# This is the READER's answer: the directory that HOLDS dumps, not the first one that is
# writable. backup-offsite.sh already got it right; this is that function, in one place.

# hydromart_backup_dir — echo the directory holding hydromart-*.sql.gz dumps.
# Falls back to the canonical location so an error message on a box with no dumps names
# somewhere real.
hydromart_backup_dir() {
  local d
  for d in /var/backups/hydromart "$HOME/backups"; do
    if [ -d "$d" ] && ls -1 "$d"/hydromart-*.sql.gz >/dev/null 2>&1; then
      echo "$d"
      return 0
    fi
  done
  echo /var/backups/hydromart
}
