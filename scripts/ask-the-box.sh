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
  # Whether the missing bank account is also a missing HQ cut depends on WHO owns the depot:
  # payout.service.ts:179 reads `(await schemes.currentForDepot(id))?.pct ?? 0`, so a WARALABA
  # depot with no scheme hands HQ nothing and says nothing about it.
  q hydromart_depot "select coalesce(\"ownershipType\"::text,chr(63)), count(*) from depots where active group by 1 order by 1" |
    sed "s/^/  active depots by ownership: /" | grep . || echo "  active depots by ownership: QUERY RETURNED NOTHING (column wrong, or no rows)"
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

  # A VERDICT, not another dump.
  #
  # Everything above is rows, and rows need a reader who already knows what the coded default
  # is. On 2026-08-29 the rows said `GLOBAL silverDiscountPct = 0` and had said so for a while;
  # it took someone cross-checking membership.ts to see that a tier promising a discount was
  # paying none. Every customer the app called GOLD had been paying full price.
  #
  # So the three values whose zero is never a decision are named here and judged here.
  echo "  membership discount — a tier that promises a discount and pays none:"
  for k in silverDiscountPct goldDiscountPct platinumDiscountPct; do
    v="$(q hydromart_loyalty "select coalesce(string_agg(scope||'='||value, ', '), '(no row - coded default)') from service_settings where key = '${k}'")"
    case "$v" in
      *=0*) echo "    !! ${k} = ${v}  <- STORED ZERO. The badge promises a discount; checkout applies none." ;;
      *) echo "    ok ${k} = ${v}" ;;
    esac
  done
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

line "SPACE — the only failure here that can destroy DATA"
# `df -h /` a few lines up has printed a table since this file was written, and a table is
# not an answer: nothing has ever JUDGED it, and nobody reads a diagnose run they did not
# already suspect something from. One disk carries Postgres, every nightly dump, nineteen
# service images and the Prometheus TSDB. Full disk on the machine that holds the database
# AND its own backups is the one failure in this system that loses data rather than uptime,
# and its date has never been calculated.
AVAIL_KB="$(df -Pk / 2>/dev/null | awk 'NR==2{print $4}')"
USED_PCT="$(df -Pk / 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5}')"
if [ -n "${AVAIL_KB:-}" ]; then
  echo "  free on / : $((AVAIL_KB / 1024)) MB (${USED_PCT}% used)"
  # 85/95 rather than a single line: the first is "order a bigger disk this week", the
  # second is "Postgres is about to refuse writes". Postgres stops accepting them well
  # before 100 because WAL needs room to land.
  if [ "${USED_PCT:-0}" -ge 95 ]; then
    echo "  !! CRITICAL: under 5% free. Postgres refuses writes before a disk reaches 100%."
  elif [ "${USED_PCT:-0}" -ge 85 ]; then
    echo "  !! WARNING: over 85% used. Nothing here trims itself except the 14-dump window."
  else
    echo "  ok: headroom is fine today"
  fi
fi
if [ -n "$PG" ]; then
  echo "  database sizes:"
  docker exec "$PG" psql -U hydromart -d postgres -t -A -F'|'     -c "select datname, pg_size_pretty(pg_database_size(datname)) from pg_database
        where datname like 'hydromart%' order by pg_database_size(datname) desc" 2>/dev/null |
    sed 's/^/    /' | head -25
fi
echo "  dumps on disk:"
for d in /var/backups/hydromart ~/backups; do
  [ -d "$d" ] || continue
  n="$(ls -1 "$d"/hydromart-*.sql.gz 2>/dev/null | wc -l | tr -d ' ')"
  sz="$(du -sh "$d" 2>/dev/null | cut -f1)"
  echo "    $d : ${n} dump(s), ${sz:-?} total"
done

