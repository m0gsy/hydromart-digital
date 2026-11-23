#!/usr/bin/env bash
# HD-9b: back up the AI web's database the way backup-db.sh backs up hydromart's cluster, and
# prove a dump of it restores.
#
#   bash scripts/backup-aiweb-db.sh            # nightly: dump `ai` and `n8n`, keep the newest
#                                              # BACKUP_KEEP (14)
#   bash scripts/backup-aiweb-db.sh --drill    # weekly: restore the newest dump into a SCRATCH
#                                              # container and compare it with the live database
#
# The databases are `ai` and, since AI-5, `n8n` (n8n's workflows and its encrypted credentials), in
# the `db` container of the project infra/aiweb/docker-compose.yml names. One file holds both: ai's
# dump, then a `\connect n8n` line, then n8n's, so every job that handles these dumps (offsite,
# second provider, freshness) carries n8n with ai, unchanged. n8n's credentials open only with
# AIWEB_N8N_ENCRYPTION_KEY, which is in .env and its own backup, never in this file; the drill
# proves the two still fit. An AI web that has no database n8n yet is dumped without it, and says so.
# Its dump goes through hydromart's pipeline: gzip, in the directory hydromart's dumps are in
# (scripts/lib/backup-dir.sh), named aiweb-<stamp>.sql.gz so nothing that looks for
# hydromart-*.sql.gz can pick it up; off the box by `backup-offsite.sh --aiweb` and to the second
# provider by backup-second-provider.sh, kept BACKUP_KEEP there too; watched by
# check-backup-freshness.sh. Like hydromart's, the dump is not encrypted on this box (D8).
#
# A job of its own, scheduled beside hydromart's by install-host-cron.sh, so the two cannot touch
# each other: an AI web that is missing, unhealthy or failing is reported (log, alert) and can
# neither fail hydromart's backup nor stand in for it. It never writes admin-service's backup
# card, which shows hydromart's last verdict; a green AI run there would hide a red hydromart one.
#
# The drill restores into a throwaway container on a throwaway internal network (nothing else on
# it, no way off it), from the image the live database runs, and never touches the live database:
# it only reads it to compare. To prove n8n's part, the image the live n8n runs is started on that
# network alone, against the restore, with the key .env holds, and must open one credential.
#
# Exit: 0 dumped / restore proved · 1 failed (alerted) · 2 the AI web's database is not on this
# box (said once a week).
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/deploy-common.sh
. scripts/lib/deploy-common.sh
# shellcheck source=scripts/lib/backup-dir.sh
. scripts/lib/backup-dir.sh

KEEP="${BACKUP_KEEP:-14}"
SCRATCH="${AIWEB_DRILL_CONTAINER:-hydromart-ai-restore-drill}"
# The scratch network and the scratch n8n, named after the scratch database.
SCRATCH_NET="$SCRATCH-net"
SCRATCH_N8N="$SCRATCH-n8n"
# The drill restores into the image the live database runs, by its id: the live server's exact
# version, already on the box, so it is never pulled (only deploy pulls). AIWEB_PG_IMAGE overrides.
PG_IMAGE="${AIWEB_PG_IMAGE:-}"
# n8n's proof runs the image the live n8n runs, the same way; AIWEB_N8N_IMAGE overrides.
N8N_IMAGE="${AIWEB_N8N_IMAGE:-}"
# The one credential the proof opens: the AI web's token (hydromart-ai n8n/credentials.json).
N8N_PROOF_CREDENTIAL=aiwebtoken000001

# hydromart's directory, so the offsite copy and the freshness check find both families in one
# place; the same fallback backup-db.sh takes when it cannot write there.
BACKUP_DIR="${BACKUP_DIR:-$(hydromart_backup_dir)}"
if ! { mkdir -p "$BACKUP_DIR" 2>/dev/null && [ -w "$BACKUP_DIR" ]; }; then
  BACKUP_DIR="$HOME/backups"
  mkdir -p "$BACKUP_DIR"
fi

