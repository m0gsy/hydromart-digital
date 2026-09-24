#!/usr/bin/env bash
# Is this box READY TO TAKE REAL CUSTOMERS? — asked of the data, not of the code.
#
#   bash scripts/go-live-report.sh            # on the box, or via the "Registry pull check" workflow
#
# STRICTLY READ-ONLY: every statement is a SELECT and nothing here starts, stops or writes.
#
# Why this exists. The code can be perfect and the business still not open: a depot with no bank
# account sells cash-only without saying so, a franchise depot with no commission scheme books
# HQ's cut as 0% and the ledger still balances, a depot with no opening hours quietly loses "antar
# sekarang", a depot with nobody in it takes orders that nobody can fulfil. Each of those is
# "configuration nobody has entered", which no test can see and no error ever reports. This
# reads the live databases and prints, per real depot, what is entered and what is missing.
#
# `!!` marks something that stops a launch or loses money silently; `..` is information. A query
# that could not run says QUERY FAILED — never an empty line that reads like "nothing wrong".
set -uo pipefail

cd "$(dirname "$0")/.."

PG="${PG_CONTAINER:-$(docker ps --filter 'name=postgres' --format '{{.Names}}' 2>/dev/null | grep -v exporter | head -1)}"
if [ -z "$PG" ] || ! docker exec "$PG" true >/dev/null 2>&1; then
  echo "!! cannot reach Postgres (PG_CONTAINER='${PG}'). Run this on the box, or set PG_CONTAINER."
  exit 2
fi

FIXTURE='^(E2E|UAT|HIER|DEMO)'
PROBLEMS=0

line() { printf '\n== %s\n' "$1"; }
bad() { PROBLEMS=$((PROBLEMS + 1)); printf '  !! %s\n' "$1"; }
note() { printf '  .. %s\n' "$1"; }

# One statement, one database. stderr is KEPT: a failed query must not look like zero rows.
q() {
  local out
  if ! out="$(docker exec "$PG" psql -tAX -F'|' -U "${PG_USER:-hydromart}" -d "hydromart_$1" -c "$2" 2>&1)"; then
    echo "QUERY FAILED ($1): $(printf '%s' "$out" | head -1)"
    return 1
  fi
  printf '%s\n' "$out"
}

qfail() { case "$1" in "QUERY FAILED"*) bad "$1"; return 0 ;; esac; return 1; }

