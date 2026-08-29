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
# Leaves nothing behind now, and that is meant literally rather than as a manner of speaking.
# It signs in as an existing account instead of registering a throwaway customer, and every
# WRITE it makes is undone before it exits (smoke_cleanup below). That is what lets deploy.sh
# run it on every release: while it still granted points, parked a redemption in a real
# depot's pickup queue, stored one more payment method and renamed the profile to
# "Smoke Edited", the only honest place for it was behind DEPLOY_SMOKE=full — where it ran
# on approximately no release at all, which is the same as not testing the money path.
set -uo pipefail
cd "$(dirname "$0")/.."
. ./scripts/load-env.sh
GW="${GW:-http://localhost:8080}"
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
# A failed step has to be FATAL. Until now `no` only printed: the deploy workflow reported
# `success` with two red crosses on the screen, which is the same shape as a green run to
# anything reading the exit code, and to anybody skimming. A smoke test that cannot fail is
# not a test — it is a log line.
FAILED=0
ok(){ echo "  ✅ $1"; }
no(){ echo "  ❌ $1"; FAILED=$((FAILED + 1)); }
# The reviewer number is a real, already-registered demo account: its code is fixed and
# deliberately never sent, which is exactly what a smoke test needs and what a throwaway
# 0812xxxxxxxx signup can no longer get.
# The reviewer number belongs to a KEPALA_DEPOT, and a KEPALA_DEPOT is not a customer:
# `rewards/redeem` and `vouchers/me` answer 403 to it, correctly. Those two steps had been
# failing on every run for exactly that reason and nobody could tell, because nothing here
# failed. So the customer half of this script signs in as the DEMO CUSTOMER when there is
# one, and only falls back to the reviewer when there is not.
# What this run has CREATED in production, and therefore what it owes back. Each stays
# empty until the step that writes it has actually succeeded, so cleanup only ever undoes
# something that really landed. Declared up here because `set -u` is on and the EXIT trap
# can fire from anywhere below.
REDEMPTION_ID=""
PMID=""
ORIG_NAME=""
DEPOT=""
CLEANED=""
PHONE="${DEMO_CUSTOMER_PHONE:-}"
if [ -z "$PHONE" ]; then PHONE="${REVIEWER_PHONE:-}"; PHONE="${PHONE%%,*}"; fi
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

JAR=$(mktemp)

