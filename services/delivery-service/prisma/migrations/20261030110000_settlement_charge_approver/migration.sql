-- RERUNNABLE: ADD COLUMN IF NOT EXISTS.
-- Who is approving a raised shortfall charge RIGHT NOW. Approving pushes the debit to payout
-- and only then resolves the settlement; two approvers, or an approver and a rejecter, could
-- all pass the pending check and the debit landed while the settlement said otherwise. The
-- approver now claims this column (compare-and-set on NULL) BEFORE the push and releases it if
-- the push fails. NULL = nobody is approving, which is every existing row, and correct.
-- No index: it is only ever read together with the row's id.
ALTER TABLE "cash_settlements" ADD COLUMN IF NOT EXISTS "chargeApprovedBy" UUID;
