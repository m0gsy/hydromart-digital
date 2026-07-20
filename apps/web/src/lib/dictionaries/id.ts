// Bahasa Indonesia — default locale + source of truth for the key shape.
// Shared chrome (nav/account/common) lives inline; each screen area is a
// fragment under ./id/*. en.ts mirrors this exact shape (type Dictionary).
import { home } from './id/home';
import { shop } from './id/shop';
import { order } from './id/order';
import { profile } from './id/profile';
import { auth } from './id/auth';
import { help } from './id/help';
import { notifications } from './id/notifications';
import { onboarding } from './id/onboarding';
import { review } from './id/review';
import { subscriptions } from './id/subscriptions';
import { ops } from './id/ops';
import { dashboard } from './id/dashboard';
import { dashA } from './id/dashA';
import { dashB } from './id/dashB';
import { dashC } from './id/dashC';
import { driver } from './id/driver';
import { hq } from './id/hq';
import { privacy } from './id/privacy';

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
    title: 'Akun & pengaturan',
    profile: 'Profil',
    orders: 'Pesanan saya',
    addresses: 'Alamat',
    rewards: 'Rewards & poin',
    ops: 'Dashboard operasi',
    language: 'Bahasa',
    logout: 'Keluar',
    guestTitle: 'Masuk ke akunmu',
    guestBody: 'Masuk untuk melihat pesanan, alamat, dan poin rewards-mu.',
    version: 'Hydromart v{v}',
    nav: {
      profile: 'Profil',
      addresses: 'Alamat',
      payments: 'Pembayaran',
      orders: 'Pesanan',
      rewards: 'Rewards',
      favorites: 'Favorit',
      referral: 'Ajak teman',
      prefs: 'Notifikasi',
    },
    profileCard: {
      title: 'Profil',
      edit: 'Ubah',
      save: 'Simpan',
      cancel: 'Batal',
      name: 'Nama lengkap',
      phone: 'Nomor HP',
      email: 'Email',
      emailOptional: '(opsional)',
      emailEmpty: 'Belum diisi',
      saved: 'Profil diperbarui.',
      saveError: 'Gagal menyimpan profil.',
    },
    payments: {
      title: 'Metode pembayaran',
      add: 'Tambah',
      empty: 'Belum ada metode tersimpan.',
      default: 'Aktif',
      makeDefault: 'Jadikan utama',
      delete: 'Hapus',
      sheetTitle: 'Tambah metode pembayaran',
      type: 'Jenis',
      label: 'Nama',
      labelHint: 'mis. GoPay, BCA',
      masked: 'Nomor akhir',
      maskedHint: 'Opsional, mis. ••••4821',
      save: 'Simpan',
      addError: 'Gagal menyimpan metode.',
    },
    addressesCard: {
      title: 'Alamat tersimpan',
      manage: 'Kelola',
      add: 'Tambah alamat',
      empty: 'Belum ada alamat tersimpan.',
      primary: 'Utama',
    },
    prefs: {
      title: 'Preferensi',
      push: { title: 'Notifikasi pesanan', body: 'Update status antar & kurir.' },
      email: { title: 'Email promo', body: 'Penawaran dan diskon terbaru.' },
      whatsapp: { title: 'WhatsApp', body: 'Pengingat dan konfirmasi via WhatsApp.' },
      saveError: 'Gagal menyimpan preferensi.',
    },
    languageBody: 'Bahasa aplikasi',
    theme: 'Tema',
    themeBody: 'Tampilan terang atau gelap',
    theme_light: 'Terang',
    theme_dark: 'Gelap',
    theme_system: 'Sistem',
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
  help,
  notifications,
  onboarding,
  review,
  subscriptions,
  ops,
  dashboard,
  dashA,
  dashB,
  dashC,
  driver,
  hq,
  privacy,
};

export type Dictionary = typeof id;
