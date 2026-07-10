-- Franchise-owner scoping: which account manages a depot. Null = unassigned / company-run.
-- Additive, nullable — existing rows stay unassigned until an owner is set.
ALTER TABLE "depots" ADD COLUMN "ownerId" UUID;

CREATE INDEX "depots_ownerId_idx" ON "depots"("ownerId");
