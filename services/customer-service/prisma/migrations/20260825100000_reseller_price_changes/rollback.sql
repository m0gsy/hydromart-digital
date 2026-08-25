-- Reverses 20260825100000_reseller_price_changes.
--
-- Drops the table and with it every recorded change AND every change scheduled but not
-- yet applied. The second half is the one that matters: a rollback past this point does
-- not just lose history, it cancels pending price changes that staff believe are coming.
-- Read the pending rows out first if anything is scheduled.
DROP TABLE IF EXISTS "reseller_price_changes";
