-- 0006_no_show_reschedule
-- Contact attempts (design 5a no-show gate) + reschedule fields (design 3c).

CREATE TYPE "ContactMethod" AS ENUM ('CALL', 'WHATSAPP');

ALTER TABLE "deliveries" ADD COLUMN "rescheduledFor" TIMESTAMP(3);
ALTER TABLE "deliveries" ADD COLUMN "rescheduleSlot" TEXT;
ALTER TABLE "deliveries" ADD COLUMN "rescheduleNote" TEXT;

CREATE TABLE "contact_attempts" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "method" "ContactMethod" NOT NULL DEFAULT 'CALL',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contact_attempts_deliveryId_idx" ON "contact_attempts"("deliveryId");

ALTER TABLE "contact_attempts" ADD CONSTRAINT "contact_attempts_deliveryId_fkey"
    FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
