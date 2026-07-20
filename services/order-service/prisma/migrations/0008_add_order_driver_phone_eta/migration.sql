-- Snapshot the assigned courier's phone (at DRIVER_ASSIGNED) and the customer-facing
-- ETA (at ON_DELIVERY, set by delivery-service) onto the order so order tracking can
-- render a call-the-driver link and a real arrival estimate without a cross-service
-- lookup. Additive + nullable: existing orders stay valid (null = not yet assigned/started).
ALTER TABLE "orders" ADD COLUMN "driverPhone" TEXT;
ALTER TABLE "orders" ADD COLUMN "estimatedArrivalAt" TIMESTAMP(3);
