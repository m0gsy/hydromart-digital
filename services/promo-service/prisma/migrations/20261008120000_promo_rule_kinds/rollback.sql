-- Undo of 20261008120000_promo_rule_kinds.
--
-- ORDER-SENSITIVE, like 0006_voucher_free_shipping: Postgres cannot drop a value from an enum,
-- so rules of the new kinds are DEACTIVATED and retyped to a kind the old code knows, with
-- their configuration cleared. Deleting them is not an option: promo_applications keeps an
-- audit row per rule (onDelete: RESTRICT).
--
-- Retyped to SHIPPING_DISCOUNT with a NULL override, which old code never matches (it needs a
-- non-null override), so nothing fires. The unused enum labels are LEFT on the type.
UPDATE "promo_rules"
SET "active" = false, "kind" = 'SHIPPING_DISCOUNT', "shippingFeeOverride" = NULL
WHERE "kind" IN ('PERCENTAGE_OFF', 'ORDER_DISCOUNT', 'BUNDLE_GIFT');

ALTER TABLE "promo_rules" DROP COLUMN IF EXISTS "firstOrderOnly";
ALTER TABLE "promo_rules" DROP COLUMN IF EXISTS "giftProductId";
ALTER TABLE "promo_rules" DROP COLUMN IF EXISTS "discountAmount";
ALTER TABLE "promo_rules" DROP COLUMN IF EXISTS "minSubtotal";
ALTER TABLE "promo_rules" DROP COLUMN IF EXISTS "percentOff";
