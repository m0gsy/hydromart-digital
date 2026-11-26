-- RERUNNABLE: HD-21a, the AI web CRM's depot drafts. A NEW table (indexes built inline, no rows yet)
-- plus two nullable columns on depots that the activation PR fills.
-- indexes: depot_drafts_prospectId_key, depot_drafts_depotId_key
DO $$ BEGIN
  CREATE TYPE "DepotDraftStatus" AS ENUM ('DRAFT', 'ACTIVATED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "depot_drafts" (
  "id"                     UUID             NOT NULL DEFAULT gen_random_uuid(),
  "prospectId"             UUID             NOT NULL,
  "legacyApplicationId"    UUID,
  "proposedName"           TEXT             NOT NULL,
  "city"                   TEXT             NOT NULL,
  "province"               TEXT             NOT NULL,
  "ownerFullName"          TEXT,
  "ownerPhoneE164"         TEXT,
  "prospectusHandedOn"     VARCHAR(10)      NOT NULL,
  "agreementSignedOn"      VARCHAR(10)      NOT NULL,
  "prospectusSha256"       VARCHAR(64)      NOT NULL,
  "prospectusVersionLabel" TEXT             NOT NULL,
  "prospectusReceipt"      TEXT             NOT NULL,
  "checklist"              JSONB            NOT NULL,
  "requestHash"            VARCHAR(64)      NOT NULL,
  "suggestionId"           UUID             NOT NULL,
  "status"                 "DepotDraftStatus" NOT NULL DEFAULT 'DRAFT',
  "decisionNote"           TEXT,
  "decidedBy"              UUID,
  "decidedAt"              TIMESTAMP(3),
  "depotId"                UUID,
  "createdBy"              UUID             NOT NULL,
  "createdAt"              TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "depot_drafts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "depot_drafts_prospectId_key" ON "depot_drafts"("prospectId");
CREATE UNIQUE INDEX IF NOT EXISTS "depot_drafts_depotId_key" ON "depot_drafts"("depotId");

-- No index on depots.crmProspectId: depot_drafts.prospectId (one draft per prospect) and
-- depot_drafts.depotId (one depot per draft) already hold it, and lookups go through depot_drafts.
ALTER TABLE "depots"
  ADD COLUMN IF NOT EXISTS "crmProspectId" UUID,
  ADD COLUMN IF NOT EXISTS "franchiseApplicationId" UUID;

-- A depot cannot be deleted while a draft says it came from it.
DO $$ BEGIN
  ALTER TABLE "depot_drafts"
    ADD CONSTRAINT "depot_drafts_depotId_fkey" FOREIGN KEY ("depotId")
    REFERENCES "depots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
