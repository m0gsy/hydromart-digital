-- HD-15B PR-3: checklist templates head office writes for supervisor visits.
-- Two NEW tables, so their indexes are built inline (nothing is locked, no rows exist yet).
-- indexes: visit_template_items_templateId_position_idx
CREATE TABLE IF NOT EXISTS "visit_templates" (
  "id"        UUID         NOT NULL DEFAULT gen_random_uuid(),
  "name"      TEXT         NOT NULL,
  "active"    BOOLEAN      NOT NULL DEFAULT true,
  "createdBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visit_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "visit_template_items" (
  "id"         UUID    NOT NULL DEFAULT gen_random_uuid(),
  "templateId" UUID    NOT NULL,
  "position"   INTEGER NOT NULL,
  "text"       TEXT    NOT NULL,
  "sopId"      UUID,
  CONSTRAINT "visit_template_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "visit_template_items_templateId_fkey" FOREIGN KEY ("templateId")
    REFERENCES "visit_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "visit_template_items_templateId_position_idx"
  ON "visit_template_items"("templateId", "position");
