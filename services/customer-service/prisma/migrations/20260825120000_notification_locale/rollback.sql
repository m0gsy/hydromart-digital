-- Rollback for 20260825120000_notification_locale.
-- LOSSY: every customer who chose English loses that choice and goes back to Indonesian
-- messages. The app's own UI is unaffected (that lives in the browser's localStorage).
ALTER TABLE "notification_preferences" DROP COLUMN IF EXISTS "locale";
