-- Rollback for 0004_admin_config.
DROP TABLE IF EXISTS "onboarding_state";
DROP TABLE IF EXISTS "admin_notification_prefs";
DROP TABLE IF EXISTS "security_policy";
DROP TABLE IF EXISTS "backup_status";
DROP TABLE IF EXISTS "retention_policies";
DROP TABLE IF EXISTS "sla_policy";
