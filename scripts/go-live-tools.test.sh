#!/usr/bin/env bash
# The runnable check for scripts/go-live-report.sh and scripts/reset-test-data.sh.
#
#   bash scripts/go-live-tools.test.sh
#
# Both scripts are run by a person, once, against production — the worst possible place to find
# out that a query was wrong. So they are run here against a throwaway Postgres carrying the
# REAL schema (every service's migration.sql applied in order) and a small fixture
# (scripts/lib/go-live-fixture.sql): one fully set-up depot, one with nothing entered, one demo
# fixture, and rows in every table the reset touches and in the ones it must not.
#
# Skips (exit 0) when there is no Docker daemon or the Postgres image cannot be pulled, and says
# so — a check that cannot run must say it did not run.
set -uo pipefail
# CI invokes this as `bash -e file`; the negative cases below are SUPPOSED to exit non-zero.
set +e
cd "$(dirname "$0")/.."
ROOT="$PWD"

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

echo "go-live tools:"

# --------------------------------------------------------------------------- static checks
# The reset's table list must be REAL tables. A typo would only surface on the box, as
# "absent" in a dry run nobody reads closely.
PLAN_TABLES="$(sed -n '/^PLAN=(/,/^)/p' scripts/reset-test-data.sh | grep -oE '"[a-z]+:[a-z_,]+"' | tr -d '"')"
LEDGER_TABLES="$(grep -oE 'PLAN\+=\("[a-z]+:[a-z_,]+"' scripts/reset-test-data.sh | grep -oE '[a-z]+:[a-z_,]+')"
missing=""
for entry in $PLAN_TABLES $LEDGER_TABLES; do
  db="${entry%%:*}"
  for t in $(echo "${entry#*:}" | tr ',' ' '); do
    grep -q "@@map(\"$t\")" "services/$db-service/prisma/schema.prisma" || missing="$missing $db.$t"
  done
done
[ -z "$missing" ] && ok "every table the reset names exists in its service's schema" ||
  bad "the reset names tables no schema declares:$missing"

# Nothing that is not an order-lifecycle row may appear in the list.
protected='customers|depots|products|employees|inventory_items|audit_logs|service_settings|vouchers|stock_movements|addresses|categories'
if printf '%s\n' "$PLAN_TABLES" | tr ',:' '\n\n' | grep -qxE "$protected"; then
  bad "the reset lists a protected table: $(printf '%s\n' "$PLAN_TABLES" | tr ',:' '\n\n' | grep -xE "$protected" | tr '\n' ' ')"
else
  ok "no account, depot, catalogue, employee, setting or audit table is in the reset"
fi

# It clears with TRUNCATE and the one reserved-stock UPDATE; a DELETE or DROP is not in it.
if grep -vE '^\s*#' scripts/reset-test-data.sh | grep -qiE 'delete from|drop (table|database)'; then
  bad "the reset contains a DELETE or DROP"
else
  ok "the reset only truncates the listed tables and zeroes reserved stock"
fi

# The report must never write.
if grep -vE '^\s*#' scripts/go-live-report.sh | grep -qiE '\b(insert|update|delete|truncate|drop|alter)\b[^"'"'"']*(into|set|from|table)'; then
  bad "go-live-report.sh contains a statement that writes"
else
  ok "go-live-report.sh contains no writing statement"
fi

# --------------------------------------------------------------------------- the database
if ! docker version >/dev/null 2>&1; then
  echo "  SKIPPED — no Docker daemon, so the scripts cannot be run against a real schema here."
  [ "$fails" -eq 0 ] && { echo "go-live tools: static checks passed"; exit 0; } || exit 1
fi

PG="hm-golive-test-$$"
cleanup() { docker rm -f "$PG" >/dev/null 2>&1; }
trap cleanup EXIT

if ! docker run -d --name "$PG" -e POSTGRES_USER=hydromart -e POSTGRES_PASSWORD=x postgres:16-alpine >/dev/null 2>&1; then
  echo "  SKIPPED — could not start postgres:16-alpine (no image and no network?)."
  [ "$fails" -eq 0 ] && { echo "go-live tools: static checks passed"; exit 0; } || exit 1
