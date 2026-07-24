CREATE TABLE "service_settings" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "depot_id" TEXT,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_settings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "service_settings_scope_depot_id_idx" ON "service_settings" ("scope", "depot_id");
-- One GLOBAL row per key; one DEPOT row per (depot,key). Partial indexes because
-- Postgres treats NULL depot_id as distinct under a plain composite unique.
CREATE UNIQUE INDEX "service_settings_global_key_key"
  ON "service_settings" ("key") WHERE "scope" = 'GLOBAL';
CREATE UNIQUE INDEX "service_settings_depot_key_key"
  ON "service_settings" ("depot_id", "key") WHERE "scope" = 'DEPOT';
