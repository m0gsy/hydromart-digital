-- AI-12a follow-up: the AI web's ingress endpoint also receives `depot.quality_hold_changed`, so
-- the AI web keeps each depot's quality-hold state (HD-14) for the approval inbox's "depot tidak
-- sedang quality hold" check and tells staff when a hold starts or ends. The AI web handles the
-- event in the app since hydromart-ai a5ba94f, which production runs from the release pinned
-- in this same change (infra/aiweb/docker-compose.yml).
--
-- Data only and idempotent, the same shape as 20261126180000_aiweb_endpoint_depot_onboarded: it
-- appends the one event name to the one endpoint registered at that URL. The secret, the active
-- flag, the partner key and every other endpoint stay exactly as they are. No endpoint at that
-- URL (CI, a fresh box) = no row changed.
UPDATE "webhook_endpoints"
SET "events" = array_append("events", 'depot.quality_hold_changed')
WHERE "url" = 'https://ai.hydromart-digital.com/api/ingress/hd'
  AND NOT ('depot.quality_hold_changed' = ANY ("events"));
