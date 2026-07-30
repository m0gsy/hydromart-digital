-- SUPER_ADMIN edits to the compiled RBAC matrix, stored as a sparse patch: one row per
-- CHANGED capability. An empty table is byte-for-byte the behaviour shipped in the code,
-- so this migration turns nothing on by itself.
CREATE TABLE "capability_overrides" (
    "capability" TEXT NOT NULL,
    "roles" "Role"[],
    "updatedBy" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capability_overrides_pkey" PRIMARY KEY ("capability")
);
