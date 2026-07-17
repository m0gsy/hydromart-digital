#!/usr/bin/env bash
# Post-deploy smoke test: drives the customer rewards/account flow end to end
# against a running stack (register -> OTP -> reward catalog -> redeem -> wallet
# -> payment method -> profile edit). Prints a ✅/❌ per step.
#
#   bash scripts/smoke.sh
#
# Needs: the stack up, .env in the repo root, jq, and OTP_DELIVERY_CHANNEL=console
# (it scrapes the code from the auth container logs). Override the gateway with
# GW=https://api.example.com bash scripts/smoke.sh — but a non-console OTP channel
# has no readable code, so this only works against console-channel deploys.
#
# Leaves a throwaway customer behind (phone 0812xxxxxxxx). Harmless, but prune the
# `customers` table now and then.
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
GW="${GW:-http://localhost:8080}"
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
ok(){ echo "  ✅ $1"; }; no(){ echo "  ❌ $1"; }
PHONE="0812$(date +%N | cut -c1-8)"; echo "phone=$PHONE"

curl -s -o /dev/null -XPOST $GW/auth/api/v1/auth/register -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\",\"fullName\":\"Smoke\"}"
sleep 1
LINE=$($DC logs --since 30s auth 2>/dev/null | grep -a 'DEV OTP' | tail -1)
OTP=$(echo "$LINE" | sed -E 's/.*code for [^:]*: ([0-9]+).*/\1/')
[ -n "$OTP" ] && ok "otp=$OTP" || { no "no OTP: $LINE"; exit 1; }

SESS=$(curl -s -XPOST $GW/auth/api/v1/auth/otp/verify -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\",\"code\":\"$OTP\",\"purpose\":\"REGISTRATION\"}")
TOKEN=$(echo "$SESS" | jq -r '.accessToken // empty'); CID=$(echo "$SESS" | jq -r '.customer.id // empty')
[ -n "$TOKEN" ] && ok "login (cid=$CID)" || { no "verify: $SESS"; exit 1; }
A="authorization: Bearer $TOKEN"

CAT=$(curl -s $GW/loyalty/api/v1/rewards/catalog)
N=$(echo "$CAT"|jq 'length'); RID=$(echo "$CAT"|jq -r 'sort_by(.pointsCost)[0].id'); COST=$(echo "$CAT"|jq -r 'sort_by(.pointsCost)[0].pointsCost')
[ "$N" -ge 1 ] && ok "catalog=$N item (termurah $COST poin)" || no "catalog kosong"

curl -s -o /dev/null -XPOST $GW/loyalty/api/v1/loyalty/reward -H "x-internal-key: $INTERNAL_SERVICE_KEY" -H 'content-type: application/json' -d "{\"customerId\":\"$CID\",\"points\":$((COST+200)),\"reason\":\"smoke\"}"

KEY=$(cat /proc/sys/kernel/random/uuid)
B1=$(curl -s -XPOST $GW/loyalty/api/v1/rewards/redeem -H "$A" -H 'content-type: application/json' -d "{\"rewardItemId\":\"$RID\",\"idempotencyKey\":\"$KEY\"}" | jq -r '.pointsBalance')
B2=$(curl -s -XPOST $GW/loyalty/api/v1/rewards/redeem -H "$A" -H 'content-type: application/json' -d "{\"rewardItemId\":\"$RID\",\"idempotencyKey\":\"$KEY\"}" | jq -r '.pointsBalance')
{ [ "$B1" = "$B2" ] && [ "$B1" != "null" ]; } && ok "redeem idempoten (debit sekali, saldo=$B1)" || no "redeem b1=$B1 b2=$B2"

VW=$(curl -s $GW/vouchers/api/v1/vouchers/me -H "$A")
echo "$VW"|jq -e 'type=="array"' >/dev/null 2>&1 && ok "voucher wallet ($(echo "$VW"|jq length))" || no "wallet: $VW"

PM=$(curl -s -XPOST $GW/customers/api/v1/payment-methods -H "$A" -H 'content-type: application/json' -d '{"type":"EWALLET","label":"GoPay","maskedIdentifier":"****4821"}')
echo "$PM"|jq -e '.isDefault==true' >/dev/null 2>&1 && ok "payment method (pertama=default)" || no "payment: $PM"

PR=$(curl -s -XPATCH $GW/auth/api/v1/auth/me -H "$A" -H 'content-type: application/json' -d '{"fullName":"Smoke Edited"}')
echo "$PR"|jq -e '.fullName=="Smoke Edited"' >/dev/null 2>&1 && ok "profile edit" || no "profile: $PR"
echo "== selesai =="
