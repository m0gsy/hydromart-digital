-- CreateTable
CREATE TABLE "depot_daily_revenue" (
    "id" UUID NOT NULL,
    "depotId" UUID,
    "day" DATE NOT NULL,
    "revenue" INTEGER NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "depot_daily_revenue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_activity" (
    "customerId" UUID NOT NULL,
    "depotId" UUID,
    "lastOrderAt" TIMESTAMP(3) NOT NULL,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_activity_pkey" PRIMARY KEY ("customerId")
);

-- CreateIndex
CREATE INDEX "depot_daily_revenue_day_idx" ON "depot_daily_revenue"("day");

-- CreateIndex
CREATE UNIQUE INDEX "depot_daily_revenue_depotId_day_key" ON "depot_daily_revenue"("depotId", "day");

-- CreateIndex
CREATE INDEX "customer_activity_depotId_lastOrderAt_idx" ON "customer_activity"("depotId", "lastOrderAt");
