-- RERUNNABLE: address package 3 (2026-11-20). Additive and nullable: a plan made before this
-- keeps delivering to its own snapshot, exactly as it always did.

-- The saved address a plan was made from (customer-service id; no foreign key across services).
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "addressId" TEXT;
