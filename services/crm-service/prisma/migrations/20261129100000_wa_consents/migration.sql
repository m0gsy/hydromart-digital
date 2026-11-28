-- RERUNNABLE: WhatsApp number 1 (HD-12/HD-13), part 1: the per-number consent ledger and the opt-in codes.
-- Schema only: nothing reads or writes these tables in this release (pending_migrations: schema ships one
-- release before its reader). New, empty tables, so the plain CREATE INDEX below costs nothing: they are
-- built here, not through scripts/create-indexes.sh (see the comment there).

CREATE TABLE IF NOT EXISTS "wa_consents" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "customerId" TEXT,
    "waNumber" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "legalEntity" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "textVersion" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "depotId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wa_consents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "wa_opt_in_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "customerId" TEXT,
    "depotId" TEXT,
    "createdBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wa_opt_in_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_consents_seq_key" ON "wa_consents"("seq");

CREATE INDEX IF NOT EXISTS "wa_consents_phone_purpose_recordedAt_idx" ON "wa_consents"("phone", "purpose", "recordedAt" DESC);

CREATE INDEX IF NOT EXISTS "wa_consents_customerId_purpose_recordedAt_idx" ON "wa_consents"("customerId", "purpose", "recordedAt" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "wa_consents_source_sourceRef_key" ON "wa_consents"("source", "sourceRef");

CREATE UNIQUE INDEX IF NOT EXISTS "wa_opt_in_codes_code_key" ON "wa_opt_in_codes"("code");

CREATE INDEX IF NOT EXISTS "wa_opt_in_codes_expiresAt_idx" ON "wa_opt_in_codes"("expiresAt");
