import { PrismaClient } from './generated/client';

const prisma = new PrismaClient();

// Launch promotions for the customer Home page. Upserts by title so re-running
// the seed is idempotent.
const promotions = [
  {
    title: 'Gratis ongkir pertama',
    subtitle: 'Pesanan galon pertamamu, ongkir kami tanggung.',
    imageUrl: 'https://cdn.hydromart.id/promo/gratis-ongkir.jpg',
    ctaLabel: 'Pesan sekarang',
    ctaHref: '/catalog',
    voucherCode: 'ONGKIRGRATIS',
    sortOrder: 0,
    active: true,
  },
  {
    title: 'Langganan galon hemat',
    subtitle: 'Atur pengiriman rutin, harga lebih hemat tiap bulan.',
    imageUrl: 'https://cdn.hydromart.id/promo/langganan-hemat.jpg',
    ctaLabel: 'Mulai langganan',
    ctaHref: '/subscriptions',
    voucherCode: null,
    sortOrder: 1,
    active: true,
  },
];

async function main(): Promise<void> {
  for (const p of promotions) {
    const existing = await prisma.promotion.findFirst({ where: { title: p.title } });
    if (existing) {
      await prisma.promotion.update({ where: { id: existing.id }, data: p });
    } else {
      await prisma.promotion.create({ data: p });
    }
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded ${promotions.length} promotions.`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
