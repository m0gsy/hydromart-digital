-- HD-6 H2: "is this delivery's order listed by any settlement?" is asked per delivery (the
-- period's undeposited COD). `orderId = ANY(orderIds)` cannot use an index; `orderIds @> ARRAY[orderId]`
-- can, with a GIN index. Settlements are small (one courier shift each), so the build is quick, but
-- on production it is built CONCURRENTLY before the migration (scripts/create-indexes.sh, audit H-39).
CREATE INDEX IF NOT EXISTS "cash_settlements_orderIds_gin_idx" ON "cash_settlements" USING GIN ("orderIds");
