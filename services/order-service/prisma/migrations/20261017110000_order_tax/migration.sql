-- FR-034: the PPN portion of an order total (prices shown to customers include PPN, so the total is unchanged).
ALTER TABLE "orders" ADD COLUMN "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "taxPercent" DECIMAL(5,2);
