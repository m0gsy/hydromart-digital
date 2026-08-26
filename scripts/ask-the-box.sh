#!/usr/bin/env bash
# M15/M16/M10 — the questions about production that the repo cannot answer.
#
# Three Phase-M items sat blocked for weeks on facts that only exist on the box: whether
# `IMAGE_PREFIX` is set, and whether this machine's `docker compose` errors or silently
# skips the `scheduler` service. The plan wrote them as "run one grep on the VPS", and that
# is exactly the shape of thing that never gets run — so it is a script, and it runs from a
# workflow instead of from somebody's memory.
#
# STRICTLY READ-ONLY. It starts nothing, stops nothing, pulls nothing, writes nothing. Every
# command here either reads a file, asks docker to describe itself, or asks the kernel.
#
# It never prints a VALUE from .env. Only whether a key is set, and for the two keys that
# are addresses rather than secrets (IMAGE_PREFIX, WEB_DOMAIN) the value itself, because the
# whole point of asking is to see what they are. A .env is read over someone's shoulder.
set -uo pipefail

cd "$(dirname "$0")/.."

line() { printf '\n== %s\n' "$1"; }

line "box"
echo "  host      : $(uname -sr 2>/dev/null || echo '?')"
echo "  repo path : $(pwd)"
echo "  commit    : $(git rev-parse --short HEAD 2>/dev/null || echo '?')"
echo "  docker    : $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo 'unreachable')"
echo "  compose   : $(docker compose version --short 2>/dev/null || echo 'MISSING — docker compose v2 not installed')"

# M10. The one grep the plan asked for. A prefix is a registry address, not a credential.
line "M10 — registry mode"
if [ -f .env ]; then
  for key in IMAGE_PREFIX IMAGE_TAG; do
    raw="$(sed -n "s/^${key}=//p" .env | head -1)"
    if [ -z "$raw" ]; then
      if grep -qs "^[[:space:]]*#[[:space:]]*${key}=" .env; then
        echo "  ${key} : commented out"
      else
        echo "  ${key} : not set"
      fi
    else
      echo "  ${key} : ${raw}"
    fi
  done
  if [ -z "$(sed -n 's/^IMAGE_PREFIX=//p' .env | head -1)" ]; then
    echo "  -> build-locally mode: this box compiles all nineteen images itself."
    echo "     CI publishes images every merge that nothing here consumes."
  else
    echo "  -> registry mode. Prove the pull separately: scripts/check-registry-pull.sh"
  fi
else
  echo "  no .env in $(pwd)"
fi

# L2.1/E7. Whether real customers can register at all, asked on the box rather than inferred
# from `.env.production.example` — which is a TEMPLATE, and reading it as production is how
# this item was reported wrong. The channel is an ordinary setting and is printed; the
# credentials are secrets, so only whether they are set is printed, never their value.
line "L2.1 — OTP delivery"
if [ -f .env ]; then
  chan="$(sed -n 's/^OTP_DELIVERY_CHANNEL=//p' .env | head -1)"
  echo "  OTP_DELIVERY_CHANNEL : ${chan:-(not set — defaults to console)}"
  for key in ZENZIVA_USERKEY ZENZIVA_PASSKEY SMS_API_TOKEN; do
    val="$(sed -n "s/^${key}=//p" .env | head -1)"
    if [ -z "$val" ]; then
      echo "  ${key} : NOT SET"
    else
      echo "  ${key} : set (${#val} chars)"
    fi
  done
  case "$chan" in
    console|"") echo "  -> real customers CANNOT receive an OTP: the code prints it to the container log." ;;
    *)          echo "  -> channel is '${chan}'. Credentials above decide whether it can actually send." ;;
  esac
fi

# And what the RUNNING container has, which is the only thing that decides behaviour — a .env
# edited after the last `up -d` has not reached the process yet.
line "L2.1 — what the running auth container actually has"
auth="$(docker ps --filter 'name=auth' --format '{{.Names}}' 2>/dev/null | head -1)"
if [ -n "$auth" ]; then
  docker exec "$auth" sh -c '
    echo "  container            : ok"
    echo "  OTP_DELIVERY_CHANNEL : ${OTP_DELIVERY_CHANNEL:-(unset)}"
    for k in ZENZIVA_USERKEY ZENZIVA_PASSKEY; do
      eval v=\$$k
      if [ -z "$v" ]; then echo "  $k : NOT SET"; else echo "  $k : set (${#v} chars)"; fi
    done' 2>/dev/null || echo "  (could not read the container environment)"
else
  echo "  no running container matching 'auth'"
fi

