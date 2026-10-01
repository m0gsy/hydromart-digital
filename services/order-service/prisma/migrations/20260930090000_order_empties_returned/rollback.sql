-- Rollback for 20260930090000_order_empties_returned.
ALTER TABLE "orders" DROP COLUMN "emptiesReturned";
