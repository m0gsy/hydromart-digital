-- Customer-facing ETA, computed at ON_DELIVERY start (straight-line distance ÷ an
-- assumed urban speed) and pushed onto the order payload the customer reads.
-- Additive + nullable: existing deliveries stay valid (null = not started / uncomputable).
ALTER TABLE "deliveries" ADD COLUMN "estimatedArrivalAt" TIMESTAMP(3);