fi
# The image starts a TEMPORARY server to run its init step, answers pg_isready, then shuts it
# down and starts the real one. Creating databases in that gap fails with "server closed the
# connection unexpectedly" (it did, on the CI runner). The line below is printed only once the
# real server is about to start, and the count of "ready to accept connections" reaches two.
for _ in $(seq 1 90); do
  if docker logs "$PG" 2>&1 | grep -q 'PostgreSQL init process complete' &&
    [ "$(docker logs "$PG" 2>&1 | grep -c 'ready to accept connections')" -ge 2 ] &&
    docker exec "$PG" pg_isready -U hydromart >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

psql_() { docker exec "$PG" psql -tAqU hydromart -d "hydromart_$1" -c "$2" 2>&1; }

# The real schema: every service's migrations, in directory order, straight through psql.
for svc in auth customer product order payment delivery depot loyalty promo referral crm recommendation forecast payout admin hr; do
  docker exec "$PG" psql -qU hydromart -d postgres -c "create database hydromart_$svc" >/dev/null
  for dir in $(ls "services/$svc-service/prisma/migrations" | grep -E '^[0-9]' | sort); do
    file="services/$svc-service/prisma/migrations/$dir/migration.sql"
    [ -f "$file" ] && docker exec -i "$PG" psql -qU hydromart -d "hydromart_$svc" < "$file" >/dev/null 2>&1
  done
done
if ! docker exec -i "$PG" psql -qU hydromart -d postgres -v ON_ERROR_STOP=1 < scripts/lib/go-live-fixture.sql >/dev/null 2>"$ROOT/.fixture.err"; then
  bad "the fixture no longer loads against the migrations: $(head -2 "$ROOT/.fixture.err" | tr '\n' ' ')"
  rm -f "$ROOT/.fixture.err"
  exit 1
fi
rm -f "$ROOT/.fixture.err"
ok "the real schema (16 databases) and the fixture loaded"

export PG_CONTAINER="$PG" RESET_BACKUP_CMD=true

# ------------------------------------------------------------------------------- the report
REPORT="$(bash scripts/go-live-report.sh 2>&1)"
has() { printf '%s' "$REPORT" | grep -qF -- "$1"; }
hasnt() { ! printf '%s' "$REPORT" | grep -qF -- "$1"; }

has "DEPOT-B has NO payment destination" && ok "report: a depot with no bank and no QRIS is flagged" || bad "report should flag DEPOT-B's payment destination"
has "DEPOT-B has no opening hours" && ok "report: a depot with no hours is flagged" || bad "report should flag DEPOT-B's hours"
has "DEPOT-B is a franchise depot with no owner" && ok "report: a franchise depot with no owner is flagged" || bad "report should flag DEPOT-B's owner"
has "DEPOT-B has NO commission scheme" && ok "report: a franchise depot with no commission scheme is flagged" || bad "report should flag DEPOT-B's commission"
has "DEPOT-B has NOBODY in HR" && ok "report: a depot nobody works at is flagged" || bad "report should flag DEPOT-B's staffing"
has "DEPOT-B has no sellable stock of AIR-19" && ok "report: a product with no stock at a depot is flagged" || bad "report should flag DEPOT-B's stock"
has "goldDiscountPct is stored as ZERO" && ok "report: a discount stored as zero is flagged" || bad "report should flag the zero discount"
has "pointExpirySweepEnabled is not 1" && ok "report: switched-off point expiry is flagged" || bad "report should flag point expiry"
has "nobody holds FINANCE" && ok "report: a head-office role nobody holds is flagged" || bad "report should flag FINANCE"
has "only one SUPER_ADMIN" && ok "report: a single SUPER_ADMIN is flagged" || bad "report should flag the single SUPER_ADMIN"
for clean in "DEPOT-A has NO" "DEPOT-A has no" "nobody holds SUPER_ADMIN" "no real active depot"; do
  hasnt "$clean" || bad "report wrongly flags: $clean"
done
ok "report: the fully set-up depot and the held role are not flagged"
has "DEMO-01 is ACTIVE" && ok "report: the demo depot is listed as a live fixture" || bad "report should list DEMO-01"
hasnt "DEMO-01  " && ok "  ...and is not counted among the real depots" || bad "DEMO-01 must not be a real depot"
hasnt "QUERY FAILED" && ok "report: every query ran" || bad "a report query failed: $(printf '%s' "$REPORT" | grep -m1 'QUERY FAILED')"
PG_CONTAINER=no-such-container bash scripts/go-live-report.sh >/dev/null 2>&1
[ "$?" = 2 ] && ok "report: exits 2 when it cannot reach Postgres, instead of printing an all-clear" || bad "unreachable Postgres must exit 2"

