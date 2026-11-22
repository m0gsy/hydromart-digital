-- RERUNNABLE: HD-7, every webhook endpoint has a signing secret, and it is long enough to be one.
--
-- The dispatcher used to send an endpoint without a secret unsigned. CA-2-37 made registration
-- generate one, but nothing stopped a row without one: older rows, an explicit short secret, or a
-- PATCH to "" (which switched signing off for good). The AI web and n8n take events only signed.
--
-- An endpoint that has no usable secret is given a random one: 64 hex characters from two
-- gen_random_uuid() values (pg_strong_random). Nobody holds it, so such an endpoint has to be given
-- a known secret (PATCH) before its receiver can verify anything; until now it verified nothing.
-- Production had no webhook endpoints at all when this was written (2026-11-22).
UPDATE "webhook_endpoints"
   SET "secret" = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
 WHERE "secret" IS NULL OR char_length("secret") < 32;

ALTER TABLE "webhook_endpoints" ALTER COLUMN "secret" SET NOT NULL;

ALTER TABLE "webhook_endpoints" DROP CONSTRAINT IF EXISTS "webhook_endpoints_secret_length";
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_secret_length"
  CHECK (char_length("secret") >= 32);
