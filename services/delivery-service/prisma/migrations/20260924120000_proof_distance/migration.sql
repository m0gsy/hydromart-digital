-- DLV-4: proof of delivery carried the courier's own GPS reading and nothing ever compared
-- it to the address the order was going to.
--
-- Nullable, no backfill: the distance for a proof captured before this column cannot be
-- recomputed honestly (the destination may have changed since), and writing a zero would
-- read as "delivered at the door" for every historical row.
ALTER TABLE "proofs_of_delivery" ADD COLUMN "distanceMeters" INTEGER;
