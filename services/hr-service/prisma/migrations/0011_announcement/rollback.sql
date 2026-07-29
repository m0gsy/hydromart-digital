-- Rollback 0011_announcement. Children first (both reference announcements), then the enums —
-- Postgres refuses to drop a type a live column still uses.
--
-- Read receipts go with it. Who acknowledged which notice is not recorded anywhere else.
DROP TABLE IF EXISTS "announcement_reads";
DROP TABLE IF EXISTS "announcement_targets";
DROP TABLE IF EXISTS "announcements";

DROP TYPE IF EXISTS "AnnouncementDimension";
DROP TYPE IF EXISTS "AnnouncementLevel";
