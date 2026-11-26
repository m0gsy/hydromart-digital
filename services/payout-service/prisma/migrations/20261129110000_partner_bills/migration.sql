-- HD-23: the monthly royalty bill per franchisee legal entity.
-- New tables, so their indexes are plain and ride in this migration (create-indexes.sh only
-- carries indexes on tables that already hold rows).
CREATE TYPE "PartnerBillStatus" AS ENUM ('DRAFT', 'SENT', 'VOID');

CREATE TABLE "partner_bills" (
  "id" UUID NOT NULL,
  "legalEntityId" UUID NOT NULL,
  "legalEntityName" TEXT NOT NULL,
  "month" TEXT NOT NULL,
  "status" "PartnerBillStatus" NOT NULL DEFAULT 'DRAFT',
  "totalIdr" DECIMAL(14,0) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedBy" UUID,
  "approvedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "bankName" TEXT,
  "bankAccountNumber" TEXT,
  "bankAccountHolder" TEXT,
  "recipientIds" UUID[],
  CONSTRAINT "partner_bills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "partner_bill_lines" (
  "id" UUID NOT NULL,
  "billId" UUID NOT NULL,
  "depotId" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "amountIdr" DECIMAL(14,0) NOT NULL,
  "basis" JSONB NOT NULL,
  CONSTRAINT "partner_bill_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_bill_lines_billId_fkey" FOREIGN KEY ("billId") REFERENCES "partner_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "partner_bills_month_status_idx" ON "partner_bills" ("month", "status");
CREATE INDEX "partner_bill_lines_billId_idx" ON "partner_bill_lines" ("billId");
-- One live bill per entity and month: a rerun cannot double-bill, and a voided month can be made again.
CREATE UNIQUE INDEX "partner_bills_one_live_per_entity_month"
  ON "partner_bills" ("legalEntityId", "month") WHERE "status" <> 'VOID';