say() { echo "[aiweb-backup] $*"; }
STEP='AI web database backup'
REASON=''
ABSENT=''
PART=''
MODE=''
die() {
  REASON="$1"
  say "!! $1"
  exit 1
}
# Every failure alerts once, naming the step and why; the partial dump and the scratch container
# go. Not when the database is simply not here: that is said once a week (alert_once), not nightly.
on_exit() {
  local rc=$?
  [ -n "$PART" ] && rm -f "$PART"
  # Never fatal: under set -e a failed rm here would end the trap before the alert below.
  if [ "$MODE" = drill ]; then
    docker rm -fv "$SCRATCH_N8N" "$SCRATCH" >/dev/null 2>&1 || true
    docker network rm "$SCRATCH_NET" >/dev/null 2>&1 || true
  fi
  if [ "$rc" != 0 ] && [ -z "$ABSENT" ]; then
    alert "$STEP FAILED: $(printf '%s' "${REASON:-exit $rc after the last [aiweb-backup] line}" | tr -d '"\\' | tr '\n' ' ' | cut -c1-300). hydromart's own backups are a separate job"
  fi
  exit "$rc"
}
trap on_exit EXIT

# Sets CID to the healthy live AI web database container, or ends the run.
CID=''
live_db() {
  local health
  CID="$(aiweb_db_container)"
  if [ -z "$CID" ]; then
    ABSENT=1
    say "!! the AI web's database is not on this box: no $1 ran"
    alert_once aiweb-backup "AI web database is not on this box: no AI web backup or drill runs. If it was removed on purpose, take infra/aiweb out of the repo too"
    exit 2
  fi
  alert_clear aiweb-backup
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CID" 2>/dev/null || echo unreadable)"
  # A healthcheck says healthy (the compose file gives db one); a container without one is judged on
  # running, as hydromart's deploy gate judges its own.
  case "$health" in healthy | running) ;; *) die "the AI web's database is $health, so no $1 ran" ;; esac
}

# The line that moves psql from ai's part of a dump to n8n's. pg_dump never writes one itself (it
# does only with --create, which is not used here), so it also tells a dump that carries n8n.
N8N_MARK='\connect n8n'

# 1 when the live cluster has database n8n (AI-5 created it), else nothing.
live_n8n() {
  docker exec "$CID" psql -tAX -U postgres -d postgres -c "SELECT 1 FROM pg_database WHERE datname = 'n8n'" 2>/dev/null |
    tr -d '[:space:]' || true
}

dump() {
  local stamp file size used dbs=ai
  live_db backup
  # hydromart's database and every dump of it share this disk, and a full one takes the database
  # down. The AI web's dump is the one that waits: none at 95% used, the line deploy.sh refuses at.
  used="$(df -Pk "$BACKUP_DIR" 2>/dev/null | awk 'NR == 2 {gsub(/%/, "", $5); print $5}' || true)"
  case "$used" in '' | *[!0-9]*) used=0 ;; esac
  [ "$used" -lt 95 ] || die "the disk holding $BACKUP_DIR is ${used}% full: no AI web dump tonight, hydromart's needs the room"
  stamp="$(date +%Y%m%d-%H%M%S)"
  file="$BACKUP_DIR/aiweb-$stamp.sql.gz"
  # Written under a name no glob matches, renamed once it is whole: a dump cut short must never
  # wear the real name, or the offsite job would copy it as the newest one.
  PART="$BACKUP_DIR/.aiweb-$stamp.sql.gz.part"
  [ "$(live_n8n)" = 1 ] && dbs='ai n8n'
  # As the superuser over the container's local socket. Owners, privileges and the row level
  # security policies come with it, because a restore must bring back exactly those. n8n's after
  # ai's, behind N8N_MARK; `&&` all the way, so either pg_dump failing fails the whole file.
  if ! {
    docker exec "$CID" pg_dump -U postgres -d ai &&
      if [ "$dbs" != ai ]; then printf '%s\n' "$N8N_MARK" && docker exec "$CID" pg_dump -U postgres -d n8n; fi
  } | gzip >"$PART"; then
    die "pg_dump of database ${dbs// / or } failed"
  fi
  size="$(wc -c <"$PART" | tr -d ' ')"
  [ "$size" -ge 1000 ] && gzip -t "$PART" 2>/dev/null || die "the dump is ${size}B or not valid gzip: not a backup"
  mv -f "$PART" "$file"
  PART=''
  ls -1t "$BACKUP_DIR"/aiweb-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
  if [ "$dbs" = ai ]; then dbs='ai (no database n8n on this box yet)'; fi
  say "backup OK: $file ($(du -h "$file" | cut -f1)), databases $dbs; the newest $KEEP AI web dumps are kept"
}

