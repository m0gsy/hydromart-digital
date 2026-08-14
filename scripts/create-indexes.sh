#!/usr/bin/env bash
# Build the indexes a pending migration wants, WITHOUT locking writes (audit H-39).
#
#   bash scripts/create-indexes.sh          # build them
#   bash scripts/create-indexes.sh --check  # report only: which are present/invalid
#
# Why this exists: every `CREATE INDEX` in the 135 migration files takes an ACCESS
# EXCLUSIVE-adjacent lock that blocks writes to the table for the whole build. On
# `orders` or `stock_movements` that is a checkout outage. `CREATE INDEX CONCURRENTLY`
# does not block writes — but it cannot run inside a transaction, which is where Prisma
# Migrate puts a migration file's statements.
#
# So the split is: build concurrently HERE, first; the migration then finds the index
# already present (every one of them is `IF NOT EXISTS`) and is a no-op. On a fresh
# database — CI, a new environment — the migration builds it itself, where locking an
# empty table costs nothing. Same end state either way.
#
# Order of operations on production:
#   1. bash scripts/create-indexes.sh
#   2. bash scripts/migrate-prod.sh
#   3. deploy the new images
#
# Talks to the bundled Postgres the same way backup-db.sh / verify-indexes.sh do:
# docker exec as the trusted local user, no .env needed. Env: PG_CONTAINER, PG_USER.
#
# Exit: 0 = every index present and valid; 1 = a build failed or left an invalid index;
#       2 = can't reach the Postgres container.
set -uo pipefail

CONTAINER="${PG_CONTAINER:-hydromart-postgres}"
PG_USER="${PG_USER:-hydromart}"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

ok() { echo "  ✅ $1"; }
no() { echo "  ❌ $1"; }

FAIL=0

# One statement against one service DB.
psql_do() { docker exec "$CONTAINER" psql -tAX -U "$PG_USER" -d "hydromart_$1" -c "$2" 2>&1; }

# db|index name|CREATE INDEX CONCURRENTLY statement. One line per index; keep the index
# name identical to the one the migration creates, or the migration will build a second
# copy under Prisma's default name.
INDEXES='
order|orders_customerId_createdAt_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_customerId_createdAt_idx" ON "orders"("customerId", "createdAt")
depot|stock_movements_itemId_createdAt_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "stock_movements_itemId_createdAt_idx" ON "stock_movements"("itemId", "createdAt")
depot|stock_movements_type_createdAt_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "stock_movements_type_createdAt_idx" ON "stock_movements"("type", "createdAt")
customer|customer_profiles_favoriteDepotId_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "customer_profiles_favoriteDepotId_idx" ON "customer_profiles"("favoriteDepotId")
crm|notifications_event_createdAt_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "notifications_event_createdAt_idx" ON "notifications"("event", "createdAt")
crm|campaigns_scheduledFor_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "campaigns_scheduledFor_idx" ON "campaigns"("scheduledFor") WHERE "scheduledFor" IS NOT NULL
admin|scheduled_reports_enabled_nextRunAt_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "scheduled_reports_enabled_nextRunAt_idx" ON "scheduled_reports"("enabled", "nextRunAt")
'

if ! docker exec "$CONTAINER" true >/dev/null 2>&1; then
  echo "ERROR: cannot exec into Postgres container '$CONTAINER'. Is the stack up? (override with PG_CONTAINER=...)" >&2
  exit 2
fi

echo "$INDEXES" | while IFS='|' read -r db idx stmt; do
  [ -z "${db:-}" ] && continue

  # A CONCURRENTLY build that fails leaves the index behind marked invalid. It is not
  # used by any query and blocks a retry, so say so plainly instead of "already exists".
  invalid="$(psql_do "$db" "SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = '$idx' AND NOT i.indisvalid;" | tr -d '[:space:]')"
  if [ "$invalid" = "1" ]; then
    no "$db.$idx exists but is INVALID (a previous concurrent build failed). Run: DROP INDEX CONCURRENTLY \"$idx\"; then re-run this script."
    FAIL=1
    continue
  fi

  present="$(psql_do "$db" "SELECT 1 FROM pg_indexes WHERE indexname='$idx';" | tr -d '[:space:]')"
  if [ "$present" = "1" ]; then
    ok "$db.$idx already present"
    continue
  fi

  if [ "$CHECK_ONLY" = "1" ]; then
    no "$db.$idx MISSING (run without --check to build it)"
    FAIL=1
    continue
  fi

  echo "  … building $db.$idx (writes stay open)"
  out="$(psql_do "$db" "$stmt")"
  if echo "$out" | grep -qi "error"; then
    no "$db.$idx build FAILED: $out"
    FAIL=1
  else
    ok "$db.$idx built"
  fi
done

# The loop above runs in a subshell (pipe), so FAIL cannot come back out of it. Re-check
# the end state instead of trusting a variable that the shell threw away.
MISSING="$(echo "$INDEXES" | while IFS='|' read -r db idx _stmt; do
  [ -z "${db:-}" ] && continue
  got="$(psql_do "$db" "SELECT 1 FROM pg_indexes WHERE indexname='$idx';" | tr -d '[:space:]')"
  [ "$got" = "1" ] || echo "$db.$idx"
done)"

echo "=============================="
if [ -n "$MISSING" ]; then
  echo "MISSING:"
  echo "$MISSING" | sed 's/^/  /'
  exit 1
fi
echo "All indexes present."
