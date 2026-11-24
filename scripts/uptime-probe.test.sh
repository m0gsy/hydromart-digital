#!/usr/bin/env bash
# The runnable check for scripts/uptime-probe.sh.
#
#   bash scripts/uptime-probe.test.sh
#
# Drives the real script against a stand-in `curl`, and shows it: quiet when everything answers,
# red (and naming what failed) when something does not, patient with a single dropped
# connection, and unfooled by a 200 that carries the wrong body.
set -uo pipefail
# CI invokes this as `bash -e file`; the negative cases below are SUPPOSED to exit non-zero.
set +e
cd "$(dirname "$0")/.."
ROOT="$PWD"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

mkdir -p "$WORK/bin"
# The stand-in reads a table "<url-fragment>|<code>|<body>", one row per line, and counts calls
# per URL so a scenario can fail once and then recover. A POST (the alert) is logged instead.
cat > "$WORK/bin/curl" <<'SH'
#!/usr/bin/env bash
if printf '%s ' "$@" | grep -q -- '-X POST'; then
  printf '%s\n' "$*" >> "$POSTS"
  exit 0
fi
url="${@: -1}"
n=$(grep -c "^$url\$" "$CALLS" 2>/dev/null || true)
echo "$url" >> "$CALLS"
row="$(grep -F "$(printf '%s' "$url" | sed 's#^https://[^/]*##' | cut -d'?' -f1)|" "$TABLE" | head -1)"
if [ -z "$row" ]; then row="$(grep -F "WEB|" "$TABLE" | head -1)"; fi
IFS='|' read -r _ codes body <<< "$row"
IFS=',' read -ra seq <<< "$codes"
idx=$(( n < ${#seq[@]} ? n : ${#seq[@]} - 1 ))
printf '%s\n%s' "$body" "${seq[$idx]}"
SH
chmod +x "$WORK/bin/curl"
# The stand-in openssl: `s_client` "connects" (logging the host it was asked for), `x509` prints
# the end date CERT_END (or nothing when CERT_UNREADABLE is set, as a broken TLS endpoint would).
cat > "$WORK/bin/openssl" <<'SH'
#!/usr/bin/env bash
case "$1" in
  s_client) printf '%s\n' "$*" | sed -n 's/.*-servername \([^ ]*\).*/\1/p' >> "$CERTS"; echo CERT ;;
  x509) cat >/dev/null; [ -n "${CERT_UNREADABLE:-}" ] || echo "notAfter=${CERT_END:-Dec 31 23:59:59 2099 GMT}" ;;
esac
exit 0
SH
chmod +x "$WORK/bin/openssl"

export PATH="$WORK/bin:$PATH" CALLS="$WORK/calls" POSTS="$WORK/posts" TABLE="$WORK/table" CERTS="$WORK/certs"
export API_URL="https://api.example" WEB_HOST="web.example" AI_WEB_HOST="ai.example" PROBE_PAUSE=0 PROBE_ATTEMPTS=3

run() {
  rm -f "$CALLS" "$POSTS" "$CERTS"
  OUT="$(bash "$ROOT/scripts/uptime-probe.sh" 2>&1)"
  RC=$?
}

healthy() {
  cat > "$TABLE" <<'T'
/health|200|{"status":"ok"}
/api/health|200|{"status":"ok","database":"ok","rowSecurity":"enforced"}
/depots/api/v1/depots|200|{"items":[{"code":"X"}]}
WEB|200|<!DOCTYPE html><html lang="id">
T
}

echo "uptime-probe:"

healthy
run
[ "$RC" = 0 ] && ok "green when all four checks answer and every certificate has time left" || bad "should pass: $OUT"
[ "$(sort "$CERTS" 2>/dev/null | tr '\n' ' ')" = "ai.example api.example web.example " ] &&
  ok "  ...the certificates of the api, the web and the AI web host are read (SNI)" || bad "certificates read: $(cat "$CERTS" 2>/dev/null)"

healthy
sed -i 's#^/api/health|200|.*#/api/health|503|{"status":"down","database":"unreachable"}#' "$TABLE"
run
[ "$RC" = 1 ] && case "$OUT" in *"AI web /api/health"*) true ;; *) false ;; esac &&
  ok "RED when the AI web cannot reach its database (503), named" || bad "a down AI web must fail (rc=$RC): $OUT"

healthy
SOON="$(date -u -d '+5 days' '+%b %d %H:%M:%S %Y GMT')"
CERT_END="$SOON" PROBE_NOW_HHMM=0105 run
[ "$RC" = 1 ] && case "$OUT" in *"certificate of api.example"*"days left"*) true ;; *) false ;; esac &&
  ok "RED when a certificate has fewer than 14 days left (renewal failing), naming the host, in the daily window" || bad "an expiring certificate must fail at 01:05 UTC (rc=$RC): $OUT"
