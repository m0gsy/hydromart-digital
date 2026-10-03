-- A shipping-discount PromoApplication row always has productId NULL, and Postgres treats
-- every NULL as distinct from every other NULL in a unique index — so the existing
-- @@unique([orderId, promoRuleId, productId]) does not stop two concurrent apply() calls
-- from both writing a shipping row for the same order+rule. Same defect class as DB-11
-- (services/depot-service/20260718170000_inventory_singleton_unique) — same fix.
CREATE UNIQUE INDEX "promo_applications_order_rule_shipping_key"
  ON "promo_applications" ("orderId", "promoRuleId")
  WHERE "productId" IS NULL;
