-- Rollback for 0010_depot_payment_info.
-- LOSSY: each depot's bank account details and QRIS image URL are discarded. Payment is
-- direct-to-depot, so customers lose the only instructions telling them where to pay.
ALTER TABLE "depots" DROP COLUMN IF EXISTS "paymentQrisImageUrl";
ALTER TABLE "depots" DROP COLUMN IF EXISTS "paymentBankAccountHolder";
ALTER TABLE "depots" DROP COLUMN IF EXISTS "paymentBankAccountNumber";
ALTER TABLE "depots" DROP COLUMN IF EXISTS "paymentBankName";
