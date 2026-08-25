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
