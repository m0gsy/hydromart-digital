-- HD-5: which legal entity employs each person, by date. One new table, empty: head office
-- enters it on /hq/legal-entities (owner decision 2026-11-22, nothing seeded). The legal
-- entities themselves live in depot-service; nothing existing changes.

-- CreateTable
CREATE TABLE "employee_legal_entities" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "recordedBy" UUID,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_legal_entities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_legal_entities_employeeId_effectiveFrom_key" ON "employee_legal_entities"("employeeId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "employee_legal_entities" ADD CONSTRAINT "employee_legal_entities_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

