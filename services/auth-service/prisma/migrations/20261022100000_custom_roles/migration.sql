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
--   ALTER TABLE "customers" DROP CONSTRAINT "customers_role_known";
--   ALTER TABLE "customers" ALTER COLUMN "role" DROP DEFAULT;
--   ALTER TABLE "customers" ALTER COLUMN "role" TYPE "Role" USING "role"::"Role";
--   ALTER TABLE "customers" ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';
--   DROP TABLE "capability_depot_overrides"; DROP TABLE "custom_roles"; DROP TABLE "role_settings";

ALTER TABLE "capability_overrides" ALTER COLUMN "roles" TYPE TEXT[] USING "roles"::TEXT[];

ALTER TABLE "customers" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "customers" ALTER COLUMN "role" TYPE TEXT USING "role"::TEXT;
ALTER TABLE "customers" ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';

DROP TYPE "Role";

-- The enum used to be the only thing keeping a stray value out of customers.role. Keep that
-- guarantee: a built-in role, or a custom key (whose existence the service checks).
ALTER TABLE "customers" ADD CONSTRAINT "customers_role_known" CHECK (
    "role" IN ('CUSTOMER','STAFF_DEPOT','KEPALA_DEPOT','ASSISTANT_SUPERVISOR','SUPERVISOR','MANAGER',
               'DIREKTUR','FRANCHISE_OWNER','HEAD_OFFICE','FINANCE','HR','MARKETING','SUPER_ADMIN')
    OR "role" LIKE 'C\_%'
);

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

CREATE TABLE "role_settings" (
    "roleKey" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "scope" TEXT,
    "disabledAt" TIMESTAMP(3),
    "updatedBy" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_settings_pkey" PRIMARY KEY ("roleKey"),
    CONSTRAINT "role_settings_scope" CHECK ("scope" IS NULL OR "scope" IN ('LOCKED', 'RESOLVED', 'GLOBAL'))
);

CREATE INDEX "customers_role_idx" ON "customers"("role");
