-- Snapshot the routed depot on each delivery so SLA can be scoped per franchise.
-- Additive + nullable: existing deliveries stay valid (null = excluded from
-- depot-scoped SLA). See dashboard-service franchise dashboard (M-R3.x).
ALTER TABLE "deliveries" ADD COLUMN "depotId" UUID;

CREATE INDEX "deliveries_depotId_idx" ON "deliveries"("depotId");
