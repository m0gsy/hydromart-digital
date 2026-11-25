-- HD-16 PR-1: SOP documents, their immutable versions, the depots a version covers, and the
-- "sudah dibaca" acknowledgements (written by PR-2). Four new empty tables: nothing existing
-- changes.
--
-- indexes: sop_versions_sopId_versionNo_key, sop_versions_sopId_effectiveFrom_idx, sop_version_depots_depotId_idx, sop_acks_versionId_employeeId_key, sop_acks_employeeId_idx

-- CreateTable
CREATE TABLE IF NOT EXISTS "sops" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sops_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sop_versions" (
    "id" UUID NOT NULL,
    "sopId" UUID NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "fileKey" TEXT,
    "fileName" TEXT,
    "sizeBytes" INTEGER,
    "effectiveFrom" DATE NOT NULL,
    "allDepots" BOOLEAN NOT NULL DEFAULT false,
    "audienceSize" INTEGER NOT NULL DEFAULT 0,
    "publishedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sop_versions_pkey" PRIMARY KEY ("id"),
    -- A version says something: text, a PDF, or both.
    CONSTRAINT "sop_versions_body_or_file_chk" CHECK ("body" IS NOT NULL OR "fileKey" IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS "sop_version_depots" (
    "versionId" UUID NOT NULL,
    "depotId" UUID NOT NULL,

    CONSTRAINT "sop_version_depots_pkey" PRIMARY KEY ("versionId","depotId")
);

CREATE TABLE IF NOT EXISTS "sop_acks" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "ackedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sop_acks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (every table is new and empty, so a plain CREATE INDEX takes no meaningful lock)
CREATE UNIQUE INDEX IF NOT EXISTS "sop_versions_sopId_versionNo_key" ON "sop_versions"("sopId", "versionNo");
CREATE INDEX IF NOT EXISTS "sop_versions_sopId_effectiveFrom_idx" ON "sop_versions"("sopId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "sop_version_depots_depotId_idx" ON "sop_version_depots"("depotId");
CREATE UNIQUE INDEX IF NOT EXISTS "sop_acks_versionId_employeeId_key" ON "sop_acks"("versionId", "employeeId");
CREATE INDEX IF NOT EXISTS "sop_acks_employeeId_idx" ON "sop_acks"("employeeId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "sop_versions" ADD CONSTRAINT "sop_versions_sopId_fkey" FOREIGN KEY ("sopId") REFERENCES "sops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "sop_version_depots" ADD CONSTRAINT "sop_version_depots_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "sop_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "sop_acks" ADD CONSTRAINT "sop_acks_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "sop_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "sop_acks" ADD CONSTRAINT "sop_acks_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
