#!/usr/bin/env bash
# Full backup of the bundled Postgres (ALL Hydromart service databases + roles),
# gzipped and timestamped, with retention. Scheduled by `bash scripts/install-host-cron.sh`
# (Q-10) — the schedule lives there, not in this comment, because a comment has never
# once run at 03:00.
#
# Restore (whole cluster) from a dump:
#   gunzip -c hydromart-YYYYMMDD-HHMMSS.sql.gz | docker exec -i hydromart-postgres psql -U hydromart
#
# Env overrides: PG_CONTAINER, PG_USER, BACKUP_DIR, BACKUP_KEEP.
# ponytail: pg_dumpall over the whole cluster (one file restores everything) —
# switch to per-db pg_dump only if a single DB ever needs isolated restore.
set -euo pipefail

# Cron runs this with an absolute path from an arbitrary cwd; the compose helpers below
# resolve their config relative to the repo root.
cd "$(dirname "$0")/.."
. scripts/lib/deploy-common.sh
. scripts/lib/backup-report.sh

# H-37: whatever happens from here on gets recorded in admin-service, so /hq/retention
# stops being a card that can only say NONE. The trap covers every failure path — a dump
# that never ran is exactly the case the console must not keep reporting as fine.
trap 'rc=$?; [ "$rc" -ne 0 ] && report_backup_run BACKUP FAILED "backup-db.sh exited $rc — see the backup log"; exit $rc' EXIT

CONTAINER="${PG_CONTAINER:-hydromart-postgres}"
PG_USER="${PG_USER:-hydromart}"
KEEP="${BACKUP_KEEP:-14}"

# /var/backups needs root, and this runs as the deploy user — the old default made the
# script fail exactly when it mattered (before a migration). Try the system location,
# fall back to the user's home rather than aborting. An explicit BACKUP_DIR always wins.
default_backup_dir() {
  if mkdir -p /var/backups/hydromart 2>/dev/null && [ -w /var/backups/hydromart ]; then
    echo /var/backups/hydromart
  else
    echo "$HOME/backups"
  fi
}
BACKUP_DIR="${BACKUP_DIR:-$(default_backup_dir)}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/hydromart-$STAMP.sql.gz"

# Stream the dump straight through gzip so nothing large lands uncompressed.
docker exec "$CONTAINER" pg_dumpall -U "$PG_USER" | gzip > "$FILE"

# Fail loudly if the dump is suspiciously tiny (container down / auth failed).
SIZE=$(wc -c < "$FILE")
if [ "$SIZE" -lt 1000 ]; then
  echo "ERROR: backup $FILE is only ${SIZE}B — dump likely failed" >&2
  exit 1
fi
HUMAN_SIZE="$(du -h "$FILE" | cut -f1)"
echo "backup OK: $FILE ($HUMAN_SIZE)"
report_backup_run BACKUP OK "$HUMAN_SIZE, $(basename "$FILE")"

# Offsite copy to NEO (optional but recommended — if the VPS disk/box dies the
# local backups die with it). Enable by setting BACKUP_S3_BUCKET (+ creds) in the
# cron env; unset = local-only. Uses a separate bucket/key from app uploads.
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
  if S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-https://nos.jkt-1.neo.id}" \
     S3_REGION="${BACKUP_S3_REGION:-jkt-1}" \
     S3_BUCKET="$BACKUP_S3_BUCKET" \
     S3_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:?set BACKUP_S3_ACCESS_KEY_ID}" \
     S3_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:?set BACKUP_S3_SECRET_ACCESS_KEY}" \
     node "$REPO_DIR/scripts/upload-to-s3.mjs" "$FILE" "db/$(basename "$FILE")"; then
    echo "offsite OK -> $BACKUP_S3_BUCKET/db/$(basename "$FILE")"
  else
    echo "WARN: offsite upload to NEO failed — kept local copy" >&2
  fi
fi

# Local retention: keep the newest $KEEP, delete older. (NEO retention = set a
# bucket lifecycle/expiry rule in the console; this script doesn't prune remote.)
ls -1t "$BACKUP_DIR"/hydromart-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
