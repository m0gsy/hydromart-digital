-- Reverse of 20260901120000_order_dispute_customer_id.
--
-- Lossless in this release BECAUSE the column ships alone: nothing reads or writes it yet,
-- so dropping it cannot strand a query or lose a value anybody entered.
--
-- Once the erasure executor lands (one release later), rolling this back deletes the only
-- link between a dispute and its account — and the dataset returns to being reported
-- UNENFORCED by auth-service's erasure registry, which is the honest state it was in
-- before. Roll the image back with it.
-- The index is named here even though this migration does not create it: it is built out of
-- band by scripts/create-indexes.sh and would otherwise be left pointing at a column that no
-- longer exists. Postgres would drop it with the column anyway; saying so makes the rollback
-- readable and safe to run twice.
DROP INDEX IF EXISTS "order_disputes_customerId_idx";
ALTER TABLE "order_disputes" DROP COLUMN IF EXISTS "customerId";
