#!/usr/bin/env bash
# D10 (owner, 26 Nov 2026): delete, once per batch, the hydromart copies of the old /waralaba
# applications that were imported into the AI web CRM (hydromart-ai, prospects.legacy_application_id).
#
#   bash scripts/purge-applications.sh                                         # DRY RUN: reads only
#   CONFIRM=PURGE-APPLICATIONS bash scripts/purge-applications.sh --execute    # deletes the batch
#
# There is no standing delete route: the ids come from ops/purge-applications.txt, a committed,
# PR-reviewed file that is replaced per batch, and a person presses the Deploy mode.
#
# The dry run prints, per stage, how many of the named ids were found; which were not found; how
# many stage events they have; how many are already in the AI web; how many depots point at them.
# It never prints a name, phone, GPS or amount (ids are not personal data).
#
# --execute refuses, writing nothing, unless:
#   - CONFIRM=PURGE-APPLICATIONS;
#   - every named id exists in hydromart (a missing one means the file is stale);
#   - none is APPROVED (an approved application is the paper trail of a depot, it stays);
#   - every one is imported in the AI web (prospects.legacy_application_id);
#   - no depot references any of them (depots.franchiseApplicationId).
# Then it takes a database dump (stops if that fails: this cannot be undone any other way) and
# deletes in ONE transaction that rolls back unless the deleted count equals the found count.
set -uo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/backup-dir.sh
. scripts/lib/backup-dir.sh

EXECUTE=false
case "${1:-}" in
  "") ;;
  --execute) EXECUTE=true ;;
  *) echo "usage: $0 [--execute]" >&2; exit 2 ;;
esac

FILE="${PURGE_FILE:-ops/purge-applications.txt}"
[ -f "$FILE" ] || { echo "!! $FILE not found." >&2; exit 2; }

# ------------------------------------------------------------------------------- the batch file
IDS=()
n=0
while IFS= read -r line || [ -n "$line" ]; do
  n=$((n + 1))
  line="${line%$'\r'}"
  case "$line" in '' | '#'*) continue ;; esac
  if ! [[ "$line" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    echo "!! $FILE line $n is not a lowercase uuid." >&2
    exit 2
  fi
  for seen in "${IDS[@]:-}"; do
    [ "$seen" = "$line" ] && { echo "!! $FILE line $n repeats an id." >&2; exit 2; }
  done
  IDS+=("$line")
done <"$FILE"
if [ "${#IDS[@]}" -lt 1 ] || [ "${#IDS[@]}" -gt 200 ]; then
  echo "!! $FILE must name 1 to 200 ids (has ${#IDS[@]})." >&2
  exit 2
fi
# Only strings that passed the uuid regex reach SQL.
LIST="$(printf "'%s'," "${IDS[@]}")"
ARR="ARRAY[${LIST%,}]::uuid[]"

# ------------------------------------------------------------------------------- the databases
# HD-1: this project's Postgres only, never the AI web's (newest container first in `docker ps`).
if [ -n "${PG_CONTAINER:-}" ]; then
  PG="$PG_CONTAINER"
else
  PGS="$(docker ps --filter 'label=com.docker.compose.project=hydromart' --filter 'name=postgres' --format '{{.Names}}' 2>/dev/null | grep -v exporter)"
  if [ "$(printf '%s\n' "$PGS" | grep -c .)" -ne 1 ]; then
    echo "!! expected exactly one hydromart Postgres container, found: ${PGS:-none}. Set PG_CONTAINER." >&2
    exit 2
  fi
  PG="$PGS"
fi
PG_USER="${PG_USER:-hydromart}"
if ! docker exec "$PG" true >/dev/null 2>&1; then
  echo "!! cannot reach Postgres ($PG)." >&2
  exit 2
fi
AI="$(aiweb_db_container)"
AI_USER="${AIWEB_PG_USER:-postgres}"
AI_DB="${AIWEB_PG_DB:-ai}"

hm() { docker exec -i "$PG" psql -X -tA -v ON_ERROR_STOP=1 -U "$PG_USER" -d hydromart_depot "$@"; }
ai() { docker exec -i "$AI" psql -X -tA -v ON_ERROR_STOP=1 -U "$AI_USER" -d "$AI_DB" "$@"; }

echo "purge-applications: $($EXECUTE && echo EXECUTE || echo 'dry run, nothing will be written')"
echo "named: ${#IDS[@]}"

STAGES="$(hm -c "select stage || '|' || count(*) from franchise_applications where id = ANY($ARR) group by stage order by stage")" ||
  { echo "!! hydromart_depot is unreadable." >&2; exit 2; }
FOUND="$(hm -c "select count(*) from franchise_applications where id = ANY($ARR)")"
APPROVED="$(hm -c "select count(*) from franchise_applications where id = ANY($ARR) and stage = 'APPROVED'")"
MISSING="$(hm -c "select i from unnest($ARR) i where i not in (select id from franchise_applications) order by 1")"
EVENTS="$(hm -c "select count(*) from franchise_application_stage_events where \"applicationId\" = ANY($ARR)")"
DEPOTS="$(hm -c "select count(*) from depots where \"franchiseApplicationId\" = ANY($ARR)")"

