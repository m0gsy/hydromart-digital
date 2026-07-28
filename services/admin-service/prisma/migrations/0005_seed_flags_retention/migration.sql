-- Seed the two reference tables the console can only ever read.
--
-- Both hold a fixed set the product defines, not user-created rows: the retention windows
-- are the four datasets /hq/retention renders labels for, and the flags are the toggles
-- /hq/flags exposes. Neither table has (or should have) a create endpoint — the console
-- edits a window (PUT /retention/:id) or flips a state (PATCH /feature-flags/:key), so
-- without this seed both pages render their empty state on a fresh install.
--
-- Windows follow the retention statement in the privacy policy; adjust the window, never
-- delete the row, or the console loses the dataset entirely.
INSERT INTO "retention_policies" ("id", "dataset", "windowLabel", "windowDays", "updatedAt") VALUES
  ('11111111-0000-4000-a000-000000000001', 'orders_transactions',    '7 tahun (kewajiban pajak & akuntansi)', 2555, NOW()),
  ('11111111-0000-4000-a000-000000000002', 'audit_logs',             '2 tahun',                                730, NOW()),
  ('11111111-0000-4000-a000-000000000003', 'proof_of_delivery',      '1 tahun',                                365, NOW()),
  ('11111111-0000-4000-a000-000000000004', 'notifications_messages', '90 hari',                                 90, NOW())
ON CONFLICT ("dataset") DO NOTHING;

-- Flags describe surfaces that already ship; the state is recorded and shown, but note
-- that no service reads these values yet — flipping one changes the stored state, not
-- runtime behaviour. Wire a consumer before treating any of these as a kill switch.
INSERT INTO "feature_flags" ("id", "key", "label", "description", "state", "rolloutPct", "updatedAt") VALUES
  ('22222222-0000-4000-a000-000000000001', 'subscriptions',   'Langganan',            'Pesanan berulang terjadwal untuk pelanggan.',        'ACTIVE',  NULL, NOW()),
  ('22222222-0000-4000-a000-000000000002', 'reseller_pricing','Harga reseller',       'Potongan persen per reseller saat checkout.',        'ACTIVE',  NULL, NOW()),
  ('22222222-0000-4000-a000-000000000003', 'loyalty_rewards', 'Poin & hadiah',        'Akrual poin dan penukaran hadiah.',                  'ACTIVE',  NULL, NOW()),
  ('22222222-0000-4000-a000-000000000004', 'courier_broadcast','Siaran kurir',        'Pesan siaran dari depot ke kurir yang bertugas.',    'BETA',    NULL, NOW()),
  ('22222222-0000-4000-a000-000000000005', 'franchise_portal','Portal franchise',     'Ringkasan pendapatan & payout untuk pemilik.',       'ROLLOUT',   25, NOW())
ON CONFLICT ("key") DO NOTHING;
