-- RERUNNABLE: the only statement is CREATE TABLE IF NOT EXISTS, so a retry after a deploy
-- that died mid-migrate is a no-op rather than a hand-resolved failure.
--
-- CA-5-01, half one of two: the table lands a release before any code reads it.
--
-- Seventeen crontab lines sweep the money and PDP paths (scripts/scheduler/crontab), and
-- not one of them has a screen. `sweep.sh` does record what happened — but into empty
-- marker files under /var/run/sweep inside the scheduler container, which is a place no
-- console reads and no operator opens. The container healthcheck reads exactly one of
-- them, `last-success`, and answers a single yes/no for all seventeen jobs at once. So a
-- sweep that has NEVER run once looks identical to one that ran a minute ago, as long as
-- some OTHER sweep succeeded recently.
--
-- Measured on the dev box while writing this: FailingStreak 1472, every sweep failing for
-- ~25 hours, and two jobs — subscriptions/process-due and webhooks/deliveries/process —
-- with no marker file of either kind, meaning they had not run at all. The only way to
-- learn any of that was `docker inspect`.
--
-- One row per job, upserted, keyed by the crontab path. Not a history log: the question a
-- human opens this for is "is this sweep alive", which needs the last run and nothing
-- else. Seventeen rows forever also means no purge job, no retention class, and no PDP
-- surface — this table holds no personal data by construction.
--
-- `lastRunAt` and `lastOkAt` are separate for the reason BackupStatus keeps its drill
-- columns separate: a job having RUN and a job having WORKED are different claims, and
-- collapsing them is how a sweep that fails every tick reads as healthy.
--
-- No index. The primary key is the only lookup, and the reader fetches all seventeen rows
-- in one unfiltered query. (An index here would also have to wait a further release —
-- create-indexes.sh runs BEFORE migrate on deploy, so an index cannot ship with its own
-- table. It does not need one.)

-- CreateTable
CREATE TABLE IF NOT EXISTS "sweep_runs" (
    "job" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "detail" TEXT,
    "lastOkAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sweep_runs_pkey" PRIMARY KEY ("job")
);
