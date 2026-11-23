#!/usr/bin/env bash
# HD-9b: back up the AI web's database the way backup-db.sh backs up hydromart's cluster, and
# prove a dump of it restores.
#
#   bash scripts/backup-aiweb-db.sh            # nightly: dump `ai`, keep the newest BACKUP_KEEP (14)
#   bash scripts/backup-aiweb-db.sh --drill    # weekly: restore the newest dump into a SCRATCH
#                                              # container and compare it with the live database
#
# The database is `ai` in the `db` container of the project infra/aiweb/docker-compose.yml names.
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
# The drill restores into a throwaway container with no network, from the image the live database
# runs, and never touches the live database: it only reads it to compare.
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
# The drill restores into the image the live database runs, by its id: the live server's exact
# version, already on the box, so it is never pulled (only deploy pulls). AIWEB_PG_IMAGE overrides.
PG_IMAGE="${AIWEB_PG_IMAGE:-}"

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
  if [ "$MODE" = drill ]; then docker rm -fv "$SCRATCH" >/dev/null 2>&1 || true; fi
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

dump() {
  local stamp file size
  live_db backup
  stamp="$(date +%Y%m%d-%H%M%S)"
  file="$BACKUP_DIR/aiweb-$stamp.sql.gz"
  # Written under a name no glob matches, renamed once it is whole: a dump cut short must never
  # wear the real name, or the offsite job would copy it as the newest one.
  PART="$BACKUP_DIR/.aiweb-$stamp.sql.gz.part"
  # As the superuser over the container's local socket. Owners, privileges and the row level
  # security policies come with it, because a restore must bring back exactly those.
  if ! docker exec "$CID" pg_dump -U postgres -d ai | gzip >"$PART"; then
    die "pg_dump of database ai failed"
  fi
  size="$(wc -c <"$PART" | tr -d ' ')"
  [ "$size" -ge 1000 ] && gzip -t "$PART" 2>/dev/null || die "the dump is ${size}B or not valid gzip: not a backup"
  mv -f "$PART" "$file"
  PART=''
  ls -1t "$BACKUP_DIR"/aiweb-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
  say "backup OK: $file ($(du -h "$file" | cut -f1)); the newest $KEEP AI web dumps are kept"
}

drill() {
  local dump_file table lt st migrations lm sm grants lg sg rls big rows start restore_s i
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

  [ -n "$PG_IMAGE" ] || PG_IMAGE="$(docker inspect --format '{{.Image}}' "$CID" 2>/dev/null || true)"
  [ -n "$PG_IMAGE" ] || die "could not read which image the live AI web database runs"
  docker rm -fv "$SCRATCH" >/dev/null 2>&1 || true
  # No network: a copy of production data nothing can reach. Its own superuser password.
  docker run -d --name "$SCRATCH" --network none -e POSTGRES_PASSWORD=drill "$PG_IMAGE" >/dev/null ||
    die "could not start the scratch database from $PG_IMAGE"
  # Over TCP, not the socket: the image's temporary first-start server listens on the socket only
  # and must not take the restore (restore-db.sh says why).
  for i in $(seq 1 60); do
    docker exec "$SCRATCH" psql -tAX -h 127.0.0.1 -U postgres -d postgres -c 'SELECT 1' >/dev/null 2>&1 && break
    [ "$i" = 60 ] && die "the scratch database never became ready"
    sleep 1
  done
  # The roles the dump names as owners and grantees, with no login: in the drill nobody connects.
  docker exec "$SCRATCH" psql -qX -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c 'CREATE ROLE ai_owner NOLOGIN' -c 'CREATE ROLE ai_app NOLOGIN' \
    -c 'CREATE DATABASE ai OWNER ai_owner' >/dev/null || die "could not prepare the scratch database"
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
  # Rows: the largest live table must have them in the restore too. A database nobody has written
  # to yet is said, never counted as data that survived.
  big="$(live "SELECT relname FROM pg_stat_user_tables WHERE schemaname = 'public' AND relname <> '_prisma_migrations' AND n_live_tup > 0 ORDER BY n_live_tup DESC LIMIT 1")"
  if [ -z "$big" ]; then
    say "drill OK: $dump_file restores ($lt tables, $lm migrations, ai_app privileges and row level security as live) in ${restore_s}s; no rows live yet, so no data was compared"
    return 0
  fi
  rows="$(scratch "SELECT count(*) FROM \"$big\"")"
  [ "${rows:-0}" -ge 1 ] || die "$big is EMPTY in the restore and has rows live: the schema came back, the data did not"
  say "drill OK: $dump_file restores ($lt tables, $lm migrations, $big has $rows rows, ai_app privileges and row level security as live) in ${restore_s}s"
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
