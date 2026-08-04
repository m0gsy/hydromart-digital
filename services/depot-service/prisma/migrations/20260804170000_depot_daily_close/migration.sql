-- One depot, one day, declared counted.
--
-- Its own table rather than a column on an existing one: nothing else about a depot or an
-- order changes when a day is closed, and a new table is the one shape that fails safely
-- if the image deploys before this migration runs (only the close route errors).
CREATE TABLE "depot_daily_closes" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    -- The business day being closed, not a timestamp: "4 August at this depot".
    "businessDate" DATE NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "closedBy" UUID NOT NULL,
    -- Snapshot of what was true at close. Kept even though it can be recomputed: the point
    -- of closing is to record the numbers somebody signed off, not the numbers as they
    -- would look after later edits.
    "cashInIdr" INTEGER NOT NULL,
    "cashOutIdr" INTEGER NOT NULL,
    "konterIdr" INTEGER NOT NULL,
    "codDepositedIdr" INTEGER NOT NULL,
    "codExpectedIdr" INTEGER NOT NULL,
    "note" TEXT,
    -- Set when HQ reopens the day; cleared when it is closed again. One level of history is
    -- deliberate — who reopened and when is the question anybody actually asks.
    "reopenedAt" TIMESTAMP(3),
    "reopenedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depot_daily_closes_pkey" PRIMARY KEY ("id")
);

-- A day is closed once. Re-closing after a reopen updates this row rather than adding one.
CREATE UNIQUE INDEX "depot_daily_closes_depotId_businessDate_key"
    ON "depot_daily_closes"("depotId", "businessDate");

ALTER TABLE "depot_daily_closes"
    ADD CONSTRAINT "depot_daily_closes_depotId_fkey"
    FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
