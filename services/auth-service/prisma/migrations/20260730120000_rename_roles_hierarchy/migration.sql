-- Role rename + the three supervision levels (F1).
--
-- RENAME VALUE is in-place: every existing customers.role row keeps pointing at the same
-- enum member under its new name, so there is no row rewrite, no table lock beyond the
-- catalog update, and no downtime window.
--
-- ORDERING: deploy the JWT legacy-alias release FIRST. Access tokens already in the wild
-- carry 'DRIVER'/'DEPOT_OPERATOR'/'DEPOT_MANAGER'; without the alias every staff request
-- 403s until those tokens expire.
ALTER TYPE "Role" RENAME VALUE 'DRIVER' TO 'STAFF_DEPOT';
ALTER TYPE "Role" RENAME VALUE 'DEPOT_OPERATOR' TO 'KEPALA_DEPOT';
ALTER TYPE "Role" RENAME VALUE 'DEPOT_MANAGER' TO 'MANAGER';

-- The three new oversight levels. Appended without a BEFORE/AFTER clause on purpose:
-- enum sort order is cosmetic here, and an AFTER referring to a value added in this same
-- transaction is exactly the case PG restricts.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ASSISTANT_SUPERVISOR';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPERVISOR';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DIREKTUR';
