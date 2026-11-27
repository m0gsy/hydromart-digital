#!/usr/bin/env bash
# Make PROSPECT_DNC_HMAC_KEY exist in the live .env, once, on the box.
#
# customer-service refuses to boot without it (min 32 chars, requiredSecret) and a blank value is
# never valid, so a missing or blank line is created here: 64 hex from `openssl rand -hex 32`,
# through env-set.sh (backup first, upsert, never prints a value). A non-blank value is NEVER
# touched: the key must not be rotated, every stored do-not-contact hash would stop matching.
#
# Called by deploy.sh before the first compose call, and by create-indexes.sh (which a migrating
# deploy runs from the NEW tree, so the very first release that needs the key still gets it: a
# deploy runs the previous release's deploy.sh, see its ONE-RELEASE LAG note).
#
# Prints the key NAME only. Exit: 0 present or created, 1 no .env / could not write.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.." || exit 1
KEY=PROSPECT_DNC_HMAC_KEY

[ -f .env ] || {
  echo "ensure-prospect-key: no .env in $PWD" >&2
  exit 1
}

# As compose reads it: last line wins, no CR, one layer of quotes off, whitespace trimmed.
current="$(tr -d '\r' < .env | sed -n "s/^$KEY=//p" | tail -1)"
case "$current" in
  \"*\") current="${current#\"}" && current="${current%\"}" ;;
  \'*\') current="${current#\'}" && current="${current%\'}" ;;
esac
current="${current//[[:space:]]/}"

if [ -n "$current" ]; then
  echo "ensure-prospect-key: $KEY present, untouched"
  exit 0
fi

new="$(openssl rand -hex 32)" || {
  echo "ensure-prospect-key: openssl failed; $KEY not created" >&2
  exit 1
}
ENV_SET_BLOCK="$KEY=$new" bash "$HERE/env-set.sh" > /dev/null || {
  echo "ensure-prospect-key: could not write $KEY to .env" >&2
  exit 1
}
echo "ensure-prospect-key: $KEY was absent or blank, created (64 hex, value not shown)"
