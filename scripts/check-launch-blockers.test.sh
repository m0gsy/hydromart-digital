#!/usr/bin/env bash
# Self-check for scripts/check-launch-blockers.mjs.
#
#   bash scripts/check-launch-blockers.test.sh
#
# A launch gate is the one gate nobody re-reads: it goes red once, somebody fixes the thing,
# and from then on its green is taken on faith. So both failure modes have to be proved, per
# blocker class — that it CAN go red, and that it CAN go green. The repo already carries
# about twenty checks that ran on every release, never went red, and proved nothing.
#
# Each input is neutralised on its own, through the overrides the real script documents: the
# positional env file, ROTATION_RUNBOOK, SERVICES_ROOT and PG_CONTAINER. No fixture is written
# into the repo tree, and nothing here WRITES to a database — the gate only ever reads.
#
# Needs a reachable Postgres for the two live-data classes (L2.3, L2.4). Without one they
# report UNKNOWN, which under --production is still a failure — so this file skips only the
# two assertions that distinguish UNKNOWN from BLOCKED, and says so.
set -uo pipefail
cd "$(dirname "$0")/.."
# An array, so every call is properly quoted: an unquoted two-word command variable is
# the one shellcheck finding this file would otherwise carry for ever.
GATE=(node scripts/check-launch-blockers.mjs)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

# `run <expect-exit> <label> -- args...` — runs the gate, keeps its output in $OUT.
OUT="$TMP/out.txt"
run() {
  local want="$1" label="$2"
  shift 3 # want, label, and the literal `--`
  # `set -e` is off on purpose: a non-zero exit is the thing under test.
  "${GATE[@]}" "$@" >"$OUT" 2>&1
  local got=$?
  if [ "$got" -ne "$want" ]; then
    bad "$label (expected exit $want, got $got)"
    sed -n '1,40p' "$OUT"
    return 1
  fi
  return 0
}

# A blocker's verdict line, e.g. "BLOCKED L2.1  OTP delivery channel".
verdict() { sed -n "s/^\([A-Za-z]*\) *\(${1}\) .*/\1/p" "$OUT" | head -1; }

expect_verdict() {
  local id="$1" want="$2" label="$3"
  local got
  got="$(verdict "$id")"
  [ "$got" = "$want" ] && ok "$label" || {
    bad "$label ($id is $got, expected $want)"
    grep -A6 "$id" "$OUT" | sed -n '1,8p'
  }
}

echo "check-launch-blockers.mjs:"

# A postgres we can reach decides which assertions are meaningful.
if docker exec "${PG_CONTAINER:-hydromart-postgres}" true >/dev/null 2>&1; then
  HAVE_DB=1
else
  HAVE_DB=0
  echo "  (no reachable ${PG_CONTAINER:-hydromart-postgres} — L2.3/L2.4 will read UNKNOWN)"
fi

# A rotation ledger that says the job was done. Same table shape as the real runbook: the
# S3 row is found by the header above it, not by position, so the schedule table further up
# must not be what gets read (it was, in the first version of this gate).
cat >"$TMP/rotated.md" <<'MD'
# Rotasi rahasia

| Rahasia | Ritme | Kenapa segitu |
| --- | --- | --- |
| Kunci S3 / object storage | 90 hari | kunci yang pernah bocor tetap sah sampai dicabut |

## Catatan rotasi

| Rahasia | Terakhir dirotasi | Oleh | Yang lama sudah dicabut? |
| --- | --- | --- | --- |
| `Kunci S3` | 2026-08-25 | pemilik | ya |
MD

# A ledger whose row is gone entirely: the table was restructured and the gate is now blind.
cat >"$TMP/no-row.md" <<'MD'
## Catatan rotasi

| Rahasia | Terakhir dirotasi | Oleh | Yang lama sudah dicabut? |
| --- | --- | --- | --- |
| `JWT_SECRET` | 2026-08-25 | pemilik | ya |
MD

