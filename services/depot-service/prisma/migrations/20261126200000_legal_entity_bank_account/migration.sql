-- HD-23: the official bank account partner bills tell a mitra to pay into. Nullable columns on an
-- existing table: no index, no backfill, nothing else reads them until a bill is approved.
ALTER TABLE "legal_entities"
  ADD COLUMN "bankName" TEXT,
  ADD COLUMN "bankAccountNumber" TEXT,
  ADD COLUMN "bankAccountHolder" TEXT;
