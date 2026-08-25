#!/usr/bin/env bash
# L1.7 — read the query plans on the data volume that actually exists.
#
# An empty database answers every question with a sequential scan over nothing, and it looks
# instant. An older audit was fooled by exactly that: indexes were "verified" against a
# database with no rows, so nothing it concluded was about production. Plans only mean
# something on production-sized data, which means running this ON the box, READ-ONLY.
#
#   ssh hydromart@<host> 'cd <repo> && bash scripts/explain-hot-queries.sh'
#   bash scripts/explain-hot-queries.sh order    # one service's database only
#
# Every statement below is a SELECT wrapped in EXPLAIN, inside a READ ONLY transaction. It
# cannot write, and `EXPLAIN` without `ANALYZE` does not even execute the query — so this is
# safe to run during business hours.
#
# What to look for, in order:
#   * `Seq Scan` on a table with more than a few thousand rows
#   * `rows=` in the plan being wildly different from reality (stale statistics -> ANALYZE)
#   * a sort that spills (`external merge Disk`)
set -euo pipefail
cd "$(dirname "$0")/.."

PG_CONTAINER="${PG_CONTAINER:-hydromart-postgres}"
PG_USER="${PG_USER:-hydromart}"
ONLY="${1:-}"

run() {
  local db="$1" label="$2" sql="$3"
  [ -n "$ONLY" ] && [ "$db" != "hydromart_$ONLY" ] && return 0
  echo
  echo "== $db · $label"
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$db" -X -q \
    -c "BEGIN READ ONLY;" -c "EXPLAIN $sql" -c "COMMIT;" 2>&1 |
    grep -vE '^(BEGIN|COMMIT)$' || echo "   (query failed — the shape may have moved; fix it here)"
}

echo "Row counts first — a plan on an empty table is not evidence."
for db in hydromart_order hydromart_customer hydromart_delivery hydromart_crm; do
  [ -n "$ONLY" ] && [ "$db" != "hydromart_$ONLY" ] && continue
  echo
  echo "== $db"
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$db" -X -q -c "
    SELECT relname AS table, n_live_tup AS rows
      FROM pg_stat_user_tables
     WHERE n_live_tup > 0
     ORDER BY n_live_tup DESC
     LIMIT 12;" 2>&1 || true
done

# The four reads that run on every screen somebody keeps open. Kept as literal SQL rather
# than generated from Prisma: the point is to see the plan the DATABASE makes, and a
# generated query would hide the shape behind an ORM's choices.
run hydromart_order "depot order queue (newest first)" \
  "SELECT * FROM orders WHERE \"depotId\" IS NOT NULL ORDER BY \"createdAt\" DESC LIMIT 20;"

run hydromart_order "one customer's order history" \
  "SELECT * FROM orders WHERE \"customerId\" = '00000000-0000-4000-8000-000000000001' ORDER BY \"createdAt\" DESC LIMIT 20;"

run hydromart_customer "depot CRM customer list" \
  "SELECT * FROM customer_profiles WHERE \"favoriteDepotId\" IS NOT NULL LIMIT 50;"

run hydromart_delivery "courier's open deliveries" \
  "SELECT * FROM deliveries WHERE status <> 'COMPLETED' ORDER BY \"createdAt\" DESC LIMIT 50;"

run hydromart_crm "customer notification inbox" \
  "SELECT * FROM notifications WHERE \"customerId\" = '00000000-0000-4000-8000-000000000001' ORDER BY \"createdAt\" DESC LIMIT 30;"

echo
echo "Done. A Seq Scan over a table with thousands of rows is the finding; a Seq Scan over"
echo "an empty one is the instrument lying, and the row counts above say which you are"
echo "looking at."
