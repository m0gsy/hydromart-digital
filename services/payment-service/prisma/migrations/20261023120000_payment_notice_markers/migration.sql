-- RERUNNABLE: "already told" markers for the pending-payment reminder and the
-- paid-but-unconfirmed alert. Nullable and unread by this release: the sweeps that claim
-- them ship one release later, so no running code depends on a column that is not there.
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "reminderSentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "unconfirmedNotifiedAt" TIMESTAMP(3);
