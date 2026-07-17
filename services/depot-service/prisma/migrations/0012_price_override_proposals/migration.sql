-- 0012_price_override_proposals
CREATE TYPE "PriceOverrideStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "price_override_proposals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "depotId" UUID NOT NULL,
    "depotName" TEXT NOT NULL,
    "productId" UUID NOT NULL,
    "productName" TEXT NOT NULL,
    "currentPrice" DECIMAL(12,2) NOT NULL,
    "adjustType" "PricingAdjustType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "status" "PriceOverrideStatus" NOT NULL DEFAULT 'PENDING',
    "proposedBy" UUID NOT NULL,
    "decidedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "price_override_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "price_override_proposals_status_createdAt_idx" ON "price_override_proposals"("status", "createdAt");
