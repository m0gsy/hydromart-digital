#!/usr/bin/env bash
# Proof that check-sweep-observer.mjs can go red.
#
#   bash scripts/check-sweep-observer.test.sh
#
# The gate exists because seventeen scheduled sweeps ran with nowhere to report and nobody
# reading. The shapes below are the ways that state comes back:
#
#   1. the table declared in only ONE of its two places (migration / Prisma model)
#   2. the two places disagreeing about the columns
#   3. a scheduled sweep the observer does not list  -> it runs unwatched
#   4. an observer job nothing schedules             -> permanently "overdue", ignored
#   5. an empty crontab passing vacuously
#
# Every case runs against a throwaway fixture tree. A test that edits the repo's real
# migration to prove a point is a test that leaves the repo broken when interrupted.
set -uo pipefail
# CI invokes shell checks as `bash -e file`, and most cases here run a command that is
# SUPPOSED to exit 1. Under -e the first one kills the run.
set +e
cd "$(dirname "$0")/.."

fails=0
ok() { echo "  ok   $1"; }
bad() {
  echo "  FAIL $1"
  fails=$((fails + 1))
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

MIGDIR="$WORK/services/admin-service/prisma/migrations/20260902090000_sweep_run"
mkdir -p "$WORK/scripts/scheduler" "$MIGDIR" "$WORK/services/admin-service/src/domain"
cp scripts/check-sweep-observer.mjs "$WORK/scripts/"

GOOD_CRON='0 * * * * sh /scripts/sweep.sh alpha/one
5 * * * * sh /scripts/sweep.sh beta/two other:3009'

write_sql() {
  cat > "$MIGDIR/migration.sql" <<SQL
-- fixture
CREATE TABLE IF NOT EXISTS "sweep_runs" (
$1
    CONSTRAINT "sweep_runs_pkey" PRIMARY KEY ("job")
);
SQL
}

write_model() {
  cat > "$WORK/services/admin-service/prisma/schema.prisma" <<PRISMA
generator client {
  provider = "prisma-client-js"
}

model SweepRun {
$1
  @@map("sweep_runs")
}
PRISMA
}

GOOD_SQL='    "job" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
'
GOOD_MODEL='  /// a doc comment must not read as a column
  job  String  @id
  host String
  ok   Boolean
'

reset_good() {
  printf '%s\n' "$GOOD_CRON" > "$WORK/scripts/scheduler/crontab"
  write_sql "$GOOD_SQL"
  write_model "$GOOD_MODEL"
  rm -f "$WORK/services/admin-service/src/domain/sweep-schedule.ts"
}

run() { ( cd "$WORK" && node scripts/check-sweep-observer.mjs 2>&1 ); }

# --- case 0: the happy path, so a red below means something -----------------
reset_good
OUT="$(run)"; RC=$?
if [ "$RC" = "0" ]; then
  ok "a coherent schema with the reader not yet shipped passes"
else
  bad "the good fixture failed (rc=$RC): $OUT"
fi

# --- case 1: the model exists, the migration does not -----------------------
reset_good
cat > "$MIGDIR/migration.sql" <<'SQL'
-- fixture with no CREATE TABLE at all
SQL
OUT="$(run)"; RC=$?
if [ "$RC" = "1" ] && echo "$OUT" | grep -q "no CREATE TABLE"; then
  ok "a Prisma model with no migration behind it is caught"
else
  bad "a missing migration did not fail as expected (rc=$RC): $OUT"
fi

# --- case 2: the migration exists, the model does not -----------------------
reset_good
cat > "$WORK/services/admin-service/prisma/schema.prisma" <<'PRISMA'
generator client {
  provider = "prisma-client-js"
}
PRISMA
OUT="$(run)"; RC=$?
if [ "$RC" = "1" ] && echo "$OUT" | grep -q "no .model SweepRun"; then
  ok "a migrated table with no Prisma model is caught"
else
  bad "a missing model did not fail as expected (rc=$RC): $OUT"
fi

# --- case 3: the two halves disagree about the columns ----------------------
# This is the one CI cannot see on its own: its database is empty, so a service whose model
# names a column the migration never created boots green and throws on the first write.
reset_good
write_model "$GOOD_MODEL"'  detail String?
'
OUT="$(run)"; RC=$?
if [ "$RC" = "1" ] && echo "$OUT" | grep -qE "model only: +detail"; then
  ok "a column in the model but not the migration is caught"
else
  bad "column drift did not fail as expected (rc=$RC): $OUT"
fi

reset_good
write_sql "$GOOD_SQL"'    "extra" TEXT,
'
OUT="$(run)"; RC=$?
if [ "$RC" = "1" ] && echo "$OUT" | grep -qE "SQL only: +extra"; then
  ok "a column in the migration but not the model is caught"
else
  bad "reverse column drift did not fail as expected (rc=$RC): $OUT"
fi

# --- case 4: coverage, once the reading half exists -------------------------
reset_good
cat > "$WORK/services/admin-service/src/domain/sweep-schedule.ts" <<'TS'
export const SWEEP_SCHEDULE = [
  { job: 'alpha/one', everyMinutes: 60 },
  { job: 'beta/two', everyMinutes: 60 },
];
TS
OUT="$(run)"; RC=$?
if [ "$RC" = "0" ] && echo "$OUT" | grep -q "all 2 scheduled sweeps are watched"; then
  ok "an observer listing exactly the scheduled sweeps passes"
else
  bad "full coverage did not pass (rc=$RC): $OUT"
fi

# --- case 5: a scheduled sweep the observer does not list -------------------
reset_good
cat > "$WORK/services/admin-service/src/domain/sweep-schedule.ts" <<'TS'
export const SWEEP_SCHEDULE = [{ job: 'alpha/one', everyMinutes: 60 }];
TS
OUT="$(run)"; RC=$?
if [ "$RC" = "1" ] && echo "$OUT" | grep -q "absent from the observer"; then
  ok "a sweep that would run unwatched is caught"
else
  bad "an unwatched sweep did not fail as expected (rc=$RC): $OUT"
fi

# --- case 6: an observer job nothing schedules ------------------------------
reset_good
cat > "$WORK/services/admin-service/src/domain/sweep-schedule.ts" <<'TS'
export const SWEEP_SCHEDULE = [
  { job: 'alpha/one', everyMinutes: 60 },
  { job: 'beta/two', everyMinutes: 60 },
  { job: 'gamma/retired', everyMinutes: 60 },
];
TS
OUT="$(run)"; RC=$?
if [ "$RC" = "1" ] && echo "$OUT" | grep -q "no crontab line schedules"; then
  ok "an observer row nothing schedules is caught"
else
  bad "a retired job did not fail as expected (rc=$RC): $OUT"
fi

# --- case 7: an empty crontab must not read as "all good" -------------------
reset_good
printf '%s\n' '# nothing scheduled' > "$WORK/scripts/scheduler/crontab"
OUT="$(run)"; RC=$?
if [ "$RC" = "1" ] && echo "$OUT" | grep -q "vacuously"; then
  ok "a crontab with no sweeps fails rather than passing vacuously"
else
  bad "an empty crontab exited $RC — a check that passes on no input proves nothing"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "PASS — the sweep-observer gate fails on every shape it exists to catch."
  exit 0
fi
echo "FAIL — $fails assertion(s) above."
exit 1
