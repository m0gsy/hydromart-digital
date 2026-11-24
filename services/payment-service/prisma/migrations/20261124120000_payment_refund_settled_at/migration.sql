-- RERUNNABLE: the moment a refund is SETTLED (the gateway answered), as opposed to
-- "refundedAt", which the claim stamps BEFORE the gateway call. The order's refunded total counts
-- only settled rows, so a claim that is later handed back never inflates it.
-- Rows already REFUNDED were settled by the code that wrote them: backfill from refundedAt.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "refundSettledAt" TIMESTAMP(3);
UPDATE "payments"
   SET "refundSettledAt" = COALESCE("refundedAt", "updatedAt")
 WHERE "status" = 'REFUNDED' AND "refundSettledAt" IS NULL;
