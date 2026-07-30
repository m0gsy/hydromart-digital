-- Reverse of 20260730120000_rename_roles_hierarchy.
--
-- PRECONDITION: no account may be sitting on ASSISTANT_SUPERVISOR, SUPERVISOR or DIREKTUR.
-- Move them off first:
--   UPDATE customers SET role = 'MANAGER'
--    WHERE role IN ('ASSISTANT_SUPERVISOR', 'SUPERVISOR', 'DIREKTUR');
--
-- Postgres cannot DROP an enum value, so those three members stay defined but unused after
-- this rollback. That is harmless, and re-applying the migration is idempotent thanks to
-- ADD VALUE IF NOT EXISTS.
ALTER TYPE "Role" RENAME VALUE 'STAFF_DEPOT' TO 'DRIVER';
ALTER TYPE "Role" RENAME VALUE 'KEPALA_DEPOT' TO 'DEPOT_OPERATOR';
ALTER TYPE "Role" RENAME VALUE 'MANAGER' TO 'DEPOT_MANAGER';
