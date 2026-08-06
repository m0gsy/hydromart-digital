-- Rollback 20260804120000_webhook_delivery.
--
-- Lossy by nature: undelivered events go with the table. Check for PENDING rows first if
-- the partner integration is live — anything still queued will never be sent.
--   SELECT count(*) FROM webhook_deliveries WHERE status = 'PENDING';
DROP INDEX IF EXISTS "api_keys_keyHash_key";
DROP TABLE IF EXISTS "webhook_deliveries";
DROP TYPE IF EXISTS "WebhookDeliveryStatus";
