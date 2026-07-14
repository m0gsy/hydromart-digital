#!/usr/bin/env bash
# Full backup of the bundled Postgres (ALL Hydromart service databases + roles),
# gzipped and timestamped, with retention. Run on the VPS via cron:
#
#   0 3 * * * /opt/hydromart/scripts/backup-db.sh >> /var/log/hydromart-backup.log 2>&1
#
# Restore (whole cluster) from a dump:
#   gunzip -c hydromart-YYYYMMDD-HHMMSS.sql.gz | docker exec -i hydromart-postgres psql -U hydromart
#
# Env overrides: PG_CONTAINER, PG_USER, BACKUP_DIR, BACKUP_KEEP.
# ponytail: pg_dumpall over the whole cluster (one file restores everything) —
# switch to per-db pg_dump only if a single DB ever needs isolated restore.
set -euo pipefail

CONTAINER="${PG_CONTAINER:-hydromart-postgres}"
PG_USER="${PG_USER:-hydromart}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hydromart}"
KEEP="${BACKUP_KEEP:-14}"

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
echo "backup OK: $FILE ($(du -h "$FILE" | cut -f1))"

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
