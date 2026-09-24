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

export PATH="$WORK/bin:$PATH" CALLS="$WORK/calls" POSTS="$WORK/posts" TABLE="$WORK/table"
export API_URL="https://api.example" WEB_HOST="web.example" PROBE_PAUSE=0 PROBE_ATTEMPTS=3

run() {
  rm -f "$CALLS" "$POSTS"
  OUT="$(bash "$ROOT/scripts/uptime-probe.sh" 2>&1)"
  RC=$?
}

healthy() {
  cat > "$TABLE" <<'T'
/health|200|{"status":"ok"}
/depots/api/v1/depots|200|{"items":[{"code":"X"}]}
WEB|200|<!DOCTYPE html><html lang="id">
T
}

echo "uptime-probe:"

healthy
run
[ "$RC" = 0 ] && ok "green when all three checks answer" || bad "should pass: $OUT"

healthy
sed -i 's#^/health|200#/health|500#' "$TABLE"
run
[ "$RC" = 1 ] && ok "RED when the gateway health check keeps failing" || bad "a dead gateway must fail (rc=$RC)"
case "$OUT" in *"gateway /health"*) ok "  ...and names what failed" ;; *) bad "  expected the check name in: $OUT" ;; esac
[ "$(grep -c '/health$' "$CALLS")" = 3 ] && ok "  ...after three tries, not one" || bad "should have tried 3 times: $(cat "$CALLS")"

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
