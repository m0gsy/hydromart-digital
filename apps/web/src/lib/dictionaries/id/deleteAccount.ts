// Halaman penghapusan akun. Google Play mensyaratkan URL PUBLIK (dapat dibuka tanpa
// login dan tanpa memasang aplikasi) yang menyebutkan pengembang, aplikasi, cara
// mengajukan penghapusan, data apa yang dihapus, dan data apa yang tetap disimpan
// beserta jangka waktunya. Isi di bawah HARUS cocok dengan yang benar-benar dijalankan
// kode: `pdp.prisma.repository.ts#anonymise`, `anonymisedIdentity()`, dan kelas retensi
// FINANCIAL (`retention.ts`, 3650 hari, tidak pernah di-purge).
export const deleteAccount = {
  title: 'Penghapusan Akun Hydromart',
  /** Short form — the full title does not fit a footer row. */
  navLabel: 'Hapus Akun',
  effective: 'Berlaku sejak 8 Agustus 2026',
  developer: 'Aplikasi: Hydromart dan Hydromart Ops. Pengembang: PT Hydromart Digital.',
  intro:
    'Kamu berhak meminta penghapusan akun dan data pribadimu kapan saja, sesuai UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP). Halaman ini menjelaskan caranya, apa yang dihapus, dan apa yang tetap kami simpan beserta alasannya.',

  stepsHeading: 'Cara mengajukan penghapusan',
  steps: [
    'Lewat aplikasi: buka Akun → Data & privasi → Hapus akun, lalu konfirmasi. Permintaanmu masuk ke antrean dan diputuskan tim kantor pusat.',
    'Tanpa aplikasi: kirim email ke privacy@hydromart-digital.com dari alamat email yang terdaftar, atau sebutkan nomor telepon akunmu. Kami akan memverifikasi identitasmu sebelum memproses.',
    'Kamu akan menerima konfirmasi setelah permintaan diproses. Permintaan diproses paling lambat 30 hari kerja sejak diverifikasi.',
  ],

  sections: [
    {
      heading: 'Data yang dihapus atau dianonimkan',
      body: 'Identitas akun (nama, nomor telepon, email, foto profil, tautan akun Google) diganti dengan penanda anonim sehingga akun tidak lagi dapat dikaitkan denganmu dan tidak bisa dipakai masuk. Tanggal lahir dihapus. Metode pembayaran tersimpan, daftar favorit, dan preferensi notifikasi dihapus seluruhnya. Nama penerima, nomor telepon, dan catatan pada buku alamat dihapus.',
    },
    {
      heading: 'Data yang tetap disimpan, dan mengapa',
      body: 'Riwayat pesanan, pembayaran, dan catatan keuangan wajib kami simpan minimal 10 tahun untuk memenuhi kewajiban perpajakan dan audit — data ini dikecualikan dari penghapusan oleh hukum, bukan oleh pilihan kami. Setelah akunmu dianonimkan, catatan tersebut tidak lagi menunjuk ke identitasmu. Alamat pengantaran tetap tersimpan sebagai baris alamat tanpa nama dan tanpa nomor telepon, karena pesanan yang sudah diantar tetap membutuhkan tujuan pengantarannya.',
    },
    {
      heading: 'Bukti pengantaran',
      body: 'Foto penyerahan, tanda tangan penerima, nama penerima, serta titik lokasi dan waktu penyerahan disimpan maksimal 12 bulan sejak penyerahan, lalu dihapus otomatis — termasuk berkasnya di penyimpanan objek. Penghapusan akun tidak memperpanjang maupun memperpendek jangka ini.',
    },
    {
      heading: 'Akun staf dan kurir',
      body: 'Akun pada aplikasi Hydromart Ops adalah akun kerja yang dibuat oleh perusahaan. Permintaan penghapusan untuk akun staf ditangani melalui HRD atau kantor pusat, karena catatan kehadiran, penggajian, dan kepegawaian tunduk pada kewajiban retensi ketenagakerjaan tersendiri.',
    },
    {
      heading: 'Mengunduh data sebelum menghapus',
      body: 'Penghapusan tidak dapat dibatalkan. Kalau kamu ingin menyimpan salinan datamu, ajukan permintaan ekspor lebih dulu lewat Akun → Data & privasi → Unduh data. Kamu akan menerima berkas JSON berisi data akun, profil, alamat, dan riwayat persetujuanmu.',
    },
    {
      heading: 'Kontak',
      body: 'Pertanyaan atau permintaan terkait data pribadi: privacy@hydromart-digital.com.',
    },
  ],
};
