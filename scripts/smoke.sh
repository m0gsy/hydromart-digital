#!/usr/bin/env bash
# Post-deploy smoke test: drives the customer rewards/account flow end to end
# against a running stack (register -> OTP -> reward catalog -> redeem -> wallet
# -> payment method -> profile edit). Prints a ✅/❌ per step.
#
#   bash scripts/smoke.sh
#
# Needs: the stack up, .env in the repo root, and a way to know the OTP. It used to need
# jq, which is NOT installed on every dev box — this repo already requires node, so the
# `j` helper below reads JSON with that instead and the script runs anywhere it builds.
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
# -qE, not -q: without it that pipe is a LITERAL string nothing ever matched, so the
# REGISTRATION branch was dead and a phone nobody had verified yet failed at verify with
# AUTH_OTP_INVALID — a wrong-code message for a right code on the wrong purpose.
if echo "$LOGIN" | grep -qE 'AUTH_ACCOUNT_NOT_ACTIVE|AUTH_CUSTOMER_NOT_FOUND'; then
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
# `j <js-expression>` — the six jq queries this script used, without jq. `d` is stdin
# parsed as JSON. Prints the result; exits 1 when it is null/undefined/false (jq -e) and
# 3 when the body is not JSON at all — a service that answered with an HTML error page is
# a different failure from one that answered `false`, and the old `jq -e` conflated them.
j() {
  node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let d;
      try { d = JSON.parse(s); } catch { process.exit(3); }
      let r;
      try { r = new Function("d", "return (" + process.argv[1] + ")")(d); } catch { process.exit(1); }
      if (r === undefined || r === null || r === false) process.exit(1);
      process.stdout.write(typeof r === "object" ? JSON.stringify(r) : String(r));
    });
  ' "$1"
}

JAR=$(mktemp); trap 'rm -f "$JAR"' EXIT
verify() {
  curl -s -c "$JAR" -XPOST $GW/auth/api/v1/auth/otp/verify -H 'content-type: application/json' \
    -d "{\"phone\":\"$PHONE\",\"code\":\"$OTP\",\"purpose\":\"$1\"}"
}
SESS=$(verify "$PURPOSE")
CID=$(echo "$SESS" | j 'd.customer?.id ?? ""' || true)
# A cooldown on /auth/login means a challenge already exists — and nothing in the response
# says which purpose it was minted for. Rather than guess, try the other one: the codes are
# identical for a reviewer number, so only the purpose can be wrong here.
if [ -z "$CID" ] && echo "$SESS" | grep -q AUTH_OTP_INVALID; then
  [ "$PURPOSE" = LOGIN ] && PURPOSE=REGISTRATION || PURPOSE=LOGIN
  SESS=$(verify "$PURPOSE")
  CID=$(echo "$SESS" | j 'd.customer?.id ?? ""' || true)
fi
[ -n "$CID" ] && ok "login (cid=$CID)" || { no "verify: $SESS"; exit 1; }

CAT=$(curl -s $GW/loyalty/api/v1/rewards/catalog)
N=$(echo "$CAT"|j 'd.length' || echo 0)
# Cheapest REDEEMABLE, not cheapest: the seeded catalogue deliberately carries a
# "Galon gratis (stok habis)" row at stock 0, so picking on price alone always chose the
# one item that is guaranteed to answer 422. `stock: null` means unlimited.
CHEAPEST='d.filter(x=>x.active&&(x.stock===null||x.stock>0)).sort((a,b)=>a.pointsCost-b.pointsCost)[0]'
RID=$(echo "$CAT"|j "$CHEAPEST.id" || true); COST=$(echo "$CAT"|j "$CHEAPEST.pointsCost" || echo 0)
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

# node, not /proc: this script has to run on a Windows dev box too.
KEY=$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')
# `depotId` is REQUIRED on redeem and always was — without it the reward lands in a
# network-wide queue and no depot owns handing it over. The script never sent one, so this
# step had been 400ing since that rule shipped. Any depot the customer can browse will do.
DEPOT=$(curl -s "$GW/depots/api/v1/depots" | j '(d.items ?? d.rows ?? d)[0]?.id' || true)
[ -n "$DEPOT" ] && ok "depot pickup=$DEPOT" || no "tidak ada depot untuk titik ambil"
redeem() {
  curl -s -XPOST $GW/loyalty/api/v1/rewards/redeem -b "$JAR" -H 'content-type: application/json'     -d "{\"rewardItemId\":\"$RID\",\"idempotencyKey\":\"$KEY\",\"depotId\":\"$DEPOT\"}"
}
# Keep the RAW bodies: a step that fails has to say why. Reporting only the extracted
# balance turns every refusal — 401, 409, sold out — into the same blank.
R1=$(redeem); R2=$(redeem)
B1=$(echo "$R1" | j 'd.pointsBalance' || true)
B2=$(echo "$R2" | j 'd.pointsBalance' || true)
# -n as well: with jq gone a missing field is an EMPTY string, and two empty strings are
# equal to each other — the old pair of tests passed on a response that carried no balance
# at all, which is the exact shape of false green this audit keeps finding.
{ [ "$B1" = "$B2" ] && [ -n "$B1" ] && [ "$B1" != "null" ]; } && ok "redeem idempoten (debit sekali, saldo=$B1)" || no "redeem b1=$B1 b2=$B2 — $R1"

VW=$(curl -s $GW/vouchers/api/v1/vouchers/me -b "$JAR")
echo "$VW"|j 'Array.isArray(d)' >/dev/null 2>&1 && ok "voucher wallet ($(echo "$VW"|j 'd.length'))" || no "wallet: $VW"

PM=$(curl -s -XPOST $GW/customers/api/v1/payment-methods -b "$JAR" -H 'content-type: application/json' -d '{"type":"EWALLET","label":"GoPay","maskedIdentifier":"****4821"}')
PMID=$(echo "$PM"|j 'd.id' || true)
# "the first one is the default" only holds on a fresh account, and this script now signs
# in as a reviewer who has run it before. What must hold on EVERY run is that the method
# was stored and that the account has exactly one default — two defaults is the bug.
DEFAULTS=$(curl -s $GW/customers/api/v1/payment-methods -b "$JAR" | j 'd.filter(x=>x.isDefault).length' || echo x)
{ [ -n "$PMID" ] && [ "$DEFAULTS" = 1 ]; } && ok "payment method tersimpan (default tepat 1)" || no "payment: default=$DEFAULTS $PM"

PR=$(curl -s -XPATCH $GW/auth/api/v1/auth/me -b "$JAR" -H 'content-type: application/json' -d '{"fullName":"Smoke Edited"}')
echo "$PR"|j 'd.fullName === "Smoke Edited"' >/dev/null 2>&1 && ok "profile edit" || no "profile: $PR"
echo "== selesai =="
