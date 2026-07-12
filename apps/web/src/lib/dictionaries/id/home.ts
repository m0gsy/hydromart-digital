// Home area — Bahasa Indonesia (source of truth for keys). en/home.ts mirrors it.
export const home = {
  hero: {
    aria: 'Beranda',
    greeting: 'Halo, {name}.',
    titleGuest1: 'Air minum,',
    titleGuest2: 'diantar ke rumah.',
    titleUser2: 'Stok galonmu aman?',
    subtitle:
      'Galon isi ulang dan air botol dari depot terdekat. Pesan sekarang, kurir antar hari ini juga.',
    searchPlaceholder: 'Cari galon, botol, dispenser…',
    searchAria: 'Cari produk',
    searchButton: 'Cari',
    reorderTitle: 'Beli lagi',
    reorderSub: 'Ulangi pesanan · 1 ketuk',
    quick: {
      refill: 'Isi ulang galon',
      bottled: 'Air botol',
      dispenser: 'Dispenser',
    },
  },
  category: {
    aria: 'Kategori',
    title: 'Kategori',
  },
  activeOrder: {
    status: 'Pesanan #{orderNumber} sedang diantar',
    item: 'item',
    track: 'Lacak kurir',
  },
  rail: {
    reorder: 'Beli lagi',
    trending: 'Terlaris',
    addAria: 'Tambah {name} ke keranjang',
  },
  promo: {
    aria: 'Promo',
  },
  loyalty: {
    membership: 'Membership',
    balanceMeta: 'poin · diskon member {n}%',
    toNextPre: '{points} poin lagi menuju ',
    toNextPost: ' — diskon naik ke {n}%',
    maxTier: 'Anda sudah di tier tertinggi. Terima kasih!',
    viewRewards: 'Lihat rewards',
    guestTitle: 'Kumpulkan poin tiap pesan',
    guestBody: 'Jadi member dan dapatkan diskon makin besar seiring naik tier.',
    register: 'Daftar gratis',
  },
  depots: {
    aria: 'Depot terdekat',
    title: 'Depot terdekat',
    setLocation:
      'Atur lokasi untuk melihat depot terdekat dan cek apakah kami mengantar ke area Anda.',
    empty: 'Belum ada depot di sekitar lokasi ini.',
    deliveryFee: 'ongkir',
    outOfArea: 'Di luar area antar',
    eta: 'Antar ±30 mnt',
    sealed: 'Tersegel & resmi',
  },
  location: {
    unsupported: 'Perangkat tidak mendukung lokasi.',
    myLocation: 'Lokasi saya',
    near: 'Dekat {city}',
    denied: 'Tidak bisa mengakses lokasi. Izinkan akses atau pilih kota.',
    placeholder: 'Pilih lokasi pengiriman',
    searching: 'Mencari lokasi…',
    useMyLocation: 'Gunakan lokasi saya',
    orPickCity: 'Atau pilih kota depot',
    noDepots: 'Belum ada depot terdaftar.',
  },
};
