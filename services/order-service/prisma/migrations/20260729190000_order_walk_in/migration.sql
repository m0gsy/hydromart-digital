-- Counter sales: cash paid at the depot, goods handed over immediately, no courier.
ALTER TABLE "orders" ADD COLUMN "isWalkIn" BOOLEAN NOT NULL DEFAULT false;
