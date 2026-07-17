-- Manual rollback for 0006_no_show_reschedule (delivery-service).
DROP TABLE IF EXISTS "contact_attempts";
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "rescheduleNote";
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "rescheduleSlot";
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "rescheduledFor";
DROP TYPE IF EXISTS "ContactMethod";
