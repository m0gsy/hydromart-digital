-- Manual rollback for migration 0001_init.
-- Prisma applies migrations forward-only; run this by hand to undo the initial schema.
-- Order matters: drop dependent tables before their referenced tables, then enums.

DROP TABLE IF EXISTS "audit_logs";
DROP TABLE IF EXISTS "refresh_tokens";
DROP TABLE IF EXISTS "otp_tokens";
DROP TABLE IF EXISTS "customers";

DROP TYPE IF EXISTS "OtpPurpose";
DROP TYPE IF EXISTS "CustomerStatus";
DROP TYPE IF EXISTS "Role";
