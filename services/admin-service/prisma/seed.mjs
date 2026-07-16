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
  console.log(`[seed] upserted ${FLAGS.length} feature flags + system settings`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
