-- Who raised a refund that parked for HQ approval, so the queue can say "diajukan oleh X".
--
-- Owner decision 2026-10-14: the refund queue shows the requester WITHOUT blocking anything.
-- Today the requester is only in the audit trail, which lives in auth-service and cannot be
-- read per row from here without a round trip for every line of the queue.
--
-- NULLABLE for good: a refund under the HQ threshold settles directly and never parks, and
-- every row written before this column has no requester to report. No index — the queue is
-- already narrowed by `refundApproval`, and this is read per row it returns.
--
-- Written and nothing more in this release. The code that fills and shows it is the next one
-- (schema rule: a column ships one release before the code that reads it).

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "refundRequestedBy" TEXT;
