-- RERUNNABLE: HD-14, quality hold + lab tests + permits. Three NEW tables (indexes built inline,
-- no rows yet), so nothing here needs scripts/create-indexes.sh.
-- indexes: depot_quality_holds_depotId_startedAt_idx, depot_quality_holds_one_active_per_depot,
--          depot_lab_tests_depotId_takenOn_idx, depot_permits_depotId_validUntil_idx
DO $$ BEGIN CREATE TYPE "QualityHoldStatus" AS ENUM ('ACTIVE', 'ENDED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "QualityHoldReason" AS ENUM ('LAB_FAIL', 'PERMIT', 'COMPLAINT', 'OTHER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "LabTestKind" AS ENUM ('FISIK_MIKRO', 'KIMIA', 'ECOLI', 'LENGKAP'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "LabTestResult" AS ENUM ('PASS', 'FAIL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "depot_lab_tests" (
  "id"         UUID            NOT NULL DEFAULT gen_random_uuid(),
  "depotId"    UUID            NOT NULL,
  "kind"       "LabTestKind"   NOT NULL,
  "takenOn"    VARCHAR(10)     NOT NULL,
  "resultOn"   VARCHAR(10)     NOT NULL,
  "result"     "LabTestResult" NOT NULL,
  "labName"    TEXT            NOT NULL,
  "reportNo"   TEXT            NOT NULL,
  "recordedBy" UUID            NOT NULL,
  "createdAt"  TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "depot_lab_tests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "depot_lab_tests_depotId_takenOn_idx" ON "depot_lab_tests"("depotId", "takenOn");

CREATE TABLE IF NOT EXISTS "depot_permits" (
  "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
  "depotId"    UUID         NOT NULL,
  "kind"       TEXT         NOT NULL,
  "number"     TEXT         NOT NULL,
  "validUntil" VARCHAR(10)  NOT NULL,
  "recordedBy" UUID         NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "depot_permits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "depot_permits_depotId_validUntil_idx" ON "depot_permits"("depotId", "validUntil");

CREATE TABLE IF NOT EXISTS "depot_quality_holds" (
  "id"          UUID                NOT NULL DEFAULT gen_random_uuid(),
  "depotId"     UUID                NOT NULL,
  "status"      "QualityHoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "reasonCode"  "QualityHoldReason" NOT NULL,
  "note"        TEXT,
  "startedBy"   UUID                NOT NULL,
  "startedAt"   TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedBy"     UUID,
  "endedAt"     TIMESTAMP(3),
  "endRetestId" UUID,
  CONSTRAINT "depot_quality_holds_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "depot_quality_holds_depotId_startedAt_idx" ON "depot_quality_holds"("depotId", "startedAt");

-- One ACTIVE hold per depot, enforced in the database like the one-open-shift index: two racing
-- "start" calls cannot both win.
CREATE UNIQUE INDEX IF NOT EXISTS "depot_quality_holds_one_active_per_depot"
  ON "depot_quality_holds" ("depotId")
  WHERE "status" = 'ACTIVE';

DO $$ BEGIN
  ALTER TABLE "depot_lab_tests" ADD CONSTRAINT "depot_lab_tests_depotId_fkey"
    FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "depot_permits" ADD CONSTRAINT "depot_permits_depotId_fkey"
    FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "depot_quality_holds" ADD CONSTRAINT "depot_quality_holds_depotId_fkey"
    FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "depot_quality_holds" ADD CONSTRAINT "depot_quality_holds_endRetestId_fkey"
    FOREIGN KEY ("endRetestId") REFERENCES "depot_lab_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
