#!/usr/bin/env bash
# Ask production from OUTSIDE the box.
#
#   API_URL=https://api.example WEB_HOST=example.com bash scripts/uptime-probe.sh
#
# Every alarm this platform has — Prometheus, Alertmanager, the watchdog, the cron checks, the
# 5xx pings from inside the services — runs ON the VPS it is watching. A dead VPS, a provider
# outage, a lapsed certificate or a broken route to the box cannot report itself: at 02:00 the
# outage was silent until the first customer complained. This is the one check that does not
# live there. It runs from GitHub Actions (.github/workflows/uptime.yml), so it keeps working
# when the box does not.
#
# Three questions, deliberately shallow-to-deep:
#   /health                        the gateway answers at all (TLS, DNS, the process)
#   /depots/api/v1/depots          the request gets through the gateway to depot-service and its
#                                  database and back — the path every screen depends on
#   https://<web>/                 the customer app itself is being served
#   https://<ai web>/api/health    the AI web answers with its database (HD-10)
# and, for the api, the web and the AI web host, how many days the served TLS certificate has
# left: Caddy renews them by itself, so a renewal that keeps failing is silent until browsers
# refuse the site. Fewer than CERT_WARN_DAYS (default 14) fails the run while there is time.
#
# A check must fail on ATTEMPTS consecutive tries (default 3, 10s apart) before it counts: one
# dropped connection from a shared runner is not an outage, and a probe that cries wolf is
# skipped by everybody within a week. Exit 1 on a real failure, which turns the run red and
# makes GitHub email the owner; ALERT_WEBHOOK_URL (optional) also posts to the ops channel.
set -uo pipefail

API="${API_URL:?set API_URL, e.g. https://api.hydromart-digital.com}"
WEB="${WEB_HOST:?set WEB_HOST, e.g. hydromart-digital.com}"
# The AI web's public name is not secret; a repository variable can move it.
AI_WEB="${AI_WEB_HOST:-ai.hydromart-digital.com}"
ATTEMPTS="${PROBE_ATTEMPTS:-3}"
PAUSE="${PROBE_PAUSE:-10}"
CERT_WARN_DAYS="${CERT_WARN_DAYS:-14}"
FAILED=()
EXPIRING=()

check() {
  local name="$1" url="$2" needle="${3:-}" reply code body i
  for i in $(seq 1 "$ATTEMPTS"); do
    reply="$(curl -sS -m 20 -w '\n%{http_code}' "$url" 2>&1)" || true
    code="$(printf '%s' "$reply" | tail -n 1)"
    body="$(printf '%s' "$reply" | sed '$d')"
    if [ "$code" = 200 ] && { [ -z "$needle" ] || printf '%s' "$body" | grep -qi -- "$needle"; }; then
      echo "ok   $name — 200 (attempt $i)"
      return 0
    fi
    [ "$i" -lt "$ATTEMPTS" ] && sleep "$PAUSE"
  done
  echo "FAIL $name — $url answered '${code:-nothing}' on $ATTEMPTS tries"
  return 1
}

# Days left on the certificate a host serves, read the way a browser meets it (SNI). A host
# that cannot be read on ATTEMPTS tries is reported too: that is a broken TLS endpoint.
cert() {
  local host="$1" end ts days i
  for i in $(seq 1 "$ATTEMPTS"); do
    end="$(echo | timeout 20 openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null |
      openssl x509 -noout -enddate 2>/dev/null | sed -n 's/^notAfter=//p')"
    ts="$( [ -n "$end" ] && date -u -d "$end" +%s 2>/dev/null)"
    if [ -n "$ts" ]; then
      days=$(((ts - $(date -u +%s)) / 86400))
      if [ "$days" -ge "$CERT_WARN_DAYS" ]; then
        echo "ok   certificate of $host — $days days left"
        return 0
      fi
      echo "FAIL certificate of $host — $days days left (renewal is not happening)"
      echo "$host ($days days)" > "$SLOT.expiring"
      return 1
    fi
    [ "$i" -lt "$ATTEMPTS" ] && sleep "$PAUSE"
  done
  echo "FAIL certificate of $host could not be read on $ATTEMPTS tries"
  echo "$host" > "$SLOT.unreadable"
  return 1
}

# Every check runs at the same time: one after another, a full outage (4 checks + 3 hosts, each
# up to ATTEMPTS x 20 s plus pauses) would outlast the job's 5 minutes and be cancelled before it
# could post. Each job keeps its own output, printed in order once all have finished.
RES="$(mktemp -d)"
trap 'rm -rf "$RES"' EXIT
n=0
spawn() { # <label> <command...>: run one check in the background
  n=$((n + 1))
  local slot
  slot="$RES/$(printf '%02d' "$n")"
  echo "$1" > "$slot.label"
  shift
  (
    SLOT="$slot" "$@" > "$slot.out" 2>&1
    echo "$?" > "$slot.rc"
  ) &
}
spawn "gateway /health" check "gateway /health" "${API%/}/health"
spawn "gateway to depot-service and database" check "gateway to depot-service and database" "${API%/}/depots/api/v1/depots?limit=1" '"items"'
spawn "customer web app" check "customer web app" "https://${WEB}/" '<html'
spawn "AI web /api/health" check "AI web /api/health" "https://${AI_WEB}/api/health" '"status":"ok"'
API_HOST="${API#*://}"
API_HOST="${API_HOST%%/*}"
for host in "$API_HOST" "$WEB" "$AI_WEB"; do spawn "certificate of $host" cert "$host"; done
wait

UNREADABLE=()
for out in "$RES"/*.out; do
  slot="${out%.out}"
  cat "$out"
  [ "$(cat "$slot.rc" 2>/dev/null)" = 0 ] && continue
  if [ -f "$slot.expiring" ]; then
    EXPIRING+=("$(cat "$slot.expiring")")
  elif [ -f "$slot.unreadable" ]; then
    UNREADABLE+=("$(cat "$slot.unreadable")")
  else
    FAILED+=("$(cat "$slot.label")")
  fi
done

run_url=''
[ -n "${GITHUB_RUN_ID:-}" ] && run_url=" Run: ${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID}"
post() {
  echo "$1"
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -m 10 -X POST -H 'content-type: application/json' \
      --data "{\"text\":\"$1\",\"content\":\"$1\"}" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
}
cert_note=''
[ "${#EXPIRING[@]}" -gt 0 ] && cert_note="TLS certificate renewal is failing: ${EXPIRING[*]} (check Caddy's log on the box)."
[ "${#UNREADABLE[@]}" -gt 0 ] && cert_note="$cert_note TLS certificate could not be read: ${UNREADABLE[*]}."
cert_note="${cert_note# }"

if [ "${#FAILED[@]}" -gt 0 ]; then
  post "🚨 Hydromart is DOWN from outside — ${FAILED[*]}. Nothing on the box can report this.${cert_note:+ $cert_note}$run_url"
  exit 1
fi
if [ -n "$cert_note" ]; then
  # A certificate has days to go, not minutes: said and turned red once a day (01:00-01:09 UTC,
  # 08:00 WIB), a warning the rest of the time, so a 14-day countdown is not 2000 messages.
  hhmm="${PROBE_NOW_HHMM:-$(date -u +%H%M)}"
  if [ "$hhmm" \< 0110 ] && ! [ "$hhmm" \< 0100 ]; then
    post "Hydromart: $cert_note$run_url"
    exit 1
  fi
  echo "::warning::$cert_note (posted and failed once a day, at 08:00 WIB)"
  echo "uptime-probe: every site is up; certificate warning above"
  exit 0
fi
echo "uptime-probe: every check passed"