# An env file with every repo-answerable blocker closed. The values are shaped like the real
# ones and belong to nobody: a Zenziva key is an opaque string, so a fake one here proves the
# gate reads it without pretending to be a credential that works.
cat >"$TMP/good.env" <<'ENV'
OTP_DELIVERY_CHANNEL=zenziva
ZENZIVA_USERKEY=selfcheck-not-a-real-userkey
ZENZIVA_PASSKEY=selfcheck-not-a-real-passkey
STORAGE_DRIVER=s3
HR_STORAGE_S3_SECRET_ACCESS_KEY=selfcheck-not-a-real-secret
ENV

# The host the APK claims, read out of the build instead of written here a second time.
# 8635c7a1 — the commit titled "L2.6 host App Links yang benar" — corrected build.gradle to
# hydromart-digital.com and left this fixture on the old hydromart.id. From then on the
# "good" path was judged BLOCKED for a host mismatch, so the fetch below never ran: the one
# half of L2.6 that can tell verified from unverified was dead, and the self-check had been
# red ever since. A fixture that names the host twice drifts once.
CLAIMED_HOST="$(sed -n "s/.*hydromartWebHost *= *project\.findProperty([^)]*) *?: *'\([^']*\)'.*/\1/p" \
  mobile/android/app/build.gradle | head -1)"
[ -n "$CLAIMED_HOST" ] || bad 'cannot read hydromartWebHost out of mobile/android/app/build.gradle'
echo "WEB_DOMAIN=$CLAIMED_HOST" >> "$TMP/good.env"

# ---------------------------------------------------------------- L2.1, OTP

cp "$TMP/good.env" "$TMP/console.env"
sed -i 's/^OTP_DELIVERY_CHANNEL=.*/OTP_DELIVERY_CHANNEL=console/' "$TMP/console.env"
if run 1 "console channel refused" -- --production "$TMP/console.env"; then
  expect_verdict L2.1 BLOCKED "L2.1 refuses the console channel"
  grep -q 'container log' "$OUT" || bad "L2.1 does not say WHY console is unsafe"
fi

# The real production contract: a channel is named, its credentials are blank. This is the
# state the plan describes as "the code is finished, only the credentials are missing".
if run 1 "blank provider credentials refused" -- --production .env.production.example; then
  expect_verdict L2.1 BLOCKED "L2.1 refuses zenziva with blank keys"
fi

# A credential that is set but points at a laptop. The local .env really carries this.
cp "$TMP/good.env" "$TMP/stub.env"
cat >>"$TMP/stub.env" <<'ENV'
OTP_DELIVERY_CHANNEL=sms
SMS_API_BASE_URL=http://host.docker.internal:4599
SMS_API_TOKEN=devlocal
ENV
if run 1 "local SMS stub refused" -- --production "$TMP/stub.env"; then
  expect_verdict L2.1 BLOCKED "L2.1 refuses an SMS base URL on host.docker.internal"
fi

# The escape hatch, on a channel that is otherwise fine. Read out of the schema, so this
# reads the acknowledgement string from the same place the service does.
ACK="$(sed -n "s/^export const CONSOLE_ACK = '\(.*\)';$/\1/p" \
  services/auth-service/src/config/env.validation.ts)"
if [ -z "$ACK" ]; then
  bad "cannot read CONSOLE_ACK out of auth-service's schema — the L2.1 ack case is untested"
else
  cp "$TMP/good.env" "$TMP/ack.env"
  echo "OTP_CONSOLE_ACK=$ACK" >>"$TMP/ack.env"
  if run 1 "console acknowledgement refused" -- --production "$TMP/ack.env"; then
    expect_verdict L2.1 BLOCKED "L2.1 refuses OTP_CONSOLE_ACK even on a real channel"
  fi
fi

# And it must be able to PASS. A gate that cannot go green is a gate people route around.
"${GATE[@]}" "$TMP/good.env" >"$OUT" 2>&1
expect_verdict L2.1 ok "L2.1 passes on a fully configured channel"

# ------------------------------------------------------- L2.2, key rotation

# The real runbook: never rotated.
"${GATE[@]}" "$TMP/good.env" >"$OUT" 2>&1
expect_verdict L2.2 BLOCKED "L2.2 refuses a never-rotated S3 key"
grep -q 'still a valid key' "$OUT" || bad "L2.2 does not explain that the old key still works"

