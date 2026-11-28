-- RERUNNABLE: WhatsApp number 1 (HD-12/HD-13), part 3: monthly caps, cost counters, template approval state
-- and the AI web peer state. Schema only, no reader yet. New, empty tables: plain CREATE INDEX here, not through
-- scripts/create-indexes.sh. Deliberately NO default cap or rate rows: no row = no send, and nothing here knows a Meta price.

CREATE TABLE IF NOT EXISTS "wa_caps" (
    "waNumber" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "monthlyMessages" INTEGER NOT NULL,
    "rateIdr" DECIMAL(12,2),
    "monthlyCostIdr" DECIMAL(14,2),
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wa_caps_pkey" PRIMARY KEY ("waNumber","category")
);

CREATE TABLE IF NOT EXISTS "wa_cost_counters" (
    "waNumber" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "costIdr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "warnedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wa_cost_counters_pkey" PRIMARY KEY ("waNumber","monthKey","category")
);

CREATE TABLE IF NOT EXISTS "wa_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "event" TEXT,
    "category" TEXT NOT NULL,
    "bodyParams" INTEGER NOT NULL,
    "metaTemplateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "statusReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wa_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "wa_peer_state" (
    "peer" TEXT NOT NULL,
    "lastOkAt" TIMESTAMP(3) NOT NULL,
    "lastSeq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "wa_peer_state_pkey" PRIMARY KEY ("peer")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_templates_name_language_key" ON "wa_templates"("name", "language");