# AI-5: n8n's part of a restore, against the live database n8n: its tables, and one credential that
# OPENS. Run by n8n itself (the image the live n8n runs), on the scratch network alone, with the key
# .env holds: a backup whose credentials no key we have can open restores nothing n8n can use.
# Sets N8N_SAID for the drill's last line.
N8N_SAID=''
drill_n8n() {
  local lnt snt key project cid pinned proof
  lnt="$(docker exec "$CID" psql -tAX -U postgres -d n8n -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" 2>/dev/null | tr -d '[:space:]' || true)"
  snt="$(docker exec "$SCRATCH" psql -tAX -U postgres -d n8n -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" 2>/dev/null | tr -d '[:space:]' || true)"
  [ -n "$lnt" ] && [ "$snt" = "$lnt" ] || die "${snt:-0} tables of database n8n restored, live has ${lnt:-unreadable}"

  key="${AIWEB_N8N_ENCRYPTION_KEY:-}"
  if [ -z "$key" ] && [ -f .env ]; then
    key="$(tr -d '\r' <.env | sed -n 's/^AIWEB_N8N_ENCRYPTION_KEY=//p' | tail -1 | sed -e "s/^[\"']//" -e "s/[\"']$//")"
  fi
  [ -n "$key" ] || die "no AIWEB_N8N_ENCRYPTION_KEY in .env: nothing can open n8n's credentials, restored or live"

  # The image the live n8n runs, by its id (a stopped container counts: n8n switched off left it),
  # else the one the compose file pins, when the box has it. Never pulled.
  if [ -z "$N8N_IMAGE" ]; then
    project="$(sed -n 's/^name:[[:space:]]*//p' infra/aiweb/docker-compose.yml 2>/dev/null | tr -d "\"' \r")"
    cid="$(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=n8n 2>/dev/null | head -1 || true)"
    [ -z "$cid" ] || N8N_IMAGE="$(docker inspect --format '{{.Image}}' "$cid" 2>/dev/null || true)"
  fi
  if [ -z "$N8N_IMAGE" ]; then
    pinned="$(sed -n '/^  n8n:/,/^  [a-z]/s/^ *image: *//p' infra/aiweb/docker-compose.yml 2>/dev/null | head -1)"
    if [ -n "$pinned" ] && docker image inspect "$pinned" >/dev/null 2>&1; then N8N_IMAGE="$pinned"; fi
  fi
  [ -n "$N8N_IMAGE" ] || die "no n8n image on this box to open the restored credentials with (no n8n container, and the pinned one is not here)"

  # The key reaches the container by name (-e N8N_ENCRYPTION_KEY), from this one command's
  # environment, never from a command line. The credential goes to a file in the container's
  # memory (its ~/.n8n tmpfs) and is only parsed there: its value is never printed. Capped like
  # the scratch database, and stopped after 5 minutes (the exit trap removes what is left).
  if ! proof="$(N8N_ENCRYPTION_KEY="$key" N8N_PROOF_ID="$N8N_PROOF_CREDENTIAL" timeout --kill-after=10 300 \
    docker run --rm --name "$SCRATCH_N8N" --network "$SCRATCH_NET" --memory 1g --cpus 0.5 \
    --cap-drop ALL --security-opt no-new-privileges --tmpfs /home/node/.n8n:uid=1000,gid=1000,mode=0700,size=64m \
    -e DB_TYPE=postgresdb -e DB_POSTGRESDB_HOST="$SCRATCH" -e DB_POSTGRESDB_PORT=5432 -e DB_POSTGRESDB_DATABASE=n8n \
    -e DB_POSTGRESDB_USER=n8n -e DB_POSTGRESDB_PASSWORD=drill -e N8N_ENCRYPTION_KEY -e N8N_PROOF_ID \
    --entrypoint node "$N8N_IMAGE" -e '
      const { execFileSync } = require("node:child_process");
      const id = process.env.N8N_PROOF_ID;
      // In ~/.n8n, the tmpfs: the opened credential is only ever in memory.
      const file = require("node:os").homedir() + "/.n8n/proof.json";
      try {
        execFileSync("n8n", ["export:credentials", "--id=" + id, "--decrypted", "--output=" + file], { stdio: "pipe" });
      } catch (error) {
        const lines = String(error.stdout || "") + String(error.stderr || "");
        const last = lines.split("\n").map((l) => l.trim()).filter(Boolean).pop() || "exit " + error.status;
        console.log("n8n export:credentials failed: " + last.slice(0, 200));
        process.exit(1);
      }
      let credential;
      try {
        const list = JSON.parse(require("node:fs").readFileSync(file, "utf8"));
        credential = Array.isArray(list) ? list[0] : list;
      } catch {
        console.log("what n8n exported is not JSON");
        process.exit(1);
      }
      const data = credential && credential.data;
      const opened = data && typeof data === "object" && Object.values(data).some((v) => typeof v === "string" && v.length > 0);
      if (!credential || credential.id !== id || !opened) {
        console.log("credential " + id + " came back without its data");
        process.exit(1);
      }
      console.log("opened");
    ' 2>&1)"; then
    die "n8n ($N8N_IMAGE) could not open credential $N8N_PROOF_CREDENTIAL in the restore with the key .env holds: $(printf '%s' "$proof" | tail -1 | cut -c1-200)"
  fi
  N8N_SAID="; database n8n: $snt tables as live, and n8n opens its credential $N8N_PROOF_CREDENTIAL with the key .env holds"
}

