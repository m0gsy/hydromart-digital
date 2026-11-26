-- HD-21 follow-up (owner request, 26 Nov 2026): the AI web's ingress endpoint also receives
-- `depot.onboarded`, so the calon mitra CRM marks a prospect ONBOARDED when HQ activates the
-- draft depot made from it. The AI web handles the event in the app (HANDLED_IN_APP since
-- hydromart-ai 951fe29, live in production since #1111).
--
-- Data only and idempotent: it appends the one event name to the one endpoint registered at
-- that URL, which today holds {franchise.application_submitted}. The secret, the active flag,
-- the partner key and every other endpoint stay exactly as they are (the same as a PATCH from
-- /hq/webhooks that only adds an event). No endpoint at that URL (CI, a fresh box) = no row
-- changed. order.*, stock.low and delivery.delivered are deliberately NOT subscribed: the AI
-- web stores them append-only and has no workflow that uses them yet.
UPDATE "webhook_endpoints"
SET "events" = array_append("events", 'depot.onboarded')
WHERE "url" = 'https://ai.hydromart-digital.com/api/ingress/hd'
  AND NOT ('depot.onboarded' = ANY ("events"));
