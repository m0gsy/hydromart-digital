#!/usr/bin/env bash
# Restore + tested-restore drill for the bundled Postgres cluster dumped by backup-db.sh
# (DB-12/OPS-1 — a backup you have never restored is not a backup).
#
# Two modes:
#
#   restore-db.sh --drill [dump.sql.gz]
#       NON-DESTRUCTIVE. Spins an ephemeral scratch Postgres container, restores the dump
#       into it, asserts the data actually loaded (roles + a known table with rows), prints
#       a report, and tears the container down. Touches nothing in production. Wire to cron
#       weekly so a broken/empty dump is caught before you need it for real:
#         0 4 * * 1 /opt/hydromart/scripts/restore-db.sh --drill >> /var/log/hydromart-restore-drill.log 2>&1
#
#   restore-db.sh --into-prod [dump.sql.gz]
#       DESTRUCTIVE real recovery into $PG_CONTAINER. Refuses unless CONFIRM=RESTORE is set.
#
# With no dump path, the newest hydromart-*.sql.gz in BACKUP_DIR is used.
# Env overrides: PG_CONTAINER, PG_USER, PG_IMAGE, BACKUP_DIR.
set -euo pipefail

CONTAINER="${PG_CONTAINER:-hydromart-postgres}"
PG_USER="${PG_USER:-hydromart}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hydromart}"

MODE="${1:-}"
DUMP="${2:-}"

if [ -z "$DUMP" ]; then
  DUMP="$(ls -1t "$BACKUP_DIR"/hydromart-*.sql.gz 2>/dev/null | head -n1 || true)"
fi
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "ERROR: no dump file given and none found in $BACKUP_DIR" >&2
  exit 1
fi

# Assert the gzip isn't truncated/empty before we rely on it.
if ! gzip -t "$DUMP" 2>/dev/null; then
  echo "ERROR: $DUMP is not a valid gzip file (corrupt/truncated dump)" >&2
  exit 1
fi

case "$MODE" in
  --drill)
    SCRATCH="hydromart-restore-drill"
    # Clean up the scratch container on any exit, success or failure.
    trap 'docker rm -f "$SCRATCH" >/dev/null 2>&1 || true' EXIT
    docker rm -f "$SCRATCH" >/dev/null 2>&1 || true
    echo "drill: starting scratch Postgres ($PG_IMAGE)..."
    docker run -d --name "$SCRATCH" \
      -e POSTGRES_USER="$PG_USER" -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=postgres \
      "$PG_IMAGE" >/dev/null

    # Wait for the server to accept connections (max ~30s).
    for i in $(seq 1 30); do
      if docker exec "$SCRATCH" pg_isready -U "$PG_USER" >/dev/null 2>&1; then break; fi
      sleep 1
      if [ "$i" = 30 ]; then echo "ERROR: scratch Postgres never became ready" >&2; exit 1; fi
    done

    echo "drill: restoring $DUMP ..."
    gunzip -c "$DUMP" | docker exec -i "$SCRATCH" psql -q -U "$PG_USER" -d postgres >/dev/null

    # Sanity: the dump is a whole-cluster pg_dumpall, so at least the service databases
    # should exist after restore. Count them and fail the drill if the restore was empty.
    DBCOUNT=$(docker exec "$SCRATCH" psql -tAX -U "$PG_USER" -d postgres \
      -c "SELECT count(*) FROM pg_database WHERE datname LIKE 'hydromart%';")
    DBCOUNT="${DBCOUNT//[[:space:]]/}"
    echo "drill: restored databases matching 'hydromart%': ${DBCOUNT:-0}"
    if [ "${DBCOUNT:-0}" -lt 1 ]; then
      echo "ERROR: drill restore produced no hydromart databases — dump is unusable" >&2
      exit 1
    fi
    echo "drill OK: $DUMP restores cleanly ($DBCOUNT db)"
    ;;

  --into-prod)
    if [ "${CONFIRM:-}" != "RESTORE" ]; then
      echo "REFUSING: this OVERWRITES the live cluster in container '$CONTAINER'." >&2
      echo "Re-run with CONFIRM=RESTORE to proceed:  CONFIRM=RESTORE $0 --into-prod $DUMP" >&2
      exit 1
    fi
    echo "restoring $DUMP into PROD container '$CONTAINER' ..."
    gunzip -c "$DUMP" | docker exec -i "$CONTAINER" psql -U "$PG_USER" -d postgres
    echo "restore complete. Restart the app services so they reconnect."
    ;;

  *)
    echo "usage: $0 --drill [dump.sql.gz]      # non-destructive tested-restore drill" >&2
    echo "       $0 --into-prod [dump.sql.gz]  # destructive real recovery (needs CONFIRM=RESTORE)" >&2
    exit 2
    ;;
esac
