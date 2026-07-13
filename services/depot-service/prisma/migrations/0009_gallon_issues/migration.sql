-- 0009_gallon_issues
CREATE TABLE "gallon_issues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "depotId" UUID NOT NULL,
    "customerId" UUID,
    "quantity" INTEGER NOT NULL,
    "depositHeld" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gallon_issues_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gallon_issues_depotId_createdAt_idx" ON "gallon_issues"("depotId", "createdAt");

ALTER TABLE "gallon_issues" ADD CONSTRAINT "gallon_issues_depotId_fkey"
    FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