# ---------------------------------------------------------------------------------- depots
line "Depots (real, active — fixtures excluded)"
DEPOTS="$(q depot "select id, code, \"ownershipType\", coalesce(\"ownerId\"::text,''),
  (coalesce(\"paymentBankAccountNumber\",'')<>'' and coalesce(\"paymentBankName\",'')<>'' and coalesce(\"paymentBankAccountHolder\",'')<>''),
  (coalesce(\"paymentQrisImageUrl\",'')<>''),
  (select count(*) from jsonb_object_keys(coalesce(\"operatingHours\",'{}'::jsonb))),
  (coalesce(\"contactPhone\",'')<>''),
  \"deliveryFee\"::int, coalesce(\"minOrderAmount\",0)::int, \"serviceRadiusKm\"
  from depots where active and code !~ '$FIXTURE' order by code")"
if qfail "$DEPOTS"; then
  DEPOTS=""
elif [ -z "$DEPOTS" ]; then
  bad "no real active depot at all — there is nothing to order from"
else
  while IFS='|' read -r id code own owner bank qris hours phone fee minorder radius; do
    [ -z "$id" ] && continue
    printf '  %s  %s  fee=Rp%s min=Rp%s radius=%skm\n' "$code" "$own" "$fee" "$minorder" "$radius"
    [ "$bank" = t ] || [ "$qris" = t ] || bad "$code has NO payment destination — customers there can only pay cash, and nothing on screen says a method was hidden (Depots console > Pembayaran)"
    [ "$bank" = t ] || note "$code: transfer needs bank name + account number + holder (all three)"
    [ "$hours" -gt 0 ] || bad "$code has no opening hours — \"antar sekarang\" is silently unavailable there"
    [ "$phone" = t ] || note "$code has no contact WhatsApp — depot messages fall back to the HQ ops number"
    [ "$fee" -gt 0 ] || note "$code delivery fee is Rp0 — intended?"
    if [ "$own" = WARALABA ] && [ -z "$owner" ]; then
      bad "$code is a franchise depot with no owner — the owner's ledger and commission path is dead"
    fi
  done <<< "$DEPOTS"
fi

# ----------------------------------------------------------------------- franchise commission
line "Franchise commission (a WARALABA depot with no scheme books HQ's cut as 0%)"
FRANCHISE="$(q depot "select id, code from depots where active and \"ownershipType\"='WARALABA' and code !~ '$FIXTURE' order by code")"
if qfail "$FRANCHISE"; then :; elif [ -z "$FRANCHISE" ]; then
  note "no real WARALABA depot yet — nothing to cover"
else
  SCHEMED="$(q payout "select coalesce(string_agg(distinct \"depotId\"::text, ','), '') from commission_schemes")"
  if ! qfail "$SCHEMED"; then
    while IFS='|' read -r id code; do
      case ",$SCHEMED," in *",$id,"*) note "$code has a commission scheme" ;; *) bad "$code has NO commission scheme — HQ takes 0% and every statement still reconciles" ;; esac
    done <<< "$FRANCHISE"
  fi
fi

# ---------------------------------------------------------------------------------- staffing
line "Staffing per depot (HR: active employees)"
if [ -n "$DEPOTS" ]; then
  while IFS='|' read -r id code _rest; do
    [ -z "$id" ] && continue
    ROLES="$(q hr "select coalesce(role::text,'(no role)'), count(*), count(*) filter (where \"authSubjectId\" is not null)
      from employees where status='ACTIVE' and \"depotId\"='$id' group by 1 order by 1")"
    if qfail "$ROLES"; then continue; fi
    if [ -z "$ROLES" ]; then bad "$code has NOBODY in HR — orders would arrive with no one to prepare or deliver them"; continue; fi
    printf '  %s:' "$code"
    lead=0; crew=0
    while IFS='|' read -r role n withlogin; do
      printf ' %s=%s(%s with login)' "$role" "$n" "$withlogin"
      case "$role" in KEPALA_DEPOT|MANAGER) lead=$((lead + n)) ;; STAFF_DEPOT) crew=$((crew + n)) ;; esac
    done <<< "$ROLES"
    printf '\n'
    [ "$lead" -gt 0 ] || bad "$code has no KEPALA_DEPOT or MANAGER — nobody can approve, confirm transfers or close the shift"
    [ "$crew" -gt 0 ] || bad "$code has no STAFF_DEPOT — nobody to run the counter or the deliveries"
  done <<< "$DEPOTS"
fi

# ------------------------------------------------------------------------------ network roles
line "Head-office roles (auth: active accounts)"
NETWORK="$(q auth "select role::text, count(*) from customers where role<>'CUSTOMER' and status='ACTIVE' group by 1 order by 1")"
if ! qfail "$NETWORK"; then
  for role in SUPER_ADMIN HEAD_OFFICE FINANCE HR; do
    n="$(printf '%s\n' "$NETWORK" | awk -F'|' -v r="$role" '$1==r{print $2}')"
    n="${n:-0}"
    printf '  %s=%s\n' "$role" "$n"
    [ "$n" -gt 0 ] || bad "nobody holds $role — its screens and approvals have no one to act on them"
  done
  n="$(printf '%s\n' "$NETWORK" | awk -F'|' '$1=="SUPER_ADMIN"{print $2}')"
  [ "${n:-0}" -ge 2 ] || bad "only one SUPER_ADMIN — lose that account or phone and nobody can reset anything"
fi

# --------------------------------------------------------------------------------------- catalog
line "Catalog (active products)"
PRODUCTS="$(q product "select id, sku, \"basePrice\"::int, (coalesce(\"imageUrl\",'')<>'') from products where active order by sku")"
if qfail "$PRODUCTS"; then :; elif [ -z "$PRODUCTS" ]; then
  bad "no active product — the shop is empty"
else
  while IFS='|' read -r pid sku price img; do
    [ -z "$pid" ] && continue
    printf '  %s  Rp%s  image=%s\n' "$sku" "$price" "$([ "$img" = t ] && echo yes || echo NO)"
    [ "$price" -gt 0 ] || bad "$sku has a base price of Rp0"
    [ "$img" = t ] || note "$sku has no image"
    if [ -n "$DEPOTS" ]; then
      while IFS='|' read -r did dcode _r; do
        [ -z "$did" ] && continue
        stock="$(q depot "select coalesce(sum(quantity - reserved),0) from inventory_items where \"depotId\"='$did' and \"productId\"='$pid' and not hidden")"
        if qfail "$stock"; then continue; fi
        [ "${stock:-0}" -gt 0 ] || bad "$dcode has no sellable stock of $sku — customers there see it out of stock"
      done <<< "$DEPOTS"
    fi
  done <<< "$PRODUCTS"
fi

# ------------------------------------------------------------------ decisions nobody has taken
line "Business decisions (a GLOBAL row = someone decided; none = the coded default is running)"
setting() { # db key what
  local stored
  stored="$(q "$1" "select coalesce(string_agg(scope||'='||value, ', '),'') from service_settings where key='$2'")"
  qfail "$stored" && return
  case "$stored" in
    "") note "$2 — coded default is running ($3)" ;;
    *=0*) if [ "$4" = zero-is-broken ]; then bad "$2 is stored as ZERO ($stored) — $3"; else note "$2 = $stored ($3)"; fi ;;
    *) note "$2 = $stored ($3)" ;;
  esac
}
setting loyalty silverDiscountPct   "SILVER discount; the badge promises it" zero-is-broken
setting loyalty goldDiscountPct     "GOLD discount; the badge promises it" zero-is-broken
setting loyalty platinumDiscountPct "PLATINUM discount; the badge promises it" zero-is-broken
EXPIRY="$(q loyalty "select coalesce(string_agg(scope||'='||value, ', '),'') from service_settings where key='pointExpirySweepEnabled'")"
if ! qfail "$EXPIRY"; then
  case "$EXPIRY" in
    *=1*) note "pointExpirySweepEnabled = $EXPIRY (points expire, as the app tells customers)" ;;
    *) bad "pointExpirySweepEnabled is not 1 ($EXPIRY) — the app says points expire after 12 months and none ever do" ;;
  esac
