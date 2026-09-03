-- RERUNNABLE: the only statement is ADD COLUMN IF NOT EXISTS, so a retry after a deploy
-- that died mid-migrate is a no-op rather than a hand-resolved failure.
--
-- CA-2-65: approving a depot's voucher request created a NETWORK-WIDE voucher.
--
-- `VoucherRequest` carries `depotId` and `depotName` — a depot manager proposes a voucher
-- for their own area and head office approves it. `Voucher` had no depot column at all, so
-- the approval created a code every customer in the network could spend, funded by the
-- depot that asked for one promo on their own street. The request remembered which depot;
-- the voucher it produced forgot.
--
-- NULL means network-wide, which is what every voucher created from the HQ form is and
-- what every existing row already is. Old code ignores the column, so the rebuild window
-- during which some services still run the previous image is safe.
ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "depotId" TEXT;

-- The redemption path filters on it for every quote, and a depot promo is exactly the kind
-- that gets used hard for a week.
CREATE INDEX IF NOT EXISTS "vouchers_depotId_idx" ON "vouchers" ("depotId");
