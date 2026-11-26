-- RERUNNABLE: HD-21a, the AI web CRM's depot drafts. A NEW table (indexes built inline, no rows yet)
-- plus two nullable columns on depots that the activation PR fills.
-- indexes: depot_drafts_prospectId_key, depot_drafts_depotId_key, depots_crmProspectId_key
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
  "ownerFullName"          TEXT             NOT NULL,
  "ownerPhoneE164"         TEXT             NOT NULL,
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

-- depots is small (one row per depot) and every new value is NULL, so the plain unique index is cheap.
ALTER TABLE "depots"
  ADD COLUMN IF NOT EXISTS "crmProspectId" UUID,
  ADD COLUMN IF NOT EXISTS "franchiseApplicationId" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "depots_crmProspectId_key" ON "depots"("crmProspectId");
