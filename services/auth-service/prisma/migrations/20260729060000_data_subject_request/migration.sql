-- UU PDP tahap 1 (item 13): the data-subject request queue.
-- type/status are TEXT, not enums: adding consent-withdrawal later must not require an
-- irreversible ALTER TYPE on a live database.
CREATE TABLE "data_subject_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customerId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedBy" UUID,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "data_subject_requests_customerId_requestedAt_idx"
    ON "data_subject_requests" ("customerId", "requestedAt");

CREATE INDEX "data_subject_requests_status_requestedAt_idx"
    ON "data_subject_requests" ("status", "requestedAt");
