// Bahasa Indonesia — default locale + source of truth for the key shape.
// Shared chrome (nav/account/common) lives inline; each screen area is a
// fragment under ./id/*. en.ts mirrors this exact shape (type Dictionary).
import { home } from './id/home';
import { shop } from './id/shop';
import { order } from './id/order';
import { profile } from './id/profile';
import { auth } from './id/auth';

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
  home,
  shop,
  order,
  profile,
  auth,
};

export type Dictionary = typeof id;
