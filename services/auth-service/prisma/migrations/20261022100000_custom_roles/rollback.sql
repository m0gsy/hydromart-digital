-- Undo 20261022100000_custom_roles, in reverse order.
--
-- NOT lossless once the feature has been used, and it says so by failing rather than by guessing:
--   * the "Role" enum is recreated and customers.role / capability_overrides.roles are cast back to
--     it. If any account still holds a custom role (a `C_...` key) or any capability list names one,
--     the cast raises and the whole statement set stops. Move those accounts to a built-in role and
--     remove the key from the lists first (the console archives a role only when nobody holds it).
--   * custom_roles, role_settings and capability_depot_overrides are dropped with their rows:
--     custom role definitions, renamed/disabled built-in settings and per-depot rules are gone.
-- Built-in role values are preserved exactly.

BEGIN;

ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "customers_role_known";

CREATE TYPE "Role" AS ENUM ('CUSTOMER','STAFF_DEPOT','KEPALA_DEPOT','ASSISTANT_SUPERVISOR',
  'SUPERVISOR','MANAGER','DIREKTUR','FRANCHISE_OWNER','HEAD_OFFICE','FINANCE','HR','MARKETING','SUPER_ADMIN');

ALTER TABLE "capability_overrides" ALTER COLUMN "roles" TYPE "Role"[] USING "roles"::"Role"[];

ALTER TABLE "customers" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "customers" ALTER COLUMN "role" TYPE "Role" USING "role"::"Role";
ALTER TABLE "customers" ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';

DROP TABLE IF EXISTS "capability_depot_overrides";
DROP TABLE IF EXISTS "role_settings";
DROP TABLE IF EXISTS "custom_roles";

COMMIT;
