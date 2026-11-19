-- Flow plan 5d: the emergency brake on the courier's one-tap check-in.
--
-- The Ops app reads this flag FAIL-CLOSED: the one tap that starts a shift AND records HR
-- attendance (face + GPS) runs only while the public flag route says this key is enabled.
-- OFF here — or no answer at all — sends every installed app back to the two separate
-- check-ins, with no release. The seed (prisma/seed.mjs) never runs in production, so the
-- row is created here.
--
-- ACTIVE because one tap is the owner's decision (2026-11-17); OFF is the brake, flipped in
-- the flags console (PATCH /feature-flags/:key).
--
-- RERUNNABLE: inserted only when the key is absent; a state set since is kept.
INSERT INTO "feature_flags" ("id", "key", "label", "description", "state", "rolloutPct", "updatedAt")
SELECT gen_random_uuid()::text, 'attendance.courier_one_tap', 'Check-in kurir satu tap',
       'Mulai shift sekaligus absen HR (wajah + GPS). OFF = dua check-in terpisah.', 'ACTIVE', NULL, NOW()
WHERE NOT EXISTS (SELECT 1 FROM "feature_flags" WHERE "key" = 'attendance.courier_one_tap');
