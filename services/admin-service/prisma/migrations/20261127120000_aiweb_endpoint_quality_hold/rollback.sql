-- Undo 20261127120000_aiweb_endpoint_quality_hold: the AI web's endpoint stops receiving
-- depot.quality_hold_changed; its other events, secret and state are untouched.
UPDATE "webhook_endpoints"
SET "events" = array_remove("events", 'depot.quality_hold_changed')
WHERE "url" = 'https://ai.hydromart-digital.com/api/ingress/hd';
