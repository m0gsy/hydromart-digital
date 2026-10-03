-- CreateIndex
CREATE UNIQUE INDEX "promo_applications_orderId_promoRuleId_productId_key" ON "promo_applications"("orderId", "promoRuleId", "productId");
