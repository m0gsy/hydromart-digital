-- Rollback for 20261017110000_order_tax.
-- Drops the recorded PPN portion; the order totals are unchanged (it was carved out of them), so
-- nothing else needs undoing. The recorded amounts are lost and cannot be recomputed for past rates.
ALTER TABLE "orders" DROP COLUMN "taxAmount";
ALTER TABLE "orders" DROP COLUMN "taxPercent";
