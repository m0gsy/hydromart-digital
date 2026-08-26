-- AUTHZ-3: a webhook endpoint now records WHICH partner key it belongs to.
--
-- The partner API answers "deliveries sent to you" and "send that one again". Neither ever
-- mentioned who was asking, because nothing in the schema could answer it: ApiKey and
-- WebhookEndpoint had no relation at all. One partner's key therefore read every other
-- partner's delivery rows — payload and all — and could replay them.
--
-- Nullable, and nothing backfills. There is no evidence anywhere in the data of which key
-- an endpoint was registered for, and guessing would hand one partner another's traffic —
-- the exact thing this closes. Existing endpoints therefore belong to NOBODY until a
-- platform admin assigns them, which is the fail-closed half: an unowned endpoint is
-- invisible to every partner key rather than visible to all of them. HQ (`platformAdmin`)
-- keeps its unscoped view, so nothing is unreachable in the meantime.
--
-- No index: this table holds one row per subscribed endpoint (single digits today), and
-- the partner read joins from webhook_deliveries through the endpoint's primary key.

-- AlterTable
ALTER TABLE "webhook_endpoints" ADD COLUMN "apiKeyId" TEXT;