fi
setting loyalty earnRateRupiah   "rupiah per loyalty point"
setting referral referrerPoints  "points paid per referral"
setting depot gallonDepositIdr   "gallon deposit"
setting payout platformFeePct    "HQ's cut of franchise sales"

# ------------------------------------------------------------------------------ what is fixture
line "Fixtures still live"
FIX="$(q depot "select code, active from depots where code ~ '$FIXTURE' or name ilike '%demo%' order by code")"
if ! qfail "$FIX"; then
  if [ -z "$FIX" ]; then note "none"; else
    while IFS='|' read -r code active; do
      [ "$active" = t ] && note "$code is ACTIVE — visible in the public depot list (keep only while Play review needs it)" || note "$code exists but inactive"
    done <<< "$FIX"
  fi
fi

# ---------------------------------------------------------------------------- test data (counts)
line "Data that already exists (a launch decision: keep, or reset with scripts/reset-test-data.sh)"
for spec in "order:orders" "payment:payments" "loyalty:points_transactions" "crm:notifications" "product:products"; do
  db="${spec%%:*}"; table="${spec##*:}"
  n="$(q "$db" "select count(*)||' rows, '||coalesce(min(\"createdAt\")::date::text,'-')||' .. '||coalesce(max(\"createdAt\")::date::text,'-') from $table")"
  qfail "$n" || printf '  %-20s %s\n' "$table" "$n"
done
note "financial rows are never purged by retention (10 years) — anything test-made stays unless reset now"

printf '\n%s\n' "----"
if [ "$PROBLEMS" -eq 0 ]; then
  echo "go-live report: nothing above is marked !! — the data is ready."
else
  echo "go-live report: $PROBLEMS item(s) marked !! must be fixed or knowingly accepted before real customers."
fi
echo "Read-only: nothing above wrote, started or stopped anything."
exit 0
