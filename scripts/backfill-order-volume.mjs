// Fill the litres that were never snapshotted onto old order lines.
//
//   node scripts/backfill-order-volume.mjs --dry-run
//   node scripts/backfill-order-volume.mjs
//
// Why this exists
// ---------------
// The meter reconciliation reads `volumeMl` off the ORDER LINE, not off the live catalog:
// the line is a snapshot of what was sold, so a later catalog restatement (19L -> 19.2L)
// cannot silently rewrite what past days reconcile to. That is the right design, and it
// has one consequence — lines written before a product carried a volume stay NULL forever,
// land in `unmeasuredLines`, and leave every old day's water-vs-sales difference lopsided.
//
// Filling a NULL is not rewriting history: NULL is the absence of a measurement, not a
// measurement of zero. A line that already carries a number is left ALONE — that one is a
// real snapshot, including where the catalog has changed since.
//
// What it does
// ------------
//   1. reads product volumes from product-service (id -> volumeMl)
//   2. fills order line volumeMl where it IS NULL and the product has a volume
//   3. writes ONE history note per affected order, so a reconciliation that later looks odd
//      can be traced to "these litres were filled in afterwards" instead of being taken for
//      original data
//
// Products that genuinely have no volume (accessories, empty gallons) stay NULL and keep
// counting as `unmeasuredLines`. That is correct, not missing data.
//
// Nothing is recomputed: `reconcile()` is derived at read time, so every past day is right
// the moment the rows are filled. Alerts already sent are left alone — rewriting a warning
// history is not what a backfill is for.
//
// Uses each service's own generated Prisma client rather than a raw driver: no new
// dependency, and the column names come from the same schema the services use.
//
// Env:
//   ORDER_DATABASE_URL    order-service Postgres (required)
//   PRODUCT_DATABASE_URL  product-service Postgres (required)
import { PrismaClient as OrderClient } from '../services/order-service/prisma/generated/client/index.js';
import { PrismaClient as ProductClient } from '../services/product-service/prisma/generated/client/index.js';

const DRY_RUN = process.argv.includes('--dry-run');

if (!process.env.ORDER_DATABASE_URL || !process.env.PRODUCT_DATABASE_URL) {
  console.error('ORDER_DATABASE_URL and PRODUCT_DATABASE_URL are both required.');
  process.exit(1);
}

async function main() {
  const products = new ProductClient({
    datasources: { db: { url: process.env.PRODUCT_DATABASE_URL } },
  });
  const orders = new OrderClient({
    datasources: { db: { url: process.env.ORDER_DATABASE_URL } },
  });

  try {
    const withVolume = await products.product.findMany({
      where: { volumeMl: { gt: 0 } },
      select: { id: true, volumeMl: true },
    });
    const volumes = new Map(withVolume.map((p) => [p.id, p.volumeMl]));
    console.log(`${volumes.size} produk punya volume di katalog.`);
    if (volumes.size === 0) {
      console.log('Tidak ada yang bisa diisi. Isi kolom ml di /hq/catalog dulu.');
      return;
    }

    const gaps = await orders.orderItem.findMany({
      where: { volumeMl: null },
      select: { id: true, orderId: true, productId: true, order: { select: { status: true } } },
    });
    const fillable = gaps.filter((g) => volumes.has(g.productId));
    console.log(`${gaps.length} baris tanpa volume; ${fillable.length} bisa diisi.`);
    if (gaps.length > fillable.length) {
      console.log(
        `${gaps.length - fillable.length} baris tetap kosong (produknya memang tidak punya volume).`,
      );
    }
    if (fillable.length === 0 || DRY_RUN) {
      if (DRY_RUN) console.log('--dry-run: tidak ada yang ditulis.');
      return;
    }

    // Grouped so each order gets ONE note that says how many of its lines were filled.
    const byOrder = new Map();
    for (const row of fillable) {
      const entry = byOrder.get(row.orderId) ?? { status: row.order.status, lines: 0 };
      entry.lines += 1;
      byOrder.set(row.orderId, entry);
    }

    // One transaction: half-filled lines plus no note would be the worst outcome — the
    // numbers would move and nothing would say why.
    await orders.$transaction([
      ...fillable.map((row) =>
        orders.orderItem.update({
          where: { id: row.id },
          data: { volumeMl: volumes.get(row.productId) },
        }),
      ),
      ...[...byOrder].map(([orderId, entry]) =>
        orders.orderStatusHistory.create({
          data: {
            orderId,
            status: entry.status,
            changedBy: 'backfill-order-volume',
            note: `Volume ${entry.lines} baris diisi mundur dari katalog (bukan snapshot asli)`,
          },
        }),
      ),
    ]);

    console.log(`Selesai: ${fillable.length} baris di ${byOrder.size} order diisi dan ditandai.`);
  } finally {
    await products.$disconnect();
    await orders.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
