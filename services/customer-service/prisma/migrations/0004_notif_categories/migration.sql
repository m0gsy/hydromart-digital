-- Fine-grained per-app notification category mutes (design 7b courier toggles).
-- Empty object = all categories on (matches the all-on default everywhere else).
ALTER TABLE "notification_preferences"
  ADD COLUMN "categories" JSONB NOT NULL DEFAULT '{}';
