-- RERUNNABLE: HD-6 H5 (decision 32), the stage history of franchise applications.
-- One row per stage an application entered. No foreign key and no personal data: a rejected
-- application is deleted after its retention window, and the count of how many came in and how
-- many were turned down must outlive it. No backfill: history starts when this ships.
CREATE TABLE IF NOT EXISTS "franchise_application_stage_events" (
  "id" UUID NOT NULL,
  "applicationId" UUID NOT NULL,
  "stage" "FranchiseAppStage" NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "franchise_application_stage_events_pkey" PRIMARY KEY ("id")
);
-- The summary reads the first PENDING row of each application: (stage, applicationId) finds them.
-- A table created by this migration: empty, so the plain build costs nothing (scripts/create-indexes.sh
-- skips it while the table is absent, as for the other new tables listed there).
CREATE INDEX IF NOT EXISTS "franchise_application_stage_events_stage_applicationId_idx"
  ON "franchise_application_stage_events"("stage", "applicationId");
