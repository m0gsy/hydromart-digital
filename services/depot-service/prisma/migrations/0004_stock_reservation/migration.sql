-- Reservation support: hold stock per order between checkout and completion (prevents oversell).
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED');

ALTER TABLE "inventory_items" ADD COLUMN "reserved" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_reservations_itemId_orderId_key" ON "stock_reservations"("itemId", "orderId");
CREATE INDEX "stock_reservations_itemId_idx" ON "stock_reservations"("itemId");

ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
