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
import { agen } from './id/agen';
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
import { deleteAccount } from './id/deleteAccount';
import { franchise } from './id/franchise';
import { customerFix } from './id/customerFix';
import { courierFix } from './id/courierFix';
import { hqFix } from './id/hqFix';
import { opsFix } from './id/opsFix';
import { mgrFix } from './id/mgrFix';
import { hrFix } from './id/hrFix';
import { settings } from './id/settings';
import { errors } from './id/errors';

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
    consents: {
      title: 'Persetujuan data',
      body: 'Rekaman apa yang kamu setujui dan kapan. Persetujuan wajib tidak bisa dicabut selama akun aktif — untuk berhenti sepenuhnya, ajukan hapus akun di atas.',
      mandatory: 'Wajib',
      never: 'Belum pernah ditanyakan',
      since: 'Sejak {date}',
      saved: 'Persetujuan diperbarui.',
      saveError: 'Gagal memperbarui persetujuan.',
      purpose: {
        TERMS: 'Syarat & ketentuan layanan',
        PRIVACY: 'Kebijakan privasi & pemrosesan data',
        MARKETING: 'Promo dan penawaran',
      },
    },
    devices: {
      title: 'Perangkat & sesi',
      body: 'Setiap perangkat yang masih bisa masuk ke akunmu. Keluarkan satu, atau semuanya sekaligus kalau ponselmu hilang.',
      thisDevice: 'Perangkat ini',
      unknownDevice: 'Perangkat tidak dikenali',
      since: 'Masuk {date}',
      expires: 'Berlaku sampai {date}',
      revoke: 'Keluarkan',
      revoked: 'Perangkat dikeluarkan.',
      revokeError: 'Gagal mengeluarkan perangkat.',
      logoutAll: 'Keluar dari semua perangkat',
      logoutAllConfirm: 'Semua perangkat, termasuk yang ini, akan diminta masuk lagi. Lanjutkan?',
      loggedOutAll: 'Semua perangkat dikeluarkan.',
      logoutAllError: 'Gagal keluar dari semua perangkat.',
      empty: 'Tidak ada sesi aktif.',
      loadError: 'Gagal memuat daftar perangkat.',
    },
    consentHistory: {
      title: 'Riwayat persetujuan',
      show: 'Lihat riwayat',
      hide: 'Sembunyikan riwayat',
      granted: 'Disetujui',
      withdrawn: 'Ditarik',
      version: 'versi {v}',
      via: 'lewat {source}',
      empty: 'Belum ada keputusan tercatat.',
      loadError: 'Gagal memuat riwayat persetujuan.',
    },
    privacyData: {
      title: 'Data pribadi saya',
      body: 'Kamu berhak meminta salinan data yang kami simpan, atau meminta akun dihapus. Setiap permintaan ditinjau kantor pusat dulu, paling lambat 3x24 jam sejak dikirim (UU PDP No. 27/2022).',
      deadline: 'Dijawab paling lambat {date}',
      overdue: 'Lewat batas 3x24 jam',
      requestExport: 'Minta salinan data',
      requestDelete: 'Minta hapus akun',
      deleteConfirm: 'Akun dan identitasmu dihapus permanen setelah disetujui. Riwayat pembayaran tetap disimpan tanpa identitas karena kewajiban pajak. Lanjutkan?',
      submitted: 'Permintaan terkirim. Kantor pusat akan meninjau.',
      submitError: 'Gagal mengirim permintaan.',
      empty: 'Belum ada permintaan.',
      download: 'Unduh salinan data',
      downloadError: 'Gagal mengunduh salinan data.',
      type: { EXPORT: 'Salinan data', DELETE: 'Hapus akun' },
      status: { PENDING: 'Menunggu ditinjau', COMPLETED: 'Selesai', REJECTED: 'Ditolak' },
    },
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
      // H16: the first screen in the app that has ever asked for a date of birth.
      birthdate: 'Tanggal lahir',
      birthdateHint: 'Opsional. Dipakai untuk hadiah ulang tahun; bisa dikosongkan kapan saja.',
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
      // F6: dua keadaan yang dulu tidak punya kalimat, karena tombolnya tidak pernah
      // benar-benar bertanya ke perangkat.
      push: {
        title: 'Notifikasi pesanan',
        body: 'Update status antar & kurir.',
        unsupported: 'Perangkat ini tidak mendukung notifikasi.',
        denied: 'Notifikasi diblokir. Izinkan Hydromart di setelan perangkat, lalu coba lagi.',
        failed: 'Gagal mendaftarkan perangkat untuk notifikasi. Coba lagi.',
      },
      // F1b: berhenti dari info promo TANPA ikut mematikan update pesanan. Dua hal berbeda,
      // dan menggabungkannya berarti pelanggan yang cuma tidak mau dipromosikan harus ikut
      // membutakan dirinya dari status antar.
      marketing: { title: 'Info promo & penawaran', body: 'Kabar diskon dari depotmu. Matikan kapan saja.' },
      // F1: kunci email/whatsapp DIHAPUS bersama toggle-nya — dua kanal yang tidak ada di
      // sistem ini. Jangan dihidupkan lagi tanpa transport yang benar-benar mengirim.
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
    confirm: 'Konfirmasi',
    cancel: 'Batal',
    close: 'Tutup',
    done: 'Selesai',
    back: 'Kembali',
    retry: 'Coba lagi',
    loading: 'Memuat…',
    somethingWrong: 'Ada yang tidak beres',
    // A lookup that fills a control, not the page. Deliberately not 'kosong': an empty
    // dropdown and a dropdown that could not be asked are opposite answers.
    loadFailed: 'Gagal dimuat.',
    // Used by the HQ order queue's assign-depot failure; without it the screen printed
    // the key itself at the user.
    error: 'Ada yang tidak beres.',
    // The four answers `api.ts` gives when the server said nothing usable. They lived as
    // English literals inside that module — reached by every screen, translated by none —
    // and the OTP screen showed "Cannot reach the server" under `lang="id"` the first time
    // a phone lost signal.
    netUnreachable: 'Tidak bisa menghubungi server. Periksa koneksimu lalu coba lagi.',
    netTimeout: 'Server terlalu lama menjawab. Coba lagi.',
    netTooMany: 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.',
    netFailed: 'Permintaan gagal ({status}).',
  },
  home,
  shop,
  order,
  profile,
  auth,
  help,
  notifications,
  agen,
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
  deleteAccount,
  franchise,
  customerFix,
  courierFix,
  hqFix,
  opsFix,
  mgrFix,
  hrFix,
  settings,
  errors,
};

export type Dictionary = typeof id;
