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
    // CA-3-55: halaman ini menjanjikan 30 hari kerja sementara aplikasi menjanjikan DAN
    // mengukur 3x24 jam (`lib/pdp-sla.ts` = 72 jam; antrean /hq/pdp menandai baris yang
    // lewat batas itu merah). Dua janji untuk satu kewajiban, dan yang publik justru yang
    // paling longgar. Keputusan pemilik 2026-09-02: samakan ke 3x24 jam.
    'Kamu akan menerima konfirmasi setelah permintaan diproses. Permintaan diproses paling lambat 3x24 jam sejak diverifikasi.',
  ],

  sections: [
    {
      heading: 'Data yang dihapus atau dianonimkan',
      body: 'Identitas akun (nama, nomor telepon, email, foto profil, tautan akun Google) diganti dengan penanda anonim sehingga akun tidak lagi dapat dikaitkan denganmu dan tidak bisa dipakai masuk. Tanggal lahir dihapus. Metode pembayaran tersimpan, daftar favorit, dan preferensi notifikasi dihapus seluruhnya. Nama penerima, nomor telepon, dan catatan pada buku alamat dihapus.',
    },
    {
      heading: 'Data yang tetap disimpan, dan mengapa',
      // Kalimat ini pernah berbunyi "catatan tersebut tidak lagi menunjuk ke identitasmu",
      // dan itu tidak benar. Baris pesanan menyimpan SALINAN nama penerima dan nomor telepon
      // yang diketik saat memesan (813 baris, diukur 2026-08-25 di docs/AUDIT_L3.md §4.2), dan
      // salinan itu memang sengaja bertahan sepuluh tahun bersama catatan keuangannya.
      // Keputusan pemilik 2026-09-01: retensinya TETAP; yang salah adalah kalimatnya. Jadi
      // pengecualiannya dinyatakan, bukan disembunyikan di balik kata "dianonimkan".
      body: 'Riwayat pesanan, pembayaran, dan catatan keuangan wajib kami simpan minimal 10 tahun untuk memenuhi kewajiban perpajakan dan audit — data ini dikecualikan dari penghapusan oleh hukum, bukan oleh pilihan kami. Akunmu sendiri dianonimkan sehingga tidak bisa lagi dipakai masuk dan tidak lagi menunjuk ke kamu. Namun di dalam riwayat pesanan itu tetap tersimpan salinan nama penerima dan nomor telepon yang kamu isi saat memesan, karena keduanya bagian dari bukti transaksi yang wajib disimpan — salinan itu tidak ikut dihapus dan tidak ikut dianonimkan. Alamat pengantaran pada buku alamatmu tetap tersimpan sebagai baris alamat tanpa nama dan tanpa nomor telepon, karena pesanan yang sudah diantar tetap membutuhkan tujuan pengantarannya.',
    },
    {
      heading: 'Data yang dihapus di layanan lain',
      // Ditulis karena sebelumnya tidak ada: penghapusan hanya memanggil satu layanan, dan
      // sisanya tidak pernah disebut di mana pun — bukan sebagai dihapus, bukan sebagai
      // dikecualikan. Sekarang daftarnya adalah kontrak (registry penghapusan), dan yang di
      // luar daftar dilaporkan sebagai belum ditegakkan, bukan dilewatkan diam-diam.
      body: 'Selain akun dan profilmu, penghapusan juga menjangkau: riwayat notifikasi dan daftar penerima kampanye beserta nomor teleponmu; nomor penerima pada catatan pengantaran dan nama penerima pada bukti serah terima; langganan berjalan — yang dibatalkan lebih dulu supaya tidak ada pesanan baru yang terkirim atas namamu; serta tiket dukungan beserta isi pesan yang kamu tulis. Foto bukti serah terima mengikuti masa simpannya sendiri, maksimal 12 bulan, seperti dijelaskan di bawah.',
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
