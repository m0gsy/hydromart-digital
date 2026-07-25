-- CreateTable
CREATE TABLE "reseller_profiles" (
    "customerId" UUID NOT NULL,
    "homeDepotId" UUID NOT NULL,
    "monthlyTargetQty" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "joinDate" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reseller_profiles_pkey" PRIMARY KEY ("customerId")
);

-- CreateIndex
CREATE INDEX "reseller_profiles_homeDepotId_idx" ON "reseller_profiles"("homeDepotId");
