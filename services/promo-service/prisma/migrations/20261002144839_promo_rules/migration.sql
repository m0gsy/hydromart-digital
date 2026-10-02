-- CreateEnum
CREATE TYPE "PromoKind" AS ENUM ('SPECIAL_PRICE', 'BUY_X_GET_Y', 'SHIPPING_DISCOUNT');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('APP', 'COUNTER');

-- DropIndex
DROP INDEX "vouchers_depotId_idx";

-- CreateTable
CREATE TABLE "promo_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PromoKind" NOT NULL,
    "depotId" TEXT,
    "productId" TEXT,
    "categoryId" TEXT,
    "specialPrice" INTEGER,
    "buyQty" INTEGER,
    "getQty" INTEGER,
    "shippingFeeOverride" INTEGER,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "startTime" TEXT,
    "endTime" TEXT,
    "minQty" INTEGER NOT NULL DEFAULT 1,
    "maxQty" INTEGER,
    "channels" "SalesChannel"[] DEFAULT ARRAY[]::"SalesChannel"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_applications" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "promoRuleId" TEXT NOT NULL,
    "productId" TEXT,
    "discountValue" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promo_rules_active_depotId_idx" ON "promo_rules"("active", "depotId");

-- CreateIndex
CREATE INDEX "promo_applications_orderId_idx" ON "promo_applications"("orderId");

-- AddForeignKey
ALTER TABLE "promo_applications" ADD CONSTRAINT "promo_applications_promoRuleId_fkey" FOREIGN KEY ("promoRuleId") REFERENCES "promo_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
