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
# 3. AI-5, database n8n: dumped after ai's in the same file behind a \connect line (a failure of
#    either fails the night), and the drill's n8n proof run with the key by name, capped, on the
#    scratch network alone, failing on a credential the key does not open. With
#    AIWEB_TEST_N8N_IMAGE set (CI pulls no n8n), a real n8n seals and opens the credential.
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
TESTNET=hd9b-test-aiweb-n8n-net
cleanup() {
  docker rm -fv "$LIVE" "$DRILL" "$DRILL-n8n" >/dev/null 2>&1 || true
  docker network rm "$TESTNET" "$DRILL-net" >/dev/null 2>&1 || true
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
    [ "$2" = -i ] && cat >/dev/null
    case "$*" in
      *"pg_dump -U postgres -d n8n"*)
        for i in $(seq 1 20); do echo "INSERT INTO credentials_entity VALUES ('cred$i', 'sealed $RANDOM$RANDOM');"; done
        [ "${FAKE_DUMP:-good}" = n8nfail ] && { echo 'pg_dump: error: n8n is gone' >&2; exit 1; }
        exit 0 ;;
      *pg_dump*)
        [ "${FAKE_DUMP:-good}" = tiny ] && { echo '-- empty'; exit 0; }
        for i in $(seq 1 80); do echo "INSERT INTO answer_trail VALUES ($i, 'row $i $RANDOM$RANDOM$RANDOM$RANDOM');"; done
        [ "${FAKE_DUMP:-good}" = fail ] && { echo 'pg_dump: error: connection lost' >&2; exit 1; }
        exit 0 ;;
      # AI-5: database n8n exists live when FAKE_N8N is set; every table count is 3, in ai and n8n.
      *"FROM pg_database"*) [ -z "${FAKE_N8N:-}" ] || echo 1 ;;
      *"information_schema.tables"*) echo 3 ;;
    esac ;;
  run)
    # The n8n proof: what it got in its environment, and the answer FAKE_PROOF asks for.
    case "$*" in
      *"--entrypoint node"*)
        printf '%s|%s\n' "${N8N_ENCRYPTION_KEY:-}" "${N8N_PROOF_ID:-}" > "$FAKE_PROOF_ENV"
        [ "${FAKE_PROOF:-ok}" = ok ] && { echo opened; exit 0; }
        echo 'n8n export:credentials failed: Credentials could not be decrypted.'
        exit 1 ;;
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
  OUT="$(env PATH="$W/bin:$PATH" FAKE_LOG="$W/log" FAKE_ALERTS="$W/alerts" BACKUP_DIR="$W/backups" FAKE_PROOF_ENV="$W/proof-env" \
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

# The scratch database is capped, so a restore cannot take memory or CPU from the live stack, and
# sits on a network of its own that is internal (no way off it, nothing else on it).
: > "$W/log"
env PATH="$W/bin:$PATH" FAKE_LOG="$W/log" FAKE_ALERTS="$W/alerts" BACKUP_DIR="$W/backups" AIWEB_PG_IMAGE=fake-pg \
  FAKE_PROOF_ENV="$W/proof-env" ALERT_WEBHOOK_URL= ALERT_MEMORY_DIR="$W/alerted" AIWEB_DB_CONTAINER=fake-db \
  bash scripts/backup-aiweb-db.sh --drill >/dev/null 2>&1
grep -E '^run ' "$W/log" | grep -q -- '--network hydromart-ai-restore-drill-net --memory 512m --cpus 0.5 ' &&
  grep -qx 'network create --internal hydromart-ai-restore-drill-net' "$W/log" &&
  ok "the scratch database runs on its own internal network, with 512m of memory and half a CPU" ||
  bad "scratch limits: $(grep -E '^(run|network) ' "$W/log" | tr '\n' ' ')"
grep -qx 'network rm hydromart-ai-restore-drill-net' "$W/log" && grep -q '^rm -fv hydromart-ai-restore-drill-n8n hydromart-ai-restore-drill' "$W/log" &&
  ok "  ...and the scratch containers and network are removed however the drill ends" || bad "no clean-up: $(grep -E '^(rm|network rm)' "$W/log" | tr '\n' ' ')"

