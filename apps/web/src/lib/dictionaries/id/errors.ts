// Fase E6 — server errors a person actually reads.
//
// Domain errors carry a machine code beside their English sentence (`AllExceptionsFilter`
// puts both in the envelope). Until now only the sentence reached the screen, so a
// customer signing in under `lang="id"` was told "No account is registered with this
// phone number." Keyed by code rather than by screen: one server error means one thing
// wherever it surfaces, and a screen should not have to know the code exists.
//
// Only codes listed here are replaced. Anything else keeps whatever the server said —
// several services already answer in Indonesian, and overriding those would be a
// regression dressed as a translation.
export const errors = {
  byCode: {
    AUTH_CUSTOMER_NOT_FOUND: 'Nomor ini belum terdaftar.',
    AUTH_INVALID_PHONE: 'Nomor HP Indonesia tidak valid. Contoh: 081234567890.',
    AUTH_PHONE_TAKEN: 'Nomor ini sudah terdaftar. Silakan masuk.',
    AUTH_EMAIL_TAKEN: 'Email ini sudah dipakai akun lain.',
    AUTH_OTP_INVALID: 'Kode verifikasi salah.',
    AUTH_OTP_EXPIRED: 'Kode verifikasi sudah kedaluwarsa. Minta kode baru.',
    AUTH_OTP_MAX_ATTEMPTS: 'Terlalu banyak percobaan. Minta kode baru.',
    AUTH_OTP_COOLDOWN: 'Kode baru bisa diminta sebentar lagi. Cek SMS yang sudah masuk dulu.',
    AUTH_OTP_UNDELIVERABLE: 'Kode belum bisa dikirim sekarang. Coba lagi.',
    AUTH_ACCOUNT_PENDING_VERIFICATION:
      'Nomor ini sudah terdaftar tapi belum diverifikasi. Kami kirim ulang kodenya.',
    AUTH_ACCOUNT_NOT_ACTIVE: 'Akun ini tidak aktif. Hubungi dukungan Hydromart.',
    // The server already answers this one in Indonesian; it is listed so the English
    // dictionary has somewhere to put its own sentence, not to translate anything.
    ORDER_CATALOG_UNAVAILABLE: 'Katalog produk sedang sibuk. Tunggu sebentar, lalu coba lagi.',
  },
  // E3: a detail screen opened without its `?id=` used to build a URL with a hole in it
  // and show the server's 404, which reads as "this record was deleted" rather than
  // "you arrived here without naming one".
  missingRouteId: 'Halaman ini dibuka tanpa data yang diperlukan. Kembali lalu pilih ulang.',
  // J1: the same four failures on staff screens, which have no city picker to fall back on.
  // The customer wording lives in `home.location` and keeps its "atau pilih kota" way out.
  geo: {
    denied: 'Akses lokasi ditolak. Izinkan lokasi untuk aplikasi ini di Setelan, lalu coba lagi.',
    unavailable: 'Lokasi tidak bisa didapat. Nyalakan Lokasi/GPS di perangkat, lalu coba lagi.',
    timeout: 'Sinyal lokasi belum ketemu. Coba lagi di tempat yang lebih terbuka.',
    unsupported: 'Perangkat ini tidak mendukung lokasi.',
  },
  address: {
    required: 'Lengkapi semua kolom yang wajib diisi.',
    latitudeRange: 'Titik peta tidak valid: lintang harus antara -90 dan 90.',
    longitudeRange: 'Titik peta tidak valid: bujur harus antara -180 dan 180.',
  },
};
