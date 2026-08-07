// Put every past customer into a depot's directory, from the depot they last bought at.
//
//   node scripts/backfill-favorite-depot.mjs --dry-run
//   node scripts/backfill-favorite-depot.mjs
//
// Why this exists
// ---------------
// §I asked for two halves. The first shipped: order-service now reports the fulfilling
// depot at checkout and customer-service records it as `favoriteDepotId` when there is
// none. That only ever fires on a customer's NEXT order, so somebody who has ordered from
// the same depot forty times and does not order again is still in nobody's directory.
//
// This is the other half: read what already happened and write it once.
//
// The rule is the same one the live path follows, deliberately:
//   * a profile that already names a depot is LEFT ALONE — the last depot to sell somebody
//     water must never steal them from the depot they belong to, and that includes this
//     script running months later;
//   * the depot written is the one on their MOST RECENT order, which is the closest thing
//     to "where they buy" the data actually holds;
//   * the anonymous counter sentinel is not a person and is skipped.
//
// Orders with no depot (the legacy unrouted tray) carry no answer, so they are skipped
// rather than guessed at.
//
// Uses each service's own generated Prisma client rather than a raw driver: no new
// dependency, and the column names come from the same schema the services use.
//
// Env:
//   ORDER_DATABASE_URL     order-service Postgres (required)
//   CUSTOMER_DATABASE_URL  customer-service Postgres (required)
import { PrismaClient as OrderClient } from '../services/order-service/prisma/generated/client/index.js';
import { PrismaClient as CustomerClient } from '../services/customer-service/prisma/generated/client/index.js';

const DRY_RUN = process.argv.includes('--dry-run');
const ANONYMOUS_CUSTOMER_ID = '00000000-0000-0000-0000-000000000000';

if (!process.env.ORDER_DATABASE_URL || !process.env.CUSTOMER_DATABASE_URL) {
  console.error('ORDER_DATABASE_URL and CUSTOMER_DATABASE_URL are both required.');
  process.exit(1);
}

async function main() {
  const orders = new OrderClient({
    datasources: { db: { url: process.env.ORDER_DATABASE_URL } },
  });
  const customers = new CustomerClient({
    datasources: { db: { url: process.env.CUSTOMER_DATABASE_URL } },
  });

  try {
    // DISTINCT ON is what makes this one pass instead of loading every order ever placed:
    // Postgres keeps the first row per customer in the ORDER BY, which is their latest.
    const latest = await orders.$queryRaw`
      SELECT DISTINCT ON ("customerId") "customerId", "depotId"
      FROM "orders"
      WHERE "depotId" IS NOT NULL
        AND "customerId" <> ${ANONYMOUS_CUSTOMER_ID}::uuid
      ORDER BY "customerId", "createdAt" DESC
    `;
    console.log(`${latest.length} pelanggan pernah pesan dari depot yang tercatat.`);
    if (latest.length === 0) return;

    const ids = latest.map((r) => r.customerId);
    const existing = await customers.customerProfile.findMany({
      where: { customerId: { in: ids } },
      select: { customerId: true, favoriteDepotId: true },
    });
    const claimed = new Set(
      existing.filter((p) => p.favoriteDepotId !== null).map((p) => p.customerId),
    );
    const pending = latest.filter((r) => !claimed.has(r.customerId));

    console.log(
      `${claimed.size} sudah punya depot (dibiarkan), ${pending.length} akan diisi mundur.`,
    );
    if (pending.length === 0 || DRY_RUN) {
      if (DRY_RUN) console.log('--dry-run: tidak ada yang ditulis.');
      return;
    }

    // upsert, not update: a customer who registered themselves and never opened a screen
    // that reads the profile has no row yet, and they are exactly who this is for.
    // One transaction — a half-filled directory that nobody can tell apart from a full one
    // is worse than none.
    await customers.$transaction(
      pending.map((row) =>
        customers.customerProfile.upsert({
          where: { customerId: row.customerId },
          create: { customerId: row.customerId, favoriteDepotId: row.depotId },
          update: { favoriteDepotId: row.depotId },
        }),
      ),
    );

    console.log(`Selesai: ${pending.length} pelanggan masuk direktori depotnya.`);
  } finally {
    await orders.$disconnect();
    await customers.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
