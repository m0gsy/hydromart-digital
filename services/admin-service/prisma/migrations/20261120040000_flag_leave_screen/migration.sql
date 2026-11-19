-- Flow plan 6a: the brake on the leave-request push opening the HR leave queue.
--
-- crm reads this flag FAIL-CLOSED (DestinationBrakesHttpAdapter): a new leave request's push
-- and inbox row open /hr/leave only while the public flag route says this key is enabled.
-- /hr/leave is pruned from the Ops APK up to v1.15.0, where the tap would land on a blank
-- screen, so the row is created OFF (owner decision 2026-11-19). Set it ACTIVE in the flags
-- console once the release that carries the screen (mobile-v1.16.0) is installed.
--
-- RERUNNABLE: ON CONFLICT on the unique key; a state set since is kept.
INSERT INTO "feature_flags" ("id", "key", "label", "description", "state", "rolloutPct", "updatedAt")
VALUES (gen_random_uuid()::text, 'notifications.leave_screen', 'Notifikasi cuti membuka layar cuti', 'Push pengajuan cuti membuka /hr/leave. Nyalakan (AKTIF) setelah APK Ops v1.16.0 terpasang; selain AKTIF = ke kotak notifikasi.', 'OFF', NULL, NOW())
ON CONFLICT ("key") DO NOTHING;
