-- The reason HQ typed when it decided a price-override proposal or a franchise application.
-- The web already sent it (DecisionReasonDto) and only the audit trail kept it, so the queue
-- could not show WHY a proposal was rejected without a trip to the audit screen.
-- Nullable: every decision made before this column existed has no recorded reason.
-- RERUNNABLE: ADD COLUMN IF NOT EXISTS.
ALTER TABLE "price_override_proposals" ADD COLUMN IF NOT EXISTS "decisionReason" TEXT;
ALTER TABLE "franchise_applications" ADD COLUMN IF NOT EXISTS "decisionReason" TEXT;
