-- Snapshot recipient contact, order line-items, and COD amount onto each delivery at
-- assignment so the courier delivery-detail + customer tracking render without a live
-- cross-service call. Additive + nullable: existing deliveries stay valid (null =
-- unknown manifest / non-COD for legacy rows).
ALTER TABLE "deliveries" ADD COLUMN "recipientPhone" TEXT;
ALTER TABLE "deliveries" ADD COLUMN "items" JSONB;
ALTER TABLE "deliveries" ADD COLUMN "codAmount" INTEGER;
