#!/usr/bin/env bash
# The runnable check for scripts/purge-applications.sh (D10).
#
#   bash scripts/purge-applications.test.sh
#
# The script DELETES rows in production once, so it is run here against a throwaway Postgres
# carrying the REAL depot migrations, plus a fake AI web database `ai` holding only the one
# table the script reads (prospects.legacy_application_id).
#
# Skips (exit 0) when there is no Docker daemon or the Postgres image cannot be pulled, and says
# so: a check that cannot run must say it did not run. The static checks always run.
set -uo pipefail
# CI invokes this as `bash -e file`; the negative cases below are SUPPOSED to exit non-zero.
set +e
cd "$(dirname "$0")/.."

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

echo "purge-applications:"

# --------------------------------------------------------------------------- static checks
# Every table and column the script names must be real, or the first sign is on the box.
SCHEMA=services/depot-service/prisma/schema.prisma
MIG="$(cat services/depot-service/prisma/migrations/*/migration.sql)"
grep -q '@@map("franchise_applications")' "$SCHEMA" && grep -q '@@map("franchise_application_stage_events")' "$SCHEMA" &&
  grep -q '@@map("depots")' "$SCHEMA" && grep -qF '"applicationId" UUID' <<<"$MIG" &&
  grep -qF '"franchiseApplicationId" UUID' <<<"$MIG" &&
  ok "the tables and columns the script names exist in the depot migrations" ||
  bad "the script names a table or column the depot migrations do not create"
grep -q '^  stage .*FranchiseAppStage' "$SCHEMA" && ok "franchise_applications.stage exists" || bad "franchise_applications.stage is gone"

# It must not reach for a standing route: nothing but the one file names the ids.
# Every DELETE must be filtered by the validated id array (the heredoc one included); no TRUNCATE or DROP.
CODE="$(grep -vE '^[[:space:]]*#' scripts/purge-applications.sh)"
if grep -qiE 'truncate|drop (table|database)' <<<"$CODE"; then
  bad "the script contains a TRUNCATE or DROP"
elif [ "$(grep -ciE 'delete from' <<<"$CODE")" -lt 2 ] || grep -iE 'delete from' <<<"$CODE" | grep -qvF 'ANY($ARR)'; then
  bad "a DELETE in the script lacks a WHERE on the validated id array"
else
  ok "every DELETE is filtered by the validated id array"
