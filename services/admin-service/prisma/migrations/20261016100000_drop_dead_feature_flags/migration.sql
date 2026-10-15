-- No feature sits behind `payments.virtual_account` or `delivery.live_tracking`: there is
-- no Virtual Account payment and no live courier tracking in this platform, so the toggles
-- on /hq/flags governed nothing and invited an operator to believe they did.
--
-- Idempotent: deleting rows that are already gone is a no-op.
-- RERUNNABLE: pure DELETE keyed on the two flag keys.
DELETE FROM "feature_flags"
WHERE "key" IN ('payments.virtual_account', 'delivery.live_tracking');
