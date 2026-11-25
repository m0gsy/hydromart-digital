-- HD-16 part A: a gallons-sold goal beside the other monthly depot targets. 0 = not set (the
-- existing rows and every new row that leaves it out), so the AI read API says "belum ada target".
-- Unit = metric G-01 (gallon units sold on delivered/completed orders). A constant default makes this a metadata-only change.
ALTER TABLE "depot_targets" ADD COLUMN IF NOT EXISTS "gallonsTarget" INTEGER NOT NULL DEFAULT 0;
