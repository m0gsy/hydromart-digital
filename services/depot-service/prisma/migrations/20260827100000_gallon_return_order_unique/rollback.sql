-- Reverse of 20260827100000_gallon_return_order_unique.
--
-- Drops the uniqueness and puts the plain lookup index back. Lossless: no row is touched,
-- and nothing read this index for anything but a lookup.
--
-- Note what rolling back re-opens: recordFromCourier's read-then-write survives the offline
-- queue's serial retry on its own, but the concurrent case (two flushes racing) is closed by
-- the constraint alone. Roll the image back with it.
DROP INDEX IF EXISTS "gallon_returns_orderId_key";
CREATE INDEX IF NOT EXISTS "gallon_returns_orderId_idx" ON "gallon_returns"("orderId");
