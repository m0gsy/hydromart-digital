-- Depot broadcasts (design 8a): in-app operational announcements pushed by depot ops to
-- every courier at a depot, with per-courier read receipts. Distinct from customer campaigns.

-- CreateEnum
CREATE TYPE "BroadcastLevel" AS ENUM ('INFO', 'URGENT');

-- CreateTable
CREATE TABLE "depot_broadcasts" (
    "id" TEXT NOT NULL,
    "depotId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "level" "BroadcastLevel" NOT NULL DEFAULT 'INFO',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depot_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depot_broadcast_reads" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depot_broadcast_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "depot_broadcasts_depotId_createdAt_idx" ON "depot_broadcasts"("depotId", "createdAt");

-- CreateIndex
CREATE INDEX "depot_broadcast_reads_courierId_idx" ON "depot_broadcast_reads"("courierId");

-- CreateIndex
CREATE UNIQUE INDEX "depot_broadcast_reads_broadcastId_courierId_key" ON "depot_broadcast_reads"("broadcastId", "courierId");

-- AddForeignKey
ALTER TABLE "depot_broadcast_reads" ADD CONSTRAINT "depot_broadcast_reads_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "depot_broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
