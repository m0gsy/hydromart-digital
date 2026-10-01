-- #34: an unguessable per-order key for the public "lacak pesanan" link.
--
-- Not `orderNumber` — that is sequential (HM-YYYYMMDD-NNNNNN) and a public route keyed on
-- it would be enumerable into every other customer's name, phone and address. Nullable:
-- every order placed before this column existed has no public link, not a broken one.
ALTER TABLE "orders" ADD COLUMN "trackingToken" TEXT;

-- Plain, not CONCURRENTLY (Prisma runs this inside a transaction). `orders` is large and
-- live, so the concurrent build happens first in scripts/create-indexes.sh; this statement
-- then finds the index already there (H-39).
CREATE UNIQUE INDEX IF NOT EXISTS "orders_trackingToken_key" ON "orders"("trackingToken");
