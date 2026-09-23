-- Rollback for 20260923150000_voucher_audience_and_release.
-- Dropping `audience` makes every granted voucher public again; dropping `releasedAt` loses
-- which redemptions were handed back (the rows themselves stay).
ALTER TABLE "vouchers" DROP COLUMN IF EXISTS "audience";
ALTER TABLE "voucher_redemptions" DROP COLUMN IF EXISTS "releasedAt";
