-- Rollback for 20260822130000_order_status_changed_at_index.
-- NOT lossy: an index holds no data. Dropping it leaves the sweep correct and slow — it
-- would seq-scan `orders` on every tick, which is the shape audit Q-6 was written about.
DROP INDEX CONCURRENTLY IF EXISTS "orders_status_statusChangedAt_idx";
