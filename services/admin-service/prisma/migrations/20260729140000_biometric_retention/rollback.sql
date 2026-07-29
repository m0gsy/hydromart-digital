-- Rollback for 20260729140000_biometric_retention.
--
-- Safe to run: this only removes the policy row. Nothing is un-deleted by it — face
-- embeddings already purged under this window are gone, which is the intended outcome
-- and not something a rollback should try to reverse.
DELETE FROM "retention_policies" WHERE "dataset" = 'hr_face_embeddings';
