-- Undoes 20261119120000_face_engine_columns.
--
-- LOSSY only for what the face-fallback code has written since: which engine judged each punch,
-- the phones' raw capture times, and when NEO learned each locally-enrolled face. Attendance
-- itself (times, scores, status) and every face template are untouched. Run it only after the
-- code that reads these columns has been rolled back too.
--
-- The enum goes last: a type cannot be dropped while a column still uses it.

ALTER TABLE "attendance" DROP COLUMN IF EXISTS "checkOutClientAt";
ALTER TABLE "attendance" DROP COLUMN IF EXISTS "checkInClientAt";
ALTER TABLE "attendance" DROP COLUMN IF EXISTS "checkOutEngine";
ALTER TABLE "attendance" DROP COLUMN IF EXISTS "checkInEngine";
ALTER TABLE "face_embeddings" DROP COLUMN IF EXISTS "neoSyncedAt";
DROP TYPE IF EXISTS "FaceEngine";
