#!/usr/bin/env bash
# Post-deploy smoke test: drives the customer rewards/account flow end to end
# against a running stack (register -> OTP -> reward catalog -> redeem -> wallet
# -> payment method -> profile edit). Prints a ✅/❌ per step.
#
#   bash scripts/smoke.sh
#
# Needs: the stack up, .env in the repo root, jq (NOT installed on every dev box — check
# `which jq` first, every step after login parses JSON with it), and a way to know the OTP.
#
# It used to scrape "DEV OTP" out of the auth logs with OTP_DELIVERY_CHANNEL=console.
# That channel no longer exists — the env schema accepts `sms` and `zenziva` only — so
# the script could not run at all. It now uses the REVIEWER pair the service already
# supports: a nominated phone whose code is fixed and never delivered (see OtpService).
# Set REVIEWER_PHONE + REVIEWER_OTP_CODE in .env; with the pair unset this exits early
# rather than pretending to have tested a signup it never made.
#
# Override the gateway with GW=https://api.example.com bash scripts/smoke.sh.
#
# Leaves nothing behind now: it signs in as the existing reviewer account rather than
# registering a throwaway customer per run.
set -uo pipefail
cd "$(dirname "$0")/.."
. ./scripts/load-env.sh
GW="${GW:-http://localhost:8080}"
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
ok(){ echo "  ✅ $1"; }; no(){ echo "  ❌ $1"; }
# The reviewer number is a real, already-registered demo account: its code is fixed and
# deliberately never sent, which is exactly what a smoke test needs and what a throwaway
# 0812xxxxxxxx signup can no longer get.
PHONE="${REVIEWER_PHONE:-}"; PHONE="${PHONE%%,*}"
OTP="${REVIEWER_OTP_CODE:-}"
if [ -z "$PHONE" ] || [ -z "$OTP" ]; then
  no "REVIEWER_PHONE / REVIEWER_OTP_CODE are not set — nothing here can learn an OTP"
  exit 1
fi
echo "phone=$PHONE"
# An ACTIVE account gets a LOGIN challenge from /auth/login. A number nobody has verified
# yet has to go through REGISTRATION once — same fixed code, different purpose, and the
# purposes are not interchangeable on verify. Delivery is skipped for a reviewer number
# either way, so neither path costs an SMS.
LOGIN=$(curl -s -XPOST $GW/auth/api/v1/auth/login -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}")
if echo "$LOGIN" | grep -q 'AUTH_ACCOUNT_NOT_ACTIVE|AUTH_CUSTOMER_NOT_FOUND'; then
  curl -s -o /dev/null -XPOST $GW/auth/api/v1/auth/register -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\",\"fullName\":\"Smoke Reviewer\"}"
  PURPOSE=REGISTRATION
else
  PURPOSE=LOGIN
fi
ok "otp challenge issued ($PURPOSE, fixed reviewer code)"

# SEC-4: the gateway is a BFF. It keeps the tokens in httpOnly cookies and hands the
# browser only `{ customer }` — so `.accessToken` has not been in this body since that
# landed, and every step below used to run unauthenticated with an empty bearer. A cookie
# jar is what a browser is, and the gateway translates the cookie into the bearer the
# services expect.
JAR=$(mktemp); trap 'rm -f "$JAR"' EXIT
SESS=$(curl -s -c "$JAR" -XPOST $GW/auth/api/v1/auth/otp/verify -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\",\"code\":\"$OTP\",\"purpose\":\"$PURPOSE\"}")
CID=$(echo "$SESS" | jq -r '.customer.id // empty')
[ -n "$CID" ] && ok "login (cid=$CID)" || { no "verify: $SESS"; exit 1; }

CAT=$(curl -s $GW/loyalty/api/v1/rewards/catalog)
N=$(echo "$CAT"|jq 'length'); RID=$(echo "$CAT"|jq -r 'sort_by(.pointsCost)[0].id'); COST=$(echo "$CAT"|jq -r 'sort_by(.pointsCost)[0].pointsCost')
[ "$N" -ge 1 ] && ok "catalog=$N item (termurah $COST poin)" || no "catalog kosong"

# Granting points is an INTERNAL call: the gateway strips x-internal-key on purpose
# (gateway.setup.ts — a browser must never inject it), so this has to talk to the
# loyalty container directly, the same way a peer service would.
GRANT=$($DC exec -T loyalty node -e '
const [customerId, points] = process.argv.slice(1);
fetch("http://localhost:3009/api/v1/loyalty/reward", {
  method: "POST",
  headers: { "x-internal-key": process.env.INTERNAL_SERVICE_KEY, "content-type": "application/json" },
  body: JSON.stringify({ customerId, points: Number(points), reason: "smoke" }),
}).then(async (r) => console.log(r.ok ? "ok" : `${r.status} ${await r.text()}`));
' "$CID" "$((COST + 200))" 2>&1 | tr -d '\r')
if [ "$GRANT" = "ok" ]; then ok "grant $((COST + 200)) poin"; else no "grant poin: $GRANT"; fi

KEY=$(cat /proc/sys/kernel/random/uuid)
B1=$(curl -s -XPOST $GW/loyalty/api/v1/rewards/redeem -b "$JAR" -H 'content-type: application/json' -d "{\"rewardItemId\":\"$RID\",\"idempotencyKey\":\"$KEY\"}" | jq -r '.pointsBalance')
B2=$(curl -s -XPOST $GW/loyalty/api/v1/rewards/redeem -b "$JAR" -H 'content-type: application/json' -d "{\"rewardItemId\":\"$RID\",\"idempotencyKey\":\"$KEY\"}" | jq -r '.pointsBalance')
{ [ "$B1" = "$B2" ] && [ "$B1" != "null" ]; } && ok "redeem idempoten (debit sekali, saldo=$B1)" || no "redeem b1=$B1 b2=$B2"

VW=$(curl -s $GW/vouchers/api/v1/vouchers/me -b "$JAR")
echo "$VW"|jq -e 'type=="array"' >/dev/null 2>&1 && ok "voucher wallet ($(echo "$VW"|jq length))" || no "wallet: $VW"

PM=$(curl -s -XPOST $GW/customers/api/v1/payment-methods -b "$JAR" -H 'content-type: application/json' -d '{"type":"EWALLET","label":"GoPay","maskedIdentifier":"****4821"}')
echo "$PM"|jq -e '.isDefault==true' >/dev/null 2>&1 && ok "payment method (pertama=default)" || no "payment: $PM"

PR=$(curl -s -XPATCH $GW/auth/api/v1/auth/me -b "$JAR" -H 'content-type: application/json' -d '{"fullName":"Smoke Edited"}')
echo "$PR"|jq -e '.fullName=="Smoke Edited"' >/dev/null 2>&1 && ok "profile edit" || no "profile: $PR"
echo "== selesai =="
