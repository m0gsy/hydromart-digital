-- COD cash-tendered + change-given, recorded at confirm time (design 7a).
ALTER TABLE "payments" ADD COLUMN "cashReceived" DECIMAL(12, 2);
ALTER TABLE "payments" ADD COLUMN "changeGiven" DECIMAL(12, 2);
