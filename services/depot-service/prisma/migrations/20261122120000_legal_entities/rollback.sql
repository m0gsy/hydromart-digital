-- Reverses 20261122120000_legal_entities.
--
-- THIS DROPS DATA: every legal entity head office entered, every dated depot assignment and the
-- whole AI-web matrix go. Nothing else in hydromart-digital reads these tables (the AI read API
-- that will, HD-6, is not built), so no screen or job other than /hq/legal-entities changes.
DROP TABLE IF EXISTS "legal_entity_ai_grants";
DROP TABLE IF EXISTS "depot_legal_entities";
DROP TABLE IF EXISTS "legal_entities";
DROP TYPE IF EXISTS "LegalEntityKind";
