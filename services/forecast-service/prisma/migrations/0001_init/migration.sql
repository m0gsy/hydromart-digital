-- CreateTable
CREATE TABLE "product_daily_demand" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "depotId" UUID,
    "day" DATE NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_daily_demand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_ref" (
    "productId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_ref_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "ingested_order" (
    "orderId" UUID NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingested_order_pkey" PRIMARY KEY ("orderId")
);

-- CreateIndex
CREATE INDEX "product_daily_demand_depotId_day_idx" ON "product_daily_demand"("depotId", "day");

-- CreateIndex
CREATE INDEX "product_daily_demand_productId_depotId_idx" ON "product_daily_demand"("productId", "depotId");

-- CreateIndex
CREATE UNIQUE INDEX "product_daily_demand_productId_depotId_day_key" ON "product_daily_demand"("productId", "depotId", "day");
