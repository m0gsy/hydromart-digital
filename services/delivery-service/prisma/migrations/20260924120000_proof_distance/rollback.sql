-- Rollback for 20260924120000_proof_distance. The measurement stops being recorded.
ALTER TABLE "proofs_of_delivery" DROP COLUMN IF EXISTS "distanceMeters";
