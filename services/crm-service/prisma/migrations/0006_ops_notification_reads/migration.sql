-- Per-staff read receipts for the operational notification feed (PRD 10d). The
-- `notifications` audit trail stays append-only and shared across the ops centre, so
-- read state is a separate row per staff member.

-- CreateTable
CREATE TABLE "ops_notification_reads" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_notification_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ops_notification_reads_notificationId_staffId_key" ON "ops_notification_reads"("notificationId", "staffId");

-- CreateIndex
CREATE INDEX "ops_notification_reads_staffId_idx" ON "ops_notification_reads"("staffId");

-- AddForeignKey
ALTER TABLE "ops_notification_reads" ADD CONSTRAINT "ops_notification_reads_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
