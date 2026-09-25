#!/usr/bin/env bash
# Say something BEFORE the SMS credit runs out.
#
#   bash scripts/check-zenziva-balance.sh
#
# Login is an SMS one-time code. When the Zenziva credit reaches zero nobody can sign in, on any
# depot, and until now nothing on this box knew the number: the first sign was a customer
# saying the code never came. This asks Zenziva the way the OTP adapter does — from inside the
# auth container, so the credentials never leave it — and pings ALERT_WEBHOOK_URL when
#   - the balance is under ZENZIVA_MIN_BALANCE (rupiah, default 250000), or
#   - the credit expires within ZENZIVA_EXPIRY_WARN_DAYS (default 14), or
#   - the balance could not be read TWICE IN A ROW (one failed call is a network blip; two is a
#     revoked key or a changed API, and a monitor that cannot read must not look like a healthy one).
#
# Messages carry no live number, so `alert_once` speaks when the condition starts, once a week
# while it lasts, and again if it clears and comes back — not on every run. Installed every six hours by
# scripts/install-host-cron.sh. Exit 1 when it found something to say.
set -uo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=/dev/null
[ -f .env ] && . ./scripts/load-env.sh
# shellcheck source=scripts/lib/deploy-common.sh
. ./scripts/lib/deploy-common.sh

MIN="${ZENZIVA_MIN_BALANCE:-250000}"
WARN_DAYS="${ZENZIVA_EXPIRY_WARN_DAYS:-14}"

if [ "${OTP_DELIVERY_CHANNEL:-}" != "zenziva" ]; then
  echo "OTP channel is '${OTP_DELIVERY_CHANNEL:-unset}', not zenziva — no SMS credit to watch"
  exit 0
fi

mkdir -p "$ALERT_MEMORY_DIR" 2>/dev/null || true
UNREADABLE="$ALERT_MEMORY_DIR/zenziva-unreadable.count"

# shellcheck disable=SC2086  # $COMPOSE is a command line, split on purpose
line="$($COMPOSE exec -T -e ZENZIVA_MODE=monitor auth node - < scripts/lib/zenziva-balance.cjs 2>/dev/null | grep -E '^balance=[0-9]+ days=(none|-?[0-9]+)$' | tail -1)"

if [ -z "$line" ]; then
  strikes=$(($(cat "$UNREADABLE" 2>/dev/null || echo 0) + 1))
  printf '%s' "$strikes" > "$UNREADABLE" 2>/dev/null || true
  echo "!! could not read the Zenziva balance ($strikes in a row)"
  if [ "$strikes" -ge 2 ]; then
    alert_once zenziva-unreadable "Cannot read the Zenziva SMS balance (2 checks in a row) — a revoked key or a changed API. Login OTP may stop without warning. Check ZENZIVA_USERKEY/PASSKEY and console.zenziva.net."
  fi
  exit 1
fi

rm -f "$UNREADABLE" 2>/dev/null || true
alert_clear zenziva-unreadable

balance="${line#balance=}"
balance="${balance%% *}"
days="${line##*days=}"
echo "Zenziva balance Rp$balance, credit expiry: ${days} day(s)"

rc=0
if [ "$balance" -lt "$MIN" ]; then
  echo "!! balance Rp$balance is under Rp$MIN"
  alert_once zenziva-low "Zenziva SMS credit is under Rp${MIN} — login OTP stops at zero. Top up at console.zenziva.net."
  rc=1
else
  alert_clear zenziva-low
fi

if [ "$days" != none ] && [ "$days" -le "$WARN_DAYS" ]; then
  echo "!! the credit expires in $days day(s)"
  alert_once zenziva-expiry "Zenziva SMS credit expires within ${WARN_DAYS} days — top up or renew at console.zenziva.net before login OTP stops."
  rc=1
else
  alert_clear zenziva-expiry
fi
exit "$rc"