drill() {
  local dump_file table lt st migrations lm sm grants lg sg rls big rows start restore_s i n8n_dumped=0
  live_db 'restore drill'
  dump_file="${1:-}"
  if [ -z "$dump_file" ]; then
    dump_file="$(ls -1t "$BACKUP_DIR"/aiweb-*.sql.gz 2>/dev/null | head -1 || true)"
    [ -n "$dump_file" ] || die "no aiweb-*.sql.gz in $BACKUP_DIR to drill"
    # Drilling last month's dump proves last month: the newest one must be recent.
    if [ -n "$(find "$dump_file" -mmin +$((${DRILL_MAX_AGE_HOURS:-26} * 60)) 2>/dev/null)" ]; then
      die "the newest AI web dump $dump_file is older than ${DRILL_MAX_AGE_HOURS:-26}h: the nightly job has stopped"
    fi
  fi
  gzip -t "$dump_file" 2>/dev/null || die "$dump_file is not valid gzip"
  # grep -c reads to the end, so gunzip is never cut off (pipefail would count that as a failure).
  if gunzip -c "$dump_file" | grep -cxF "$N8N_MARK" >/dev/null; then n8n_dumped=1; fi
  if [ "$n8n_dumped" = 0 ] && [ "$(live_n8n)" = 1 ]; then
    die "$dump_file holds no database n8n and the live AI web has one: n8n's workflows and credentials are not in this backup"
  fi

  [ -n "$PG_IMAGE" ] || PG_IMAGE="$(docker inspect --format '{{.Image}}' "$CID" 2>/dev/null || true)"
  [ -n "$PG_IMAGE" ] || die "could not read which image the live AI web database runs"
  docker rm -fv "$SCRATCH_N8N" "$SCRATCH" >/dev/null 2>&1 || true
  docker network rm "$SCRATCH_NET" >/dev/null 2>&1 || true
  # A network of its own, internal: a copy of production data nothing can reach, and nothing on it
  # can reach out. Only the scratch database and, for its proof, the scratch n8n ever join it.
  docker network create --internal "$SCRATCH_NET" >/dev/null || die "could not create the scratch network $SCRATCH_NET"
  # Its own superuser password. Capped, so a restore on a Monday morning cannot take memory or CPU
  # from the live stack beside it.
  docker run -d --name "$SCRATCH" --network "$SCRATCH_NET" --memory 512m --cpus 0.5 -e POSTGRES_PASSWORD=drill "$PG_IMAGE" >/dev/null ||
    die "could not start the scratch database from $PG_IMAGE"
  # Over TCP, not the socket: the image's temporary first-start server listens on the socket only
  # and must not take the restore (restore-db.sh says why).
  for i in $(seq 1 60); do
    docker exec "$SCRATCH" psql -tAX -h 127.0.0.1 -U postgres -d postgres -c 'SELECT 1' >/dev/null 2>&1 && break
    [ "$i" = 60 ] && die "the scratch database never became ready"
    sleep 1
  done
  # The roles the dump names as owners and grantees. No login, but n8n's: the scratch n8n signs in
  # as it for the proof, with a password only this drill knows, on a network only this drill has.
  docker exec "$SCRATCH" psql -qX -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c 'CREATE ROLE ai_owner NOLOGIN' -c 'CREATE ROLE ai_app NOLOGIN' -c "CREATE ROLE n8n LOGIN PASSWORD 'drill'" \
    -c 'CREATE DATABASE ai OWNER ai_owner' -c 'CREATE DATABASE n8n OWNER n8n' >/dev/null ||
    die "could not prepare the scratch database"
  say "drill: restoring $dump_file into $SCRATCH ($PG_IMAGE)"
  start=$SECONDS
  # ON_ERROR_STOP: a statement that did not run is a restore that did not happen.
  if ! gunzip -c "$dump_file" | docker exec -i "$SCRATCH" psql -qX -v ON_ERROR_STOP=1 -U postgres -d ai >/dev/null; then
    die "$dump_file did not restore: a statement in it failed"
  fi
  restore_s=$((SECONDS - start))

  # Compared with the LIVE database, newer than any dump: the structure must match, the data must
  # be there, and so must what keeps it safe (row level security, ai_app's privileges).
  live() { docker exec "$CID" psql -tAX -U postgres -d ai -c "$1" 2>/dev/null | tr -d '[:space:]' || true; }
  scratch() { docker exec "$SCRATCH" psql -tAX -U postgres -d ai -c "$1" 2>/dev/null | tr -d '[:space:]' || true; }
  table="SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"
  lt="$(live "$table")"
  st="$(scratch "$table")"
  [ -n "$lt" ] && [ "$st" = "$lt" ] || die "${st:-0} tables restored, live has ${lt:-unreadable}"
  migrations='SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL'
  lm="$(live "$migrations")"
  sm="$(scratch "$migrations")"
  [ "$sm" = "$lm" ] || die "${sm:-0} applied migrations restored, live has ${lm:-0}"
  grants="SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'ai_app'"
  lg="$(live "$grants")"
  sg="$(scratch "$grants")"
  [ "$sg" = "$lg" ] || die "ai_app holds ${sg:-0} table privileges in the restore and ${lg:-0} live"
  rls="SELECT count(*) FROM pg_class WHERE relname = 'answer_trail' AND relrowsecurity AND relforcerowsecurity"
  [ "$(scratch "$rls")" = "$(live "$rls")" ] || die "row level security on answer_trail did not survive the restore"
  if [ "$n8n_dumped" = 1 ]; then drill_n8n; else N8N_SAID='; no database n8n in it, nor live'; fi
  # Rows: the largest live table must have them in the restore too. A database nobody has written
  # to yet is said, never counted as data that survived.
  big="$(live "SELECT relname FROM pg_stat_user_tables WHERE schemaname = 'public' AND relname <> '_prisma_migrations' AND n_live_tup > 0 ORDER BY n_live_tup DESC LIMIT 1")"
  if [ -z "$big" ]; then
    say "drill OK: $dump_file restores ($lt tables, $lm migrations, ai_app privileges and row level security as live) in ${restore_s}s; no rows live yet, so no data was compared$N8N_SAID"
    return 0
  fi
  rows="$(scratch "SELECT count(*) FROM \"$big\"")"
  [ "${rows:-0}" -ge 1 ] || die "$big is EMPTY in the restore and has rows live: the schema came back, the data did not"
  say "drill OK: $dump_file restores ($lt tables, $lm migrations, $big has $rows rows, ai_app privileges and row level security as live) in ${restore_s}s$N8N_SAID"
}

case "${1:-}" in
  '')
    MODE=dump
    dump
    ;;
  --drill)
    MODE=drill
    STEP='AI web restore drill'
    drill "${2:-}"
    ;;
  *)
    echo "usage: bash scripts/backup-aiweb-db.sh [--drill [aiweb-dump.sql.gz]]" >&2
    exit 2
    ;;
esac