# The ledger says it was done, and says the old key was revoked.
ROTATION_RUNBOOK="$TMP/rotated.md" "${GATE[@]}" "$TMP/good.env" >"$OUT" 2>&1
expect_verdict L2.2 ok "L2.2 passes once the ledger records a revoked rotation"

# Rotated, old key NOT revoked — two live secrets, not one replaced.
sed 's/| pemilik | ya |/| pemilik |  |/' "$TMP/rotated.md" >"$TMP/half.md"
ROTATION_RUNBOOK="$TMP/half.md" "${GATE[@]}" --production "$TMP/good.env" >"$OUT" 2>&1
expect_verdict L2.2 BLOCKED "L2.2 refuses a rotation whose old key was never revoked"

# The ledger row is gone: not measurable, and that is not a pass.
ROTATION_RUNBOOK="$TMP/no-row.md" "${GATE[@]}" --production "$TMP/good.env" >"$OUT" 2>&1
expect_verdict L2.2 UNKNOWN "L2.2 reports UNKNOWN when its ledger row disappears"

# A runbook that is not there at all.
ROTATION_RUNBOOK="$TMP/does-not-exist.md" "${GATE[@]}" --production "$TMP/good.env" >"$OUT" 2>&1
expect_verdict L2.2 UNKNOWN "L2.2 reports UNKNOWN when the runbook is missing"

# Placeholder credentials in the env file, on top of a clean ledger.
cp "$TMP/good.env" "$TMP/dummy.env"
sed -i 's/^HR_STORAGE_S3_SECRET_ACCESS_KEY=.*/HR_STORAGE_S3_SECRET_ACCESS_KEY=dummy/' "$TMP/dummy.env"
ROTATION_RUNBOOK="$TMP/rotated.md" "${GATE[@]}" --production "$TMP/dummy.env" >"$OUT" 2>&1
expect_verdict L2.2 BLOCKED "L2.2 refuses a dummy storage secret"

# Local-disk driver in a production configuration.
cp "$TMP/good.env" "$TMP/local.env"
sed -i 's/^STORAGE_DRIVER=.*/STORAGE_DRIVER=local/' "$TMP/local.env"
ROTATION_RUNBOOK="$TMP/rotated.md" "${GATE[@]}" --production "$TMP/local.env" >"$OUT" 2>&1
expect_verdict L2.2 BLOCKED "L2.2 refuses STORAGE_DRIVER=local in production"

# ------------------------------------------- L2.3 / L2.4, the live-data pair

# An unreachable database must NOT read as "nothing wrong". This is the whole reason
# UNKNOWN exists as a third verdict, and it is the assertion that stops this gate becoming
# another one that goes quiet when its instrument breaks.
PG_CONTAINER=hydromart-postgres-does-not-exist \
  "${GATE[@]}" --production "$TMP/good.env" >"$OUT" 2>&1
got=$?
[ "$got" -eq 1 ] && ok "an unreachable database still fails --production" ||
  bad "an unreachable database exited $got — UNKNOWN was treated as a pass"
expect_verdict L2.3 UNKNOWN "L2.3 reports UNKNOWN with no database"
expect_verdict L2.4 UNKNOWN "L2.4 reports UNKNOWN with no database"

if [ "$HAVE_DB" = 1 ]; then
  "${GATE[@]}" "$TMP/good.env" >"$OUT" 2>&1
  expect_verdict L2.3 BLOCKED "L2.3 refuses depots with no payment destination"
  grep -qE 'example digits|no payment destination' "$OUT" ||
    bad "L2.3 named no reason for any depot it rejected"
  expect_verdict L2.4 BLOCKED "L2.4 refuses tunables with no GLOBAL override"
  grep -q 'coded default' "$OUT" || bad "L2.4 did not name a single defaulted tunable"
else
  echo "  skip L2.3/L2.4 BLOCKED cases — no database to measure against"
fi

# The L2.4 anti-rot rule: a key this gate watches must still exist where it says it does.
# Pointing SERVICES_ROOT at an empty tree is the cheapest way to be sure that a renamed or
# retired key is reported, rather than silently checked for ever against nothing.
mkdir -p "$TMP/empty-services"
SERVICES_ROOT="$TMP/empty-services" "${GATE[@]}" --production "$TMP/good.env" >"$OUT" 2>&1
expect_verdict L2.4 UNKNOWN "L2.4 reports UNKNOWN when a watched key leaves its source file"
grep -q 'the gate is checking nothing' "$OUT" ||
  bad "L2.4 did not explain that a vanished key means the check is inert"
