-- Rollback for 20260930120000_meter_tank_level.
ALTER TABLE "meter_readings" DROP COLUMN "openingTankPct";
ALTER TABLE "meter_readings" DROP COLUMN "closingTankPct";
