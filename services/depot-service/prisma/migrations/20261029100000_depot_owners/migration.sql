-- Multi-owner franchise depots: a depot may have several owners, each with a revenue share.
-- Expand-only: `depots.ownerId` stays and mirrors the primary owner for one release, so older
-- readers (order-service, forecast, hr) keep working while the new table is rolled out.

-- CreateTable
CREATE TABLE "depot_owners" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "sharePct" DECIMAL(5,2) NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdBy" UUID,

    CONSTRAINT "depot_owners_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "depot_owners_share_range" CHECK ("sharePct" > 0 AND "sharePct" <= 100)
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "depot_owners_depotId_effectiveTo_idx" ON "depot_owners"("depotId", "effectiveTo");
CREATE INDEX IF NOT EXISTS "depot_owners_ownerId_effectiveTo_idx" ON "depot_owners"("ownerId", "effectiveTo");

-- One open row per (depot, owner) and one open primary per depot. Partial, so closed
-- generations (history) may repeat an owner freely.
CREATE UNIQUE INDEX IF NOT EXISTS "depot_owners_open_owner_key" ON "depot_owners"("depotId", "ownerId") WHERE "effectiveTo" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "depot_owners_open_primary_key" ON "depot_owners"("depotId") WHERE "effectiveTo" IS NULL AND "isPrimary";

-- AddForeignKey
ALTER TABLE "depot_owners" ADD CONSTRAINT "depot_owners_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every depot that has an owner today becomes one 100% primary row, effective
-- since the depot existed, so an as-of lookup for any past order still finds it.
INSERT INTO "depot_owners" ("id", "depotId", "ownerId", "sharePct", "isPrimary", "effectiveFrom")
SELECT gen_random_uuid(), "id", "ownerId", 100, true, "createdAt"
FROM "depots"
WHERE "ownerId" IS NOT NULL;
