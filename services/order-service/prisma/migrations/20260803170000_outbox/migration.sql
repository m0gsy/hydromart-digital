-- H-10: durable outbox for order-completion side effects. Stock consume, loyalty award,
-- referral qualification and the franchise-owner credit were fire-and-forget HTTP calls
-- behind a swallowed catch; a downstream blip lost them permanently, with a log line as
-- the only trace. Rows are written in the same transaction as the status change that
-- earns them, and a sweep retries them with backoff.

CREATE TABLE "outbox_messages" (
  "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
  "topic"         TEXT         NOT NULL,
  "orderId"       UUID         NOT NULL,
  "status"        TEXT         NOT NULL DEFAULT 'PENDING',
  "attempts"      INTEGER      NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- One row per effect per order: re-running a completion cannot owe the same effect twice.
CREATE UNIQUE INDEX "outbox_messages_topic_orderId_key"
  ON "outbox_messages" ("topic", "orderId");

-- The claim predicate: PENDING rows whose backoff has elapsed.
CREATE INDEX "outbox_messages_status_nextAttemptAt_idx"
  ON "outbox_messages" ("status", "nextAttemptAt");
