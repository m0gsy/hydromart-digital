-- Rollback for 20260924100000_api_key_expiry. Keys stop expiring again.
ALTER TABLE "api_keys" DROP COLUMN IF EXISTS "expiresAt";
