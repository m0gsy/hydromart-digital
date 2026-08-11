#!/usr/bin/env bash
# Apply every service's Prisma migrations against the live compose Postgres.
# Replaces the 13 manual `export *_DATABASE_URL` lines: derives them all from
# POSTGRES_PASSWORD in .env. Run once per deploy from the repo root:
#
#   bash scripts/migrate-prod.sh
#
# Idempotent — already-applied migrations are no-ops.
set -euo pipefail
cd "$(dirname "$0")/.."

# Reads .env, never runs it — a secret pasted in as a raw multi-line PEM used to be executed
# by `. ./.env` and killed this script before a single migration was tried (2026-08-11).
. ./scripts/load-env.sh
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD not set in .env}"

# host = where Postgres is reachable: localhost when run on the host (default),
# or `postgres` when this script runs inside a container on the compose network.
HOST="${MIGRATE_DB_HOST:-localhost}"

# Each service owns DB hydromart_<svc>; the env var is <SVC>_DATABASE_URL.
for svc in auth customer product order payment delivery depot loyalty \
           promo referral crm recommendation forecast payout admin hr; do
  var="$(echo "$svc" | tr '[:lower:]' '[:upper:]')_DATABASE_URL"
  export "$var=postgresql://hydromart:${POSTGRES_PASSWORD}@${HOST}:5432/hydromart_${svc}?schema=public"
done

# H-33 — a migration is the least reversible thing this repo does, and this script had no
# backup step at all: the nightly dump could be 23 hours old when a migration ate data.
# deploy.sh sets MIGRATE_SKIP_BACKUP=1 because it already took one minutes earlier.
if [ "${MIGRATE_SKIP_BACKUP:-}" = "1" ]; then
  echo "[migrate] backup skipped — caller already took one"
else
  echo "[migrate] backing up first (a migration is not undoable without this)"
  bash scripts/backup-db.sh
fi

# B-11 preflight — the partial UNIQUE indexes are CREATE UNIQUE INDEX, so duplicate live
# rows make `prisma migrate deploy` abort PARTWAY: some services migrated, some not.
# --preflight only fails on dirty DATA; a missing index is expected here (it is what the
# pending migration is about to create). Exit 2 means the check itself could not run —
# advisory, not a reason to block a migration.
set +e
bash scripts/verify-indexes.sh --preflight
PREFLIGHT=$?
set -e
if [ "$PREFLIGHT" = "1" ]; then
  echo "[migrate] ABORTING: live data violates a constraint a pending migration builds." >&2
  echo "          Resolve the duplicate rows above first — migrating now aborts halfway." >&2
  exit 1
elif [ "$PREFLIGHT" != "0" ]; then
  echo "[migrate] !! could not preflight the schema (exit $PREFLIGHT) — continuing unverified" >&2
fi

# A migration that FAILED stays recorded, and Prisma then refuses every later one for that
# service with P3018 — so every subsequent deploy dies the same way, on an error that names
# neither the service nor the way out. That happened on 2026-08-07 (hr, the shift FK meeting
# a genuinely dangling row) and cost an hour of reading logs.
#
# Clearing that record is only safe when re-applying the file from scratch does the right
# thing. That is a property of the migration, not something a script can infer — so the
# migration DECLARES it, with a `-- RERUNNABLE:` line saying why. Marked ones are resolved
# here and re-applied below; everything else stops the deploy and prints the command, because
# an unmarked failure is a human's to look at.
PG_CONTAINER_NAME="${PG_CONTAINER:-hydromart-postgres}"
PG_USER_NAME="${PG_USER:-hydromart}"
STUCK=0
for svc in auth customer product order payment delivery depot loyalty promo referral            crm recommendation forecast payout admin hr; do
  failed="$(docker exec "$PG_CONTAINER_NAME" psql -tAX -U "$PG_USER_NAME"     -d "hydromart_${svc}"     -c "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL"     2>/dev/null || true)"
  [ -n "$failed" ] || continue
  while read -r m; do
    [ -n "$m" ] || continue
    sql="services/${svc}-service/prisma/migrations/${m}/migration.sql"
    reason="$(grep -m1 '^-- RERUNNABLE:' "$sql" 2>/dev/null || true)"
    if [ -n "$reason" ]; then
      echo "[migrate] ${svc}: clearing the failed record for ${m} and re-applying it"
      echo "[migrate]   ${reason}"
      npx prisma migrate resolve --rolled-back "$m"         --schema "services/${svc}-service/prisma/schema.prisma"
    else
      STUCK=1
      echo "[migrate] !! ${svc}: ${m} is recorded as FAILED and is not marked re-runnable." >&2
      echo "             Nothing new can apply to this service until it is cleared. Look at" >&2
      echo "             the data it choked on, then from this same shell:" >&2
      echo "               npx prisma migrate resolve --rolled-back ${m} \\" >&2
      echo "                 --schema services/${svc}-service/prisma/schema.prisma" >&2
    fi
  done <<EOF
$failed
EOF
done
[ "$STUCK" = 0 ] || { echo "[migrate] ABORTING: resolve the failed migration(s) above first." >&2; exit 1; }

npm run db:migrate
