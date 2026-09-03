-- Undo of 20260903200000_cashbook_reversal.
--
-- Dropping the columns does NOT delete any reversing entries: those are ordinary cashbook
-- rows with the opposite direction, and they keep cancelling what they cancelled. What is
-- lost is the LINK — which entry a reversal belongs to, and why — so the book still adds up
-- and reads as two unexplained postings instead of one explained correction.
--
-- That is the right trade for a rollback: the money stays correct, the annotation does not.
DROP INDEX IF EXISTS "cashbook_entries_reversesId_key";
ALTER TABLE "cashbook_entries" DROP COLUMN IF EXISTS "reversalReason";
ALTER TABLE "cashbook_entries" DROP COLUMN IF EXISTS "reversesId";
