#!/usr/bin/env bash
# Apply a block of KEY=VALUE lines to the live .env, without anybody hand-editing it.
#
#   ENV_SET_BLOCK="$(cat block.env)" bash scripts/env-set.sh crm web
#   bash scripts/env-set.sh crm < block.env
#
# The block comes from the CALLER — a GitHub secret, a file, a paste on the box. Nothing in
# this repo carries the values, and this script never prints one: every message names KEYS
# only. A .env is read over someone's shoulder more often than anybody plans for.
#
# What it refuses, and why each refusal exists:
#   - a value containing a real newline. That is exactly what a pasted PEM does, and it is
#     what killed the deploy on 2026-08-11 and blinded the watchdog for seven days.
#   - a key that is not [A-Z0-9_]. A lower-case or spaced key is a typo, and a typo here is
#     a variable that silently never reaches the process.
#   - deleting anything. This upserts; it has no path that removes a key.
#
# Backs the file up first, is a no-op on a value that is already correct, and prints an
# added / changed / unchanged tally by key name so a re-run is readable.
#
# Exit: 0 applied (or nothing to do) · 1 usage/missing .env · 2 a line the format refuses.
set -uo pipefail

[ -f .env ] || {
  echo "env-set: no .env in $PWD" >&2
  exit 1
}

BLOCK="${ENV_SET_BLOCK:-}"
if [ -z "$BLOCK" ] && [ ! -t 0 ]; then
  BLOCK="$(cat)"
fi
if [ -z "${BLOCK//[[:space:]]/}" ]; then
  echo "env-set: nothing to apply (ENV_SET_BLOCK empty and stdin empty)" >&2
  exit 1
fi

SERVICES=("$@")

# Validate the WHOLE block before touching the file. A half-applied env is worse than a
# refused one: half the keys reach the process and the failure looks like a code bug.
REFUSED=0
while IFS= read -r line; do
  case "$line" in
    '' | '#'*) continue ;;
  esac
  key="${line%%=*}"
  if [ "$key" = "$line" ]; then
    echo "env-set: refused, not a KEY=VALUE line: ${line:0:24}…" >&2
    REFUSED=1
    continue
  fi
  case "$key" in
    *[!A-Z0-9_]* | '')
      echo "env-set: refused, key is not [A-Z0-9_]: ${key:0:24}" >&2
      REFUSED=1
      ;;
  esac
done <<EOF
$BLOCK
EOF
[ "$REFUSED" -eq 0 ] || exit 2

STAMP="$(date +%Y%m%d%H%M%S)"
cp .env ".env.bak-$STAMP"
echo "env-set: backed up .env -> .env.bak-$STAMP"

ADDED=""
CHANGED=""
SAME=""
while IFS= read -r line; do
  case "$line" in
    '' | '#'*) continue ;;
  esac
  key="${line%%=*}"
  value="${line#*=}"
  # `grep -F` on the whole line: an identical line is genuinely nothing to do, and saying so
  # is what makes a re-run safe to press twice.
  if grep -qxF "$line" .env; then
    SAME="$SAME $key"
    continue
  fi
  if grep -q "^${key}=" .env; then
    # Rewrite in place with awk rather than sed: the value may contain slashes, ampersands
    # and backslashes, all of which sed would interpret. awk takes it as data.
    awk -v k="$key" -v v="$value" '
      BEGIN { done = 0 }
      $0 ~ "^" k "=" && !done { print k "=" v; done = 1; next }
      { print }
    ' .env > .env.tmp-$STAMP && mv .env.tmp-$STAMP .env
    CHANGED="$CHANGED $key"
  else
    printf '%s\n' "$line" >> .env
    ADDED="$ADDED $key"
  fi
done <<EOF
$BLOCK
EOF

echo "env-set: added:${ADDED:- none}"
echo "env-set: changed:${CHANGED:- none}"
echo "env-set: unchanged:${SAME:- none}"

# The env only reaches a container when the container is recreated. Leaving that to whoever
# runs this is how a key gets set and stays unread — the symptom being "I set it and nothing
# changed", which reads like the value is wrong.
if [ ${#SERVICES[@]} -gt 0 ]; then
  echo "env-set: recreating ${SERVICES[*]}"
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate "${SERVICES[@]}"
  for svc in "${SERVICES[@]}"; do
    # Only the keys this service DECLARES. Checking every key against every service is how
    # the first real run of this reported three `!!` lines on an apply that had WORKED:
    # GALLON_DEPOSIT_IDR belongs to depot, REFUND_HQ_THRESHOLD to payment, and the VAPID
    # keys to crm alone — the web container is not supposed to hold a push private key.
    #
    # A warning that fires when nothing is wrong teaches people to skip warnings, and that
    # costs more than the check is worth.
    declared="$(docker compose -f docker-compose.yml -f docker-compose.prod.yml config 2>/dev/null | awk -v s="$svc" '
      $0 ~ "^  " s ":$" { inside = 1; next }
      inside && /^  [a-z]/ { inside = 0 }
      inside { print }
    ')"
    # UNCHANGED keys are checked too. Recreating a service is how a value already in .env
    # finally reaches the process, so skipping them verified nothing on exactly the run whose
    # whole purpose was to apply them — which is how "I set it and nothing happened" survives.
    for key in $ADDED $CHANGED $SAME; do
      case "$declared" in
        *"$key:"*) ;;
        *)
          echo "  -  $svc: $key not declared for this service (nothing to check)"
          continue
          ;;
      esac
      # Presence only, never the value: proves the variable arrived, proves nothing about
      # what it says.
      if docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T "$svc" \
        sh -c "[ -n \"\${$key:-}\" ]" 2>/dev/null; then
        echo "  $svc: $key is set"
      else
        echo "  !! $svc: $key is EMPTY inside the container — it did not reach the process"
      fi
    done
  done
fi
