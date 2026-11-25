-- Rolls back 20261125160000_failure_reason_code.
-- Drops the code; "failureReason" (the text) stays and readers classify from it. Lossy only for
-- the codes of rows failed since, which the text still describes.
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "failureReasonCode";
