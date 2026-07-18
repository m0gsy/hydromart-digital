-- DB-10: voucher grants/redemptions are audit records (who was granted a voucher, and the
-- discount actually burned). Deleting a Voucher must NOT cascade them away. Switch both FKs
-- from ON DELETE CASCADE to ON DELETE RESTRICT so a voucher with history can't be hard-deleted
-- (retire via active=false instead).

ALTER TABLE "voucher_grants" DROP CONSTRAINT "voucher_grants_voucherId_fkey";
ALTER TABLE "voucher_grants" ADD CONSTRAINT "voucher_grants_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "voucher_redemptions" DROP CONSTRAINT "voucher_redemptions_voucherId_fkey";
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
