// Kebijakan Privasi (UU 27/2022 tentang Pelindungan Data Pribadi). Halaman statis;
// sumber kebenaran Bahasa. `sections` di-render berurutan sebagai heading + paragraf.
// Perbarui `effective` setiap kali isi kebijakan berubah secara material.
export const privacy = {
  title: 'Kebijakan Privasi',
  effective: 'Berlaku sejak 16 Juli 2026',
  intro:
    'Hydromart menghormati privasimu. Kebijakan ini menjelaskan data pribadi apa yang kami kumpulkan, untuk apa, berapa lama kami simpan, dan hak-hakmu berdasarkan UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP).',
  sections: [
    {
      heading: 'Data yang kami kumpulkan',
      body: 'Saat kamu mendaftar dan memesan: nama, nomor telepon, email (opsional), dan alamat pengantaran. Saat pesanan diantar, kurir mengambil bukti pengantaran berupa foto penyerahan, tanda tangan penerima, nama penerima, serta titik lokasi (GPS) dan waktu penyerahan.',
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
      heading: 'Berbagi data',
      body: 'Data hanya dibagikan kepada depot dan kurir yang menangani pesananmu, serta penyedia infrastruktur (penyimpanan berkas, pengiriman OTP) sebatas yang diperlukan. Kami tidak menjual data pribadimu.',
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
