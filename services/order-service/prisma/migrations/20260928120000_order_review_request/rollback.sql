-- Rollback for 20260928120000_order_review_request.
--
-- Drops the column. The only thing lost is WHICH orders were already asked to be rated; the
-- ratings themselves live in order_reviews and are untouched. Without the column the sweep
-- (rolled back with it) does not run, so nothing is asked twice.
ALTER TABLE "orders" DROP COLUMN "reviewRequestedAt";
