#!/usr/bin/env bash
# The runnable check for DB-1 / MONEY-02 — an INVALID index must not read as "present".
#
#   bash scripts/check-index-validity.test.sh
#
# What was wrong: `CREATE UNIQUE INDEX CONCURRENTLY` that fails does not roll back. It
# leaves the index behind with `pg_index.indisvalid = false`, and `pg_indexes` lists that
# one exactly like a good one. Both the end-state re-check in create-indexes.sh and
# index_exists() in verify-indexes.sh asked pg_indexes, so both said present, both exited 0,
# and the release went out on top of a unique index that enforces nothing.
#
# Measured on a real Postgres 16 before this file was written:
#
#   CREATE UNIQUE INDEX CONCURRENTLY on duplicated data  -> ERROR: could not create ...
#   SELECT 1 FROM pg_indexes WHERE indexname='t_oid_key' -> 1          <- the lie
#   SELECT indisvalid ...                                -> f
#   INSERT of a third duplicate row                      -> INSERT 0 1 <- enforces nothing
#
# That matters here and not in the abstract: `gallon_issues_orderId_key` is in the
# create-indexes.sh table. It is the only thing making the deposit-held booking idempotent,
# because Prisma's `upsert` is a SELECT-then-INSERT with nothing behind it. Invalid index,
# green deploy, at-least-once completion fan-out — the same deposit booked twice.
#
# Needs docker. Without it the two container cases cannot run: this says SKIPPED loudly and
# still runs the source assertions, rather than exiting 0 in silence.
set -uo pipefail
# NOTE: CI invokes shell checks as `bash -e file`, which sets -e for the whole script no
# matter what this file asks for — and the cases below run commands that are SUPPOSED to
# fail (a unique build on duplicated data; create-indexes.sh exiting 1). Under -e the first
# of those kills the run and reports it as this script's own failure.
set +e
cd "$(dirname "$0")/.."

PG=dbi-test-pg
IMAGE="${PG_IMAGE:-postgres:16-alpine}"
fails=0

ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

# ---------------------------------------------------------------------------
# 1. Source assertions — no bare pg_indexes presence probe may survive anywhere.
#    Cheap, runs without docker, and is the one that stays red if somebody
#    reintroduces the pattern in a third script.
# ---------------------------------------------------------------------------
echo "== source =="
STRAY="$(grep -n "FROM pg_indexes" scripts/create-indexes.sh scripts/verify-indexes.sh 2>/dev/null | grep -v ':[0-9]*: *#')"
if [ -z "$STRAY" ]; then
  ok "no index-presence probe reads pg_indexes (it cannot see indisvalid)"
else
  bad "a presence probe still reads pg_indexes:"
  echo "$STRAY" | sed 's/^/       /'
fi

for f in scripts/create-indexes.sh scripts/verify-indexes.sh; do
  if grep -q "indisvalid" "$f"; then
    ok "$f asserts indisvalid"
  else
    bad "$f never mentions indisvalid, so an invalid index reads as present"
  fi
done

# ---------------------------------------------------------------------------
# 2. Behaviour, against a real Postgres.
# ---------------------------------------------------------------------------
if ! docker info >/dev/null 2>&1; then
  echo
  echo "== containers: SKIPPED — no docker daemon reachable =="
  echo "   The three cases below did NOT run. That is not a pass."
  echo
  [ "$fails" -eq 0 ] && exit 0
  exit 1
fi

echo
echo "== containers =="
docker rm -f "$PG" >/dev/null 2>&1
docker run -d --name "$PG" -e POSTGRES_USER=hydromart -e POSTGRES_PASSWORD=x \
  -e POSTGRES_DB=postgres "$IMAGE" >/dev/null 2>&1 || {
  echo "  FAIL could not start $IMAGE"
  exit 1
}
cleanup() { docker rm -f "$PG" >/dev/null 2>&1; }
trap cleanup EXIT

