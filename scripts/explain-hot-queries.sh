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

FAILED=0

run() {
  local db="$1" label="$2" sql="$3"
  [ -n "$ONLY" ] && [ "$db" != "hydromart_$ONLY" ] && return 0
  echo
  echo "== $db · $label"
  local out
  out="$(docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$db" -X -q \
    -c "BEGIN READ ONLY;" -c "EXPLAIN $sql" -c "COMMIT;" 2>&1 |
    grep -vE '^(BEGIN|COMMIT)$' || true)"
  echo "$out"
  # psql's exit status is swallowed by the pipe, and the `|| echo "(query failed)"` this
  # replaces tested GREP — which succeeds precisely when there IS an ERROR line to print.
  # So the delivery probe asked for a DeliveryStatus value that has never existed
  # (`COMPLETED`; the terminal states are DELIVERED and FAILED), printed its ERROR in plain
  # sight, and this script still exited 0 on every run it has ever had.
  if printf '%s' "$out" | grep -q '^ERROR:'; then
    FAILED=$((FAILED + 1))
    echo "   ^^ this probe never ran. Its query shape has moved; fix it here."
  fi
}

MAXROWS=0

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
  n="$(docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$db" -X -tAq \
    -c "SELECT COALESCE(MAX(n_live_tup), 0) FROM pg_stat_user_tables;" 2>/dev/null || echo 0)"
  case "$n" in *[!0-9]* | '') n=0 ;; esac
  [ "$n" -gt "$MAXROWS" ] && MAXROWS="$n"
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
  "SELECT * FROM deliveries WHERE status NOT IN ('DELIVERED', 'FAILED') ORDER BY \"createdAt\" DESC LIMIT 50;"

run hydromart_crm "customer notification inbox" \
  "SELECT * FROM notifications WHERE \"customerId\" = '00000000-0000-4000-8000-000000000001' ORDER BY \"createdAt\" DESC LIMIT 30;"

echo
echo "Done. A Seq Scan over a table with thousands of rows is the finding; a Seq Scan over"
echo "an empty one is the instrument lying, and the row counts above say which you are"
echo "looking at."

# L1.7's actual requirement is "measured on production VOLUME", and the volume is a fact
# about the day you run this, not about the script. On 2026-08-26 the largest table held
# 136 rows: every plan above was a sequential scan, every one of them was CORRECT — a seq
# scan over 11 rows is the fastest plan there is — and none of them said anything about how
# this database behaves under load. That run could be read as "no findings", which is the
# same shape of mistake as the older audit this script was written to prevent.
#
# So the script says so itself, every time, instead of leaving it to whoever remembers.
EVIDENCE_FLOOR="${EVIDENCE_FLOOR:-1000}"
if [ "$MAXROWS" -lt "$EVIDENCE_FLOOR" ]; then
  echo
  echo "NOT A MEASUREMENT — the largest table probed holds $MAXROWS rows (floor: $EVIDENCE_FLOOR)."
  echo "Postgres chooses a sequential scan over a small table because that IS the fastest"
  echo "plan, so nothing above is evidence about production behaviour. L1.7 is not closed by"
  echo "this run. It is closed by running it again once real traffic has filled these tables."
fi

if [ "$FAILED" -gt 0 ]; then
  echo
  echo "$FAILED probe(s) never ran, so the plans above are not the whole picture."
  exit 1
fi
