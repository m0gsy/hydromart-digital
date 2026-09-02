-- CA-3-07 and CA-3-53: two datasets we really do hold, and neither had a window.
--
-- `payment_proof` — the photo a customer uploads to prove a transfer. It sat in the
-- bucket forever: nothing purged it, and the privacy policy did not mention it existed.
-- The payment ROW is a financial record and stays for ten years; a photo of a bank app
-- showing a name and an account number is not what tax law asks anyone to keep. Owner
-- decision 2026-09-02: 12 months, the same window as proof of delivery.
--
-- `franchise_applications_rejected` — name, WhatsApp number and a GPS pin submitted
-- through the public /waralaba form by somebody we then told no. Approved applications
-- are the paper trail of how a depot came to exist and are NOT covered here; a pending
-- one has not been decided, so no clock has started on it. Owner decision 2026-09-02:
-- 24 months from the decision.
--
-- RERUNNABLE: ON CONFLICT DO NOTHING, so a retried deploy is a no-op rather than an error.
INSERT INTO "retention_policies" ("id", "dataset", "windowLabel", "windowDays", "dataClass", "updatedAt")
VALUES
  (
    '11111111-0000-4000-a000-000000000007',
    'payment_proof',
    '12 bulan sejak pembayaran (foto bukti transfer)',
    365,
    'OPERATIONAL',
    NOW()
  ),
  (
    '11111111-0000-4000-a000-000000000008',
    'franchise_applications_rejected',
    '24 bulan sejak ditolak (pengajuan waralaba)',
    730,
    'OPERATIONAL',
    NOW()
  )
ON CONFLICT ("dataset") DO NOTHING;