fi
# The committed batch file itself must pass the script's own parser.
bash -c '
  grep -vE "^\s*(#|$)" ops/purge-applications.txt | grep -qvE "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" && exit 1
  [ "$(grep -cvE "^\s*(#|$)" ops/purge-applications.txt)" -ge 1 ]' &&
  ok "ops/purge-applications.txt holds only lowercase uuids" || bad "ops/purge-applications.txt has a line that is not a lowercase uuid"

# --------------------------------------------------------------------------- the database
if ! docker version >/dev/null 2>&1; then
  echo "  SKIPPED: no Docker daemon, so the script cannot be run against a real schema here."
  [ "$fails" -eq 0 ] && { echo "purge-applications: static checks passed"; exit 0; } || exit 1
fi

PG="hm-purge-test-$$"
T="$(mktemp -d)"
cleanup() { docker rm -f "$PG" >/dev/null 2>&1; rm -rf "$T"; }
trap cleanup EXIT

if ! docker run -d --name "$PG" -e POSTGRES_USER=hydromart -e POSTGRES_PASSWORD=x postgres:16-alpine >/dev/null 2>&1; then
  echo "  SKIPPED: could not start postgres:16-alpine (no image and no network?)."
  [ "$fails" -eq 0 ] && { echo "purge-applications: static checks passed"; exit 0; } || exit 1
fi
# The image runs a TEMPORARY server first; wait for the real one (see go-live-tools.test.sh).
for _ in $(seq 1 90); do
  if docker logs "$PG" 2>&1 | grep -q 'PostgreSQL init process complete' &&
    [ "$(docker logs "$PG" 2>&1 | grep -c 'ready to accept connections')" -ge 2 ] &&
    docker exec "$PG" pg_isready -U hydromart >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

q() { docker exec "$PG" psql -tAqU hydromart -d "$1" -c "$2" 2>&1; }

docker exec "$PG" psql -qU hydromart -d postgres -c "create database hydromart_depot" -c "create database ai" >/dev/null
for dir in $(ls services/depot-service/prisma/migrations | grep -E '^[0-9]' | sort); do
  file="services/depot-service/prisma/migrations/$dir/migration.sql"
  [ -f "$file" ] && docker exec -i "$PG" psql -qU hydromart -d hydromart_depot <"$file" >/dev/null 2>&1
done
q ai "create table prospects (id serial primary key, legacy_application_id uuid unique)" >/dev/null

A=aaaaaaaa-0000-4000-8000-000000000001 # PENDING, imported
B=bbbbbbbb-0000-4000-8000-000000000002 # SURVEY, imported
C=cccccccc-0000-4000-8000-000000000003 # APPROVED, imported
D=dddddddd-0000-4000-8000-000000000004 # PENDING, NOT imported
E=eeeeeeee-0000-4000-8000-000000000005 # PENDING, imported, not in any batch file
M=ffffffff-0000-4000-8000-000000000006 # named, but not in hydromart
for spec in "$A:PENDING" "$B:SURVEY" "$C:APPROVED" "$D:PENDING" "$E:PENDING"; do
  id="${spec%%:*}"
  stage="${spec##*:}"
  q hydromart_depot "insert into franchise_applications (id,\"applicantName\",\"applicantPhone\",\"proposedCode\",\"proposedName\",city,province,lat,lng,\"investmentAmount\",\"projectedMonthlyRevenue\",stage,\"updatedAt\") values ('$id','n','+62','c-${id:0:2}','p','k','pr',0,0,1,1,'$stage',now())" >/dev/null
  q hydromart_depot "insert into franchise_application_stage_events (id,\"applicationId\",stage) values (gen_random_uuid(),'$id','PENDING'),(gen_random_uuid(),'$id','$stage')" >/dev/null
done
for id in $A $B $C $E; do q ai "insert into prospects (legacy_application_id) values ('$id')" >/dev/null; done
apps="$(q hydromart_depot 'select count(*) from franchise_applications')"
[ "$apps" = 5 ] && ok "the real depot schema and the fixture loaded" || { bad "fixture did not load (applications: $apps)"; exit 1; }

export PG_CONTAINER="$PG" AIWEB_DB_CONTAINER="$PG" AIWEB_PG_USER=hydromart PURGE_BACKUP_CMD=true
state() { echo "$(q hydromart_depot 'select count(*) from franchise_applications')/$(q hydromart_depot 'select count(*) from franchise_application_stage_events')"; }
BEFORE="$(state)"
[ "$BEFORE" = "5/10" ] || bad "fixture counts unexpected: $BEFORE"
batch() { printf '%s\n' "$@" >"$T/batch.txt"; export PURGE_FILE="$T/batch.txt"; }
run() { bash scripts/purge-applications.sh "$@" 2>&1; }
exec_() { CONFIRM=PURGE-APPLICATIONS run --execute; }

# bad file
batch "# header" "$A" "not-a-uuid"
OUT="$(run)"
[ "$?" = 2 ] && printf '%s' "$OUT" | grep -q 'line 3' && ok "a bad line exits 2 and names the line number" || bad "a bad line must exit 2 naming line 3: $OUT"
batch "$A" "$A"
run >/dev/null
[ "$?" = 2 ] && ok "a repeated id exits 2" || bad "a duplicate must exit 2"
batch "# nothing"
run >/dev/null
[ "$?" = 2 ] && ok "an empty batch exits 2" || bad "an empty batch must exit 2"

# dry run
batch "$A" "$B" "$M"
OUT="$(run)"
[ "$?" = 0 ] && [ "$(state)" = "$BEFORE" ] && ok "a dry run writes nothing" || bad "the dry run must write nothing and exit 0"
printf '%s' "$OUT" | grep -q 'named: 3' && printf '%s' "$OUT" | grep -q 'found: 2' && printf '%s' "$OUT" | grep -q 'PENDING|1' &&
  printf '%s' "$OUT" | grep -q "$M" && printf '%s' "$OUT" | grep -q 'stage events: 4' && printf '%s' "$OUT" | grep -q 'imported in the AI web: 2' &&
  ok "the dry run reports named, found per stage, missing ids, events and imported" || bad "the dry run report is wrong: $OUT"

# refusals: each must exit 1, leave every row alone AND say the expected reason, so a case cannot
# pass for the wrong one.
refused() { # <label> <reason substring> <output> <exit code>
  [ "$4" = 1 ] && grep -qF -- "!! refusing: " <<<"$3" && grep -qF -- "$2" <<<"$3" && [ "$(state)" = "$BEFORE" ] &&
    ok "$1" || bad "$1 (wanted exit 1 + '$2', rows unchanged; exit $4): $3"
}
batch "$A" "$B"
OUT="$(run --execute)"
refused "--execute without the phrase refuses" "set CONFIRM=PURGE-APPLICATIONS" "$OUT" "$?"
batch "$A" "$B" "$M"
OUT="$(exec_)"
refused "a named id hydromart does not hold (stale file) refuses" "the file is stale" "$OUT" "$?"
batch "$A" "$C"
OUT="$(exec_)"
refused "an APPROVED application refuses" "are APPROVED" "$OUT" "$?"
batch "$A" "$D"
OUT="$(exec_)"
refused "an application not imported in the AI web refuses" "not in the AI web CRM yet" "$OUT" "$?"
batch "$A" "$B"
OUT="$(AIWEB_DB_CONTAINER= exec_)"
refused "no AI web container refuses" "the AI web database cannot be read" "$OUT" "$?"
OUT="$(AIWEB_PG_DB=postgres exec_)"
refused "an AI web database without a prospects table refuses" "the AI web database cannot be read" "$OUT" "$?"
q ai "alter table prospects rename column legacy_application_id to legacy_app" >/dev/null
OUT="$(exec_)"
refused "an AI web prospects table without the column refuses" "the AI web database cannot be read" "$OUT" "$?"
q ai "alter table prospects rename column legacy_app to legacy_application_id" >/dev/null
q hydromart_depot "insert into depots (id,code,name,\"ownershipType\",address,city,province,lat,lng,\"deliveryFee\",\"updatedAt\",\"franchiseApplicationId\") values ('99999999-0000-4000-8000-000000000009','D-REF','d','WARALABA','a','c','p',0,0,0,now(),'$B')" >/dev/null
OUT="$(exec_)"
refused "an application a depot references refuses" "depot(s) still reference" "$OUT" "$?"
q hydromart_depot "delete from depots where code='D-REF'" >/dev/null
OUT="$(PURGE_BACKUP_CMD=false exec_)"
refused "a failed backup refuses and deletes nothing" "the backup failed" "$OUT" "$?"

# The in-transaction guard: an application turns APPROVED between the checks and the delete (here,
# during the "dump"). The delete must roll back whole, stage events included.
FLIP="$T/flip.sh"
printf '#!/usr/bin/env bash\ndocker exec "%s" psql -qU hydromart -d hydromart_depot -c "update franchise_applications set stage = '"'"'APPROVED'"'"' where id = '"'"'%s'"'"'"\n' "$PG" "$B" >"$FLIP"
OUT="$(PURGE_BACKUP_CMD="bash $FLIP" exec_)"
RC=$?
[ "$RC" != 0 ] && grep -qF 'rolled back' <<<"$OUT" && [ "$(state)" = "$BEFORE" ] &&
  ok "an application approved mid-run rolls the whole delete back" || bad "the in-transaction guard failed (exit $RC, rows $(state)): $OUT"
q hydromart_depot "update franchise_applications set stage = 'SURVEY' where id = '$B'" >/dev/null

# happy path
OUT="$(exec_)"
[ "$?" = 0 ] && [ "$(state)" = "3/6" ] && printf '%s' "$OUT" | grep -q 'deleted: 2 application' &&
  ok "the happy path deletes exactly the 2 named rows and their stage events" || bad "the delete is wrong: $(state) $OUT"
[ "$(q hydromart_depot "select string_agg(id::text, ',' order by id) from franchise_applications")" = "$C,$D,$E" ] &&
  ok "every other application is untouched" || bad "an application outside the batch changed"

if [ "$fails" -gt 0 ]; then
  echo "purge-applications: $fails check(s) failed" >&2
  exit 1
fi
echo "purge-applications: all checks passed"
