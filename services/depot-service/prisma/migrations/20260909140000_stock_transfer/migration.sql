-- CA-2-54: stock moving between two depots.
--
-- The only way stock could enter a depot was a purchase order to a supplier, so the
-- transfer everyone already does in practice — on a motorbike, between two depots two
-- streets apart — had no record at all. It surfaced as a shortfall in one book and an
-- unexplained surplus in the other.
--
-- Two steps, because a transfer is not instantaneous: SENT deducts the sender, RECEIVED
-- credits the receiver, and what sits between the two is visible as in transit.

-- RERUNNABLE: enum values are additive and guarded, so a re-applied migration is a no-op.
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StockTransferStatus') THEN
    CREATE TYPE "StockTransferStatus" AS ENUM ('SENT', 'RECEIVED', 'CANCELLED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "stock_transfers" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "reference"    TEXT NOT NULL,
  "fromDepotId"  UUID NOT NULL,
  "toDepotId"    UUID NOT NULL,
  "productId"    UUID NOT NULL,
  "label"        TEXT NOT NULL,
  "unit"         TEXT NOT NULL,
  "quantity"     INTEGER NOT NULL,
  "status"       "StockTransferStatus" NOT NULL DEFAULT 'SENT',
  "note"         TEXT,
  "sentBy"       UUID NOT NULL,
  "sentAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedBy"   UUID,
  "receivedAt"   TIMESTAMP(3),
  "cancelReason" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_transfers_reference_key" ON "stock_transfers"("reference");
-- Both queues are read the same way: "what is coming to me", "what did I send".
CREATE INDEX IF NOT EXISTS "stock_transfers_toDepotId_status_sentAt_idx"
  ON "stock_transfers"("toDepotId", "status", "sentAt");
CREATE INDEX IF NOT EXISTS "stock_transfers_fromDepotId_status_sentAt_idx"
  ON "stock_transfers"("fromDepotId", "status", "sentAt");

-- RESTRICT, not CASCADE: a depot with transfers in its history cannot be deleted out from
-- under them, because the other depot's book still refers to this movement.
ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_fromDepotId_fkey"
  FOREIGN KEY ("fromDepotId") REFERENCES "depots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_toDepotId_fkey"
  FOREIGN KEY ("toDepotId") REFERENCES "depots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
