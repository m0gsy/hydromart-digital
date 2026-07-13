-- 0008_gallon_returns
CREATE TYPE "GallonCondition" AS ENUM ('GOOD', 'DAMAGED');

CREATE TABLE "gallon_returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "depotId" UUID NOT NULL,
    "customerId" UUID,
    "quantity" INTEGER NOT NULL,
    "condition" "GallonCondition" NOT NULL DEFAULT 'GOOD',
    "depositRefunded" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gallon_returns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gallon_returns_depotId_createdAt_idx" ON "gallon_returns"("depotId", "createdAt");

ALTER TABLE "gallon_returns" ADD CONSTRAINT "gallon_returns_depotId_fkey"
    FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
