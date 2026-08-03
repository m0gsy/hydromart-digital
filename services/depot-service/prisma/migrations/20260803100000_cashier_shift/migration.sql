-- Cashier shifts: who was at the counter, what they started with, what they counted.

CREATE TYPE "CashierShiftStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "cashier_shifts" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "depotId"      UUID NOT NULL,
  "cashierId"    UUID NOT NULL,
  "cashierName"  TEXT NOT NULL,
  "status"       "CashierShiftStatus" NOT NULL DEFAULT 'OPEN',
  "openingFloat" INTEGER NOT NULL,
  "openedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt"     TIMESTAMP(3),
  "countedCash"  INTEGER,
  "expectedCash" INTEGER,
  "variance"     INTEGER,
  "note"         TEXT,

  CONSTRAINT "cashier_shifts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "cashier_shifts"
  ADD CONSTRAINT "cashier_shifts_depotId_fkey"
  FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "cashier_shifts_depotId_status_idx" ON "cashier_shifts" ("depotId", "status");
CREATE INDEX "cashier_shifts_cashierId_status_idx" ON "cashier_shifts" ("cashierId", "status");

-- One open shift per cashier per depot. Enforced in the database, not only in the
-- service: two open shifts would each claim the same drawer, and both would balance.
CREATE UNIQUE INDEX "cashier_shifts_one_open_per_cashier"
  ON "cashier_shifts" ("depotId", "cashierId")
  WHERE "status" = 'OPEN';
