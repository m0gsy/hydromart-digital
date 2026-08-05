#!/usr/bin/env bash
# Restore + tested-restore drill for the bundled Postgres cluster dumped by backup-db.sh
# (DB-12/OPS-1 — a backup you have never restored is not a backup).
#
# Two modes:
#
#   restore-db.sh --drill [dump.sql.gz]
#       NON-DESTRUCTIVE. Spins an ephemeral scratch Postgres container, restores the dump
#       into it, and VERIFIES THE RESULT AGAINST THE LIVE CLUSTER (H-36) — same databases,
#       same table counts, same applied migrations, and real rows in each database's
#       largest table. Prints a report, records the verdict in admin-service (H-37), and
#       tears the container down. Touches nothing in production.
#       Scheduled weekly by `bash scripts/install-host-cron.sh` (Q-10).
#
#   restore-db.sh --into-prod [dump.sql.gz]
#       DESTRUCTIVE real recovery into $PG_CONTAINER. Refuses unless CONFIRM=RESTORE is set.
#
# With no dump path, the newest hydromart-*.sql.gz in BACKUP_DIR is used.
# Env overrides: PG_CONTAINER, PG_USER, PG_IMAGE, BACKUP_DIR, ALERT_WEBHOOK_URL.
#
# A --drill that fails must be LOUD — a silent failure into a cron log nobody reads
# manufactures false confidence in the backups. Set ALERT_WEBHOOK_URL (the same
# incoming webhook the services use, packages/platform/.../error-alerter.ts) and any
# drill failure POSTs to it. Unset = local log only (fine for a manual run).
set -euo pipefail

# Cron runs this with an absolute path from an arbitrary cwd; the compose helpers resolve
# their config relative to the repo root.
cd "$(dirname "$0")/.."
. scripts/lib/deploy-common.sh
. scripts/lib/backup-report.sh

CONTAINER="${PG_CONTAINER:-hydromart-postgres}"
PG_USER="${PG_USER:-hydromart}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hydromart}"

# Fire-and-forget alert to the shared webhook, mirroring error-alerter.ts's payload
# ({text} for Slack, {content} for Discord — one URL works for either). No-op when
# ALERT_WEBHOOK_URL is blank. ponytail: message is a controlled literal (no quotes,
# no untrusted data), so it's inlined into the JSON directly — add real escaping only
# if this ever interpolates a dump path or error string.
alert(){
  local url="${ALERT_WEBHOOK_URL:-}"
  [ -z "$url" ] && return 0
  local host text
  host="$(hostname 2>/dev/null || echo host)"
  text="🚨 Hydromart restore drill FAILED on ${host}: $1. Backups are UNVERIFIED until this passes."
  curl -fsS -m 10 -X POST -H 'content-type: application/json' \
    --data "{\"text\":\"${text}\",\"content\":\"${text}\"}" "$url" >/dev/null 2>&1 || true
}

MODE="${1:-}"
DUMP="${2:-}"
SCRATCH="hydromart-restore-drill"

# In --drill mode, one EXIT trap covers the WHOLE run (missing dump, corrupt gzip,
# restore mismatch — all of it): tear down the scratch container and, on any non-zero
# exit, alert. Registered here (before the dump checks below) so those failures alert
# too. ponytail: generic message + exit code; the detail is in the drill log the alert
# tells you to read — richer per-failure messages aren't worth threading through.
if [ "$MODE" = "--drill" ]; then
  trap 'rc=$?; docker rm -f "$SCRATCH" >/dev/null 2>&1 || true; if [ "$rc" -ne 0 ]; then alert "drill exited $rc, check the drill log"; report_backup_run DRILL FAILED "drill exited $rc, see the drill log"; fi; exit $rc' EXIT
