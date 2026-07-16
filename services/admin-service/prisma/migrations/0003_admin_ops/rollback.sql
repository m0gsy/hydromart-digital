-- Rollback for 0003_admin_ops.
DROP TABLE IF EXISTS "incident_updates";
DROP TABLE IF EXISTS "incidents";
DROP TABLE IF EXISTS "fraud_flags";
DROP TABLE IF EXISTS "ticket_messages";
DROP TABLE IF EXISTS "support_tickets";
DROP TYPE IF EXISTS "IncidentStatus";
DROP TYPE IF EXISTS "IncidentSeverity";
DROP TYPE IF EXISTS "FraudStatus";
DROP TYPE IF EXISTS "FraudLevel";
DROP TYPE IF EXISTS "FraudEntityType";
DROP TYPE IF EXISTS "TicketAuthorType";
DROP TYPE IF EXISTS "TicketStatus";
DROP TYPE IF EXISTS "TicketPriority";
