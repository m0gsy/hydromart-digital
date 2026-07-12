import { PrismaClient } from './generated/client';

const prisma = new PrismaClient();

// Redeemable reward catalog for the /rewards "Tukar poin" grid (FR-015). Config
// data curated by marketing, upserted by name so re-running the seed is idempotent.
const rewardItems = [
  { name: 'Isi Ulang Galon 19L', unit: 'gratis 1 galon', pointsCost: 800, stock: null, active: true },
  { name: 'Voucher Rp 25.000', unit: 'potongan belanja', pointsCost: 2000, stock: null, active: true },
  { name: 'Gratis Ongkir', unit: 'sekali antar', pointsCost: 500, stock: null, active: true },
  { name: 'Tutup Galon + Segel', unit: 'isi 10', pointsCost: 1200, stock: 50, active: true },
  { name: 'Dispenser Galon Manual', unit: 'per unit', pointsCost: 4500, stock: 20, active: true },
];

async function main(): Promise<void> {
  for (const item of rewardItems) {
    const existing = await prisma.rewardItem.findFirst({ where: { name: item.name } });
    if (existing) {
      await prisma.rewardItem.update({ where: { id: existing.id }, data: item });
    } else {
      await prisma.rewardItem.create({ data: item });
    }
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded ${rewardItems.length} reward items.`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
