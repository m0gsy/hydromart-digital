-- Item 5 (11): three new promo kinds and a "first order only" condition.
--
--   PERCENTAGE_OFF  percent off the unit price of a product/category
--   ORDER_DISCOUNT  spend at least `minSubtotal`, get a fixed amount or a percent off the order
--   BUNDLE_GIFT     buy `buyQty` of the scoped product(s), get `getQty` of a DIFFERENT product free
--
-- Additive only. Old rows keep their kind and read NULL / false for every new column, and old
-- code ignores the columns, so a rebuild window with mixed images is safe. ADD VALUE follows
-- the precedent of 0006_voucher_free_shipping.
ALTER TYPE "PromoKind" ADD VALUE IF NOT EXISTS 'PERCENTAGE_OFF';
ALTER TYPE "PromoKind" ADD VALUE IF NOT EXISTS 'ORDER_DISCOUNT';
ALTER TYPE "PromoKind" ADD VALUE IF NOT EXISTS 'BUNDLE_GIFT';

ALTER TABLE "promo_rules" ADD COLUMN IF NOT EXISTS "percentOff" INTEGER;
ALTER TABLE "promo_rules" ADD COLUMN IF NOT EXISTS "minSubtotal" INTEGER;
ALTER TABLE "promo_rules" ADD COLUMN IF NOT EXISTS "discountAmount" INTEGER;
ALTER TABLE "promo_rules" ADD COLUMN IF NOT EXISTS "giftProductId" TEXT;
ALTER TABLE "promo_rules" ADD COLUMN IF NOT EXISTS "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false;
