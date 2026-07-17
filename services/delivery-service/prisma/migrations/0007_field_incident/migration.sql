-- 0007_field_incident
CREATE TYPE "IncidentCategory" AS ENUM ('ACCIDENT', 'VEHICLE_BREAKDOWN', 'THEFT_OR_THREAT', 'CUSTOMER_DISPUTE', 'PRODUCT_DAMAGE', 'OTHER');
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "field_incidents" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "deliveryId" UUID,
    "depotId" UUID,
    "category" "IncidentCategory" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "description" TEXT NOT NULL,
    "photoUrl" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_incidents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "field_incidents_driverId_createdAt_idx" ON "field_incidents"("driverId", "createdAt");
CREATE INDEX "field_incidents_depotId_createdAt_idx" ON "field_incidents"("depotId", "createdAt");
