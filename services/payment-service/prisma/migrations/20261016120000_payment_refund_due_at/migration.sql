-- RERUNNABLE: the refund promise due date (request time + 3 working days). Nullable: rows
-- from before this column, and refunds that settled directly, have none.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "refundDueAt" TIMESTAMP(3);
