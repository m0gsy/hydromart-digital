// Kebijakan Privasi (UU 27/2022 tentang Pelindungan Data Pribadi). Halaman statis;
// sumber kebenaran Bahasa. `sections` di-render berurutan sebagai heading + paragraf.
// Perbarui `effective` setiap kali isi kebijakan berubah secara material — DAN naikkan
// `CONSENT_DOCUMENT_VERSION` di services/auth-service/.../consent.service.ts ke tanggal
// yang sama. Baris consent menyimpan versi itu, jadi kalau keduanya berbeda, ledger akan
// mengaku pelanggan menyetujui teks yang tidak pernah mereka lihat. Itu persis cacat yang
// terjadi sampai 29 Agustus 2026 (versi tertulis '1.0', dokumennya belum ada).
export const privacy = {
  title: 'Kebijakan Privasi',
  effective: 'Berlaku sejak 29 Agustus 2026',
  intro:
    'Hydromart menghormati privasimu. Kebijakan ini menjelaskan data pribadi apa yang kami kumpulkan, untuk apa, berapa lama kami simpan, dan hak-hakmu berdasarkan UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP).',
  sections: [
    {
      heading: 'Info promo dan penawaran',
      body: 'Kalau kamu pernah memesan dari salah satu depot kami, sesekali kami mengirim kabar promo dari depot itu — sebagai baris di kotak notifikasi aplikasimu, dan sebagai notifikasi perangkat kalau kamu mengizinkannya. Dasar pemrosesannya adalah kepentingan sah kami untuk memberi tahu pelanggan sendiri tentang layanan yang sudah kamu pakai, bukan persetujuan pemasaran terpisah. Kamu bisa berhenti kapan saja lewat Akun › Preferensi › Info promo & penawaran, dan itu berlaku seketika tanpa memengaruhi pemberitahuan status pesananmu. Kami tidak menjual atau menyewakan datamu ke pihak ketiga untuk pemasaran mereka.',
    },
    {
      heading: 'Data yang kami kumpulkan',
      body: 'Saat kamu mendaftar dan memesan: nama, nomor telepon, email (opsional), dan alamat pengantaran. Saat pesanan diantar, kurir mengambil bukti pengantaran berupa foto penyerahan, tanda tangan penerima, nama penerima, serta titik lokasi (GPS) dan waktu penyerahan.',
    },
    {
      heading: 'Lokasi perangkat',
      body: 'Kalau kamu menekan “Gunakan lokasi saya” di beranda atau saat menyimpan alamat, aplikasi membaca lokasi perkiraan (approximate) perangkatmu dan mengirimkannya ke server kami untuk mencari depot terdekat serta memeriksa apakah titik itu masuk jangkauan antar depot. Titik itu ikut tersimpan pada alamat yang kamu simpan. Ini opsional: kamu bisa mengetik alamat sendiri tanpa memberi izin lokasi, dan aplikasi tetap bisa dipakai sepenuhnya. Lokasi tidak dibagikan ke pihak ketiga, tidak dipakai untuk iklan maupun analitik, dikirim lewat koneksi terenkripsi, dan bisa kamu minta hapus bersama data akunmu. Aplikasi pelanggan tidak meminta izin lokasi presisi (GPS); lokasi presisi hanya dipakai aplikasi staf untuk bukti pengantaran dan absensi kurir.',
    },
    {
      heading: 'Tujuan penggunaan',
      body: 'Data dipakai untuk memproses dan mengantar pesananmu, memverifikasi penyerahan (bukti pengantaran), memberi dukungan pelanggan, mengelola poin & rewards, serta memenuhi kewajiban hukum. Bukti pengantaran menjadi catatan sah bahwa pesanan telah diterima.',
    },
    {
      heading: 'Dasar pemrosesan & persetujuan',
      body: 'Kami memproses data berdasarkan persetujuanmu (diberikan saat pendaftaran dan saat penerima menandatangani bukti pengantaran) dan untuk pelaksanaan pesananmu. Kamu dapat menarik persetujuan kapan saja, dengan konsekuensi kami mungkin tidak dapat melanjutkan layanan tertentu.',
    },
    {
      heading: 'Berbagi data & penerima pihak ketiga',
      body: 'Data pesananmu dibagikan kepada depot dan kurir yang menanganinya. Di luar itu ada penyedia yang menerima sebagian datamu karena merekalah yang memprosesnya untuk kami, dan inilah daftar lengkapnya. (1) BiznetGio NEO Object Storage (Jakarta dan Jawa Barat, Indonesia) menyimpan berkas gambar: foto dan tanda tangan bukti pengantaran, serta foto profilmu. (2) Zenziva (Indonesia) menerima nomor teleponmu dan isi pesannya untuk mengirim kode OTP lewat SMS. (3) Google, lewat Firebase Cloud Messaging, menerima token perangkat aplikasi Android-mu beserta judul dan isi setiap notifikasi yang kami kirim — jadi kalimat seperti “Pesananmu sedang diantar” memang melewati server Google, dan Google memprosesnya di luar wilayah Indonesia. (4) Untuk notifikasi di peramban, layanan push milik pembuat peramban (Google untuk Chrome, Mozilla untuk Firefox, dan seterusnya) meneruskan pesan kami, tetapi isinya terenkripsi sehingga mereka hanya tahu ke perangkat mana pesan dikirim, bukan isinya. Notifikasi perangkat hanya berjalan kalau kamu mengizinkannya; mencabut izin itu menghentikan pengiriman token maupun teks notifikasi ke Google. Tidak satu pun penerima di atas boleh memakai datamu untuk keperluannya sendiri, dan kami tidak menjual maupun menyewakan data pribadimu.',
    },
    {
      heading: 'Penyimpanan & retensi',
      body: 'Data akun disimpan selama akunmu aktif. Bukti pengantaran (foto, tanda tangan, nama penerima, lokasi) disimpan maksimal 12 bulan sejak penyerahan, lalu dihapus otomatis. Berkas foto/tanda tangan di penyimpanan objek dihapus melalui aturan siklus-hidup bucket dengan jangka yang sama.',
    },
    {
      heading: 'Keamanan',
      body: 'Kode OTP dan token sesi disimpan dalam bentuk hash, koneksi dienkripsi (HTTPS), dan akses data dibatasi berdasarkan peran. Tidak ada sistem yang 100% aman, namun kami menerapkan langkah wajar untuk melindungi datamu.',
    },
    {
      heading: 'Hak kamu',
      body: 'Kamu berhak mengakses, memperbaiki, dan meminta penghapusan data pribadimu, menarik persetujuan, serta mengajukan keberatan atas pemrosesan tertentu. Untuk menggunakan hak ini, hubungi kami lewat kontak di bawah.',
    },
    {
      heading: 'Kontak',
      body: 'Pertanyaan atau permintaan terkait data pribadi: privacy@hydromart-digital.com.',
    },
  ],
};
