-- Employee personal files (KTP, KK, contract, …). Replacing a document inserts a new row and
-- stamps the old one superseded, so the history of what HR held is never overwritten.
CREATE TYPE "EmployeeDocumentType" AS ENUM (
  'KTP', 'KK', 'CONTRACT', 'NPWP', 'CERTIFICATE', 'OTHER'
);

CREATE TABLE "employee_documents" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "employeeId"     UUID NOT NULL,
  "type"           "EmployeeDocumentType" NOT NULL,
  "fileUrl"        TEXT NOT NULL,
  -- The storage key, kept so a retention purge can delete the object itself. Dropping only
  -- the row would leave the KTP scan in the bucket.
  "fileKey"        TEXT NOT NULL,
  "mimeType"       TEXT NOT NULL,
  "sizeBytes"      INTEGER NOT NULL,
  "version"        INTEGER NOT NULL DEFAULT 1,
  "supersededById" UUID,
  "uploadedBy"     UUID,
  "expiresAt"      DATE,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "employee_documents_employeeId_idx" ON "employee_documents"("employeeId");
CREATE INDEX "employee_documents_employeeId_type_idx"
  ON "employee_documents"("employeeId", "type");

ALTER TABLE "employee_documents"
  ADD CONSTRAINT "employee_documents_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