line "ALERTS — is there anywhere for an alarm to GO?"
# One variable decides whether every 5xx alert, the watchdog, the backup failure and the
# restore drill reach a human or a logfile. It is not in .env.example, so the deploy's
# env-contract probe has never been structurally able to report it missing. Never a value:
# a webhook URL IS the credential.
for key in ALERT_WEBHOOK_URL BACKUP_OFFSITE_DEST BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY SENTRY_DSN SENTRY_DSN_WEB; do
  if [ -n "$(sed -n "s/^${key}=//p" .env 2>/dev/null | head -1)" ]; then
    echo "  ${key} : set"
  else
    echo "  ${key} : EMPTY"
  fi
done
echo "  consequence of each EMPTY above:"
echo "    ALERT_WEBHOOK_URL   no alert of any kind reaches a person; they land in a log file"
echo "    BACKUP_OFFSITE_DEST every copy of the database is on the disk the database is on"
echo "    BACKUP_S3_*         the offsite job cannot authenticate even once DEST is set"
echo "    SENTRY_DSN          server exceptions are invisible; you learn from a customer"
echo "    SENTRY_DSN_WEB      browser + WebView crashes are invisible (BUILD ARG: needs rebuild)"

line "ORDERS — how many were cancelled by the sweep, and how many were placed after hours?"
# The rupiah size of the silent-cancellation defect. The code path is certain; the count is
# the only thing that turns it from a certainty into a number. WIB is UTC+7 and the columns
# are naive timestamps, so the hour is shifted here rather than trusted.
if [ -n "$PG" ]; then
  q hydromart_order "
    select status, count(*) from orders
    where \"createdAt\" > now() - interval '30 days'
    group by 1 order by 2 desc" | sed 's/^/  last 30d by status: /'
  q hydromart_order "
    select count(*) from orders
    where \"createdAt\" > now() - interval '30 days'
      and extract(hour from (\"createdAt\" + interval '7 hours')) not between 8 and 20" |
    sed 's/^/  placed outside 08:00-21:00 WIB (30d): /'
  q hydromart_order "
    select count(*) from orders
    where \"createdAt\" > now() - interval '30 days'
      and status = 'CANCELLED'
      and \"statusChangedAt\" - \"createdAt\" between interval '55 minutes' and interval '3 hours'" |
    sed 's/^/  CANCELLED 55min-3h after creation (the sweep signature): /'
fi

line "WHO cancelled those orders, and what did they say"
# The question the sweep-signature check above CANNOT answer, and the reason it must exist.
#
# That check looks for cancellations 55min-3h after creation. Asked of production it returned
# zero, and zero was read as "the sweep has never fired". It had: all six cancellations were
# more than a DAY old, because there are two sweeps with different windows — abandonMinutes
# (60, from CREATED) and stalledHours (24, from PREPARING). A signature search that misses
# the window reports absence and sounds like proof.
#
# So this asks without assuming a window at all: who, how long after, from which status, with
# what note. `changedBy` is a user id OR a service label ('payment-service', 'scheduler'), so
# the shape of the value already separates a person from a job.
if [ -n "$PG" ]; then
  q hydromart_order "
    select coalesce(h.\"changedBy\",'(null)'),
           count(*),
           min(h.\"createdAt\")::date,
           max(h.\"createdAt\")::date
    from order_status_history h
    where h.status = 'CANCELLED' and h.\"createdAt\" > now() - interval '90 days'
    group by 1 order by 2 desc" | sed 's/^/  by | count | first | last: /'
  echo "  how long after the order was created:"
  q hydromart_order "
    select case
             when h.\"createdAt\" - o.\"createdAt\" < interval '5 minutes'  then 'under 5 min'
             when h.\"createdAt\" - o.\"createdAt\" < interval '1 hour'     then '5-60 min'
             when h.\"createdAt\" - o.\"createdAt\" < interval '3 hours'    then '1-3 h'
             when h.\"createdAt\" - o.\"createdAt\" < interval '1 day'      then '3-24 h'
             else 'over a day'
           end,
           count(*)
    from order_status_history h join orders o on o.id = h.\"orderId\"
    where h.status = 'CANCELLED' and h.\"createdAt\" > now() - interval '90 days'
    group by 1 order by 2 desc" | sed 's/^/    /'
  echo "  the status each one was cancelled FROM (previous history row):"
  q hydromart_order "
    select coalesce(prev.status::text,'(none - cancelled from CREATED with no prior row)'), count(*)
    from order_status_history h
    join orders o on o.id = h.\"orderId\"
    left join lateral (
      select p.status from order_status_history p
      where p.\"orderId\" = h.\"orderId\" and p.\"createdAt\" < h.\"createdAt\"
      order by p.\"createdAt\" desc limit 1
    ) prev on true
    where h.status = 'CANCELLED' and h.\"createdAt\" > now() - interval '90 days'
    group by 1 order by 2 desc" | sed 's/^/    /'
  echo "  notes left on the cancellation (reasons, where anyone wrote one):"
  q hydromart_order "
    select left(coalesce(h.note,'(no note)'), 70), count(*)
    from order_status_history h
    where h.status = 'CANCELLED' and h.\"createdAt\" > now() - interval '90 days'
    group by 1 order by 2 desc" | sed 's/^/    /'
  echo "  payment method + channel of the cancelled ones:"
  q hydromart_order "
    select coalesce(o.\"paymentMethod\"::text,'?'), coalesce(o.channel::text,'?'), count(*)
    from orders o
    where o.status = 'CANCELLED' and o.\"createdAt\" > now() - interval '90 days'
    group by 1,2 order by 3 desc" | sed 's/^/    /'
fi

line "GALLON DEPOSITS — how many double refunds already happened?"
# Migration 20260827100000 copied every duplicate into gallon_returns_duplicate_archive
# before deleting it, and the table comments itself \"nothing reads it\". This reads it.
if [ -n "$PG" ]; then
  q hydromart_depot "select count(*) from gallon_returns_duplicate_archive" |
    sed 's/^/  rows archived as duplicates: /' | grep . ||
    echo "  (table absent — the migration has not run on this box)"
fi

line "INDEXES — present AND valid, or just present?"
# 278 CREATE INDEX across migrations; verify-indexes.sh checks 9. The one that makes gallon
# refunds idempotent is not among the 9. --check is report-only and builds nothing.
if [ -f scripts/create-indexes.sh ]; then
  PG_CONTAINER="$PG" bash scripts/create-indexes.sh --check 2>&1 | tail -25 | sed 's/^/  /'
else
  echo "  scripts/create-indexes.sh not on this checkout (the box lags main between deploys)"
fi

line "RESTORE DRILL — has one ever passed, and how long did it take?"
# The verdict lives in a log the repo never reads back. Until restore-db.sh records elapsed
# time, RTO is a guess; this at least reports whether a drill happens at all.
DRILL_LOG="${DRILL_LOG:-/var/log/hydromart-restore-drill.log}"
if [ -f "$DRILL_LOG" ]; then
  echo "  log mtime : $(date -r "$DRILL_LOG" '+%Y-%m-%d %H:%M' 2>/dev/null || echo '?')"
  echo "  last lines:"
  tail -6 "$DRILL_LOG" 2>/dev/null | sed 's/^/    /'
else
  echo "  !! $DRILL_LOG does not exist — no restore drill has ever run on this box."
fi

line "DEMO-01 — a fixture depot, live and public, with no operating hours"
# operatingHours {} means ALWAYS OPEN (order-service/src/domain/opening-hours.ts), so a real
# customer within 3 km of Malang can order cash at 03:00 from a depot that does not operate.
if [ -n "$PG" ]; then
  q hydromart_depot "
    select code, active, coalesce(\"operatingHours\"::text,'null')
    from depots where code like 'DEMO%' or name ilike '%demo%'" |
    sed 's/^/  /' | grep . || echo "  no demo depot found (good)"
fi

line "cron (L1.4 — is the schedule actually installed?)"
if crontab -l >/dev/null 2>&1; then
  # Both interpreters. This read `bash scripts/*.sh` only, so the nightly OBJECT backup —
  # `node scripts/backup-objects.mjs`, the one carrying delivery and payment evidence off the
  # box — was invisible to the probe that exists to answer "is the schedule installed?".
  # A probe that cannot see a job reports the same thing whether it is scheduled or missing.
  crontab -l 2>/dev/null | grep -cE 'backup-db|backup-objects|restore-db|watchdog|check-tls|log-retention|rollback-drill' |
    sed 's/^/    scheduled hydromart jobs: /'
  crontab -l 2>/dev/null | sed -n 's/.*\(bash\|node\) scripts\/\([a-z-]*\.\(sh\|mjs\)\).*/    - \2/p' | sort -u
else
  echo "    no crontab for $(whoami) — scripts/install-host-cron.sh has never run here"
fi

line "object buckets — how much evidence is there, and would a second provider be affordable"
# The size of the photographs nobody had ever measured. `--dry-run` lists and compares only:
# it enables no versioning, copies nothing, and exits before the first PutObject. This is the
# number a second-provider decision needs, and guessing it is how that decision gets deferred
# forever.
if [ -f scripts/backup-objects.mjs ]; then
  # In a SUBSHELL, and that is not decoration. This script deliberately never exports .env —
  # it reads the keys it reports with sed, so it can say "set" without printing a secret. So
  # the first version of this question ran with an empty environment and answered
  # "missing env BACKUP_OFFSITE_DEST" about a box where the very next line of its own output
  # said `BACKUP_OFFSITE_DEST : set`. The nightly cron sources load-env.sh, so the backup was
  # never affected; only the question was. The parentheses keep the export from leaking into
  # the rest of the run.
  (. ./scripts/load-env.sh >/dev/null 2>&1; node scripts/backup-objects.mjs --dry-run 2>&1) | grep -vE "^  would copy|^  \.\.\.and" | sed "s/^/  /"
else
  echo "  scripts/backup-objects.mjs is not on this box yet"
fi

printf '\nRead-only: nothing above started, stopped, pulled, or wrote anything.\n'
