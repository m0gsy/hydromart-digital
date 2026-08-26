#!/usr/bin/env bash
# The runnable check for CMP-01 — scripts/restore-db.sh --into-prod.
#
#   bash scripts/restore-db.test.sh
#
# That branch had four lines and printed "restore complete." whether anything had been
# restored or not. The scenario it exists for is the one it failed in: at 03:00 the databases
# still EXIST (the volume is fine, the ROWS are corrupt), so every CREATE DATABASE and every
# COPY errors — and psql exits 0 unless told not to. Nobody told it.
#
# Every case below was first run by hand against real Postgres containers on 2026-08-27; this
# file is that session made repeatable. It builds a source cluster holding 137 + 42 rows,
# dumps it, and restores into a second container:
#
#   1. into an EMPTY cluster            -> 0, and the row counts are printed
#   2. into a POPULATED cluster         -> 1 (refused; this is the 03:00 case)
#   3. ...same state, the OLD pipeline  -> 0 (the lie, asserted explicitly)
#   4. with DROP_EXISTING=YES           -> 0, and the rows are back to 179
#   5. a SCHEMA-ONLY dump               -> 1 ("that is a schema, not a recovery")
#   6. a dump with a failing statement  -> 1, and the error is printed
#
# Needs docker. Without it those six cannot run: this says SKIPPED loudly and still runs the
# two that need nothing, rather than exiting 0 in silence — a check that always passes is the
# exact failure class this file exists about.
set -uo pipefail
cd "$(dirname "$0")/.."

SRC=cmp01-test-source
DST=cmp01-test-target
IMAGE="${PG_IMAGE:-postgres:16-alpine}"
WORK="$(mktemp -d)"
fails=0

ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}
check() {
  local label="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then ok "$label"; else bad "$label (want exit $want, got $got)"; fi
}

# Sets OUT and RC in THIS shell. Note every case below calls a FUNCTION with the environment
# baked into it: a `VAR=x run ...` prefix lands in a temporary environment bash does not
# carry back out, and RC came back empty every time.
OUT=''
RC=0
run() {
  set +e
  OUT="$("$@" 2>&1)"
  RC=$?
  set -e
}

cleanup() {
  docker rm -f "$SRC" "$DST" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# --- cases that need no cluster ----------------------------------------------------------
echo "restore-db: refusals that need no cluster"
no_confirm() { CONFIRM= PG_CONTAINER=nope bash scripts/restore-db.sh --into-prod /dev/null; }
run no_confirm
check "refuses --into-prod without CONFIRM=RESTORE" 1 "$RC"

# Exit 1 rather than the usage 2: the dump is checked before the mode is, and no dump exists
# on this box. Either way nothing ran, which is the claim.
run bash scripts/restore-db.sh --nonsense
check "an unknown mode runs nothing" 1 "$RC"

if ! docker info >/dev/null 2>&1; then
  echo ""
  echo "  SKIPPED: docker is not available, so the six restore cases did not run."
  echo "  They are the whole point of this file — run it where docker is."
  exit "$fails"
fi

pg() { docker exec "$1" psql -qAX -U hydromart -d "${2:-postgres}" -c "$3" >/dev/null 2>&1; }
wait_ready() {
  local c="$1" i
  for i in $(seq 1 60); do
    docker exec "$c" pg_isready -U hydromart >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}
fresh() {
  docker rm -f "$1" >/dev/null 2>&1 || true
  docker run -d --name "$1" -e POSTGRES_USER=hydromart -e POSTGRES_PASSWORD=drill \
    -e POSTGRES_DB=postgres "$IMAGE" >/dev/null
  wait_ready "$1"
}

echo "restore-db: building a source cluster with real rows"
fresh "$SRC" || { bad "source Postgres never became ready"; exit "$fails"; }
pg "$SRC" postgres "CREATE DATABASE hydromart_orders;"
pg "$SRC" postgres "CREATE DATABASE hydromart_payments;"
pg "$SRC" hydromart_orders \
  "CREATE TABLE orders(id serial primary key, total int); INSERT INTO orders(total) SELECT g*1000 FROM generate_series(1,137) g;"
pg "$SRC" hydromart_payments \
  "CREATE TABLE payments(id serial primary key, amount int); INSERT INTO payments(amount) SELECT g*500 FROM generate_series(1,42) g;"

DUMP="$WORK/hydromart-20260827-000000.sql.gz"
docker exec "$SRC" pg_dumpall -U hydromart | gzip >"$DUMP"
docker exec "$SRC" pg_dumpall -U hydromart --schema-only | gzip >"$WORK/schema-only.sql.gz"
{ gunzip -c "$DUMP"; echo "INSERT INTO tabel_yang_tidak_ada VALUES (1);"; } | gzip >"$WORK/broken.sql.gz"

restore() {
  CONFIRM=RESTORE PG_CONTAINER="$DST" PG_USER=hydromart \
    bash scripts/restore-db.sh --into-prod "$1"
}
restore_drop() {
  CONFIRM=RESTORE DROP_EXISTING=YES PG_CONTAINER="$DST" PG_USER=hydromart \
    bash scripts/restore-db.sh --into-prod "$1"
}

echo "restore-db: the six cases"
fresh "$DST" || { bad "target Postgres never became ready"; exit "$fails"; }

run restore "$DUMP"
check "1. empty cluster restores" 0 "$RC"
case "$OUT" in
  *"137 rows"*"42 rows"*"179 rows total"*) ok "1b. it counted the rows it restored (137 + 42 = 179)" ;;
  *) bad "1b. row counts missing from the output: $OUT" ;;
esac

# The 03:00 case. The databases exist; their ROWS are what is wrong.
run restore "$DUMP"
check "2. populated cluster is refused" 1 "$RC"

# ...and this is what the four-line version did in that exact state. If this ever stops
# failing, psql has changed its exit behaviour and the guard above can be reconsidered.
set +e
gunzip -c "$DUMP" | docker exec -i "$DST" psql -U hydromart -d postgres >/dev/null 2>&1
OLD_RC=$?
set -e
check "3. the OLD pipeline exits 0 in that same state (the lie)" 0 "$OLD_RC"

run restore_drop "$DUMP"
check "4. DROP_EXISTING=YES restores it properly" 0 "$RC"
case "$OUT" in
  *"179 rows total"*) ok "4b. and the rows are all back" ;;
  *) bad "4b. expected 179 rows after the drop-and-restore: $OUT" ;;
esac

run restore_drop "$WORK/schema-only.sql.gz"
check "5. a schema-only dump is not a recovery" 1 "$RC"
case "$OUT" in
  *"ZERO rows"*) ok "5b. and it says so in those words" ;;
  *) bad "5b. expected a ZERO rows failure: $OUT" ;;
esac

run restore_drop "$WORK/broken.sql.gz"
check "6. a dump with a failing statement fails the restore" 1 "$RC"
case "$OUT" in
  *tabel_yang_tidak_ada*) ok "6b. and it prints the error it saw" ;;
  *) bad "6b. expected the failing statement in the output: $OUT" ;;
esac

exit "$fails"
