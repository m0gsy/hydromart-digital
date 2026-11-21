-- RERUNNABLE: face shadow samples (owner decision 2026-11-21). The local engine's answer beside
-- NEO's, one row per sampled punch, kept 30 days. Container logs died with every deploy, so the
-- two weeks of shadow data the local threshold waits for never accumulated (39 samples on 11-21).
CREATE TABLE IF NOT EXISTS "face_shadow_samples" (
  "id" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "neoScore" DOUBLE PRECISION NOT NULL,
  "neoMatched" BOOLEAN NOT NULL,
  -- Null unless the local engine produced a score.
  "localScore" DOUBLE PRECISION,
  -- scored | no-template | no-face | bad-image | failed
  "outcome" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "face_shadow_samples_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "face_shadow_samples_createdAt_idx" ON "face_shadow_samples" ("createdAt");
