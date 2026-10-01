-- #24: tank level (0..100%), read at the same two moments the water-meter dial is.
--
-- Nullable and additive — every existing row, and every reading taken before an operator
-- starts filling this in, stays NULL ("unmeasured"), never 0% full. The litre capacity a
-- percentage is measured against lives in settings, not here: a tank's size does not
-- change day to day, and storing it on every row would just be 365 copies of one number.
ALTER TABLE "meter_readings" ADD COLUMN "openingTankPct" DECIMAL(5,2);
ALTER TABLE "meter_readings" ADD COLUMN "closingTankPct" DECIMAL(5,2);
