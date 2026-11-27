-- Rollback for 20261128090500_b2b_prospect_retention: the sweep stops, B2B prospects are kept again.
DELETE FROM "retention_policies" WHERE "dataset" = 'b2b_prospects';
