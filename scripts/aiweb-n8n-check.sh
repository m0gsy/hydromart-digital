#!/usr/bin/env bash
# AI-5: n8n beside the AI web, checked every night (install-host-cron.sh, 04:40 local time).
#
#   bash scripts/aiweb-n8n-check.sh
#
#   1. Drift. Inside the running n8n, hydromart-ai's n8n/bin/drift.mjs compares what is published,
#      and the credentials n8n holds, with the image's copy of git (Plan Eksekusi: a difference
#      raises an alarm). Exit 1 (drift) or 2 (could not check) is alerted once, with its lines;
#      0 forgets it. A workflow changed in the editor is drift: the next deploy's setup puts git
#      back, and anything worth keeping goes into hydromart-ai as a PR first.
#   2. The machine secret's day. auth-service stops taking n8n's secret on
#      AIWEB_N8N_MACHINE_NOT_AFTER (00:00 UTC). Every deploy makes a new one from 30 days before
#      (scripts/aiweb-secrets.sh), so fewer than 14 days left means no deploy has run for weeks:
#      alerted once, until a deploy rotates it.
#
# n8n switched off (AIWEB_N8N_MACHINE_SECRET kept and blanked, its kill switch) is said, never
# alerted. .env is read as data, never sourced. Alerts go through alert_once, so each condition is
# said when it starts or changes, then weekly, and forgotten when it ends.
#
# Exit: 0 all well, or switched off · 1 something was alerted.
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/deploy-common.sh
. scripts/lib/deploy-common.sh

say() { echo "[aiweb-n8n] $(date -Is) $*"; }
# One key's value from .env, as compose reads it (the last line, one layer of quotes off). Empty
# with no .env: an absent line and a blank one are told apart by `grep -q` where it matters.
env_value() {
  tr -d '\r' <.env 2>/dev/null | sed -n "s/^$1=//p" | tail -1 | sed -e "s/^[\"']//" -e "s/[\"']$//"
}
clean() { tr -d '"\\' | tr '\n' ' ' | cut -c1-400; }

if grep -q '^AIWEB_N8N_MACHINE_SECRET=' .env 2>/dev/null && [ -z "$(env_value AIWEB_N8N_MACHINE_SECRET | tr -d '[:space:]')" ]; then
  say "n8n is switched off (AIWEB_N8N_MACHINE_SECRET is blank, its kill switch): nothing to check"
  alert_clear aiweb-n8n-drift
  alert_clear aiweb-n8n-secret
  exit 0
fi

rc=0

# 1. Drift, in the running n8n of the project infra/aiweb/docker-compose.yml names.
project="$(sed -n 's/^name:[[:space:]]*//p' infra/aiweb/docker-compose.yml 2>/dev/null | tr -d "\"' \r")"
n8n="$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=n8n 2>/dev/null | head -1 || true)"
if [ -z "$n8n" ]; then
  say "!! no n8n is running in project $project, so no drift check ran"
  alert_once aiweb-n8n-drift "n8n is not running on this box ($project): no drift check ran; the watchdog says why it stopped, a deploy starts it"
  rc=1
elif out="$(timeout "${AIWEB_N8N_DRIFT_TIMEOUT:-300}" docker exec "$n8n" node /opt/hydromart/bin/drift.mjs 2>&1)"; then
  say "drift: $(tail -1 <<<"$out")"
  alert_clear aiweb-n8n-drift
else
  code=$?
  printf '%s\n' "$out" | sed 's/^/   /'
  say "!! drift.mjs exit $code (1 drift, 2 could not check, 124 no answer in time)"
  alert_once aiweb-n8n-drift "n8n drift check exit $code (1 = what runs is not what git holds; the next deploy puts git back): $(printf '%s' "$out" | clean)"
  rc=1
fi

# 2. The machine secret's day.
not_after="$(env_value AIWEB_N8N_MACHINE_NOT_AFTER)"
left=''
if [[ "$not_after" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && day="$(date -u -d "$not_after" +%s 2>/dev/null)"; then
  left=$(((day - $(date -u +%s)) / 86400))
fi
if [ -z "$left" ]; then
  say "!! AIWEB_N8N_MACHINE_NOT_AFTER is not a date ('$not_after'): the next deploy makes a new machine secret"
  alert_once aiweb-n8n-secret "n8n machine secret has no valid end date in .env (AIWEB_N8N_MACHINE_NOT_AFTER): the next deploy makes a new one; run Deploy (mode deploy) if none is due"
  rc=1
elif [ "$left" -lt 14 ]; then
  say "!! n8n's machine secret stops on $not_after ($left days): a deploy makes a new one"
  alert_once aiweb-n8n-secret "n8n machine secret stops on $not_after ($left days left): auth-service then refuses n8n. Any deploy makes a new one: run Deploy (mode deploy)"
  rc=1
else
  say "machine secret: valid until $not_after ($left days); a deploy renews it from 30 days before"
  alert_clear aiweb-n8n-secret
fi

exit "$rc"
