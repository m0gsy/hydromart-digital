-- Rollback for 0009_delivery_snapshot.
-- LOSSY: the recipient phone, line-item snapshot and COD amount captured on each delivery
-- at assignment are discarded. The courier detail screen falls back to live cross-service
-- reads, so historical deliveries whose order has since changed will no longer render what
-- was actually handed over.
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "codAmount";
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "items";
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "recipientPhone";
