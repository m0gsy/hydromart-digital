-- Note: this does NOT restore the previous 7-year window on orders_transactions. The
-- 10-year value is the safer of the two, so it is left in place deliberately; shortening
-- a financial retention window should be a conscious, separate decision.
DELETE FROM "retention_policies" WHERE "dataset" = 'hr_employee_records';
ALTER TABLE "retention_policies" DROP COLUMN "dataClass";
