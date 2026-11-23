// Halaman pasang autentikator (/account/autentikator, AI-3a). Sumber kebenaran Bahasa; en/
// mengikuti bentuknya.
export const authenticator = {
  back: 'Akun',
  title: 'Aplikasi autentikator',
  intro:
    'Kode 6 angka dari aplikasi autentikator di ponselmu menjadi langkah kedua saat masuk ke web HYDROMART AI.',
  required: 'Peranmu wajib memakai langkah ini untuk masuk ke web AI.',
  optional:
    'Peranmu tidak wajib memakainya. Sekali dipasang, langkah ini wajib untukmu setiap masuk ke web AI, dan hanya SUPER_ADMIN yang bisa melepasnya.',
  unavailable: 'Langkah autentikator belum dinyalakan di server. Belum ada yang perlu dipasang.',
  staffOnly: 'Autentikator hanya untuk akun staf.',
  loadError: 'Status autentikator tidak bisa dimuat.',
  enrolled: 'Autentikator terpasang. Kode pemulihan tersisa: {n}.',
  locked: 'Terkunci sampai {time} karena terlalu banyak kode salah.',
  resetHint:
    'Ganti ponsel atau kehilangan aplikasinya? Minta SUPER_ADMIN mereset autentikatormu, lalu pasang lagi di sini.',
  start: 'Pasang autentikator',
  starting: 'Menyiapkan…',
  step1: '1. Tambahkan akun ini ke aplikasi autentikator (Google Authenticator, Microsoft Authenticator, atau sejenisnya).',
  openInApp: 'Buka di aplikasi autentikator',
  typeSecret: 'Atau ketik kunci ini di aplikasinya:',
  step2: '2. Masukkan kode 6 angka yang tampil di aplikasi, dan kode SMS yang baru dikirim ke nomor akunmu.',
  appCode: 'Kode dari aplikasi',
  smsCode: 'Kode SMS',
  smsSent: 'Kode SMS dikirim ke nomor akunmu dan berlaku {m} menit.',
  smsPending: 'SMS sedang dikirim ke nomor akunmu. Kalau tidak datang, mulai ulang.',
  restart: 'Mulai ulang',
  badAppCode: 'Kode aplikasi harus 6 angka.',
  badSmsCode: 'Kode SMS harus 4 sampai 8 angka.',
  confirm: 'Selesaikan pemasangan',
  failed: 'Pemasangan gagal. Coba lagi.',
  codesTitle: 'Simpan kode pemulihan ini sekarang',
  codesBody:
    'Hanya ditampilkan sekali. Tiap kode bisa dipakai satu kali saat ponselmu tidak ada. Simpan di tempat aman, bukan di ponsel yang sama.',
  copy: 'Salin semua',
  copied: 'Kode pemulihan disalin.',
  copyError: 'Tidak bisa menyalin. Catat kodenya secara manual.',
  done: 'Sudah saya simpan',
};
