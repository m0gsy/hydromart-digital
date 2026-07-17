-- Manual rollback for 0007_field_incident (delivery-service).
DROP TABLE IF EXISTS "field_incidents";
DROP TYPE IF EXISTS "IncidentSeverity";
DROP TYPE IF EXISTS "IncidentCategory";
