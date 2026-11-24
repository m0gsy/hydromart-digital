-- Rollback of 20261125130000_settlement_orderids_gin: the index only speeds a read up.
DROP INDEX IF EXISTS "cash_settlements_orderIds_gin_idx";
