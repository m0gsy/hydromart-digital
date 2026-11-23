#!/usr/bin/env bash
# The runnable check for HD-9b's scripts/backup-aiweb-db.sh.
#
#   bash scripts/backup-aiweb-db.test.sh
#
# 1. The nightly dump, against a fake docker: a missing AI web is said (once a week, exit 2) and
#    an unhealthy or failing one alerts (exit 1), never leaving a file under a dump's name; a good
#    dump lands as aiweb-<stamp>.sql.gz, the newest 14 are kept and hydromart's dumps beside them
#    are never touched; nothing is ever reported to admin-service's backup card (hydromart's).
# 2. The drill, against real Postgres containers: a real dump of a database shaped like the AI
#    web's restores and passes; a truncated dump, a dump with a failing statement, a dump without
#    its rows and a dump without its row level security each fail; the live database is never
#    written; the scratch container is always removed. Needs docker; without it this says SKIPPED
#    and the fake-docker half still runs.
set -uo pipefail
# CI runs these as `bash -e file`; the cases below fail on purpose.
set +e
cd "$(dirname "$0")/.."

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}
W="$(mktemp -d)"
LIVE=hd9b-test-aiweb-live
DRILL=hd9b-test-aiweb-drill
cleanup() {
  docker rm -fv "$LIVE" "$DRILL" >/dev/null 2>&1 || true
  rm -rf "$W"
}
trap cleanup EXIT

# ------------------------------------------------------------------ 1. the dump, fake docker
echo "backup-aiweb-db.sh (fake docker):"
mkdir -p "$W/bin" "$W/backups"
cat > "$W/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_LOG"
case "$1" in
  inspect) echo "${FAKE_HEALTH:-healthy}" ;;
  rm) [ -n "${FAKE_RM_FAIL:-}" ] && exit 1 ;;
  exec)
    case "$*" in
      *pg_dump*)
        [ "${FAKE_DUMP:-good}" = tiny ] && { echo '-- empty'; exit 0; }
        for i in $(seq 1 80); do echo "INSERT INTO answer_trail VALUES ($i, 'row $i $RANDOM$RANDOM$RANDOM$RANDOM');"; done
        [ "${FAKE_DUMP:-good}" = fail ] && { echo 'pg_dump: error: connection lost' >&2; exit 1; }
        exit 0 ;;
    esac ;;
esac
exit 0
EOF
cat > "$W/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_ALERTS"
exit 0
EOF
# df, so how full the disk is comes from the test (FAKE_DF_PCT), never from this machine's.
cat > "$W/bin/df" <<'EOF'
#!/usr/bin/env bash
echo 'Filesystem 1024-blocks Used Available Capacity Mounted on'
echo "fake 1000000 500000 500000 ${FAKE_DF_PCT:-50}% /"
EOF
chmod +x "$W/bin/docker" "$W/bin/curl" "$W/bin/df"
mkdir -p "$W/dfbin"
cp "$W/bin/df" "$W/dfbin/df"

run_dump() { # <env...>
  : > "$W/log"
  : > "$W/alerts"
  OUT="$(env PATH="$W/bin:$PATH" FAKE_LOG="$W/log" FAKE_ALERTS="$W/alerts" BACKUP_DIR="$W/backups" \
    ALERT_WEBHOOK_URL=http://alert.invalid/hook ALERT_MEMORY_DIR="$W/alerted" AIWEB_DB_CONTAINER=fake-db \
    "$@" bash scripts/backup-aiweb-db.sh 2>&1)"
  RC=$?
}
aiweb_dumps() { ls -1 "$W/backups"/aiweb-*.sql.gz 2>/dev/null | wc -l | tr -d ' '; }

run_dump AIWEB_DB_CONTAINER=
[ "$RC" = 2 ] && [ "$(aiweb_dumps)" = 0 ] && [ -s "$W/alerted/aiweb-backup" ] &&
  ok "no AI web database here: exit 2, said once (alert_once), nothing written" || bad "absent: rc=$RC, $OUT"
