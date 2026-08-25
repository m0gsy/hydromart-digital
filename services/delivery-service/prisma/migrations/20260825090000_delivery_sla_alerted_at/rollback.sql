-- Reverses 20260825090000_delivery_sla_alerted_at.
--
-- Dropping the column loses the record of which breaches were already reported. The cost
-- is bounded and one-directional: the next sweep after a rollback re-reports every
-- delivery that is still late. Duplicate alerts about genuinely late deliveries, not
-- silence about them — the survivable half.
ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "slaAlertedAt";
