-- Undo of 20260903150000_voucher_depot_scope.
--
-- Dropping this makes every depot-scoped voucher network-wide again — the behaviour before
-- the migration. Nothing else references the column.
DROP INDEX IF EXISTS "vouchers_depotId_idx";
ALTER TABLE "vouchers" DROP COLUMN IF EXISTS "depotId";
