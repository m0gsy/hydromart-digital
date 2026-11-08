-- RERUNNABLE: marker for a customer whose personal data was erased (CUS-05). Nullable and
-- additive: nobody has one until the erasure executor that writes it ships, and the audience
-- queries that read it treat NULL as "not erased".
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "anonymisedAt" TIMESTAMP(3);
