-- Rollback for 0002_admin_integration.
DROP TABLE IF EXISTS "scheduled_reports";
DROP TABLE IF EXISTS "export_logs";
DROP TABLE IF EXISTS "webhook_endpoints";
DROP TABLE IF EXISTS "api_keys";
DROP TYPE IF EXISTS "ReportCadence";
DROP TYPE IF EXISTS "ExportStatus";
DROP TYPE IF EXISTS "ExportFormat";
DROP TYPE IF EXISTS "ApiKeyEnvironment";
