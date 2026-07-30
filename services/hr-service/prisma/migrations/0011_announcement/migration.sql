-- C1 Announcement Center. Targets OR together and may overlap on purpose; the dedup that
-- stops one person getting two notifications lives in domain/announcement.ts, not here.

CREATE TYPE "AnnouncementLevel" AS ENUM ('INFO', 'WARNING', 'URGENT');
-- The spec's fourth dimension is "ROLE". hr-service stores no auth role — those live in
-- auth-service — so what HR can actually target is the jabatan, employees."position".
CREATE TYPE "AnnouncementDimension" AS ENUM ('COMPANY', 'DEPOT', 'DEPARTMENT', 'POSITION', 'EMPLOYEE');

CREATE TABLE "announcements" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "title"        TEXT NOT NULL,
  "body"         TEXT NOT NULL,
  "level"        "AnnouncementLevel" NOT NULL DEFAULT 'INFO',
  "scheduledAt"  TIMESTAMP(3),
  "publishedAt"  TIMESTAMP(3),
  "audienceSize" INTEGER NOT NULL DEFAULT 0,
  "createdBy"    UUID,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "announcements_publishedAt_idx" ON "announcements"("publishedAt");
-- The sweep's lookup: unpublished rows whose schedule has come due.
CREATE INDEX "announcements_scheduledAt_idx" ON "announcements"("scheduledAt");

CREATE TABLE "announcement_targets" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "announcementId" UUID NOT NULL,
  "dimension"      "AnnouncementDimension" NOT NULL,
  "value"          TEXT,
  CONSTRAINT "announcement_targets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "announcement_targets_announcementId_idx" ON "announcement_targets"("announcementId");

ALTER TABLE "announcement_targets"
  ADD CONSTRAINT "announcement_targets_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "announcement_reads" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "announcementId" UUID NOT NULL,
  "employeeId"     UUID NOT NULL,
  "readAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("id")
);

-- Marking read twice is still one read; the unique index is what makes the upsert idempotent.
CREATE UNIQUE INDEX "announcement_reads_announcementId_employeeId_key"
  ON "announcement_reads"("announcementId", "employeeId");
CREATE INDEX "announcement_reads_employeeId_idx" ON "announcement_reads"("employeeId");

ALTER TABLE "announcement_reads"
  ADD CONSTRAINT "announcement_reads_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "announcement_reads"
  ADD CONSTRAINT "announcement_reads_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
