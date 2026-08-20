-- Undoes C2's column and index. LOSSLESS in the only way that matters: the reader falls
-- back to the window rule for any payment with no shift id, which is what it did before
-- this column existed. Dropping the column therefore returns the exact previous behaviour,
-- and re-running the migration re-earns the dimension from that point forward — only the
-- attribution written between the two is lost, and it is recoverable from the shift
-- windows for as long as no two shifts at one depot overlapped.
--
-- Dropping the index locks writes on "payments" for the duration. On a live database use:
--   DROP INDEX CONCURRENTLY "payments_cashierShiftId_idx";
DROP INDEX IF EXISTS "payments_cashierShiftId_idx";
ALTER TABLE "payments" DROP COLUMN IF EXISTS "cashierShiftId";
