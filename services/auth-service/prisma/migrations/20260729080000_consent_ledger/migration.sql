-- UU PDP tahap 2 (item 13 follow-up): the consent ledger.
-- Append-only: one row per decision per purpose. purpose is TEXT, not an enum, so adding
-- a purpose later is a seed rather than an irreversible ALTER TYPE on a live database.
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customerId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "documentVersion" TEXT NOT NULL DEFAULT '1.0',
    "source" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "consent_records_customerId_purpose_recordedAt_idx"
    ON "consent_records" ("customerId", "purpose", "recordedAt");

-- Backfill: every existing account agreed to TERMS and PRIVACY at signup — the checkbox
-- gated registration, so the account's own existence is the evidence. Stamped with the
-- account's creation time, not now, and sourced as 'registration-backfill' so nobody
-- later mistakes an inferred row for one the customer clicked in a consent screen.
-- MARKETING is deliberately NOT backfilled: it was never asked, and "never asked" must
-- not be recorded as "agreed".
INSERT INTO "consent_records" ("id", "customerId", "purpose", "granted", "documentVersion", "source", "recordedAt")
SELECT gen_random_uuid(), c."id", p."purpose", true, '1.0', 'registration-backfill', c."createdAt"
FROM "customers" c
CROSS JOIN (VALUES ('TERMS'), ('PRIVACY')) AS p("purpose")
WHERE c."status" <> 'DELETED';
