-- Undoes 20260909140000_stock_transfer (CA-2-54).
--
-- LOSSY, and say so plainly: dropping the table destroys every record of stock that moved
-- between depots. The STOCK ITSELF is not lost — each side's movement rows (TRANSFER_OUT
-- and TRANSFER_IN) stay in `stock_movements`, so both books still balance — but the link
-- between the two halves, and anything still in transit, is gone. A transfer that was SENT
-- and not yet RECEIVED becomes stock that left one depot and arrived nowhere.
--
-- Before running this on production, export what is still in flight:
--   \copy (SELECT * FROM stock_transfers WHERE status = 'SENT') TO 'transfers-in-flight.csv' CSV HEADER
--
-- The two enum values are deliberately LEFT IN PLACE. PostgreSQL has no
-- `ALTER TYPE ... DROP VALUE`, and rows in `stock_movements` still carry them; an unused
-- enum member is inert, while rebuilding the type would fail against those rows.
DROP TABLE IF EXISTS "stock_transfers";
DROP TYPE IF EXISTS "StockTransferStatus";
