-- A cashier's own note on a counter sale ("titip ke tetangga", "bayar sisanya besok").
-- Internal by design: it is deliberately NOT the delivery-address `notes` column, which the buyer sees
-- on their order detail. Nullable with no default, so it is invisible to the code now running.
ALTER TABLE "orders" ADD COLUMN "counterNote" TEXT;
