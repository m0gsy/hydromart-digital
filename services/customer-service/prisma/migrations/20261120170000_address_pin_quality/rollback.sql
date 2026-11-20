-- Undoes 20261120170000_address_pin_quality.
--
-- LOSSY only for the pin metadata written since (accuracy and source); every pin itself stays.
-- The enum goes last: a type cannot be dropped while a column still uses it.

ALTER TABLE "addresses" DROP COLUMN IF EXISTS "pinSource";
ALTER TABLE "addresses" DROP COLUMN IF EXISTS "pinAccuracyM";
DROP TYPE IF EXISTS "PinSource";
