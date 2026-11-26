-- HD-15B PR-4: supervisor visits, their copied checklist lines, findings and follow-ups.
-- Two NEW tables, so every index is built inline on an empty table (nothing locks, no rows exist).
-- indexes: visits_depotId_checkInAt_idx, visits_visitorId_status_idx, visits_visitorId_depotId_in_progress_key, visit_items_visitId_idx, visit_items_depotId_followUpDueOn_open_idx
-- The two partial indexes are hand-written (Prisma cannot express a WHERE): at most one IN_PROGRESS
-- visit per (visitorId, depotId), and the open-follow-up lookup that overdue queries use.
DO $$ BEGIN
  CREATE TYPE "VisitStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "VisitItemResult" AS ENUM ('PENDING', 'PASS', 'FINDING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'DONE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "visits" (
  "id"               UUID             NOT NULL DEFAULT gen_random_uuid(),
  "depotId"          UUID             NOT NULL,
  "templateId"       UUID,
  "templateName"     TEXT             NOT NULL,
  "visitorId"        UUID             NOT NULL,
  "status"           "VisitStatus"    NOT NULL DEFAULT 'IN_PROGRESS',
  "checkInAt"        TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checkInLat"       DOUBLE PRECISION NOT NULL,
  "checkInLng"       DOUBLE PRECISION NOT NULL,
  "checkInAccuracyM" DOUBLE PRECISION,
  "checkInDistanceM" INTEGER,
  "approximateFix"   BOOLEAN          NOT NULL DEFAULT false,
  "fenceChecked"     BOOLEAN          NOT NULL,
  "completedAt"      TIMESTAMP(3),
  "photoUploads"     INTEGER          NOT NULL DEFAULT 0,
  CONSTRAINT "visits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "visits_depotId_fkey" FOREIGN KEY ("depotId")
    REFERENCES "depots"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "visit_items" (
  "id"                  UUID              NOT NULL DEFAULT gen_random_uuid(),
  "visitId"             UUID              NOT NULL,
  "depotId"             UUID              NOT NULL,
  "position"            INTEGER           NOT NULL,
  "text"                TEXT              NOT NULL,
  "sopId"               UUID,
  "sopVersionId"        UUID,
  "sopVersionNo"        INTEGER,
  "sopTitle"            TEXT,
  "result"              "VisitItemResult" NOT NULL DEFAULT 'PENDING',
  "findingNote"         TEXT,
  "photoKey"            TEXT,
  "followUpDueOn"       DATE,
  "followUpStatus"      "FollowUpStatus",
  "followUpDoneAt"      TIMESTAMP(3),
  "followUpDoneBy"      UUID,
  "followUpNote"        TEXT,
  "lastOverdueNoticeAt" TIMESTAMP(3),
  CONSTRAINT "visit_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "visit_items_visitId_fkey" FOREIGN KEY ("visitId")
    REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- A finding is only a finding with its note, its photo and its follow-up.
  CONSTRAINT "visit_items_finding_complete_chk" CHECK (
    "result" <> 'FINDING' OR (
      "findingNote" IS NOT NULL AND "photoKey" IS NOT NULL
      AND "followUpDueOn" IS NOT NULL AND "followUpStatus" IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS "visits_depotId_checkInAt_idx" ON "visits"("depotId", "checkInAt");
CREATE INDEX IF NOT EXISTS "visits_visitorId_status_idx" ON "visits"("visitorId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "visits_visitorId_depotId_in_progress_key"
  ON "visits"("visitorId", "depotId") WHERE "status" = 'IN_PROGRESS';
CREATE INDEX IF NOT EXISTS "visit_items_visitId_idx" ON "visit_items"("visitId");
CREATE INDEX IF NOT EXISTS "visit_items_depotId_followUpDueOn_open_idx"
  ON "visit_items"("depotId", "followUpDueOn") WHERE "result" = 'FINDING' AND "followUpStatus" = 'OPEN';