run_dump AIWEB_DB_CONTAINER=
[ "$RC" = 2 ] && [ ! -s "$W/alerts" ] && ok "  ...and not said again the next night" || bad "absent twice alerted twice"

run_dump FAKE_HEALTH=unhealthy
[ "$RC" = 1 ] && [ "$(aiweb_dumps)" = 0 ] && grep -q 'unhealthy' "$W/alerts" && ! grep -q pg_dump "$W/log" &&
  ok "an unhealthy database: exit 1, an alert naming it, nothing dumped" || bad "unhealthy: rc=$RC, $OUT"

run_dump FAKE_DUMP=fail
[ "$RC" = 1 ] && [ "$(aiweb_dumps)" = 0 ] && ! ls "$W/backups"/.aiweb-* >/dev/null 2>&1 && grep -q 'pg_dump' "$W/alerts" &&
  ok "pg_dump failing half way: exit 1, alert, and no file under a dump's name (not even the part)" || bad "failing dump: rc=$RC, $OUT"

run_dump FAKE_DUMP=tiny
[ "$RC" = 1 ] && [ "$(aiweb_dumps)" = 0 ] && grep -q 'not a backup' "$W/alerts" &&
  ok "a dump too small to be one is refused, and alerted" || bad "tiny dump: rc=$RC, $OUT"

# The disk hydromart's database and dumps live on is 95% full: the AI web's dump waits, and says so.
run_dump FAKE_DF_PCT=95
[ "$RC" = 1 ] && [ "$(aiweb_dumps)" = 0 ] && grep -q '95% full' "$W/alerts" && ! grep -q pg_dump "$W/log" &&
  ok "a disk 95% full: no dump taken, and alerted" || bad "full disk: rc=$RC, $OUT"

# Retention, with hydromart's dumps in the same directory.
for d in 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15; do
  printf 'old\n' | gzip > "$W/backups/aiweb-202611${d}-030500.sql.gz"
  touch -d "2026-11-$d 03:05" "$W/backups/aiweb-202611${d}-030500.sql.gz" 2>/dev/null
done
for d in 01 02 03; do printf 'hydromart\n' | gzip > "$W/backups/hydromart-202611${d}-030000.sql.gz"; done
run_dump
newest="$(ls -1t "$W/backups"/aiweb-*.sql.gz | head -1)"
[ "$RC" = 0 ] && gzip -t "$newest" && gunzip -c "$newest" | grep -q 'VALUES (80, ' &&
  ok "a good dump lands as aiweb-<stamp>.sql.gz, whole and valid gzip" || bad "good dump: rc=$RC, $OUT"
[ "$(aiweb_dumps)" = 14 ] && [ ! -e "$W/backups/aiweb-20261101-030500.sql.gz" ] && [ ! -e "$W/backups/aiweb-20261102-030500.sql.gz" ] &&
  ok "keeps the newest 14 AI web dumps, the oldest go" || bad "retention: $(aiweb_dumps) AI web dumps left"
[ "$(ls -1 "$W/backups"/hydromart-*.sql.gz | wc -l | tr -d ' ')" = 3 ] &&
  ok "hydromart's dumps in the same directory are never touched" || bad "a hydromart dump was removed"
grep -q 'admin' "$W/log" && bad "reported to admin-service, whose backup card is hydromart's" ||
  ok "never reports to admin-service's backup card (that verdict is hydromart's)"
[ ! -e "$W/alerted/aiweb-backup" ] && ok "a good night forgets the 'not on this box' memory" || bad "the absence memory survived a good dump"

