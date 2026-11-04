CREATE TABLE "voided_referral_orders" (
  "referralId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "voided_referral_orders_pkey" PRIMARY KEY ("referralId", "orderId")
);
