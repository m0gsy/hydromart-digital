-- Undo 20261122220000_webhook_secret_required.
--
-- Not lossless, and cannot be: the secrets the migration generated for endpoints that had none
-- (or a short one) stay. Nobody ever held them, so a receiver of such an endpoint is in the same
-- place as before: it could not verify anything then either. The old short or empty values are
-- gone; a partner that verified against a short secret needs it set again by PATCH.

BEGIN;

ALTER TABLE "webhook_endpoints" DROP CONSTRAINT IF EXISTS "webhook_endpoints_secret_length";
ALTER TABLE "webhook_endpoints" ALTER COLUMN "secret" DROP NOT NULL;

COMMIT;
