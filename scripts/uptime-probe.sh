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
#
# A check must fail on ATTEMPTS consecutive tries (default 3, 10s apart) before it counts: one
# dropped connection from a shared runner is not an outage, and a probe that cries wolf is
# skipped by everybody within a week. Exit 1 on a real failure, which turns the run red and
# makes GitHub email the owner; ALERT_WEBHOOK_URL (optional) also posts to the ops channel.
set -uo pipefail

API="${API_URL:?set API_URL, e.g. https://api.hydromart-digital.com}"
WEB="${WEB_HOST:?set WEB_HOST, e.g. hydromart-digital.com}"
ATTEMPTS="${PROBE_ATTEMPTS:-3}"
PAUSE="${PROBE_PAUSE:-10}"
FAILED=()

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
  FAILED+=("$name")
  return 1
}

check "gateway /health" "${API%/}/health"
check "gateway to depot-service and database" "${API%/}/depots/api/v1/depots?limit=1" '"items"'
check "customer web app" "https://${WEB}/" '<html'

if [ "${#FAILED[@]}" -gt 0 ]; then
  text="🚨 Hydromart is DOWN from outside — ${FAILED[*]}. Nothing on the box can report this."
  [ -n "${GITHUB_RUN_ID:-}" ] && text="$text Run: ${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID}"
  echo "$text"
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -m 10 -X POST -H 'content-type: application/json' \
      --data "{\"text\":\"${text}\",\"content\":\"${text}\"}" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
  exit 1
fi
echo "uptime-probe: every check passed"
