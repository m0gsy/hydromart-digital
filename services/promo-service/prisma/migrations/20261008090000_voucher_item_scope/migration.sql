-- RERUNNABLE: both statements are ADD COLUMN IF NOT EXISTS, so a retry after a deploy that
-- died mid-migrate is a no-op rather than a hand-resolved failure.
--
-- Item 5 (B): a voucher can be limited to ONE product or ONE category. The discount is then
-- worked out on the matching lines only, instead of on the whole order.
--
-- Both NULL is what every existing row is and means "whole order", exactly as before. Old
-- code ignores the columns, so the rebuild window with a mix of old and new images is safe.
ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "productId" TEXT;
ALTER TABLE "vouchers" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
