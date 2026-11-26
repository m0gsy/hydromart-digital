// Give every existing address that has a pin its kecamatan / kelurahan code (HD-20a).
//
//   node scripts/backfill-address-regions.mjs --dry-run
//   node scripts/backfill-address-regions.mjs
//
// New and moved pins get their codes at write time (AddressService); this is the one-off for the
// pins that were saved before. Run it after `npm run build -w @hydromart/customer-service` (it
// uses the service's own RegionLookup, so the precision rule is the live one, not a copy).
//
//   * only rows with a pin and no kecamatanCode yet are looked at, so it is idempotent and a
//     re-run after a boundary update only fills what is still empty;
//   * a pin too coarse for a level (GPS accuracy over 1000 m / 250 m) leaves that level null;
//   * batched (500 rows, keyset on id), one UPDATE per row that actually gets a code;
//   * --dry-run counts and writes nothing. Run it first and read the numbers.
//
// Env: CUSTOMER_DATABASE_URL  customer-service Postgres (required)
import { PrismaClient } from '../services/customer-service/prisma/generated/client/index.js';
import { RegionLookup } from '../services/customer-service/dist/src/infrastructure/geo/region-lookup.js';

const DRY_RUN = process.argv.includes('--dry-run');
for (const a of process.argv.slice(2)) {
  if (a !== '--dry-run') {
    console.error(`unknown argument: ${a} (the only flag is --dry-run)`);
    process.exit(2);
  }
}
if (!process.env.CUSTOMER_DATABASE_URL) {
  console.error('CUSTOMER_DATABASE_URL is required.');
  process.exit(1);
}
const BATCH = 500;

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: process.env.CUSTOMER_DATABASE_URL } } });
  const lookup = new RegionLookup();
  const n = { looked: 0, kelurahan: 0, kecamatanOnly: 0, none: 0 };
  try {
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const rows = await db.address.findMany({
        where: { id: { gt: after }, latitude: { not: null }, longitude: { not: null }, kecamatanCode: null },
        orderBy: { id: 'asc' },
        take: BATCH,
        select: { id: true, latitude: true, longitude: true, pinSource: true, pinAccuracyM: true },
      });
      if (rows.length === 0) break;
      after = rows[rows.length - 1].id;
      for (const r of rows) {
        n.looked += 1;
        const c = lookup.codesFor(r.latitude, r.longitude, r.pinSource, r.pinAccuracyM);
        if (!c.kecamatanCode) {
          n.none += 1;
          continue;
        }
        if (c.kelurahanCode) n.kelurahan += 1;
        else n.kecamatanOnly += 1;
        if (!DRY_RUN) {
          // kecamatanCode: null in the where keeps a concurrent write (a fresh pin) from being overwritten.
          await db.address.updateMany({ where: { id: r.id, kecamatanCode: null }, data: c });
        }
      }
    }
    console.log(
      `${n.looked} alamat berpin tanpa kode wilayah: ${n.kelurahan} dapat kecamatan + kelurahan, ` +
        `${n.kecamatanOnly} hanya kecamatan, ${n.none} tanpa kode (di luar DKI/Jabar/Banten atau pin terlalu kasar).`,
    );
    if (DRY_RUN) console.log('--dry-run: tidak ada yang ditulis.');
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
