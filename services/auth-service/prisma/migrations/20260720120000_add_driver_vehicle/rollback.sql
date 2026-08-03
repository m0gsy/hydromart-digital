-- Rollback for 20260720120000_add_driver_vehicle.
-- LOSSY: driver vehicle type and plate number are discarded.
ALTER TABLE "customers" DROP COLUMN IF EXISTS "plateNumber";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "vehicleType";
