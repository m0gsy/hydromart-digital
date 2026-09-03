// New user-facing strings for the customer design-fidelity batch (13n / 13b / 13e).
// Kept in its own fragment so parallel batches don't collide in id.ts / en.ts.
// Wire once: import + spread `customerFix` into dictionaries/id.ts and en.ts.
export const customerFix = {
  /** D3: a subscription whose address cannot be routed delivers nothing, silently. */
  subscriptionUnroutable: "Langganan ini belum bisa jalan: alamatnya belum punya titik peta. Buka alamat itu, tekan \"Gunakan lokasi saya\", lalu buat ulang langganannya.",
  /** I5: the customer's own gallon deposit — two numbers that lived only in the staff console. */
  gallonDeposit: {
    title: "Deposit galon",
    subtitle: "Galon yang masih Anda pegang dan deposit yang masih dititip di depot.",
    gallons: "{n} galon dipegang",
    held: "Deposit ditahan",
    empty: "Belum ada galon yang Anda pegang.",
    unavailable: "Belum tersambung — data deposit tidak bisa dibaca sekarang.",
    note: "Deposit kembali saat galon dikembalikan ke depot yang sama.",
  },
  address: {
    pinRequired: "Titik peta wajib diisi — tekan \"Gunakan lokasi saya\".",
  },
  depotOpen: {
    buka: "Buka",
    istirahat: "Istirahat",
    tutup: "Tutup",
  },
  favorite: {
    remove: "Hapus dari favorit",
    save: "Simpan ke favorit",
  },
  checkout: {
    agentPrice: "Harga agen Rp{amount}/galon",
    // A1: shown only when the cart came back `pricingBasis: 'CATALOG'` — nobody could tell
    // us the depot's own price, so these are catalog prices and the customer is told so
    // rather than left to find out at the receipt.
    catalogPricing: "Harga perkiraan — harga depot dipakai saat pesanan dibuat",
    belowMinimum: 'Minimum pesanan di depot ini Rp {min}. Kurang Rp {short} lagi.',
    methodUnavailable: '{method} tidak tersedia di depot ini. Metode bayar diganti — periksa sebelum memesan.',
    // SF-02: pencarian depot GAGAL (bukan "alamat di luar jangkauan"). Selama gagal, harga
    // di layar ini harga katalog, bukan harga depot yang akan menagih.
    depotLookupFailed:
      "Depot pengantar belum bisa ditentukan, jadi harga dan ongkir di layar ini masih harga katalog. Coba muat ulang sebelum memesan.",
    retryDepotLookup: "Coba lagi",
    resellerDiscount: "Harga reseller −{pct}%",
    defaultAddressLabel: "Alamat",
  },
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
    expressEta: 'Estimasi {min}–{max} menit',
    expressFee: '+{amount}',
    orSchedule: 'Atau jadwalkan',
    today: 'Hari ini',
    tomorrow: 'Besok',
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
