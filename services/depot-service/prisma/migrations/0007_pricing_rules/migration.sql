-- 0007_pricing_rules
CREATE TYPE "PricingAdjustType" AS ENUM ('PERCENT', 'FIXED');

CREATE TABLE "pricing_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "depotId" UUID NOT NULL,
    "productId" UUID,
    "adjustType" "PricingAdjustType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "daysOfWeek" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pricing_rules_depotId_idx" ON "pricing_rules"("depotId");
