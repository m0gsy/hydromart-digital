-- Rolls back 20261108130000_payroll_item_code.
-- Drops the marker. Lossy only for the year-to-date read: December falls back to label
-- matching for every slip, which is how it worked before the column existed.
ALTER TABLE "payroll_items" DROP COLUMN IF EXISTS "code";
