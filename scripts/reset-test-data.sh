#!/usr/bin/env bash
# Clear the transactional data made while the system was being tested, before real customers.
#
#   bash scripts/reset-test-data.sh                                   # DRY RUN: counts only, writes nothing
#   CONFIRM=RESET-TEST-DATA bash scripts/reset-test-data.sh --execute # actually clears it
#   ... --with-ledgers                                                 # also the franchise/courier money ledgers
#
# Why this exists. Orders, payments and the rows derived from them are the FINANCIAL class:
# retention never purges them (ten years, admin-service retention.ts). A payment made while
# somebody was testing the checkout therefore stays in the books, in the reports and in every
# reconciliation for a decade unless it is removed deliberately — once, before launch.
#
# What it clears — the order lifecycle, nothing else:
#   order        orders, their items and history, reviews, the outbox, carts, subscriptions
#   payment      payments
#   delivery     deliveries, their status history, proofs, contact attempts, incidents, cash settlements
#   loyalty      points and redemptions AND the account balances (they are one ledger: clearing the
#                transactions and keeping the balances would leave points nobody earned)
#   crm          notifications (and their read markers)
#   depot        stock reservations, gallon issues and returns — and `inventory_items.reserved`
#                is set to 0, or every unit a test order held would stay "reserved" for ever
#   forecast, recommendation   the demand and co-purchase tables built FROM those orders
#   --with-ledgers   payout and courier ledgers, withdrawals, expense claims
#
# What it never touches: accounts, customers, addresses, depots, the catalogue, stock QUANTITIES,
# employees and payroll, vouchers and their definitions, settings, the audit trail, and the
# files in object storage (proof photos and receipts expire under the retention lifecycle).
#
# THE STOCK QUANTITIES ARE NOT RESTORED. Test sales consumed real units; after this, count the
# shelf and post an opname so the system agrees with it. Do that before opening.
#
# Safety, in the order it applies:
#   - a dry run is the default and reads only;
#   - --execute needs CONFIRM=RESET-TEST-DATA in the environment;
#   - it refuses if an order was placed in the last 15 minutes (somebody is using the system;
#     RESET_FORCE=1 overrides, and the reason to would be a test stack);
#   - it takes its own database dump first and stops if that fails — this cannot be undone
#     any other way;
#   - each database is cleared in ONE transaction, so a failure leaves that database as it was.
set -uo pipefail

cd "$(dirname "$0")/.."

EXECUTE=false
LEDGERS=false
for arg in "$@"; do
  case "$arg" in
    --execute) EXECUTE=true ;;
    --with-ledgers) LEDGERS=true ;;
    *) echo "usage: $0 [--execute] [--with-ledgers]" >&2; exit 2 ;;
  esac
done

# `db:table,table,...` — every table a database clears, listed together because TRUNCATE without
# CASCADE only accepts a set that contains everything referencing it. If a table outside the set
# references one inside, Postgres refuses and nothing is cleared, which is the failure we want.
PLAN=(
  "order:order_status_history,order_items,order_reviews,outbox_messages,cart_items,orders,subscriptions"
  "payment:payments"
  "delivery:delivery_status_history,proofs_of_delivery,contact_attempts,field_incidents,cash_settlements,deliveries"
  "loyalty:reward_redemptions,points_transactions,loyalty_accounts"
  "crm:ops_notification_reads,notifications"
  "depot:stock_reservations,gallon_issues,gallon_returns"
  "forecast:product_daily_demand,depot_daily_revenue,customer_activity,ingested_order"
  "recommendation:customer_product_purchases,product_co_buys,product_daily_sales,ingested_orders"
)
$LEDGERS && PLAN+=("payout:courier_ledger_entries,ledger_entries,expense_claims,courier_withdrawals,withdrawals")

# Run after the truncate, in the same transaction.
declare -A AFTER=(
  [depot]="UPDATE inventory_items SET reserved = 0 WHERE reserved <> 0;"
)

PG="${PG_CONTAINER:-$(docker ps --filter 'name=postgres' --format '{{.Names}}' 2>/dev/null | grep -v exporter | head -1)}"
if [ -z "$PG" ] || ! docker exec "$PG" true >/dev/null 2>&1; then
  echo "!! cannot reach Postgres (PG_CONTAINER='${PG}'). Run this on the box, or set PG_CONTAINER." >&2
  exit 2
fi
PG_USER="${PG_USER:-hydromart}"