CERT_END="$SOON" PROBE_NOW_HHMM=1200 ALERT_WEBHOOK_URL="http://hook.invalid/x" run
[ "$RC" = 0 ] && [ ! -f "$POSTS" ] && case "$OUT" in *"::warning::TLS certificate renewal is failing"*) true ;; *) false ;; esac &&
  ok "  ...outside the daily window: a warning, no post, the run stays green (no 2000 messages)" || bad "outside the window (rc=$RC): $OUT $(cat "$POSTS" 2>/dev/null)"
CERT_END="$(date -u -d '+30 days' '+%b %d %H:%M:%S %Y GMT')" PROBE_NOW_HHMM=0105 run
[ "$RC" = 0 ] && ok "  ...30 days left is fine" || bad "30 days must pass: $OUT"
CERT_UNREADABLE=1 PROBE_NOW_HHMM=0105 ALERT_WEBHOOK_URL="http://hook.invalid/x" run
[ "$RC" = 1 ] && case "$OUT" in *"could not be read"*) true ;; *) false ;; esac &&
  grep -q "certificate could not be read" "$POSTS" && ! grep -q "renewal is failing" "$POSTS" &&
  ok "RED when a certificate cannot be read at all, said as unreadable (not as a failing renewal)" || bad "an unreadable certificate (rc=$RC): $OUT $(cat "$POSTS" 2>/dev/null)"
CERT_END="$SOON" PROBE_NOW_HHMM=0105 ALERT_WEBHOOK_URL="http://hook.invalid/x" run
[ -f "$POSTS" ] && grep -q "certificate renewal is failing" "$POSTS" && ! grep -q "DOWN" "$POSTS" &&
  ok "  ...and the ops channel hears a certificate warning, not an outage" || bad "certificate alert text: $(cat "$POSTS" 2>/dev/null)"
healthy
sed -i 's#^/health|200#/health|500#' "$TABLE"
CERT_END="$SOON" PROBE_NOW_HHMM=1200 ALERT_WEBHOOK_URL="http://hook.invalid/x" run
[ "$RC" = 1 ] && grep -q "DOWN" "$POSTS" && grep -q "renewal is failing" "$POSTS" &&
  ok "an outage with an expiring certificate posts at once and names both" || bad "outage + certificate (rc=$RC): $(cat "$POSTS" 2>/dev/null)"
# Every check at once: with each of the 7 failing after 3 tries and 2 s pauses, one after another
# would take 7 x 4 s = 28 s (and, live, 7 x 80 s: past the job's 5 minutes); together about 4 s.
cat > "$TABLE" <<'T'
WEB|500|down
T
start=$SECONDS
CERT_UNREADABLE=1 PROBE_PAUSE=2 run
elapsed=$((SECONDS - start))
[ "$RC" = 1 ] && [ "$elapsed" -lt 15 ] && ok "the checks run at the same time: a total outage is reported in ${elapsed}s, not 28s" ||
  bad "a total outage took ${elapsed}s (rc=$RC)"

healthy
sed -i 's#^/health|200#/health|500#' "$TABLE"
run
[ "$RC" = 1 ] && ok "RED when the gateway health check keeps failing" || bad "a dead gateway must fail (rc=$RC)"
case "$OUT" in *"gateway /health"*) ok "  ...and names what failed" ;; *) bad "  expected the check name in: $OUT" ;; esac
[ "$(grep -c 'api.example/health$' "$CALLS")" = 3 ] && ok "  ...after three tries, not one" || bad "should have tried 3 times: $(cat "$CALLS")"

healthy
sed -i 's#^/health|200#/health|500,200#' "$TABLE"
run
[ "$RC" = 0 ] && ok "one dropped connection that recovers is not an outage" || bad "a single blip must not fail: $OUT"

healthy
sed -i 's#^/depots/api/v1/depots|200|.*#/depots/api/v1/depots|200|<html>maintenance</html>#' "$TABLE"
run
[ "$RC" = 1 ] && ok "RED on a 200 that carries the wrong body (the path through to the database)" || bad "a wrong body must fail (rc=$RC)"

healthy
sed -i 's#^WEB|200|.*#WEB|200|Bad gateway#' "$TABLE"
run
[ "$RC" = 1 ] && ok "RED when the web app answers something that is not the app" || bad "a non-HTML page must fail (rc=$RC)"

healthy
sed -i 's#^/health|200#/health|500#' "$TABLE"
ALERT_WEBHOOK_URL="http://hook.invalid/x" run
[ -f "$POSTS" ] && grep -q "DOWN" "$POSTS" && ok "posts to the ops channel when a webhook is configured" || bad "should have posted: $(cat "$POSTS" 2>/dev/null)"

healthy
run
[ ! -f "$POSTS" ] && ok "posts nothing when everything is up" || bad "a healthy run must not post"

healthy
sed -i 's#^/health|200#/health|500#' "$TABLE"
run
[ "$RC" = 1 ] && [ ! -f "$POSTS" ] && ok "with no webhook it still fails the run (that is what emails the owner)" || bad "must fail even without a webhook (rc=$RC)"

if [ "$fails" -gt 0 ]; then
  echo "uptime-probe: $fails check(s) failed" >&2
  exit 1
fi
echo "uptime-probe: all checks passed"
