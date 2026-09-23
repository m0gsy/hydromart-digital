-- PRM-4: vouchers had no audience. A code "granted" to one customer was spendable by every
-- customer who learned it, and every wallet listed every active code — including the ones
-- meant for somebody else.
--
-- Default PUBLIC keeps campaign codes behaving exactly as they do today. The backfill below
-- is the actual fix for live data: a voucher that has ever been granted to somebody was, by
-- the act of granting it, meant for them.
ALTER TABLE "vouchers" ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'PUBLIC';

UPDATE "vouchers" v
   SET "audience" = 'GRANTED'
 WHERE EXISTS (SELECT 1 FROM "voucher_grants" g WHERE g."voucherId" = v."id");

-- PRM-8: releasing a voided order's voucher DELETED the redemption row, so the discount
-- actually burned and then returned could not be reconciled, and a replayed void decremented
-- the counter a second time. The row stays; the release is a timestamp on it.
ALTER TABLE "voucher_redemptions" ADD COLUMN "releasedAt" TIMESTAMP(3);
