-- Undo of 20260909210000_supplier_updated_at.
--
-- Dropping this loses when each supplier was last edited, which nothing else reads — but it
-- also returns the supplier form to last-write-wins, because the version the client sends
-- back would have nothing to compare against. The older image ignores the column, so the
-- rollback is safe in the direction it is meant for.
ALTER TABLE "suppliers" DROP COLUMN IF EXISTS "updatedAt";
