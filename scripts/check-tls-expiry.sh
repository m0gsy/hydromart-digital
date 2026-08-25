#!/usr/bin/env bash
# N13 — say something BEFORE the certificate expires.
#
# Renewal is automatic (Caddy), which is exactly why nobody watches it: the failure mode is
# not "renewal failed loudly", it is "renewal stopped happening and every browser started
# refusing the site on a Tuesday". Automatic and unwatched is one outage away from manual.
#
#   bash scripts/check-tls-expiry.sh              # both domains from .env
#   bash scripts/check-tls-expiry.sh api.example.com
#
# Exits non-zero when any certificate is inside the warning window, and pings
# ALERT_WEBHOOK_URL (the same webhook everything else uses) so it reaches a person rather
# than a log file. Installed weekly by scripts/install-host-cron.sh.
#
# There is no blackbox exporter in this stack and adding one to answer one question would
# be a container, a scrape config and a dashboard for a number `openssl` already knows.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=/dev/null
[ -f .env ] && . ./scripts/load-env.sh
# shellcheck source=scripts/lib/deploy-common.sh
. ./scripts/lib/deploy-common.sh

WARN_DAYS="${TLS_WARN_DAYS:-21}"

domains=()
if [ "$#" -gt 0 ]; then
  domains=("$@")
else
  [ -n "${WEB_DOMAIN:-}" ] && domains+=("$WEB_DOMAIN")
  [ -n "${API_DOMAIN:-}" ] && domains+=("$API_DOMAIN")
fi

if [ "${#domains[@]}" -eq 0 ]; then
  # Not a failure: a bare-IP deploy has no certificate to watch, and saying so is more
  # useful than a green check that measured nothing.
  echo "no WEB_DOMAIN/API_DOMAIN set — nothing to check (bare-IP deploy has no TLS)"
  exit 0
fi

failed=0
for domain in "${domains[@]}"; do
  end="$(echo | openssl s_client -servername "$domain" -connect "$domain:443" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
  if [ -z "$end" ]; then
    echo "!! $domain: could not read a certificate at all"
    alert "TLS check could not read a certificate for $domain"
    failed=1
    continue
  fi
  end_epoch="$(date -d "$end" +%s 2>/dev/null || echo 0)"
  now_epoch="$(date +%s)"
  days=$(( (end_epoch - now_epoch) / 86400 ))
  if [ "$end_epoch" -eq 0 ]; then
    echo "!! $domain: unreadable expiry date ($end)"
    failed=1
  elif [ "$days" -le "$WARN_DAYS" ]; then
    echo "!! $domain: certificate expires in $days day(s) — $end"
    alert "TLS certificate for $domain expires in $days day(s). Renewal is automatic; if this number keeps falling, it has stopped."
    failed=1
  else
    echo "ok $domain: $days day(s) left"
  fi
done

exit "$failed"
