-- The customer a delivery belongs to, snapshotted at assignment.
--
-- Without it a delivery notification can reach a phone but cannot thread into that
-- customer's in-app feed: crm stores `customerId` nullable and delivery-service had
-- nothing to send. The reschedule notice went out WhatsApp-only for exactly this reason.
--
-- Nullable, and it stays nullable: every delivery already in the table was assigned before
-- this column existed, and inventing an owner for them would be worse than admitting we do
-- not know. New assignments fill it; the notification path treats null as "no feed".
--
-- Schema release order: this column lands one release BEFORE the code that reads it.
ALTER TABLE "deliveries" ADD COLUMN "customerId" UUID;

-- The feed read is "this customer's deliveries, newest first".
CREATE INDEX "deliveries_customerId_createdAt_idx" ON "deliveries" ("customerId", "createdAt" DESC);
