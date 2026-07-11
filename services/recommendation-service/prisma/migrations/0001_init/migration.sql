-- CreateTable
CREATE TABLE "customer_product_purchases" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "purchaseCount" INTEGER NOT NULL DEFAULT 0,
    "lastPurchasedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_product_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_co_buys" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "relatedProductId" UUID NOT NULL,
    "coCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_co_buys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_daily_sales" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "depotId" UUID,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_daily_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_refs" (
    "productId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "buyCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_refs_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "ingested_orders" (
    "orderId" UUID NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingested_orders_pkey" PRIMARY KEY ("orderId")
);

-- CreateIndex
CREATE INDEX "customer_product_purchases_customerId_idx" ON "customer_product_purchases"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_product_purchases_customerId_productId_key" ON "customer_product_purchases"("customerId", "productId");

-- CreateIndex
CREATE INDEX "product_co_buys_productId_idx" ON "product_co_buys"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_co_buys_productId_relatedProductId_key" ON "product_co_buys"("productId", "relatedProductId");

-- CreateIndex
CREATE INDEX "product_daily_sales_day_idx" ON "product_daily_sales"("day");

-- CreateIndex
CREATE UNIQUE INDEX "product_daily_sales_productId_depotId_day_key" ON "product_daily_sales"("productId", "depotId", "day");
