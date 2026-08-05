-- Rollback for 0006_voucher_free_shipping.
--
-- ORDER-SENSITIVE. Postgres cannot drop a single value from an enum type, so any voucher
-- still typed FREE_SHIPPING has to be re-typed first, or the pre-migration code reads a
-- discountType its enum does not contain.
--
-- They are DEACTIVATED rather than converted: silently turning a free-shipping voucher into
-- a fixed or percentage discount would change what a customer was promised, and choosing
-- the amount is a business decision, not a migration's.
UPDATE "vouchers"
SET "active" = false, "discountType" = 'FIXED', "value" = 0
WHERE "discountType" = 'FREE_SHIPPING';

-- The unused 'FREE_SHIPPING' label is deliberately LEFT on the enum type; dropping a label
-- means recreating the type and rewriting every column that uses it, under a lock.
