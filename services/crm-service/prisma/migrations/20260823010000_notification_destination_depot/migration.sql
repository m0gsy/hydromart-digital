-- O1a/O6a: two columns, one release ahead of the code that reads them.
--
-- `destination` is the in-app screen a notification opens. crm already computes it for
-- every push payload (`destinationFor`) and then throws it away, which is why a tap from
-- the phone's tray lands on the right screen while the same row in the in-app list is
-- dead text. This release starts WRITING it; the list becomes tappable one release later,
-- so it is never half-tappable.
--
-- `depotId` is the depot an operational notification belongs to. The ops feed has no depot
-- filter at all today, so an "order received" event added before this column exists would
-- show every depot the orders of every other depot. Nothing writes it yet — O6 does.
--
-- Both nullable, no backfill, no index: an index on a column this young would have to be
-- built CONCURRENTLY by scripts/create-indexes.sh, which cannot run before the column
-- exists on production. The index ships with the reader.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "destination" TEXT;
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "depotId" TEXT;
