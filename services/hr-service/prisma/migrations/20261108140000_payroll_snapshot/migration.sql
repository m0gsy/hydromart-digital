-- RERUNNABLE: what the first generate read (wage, jabatan, PTKP), so regenerating a DRAFT
-- replays it instead of picking up a later raise (HR-06). Nullable and additive: a draft
-- written before this release has none and gets one on its next generate.
ALTER TABLE "payrolls" ADD COLUMN IF NOT EXISTS "snapshot" JSONB;
