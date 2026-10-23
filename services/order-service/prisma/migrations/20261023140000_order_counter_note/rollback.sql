-- Rollback for 20261023140000_order_counter_note.
-- Drops the cashier's counter-sale notes: every note written since the column was added is lost
-- (nothing else reads them, so nothing else changes).
ALTER TABLE "orders" DROP COLUMN "counterNote";
