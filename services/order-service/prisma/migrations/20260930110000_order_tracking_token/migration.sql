-- #34: an unguessable per-order key for the public "lacak pesanan" link.
--
-- Not `orderNumber` — that is sequential (HM-YYYYMMDD-NNNNNN) and a public route keyed on
-- it would be enumerable into every other customer's name, phone and address. Nullable:
-- every order placed before this column existed has no public link, not a broken one.
ALTER TABLE "orders" ADD COLUMN "trackingToken" TEXT;

-- The unique index is NOT built here, and deliberately not registered in
-- scripts/create-indexes.sh in this same release either — see that file's header comment
-- (order_disputes_customerId_idx / cashbook_entries_reversesId_key) for why: that script
-- runs BEFORE migrations, so an index on a column this same migration is adding fails with
-- "column does not exist". It arrives in a later migration once `trackingToken` is
-- confirmed live. Until then, the token is 128 bits of randomness (randomBytes(16) in
-- OrderService.newTrackingToken) — a collision is not a realistic risk for one release.

