-- Rolls back 20261023120000_voucher_grant_expiry_marker.
-- Lossy only in the harmless direction: the "already nudged" stamps are forgotten. No grant
-- or voucher data is touched.
ALTER TABLE "voucher_grants" DROP COLUMN IF EXISTS "expiryNotifiedAt";
