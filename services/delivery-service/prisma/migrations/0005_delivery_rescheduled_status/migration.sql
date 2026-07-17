-- 0005_delivery_rescheduled_status
-- ALTER TYPE ... ADD VALUE must run on its own — a newly added enum value cannot be
-- used in the same transaction it is created in, so it gets a dedicated migration.
ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'RESCHEDULED';
