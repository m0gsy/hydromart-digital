-- Rollback for 20260928100000_order_cashier_attribution.
--
-- Drops the two columns. The only thing lost is WHO rang up each counter sale since the
-- migration ran; the sales, their totals and the cashier shifts are untouched.
ALTER TABLE "orders" DROP COLUMN "cashierLabel";
ALTER TABLE "orders" DROP COLUMN "cashierId";
