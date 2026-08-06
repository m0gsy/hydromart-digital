-- Rollback for 20260716120000_add_customer_avatar.
-- LOSSY: every customer's uploaded avatar URL is discarded. The objects stay in the
-- bucket; nothing in the database will point at them again.
ALTER TABLE "customers" DROP COLUMN IF EXISTS "avatarUrl";
