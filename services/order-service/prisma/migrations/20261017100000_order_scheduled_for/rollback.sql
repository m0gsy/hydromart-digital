-- Rollback for 20261017100000_order_scheduled_for.
-- Drops the booked-slot instant: every scheduled order loses it (the free-form deliverySlot label stays).
ALTER TABLE "orders" DROP COLUMN "scheduledFor";
