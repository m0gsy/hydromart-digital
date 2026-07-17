-- 0004_courier_shift
CREATE TYPE "ShiftStatus" AS ENUM ('ONLINE', 'BREAK', 'OFFLINE', 'ENDED');

CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'ONLINE',
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkInLat" DOUBLE PRECISION NOT NULL,
    "checkInLng" DOUBLE PRECISION NOT NULL,
    "expectedEndAt" TIMESTAMP(3) NOT NULL,
    "checkOutAt" TIMESTAMP(3),
    "checkOutLat" DOUBLE PRECISION,
    "checkOutLng" DOUBLE PRECISION,
    "breakSecondsUsed" INTEGER NOT NULL DEFAULT 0,
    "breakStartedAt" TIMESTAMP(3),

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shifts_driverId_checkInAt_idx" ON "shifts"("driverId", "checkInAt");
CREATE INDEX "shifts_depotId_status_idx" ON "shifts"("depotId", "status");
