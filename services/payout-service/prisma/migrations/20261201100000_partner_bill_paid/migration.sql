-- HD-25: a sent partner bill gets a due day and a paid mark.
-- New nullable columns on a small table (one row per entity per month): no index, no rewrite.
ALTER TABLE "partner_bills"
  ADD COLUMN "dueOn" DATE,
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "paidOn" DATE,
  ADD COLUMN "paidBy" UUID,
  ADD COLUMN "paidRef" TEXT;

-- A bill sent before this change falls due 14 days after the WIB day it was approved
-- (timestamps are stored as UTC wall time, WIB = UTC+7).
UPDATE "partner_bills"
   SET "dueOn" = (("approvedAt" + INTERVAL '7 hours')::date + 14)
 WHERE "status" = 'SENT' AND "approvedAt" IS NOT NULL;
