-- Rollback for 0007_voucher_ondelete_restrict.
--
-- Safe for the data as it runs, but it RESTORES A DEFECT: back on CASCADE, deleting a
-- voucher silently deletes its grants and — worse — its redemption history, which is the
-- record of discounts actually given to customers. That is exactly what the forward
-- migration was written to stop.
ALTER TABLE "voucher_redemptions" DROP CONSTRAINT IF EXISTS "voucher_redemptions_voucherId_fkey";
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_voucherId_fkey"
  FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "voucher_grants" DROP CONSTRAINT IF EXISTS "voucher_grants_voucherId_fkey";
ALTER TABLE "voucher_grants" ADD CONSTRAINT "voucher_grants_voucherId_fkey"
  FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
