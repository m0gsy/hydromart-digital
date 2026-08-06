-- H-30: webhooks stop being a registry. Deliveries are recorded per endpoint per event,
-- with the attempt count and the next due time the sweep claims on, so a partner can see
-- what was sent and the endpoint's success rate is measured rather than left null.
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'DEAD');

CREATE TABLE "webhook_deliveries" (
  "id"             TEXT NOT NULL,
  "endpointId"     TEXT NOT NULL,
  "event"          TEXT NOT NULL,
  "payload"        JSONB NOT NULL,
  "status"         "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "responseStatus" INTEGER,
  "lastError"      TEXT,
  "occurredAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_deliveries_status_nextAttemptAt_idx"
  ON "webhook_deliveries" ("status", "nextAttemptAt");
CREATE INDEX "webhook_deliveries_endpointId_createdAt_idx"
  ON "webhook_deliveries" ("endpointId", "createdAt");

ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_endpointId_fkey"
  FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- An API key is authenticated by looking its hash up, so the hash must identify exactly
-- one key. Values are 32 bytes of randomness — no existing row can collide.
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys" ("keyHash");
