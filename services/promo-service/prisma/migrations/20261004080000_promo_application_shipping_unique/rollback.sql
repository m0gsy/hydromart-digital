-- Rollback for 20261004080000_promo_application_shipping_unique.
--
-- Safe for the data, but it REMOVES A GUARD: this partial unique index is what keeps a
-- shipping-discount row (productId NULL) to ONE per (orderId, promoRuleId). Without it, two
-- concurrent/retried apply() calls can both write a shipping row for the same order+rule,
-- double-recording the shipping discount in the audit trail.
DROP INDEX IF EXISTS "promo_applications_order_rule_shipping_key";
