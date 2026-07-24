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

npm run db:migrate
