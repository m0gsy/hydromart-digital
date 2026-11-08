-- RERUNNABLE: support-ticket response metrics and create idempotency (AAS-12). Every column
-- is nullable and additive, so existing tickets are untouched and nothing reads them until
-- the code that writes them ships. NULLs are distinct in a unique index, so tickets without
-- a key (staff-raised, or a client that sends none) can never collide.
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "firstResponseAt" TIMESTAMP(3);
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "resolvedBy" TEXT;
ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "support_tickets_customerId_idempotencyKey_key"
  ON "support_tickets"("customerId", "idempotencyKey");
