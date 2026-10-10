-- Undoes 20261010120000_resync_home_depot.
--
-- There is nothing to undo, and that is stated rather than left empty: the migration only
-- copied the live depot onto `homeDepotId` for people who were not lent out, which is the value
-- the column is meant to hold. Restoring the old stale values would need a copy of them taken
-- before the migration, and no such copy is kept - they were the bug.
SELECT 1;
