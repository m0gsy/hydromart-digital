-- 0011_franchise_applications
CREATE TYPE "FranchiseAppStage" AS ENUM ('PENDING', 'DOC_VERIFICATION', 'SURVEY', 'APPROVED', 'REJECTED');

CREATE TABLE "franchise_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "applicantName" TEXT NOT NULL,
    "applicantPhone" TEXT NOT NULL,
    "proposedCode" TEXT NOT NULL,
    "proposedName" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "investmentAmount" DECIMAL(14,2) NOT NULL,
    "projectedMonthlyRevenue" DECIMAL(14,2) NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '{}',
    "stage" "FranchiseAppStage" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "franchise_applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "franchise_applications_stage_submittedAt_idx" ON "franchise_applications"("stage", "submittedAt");
