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

# Retention: keep the newest $KEEP, delete older.
ls -1t "$BACKUP_DIR"/hydromart-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
