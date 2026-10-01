-- One depot, one month, sealed after every one of its days is already closed.
--
-- Its own table, next to depot_daily_closes, for the same reason that one is its own
-- table: nothing else about a depot or an order changes when a month is sealed, and a new
-- table fails safely if the image deploys before this migration runs (only the seal route
-- errors, the daily-close and report routes beside it keep working).
CREATE TABLE "depot_monthly_closes" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    -- The first day of the business month being sealed — '2026-09-01' for September, not a
    -- timestamp. Matches depot_daily_closes.businessDate in shape and in meaning.
    "businessMonth" DATE NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "closedBy" UUID NOT NULL,
    -- Snapshot: the sum of the month's already-closed daily snapshots, not a live
    -- recomputation — the point of sealing is to record what was signed off, not what the
    -- numbers would read after a later correction.
    "cashInIdr" INTEGER NOT NULL,
    "cashOutIdr" INTEGER NOT NULL,
    "konterIdr" INTEGER NOT NULL,
    "codDepositedIdr" INTEGER NOT NULL,
    "codExpectedIdr" INTEGER NOT NULL,
    -- How many days were closed when this was sealed — always every day up to the end of
    -- the month (or today, for the month in progress); kept so the figure is legible
    -- without recomputing it from depot_daily_closes.
    "daysClosed" INTEGER NOT NULL,
    "note" TEXT,
    -- Set when HQ reopens the month; cleared when it is sealed again.
    "reopenedAt" TIMESTAMP(3),
    "reopenedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depot_monthly_closes_pkey" PRIMARY KEY ("id")
);

-- IF NOT EXISTS, and registered in scripts/create-indexes.sh like every index since H-39.
-- The table is new so the concurrent build is skipped ("its table does not exist yet") and
-- this statement builds the index on an empty table, where locking costs nothing.
CREATE UNIQUE INDEX IF NOT EXISTS "depot_monthly_closes_depotId_businessMonth_key"
    ON "depot_monthly_closes"("depotId", "businessMonth");

ALTER TABLE "depot_monthly_closes"
    ADD CONSTRAINT "depot_monthly_closes_depotId_fkey"
    FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