# --------------------------------------------------------------------------------- the reset
count_all() { echo "$(psql_ order 'select count(*) from orders')/$(psql_ payment 'select count(*) from payments')/$(psql_ loyalty 'select count(*) from loyalty_accounts')/$(psql_ depot 'select count(*) from stock_reservations')"; }
BEFORE="$(count_all)"
[ "$BEFORE" = "1/1/1/1" ] && ok "reset: the fixture holds one row in each cleared table" || bad "fixture counts unexpected: $BEFORE"

bash scripts/reset-test-data.sh >/dev/null 2>&1
[ "$?" = 0 ] && [ "$(count_all)" = "$BEFORE" ] && ok "reset: a dry run changes nothing" || bad "the dry run must not write"

bash scripts/reset-test-data.sh --execute >/dev/null 2>&1
[ "$?" = 1 ] && [ "$(count_all)" = "$BEFORE" ] && ok "reset: --execute without CONFIRM refuses" || bad "--execute must need CONFIRM"

CONFIRM=wrong bash scripts/reset-test-data.sh --execute >/dev/null 2>&1
[ "$?" = 1 ] && [ "$(count_all)" = "$BEFORE" ] && ok "reset: the wrong CONFIRM value refuses too" || bad "a wrong CONFIRM must refuse"

psql_ order "insert into orders (id,\"orderNumber\",\"customerId\",subtotal,\"deliveryFee\",discount,total,\"recipientName\",phone,\"addressLine\",city,\"updatedAt\") values ('99999999-0000-4000-8000-000000000002','ORD-NOW','66666666-0000-4000-8000-000000000001',1,0,0,1,'t','+62','x','y',now())" >/dev/null
OUT="$(CONFIRM=RESET-TEST-DATA bash scripts/reset-test-data.sh --execute 2>&1)"
[ "$?" = 1 ] && printf '%s' "$OUT" | grep -q "somebody is using the system" && [ "$(psql_ payment 'select count(*) from payments')" = 1 ] &&
  ok "reset: refuses while an order was placed in the last 15 minutes" || bad "a live system must be refused: $OUT"
psql_ order "delete from orders where \"orderNumber\"='ORD-NOW'" >/dev/null

BACKUP_FAIL="$(RESET_BACKUP_CMD=false CONFIRM=RESET-TEST-DATA bash scripts/reset-test-data.sh --execute 2>&1)"
[ "$?" = 1 ] && [ "$(count_all)" = "$BEFORE" ] && ok "reset: refuses when the backup fails (no way back means no reset)" || bad "a failed backup must stop the reset: $BACKUP_FAIL"

psql_ order "create table zz_ref(order_id uuid references orders(id))" >/dev/null
OUT="$(CONFIRM=RESET-TEST-DATA bash scripts/reset-test-data.sh --execute 2>&1)"
[ "$?" = 1 ] && [ "$(count_all)" = "$BEFORE" ] &&
  ok "reset: all or nothing — one database that cannot be cleared stops every one of them" || bad "a partial reset left the books inconsistent: $(count_all)"
psql_ order "drop table zz_ref" >/dev/null

CONFIRM=RESET-TEST-DATA bash scripts/reset-test-data.sh --execute >/dev/null 2>&1
[ "$?" = 0 ] && [ "$(count_all)" = "0/0/0/0" ] && ok "reset: clears the order lifecycle everywhere" || bad "the reset did not clear: $(count_all)"
[ "$(psql_ depot 'select coalesce(sum(reserved),0) from inventory_items')" = 0 ] &&
  ok "reset: releases the units test orders had reserved" || bad "reserved stock must be released"
[ "$(psql_ depot 'select sum(quantity) from inventory_items')" = 50 ] &&
  ok "reset: leaves stock QUANTITIES alone (the shelf is counted by a person)" || bad "quantities must not change"
KEPT="$(psql_ depot 'select count(*) from depots')/$(psql_ product 'select count(*) from products')/$(psql_ hr 'select count(*) from employees')/$(psql_ auth 'select count(*) from customers')/$(psql_ loyalty 'select count(*) from service_settings')"
[ "$KEPT" = "3/1/2/1/1" ] && ok "reset: depots, catalogue, employees, accounts and settings are untouched" || bad "configuration was disturbed: $KEPT"

if [ "$fails" -gt 0 ]; then
  echo "go-live tools: $fails check(s) failed" >&2
  exit 1
fi
echo "go-live tools: all checks passed"
