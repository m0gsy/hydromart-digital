-- Rollback for 20260902140000_pdp_retention_gaps.
--
-- Safe to run: it only removes the two policy rows. Nothing is un-deleted by it — a
-- payment proof or a rejected application already purged under these windows is gone,
-- which is the intended outcome and not something a rollback should try to reverse.
-- Removing the rows puts the sweep back to having no policy for either dataset, which is
-- the honest state before this migration rather than silence.
DELETE FROM "retention_policies"
 WHERE "dataset" IN ('payment_proof', 'franchise_applications_rejected');
