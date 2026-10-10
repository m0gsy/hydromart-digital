-- Undoes 20261011120000_depot_assignment_requested.
--
-- Postgres cannot drop a single enum value, and rebuilding the type to drop one would rewrite
-- employee_depot_assignments for a label nothing depends on once the code is rolled back.
-- Rows that already carry REQUESTED are left as they are; the older code never reads that
-- status (its sweep selects PLANNED/ACTIVE only), so an unused label is the safe state.
-- Stated rather than left empty so the gate - and the next reader - can tell it is deliberate.
SELECT 1;