# A drill that fails before it has a scratch container still alerts, even when docker cannot remove
# that container: under set -e the clean-up must not end the exit trap before its alert.
: > "$W/alerts"
OUT="$(env PATH="$W/bin:$PATH" FAKE_LOG="$W/log" FAKE_ALERTS="$W/alerts" FAKE_RM_FAIL=1 BACKUP_DIR="$W/no-dumps" \
  ALERT_WEBHOOK_URL=http://alert.invalid/hook ALERT_MEMORY_DIR="$W/alerted" AIWEB_DB_CONTAINER=fake-db \
  bash scripts/backup-aiweb-db.sh --drill 2>&1)"
RC=$?
[ "$RC" = 1 ] && grep -q 'restore drill FAILED: no aiweb' "$W/alerts" &&
  ok "a drill with nothing to restore alerts, even when docker cannot clean up" || bad "early drill failure: rc=$RC, alerts=$(cat "$W/alerts"), $OUT"

# The scratch database is capped, so a restore cannot take memory or CPU from the live stack.
: > "$W/log"
env PATH="$W/bin:$PATH" FAKE_LOG="$W/log" FAKE_ALERTS="$W/alerts" BACKUP_DIR="$W/backups" AIWEB_PG_IMAGE=fake-pg \
  ALERT_WEBHOOK_URL= ALERT_MEMORY_DIR="$W/alerted" AIWEB_DB_CONTAINER=fake-db \
  bash scripts/backup-aiweb-db.sh --drill >/dev/null 2>&1
grep -E '^run ' "$W/log" | grep -q -- '--network none --memory 512m --cpus 0.5 ' &&
  ok "the scratch database runs with no network, 512m of memory and half a CPU" || bad "scratch limits: $(grep -E '^run ' "$W/log")"

# ------------------------------------------------------------- 2. the drill, real Postgres
echo "backup-aiweb-db.sh --drill (real Postgres):"
if ! docker info >/dev/null 2>&1; then
  echo "  SKIPPED: docker is not available, so the drill cases did not run. Run this where it is."
  [ "$fails" -eq 0 ] && echo "backup-aiweb-db: all checks that could run passed" && exit 0
  exit 1
fi
IMAGE="${PG_IMAGE:-postgres:16-alpine}"
docker run -d --name "$LIVE" -e POSTGRES_PASSWORD=live "$IMAGE" >/dev/null || { bad "could not start $IMAGE"; exit 1; }
for i in $(seq 1 60); do
  docker exec "$LIVE" psql -tAX -h 127.0.0.1 -U postgres -c 'SELECT 1' >/dev/null 2>&1 && break
  sleep 1
done
# A database shaped like the AI web's: owner and app roles, RLS forced on answer_trail, the app's
# row privileges with UPDATE/DELETE taken back on the record table, one applied migration, rows.
docker exec -i "$LIVE" psql -qX -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null <<'SQL'
CREATE ROLE ai_owner LOGIN PASSWORD 'o';
CREATE ROLE ai_app LOGIN PASSWORD 'a';
CREATE DATABASE ai OWNER ai_owner;
\connect ai
SET ROLE ai_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE ai_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ai_app;
CREATE TABLE "_prisma_migrations" (id text PRIMARY KEY, migration_name text, finished_at timestamptz);
INSERT INTO "_prisma_migrations" VALUES ('1', '20261123120000_ai4_data_layer', now());
CREATE TABLE answer_trail (id serial PRIMARY KEY, legal_entity_ids text[] NOT NULL, note text);
ALTER TABLE answer_trail ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_trail FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped ON answer_trail USING (legal_entity_ids <@ string_to_array(current_setting('app.legal_entity_ids', true), ','));
REVOKE UPDATE, DELETE, TRUNCATE ON answer_trail FROM ai_app;
CREATE TABLE kill_switches (name text PRIMARY KEY, engaged boolean NOT NULL);
INSERT INTO kill_switches SELECT 'switch-' || g, false FROM generate_series(1, 40) g;
RESET ROLE;
INSERT INTO answer_trail (legal_entity_ids, note) SELECT ARRAY['le-1'], 'answer ' || g FROM generate_series(1, 25) g;
SQL
live_rows() { docker exec "$LIVE" psql -tAX -U postgres -d ai -c 'SELECT (SELECT count(*) FROM kill_switches) + (SELECT count(*) FROM answer_trail)'; }
BEFORE="$(live_rows)"

