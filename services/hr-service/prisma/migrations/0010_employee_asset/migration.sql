-- B3 Asset Management. The asset row holds only the CURRENT state; how it got there lives in
-- asset_movements, which is append-only (no UPDATE/DELETE path exists in the service).

CREATE TYPE "AssetType" AS ENUM ('MOTORCYCLE', 'SMARTPHONE', 'UNIFORM', 'LAPTOP', 'PRINTER', 'SCANNER', 'OTHER');
CREATE TYPE "AssetStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'RETURNED', 'MAINTENANCE', 'LOST');
CREATE TYPE "AssetMovementKind" AS ENUM ('ASSIGN', 'TRANSFER', 'RETURN', 'MAINTENANCE', 'LOST');

CREATE TABLE "employee_assets" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "code"      TEXT NOT NULL,
  "type"      "AssetType" NOT NULL,
  "name"      TEXT NOT NULL,
  "brand"     TEXT,
  "serialNo"  TEXT,
  "value"     DECIMAL(12,2),
  "depotId"   UUID NOT NULL,
  "status"    "AssetStatus" NOT NULL DEFAULT 'AVAILABLE',
  "holderId"  UUID,
  "note"      TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_assets_code_key" ON "employee_assets"("code");
CREATE INDEX "employee_assets_depotId_status_idx" ON "employee_assets"("depotId", "status");
CREATE INDEX "employee_assets_holderId_idx" ON "employee_assets"("holderId");

-- SET NULL, not CASCADE: an employee leaving must not delete the asset they were holding.
ALTER TABLE "employee_assets"
  ADD CONSTRAINT "employee_assets_holderId_fkey"
  FOREIGN KEY ("holderId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "asset_movements" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "assetId"        UUID NOT NULL,
  "kind"           "AssetMovementKind" NOT NULL,
  "fromEmployeeId" UUID,
  "toEmployeeId"   UUID,
  "condition"      TEXT,
  "note"           TEXT,
  "movedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"      UUID,
  CONSTRAINT "asset_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "asset_movements_assetId_idx" ON "asset_movements"("assetId");

ALTER TABLE "asset_movements"
  ADD CONSTRAINT "asset_movements_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "employee_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
