-- Undo 20261126180000_aiweb_endpoint_depot_onboarded: the AI web's endpoint stops receiving
-- depot.onboarded; its other events, secret and state are untouched.
UPDATE "webhook_endpoints"
SET "events" = array_remove("events", 'depot.onboarded')
WHERE "url" = 'https://ai.hydromart-digital.com/api/ingress/hd';