drill_env=(env PATH="$W/dfbin:$PATH" BACKUP_DIR="$W/drill" AIWEB_DB_CONTAINER="$LIVE" AIWEB_PG_IMAGE=
  AIWEB_DRILL_CONTAINER="$DRILL" ALERT_WEBHOOK_URL= ALERT_MEMORY_DIR="$W/alerted2")
mkdir -p "$W/drill"
OUT="$("${drill_env[@]}" bash scripts/backup-aiweb-db.sh 2>&1)"
RC=$?
DUMP="$(ls -1t "$W/drill"/aiweb-*.sql.gz 2>/dev/null | head -1)"
[ "$RC" = 0 ] && [ -n "$DUMP" ] && ok "a real dump of the live database is taken" || bad "real dump: rc=$RC, $OUT"

drill() { # <dump>
  OUT="$("${drill_env[@]}" bash scripts/backup-aiweb-db.sh --drill "$1" 2>&1)"
  RC=$?
}
drill "$DUMP"
[ "$RC" = 0 ] && grep -q 'drill OK' <<<"$OUT" && grep -q 'kill_switches has 40 rows' <<<"$OUT" &&
  ok "the dump restores into a scratch container and matches live (tables, migrations, rows, privileges, RLS)" ||
  bad "a good dump did not pass the drill: rc=$RC, $OUT"
LIVE_IMAGE="$(docker inspect --format '{{.Image}}' "$LIVE")"
grep -qF "($LIVE_IMAGE)" <<<"$OUT" && ok "  ...into the image the live database runs, by its id (nothing pulled)" ||
  bad "the drill did not use the live database's image $LIVE_IMAGE: $OUT"
docker ps -a --format '{{.Names}}' | grep -qx "$DRILL" && bad "the scratch container was left behind" ||
  ok "the scratch container is removed afterwards"

head -c 300 "$DUMP" > "$W/truncated.sql.gz"
drill "$W/truncated.sql.gz"
[ "$RC" = 1 ] && grep -q 'not valid gzip' <<<"$OUT" && ok "a truncated dump fails the drill" || bad "truncated: rc=$RC, $OUT"

{ gunzip -c "$DUMP"; echo 'SELECT * FROM a_table_that_is_not_there;'; } | gzip > "$W/broken.sql.gz"
drill "$W/broken.sql.gz"
[ "$RC" = 1 ] && grep -q 'did not restore' <<<"$OUT" && ok "a dump with a statement that fails, fails the drill" || bad "broken: rc=$RC, $OUT"

gunzip -c "$DUMP" | awk '/^COPY public.kill_switches /{skip=1; print; next} skip && /^\\\.$/{skip=0} !skip' | gzip > "$W/norows.sql.gz"
drill "$W/norows.sql.gz"
[ "$RC" = 1 ] && grep -q 'EMPTY in the restore' <<<"$OUT" && ok "a dump that lost its rows fails the drill" || bad "no rows: rc=$RC, $OUT"

gunzip -c "$DUMP" | grep -v 'FORCE ROW LEVEL SECURITY' | gzip > "$W/norls.sql.gz"
drill "$W/norls.sql.gz"
[ "$RC" = 1 ] && grep -q 'row level security' <<<"$OUT" && ok "a dump that lost FORCE ROW LEVEL SECURITY fails the drill" || bad "no RLS: rc=$RC, $OUT"

[ "$(live_rows)" = "$BEFORE" ] && ok "the live database was only read: $BEFORE rows before and after" ||
  bad "the live database changed: $BEFORE rows before, $(live_rows) after"

if [ "$fails" -gt 0 ]; then
  echo "backup-aiweb-db: $fails check(s) failed" >&2
  exit 1
fi
echo "backup-aiweb-db: all checks passed"
