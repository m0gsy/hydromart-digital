// Strings for the HQ design-fidelity batch (matrix bulk-toggles + rail grouping).
// Kept out of hq.ts so parallel agents don't collide on one fragment.
export const hqFix = {
  /*
   * DEFECT-01 — "tidak bisa dibaca" bukan "nol".
   *
   * Kedua pembacaan menelan kegagalannya dan layar menampilkan "Rp 0 · 0 pesanan" serta
   * "belum ada akun loyalty". Order-service yang lambat jadi terbaca persis seperti
   * pelanggan yang tak pernah memesan — di depan staf HQ yang sedang memutuskan kompensasi.
   */
  customers: {
    historyUnavailable: 'Riwayat pesanan tidak bisa dibaca sekarang — ini BUKAN berarti nol.',
    loyaltyUnavailable: 'Data loyalty tidak bisa dibaca sekarang — ini bukan berarti belum punya akun.',
    retry: 'Coba lagi',
  },
  recon: {
    schemeUnreadable: "Komisi (skema tidak terbaca)",
    schemeMissing: "Komisi (belum ada skema)",
  },
  toggleCol: 'Beri/cabut semua kapabilitas untuk peran ini',
  roleDetail: 'Lihat rincian hak peran ini',
  roleDetailShort: 'rincian',
  toggleRow: 'Beri/cabut kapabilitas ini untuk semua peran',
  surfaces: 'menu',
};
