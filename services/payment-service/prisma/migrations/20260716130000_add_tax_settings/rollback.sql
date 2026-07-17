-- Manual rollback for migration 20260716130000_add_tax_settings (payment-service).
DROP TABLE IF EXISTS "tax_settings";
