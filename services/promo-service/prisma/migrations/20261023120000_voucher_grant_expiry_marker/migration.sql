-- RERUNNABLE: "already told" marker for the voucher-expiring nudge. Nullable and unread by
-- this release: the sweep that claims it ships one release later.
ALTER TABLE "voucher_grants" ADD COLUMN IF NOT EXISTS "expiryNotifiedAt" TIMESTAMP(3);
