-- CreateEnum
CREATE TYPE "OwnershipType" AS ENUM ('WARALABA', 'HKP');

-- CreateEnum
CREATE TYPE "InventoryItemType" AS ENUM ('AIR', 'GALON', 'TUTUP', 'SEGEL', 'PRODUK');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ADJUSTMENT', 'OPNAME');

-- CreateTable
CREATE TABLE "depots" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownershipType" "OwnershipType" NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "serviceRadiusKm" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "deliveryFee" DECIMAL(12,2) NOT NULL,
    "minOrderAmount" DECIMAL(12,2),
    "operatingHours" JSONB NOT NULL DEFAULT '{}',
    "holidays" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "depots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "itemType" "InventoryItemType" NOT NULL,
    "productId" UUID,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "minimumStock" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "delta" INTEGER NOT NULL,
    "quantityBefore" INTEGER NOT NULL,
    "quantityAfter" INTEGER NOT NULL,
    "reason" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "depots_code_key" ON "depots"("code");

-- CreateIndex
CREATE INDEX "depots_active_idx" ON "depots"("active");

-- CreateIndex
CREATE INDEX "depots_ownershipType_idx" ON "depots"("ownershipType");

-- CreateIndex
CREATE INDEX "inventory_items_depotId_idx" ON "inventory_items"("depotId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_depotId_itemType_productId_key" ON "inventory_items"("depotId", "itemType", "productId");

-- CreateIndex
CREATE INDEX "stock_movements_itemId_idx" ON "stock_movements"("itemId");

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
