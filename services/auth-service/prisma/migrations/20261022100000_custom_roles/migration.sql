-- Custom roles + per-depot capability exceptions.
--
-- The built-in role list stays closed in code (@hydromart/access). What changes is that a
-- SUPER_ADMIN can now define more, so the two columns that held the "Role" enum become text:
-- an enum cannot grow at runtime, and a value no code path knows must still be storable.
-- Values are preserved byte for byte (enum -> text cast). Validation moves to the service.
--
-- Rollback (only valid while no custom role is assigned):
--   CREATE TYPE "Role" AS ENUM ('CUSTOMER','STAFF_DEPOT','KEPALA_DEPOT','ASSISTANT_SUPERVISOR',
--     'SUPERVISOR','MANAGER','DIREKTUR','FRANCHISE_OWNER','HEAD_OFFICE','FINANCE','HR','MARKETING','SUPER_ADMIN');
--   ALTER TABLE "capability_overrides" ALTER COLUMN "roles" TYPE "Role"[] USING "roles"::"Role"[];
--   ALTER TABLE "customers" ALTER COLUMN "role" DROP DEFAULT;
--   ALTER TABLE "customers" ALTER COLUMN "role" TYPE "Role" USING "role"::"Role";
--   ALTER TABLE "customers" ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';
--   DROP TABLE "capability_depot_overrides"; DROP TABLE "custom_roles";

ALTER TABLE "capability_overrides" ALTER COLUMN "roles" TYPE TEXT[] USING "roles"::TEXT[];

ALTER TABLE "customers" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "customers" ALTER COLUMN "role" TYPE TEXT USING "role"::TEXT;
ALTER TABLE "customers" ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';

DROP TYPE "Role";

CREATE TABLE "custom_roles" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "custom_roles_key_prefix" CHECK ("key" LIKE 'C\_%'),
    CONSTRAINT "custom_roles_scope" CHECK ("scope" IN ('LOCKED', 'RESOLVED', 'GLOBAL'))
);

CREATE TABLE "capability_depot_overrides" (
    "capability" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "depotId" UUID NOT NULL,
    "effect" TEXT NOT NULL,
    "updatedBy" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capability_depot_overrides_pkey" PRIMARY KEY ("capability", "roleKey", "depotId"),
    CONSTRAINT "capability_depot_overrides_effect" CHECK ("effect" IN ('GRANT', 'DENY'))
);

CREATE INDEX "customers_role_idx" ON "customers"("role");