# L2.2/L2.3/L2.4 — the three remaining launch blockers, asked HERE rather than inferred from
# `.env.production.example` or from a developer's local database. L2.1 was reported wrong for
# exactly that reason: the template said the credentials were blank, and production had them.
#
# Read-only throughout: env keys are reported as set/not-set with a length, never as a value,
# and every SQL below is a SELECT.
line "L2.2 — storage credentials"
if [ -f .env ]; then
  for key in HR_STORAGE_S3_ACCESS_KEY_ID HR_STORAGE_S3_SECRET_ACCESS_KEY              PRODUCT_STORAGE_S3_SECRET_ACCESS_KEY DELIVERY_STORAGE_S3_SECRET_ACCESS_KEY              AUTH_STORAGE_S3_SECRET_ACCESS_KEY CUSTOMER_STORAGE_S3_SECRET_ACCESS_KEY; do
    val="$(sed -n "s/^${key}=//p" .env | head -1)"
    if [ -z "$val" ]; then echo "  ${key} : NOT SET"; else echo "  ${key} : set (${#val} chars)"; fi
  done
  echo "  (whether the key was ROTATED is not knowable from here — that is the ledger in"
  echo "   docs/RUNBOOK_SECRET_ROTATION.md, and a key being set says nothing about its age.)"
fi

PG="$(docker ps --filter 'name=postgres' --format '{{.Names}}' 2>/dev/null | grep -v exporter | head -1)"
q() { docker exec "$PG" psql -U hydromart -d "$1" -t -A -F'|' -c "$2" 2>/dev/null; }

line "L2.3 — can a real depot actually be paid?"
if [ -n "$PG" ]; then
  echo "  postgres container : $PG"
  q hydromart_depot "
    select count(*) filter (where active),
           count(*) filter (where active and coalesce(\"paymentBankAccountNumber\",'') <> ''),
           count(*) filter (where active and coalesce(\"paymentQrisImageUrl\",'') <> '')
    from depots" | sed 's/^/  active | with-bank | with-QRIS  =  /'
  echo "  real depots (fixtures excluded) still missing a payment destination:"
  q hydromart_depot "
    select code from depots
    where active
      and code !~ '^(E2E|UAT|HIER|DEMO)'
      and (coalesce(\"paymentBankAccountNumber\",'') = '' or coalesce(\"paymentQrisImageUrl\",'') = '')
    order by code" | sed 's/^/    - /' | head -20
else
  echo "  no postgres container found"
fi

line "L2.4 — business tunables: decided, or still the coded default?"
if [ -n "$PG" ]; then
  for db in depot delivery loyalty payout referral order hr; do
    rows="$(q "hydromart_${db}" "select scope||' '||key||' = '||value from service_settings order by key")"
    if [ -z "$rows" ]; then
      echo "  ${db}: no stored override — every tunable runs its coded default"
    else
      echo "  ${db}:"; printf '%s
' "$rows" | sed 's/^/    /'
    fi
  done
  echo "  franchise commission (HQ's cut):"
  q hydromart_payout "select count(*) from commission_schemes" | sed 's/^/    commission_schemes rows: /'
fi

# M16. The blocking question, asked in the only place it has an answer. `compose config`
# parses and resolves without touching a container, which is why it is safe to ask here.
line "M16 — does compose error, or skip the scheduler?"
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
if err="$(docker compose $COMPOSE_FILES config --quiet 2>&1)"; then
  echo "  compose config : OK (parses and resolves)"
  services="$(docker compose $COMPOSE_FILES config --services 2>/dev/null | sort | tr '\n' ' ')"
  echo "  services       : ${services}"
  case " ${services} " in
    *" scheduler "*) echo "  scheduler      : PRESENT in the resolved config" ;;
    *)               echo "  scheduler      : ABSENT from the resolved config — skipped, not errored" ;;
  esac
else
  echo "  compose config : ERRORS"
  printf '%s\n' "$err" | sed 's/^/    /' | head -20
fi

line "M16 — is the scheduler actually running?"
docker compose $COMPOSE_FILES ps --format '  {{.Service}}\t{{.State}}\t{{.Health}}' 2>/dev/null |
  grep -iE 'scheduler|^$' || echo "  no scheduler row in \`compose ps\`"
echo "  containers named scheduler, any project:"
docker ps -a --filter 'name=scheduler' --format '    {{.Names}}  {{.Status}}' 2>/dev/null |
  head -5 || true

# M15 sits in the same corner of the plan and has no description there beyond "VPS side",
# so this reports the facts a VPS-side capacity item would need rather than guessing at it.
line "capacity (context for M13/M15)"
echo "  disk:"
df -h / 2>/dev/null | sed 's/^/    /'
echo "  docker space:"
docker system df 2>/dev/null | sed 's/^/    /'
echo "  memory:"
free -h 2>/dev/null | sed 's/^/    /' || echo "    (free unavailable)"

line "cron (L1.4 — is the schedule actually installed?)"
if crontab -l >/dev/null 2>&1; then
  crontab -l 2>/dev/null | grep -cE 'backup-db|restore-db|watchdog|check-tls|log-retention|rollback-drill' |
    sed 's/^/    scheduled hydromart jobs: /'
  crontab -l 2>/dev/null | sed -n 's/.*bash scripts\/\([a-z-]*\.sh\).*/    - \1/p' | sort -u
else
  echo "    no crontab for $(whoami) — scripts/install-host-cron.sh has never run here"
fi

printf '\nRead-only: nothing above started, stopped, pulled, or wrote anything.\n'
