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
. scripts/lib/backup-dir.sh

CONTAINER="${PG_CONTAINER:-hydromart-postgres}"
PG_USER="${PG_USER:-hydromart}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"
# CMP-02: the directory that HOLDS dumps, not the one this script hoped they were in.
# backup-db.sh falls back to ~/backups whenever /var/backups needs root — which is every
# box where the deploy user is not root — so the weekly drill was looking somewhere the
# nightly job had never written, and failing for a reason that was not about the backups.
BACKUP_DIR="${BACKUP_DIR:-$(hydromart_backup_dir)}"

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
#
# `$SECONDS` is bash's own counter from the start of this script, and it is in the trap for
# the same reason it is in the success lines below: a drill that DIED after eleven minutes and
# one that died after eleven seconds are different incidents, and the log said neither.
if [ "$MODE" = "--drill" ]; then
  trap 'rc=$?; docker rm -f "$SCRATCH" >/dev/null 2>&1 || true; if [ "$rc" -ne 0 ]; then alert "drill exited $rc after ${SECONDS}s, check the drill log"; report_backup_run DRILL FAILED "drill exited $rc after ${SECONDS}s, see the drill log"; fi; exit $rc' EXIT
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

    # RTO — the number this whole file exists to produce, and the one it never recorded.
    #
    # `grep -n 'elapsed\|SECONDS' scripts/restore-db.sh` was EMPTY. So the weekly verdict in
    # /var/log/hydromart-restore-drill.log said a restore WORKED and never said how long the
    # business would be down for, and "how long does a recovery take" was answered from memory
    # by whoever happened to be awake. One number turns that from a guess into a fact.
    #
    # Two are recorded, because they answer different questions: RESTORE_SECONDS is the part a
    # real recovery pays (--into-prod runs exactly this pipeline), and $SECONDS at the end is
    # what the DRILL costs, which is what the weekly cron slot has to fit.
    echo "drill: restoring $DUMP ..."
    RESTORE_START=$SECONDS
    gunzip -c "$DUMP" | docker exec -i "$SCRATCH" psql -q -U "$PG_USER" -d postgres >/dev/null
    RESTORE_SECONDS=$((SECONDS - RESTORE_START))

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
    # `|| true` is load-bearing under `set -euo pipefail`. These are PROBES: a database with
    # no `_prisma_migrations` table is a legitimate answer of zero, and psql exits non-zero
    # for it. pipefail then propagates that through the pipe, `set -e` kills the script at
    # the assignment, and the `${lm:-0}` defaults written three lines down to handle exactly
    # this case were never reached — dead code guarding a crash that happened first. The
    # weekly drill would have died every week without naming a reason.
    live(){ docker exec "$CONTAINER" psql -tAX -U "$PG_USER" -d "$1" -c "$2" 2>/dev/null | tr -d '[:space:]' || true; }
    scratch(){ docker exec "$SCRATCH" psql -tAX -U "$PG_USER" -d "$1" -c "$2" 2>/dev/null | tr -d '[:space:]' || true; }

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
    # The duration goes into SUMMARY, not only into the echo: SUMMARY is what reaches
    # admin-service and /hq/retention, so the RTO is readable from the console rather than
    # only from a log file on the box.
    SUMMARY="restore took ${RESTORE_SECONDS}s, drill took ${SECONDS}s total; $CHECKED databases verified against live;$PROBED"
    echo "drill OK: $DUMP restores to a usable cluster — restore took ${RESTORE_SECONDS}s, drill took ${SECONDS}s total ($CHECKED databases verified against live;$PROBED)"
    report_backup_run DRILL OK "$SUMMARY"
    ;;

  --into-prod)
    if [ "${CONFIRM:-}" != "RESTORE" ]; then
      echo "REFUSING: this OVERWRITES the live cluster in container '$CONTAINER'." >&2
      echo "Re-run with CONFIRM=RESTORE to proceed:  CONFIRM=RESTORE $0 --into-prod $DUMP" >&2
      exit 1
    fi

    # CMP-01 — this branch used to be four lines and it printed "restore complete." whether
    # anything had been restored or not.
    #
    # The scenario it fails in is the only scenario it exists for. At 03:00 a bad deploy or
    # a mass delete has corrupted rows. The Postgres container and its volume are healthy,
    # so every database still EXISTS. On-call runs this. `CREATE DATABASE` fails "already
    # exists", every `COPY` into a populated table fails, and psql — which exits 0 unless
    # told otherwise — lets the pipeline finish. The script printed success. The corrupt
    # rows were still exactly where they were.
    #
    # Three things now stand between that and a green line:
    #   1. a NON-EMPTY target is refused up front, because restoring on top of live data
    #      is not a restore. DROP_EXISTING=YES drops the hydromart databases first, which
    #      is what an operator actually means at 03:00.
    #   2. every psql error is CAPTURED and counted. Roles are the one exception: a
    #      cluster-wide dump recreates them and `role "x" already exists` is expected and
    #      harmless, so it is filtered by name rather than by ignoring errors wholesale.
    #   3. the result is COUNTED afterwards — databases, tables, and rows. A restore that
    #      produced empty schemas and nothing else fails here rather than being reported.
    echo "checking the target cluster in '$CONTAINER' ..."
    EXISTING="$(docker exec "$CONTAINER" psql -tAX -U "$PG_USER" -d postgres       -c "SELECT datname FROM pg_database WHERE datname LIKE 'hydromart%' ORDER BY datname;"       2>/dev/null | tr -d '\r' || true)"

    if [ -n "$EXISTING" ]; then
      if [ "${DROP_EXISTING:-}" != "YES" ]; then
        echo "REFUSING: the target cluster already holds these databases:" >&2
        echo "$EXISTING" | sed 's/^/    /' >&2
        echo "" >&2
        echo "  Restoring on top of them is not a restore: CREATE DATABASE and every COPY" >&2
        echo "  would fail, and the data you are trying to replace would stay exactly where" >&2
        echo "  it is. Drop them as part of the restore with:" >&2
        echo "" >&2
        echo "    CONFIRM=RESTORE DROP_EXISTING=YES $0 --into-prod $DUMP" >&2
        exit 1
      fi
      echo "DROP_EXISTING=YES — dropping $(echo "$EXISTING" | wc -w) database(s) first ..."
      for db in $EXISTING; do
        docker exec "$CONTAINER" psql -qAX -U "$PG_USER" -d postgres           -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$db' AND pid <> pg_backend_pid();"           >/dev/null 2>&1 || true
        docker exec "$CONTAINER" psql -qAX -U "$PG_USER" -d postgres           -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$db\";" >/dev/null
        echo "  dropped $db"
      done
    fi

    echo "restoring $DUMP into PROD container '$CONTAINER' ..."
    RESTORE_START=$SECONDS
    ERRLOG="$(mktemp)"
    trap 'rm -f "$ERRLOG"' EXIT
    gunzip -c "$DUMP" | docker exec -i "$CONTAINER" psql -U "$PG_USER" -d postgres       >/dev/null 2>"$ERRLOG"
    RESTORE_SECONDS=$((SECONDS - RESTORE_START))

    # `role "x" already exists` is the one expected error in a cluster-wide dump: the roles
    # outlive the databases. Everything else is a statement that did NOT run.
    REAL_ERRORS="$(grep -c '^ERROR:' "$ERRLOG" 2>/dev/null || true)"
    BENIGN="$(grep -c '^ERROR:.*role .* already exists' "$ERRLOG" 2>/dev/null || true)"
    REAL_ERRORS=$(( ${REAL_ERRORS:-0} - ${BENIGN:-0} ))
    if [ "$REAL_ERRORS" -gt 0 ]; then
      echo "" >&2
      echo "ERROR: the restore reported $REAL_ERRORS error(s). NOTHING here is trustworthy:" >&2
      grep '^ERROR:' "$ERRLOG" | grep -v 'role .* already exists' | head -20 | sed 's/^/    /' >&2
      exit 1
    fi

    # What actually landed. Counted, per database, and printed — a restore is a claim about
    # ROWS, and this is the only place that claim can be checked.
    RESTORED="$(docker exec "$CONTAINER" psql -tAX -U "$PG_USER" -d postgres       -c "SELECT datname FROM pg_database WHERE datname LIKE 'hydromart%' ORDER BY datname;"       2>/dev/null | tr -d '\r')"
    if [ -z "$RESTORED" ]; then
      echo "ERROR: no hydromart database exists after the restore — nothing was restored." >&2
      exit 1
    fi

    TOTAL_ROWS=0
    DB_COUNT=0
    for db in $RESTORED; do
      DB_COUNT=$((DB_COUNT + 1))
      tables="$(docker exec "$CONTAINER" psql -tAX -U "$PG_USER" -d "$db"         -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"         2>/dev/null | tr -d '[:space:]')"
      if [ "${tables:-0}" -lt 1 ]; then
        echo "ERROR: $db restored with NO tables — the dump did not carry this database." >&2
        exit 1
      fi
      # Rows, summed over every public table. Slower than reltuples and correct: an estimate
      # is exactly the wrong instrument for the one moment somebody needs the truth.
      rows="$(docker exec "$CONTAINER" psql -tAX -U "$PG_USER" -d "$db" -c "
        SELECT COALESCE(sum(n), 0) FROM (
          SELECT (xpath('/row/c/text()', query_to_xml(
            format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name),
            false, true, '')))[1]::text::bigint AS n
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ) t;" 2>/dev/null | tr -d '[:space:]')"
      TOTAL_ROWS=$((TOTAL_ROWS + ${rows:-0}))
      echo "  ✅ $db: ${tables} tables, ${rows:-0} rows"
    done

    if [ "$TOTAL_ROWS" -lt 1 ]; then
      echo "ERROR: $DB_COUNT database(s) restored and ZERO rows in all of them." >&2
      echo "       That is a schema, not a recovery. Check the dump: gunzip -c $DUMP | head" >&2
      exit 1
    fi

    # The real RTO, measured on the real thing. At 03:00 this is the number somebody upstairs
    # is asking for, and until now the only honest answer was "we have never timed it".
    # RESTORE_SECONDS is the data-loading pipeline; $SECONDS also carries the drop and the
    # row-counting verification, which a recovery pays for too.
    echo "restore verified: $DB_COUNT databases, $TOTAL_ROWS rows total, 0 errors."
    echo "restore took ${RESTORE_SECONDS}s (${SECONDS}s including the drop and the verification)."
    echo "Restart the app services so they reconnect."
    # Deliberately not reported to admin-service: `kind` there is BACKUP|DRILL, and a real
    # recovery is neither. At 03:00 the operator is reading this output, not /hq/retention.
    ;;

  *)
    echo "usage: $0 --drill [dump.sql.gz]      # non-destructive tested-restore drill" >&2
    echo "       $0 --into-prod [dump.sql.gz]  # destructive real recovery (needs CONFIRM=RESTORE)" >&2
    exit 2
    ;;
esac
