-- A ledger move belongs to ONE assignment event: its start, its end, or its permanent move.
--
-- The sweep (a cron every 15 minutes) and the "Terapkan sekarang" button can run at the same
-- moment, and applying a step read-then-wrote with nothing stopping both. The second write
-- appended a second LOAN_START / LOAN_END for the same assignment. NULL assignmentId rows
-- (moves not caused by an assignment) are untouched: Postgres treats NULLs as distinct.
--
-- Additive. employee_depot_moves is append-only and holds no row in production yet; were
-- there duplicates the index would refuse to build and say which pair, which is the right
-- failure for a ledger.
CREATE UNIQUE INDEX IF NOT EXISTS "employee_depot_moves_assignmentId_kind_key"
  ON "employee_depot_moves"("assignmentId", "kind");
