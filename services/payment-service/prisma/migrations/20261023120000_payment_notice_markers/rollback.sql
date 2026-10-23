-- Rolls back 20261023120000_payment_notice_markers.
-- Lossy only in the harmless direction: the "already told" stamps are forgotten, so a payment
-- whose reminder or unconfirmed alert already went out can be told once more after the
-- columns are re-added. No payment data is touched.
ALTER TABLE "payments"
  DROP COLUMN IF EXISTS "reminderSentAt",
  DROP COLUMN IF EXISTS "unconfirmedNotifiedAt";
