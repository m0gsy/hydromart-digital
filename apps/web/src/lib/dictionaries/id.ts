// Bahasa Indonesia — default locale. Keys are dot-addressed (e.g. t('nav.shop')).
// Add keys per screen as it's rebuilt; en.ts must mirror this shape.
export const id = {
  nav: {
    home: 'Beranda',
    shop: 'Belanja',
    orders: 'Pesanan',
    account: 'Akun',
    cart: 'Keranjang',
    signIn: 'Masuk',
    ops: 'Operasi',
  },
  account: {
    title: 'Akun',
    profile: 'Profil',
    orders: 'Pesanan saya',
    addresses: 'Alamat',
    rewards: 'Rewards & poin',
    ops: 'Dashboard operasi',
    language: 'Bahasa',
    logout: 'Keluar',
    guestTitle: 'Masuk ke akunmu',
    guestBody: 'Masuk untuk melihat pesanan, alamat, dan poin rewards-mu.',
  },
  common: {
    back: 'Kembali',
    retry: 'Coba lagi',
    loading: 'Memuat…',
    somethingWrong: 'Ada yang tidak beres',
  },
};

export type Dictionary = typeof id;
