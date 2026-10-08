-- Undo of 20261008090000_voucher_item_scope.
--
-- WARNING: every item-scoped voucher becomes a WHOLE-ORDER voucher again, so a "Rp5.000 off
-- Galon 19L" code would discount any basket. Deactivate scoped vouchers before running this.
ALTER TABLE "vouchers" DROP COLUMN IF EXISTS "categoryId";
ALTER TABLE "vouchers" DROP COLUMN IF EXISTS "productId";