# Same tree, and L2.1 reads its channel list out of that same root: no schema, no verdict.
expect_verdict L2.1 UNKNOWN "L2.1 reports UNKNOWN when it cannot read the auth schema"

# ------------------------------------------------------------ L2.6, App Links

# A domain that serves nothing, because nobody set one.
cp "$TMP/good.env" "$TMP/nodomain.env"
sed -i 's/^WEB_DOMAIN=.*/WEB_DOMAIN=/' "$TMP/nodomain.env"
ROTATION_RUNBOOK="$TMP/rotated.md" "${GATE[@]}" --production "$TMP/nodomain.env" >"$OUT" 2>&1
expect_verdict L2.6 BLOCKED "L2.6 refuses a blank WEB_DOMAIN"

# The reserved-TLD placeholder mobile.yml falls back to. It can never resolve, so App Links
# on it can never verify — and nothing reports that, because verification fails open.
cp "$TMP/good.env" "$TMP/reserved.env"
sed -i 's/^WEB_DOMAIN=.*/WEB_DOMAIN=hydromart.example/' "$TMP/reserved.env"
ROTATION_RUNBOOK="$TMP/rotated.md" "${GATE[@]}" --production "$TMP/reserved.env" >"$OUT" 2>&1
expect_verdict L2.6 BLOCKED "L2.6 refuses a reserved-TLD host"

# Served from one domain, claimed by another. Android fetches only the claimed one.
cp "$TMP/good.env" "$TMP/other.env"
sed -i 's/^WEB_DOMAIN=.*/WEB_DOMAIN=app.hydromart.co.id/' "$TMP/other.env"
ROTATION_RUNBOOK="$TMP/rotated.md" "${GATE[@]}" --production "$TMP/other.env" >"$OUT" 2>&1
expect_verdict L2.6 BLOCKED "L2.6 refuses a WEB_DOMAIN the APK does not claim"
grep -q 'and nothing else' "$OUT" || bad "L2.6 did not say which URL Android actually fetches"

# The certificate half is delegated, so it must really be consulted: the repo's own
# assetlinks.json passes today, and that line has to appear.
"${GATE[@]}" "$TMP/good.env" >"$OUT" 2>&1
grep -q 'certificates: OK' "$OUT" ||
  bad "L2.6 never ran check-assetlinks.mjs — the certificate half is unchecked"

# With the host chain intact, --production must actually go and LOOK. Any of the three
# outcomes proves the fetch happened; which one it is depends on the internet, so this
# asserts only that the question was asked. It is the only half of L2.6 that can tell
# verified from unverified, and App Links fail open precisely because nobody asks.
ROTATION_RUNBOOK="$TMP/rotated.md" "${GATE[@]}" --production "$TMP/good.env" >"$OUT" 2>&1
got=$?
[ "$got" -ne 127 ] || bad "the --production run exited 127 — it crashed instead of judging"
grep -qE '/\.well-known/assetlinks\.json (→|answered|is served)|could not fetch' "$OUT" ||
  bad "L2.6 never fetched the claimed host — the one check that separates verified from not"

# ----------------------------------------------------------------- the modes

# Informational is informational: everything above is broken and it still exits 0, or nobody
# will run it on a laptop.
"${GATE[@]}" "$TMP/console.env" >"$OUT" 2>&1
got=$?
[ "$got" -eq 0 ] && ok "informational mode exits 0 with every blocker red" ||
  bad "informational mode exited $got — it is meant to report, not to fail"
grep -q 'informational' "$OUT" || bad "informational mode does not say which mode it is in"

# And the repository's own state, reported without failing. This is the run a person does.
"${GATE[@]}" >"$OUT" 2>&1
got=$?
[ "$got" -eq 0 ] && ok "the default run (env file .env) reports and exits 0" ||
  bad "the default run exited $got"

if [ "$fails" -gt 0 ]; then
  echo "check-launch-blockers.mjs: $fails check(s) failed" >&2
  exit 1
fi
echo "check-launch-blockers.mjs: all checks passed"
