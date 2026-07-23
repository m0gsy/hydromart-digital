// New user-facing strings for the customer design-fidelity batch (13n / 13b / 13e).
// Kept in its own fragment so parallel batches don't collide in id.ts / en.ts.
// Wire once: import + spread `customerFix` into dictionaries/id.ts and en.ts.
export const customerFix = {
  // 13n — voucher not eligible (checkout)
  voucher: {
    shortfall: 'Belanja lagi {amount} agar berlaku',
    addProduct: 'Tambah produk',
    usableNow: 'Bisa dipakai sekarang',
    use: 'Pakai',
    min: 'Min. belanja {min}',
    shortBy: 'kurang {amount}',
  },
  // 13b — delivery slot (checkout)
  slot: {
    expressNow: 'Antar sekarang',
    expressEta: 'Estimasi 30–60 menit',
    expressFee: '+{amount}',
    orSchedule: 'Atau jadwalkan',
    today: 'Hari ini',
    tomorrow: 'Besok',
    capFull: 'Penuh',
    capLow: 'Hampir penuh',
    selected: 'dipilih',
    periodMorning: 'Pagi',
    periodNoon: 'Siang',
    periodAfternoon: 'Sore',
    periodEvening: 'Malam',
    feeNote: 'Biaya antar sekarang ditambahkan saat depot mengonfirmasi.',
  },
  // 13e — promo / campaign landing
  promo: {
    heroBadgeEnds: 'Berakhir {date}',
    endsIn: 'Berakhir dalam',
    ended: 'Promo berakhir',
    shopPromo: 'Belanja promo',
    terms: 'Syarat & ketentuan',
    claimVouchers: 'Klaim kode voucher',
    copy: 'Salin',
    copied: 'Tersalin',
    promoProducts: 'Produk promo',
    viewAll: 'Lihat semua',
    badge: 'Promo',
    empty: 'Belum ada promo aktif. Cek lagi nanti.',
    dayLabel: 'Hari',
    hourLabel: 'Jam',
    minLabel: 'Menit',
    secLabel: 'Detik',
    heroFallbackTitle: 'Promo Hydromart',
    heroFallbackSubtitle: 'Diskon galon isi ulang, gratis ongkir, dan bonus poin untuk pelanggan setia.',
    term1: 'Promo berlaku untuk pengguna terdaftar selama periode kampanye.',
    term2: 'Kode voucher tidak dapat digabung dalam satu transaksi.',
    term3: 'Gratis ongkir berlaku sesuai minimal belanja dari depot terdekat.',
    term4: 'Kuota terbatas; Hydromart dapat mengubah ketentuan sewaktu-waktu.',
  },
};
