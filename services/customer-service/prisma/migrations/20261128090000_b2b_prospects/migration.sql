-- RERUNNABLE: AREA-1a (2026-11-28). B2B prospects (businesses a depot could sell gallons to).
-- New tables, so every index and unique is built here (empty, instant), not by scripts/create-indexes.sh.
-- b2b_do_not_contact holds only a keyed hash (HMAC) + kind + reason + date + who: nothing that identifies.
DO $$ BEGIN
  CREATE TYPE "B2bCategory" AS ENUM ('KOS','SEKOLAH','PESANTREN','TEMPAT_IBADAH','KLINIK','BENGKEL','SALON','KEBUGARAN','RUMAH_MAKAN','KANTOR_RUKO','LAUNDRY','PENGINAPAN','PABRIK_GUDANG');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "B2bProspectStatus" AS ENUM ('NEW','CONTACTED','VISITED','INTERESTED','CONVERTED','LOST','DO_NOT_CONTACT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "B2bSource" AS ENUM ('OVERTURE','OSM','FOURSQUARE_OS','INTERNAL','FIELD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "B2bOwnerSource" AS ENUM ('AUTO','HQ');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "B2bDncKind" AS ENUM ('PHONE','PLACE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "B2bDncReason" AS ENUM ('PROSPECT_REFUSED','CUSTOMER_REQUEST','WRONG_NUMBER','LEGAL','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "B2bVisitOutcome" AS ENUM ('MET_DECISION_MAKER','LEFT_MATERIAL','NOT_THERE','REFUSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "b2b_prospects" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "category" "B2bCategory" NOT NULL,
    "phoneE164" TEXT,
    "contactName" TEXT,
    "address" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "gridCell" TEXT NOT NULL,
    "kecamatanCode" TEXT,
    "kelurahanCode" TEXT,
    "ownerDepotId" UUID,
    "ownerSource" "B2bOwnerSource" NOT NULL DEFAULT 'AUTO',
    "status" "B2bProspectStatus" NOT NULL DEFAULT 'NEW',
    "assignedToId" UUID,
    "assignedAt" TIMESTAMP(3),
    "source" "B2bSource" NOT NULL,
    "licence" TEXT,
    "sourceId" TEXT,
    "sourceDataset" TEXT,
    "sourceDate" TIMESTAMP(3),
    "batchId" UUID,
    "customerId" UUID,
    "convertedAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "note" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "b2b_prospects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "b2b_prospect_visits" (
    "id" UUID NOT NULL,
    "prospectId" UUID NOT NULL,
    "visitorId" UUID NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyM" DOUBLE PRECISION NOT NULL,
    "distanceM" INTEGER NOT NULL,
    "outcome" "B2bVisitOutcome" NOT NULL,
    "note" TEXT,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "b2b_prospect_visits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "b2b_do_not_contact" (
    "id" UUID NOT NULL,
    "kind" "B2bDncKind" NOT NULL,
    "keyHash" TEXT NOT NULL,
    "reason" "B2bDncReason" NOT NULL,
    "addedById" UUID,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "b2b_do_not_contact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "b2b_import_batches" (
    "id" UUID NOT NULL,
    "sources" TEXT NOT NULL,
    "licences" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "created" INTEGER NOT NULL,
    "refused" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "costIdr" INTEGER NOT NULL DEFAULT 0,
    "importedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "b2b_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "b2b_prospects_phoneE164_key" ON "b2b_prospects"("phoneE164");
CREATE UNIQUE INDEX IF NOT EXISTS "b2b_prospects_source_sourceId_key" ON "b2b_prospects"("source", "sourceId");
CREATE INDEX IF NOT EXISTS "b2b_prospects_nameKey_idx" ON "b2b_prospects"("nameKey");
CREATE INDEX IF NOT EXISTS "b2b_prospects_ownerDepotId_status_idx" ON "b2b_prospects"("ownerDepotId", "status");
CREATE INDEX IF NOT EXISTS "b2b_prospects_assignedToId_status_idx" ON "b2b_prospects"("assignedToId", "status");
CREATE INDEX IF NOT EXISTS "b2b_prospects_kecamatanCode_category_idx" ON "b2b_prospects"("kecamatanCode", "category");
CREATE INDEX IF NOT EXISTS "b2b_prospects_lastActivityAt_idx" ON "b2b_prospects"("lastActivityAt");
CREATE INDEX IF NOT EXISTS "b2b_prospects_latitude_longitude_idx" ON "b2b_prospects"("latitude", "longitude");
CREATE INDEX IF NOT EXISTS "b2b_prospect_visits_prospectId_visitedAt_idx" ON "b2b_prospect_visits"("prospectId", "visitedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "b2b_do_not_contact_kind_keyHash_key" ON "b2b_do_not_contact"("kind", "keyHash");

DO $$ BEGIN
  ALTER TABLE "b2b_prospect_visits" ADD CONSTRAINT "b2b_prospect_visits_prospectId_fkey"
    FOREIGN KEY ("prospectId") REFERENCES "b2b_prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