echo "found: $FOUND"
echo "stage|count"
printf '%s\n' "$STAGES"
echo "not found: $(printf '%s\n' "$MISSING" | grep -c .)"
# shellcheck disable=SC2086 # ids are uuids: word splitting is the point
[ -n "$MISSING" ] && printf '  %s\n' $MISSING
echo "stage events: $EVENTS"
echo "depots referencing them: $DEPOTS"

# Which of the FOUND ids the AI web already holds.
FOUND_IDS="$(hm -c "select id from franchise_applications where id = ANY($ARR) order by 1")"
IMPORTED=""
NOT_IMPORTED=""
AI_OK=false
if [ -n "$AI" ]; then
  if [ -n "$FOUND_IDS" ]; then
    FARR="ARRAY[$(printf "'%s'," $FOUND_IDS | sed 's/,$//')]::uuid[]"
  else
    FARR="ARRAY[]::uuid[]"
  fi
  if IMPORTED="$(ai -c "select legacy_application_id from prospects where legacy_application_id = ANY($FARR)")"; then
    AI_OK=true
    NOT_IMPORTED="$(printf '%s\n' "$FOUND_IDS" | grep . | grep -vxF -f <(printf '%s\n' "$IMPORTED") || true)"
  fi
fi
if $AI_OK; then
  echo "imported in the AI web: $(printf '%s\n' "$IMPORTED" | grep -c .)"
  echo "not imported: $(printf '%s\n' "$NOT_IMPORTED" | grep -c .)"
  # shellcheck disable=SC2086
  [ -n "$NOT_IMPORTED" ] && printf '  %s\n' $NOT_IMPORTED
else
  echo "imported in the AI web: UNREADABLE (the AI web database is not reachable on this box)"
fi

if ! $EXECUTE; then
  echo
  echo "Dry run only. To delete: CONFIRM=PURGE-APPLICATIONS bash $0 --execute"
  exit 0
fi

# ------------------------------------------------------------------------------- refusals
refuse() { echo "!! refusing: $1" >&2; exit 1; }
[ "${CONFIRM:-}" = "PURGE-APPLICATIONS" ] || refuse "set CONFIRM=PURGE-APPLICATIONS to say you mean it."
[ "$FOUND" = "${#IDS[@]}" ] || refuse "$FILE names ${#IDS[@]} id(s) but hydromart holds $FOUND: the file is stale. Replace it by PR."
[ "$APPROVED" = 0 ] || refuse "$APPROVED named application(s) are APPROVED: they are the paper trail of a depot and stay."
$AI_OK || refuse "the AI web database cannot be read, so the import cannot be proved."
[ -z "$NOT_IMPORTED" ] || refuse "some named application(s) are not in the AI web CRM yet. Import them first."
[ "$DEPOTS" = 0 ] || refuse "$DEPOTS depot(s) still reference these applications."

echo
echo "Taking a database dump first, this cannot be undone any other way..."
# PURGE_BACKUP_CMD exists so the self-test can stand in for the dump; production never sets it.
# backup-db.sh defaults to hydromart-postgres: hand it the container we delete from.
if ! PG_CONTAINER="$PG" PG_USER="$PG_USER" ${PURGE_BACKUP_CMD:-bash scripts/backup-db.sh}; then
  refuse "the backup failed, so there would be no way back."
fi

# ONE transaction. The stage events have no foreign key on purpose (their table says why: the
# counts must outlive the application), so this delete is deliberate: the CRM now holds the funnel
# for these ids. It rolls back unless exactly the found rows go.
if ! OUT="$(hm -1 -f - 2>&1 <<SQL
DO \$\$
DECLARE ev int; ap int;
BEGIN
  DELETE FROM franchise_application_stage_events WHERE "applicationId" = ANY($ARR);
  GET DIAGNOSTICS ev = ROW_COUNT;
  DELETE FROM franchise_applications WHERE id = ANY($ARR) AND stage <> 'APPROVED';
  GET DIAGNOSTICS ap = ROW_COUNT;
  IF ap <> $FOUND THEN
    RAISE EXCEPTION 'deleted % application(s), expected $FOUND: rolled back', ap;
  END IF;
  RAISE NOTICE 'deleted: % application(s), % stage event(s)', ap, ev;
END \$\$;
SQL
)"; then
  echo "!! the delete failed and was rolled back: $(printf '%s' "$OUT" | grep -m1 -i 'error')" >&2
  exit 1
fi
printf '%s\n' "$OUT" | grep -m1 'deleted:' || echo "deleted (count line missing)"