# Undo everything this run wrote. Every undo is an endpoint that ALREADY EXISTED — no
# backend change was needed to make this script safe, only the reading of what was there:
#
#   POST .../redemptions/:id/cancel  refunds the points AND restores stock, and sets the
#     row to CANCELLED, which is what takes it out of the depot's pickup queue (the queue
#     query filters on status). Refused only once staff mark it USED, which cannot happen
#     inside the second this script holds it.
#   DELETE .../payment-methods/:id   removes the card, and the service promotes another
#     method to default by itself.
#   PATCH  .../auth/me               puts the customer's real name back.
#
# A failed undo is a FAILURE, not a warning, and it names the row: residue nobody knows
# about is the exact thing this rewrite exists to stop, and a human has to be able to
# finish the job by hand.
#
# Called inline before the summary — so a failed undo reaches the exit code — and from the
# EXIT trap as well, so an interrupt or an unexpected abort still cleans up. `CLEANED`
# makes the second call a no-op.
smoke_cleanup() {
  if [ -n "$CLEANED" ]; then return 0; fi
  CLEANED=1
  if [ -n "$REDEMPTION_ID" ]; then
    CX=$(curl -s -XPOST "$GW/loyalty/api/v1/rewards/redemptions/$REDEMPTION_ID/cancel" -b "$JAR")
    if echo "$CX" | j 'd.status === "CANCELLED"' >/dev/null 2>&1; then
      ok "redeem dibatalkan lagi (poin kembali, antrean depot bersih)"
    else
      no "redemption $REDEMPTION_ID MASIH aktif di antrean depot ${DEPOT:-?} — batalkan manual: $CX"
    fi
  fi
  if [ -n "$PMID" ]; then
    if curl -s -o /dev/null -w '%{http_code}' -XDELETE "$GW/customers/api/v1/payment-methods/$PMID" -b "$JAR" |
      grep -qE '^(200|204)$'; then
      ok "payment method dihapus lagi"
    else
      no "payment method $PMID TERTINGGAL di akun $PHONE — hapus manual"
    fi
  fi
  if [ -n "$ORIG_NAME" ]; then
    # Built by node, not by string interpolation: a real name can contain a quote, and a
    # broken JSON body here would leave the account called "Smoke Edited" forever.
    NB=$(SMOKE_ORIG="$ORIG_NAME" node -e 'process.stdout.write(JSON.stringify({fullName:process.env.SMOKE_ORIG}))')
    if curl -s -XPATCH "$GW/auth/api/v1/auth/me" -b "$JAR" -H 'content-type: application/json' -d "$NB" |
      j 'd.fullName' >/dev/null 2>&1; then
      ok "nama profil dikembalikan"
    else
      no "profil $PHONE MASIH bernama 'Smoke Edited' — kembalikan ke '$ORIG_NAME' manual"
    fi
  fi
  # Explicit, because otherwise this function's status is whatever the last `if` test
  # happened to be — which is 1 on the common path where there was nothing to undo. Harmless
  # today (`set -e` is off here) and a deploy-reddening trap the moment somebody turns it on.
  return 0
}
trap 'smoke_cleanup; rm -f "$JAR"' EXIT
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
#
# Only the SHORTFALL, and only when there is one. The old line granted COST+200 on every
# single run — points are a liability on a real account, and they only ever went up. With
# the cancel in smoke_cleanup refunding the debit, the balance never falls either, so this
# fires once on a fresh demo account and is a no-op on every deploy after that.
BAL=$(curl -s "$GW/loyalty/api/v1/loyalty/me" -b "$JAR" | j 'd.pointsBalance' || echo 0)
# An unreadable balance must not become a $(( )) syntax error that kills the rest of the run.
case "$BAL" in '' | *[!0-9]*) BAL=0 ;; esac
NEED=$((COST + 200 - BAL))
if [ "$NEED" -le 0 ]; then
  ok "saldo $BAL poin sudah cukup untuk reward $COST — tidak menambah poin"
else
  GRANT=$($DC exec -T loyalty node -e '
const [customerId, points] = process.argv.slice(1);
fetch("http://localhost:3009/api/v1/loyalty/reward", {
  method: "POST",
  headers: { "x-internal-key": process.env.INTERNAL_SERVICE_KEY, "content-type": "application/json" },
  body: JSON.stringify({ customerId, points: Number(points), reason: "smoke" }),
}).then(async (r) => console.log(r.ok ? "ok" : `${r.status} ${await r.text()}`));
' "$CID" "$NEED" 2>&1 | tr -d '\r')
  if [ "$GRANT" = "ok" ]; then ok "grant $NEED poin (saldo $BAL -> $((BAL + NEED)))"; else no "grant poin: $GRANT"; fi
fi

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
# Both calls carry the same idempotency key, so this is ONE redemption — one id to give back.
REDEMPTION_ID=$(echo "$R1" | j 'd.redemptionId' || true)
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

# The name goes back afterwards (smoke_cleanup), so read the real one FIRST. An account with
# no name at all is the one case where the edit cannot be undone — PATCHing an empty string
# back is not the same as the null it had — so the step is skipped rather than leaving a
# customer permanently called "Smoke Edited".
ORIG_NAME=$(curl -s $GW/auth/api/v1/auth/me -b "$JAR" | j 'd.fullName ?? ""' || true)
if [ -z "$ORIG_NAME" ]; then
  ok "profile edit dilewati: akun $PHONE belum punya nama, jadi tidak ada yang bisa dikembalikan"
else
  PR=$(curl -s -XPATCH $GW/auth/api/v1/auth/me -b "$JAR" -H 'content-type: application/json' -d '{"fullName":"Smoke Edited"}')
  echo "$PR"|j 'd.fullName === "Smoke Edited"' >/dev/null 2>&1 && ok "profile edit" || no "profile: $PR"
fi
# Inline, not only in the trap: an undo that FAILS has to be able to fail this script, and a
# trap that runs after `exit` cannot change the code that is already on its way out.
smoke_cleanup
if [ "$FAILED" -gt 0 ]; then
  echo "== selesai: $FAILED langkah GAGAL =="
  exit 1
fi
echo "== selesai: semua langkah lulus =="
