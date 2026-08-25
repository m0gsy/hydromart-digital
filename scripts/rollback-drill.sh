#!/usr/bin/env bash
# L1.3 — a rollback that has actually been RUN, not one that merely exists.
#
# `scripts/check-rollbacks.sh` proves every migration ships a rollback.sql. That is proof
# somebody thought about undoing the change at the time they knew how — it is not proof the
# file works. A rollback.sql with a typo, a wrong column name, or a DROP of something the
# migration never created passes that check and fails at 3am, which is the only time anyone
# will ever read it.
#
# This runs them. For each migration named, against a THROWAWAY database restored from the
# live schema + data:
#
#   (undo first, if it is already applied there)
#   up -> down      three times, then up, all with ON_ERROR_STOP=1
#
# Three passes, not one: a rollback that leaves a stray object behind passes the first
# re-apply and fails the second, and that is exactly the failure a hurried rollback creates.
#
#   bash scripts/rollback-drill.sh                       # the 5 newest migrations of every service
#   bash scripts/rollback-drill.sh customer-service       # ...of one service
#   bash scripts/rollback-drill.sh customer-service 20260825120000_notification_locale
#
# Env: PG_CONTAINER (default hydromart-postgres), PG_USER (default hydromart), DRILL_COUNT
# (default 5). Never touches the source database: it dumps, restores into a scratch db, and
# drops it at the end — including when a step fails.
set -euo pipefail
cd "$(dirname "$0")/.."

PG_CONTAINER="${PG_CONTAINER:-hydromart-postgres}"
PG_USER="${PG_USER:-hydromart}"
DRILL_COUNT="${DRILL_COUNT:-5}"
SERVICE_FILTER="${1:-}"
MIGRATION_FILTER="${2:-}"

psql_in() { docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" "$@"; }

# service dir -> database name, from the same convention every service uses.
db_for() { echo "hydromart_${1%-service}"; }

failures=()
drilled=0

drill_one() {
  local service="$1" dir="$2" db scratch name
  name="$(basename "$dir")"
  db="$(db_for "$service")"
  scratch="drill_$(date +%s)_$RANDOM"

  echo "-- $service/$name"
  # Schema + data, so a rollback meets rows rather than an empty table. An empty database is
  # how a destructive rollback passes a drill and loses data in production (I4 learned this
  # the other way round: a "destructive" migration met 0 rows and was not destructive at all).
  docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" "$db" > "/tmp/$scratch.sql" 2>/dev/null
  psql_in -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $scratch" >/dev/null
  # shellcheck disable=SC2094
  psql_in -d "$scratch" -q < "/tmp/$scratch.sql" >/dev/null 2>&1

  # The dump is of a database where this migration is usually ALREADY applied, so
  # `migration.sql` would fail on its first line ("column already exists") and the drill
  # would report a broken rollback that is nothing of the kind. Measured on the first
  # run: 5 of 16 "failures" were exactly this. So the scratch database is walked BACK to
  # the pre-migration state first, and that step is allowed to fail — for a migration
  # that has not shipped yet, there is nothing to undo.
  psql_in -d "$scratch" -q < "$dir/rollback.sql" >/dev/null 2>&1 || true

  local ok=1 pass
  for pass in 1 2 3; do
    if ! psql_in -d "$scratch" -v ON_ERROR_STOP=1 -q < "$dir/migration.sql" >/dev/null 2>&1; then
      echo "   !! pass $pass: migration.sql failed"
      ok=0
      break
    fi
    if ! psql_in -d "$scratch" -v ON_ERROR_STOP=1 -q < "$dir/rollback.sql" >/dev/null 2>&1; then
      echo "   !! pass $pass: rollback.sql failed"
      ok=0
      break
    fi
  done
  # Leave the scratch database as the migration WOULD leave it, then drop it.
  psql_in -d "$scratch" -v ON_ERROR_STOP=1 -q < "$dir/migration.sql" >/dev/null 2>&1 || true
  psql_in -d postgres -q -c "DROP DATABASE IF EXISTS $scratch" >/dev/null
  rm -f "/tmp/$scratch.sql"

  drilled=$((drilled + 1))
  if [ "$ok" -eq 1 ]; then
    echo "   ok  up/down/up x3"
  else
    failures+=("$service/$name")
  fi
}

docker inspect "$PG_CONTAINER" >/dev/null 2>&1 || {
  echo "!! no container named '$PG_CONTAINER'. Start the stack, or set PG_CONTAINER." >&2
  exit 1
}

for service_dir in services/*/prisma/migrations; do
  service="$(basename "$(dirname "$(dirname "$service_dir")")")"
  [ -n "$SERVICE_FILTER" ] && [ "$service" != "$SERVICE_FILTER" ] && continue
  # Newest first: the migrations most likely to be rolled back are the ones just shipped.
  while IFS= read -r dir; do
    [ -f "$dir/migration.sql" ] || continue
    [ -f "$dir/rollback.sql" ] || continue
    [ -n "$MIGRATION_FILTER" ] && [ "$(basename "$dir")" != "$MIGRATION_FILTER" ] && continue
    drill_one "$service" "$dir"
  done < <(find "$service_dir" -mindepth 1 -maxdepth 1 -type d | sort -r | head -n "$DRILL_COUNT")
done

echo
if [ "${#failures[@]}" -gt 0 ]; then
  echo "!! ${#failures[@]} of $drilled rollback(s) do not work:"
  printf '   %s\n' "${failures[@]}"
  echo
  echo "   A rollback.sql that exists and does not run is worse than none: it is the file"
  echo "   somebody will trust at 3am."
  exit 1
fi

echo "rollback drill: $drilled migration(s) survived up/down/up three times"
