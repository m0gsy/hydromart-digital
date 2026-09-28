-- A counter sale now remembers who rang it up.
--
-- The till already answered "whose drawer is this cash in" through the cashier shift, but the
-- order itself carried no cashier, so nothing could say how much each cashier SOLD — only how
-- much cash they were holding. Both columns are nullable and additive: every delivery order,
-- and every counter sale written before this column, stays NULL and reports under "not
-- recorded" rather than being attributed to somebody who did not ring it.
--
-- `cashierLabel` is a snapshot of what the shift screen shows for that person (their phone, or
-- their subject when the token has none) — the access token carries no display name, and a
-- report that prints a bare UUID is a report nobody reads.
ALTER TABLE "orders" ADD COLUMN "cashierId" TEXT;
ALTER TABLE "orders" ADD COLUMN "cashierLabel" TEXT;
