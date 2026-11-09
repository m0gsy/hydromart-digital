-- RERUNNABLE: ADD COLUMN IF NOT EXISTS.
-- AAS-16: an export logged by the BROWSER (POST exports) carries a dataset and row count the client
-- typed; it is not evidence the way a server-made run is. Additive: false = produced/recorded by the
-- server, which is what every existing row is.
ALTER TABLE "export_logs" ADD COLUMN IF NOT EXISTS "clientReported" BOOLEAN NOT NULL DEFAULT false;
