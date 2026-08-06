-- Rollback for 0004_voucher_requests.
-- LOSSY: every depot voucher request is deleted, including ones still PENDING a head-office
-- decision — those depots simply never hear back. Vouchers already created from an approved
-- request are NOT affected; they live in "vouchers".
DROP TABLE IF EXISTS "voucher_requests";