# ------------------------------------------------------- AI-5: n8n's database, fake docker
echo "backup-aiweb-db.sh, database n8n (fake docker):"
mkdir -p "$W/n8nbk"
run_n8n() { # <dump | drill FILE> <env...>: the dump, or the drill of FILE, against $W/n8nbk
  local args=()
  if [ "$1" = drill ]; then
    args=(--drill "$2")
    shift
  fi
  shift
  : > "$W/log"
  : > "$W/alerts"
  : > "$W/proof-env"
  OUT="$(env PATH="$W/bin:$PATH" FAKE_LOG="$W/log" FAKE_ALERTS="$W/alerts" FAKE_PROOF_ENV="$W/proof-env" \
    BACKUP_DIR="$W/n8nbk" AIWEB_PG_IMAGE=fake-pg AIWEB_N8N_IMAGE=fake-n8n AIWEB_N8N_ENCRYPTION_KEY=drill-key-0123456789 \
    ALERT_WEBHOOK_URL=http://alert.invalid/hook ALERT_MEMORY_DIR="$W/alerted3" AIWEB_DB_CONTAINER=fake-db \
    "$@" bash scripts/backup-aiweb-db.sh "${args[@]}" 2>&1)"
  RC=$?
}
run_n8n dump FAKE_N8N=1
# Copied aside: a dump is named by the second it was taken, so the next one can land on its name.
cp "$(ls -1t "$W/n8nbk"/aiweb-*.sql.gz 2>/dev/null | head -1)" "$W/n8n-dump.sql.gz"
N8N_DUMP="$W/n8n-dump.sql.gz"
mark="$(gunzip -c "$N8N_DUMP" 2>/dev/null | grep -nxF '\connect n8n' | cut -d: -f1)"
first_ai="$(gunzip -c "$N8N_DUMP" 2>/dev/null | grep -n 'INSERT INTO answer_trail' | head -1 | cut -d: -f1)"
first_n8n="$(gunzip -c "$N8N_DUMP" 2>/dev/null | grep -n 'INSERT INTO credentials_entity' | head -1 | cut -d: -f1)"
[ "$RC" = 0 ] && [ -n "$mark" ] && [ -n "$first_ai" ] && [ -n "$first_n8n" ] && [ "$first_ai" -lt "$mark" ] && [ "$mark" -lt "$first_n8n" ] &&
  grep -q 'databases ai n8n' <<<"$OUT" &&
  ok "with database n8n live: one file, ai's dump, then a \\connect n8n line, then n8n's" ||
  bad "the n8n dump: rc=$RC mark=$mark ai=$first_ai n8n=$first_n8n: $OUT"
run_n8n dump FAKE_N8N=1 FAKE_DUMP=n8nfail
[ "$RC" = 1 ] && grep -q 'pg_dump of database ai or n8n failed' "$W/alerts" && [ "$(ls -1 "$W/n8nbk"/aiweb-*.sql.gz | wc -l | tr -d ' ')" = 1 ] &&
  ! ls "$W/n8nbk"/.aiweb-* >/dev/null 2>&1 &&
  ok "n8n's pg_dump failing fails the whole night: alert, and no file under a dump's name" || bad "n8n dump failure: rc=$RC, $OUT"
run_n8n dump
[ "$RC" = 0 ] && grep -q 'no database n8n on this box yet' <<<"$OUT" &&
  ! gunzip -c "$(ls -1t "$W/n8nbk"/aiweb-*.sql.gz | head -1)" | grep -qxF '\connect n8n' &&
  ok "an AI web with no database n8n yet: ai alone, and it says so" || bad "no-n8n dump: rc=$RC, $OUT"

run_n8n drill "$N8N_DUMP" FAKE_N8N=1
proof="$(grep -E '^run .*--entrypoint node' "$W/log")"
[ "$RC" = 0 ] && grep -q 'database n8n: 3 tables as live, and n8n opens its credential aiwebtoken000001' <<<"$OUT" &&
  ok "the drill restores database n8n and n8n opens its credential in the restore" || bad "n8n drill: rc=$RC, $OUT"
for want in '--network hydromart-ai-restore-drill-net ' '--memory 1g --cpus 0.5 ' '--cap-drop ALL ' '--security-opt no-new-privileges ' \
  '--tmpfs /home/node/.n8n:uid=1000,gid=1000,mode=0700' '-e DB_POSTGRESDB_HOST=hydromart-ai-restore-drill ' ' fake-n8n -e '; do
  grep -qF -- "$want" <<<"$proof" || bad "the n8n proof run lacks '$want': $proof"
done
grep -qF -- '-e N8N_ENCRYPTION_KEY -e' <<<"$proof" && ! grep -qF drill-key-0123456789 "$W/log" &&
  [ "$(cat "$W/proof-env")" = 'drill-key-0123456789|aiwebtoken000001' ] &&
  ok "  ...on the scratch network alone, capped, no capability, the key handed by name, never on a command line" ||
  bad "the key reached a command line, or not the proof: $(cat "$W/proof-env") / $proof"
run_n8n drill "$N8N_DUMP" FAKE_N8N=1 FAKE_PROOF=fail
[ "$RC" = 1 ] && grep -q 'could not open credential aiwebtoken000001 in the restore with the key .env holds' "$W/alerts" &&
  grep -q 'Credentials could not be decrypted' "$W/alerts" &&
  ok "a credential the key does not open fails the drill, with n8n's reason" || bad "proof failure: rc=$RC, $(cat "$W/alerts")"
