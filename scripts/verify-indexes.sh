#!/usr/bin/env bash
# Read-only check that the production Postgres actually HAS the audit's indexes
# (T1 — the DB-1/DB-2/DB-11 migrations exist in the repo but nothing proves they
# reached live PG; the audit noted "not yet applied to live PG").
#
#   bash scripts/verify-indexes.sh
#
# For every partial UNIQUE index it ALSO checks whether current data already
# violates the constraint. That matters: those indexes are CREATE UNIQUE INDEX,
# so if live data has (e.g.) a customer with 2 primary addresses, db:migrate:prod
# will FAIL mid-run when Postgres tries to build the index. You want to know that
# BEFORE migrating, not during. Run this before `npm run db:migrate:prod`.
#
# Read-only: issues only SELECT against pg_indexes and the data tables. No writes,
# no DDL. Safe to run against production.
#
# Talks to the bundled Postgres the same way backup-db.sh / restore-db.sh do —
# docker exec into the container as the trusted local user, so no .env /
# POSTGRES_PASSWORD needed. Env overrides: PG_CONTAINER, PG_USER.
#
# Exit: 0 = all indexes present and data clean; 1 = something missing or dirty;
#       2 = can't reach the Postgres container.
#
#   bash scripts/verify-indexes.sh --preflight
#
# Same checks, but a MISSING index is reported and does NOT fail — that is the normal
# state right before the migration that creates it, and migrate-prod.sh runs this on
# every migration. Only DIRTY data fails, because dirty data is what makes a
# CREATE UNIQUE INDEX abort halfway through `prisma migrate deploy`.
set -uo pipefail

CONTAINER="${PG_CONTAINER:-hydromart-postgres}"
PG_USER="${PG_USER:-hydromart}"
PREFLIGHT=0
[ "${1:-}" = "--preflight" ] && PREFLIGHT=1

ok(){ echo "  ✅ $1"; }
no(){ echo "  ❌ $1"; }

FAIL=0

# Reach a service DB and run one query, tuples-only/unaligned/no-.psqlrc.
q(){ docker exec "$CONTAINER" psql -tAX -U "$PG_USER" -d "hydromart_$1" -c "$2" 2>/dev/null | tr -d '[:space:]'; }

# index_exists <svc> <indexname>  -> ok/no, bumps FAIL if missing
index_exists(){
  local svc="$1" idx="$2" got
  # DB-1: `indisvalid`, not pg_indexes. A CONCURRENTLY build that failed leaves an INVALID
  # index behind that pg_indexes reports exactly like a good one and that enforces nothing
  # — measured. Every index below is here because something depends on it holding.
  got="$(q "$svc" "SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = '$idx' AND i.indisvalid;")"
  if [ "$got" = "1" ]; then ok "$svc.$idx present"; return 0; fi
  no "$svc.$idx MISSING or INVALID — migration not applied to hydromart_$svc, or a concurrent build failed"
  [ "$PREFLIGHT" = "1" ] || FAIL=1
  return 1
}

# data_clean <svc> <label> <count-query>  -> ok/no, bumps FAIL if data violates
data_clean(){
  local svc="$1" label="$2" sql="$3" n
  n="$(q "$svc" "$sql")"
  n="${n:-0}"
  if [ "$n" = "0" ]; then ok "$svc data clean: $label"; return 0; fi
  no "$svc DIRTY: $label ($n violating group(s)) — db:migrate:prod will FAIL building this unique index unless it is already present"; FAIL=1; return 1
}

# Container reachable? Bail clearly rather than emit a wall of confusing failures.
if ! docker exec "$CONTAINER" true >/dev/null 2>&1; then
  echo "ERROR: cannot exec into Postgres container '$CONTAINER'. Is the stack up? (override with PG_CONTAINER=...)" >&2
  exit 2
fi

echo "== payment =="
index_exists payment payments_one_active_per_order
data_clean  payment "one active payment per order" \
  "SELECT count(*) FROM (SELECT \"orderId\" FROM payments WHERE status IN ('PENDING','PAID') GROUP BY \"orderId\" HAVING count(*)>1) t;"

echo "== customer =="
index_exists customer addresses_one_primary_per_customer
data_clean  customer "one primary address per customer" \
  "SELECT count(*) FROM (SELECT \"customerId\" FROM addresses WHERE \"isPrimary\" GROUP BY \"customerId\" HAVING count(*)>1) t;"
index_exists customer saved_payment_methods_one_default_per_customer
data_clean  customer "one default payment method per customer" \
  "SELECT count(*) FROM (SELECT \"customerId\" FROM saved_payment_methods WHERE \"isDefault\" GROUP BY \"customerId\" HAVING count(*)>1) t;"

echo "== depot =="
index_exists depot inventory_items_depotId_itemType_singleton_key
data_clean  depot "one singleton inventory row per (depot,itemType)" \
  "SELECT count(*) FROM (SELECT \"depotId\",\"itemType\" FROM inventory_items WHERE \"productId\" IS NULL GROUP BY \"depotId\",\"itemType\" HAVING count(*)>1) t;"

echo "== order =="
index_exists order orders_createdAt_idx
index_exists order orders_status_createdAt_idx
index_exists order orders_depotId_createdAt_idx

echo "== delivery =="
index_exists delivery deliveries_deliveredAt_idx
index_exists delivery deliveries_depotId_deliveredAt_idx

echo
if [ "$FAIL" -eq 0 ]; then
  if [ "$PREFLIGHT" = "1" ]; then
    echo "PREFLIGHT PASS — no live row violates a constraint a pending migration builds."
    echo "                 (A ❌ MISSING above is expected here: that is what it is about to create.)"
  else
    echo "PASS — all audit indexes present and data is clean. Safe to run db:migrate:prod."
  fi
  exit 0
fi
echo "FAIL — see ❌ above. A MISSING index means the migration never reached live PG."
echo "       A DIRTY result means you must resolve the duplicate rows first, or the"
echo "       unique-index migration will abort partway through db:migrate:prod."
exit 1
