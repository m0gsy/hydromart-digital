// Seed the admin-service DB with starter feature flags and the singleton system settings.
// Idempotent: upserts on natural keys (flag `key`, settings id "singleton"). Requires the
// admin DB to be reachable via ADMIN_DATABASE_URL.
//
//   node prisma/seed.mjs
import { PrismaClient } from './generated/client/index.js';

const prisma = new PrismaClient();

const FLAGS = [
  { key: 'payments.virtual_account', label: 'Virtual Account payments', description: 'Per-bank VA at checkout', state: 'ROLLOUT', rolloutPct: 50 },
  { key: 'subscriptions.galon', label: 'Galon subscriptions', description: 'Scheduled automatic refills', state: 'BETA', rolloutPct: null },
  { key: 'recommendations.ai', label: 'AI recommendations', description: 'Product suggestions on the home feed', state: 'ACTIVE', rolloutPct: null },
  { key: 'delivery.live_tracking', label: 'Courier live tracking', description: 'Real-time courier position map', state: 'ACTIVE', rolloutPct: null },
  { key: 'payments.cash_on_delivery', label: 'Cash on delivery', description: 'COD at delivery time', state: 'OFF', rolloutPct: null },
];

async function main() {
  for (const f of FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: f.key },
      update: { label: f.label, description: f.description },
      create: f,
    });
  }
  await prisma.systemSetting.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton', defaultTimezone: 'Asia/Jakarta', currency: 'IDR', serviceRadiusKm: 5 },
  });

  // Fixed-id example rows for the integration/governance screens (13d/19c/13c/15c) so the
  // HQ pages have something to render before real traffic. Idempotent (upsert on id).
  // These are CLEARLY seed samples — not real credentials/deliveries.
  await prisma.apiKey.upsert({
    where: { id: '00000000-0000-4000-a000-0000000000a1' },
    update: {},
    create: {
      id: '00000000-0000-4000-a000-0000000000a1',
      name: 'Payment gateway (sample)',
      keyPrefix: 'hm_live_seed0001',
      keyHash: 'seed-placeholder-not-a-real-key',
      scopes: ['payments:read', 'payments:write'],
      environment: 'PROD',
    },
  });
  await prisma.webhookEndpoint.upsert({
    where: { id: '00000000-0000-4000-a000-0000000000b1' },
    update: {},
    create: {
      id: '00000000-0000-4000-a000-0000000000b1',
      url: 'https://partner.example.com/hooks',
      events: ['payment.settled', 'refund.approved'],
      active: true,
    },
  });
  await prisma.exportLog.upsert({
    where: { id: '00000000-0000-4000-a000-0000000000c1' },
    update: {},
    create: {
      id: '00000000-0000-4000-a000-0000000000c1',
      dataset: 'Pendapatan per depot',
      requestedByEmail: 'finance@hydromart.id',
      format: 'CSV',
      rowCount: 128,
      status: 'DONE',
    },
  });
  await prisma.scheduledReport.upsert({
    where: { id: '00000000-0000-4000-a000-0000000000d1' },
    update: {},
    create: {
      id: '00000000-0000-4000-a000-0000000000d1',
      name: 'Ringkasan pendapatan harian (sample)',
      cadence: 'DAILY',
      recipients: ['finance@hydromart.id'],
      format: 'XLSX',
      enabled: true,
    },
  });

  // Governance-ops sample rows (15a/15b/14c) so the HQ pages render before real traffic.
  // CLEARLY seed samples — not real tickets/flags/incidents. Idempotent (upsert on id).
  await prisma.supportTicket.upsert({
    where: { id: '00000000-0000-4000-a000-0000000000e1' },
    update: {},
    create: {
      id: '00000000-0000-4000-a000-0000000000e1',
      subject: 'Galon belum sampai (sample)',
      customerRef: 'Ibu Rina',
      customerPhone: '0812-0000-0001',
      orderRef: 'ORD-0231',
      priority: 'HIGH',
      status: 'OPEN',
      messages: {
        create: [
          { authorType: 'CUSTOMER', body: 'Halo, pesanan saya sudah 2 jam belum datang.' },
          { authorType: 'STAFF', body: 'Baik Bu, kami cek posisi kurir ya.' },
        ],
      },
    },
  });
  await prisma.fraudFlag.upsert({
    where: { id: '00000000-0000-4000-a000-0000000000f1' },
    update: {},
    create: {
      id: '00000000-0000-4000-a000-0000000000f1',
      entityType: 'ORDER',
      entityRef: 'ORD-0261',
      score: 88,
      level: 'HIGH',
      signals: ['Nilai jauh di atas rata-rata', 'Alamat baru', '3 voucher dalam 1 pesanan'],
      status: 'OPEN',
    },
  });
  await prisma.incident.upsert({
    where: { id: '00000000-0000-4000-a000-000000000101' },
    update: {},
    create: {
      id: '00000000-0000-4000-a000-000000000101',
      title: 'Latensi settlement tinggi (sample)',
      severity: 'CRITICAL',
      affectedService: 'payment-service',
      status: 'ONGOING',
      note: 'Investigating elevated settlement latency.',
      updates: { create: [{ note: 'Escalated to the payments on-call.' }] },
    },
  });

  console.log(`[seed] upserted ${FLAGS.length} feature flags + system settings + integration + governance-ops samples`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
