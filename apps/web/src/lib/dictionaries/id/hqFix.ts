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
  /*
   * CA-2-28 — ekspor yang menolak, bukan ekspor yang terpotong.
   *
   * Berkas audit dibaca jauh dari layar yang bisa memperingatkan bahwa isinya sepotong.
   * Kalau jejaknya terlalu besar untuk dibaca utuh, satu-satunya jawaban jujur adalah
   * menolak menuliskannya — bukan menulis seratus baris terbaru dan membiarkannya lulus
   * sebagai "tidak ada apa-apa di tanggal itu".
   */
  audit: {
    tooLarge:
      'Jejak audit terlalu besar untuk diekspor utuh. Persempit dulu rentang atau saringannya — berkas sepotong lebih berbahaya daripada tidak ada berkas.',
  },
  reportsExport: {
    depotsIncomplete:
      'Laporan pendapatan per depot belum lengkap: sebagian depot tidak masuk laporan sumbernya, jadi angkanya akan salah. Ekspor ditahan sampai sumbernya utuh.',
  },
  recon: {
    schemeUnreadable: "Komisi (skema tidak terbaca)",
    schemeMissing: "Komisi (belum ada skema)",
    /*
     * CA-2-08 dan CA-2-09 — dua baris yang bukan penjumlah, dan diberi nama supaya terlihat.
     *
     * Ongkir sudah ada di dalam "Total penjualan" (`order.total` = subtotal + ongkir −
     * diskon), jadi menambahkannya lagi membayar ongkir dua kali. Dasar komisi bukan
     * penjualan: payout-service menagih persentasenya atas barang sebelum diskon, dan tanpa
     * baris ini angka komisinya tidak bisa dicocokkan dengan apa pun di layar yang sama.
     */
    shippingIncluded: 'Ongkir tertagih (sudah termasuk total penjualan)',
    commissionBase: 'Dasar komisi (barang sebelum diskon)',
  },
  toggleCol: 'Beri/cabut semua kapabilitas untuk peran ini',
  roleDetail: 'Lihat rincian hak peran ini',
  roleDetailShort: 'rincian',
  toggleRow: 'Beri/cabut kapabilitas ini untuk semua peran',
  surfaces: 'menu',
};
