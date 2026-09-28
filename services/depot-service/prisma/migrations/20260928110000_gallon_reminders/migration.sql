-- When a depot last asked a customer to bring its gallons back.
--
-- The reminder sweep runs every morning. Without a record of the last ask it would send an
-- overdue customer the same message every morning until they returned the gallons. One row per
-- (depot, customer), overwritten on each reminder: it answers "when did we last ask?", so it
-- never grows past the number of customers who have ever been late.
--
-- Additive and self-contained: a new table nothing else references. Cascades with the depot,
-- like the other per-depot config tables.
CREATE TABLE "gallon_reminders" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "remindedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gallon_reminders_pkey" PRIMARY KEY ("id")
);

-- IF NOT EXISTS, and registered in scripts/create-indexes.sh like every index since H-39. The
-- table is new so the concurrent build is skipped ("its table does not exist yet") and this
-- statement builds the index on an empty table, where locking costs nothing — the same path
-- stock_transfers took.
CREATE UNIQUE INDEX IF NOT EXISTS "gallon_reminders_depotId_customerId_key" ON "gallon_reminders"("depotId", "customerId");

ALTER TABLE "gallon_reminders" ADD CONSTRAINT "gallon_reminders_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
