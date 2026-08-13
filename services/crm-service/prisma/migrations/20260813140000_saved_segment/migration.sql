-- "Buat segment" could build conditions, size them live, and hand them to the campaign
-- builder — but nothing could be saved, so the same audience had to be rebuilt by hand
-- every time somebody wanted to message it again.
--
-- The conditions are stored as JSON rather than as columns on purpose: they are the
-- SegmentFilter contract, which already grows (tier/city, then the activity half, then
-- named customerIds). A column per condition would mean a migration every time that
-- contract gains a field, and a row written under the old shape would still be missing it.
CREATE TABLE "saved_segments" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "conditions" JSONB NOT NULL,
  /// Auth subject (staff user id) that saved it.
  "createdBy"  TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "saved_segments_pkey" PRIMARY KEY ("id")
);

-- Two segments with the same name are two people meaning the same audience and getting
-- different ones. The list is short and human-curated, so uniqueness is affordable here.
CREATE UNIQUE INDEX "saved_segments_name_key" ON "saved_segments"("name");
CREATE INDEX "saved_segments_createdAt_idx" ON "saved_segments"("createdAt");
