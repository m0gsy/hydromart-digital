-- HD-5: legal entities (Indowater, Kelola, each franchise partner), the dated record of which
-- one each depot belongs to, and the role x legal entity matrix that limits ONLY the AI web and
-- the AI read API. Three new tables, empty: head office enters the entities (owner decision
-- 2026-11-22, nothing seeded). Nothing existing changes.

-- CreateEnum
CREATE TYPE "LegalEntityKind" AS ENUM ('FRANCHISOR', 'OPERATOR', 'FRANCHISEE');

-- CreateTable
CREATE TABLE "legal_entities" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LegalEntityKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID,
    "updatedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depot_legal_entities" (
    "id" UUID NOT NULL,
    "depotId" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "recordedBy" UUID,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depot_legal_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_entity_ai_grants" (
    "legalEntityId" UUID NOT NULL,
    "roleKey" TEXT NOT NULL,
    "grantedBy" UUID,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_entity_ai_grants_pkey" PRIMARY KEY ("legalEntityId","roleKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "depot_legal_entities_depotId_effectiveFrom_key" ON "depot_legal_entities"("depotId", "effectiveFrom");

-- The name is unique ignoring case (the service stores it trimmed, inner spaces collapsed).
-- Prisma cannot declare an index on an expression, so it lives only here; the repository turns a
-- clash into 409 LEGAL_ENTITY_NAME_TAKEN.
CREATE UNIQUE INDEX "legal_entities_lower_name_key" ON "legal_entities"(lower("name"));

-- AddForeignKey
ALTER TABLE "depot_legal_entities" ADD CONSTRAINT "depot_legal_entities_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depot_legal_entities" ADD CONSTRAINT "depot_legal_entities_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_entity_ai_grants" ADD CONSTRAINT "legal_entity_ai_grants_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

