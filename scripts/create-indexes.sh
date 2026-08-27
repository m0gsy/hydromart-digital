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
delivery|deliveries_customerId_createdAt_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "deliveries_customerId_createdAt_idx" ON "deliveries"("customerId", "createdAt" DESC)
order|orders_customerId_createdAt_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_customerId_createdAt_idx" ON "orders"("customerId", "createdAt")
order|orders_subscriptionId_createdAt_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_subscriptionId_createdAt_idx" ON "orders"("subscriptionId", "createdAt")
order|orders_status_statusChangedAt_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_status_statusChangedAt_idx" ON "orders"("status", "statusChangedAt")
payment|payments_cashierShiftId_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_cashierShiftId_idx" ON "payments"("cashierShiftId")
depot|stock_movements_itemId_createdAt_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "stock_movements_itemId_createdAt_idx" ON "stock_movements"("itemId", "createdAt")
depot|stock_movements_type_createdAt_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "stock_movements_type_createdAt_idx" ON "stock_movements"("type", "createdAt")
depot|gallon_issues_orderId_key|CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "gallon_issues_orderId_key" ON "gallon_issues"("orderId")
customer|customer_profiles_favoriteDepotId_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "customer_profiles_favoriteDepotId_idx" ON "customer_profiles"("favoriteDepotId")
customer|reseller_price_changes_customerId_createdAt_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "reseller_price_changes_customerId_createdAt_idx" ON "reseller_price_changes"("customerId", "createdAt" DESC)
customer|reseller_price_changes_appliedAt_effectiveAt_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "reseller_price_changes_appliedAt_effectiveAt_idx" ON "reseller_price_changes"("appliedAt", "effectiveAt")
crm|notifications_event_createdAt_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "notifications_event_createdAt_idx" ON "notifications"("event", "createdAt")
crm|campaigns_scheduledFor_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "campaigns_scheduledFor_idx" ON "campaigns"("scheduledFor") WHERE "scheduledFor" IS NOT NULL
admin|scheduled_reports_enabled_nextRunAt_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "scheduled_reports_enabled_nextRunAt_idx" ON "scheduled_reports"("enabled", "nextRunAt")
forecast|service_settings_scope_depot_id_idx|CREATE INDEX CONCURRENTLY IF NOT EXISTS "service_settings_scope_depot_id_idx" ON "service_settings"("scope", "depot_id")
forecast|service_settings_global_key_key|CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "service_settings_global_key_key" ON "service_settings"("key") WHERE "scope" = 'GLOBAL'
forecast|service_settings_depot_key_key|CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "service_settings_depot_key_key" ON "service_settings"("depot_id", "key") WHERE "scope" = 'DEPOT'
'

# One rule, one place. It lived in two places for exactly one deploy, and in that deploy the
# loop skipped three indexes correctly while the end-state re-check called the same three
# MISSING and failed the release. Two copies of a rule is how you fix half a bug.
#
# "The table does not exist yet" means the migration that creates the table creates this
# index with it: nothing to pre-build, nothing to lock, nothing missing.
table_absent() {
  _ta_db="$1"
  # The backreference is \1. It was a raw 0x01 byte from #186 until 27 Aug 2026 — sed
  # substituted a control character in, every table name came back as that byte, no table
  # was ever found, and so EVERY index took the "its table does not exist yet" branch:
  # nothing was ever pre-built and the end-state re-check could never report anything
  # MISSING. The script exited 0 for five months without doing its job.
  _ta_table="$(printf '%s' "$2" | sed -n 's/.* ON "\([^"]*\)".*/\1/p')"
  [ -n "$_ta_table" ] || return 1
  _ta_found="$(psql_do "$_ta_db" "SELECT 1 FROM information_schema.tables WHERE table_name='$_ta_table';" | tr -d '[:space:]')"
  [ "$_ta_found" != "1" ]
}

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

  # One rule, everywhere: "present" means present AND valid (DB-1).
  present="$(psql_do "$db" "SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = '$idx' AND i.indisvalid;" | tr -d '[:space:]')"
  if [ "$present" = "1" ]; then
    ok "$db.$idx already present"
    continue
  fi

  # A brand-new TABLE cannot have its index pre-built, and does not need one.
  #
  # This script runs BEFORE the migration so the migration finds the index already there
  # and does not build it under a write lock. That reasoning only applies to a table that
  # already holds rows somebody is writing. When the same migration creates the table AND
  # its indexes, there is nothing here yet to lock — and the pre-build cannot even be
  # attempted: `relation "service_settings" does not exist`.
  #
  # That is not a reason to fail the deploy, which is what happened on 2026-08-17: three
  # such indexes aborted the whole release before a single container was touched. Skipped,
  # named, and left to the migration that owns the table.
  if table_absent "$db" "$stmt"; then
    ok "$db.$idx skipped — its table does not exist yet; the migration that creates it owns this index"
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
#
# It applies the SAME new-table rule as the loop, and the deploy that shipped the loop's
# version of it proved why: the three service_settings indexes were correctly skipped —
# three ✅ lines in the log — and then this re-check called them MISSING and failed the
# release anyway. Half a fix reads exactly like no fix from the outside.
# DB-1 / MONEY-02: `pg_indexes` is NOT a validity check. A `CREATE UNIQUE INDEX
# CONCURRENTLY` that fails leaves the index behind marked `indisvalid = false` — and
# pg_indexes lists it exactly like a good one. Measured on a real Postgres: the failed
# build errors, `SELECT 1 FROM pg_indexes` still answers 1, `indisvalid` is `f`, and a
# duplicate INSERT then SUCCEEDS. So this re-check called an index that enforces nothing
# "present", exited 0, and the deploy went out on top of it.
#
# The loop above DOES notice invalidity — and its `FAIL=1` is thrown away by the subshell,
# which is the whole reason this end-state re-check exists. Half a rule again.
#
# What that buys, concretely: `gallon_issues_orderId_key` is in the table above. It is the
# only thing making the deposit-held booking idempotent, because Prisma's `upsert` is a
# SELECT-then-INSERT with no constraint behind it. Invalid index, green deploy, at-least-once
# completion fan-out — the depot books the same deposit twice.
MISSING="$(echo "$INDEXES" | while IFS='|' read -r db idx stmt; do
  [ -z "${db:-}" ] && continue
  got="$(psql_do "$db" "SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = '$idx' AND i.indisvalid;" | tr -d '[:space:]')"
  [ "$got" = "1" ] && continue
  table_absent "$db" "$stmt" && continue
  echo "$db.$idx"
done)"

echo "=============================="
if [ -n "$MISSING" ]; then
  echo "MISSING:"
  echo "$MISSING" | sed 's/^/  /'
  exit 1
fi
echo "All indexes present."
