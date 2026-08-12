#!/usr/bin/env bash
# Write named keys into the live .env from the environment, without ever printing a value.
#
#   REVIEWER_PHONE=+62… REVIEWER_OTP_CODE=… bash scripts/env-set.sh REVIEWER_PHONE REVIEWER_OTP_CODE
#   … bash scripts/env-set.sh --restart auth REVIEWER_PHONE REVIEWER_OTP_CODE
#
# Why a script and not `ssh box 'echo KEY=v >> .env'`: the value arrives from a GitHub
# secret, so it must never reach a log, a shell history or a workflow input — and an
# append would leave TWO lines for the same key, where compose silently takes the last and
# the operator reads the first. This upserts: one line per key, in place, backed up first.
#
# The values come from the ENVIRONMENT, never from the argument list — an argv is visible
# in `ps` to every user on the box for as long as the process runs.
#
# Exit codes: 0 changed · 4 nothing to change · 1 usage/missing file/refused value.
set -uo pipefail
# Deliberately no `cd`: this edits the .env of the directory it is CALLED from, which is
# the deployment root on the box, not the one in whatever checkout holds this script.

RESTART=""
if [ "${1:-}" = "--restart" ]; then
  RESTART="${2:-}"
  shift 2
fi

[ "$#" -gt 0 ] || {
  echo "env-set: name at least one key" >&2
  exit 1
}
[ -f .env ] || {
  echo "env-set: no .env in $PWD" >&2
  exit 1
}

for KEY in "$@"; do
  case "$KEY" in
    [A-Z]*) ;;
    *)
      echo "env-set: '$KEY' is not a shell-style KEY" >&2
      exit 1
      ;;
  esac
  # `set -u` would abort on an unset name, which is the right answer: writing an empty
  # value because a secret was missing is how a feature ends up half-configured.
  VALUE="${!KEY?env-set: $KEY is not set in the environment}"
  # A newline in a value turns one line into two, and the second one is then read as a
  # broken KEY=VALUE — exactly the failure env-doctor.sh exists to repair.
  case "$VALUE" in
    *$'\n'*)
      echo "env-set: $KEY contains a newline; refusing" >&2
      exit 1
      ;;
  esac
done

BACKUP=".env.bak.$(date +%Y%m%d-%H%M%S)"
cp .env "$BACKUP"

# ENVIRON, not -v: awk mangles backslashes in a -v assignment, and a value that survives
# this script only when it happens to contain no backslash is not a value that survives.
awk -v keys="$*" '
  BEGIN { n = split(keys, K, " "); for (i = 1; i <= n; i++) want[K[i]] = 1 }
  /^[A-Za-z_][A-Za-z0-9_]*=/ {
    k = $0; sub(/=.*/, "", k)
    if (k in want) {
      # First occurrence keeps the key its place in the file; later duplicates vanish,
      # because two lines for one key is the state this script refuses to leave behind.
      if (!(k in done)) { print k "=" ENVIRON[k]; done[k] = 1 }
      next
    }
  }
  { print }
  END { for (k in want) if (!(k in done)) print k "=" ENVIRON[k] }
' .env > .env.new || {
  rm -f .env.new
  echo "env-set: rewrite failed; .env untouched" >&2
  exit 1
}

if cmp -s .env .env.new; then
  rm -f .env.new "$BACKUP"
  echo "env-set: already set, nothing to do"
  exit 4
fi

mv .env.new .env
# Lengths, never values: enough to catch an empty secret or a truncated paste, never
# enough to hand somebody the credential out of a workflow log.
for KEY in "$@"; do
  VALUE="${!KEY}"
  echo "env-set: $KEY written (${#VALUE} chars)"
done
echo "env-set: previous file kept as $BACKUP"

if [ -n "$RESTART" ]; then
  # deploy-common owns the one COMPOSE definition (tls profile, registry mode). Building a
  # second one here is the drift that made rollback.sh converge a different stack.
  . scripts/lib/deploy-common.sh
  $COMPOSE up -d "$RESTART"
fi
