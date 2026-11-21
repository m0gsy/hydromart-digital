-- Rollback of 20261121120000_face_shadow_samples. LOSSY: the shadow samples go with the table.
-- They are a 30-day measurement aid for the local face threshold, not a record anything reads
-- back as truth; the shadow comparisons go on being logged without the table.
DROP TABLE IF EXISTS "face_shadow_samples";