psql_db() { docker exec -i "$PG" psql -X -tA -v ON_ERROR_STOP=1 -U "$PG_USER" -d "hydromart_$1" "${@:2}"; }

count() { # db table -> number, or "absent"
  local n
  n="$(psql_db "$1" -c "select count(*) from \"$2\"" 2>&1)" || { echo absent; return; }
  printf '%s' "$n"
}

echo "reset-test-data: $($EXECUTE && echo EXECUTE || echo 'dry run — nothing will be written')"
echo

total=0
for entry in "${PLAN[@]}"; do
  db="${entry%%:*}"
  IFS=',' read -ra tables <<< "${entry#*:}"
  echo "== $db"
  for t in "${tables[@]}"; do
    n="$(count "$db" "$t")"
    printf '   %-32s %s\n' "$t" "$n"
    case "$n" in absent | '') ;; *) total=$((total + n)) ;; esac
  done
done
echo
echo "$total row(s) across the tables above."

if ! $EXECUTE; then
  echo
  echo "Dry run only. To clear them: CONFIRM=RESET-TEST-DATA bash $0 --execute$($LEDGERS && echo ' --with-ledgers')"
  echo "Afterwards: count the shelf and post a stock opname — quantities are NOT restored."
  exit 0
fi

# ------------------------------------------------------------------------------- refusals
if [ "${CONFIRM:-}" != "RESET-TEST-DATA" ]; then
  echo "!! refusing: set CONFIRM=RESET-TEST-DATA to say you mean it." >&2
  exit 1
fi

recent="$(psql_db order -c "select count(*) from orders where \"createdAt\" > now() - interval '15 minutes'" 2>&1)" || recent=""
if [ -z "$recent" ]; then
  echo "!! refusing: could not tell whether the system is in use (orders unreadable)." >&2
  exit 1
fi
if [ "$recent" -gt 0 ] && [ "${RESET_FORCE:-}" != 1 ]; then
  echo "!! refusing: $recent order(s) were placed in the last 15 minutes — somebody is using the system." >&2
  echo "   Do this when the depots are closed. (RESET_FORCE=1 overrides, for a test stack.)" >&2
  exit 1
fi

# ALL OR NOTHING across databases. Each database clears in one transaction, but the databases
# are separate: if 'order' were refused (a table outside the set references orders) after
# 'payment' had already cleared, the books would hold orders with no payments. So every
# TRUNCATE is first rehearsed and rolled back, and nothing real runs unless all of them pass.
echo
echo "Rehearsing every clear (rolled back) before touching anything..."
for entry in "${PLAN[@]}"; do
  db="${entry%%:*}"
  if ! printf 'BEGIN; TRUNCATE %s; ROLLBACK;
' "${entry#*:}" | psql_db "$db" -f - >/dev/null 2>"/tmp/reset-$db.err"; then
    echo "!! refusing: $db cannot be cleared ($(grep -m1 ERROR "/tmp/reset-$db.err" || head -1 "/tmp/reset-$db.err"))." >&2
    echo "   Nothing was changed in any database. Add the referencing table to that database's list, or leave it out." >&2
    exit 1
  fi
done

echo
echo "Taking a database dump first — this cannot be undone any other way..."
# RESET_BACKUP_CMD exists so the self-test can stand in for the dump; production never sets it.
if ! ${RESET_BACKUP_CMD:-bash scripts/backup-db.sh}; then
  echo "!! refusing: the backup failed, so there would be no way back." >&2
  exit 1
fi

# ------------------------------------------------------------------------------- the reset
failed=0
for entry in "${PLAN[@]}"; do
  db="${entry%%:*}"
  list="${entry#*:}"
  sql="TRUNCATE ${list};"
  [ -n "${AFTER[$db]:-}" ] && sql="$sql ${AFTER[$db]}"
  if printf '%s\n' "$sql" | psql_db "$db" -1 -f - >/dev/null 2>"/tmp/reset-$db.err"; then
    echo "cleared $db"
  else
    echo "!! $db NOT cleared (left exactly as it was): $(head -1 "/tmp/reset-$db.err")" >&2
    failed=$((failed + 1))
  fi
done

echo
if [ "$failed" -gt 0 ]; then
  echo "!! $failed database(s) failed; the rest were cleared. Read the messages above." >&2
  exit 1
fi
echo "Done. Next: (1) count the shelf and post a stock opname at every depot,"
echo "(2) run scripts/go-live-report.sh, (3) place one real order end to end before opening."
