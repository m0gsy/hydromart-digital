-- RERUNNABLE: face-fallback PR-1. Additive and nullable; no code reads these columns yet, so the
-- previous release runs unchanged on this schema.

DO $$ BEGIN
  CREATE TYPE "FaceEngine" AS ENUM ('NEO', 'LOCAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Null = NEO's gallery does not know this face yet.
ALTER TABLE "face_embeddings" ADD COLUMN IF NOT EXISTS "neoSyncedAt" TIMESTAMP(3);

ALTER TABLE "attendance" ADD COLUMN IF NOT EXISTS "checkInEngine" "FaceEngine";
ALTER TABLE "attendance" ADD COLUMN IF NOT EXISTS "checkOutEngine" "FaceEngine";
-- The phone's capturedAt as sent: the key that recognises a replay.
ALTER TABLE "attendance" ADD COLUMN IF NOT EXISTS "checkInClientAt" TIMESTAMP(3);
ALTER TABLE "attendance" ADD COLUMN IF NOT EXISTS "checkOutClientAt" TIMESTAMP(3);

-- A face enrolled through NEO keeps no local vector (vectorEnc null, legacy vector empty): NEO
-- already knows it, so it is synced as of its enrolment.
UPDATE "face_embeddings"
SET "neoSyncedAt" = "createdAt"
WHERE "neoSyncedAt" IS NULL
  AND "vectorEnc" IS NULL
  AND coalesce(cardinality("vector"), 0) = 0;
