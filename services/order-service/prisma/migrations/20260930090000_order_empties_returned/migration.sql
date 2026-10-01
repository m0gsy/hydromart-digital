-- #27: the empty galon a counter buyer handed over AT this sale.
--
-- Nullable and additive, same shape as the cashier columns beside it: every delivery order
-- and every counter sale written before this column stays NULL — "not asked" — rather than
-- being read as a buyer who brought zero empties.
--
-- Does not touch depot-service's gallon-issue ledger: a refill still nets to zero only
-- through the existing issue/return flow when the empty is later handed back. This column
-- is for the daily report's refill-vs-beli split, nothing else reads it.
ALTER TABLE "orders" ADD COLUMN "emptiesReturned" INTEGER;
