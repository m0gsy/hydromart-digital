-- Rollback for 0012_optional_signature.
--
-- BLOCKS ON DATA. Restoring NOT NULL fails if any proof of delivery was captured without
-- a signature since the column was relaxed — which is the entire point of that change, so
-- expect rows. Decide first: delete those proofs (and with them the record that the
-- delivery was completed) or keep the column nullable and skip this rollback.
--
-- Count them before running:
--   SELECT count(*) FROM "proofs_of_delivery" WHERE "signatureUrl" IS NULL;
ALTER TABLE "proofs_of_delivery" ALTER COLUMN "signatureUrl" SET NOT NULL;
