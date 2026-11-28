-- RERUNNABLE: WhatsApp number 1 (HD-12/HD-13), part 2: the outbound log/outbox and the inbound dedupe keys.
-- Schema only, no reader yet. New, empty tables: plain CREATE INDEX here, not through scripts/create-indexes.sh.

CREATE TABLE IF NOT EXISTS "wa_messages" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "customerId" TEXT,
    "phone" TEXT NOT NULL,
    "waNumber" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "vars" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "skipReason" TEXT,
    "metaMessageId" TEXT,
    "errorCode" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "monthKey" TEXT NOT NULL,
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "wa_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "wa_inbound_events" (
    "eventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wa_inbound_events_pkey" PRIMARY KEY ("eventKey")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_messages_dedupeKey_key" ON "wa_messages"("dedupeKey");

CREATE UNIQUE INDEX IF NOT EXISTS "wa_messages_metaMessageId_key" ON "wa_messages"("metaMessageId");

CREATE INDEX IF NOT EXISTS "wa_messages_status_createdAt_idx" ON "wa_messages"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "wa_messages_monthKey_category_idx" ON "wa_messages"("monthKey", "category");

CREATE INDEX IF NOT EXISTS "wa_messages_phone_createdAt_idx" ON "wa_messages"("phone", "createdAt");

CREATE INDEX IF NOT EXISTS "wa_inbound_events_receivedAt_idx" ON "wa_inbound_events"("receivedAt");
