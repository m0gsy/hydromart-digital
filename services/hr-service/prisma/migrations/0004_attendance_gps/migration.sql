-- Fase 3: GPS captured with each attendance punch (FR + GPS + timestamp).
ALTER TABLE "attendance"
  ADD COLUMN "checkInLat"   DOUBLE PRECISION,
  ADD COLUMN "checkInLng"   DOUBLE PRECISION,
  ADD COLUMN "checkOutLat"  DOUBLE PRECISION,
  ADD COLUMN "checkOutLng"  DOUBLE PRECISION;
