-- 0002_commission_schemes
CREATE TABLE "commission_schemes" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "ownerName" TEXT,
    "pct" DECIMAL(5,2) NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "commission_schemes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "commission_schemes_depotId_effectiveDate_idx" ON "commission_schemes"("depotId", "effectiveDate");
