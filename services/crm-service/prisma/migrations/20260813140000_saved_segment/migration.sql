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
  -- Auth subject (staff user id) that saved it.
  "createdBy"  TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "saved_segments_pkey" PRIMARY KEY ("id"),
  -- Two segments with the same name are two people meaning the same audience and getting
  -- different ones. Declared INLINE rather than as a separate CREATE INDEX so there is no
  -- index statement here at all: create-indexes.sh runs BEFORE the migration and cannot
  -- build one on a table that does not exist yet (audit H-39's check is right to say so).
  CONSTRAINT "saved_segments_name_key" UNIQUE ("name")
);

-- ponytail: no index on createdAt. This list is human-curated and capped at 200 rows in
-- the service; sorting tens of rows needs no index, and one would be a statement the
-- concurrency rule then has to reason about for nothing.
