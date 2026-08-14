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

-- No index here, deliberately. `scripts/create-indexes.sh` runs BEFORE migrations, so an
-- index on a column this same release is about to add cannot be pre-built concurrently —
-- the deploy proved it: "column customerId does not exist … refusing to let the migration
-- build it under a lock". The index ships in the NEXT release, once the column is there.
