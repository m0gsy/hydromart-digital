-- Face embeddings get a retention window of their own, far shorter than the rest of HR.
--
-- Biometric data cannot be reissued: a leaked face is leaked for life, unlike a password
-- or a phone number. Keeping it for the five years that an employment record needs is
-- impossible to justify when its only purpose — clocking someone in — ends the day they
-- leave. 30 days is a grace period for a mis-set status, not a retention need.
INSERT INTO "retention_policies" ("id", "dataset", "windowLabel", "windowDays", "dataClass", "updatedAt")
VALUES (
    '11111111-0000-4000-a000-000000000006',
    'hr_face_embeddings',
    '30 hari setelah berhenti (biometrik)',
    30,
    'HR',
    NOW()
)
ON CONFLICT ("dataset") DO NOTHING;
