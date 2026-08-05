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

[ -f .env ] || { echo "no .env in repo root — fill it first (see .env.production.example)" >&2; exit 1; }
set -a; . ./.env; set +a
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

npm run db:migrate