run_n8n drill "$N8N_DUMP" FAKE_N8N=1 AIWEB_N8N_ENCRYPTION_KEY=
[ "$RC" = 1 ] && grep -q 'no AIWEB_N8N_ENCRYPTION_KEY in .env' "$W/alerts" && ! grep -q -- '--entrypoint node' "$W/log" &&
  ok "no key to open n8n's credentials with: the drill fails, n8n never started" || bad "no key: rc=$RC, $OUT"
run_n8n drill "$(ls -1t "$W/n8nbk"/aiweb-*.sql.gz | head -1)" FAKE_N8N=1
[ "$RC" = 1 ] && grep -q 'holds no database n8n and the live AI web has one' "$W/alerts" &&
  ok "a dump without database n8n while one is live fails the drill" || bad "dump missing n8n: rc=$RC, $OUT"

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
docker network ls --format '{{.Name}}' | grep -qx "$DRILL-net" && bad "the scratch network was left behind" ||
  ok "  ...and its network"
grep -q 'no database n8n in it, nor live' <<<"$OUT" && ok "  ...and with no database n8n live, none is asked of the dump" ||
  bad "the drill did not say there is no n8n: $OUT"

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

# AI-5 with a real n8n, opt-in: AIWEB_TEST_N8N_IMAGE names hydromart-ai's n8n image (or n8nio/n8n),
# which CI does not pull. n8n itself seals one credential into a database n8n in the live
# container; the night's dump carries it; the drill's n8n opens it with the key, never prints it,
# and cannot open it with another key.
if [ -n "${AIWEB_TEST_N8N_IMAGE:-}" ]; then
  echo "backup-aiweb-db.sh --drill, database n8n with a real n8n ($AIWEB_TEST_N8N_IMAGE):"
  KEY="$(openssl rand -hex 32)"
  docker network create "$TESTNET" >/dev/null && docker network connect "$TESTNET" "$LIVE"
  docker exec "$LIVE" psql -qX -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "CREATE ROLE n8n LOGIN PASSWORD 'n8n'" -c 'CREATE DATABASE n8n OWNER n8n' >/dev/null
  printf '%s' '[{"id":"aiwebtoken000001","name":"t","type":"httpHeaderAuth","data":{"name":"Authorization","value":"Bearer hd9b-test-sealed-token"}}]' |
    docker run --rm -i --network "$TESTNET" -e DB_TYPE=postgresdb -e DB_POSTGRESDB_HOST="$LIVE" -e DB_POSTGRESDB_DATABASE=n8n \
      -e DB_POSTGRESDB_USER=n8n -e DB_POSTGRESDB_PASSWORD=n8n -e N8N_ENCRYPTION_KEY="$KEY" \
      --entrypoint sh "$AIWEB_TEST_N8N_IMAGE" -c 'cat > /tmp/c.json && n8n import:credentials --input=/tmp/c.json' >/dev/null 2>&1 ||
    bad "the real n8n could not seal the test credential"
  OUT="$("${drill_env[@]}" bash scripts/backup-aiweb-db.sh 2>&1)"
  N8N_DUMP="$(ls -1t "$W/drill"/aiweb-*.sql.gz 2>/dev/null | head -1)"
  grep -q 'databases ai n8n' <<<"$OUT" && ok "the real dump carries database n8n" || bad "real n8n dump: $OUT"
  OUT="$("${drill_env[@]}" AIWEB_N8N_IMAGE="$AIWEB_TEST_N8N_IMAGE" AIWEB_N8N_ENCRYPTION_KEY="$KEY" bash scripts/backup-aiweb-db.sh --drill "$N8N_DUMP" 2>&1)"
  RC=$?
  [ "$RC" = 0 ] && grep -q 'n8n opens its credential aiwebtoken000001' <<<"$OUT" && ! grep -q 'hd9b-test-sealed-token' <<<"$OUT" &&
    ok "the real n8n opens the restored credential with the key, and prints none of it" || bad "real n8n proof: rc=$RC, $OUT"
  OUT="$("${drill_env[@]}" AIWEB_N8N_IMAGE="$AIWEB_TEST_N8N_IMAGE" AIWEB_N8N_ENCRYPTION_KEY="$(openssl rand -hex 32)" bash scripts/backup-aiweb-db.sh --drill "$N8N_DUMP" 2>&1)"
  RC=$?
  [ "$RC" = 1 ] && grep -q 'could not open credential aiwebtoken000001' <<<"$OUT" &&
    ok "  ...and not with another key: the drill fails, with n8n's reason" || bad "real n8n, wrong key: rc=$RC, $OUT"
  docker ps -a --format '{{.Names}}' | grep -q "^$DRILL" && bad "a scratch container was left behind" || ok "  ...and leaves no scratch container"
else
  echo "  skip the real n8n proof: set AIWEB_TEST_N8N_IMAGE to an n8n image to run it (CI pulls none)"
fi

if [ "$fails" -gt 0 ]; then
  echo "backup-aiweb-db: $fails check(s) failed" >&2
  exit 1
fi
echo "backup-aiweb-db: all checks passed"