# Readiness, and NOT `pg_isready`.
#
# The entrypoint of this image starts a TEMPORARY server on a unix socket to run initdb,
# then shuts it down and starts the real one. `pg_isready` answers yes to that temporary
# server, so the loop fell through while the cluster was still bootstrapping — the
# CREATE DATABASE that came next hit a socket that was about to disappear, and every case
# below then ran against a database that did not exist.
#
# What the cases need is "this server will accept a connection AND run a statement", so
# that is what is asked. On CI this cost one retry; the old form cost four false failures
# that looked like the checker was wrong.
ready=0
for _ in $(seq 1 60); do
  if docker exec "$PG" psql -tAX -U hydromart -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[ "$ready" = "1" ] || bad "Postgres never accepted a connection; nothing below is meaningful"

psql_do() { docker exec "$PG" psql -tAX -U hydromart -d "$1" -c "$2" 2>&1; }
# Statements carrying SQL string literals go through stdin, not -c: a single-quoted shell
# string cannot hold a single quote, and the first version of this file silently sent
# unquoted UUIDs. Postgres refused them, the table was never created, and the concurrent
# build then "failed" for the wrong reason — a case that looked like it ran and had not.
psql_in() { docker exec -i "$PG" psql -tAX -v ON_ERROR_STOP=1 -U hydromart -d "$1" 2>&1; }

CREATED="$(psql_do postgres 'CREATE DATABASE hydromart_depot;')"
case "$CREATED" in
  *[Ee]rror* | *ERROR*) bad "could not create the fixture database: $CREATED" ;;
  *) ok "fixture database created" ;;
esac
# The real table, the real index name create-indexes.sh builds, and the duplicate row that
# makes the concurrent build fail — which is the only way to produce an invalid index.
SETUP="$(psql_in hydromart_depot <<'SQL'
CREATE TABLE "gallon_issues" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "orderId" uuid);
INSERT INTO "gallon_issues" ("orderId") VALUES
  ('11111111-1111-1111-1111-111111111111'),
  ('11111111-1111-1111-1111-111111111111');
SQL
)"
# Both spellings. psql prints SERVER errors as `ERROR:` and its OWN as `psql: error:` —
# and it was the lowercase one that came back when the database was missing, so this said
# the fixture was fine while nothing had been created.
case "$SETUP" in
  *ERROR* | *[Ee]rror*) bad "fixture setup failed, nothing below is meaningful: $SETUP" ;;
  *) ok "fixture: gallon_issues holds two rows with the same orderId" ;;
esac

BUILD="$(psql_do hydromart_depot 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "gallon_issues_orderId_key" ON "gallon_issues"("orderId");')"
case "$BUILD" in
  *"is duplicated"*) ok "the concurrent unique build failed on duplicated keys, as the case requires" ;;
  *) bad "the build did not fail on duplicate keys, so there is no invalid index to test against: $BUILD" ;;
esac

VALID="$(psql_do hydromart_depot 'SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = '"'"'gallon_issues_orderId_key'"'"';' | tr -d '[:space:]')"
if [ "$VALID" = "f" ]; then
  ok "the failed build left the index behind, indisvalid = f"
else
  bad "expected an index left behind with indisvalid=f, got '$VALID'"
fi

# The premise of the whole finding: this index enforces nothing.
psql_in hydromart_depot >/dev/null <<'SQL'
INSERT INTO "gallon_issues" ("orderId") VALUES ('11111111-1111-1111-1111-111111111111');
SQL
N="$(psql_do hydromart_depot 'SELECT count(*) FROM "gallon_issues";' | tr -d '[:space:]')"
if [ "$N" = "3" ]; then
  ok "a third duplicate INSERT succeeded — the invalid unique index enforces nothing"
else
  bad "expected the duplicate INSERT to be accepted (3 rows), got $N"
fi

# THE assertion. Before the fix this exits 0: the loop notices the invalid index, its FAIL=1
# is swallowed by the subshell, and the end-state re-check asks pg_indexes, which says present.
PG_CONTAINER="$PG" bash scripts/create-indexes.sh --check >/dev/null 2>&1
RC=$?
if [ "$RC" = "1" ]; then
  ok "create-indexes.sh --check exits 1 on an INVALID index"
else
  bad "create-indexes.sh --check exited $RC on an INVALID unique index — a deploy would proceed on an index that enforces nothing"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "PASS — an invalid index cannot read as present."
  exit 0
fi
echo "FAIL — $fails assertion(s) above."
exit 1
