-- Audit DB-4: back SLA aggregates that filter on deliveredAt (+ depot scope).
CREATE INDEX IF NOT EXISTS "deliveries_deliveredAt_idx" ON "deliveries"("deliveredAt");
CREATE INDEX IF NOT EXISTS "deliveries_depotId_deliveredAt_idx" ON "deliveries"("depotId", "deliveredAt");
