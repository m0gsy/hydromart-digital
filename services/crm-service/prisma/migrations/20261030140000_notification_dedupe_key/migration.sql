-- RERUNNABLE: ADD COLUMN IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS.
-- A sender that can retry (an outbox row, a webhook redelivery) names the notification it is
-- sending with a key it derives from the EVENT ("voucher-grant:<id>"). The key and the row are one
-- write, so a retry cannot send the customer the same message twice. NULL = no key (every
-- existing row and every caller that does not send one); NULLs are distinct in a unique index,
-- so this constrains nothing that already exists.
-- Index name for scripts/check-index-concurrency.mjs: notifications_dedupeKey_key
-- Built here rather than in create-indexes.sh: the column is created by this very migration and
-- every value is NULL, so the build is instant.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupeKey_key" ON "notifications" ("dedupeKey");
