-- Dropping the patch table returns every capability to its compiled default, which is
-- the same state as an empty table. No data beyond the edits themselves is lost.
DROP TABLE IF EXISTS "capability_overrides";