fi

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
    # Scratch teardown + failure alert are handled by the EXIT trap set above.
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

    # H-36 — the old drill stopped at "at least one database called hydromart* now
    # exists". A dump that restored the CREATE DATABASE statements and nothing else
    # passed that, which is how an unusable backup earns a green tick every week.
    #
    # What is checked now, per database, against the LIVE cluster:
    #   1. the database exists in the restore at all
    #   2. it has the same number of public tables      -> the schema came back
    #   3. it has the same number of applied migrations -> at the same schema version
    #   4. its largest live table has rows in the restore -> DATA came back, not just DDL
    #
    # Live is the reference because a dump is by definition older than live. Every check
    # is therefore "restored matches live" for structure and "restored is non-empty" for
    # data — never an exact row count, which ordinary traffic would fail.
    live(){ docker exec "$CONTAINER" psql -tAX -U "$PG_USER" -d "$1" -c "$2" 2>/dev/null | tr -d '[:space:]'; }
    scratch(){ docker exec "$SCRATCH" psql -tAX -U "$PG_USER" -d "$1" -c "$2" 2>/dev/null | tr -d '[:space:]'; }

    TABLES_SQL="SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
    MIGRATIONS_SQL="SELECT count(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL;"
    # reltuples is the planner's estimate, kept roughly current by autovacuum — good
    # enough to pick a table worth probing, and it costs production no sequential scan.
    BIGGEST_SQL="SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.reltuples > 0 ORDER BY c.reltuples DESC LIMIT 1;"

    LIVE_DBS="$(docker exec "$CONTAINER" psql -tAX -U "$PG_USER" -d postgres -c "SELECT datname FROM pg_database WHERE datname LIKE 'hydromart%' ORDER BY datname;" 2>/dev/null | tr -d '\r')"
    if [ -z "$LIVE_DBS" ]; then
      echo "ERROR: the LIVE cluster reports no hydromart databases — nothing to verify a restore against" >&2
      exit 1
    fi

    DRILL_FAIL=0
    CHECKED=0
    PROBED=""
    for db in $LIVE_DBS; do
      CHECKED=$((CHECKED + 1))
      if [ "$(scratch postgres "SELECT count(*) FROM pg_database WHERE datname='$db';")" != "1" ]; then
        echo "  ❌ $db: missing from the restore" >&2; DRILL_FAIL=1; continue
      fi

      lt="$(live "$db" "$TABLES_SQL")"; st="$(scratch "$db" "$TABLES_SQL")"
      if [ "${st:-0}" != "${lt:-0}" ]; then
        echo "  ❌ $db: ${st:-0} tables restored, live has ${lt:-0}" >&2; DRILL_FAIL=1; continue
      fi

      lm="$(live "$db" "$MIGRATIONS_SQL")"; sm="$(scratch "$db" "$MIGRATIONS_SQL")"
      if [ "${sm:-0}" != "${lm:-0}" ]; then
        echo "  ❌ $db: ${sm:-0} applied migrations restored, live has ${lm:-0}" >&2; DRILL_FAIL=1; continue
      fi

      # Data probe. An empty database is a legitimate state for a service nobody has used
      # yet, so it is SKIPPED — never counted as a pass that proves data survived.
      big="$(live "$db" "$BIGGEST_SQL")"
      if [ -z "$big" ]; then
        echo "  ➖ $db: ${lt:-0} tables, no rows live — nothing to probe"
        continue
      fi
      rows="$(scratch "$db" "SELECT count(*) FROM \"$big\";")"
      if [ "${rows:-0}" -lt 1 ]; then
        echo "  ❌ $db: $big is EMPTY in the restore but has rows live — schema restored, data did not" >&2
        DRILL_FAIL=1; continue
      fi
      echo "  ✅ $db: ${lt:-0} tables, ${lm:-0} migrations, $big has $rows rows"
      PROBED="$PROBED $big=$rows"
    done

    if [ "$DRILL_FAIL" -ne 0 ]; then
      echo "ERROR: $DUMP does not restore to a usable copy of the live cluster — see the failures above" >&2
      exit 1
    fi
    SUMMARY="$CHECKED databases verified against live;$PROBED"
    echo "drill OK: $DUMP restores to a usable cluster ($SUMMARY)"
    report_backup_run DRILL OK "$SUMMARY"
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
