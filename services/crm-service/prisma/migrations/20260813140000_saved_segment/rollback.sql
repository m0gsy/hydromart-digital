-- Rollback for 20260813140000_saved_segment.
--
-- LOSSY: every saved segment is dropped. They are definitions, not history — nothing else
-- references them and no campaign loses its recipients — but whoever curated them will
-- have to rebuild each one by hand, which is the state this migration ended.
DROP TABLE IF EXISTS "saved_segments";
