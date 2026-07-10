-- Rollback for 0002_add_notifications.
DROP TABLE IF EXISTS "notifications";
DROP TYPE IF EXISTS "NotificationStatus";
