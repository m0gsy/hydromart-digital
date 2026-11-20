-- Undoes 20261120190000_subscription_address_id.
--
-- LOSSY only for the link to the saved address: every plan keeps its own address snapshot
-- and goes on delivering to it.

ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "addressId";
