-- Rolls back 20261108170000_support_ticket_timestamps.
-- Drops the metrics and the key. Lossy only for the metrics (first-response and resolution
-- times of tickets handled since); a double-tapped complaint can again be filed twice.
DROP INDEX IF EXISTS "support_tickets_customerId_idempotencyKey_key";
ALTER TABLE "support_tickets" DROP COLUMN IF EXISTS "idempotencyKey";
ALTER TABLE "support_tickets" DROP COLUMN IF EXISTS "resolvedBy";
ALTER TABLE "support_tickets" DROP COLUMN IF EXISTS "resolvedAt";
ALTER TABLE "support_tickets" DROP COLUMN IF EXISTS "firstResponseAt";
