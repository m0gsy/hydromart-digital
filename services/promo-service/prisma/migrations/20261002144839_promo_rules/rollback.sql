-- Undo of 20261002144839_promo_rules.
--
-- Drops the auto-apply promo rule engine tables and enums introduced by this migration, in
-- FK-safe reverse order: promo_applications references promo_rules, so it goes first.
DROP TABLE IF EXISTS "promo_applications";
DROP TABLE IF EXISTS "promo_rules";
DROP TYPE IF EXISTS "PromoKind";
DROP TYPE IF EXISTS "SalesChannel";
