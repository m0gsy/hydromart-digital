// The one source for what each scene says and how long it runs. The videos (Root.tsx) take their
// timing from here and NASKAH_VO.md is generated from here (`npm run naskah`), so the voice-over
// script can never drift from the cut.
//
// Every on-screen label quoted in `caption`/`vo` is the Indonesian string the Ops app really shows
// (apps/web/src/lib/dictionaries/id/*). Keep it that way: a tutorial that names a button the app
// does not have is worse than none.

export interface Scene {
  id: string;
  /** Small pill above the title, e.g. "Langkah 3". Empty on title cards. */
  step: string;
  title: string;
  caption: string;
  /** Voice-over, read at a calm pace (~2.4 words/second). */
  vo: string;
  sec: number;
}

export const FPS = 30;

export const STAFF: Scene[] = [
  {
    id: 'intro',
    step: '',
    title: 'Staff Depot',
    caption: 'Panduan Hydromart Ops dari absen pagi sampai setor uang sore.',
    vo: 'Halo, tim Hydromart! Di video ini kita belajar memakai Hydromart Ops untuk Staff Depot, dari absen pagi sampai setor uang sore.',
    sec: 9,
  },
  {
    id: 'login',
    step: 'Langkah 1',
    title: 'Masuk ke aplikasi',
    caption: 'Isi nomor HP, ketuk Kirim kode, lalu masukkan 6 digit kode SMS.',
    vo: 'Buka aplikasi Hydromart Ops. Isi nomor HP yang terdaftar di HR, ketuk Kirim kode, lalu masukkan enam digit kode dari SMS dan ketuk Verifikasi dan lanjut.',
    sec: 12,
  },
  {
    id: 'enroll',
    step: 'Langkah 2',
    title: 'Daftarkan wajah',
    caption: 'Cukup sekali: ambil 1–3 foto, centang persetujuan, lalu Simpan.',
    vo: 'Sebelum absen pertama kali, daftarkan wajah Anda. Buka Daftar atau Perbarui Wajah, ambil satu sampai tiga foto yang jelas, centang persetujuan, lalu ketuk Simpan.',
    sec: 12,
  },
  {
    id: 'checkin',
    step: 'Langkah 3',
    title: 'Absen masuk',
    caption: 'Absen Sekarang → Check-in → Ambil Foto. GPS aktif, di area depot.',
    vo: 'Setiap pagi, buka Absen Sekarang, pilih Check-in, lalu ketuk Ambil Foto. Gerakkan kepala sedikit atau berkedip saat difoto. Pastikan GPS menyala dengan mode lokasi Tepat, karena absen hanya bisa di area depot.',
    sec: 15,
  },
  {
    id: 'shift',
    step: 'Langkah 4',
    title: 'Mulai shift',
    caption: 'Cek depot, kendaraan & baterai, lalu Mulai shift · check-in.',
    vo: 'Setelah absen, mulai shift kurir. Periksa depot, kendaraan, dan baterai HP, lalu ketuk Mulai shift, check-in. Anda harus berada dekat depot.',
    sec: 11,
  },
  {
    id: 'pickup',
    step: 'Langkah 5',
    title: 'Ambil barang',
    caption: 'Tugas baru muncul di Pengantaran saya. Ketuk Konfirmasi barang diambil.',
    vo: 'Tugas dari kepala depot muncul di halaman Pengantaran saya. Pastikan status Anda Online. Setelah galon dimuat, ketuk Konfirmasi barang diambil.',
    sec: 11,
  },
  {
    id: 'deliver',
    step: 'Langkah 6',
    title: 'Antar pesanan',
    caption: 'Ketuk Mulai antar, ikuti peta & patokan alamat pelanggan.',
    vo: 'Ketuk Mulai antar saat berangkat, lalu ikuti peta dan patokan ke alamat pelanggan. Untuk pesanan bayar di tempat, tombol Sampai tujuan baru aktif setelah uang diterima.',
    sec: 12,
  },
  {
    id: 'returns',
    step: 'Langkah 7',
    title: 'Catat galon kosong',
    caption: 'Ada galon kosong? Isi jumlah & kondisinya, lalu Catat retur.',
    vo: 'Jika pelanggan mengembalikan galon kosong, ketuk Retur galon kosong, isi jumlah dan kondisinya, lalu ketuk Catat retur.',
    sec: 10,
  },
  {
    id: 'cod',
    step: 'Langkah 8',
    title: 'Terima uang COD',
    caption: 'Isi uang diterima, cek kembalian, lalu Konfirmasi pembayaran.',
    vo: 'Ketuk Terima uang. Cek total tagihan, isi uang yang diterima dari pelanggan atau ketuk Uang pas, dan aplikasi menghitung kembaliannya. Ketuk Konfirmasi pembayaran, lalu Lanjut ke bukti serah terima.',
    sec: 14,
  },
  {
    id: 'proof',
    step: 'Langkah 9',
    title: 'Bukti serah terima',
    caption: 'Foto, kondisi segel, nama penerima → Selesaikan pengantaran.',
    vo: 'Ambil foto pengantaran, centang kondisi segel galon, dan isi nama penerima. Tanda tangan dan catatan boleh dilewati. Ketuk Selesaikan pengantaran, lalu lanjut ke tugas berikutnya.',
    sec: 13,
  },
  {
    id: 'failed',
    step: 'Kalau ada kendala',
    title: 'Pelanggan tidak ada?',
    caption: 'Pakai Tidak di tempat, Jadwal ulang, atau Gagal beserta alasannya.',
    vo: 'Kalau pelanggan tidak ada, ketuk Tidak di tempat dan catat usaha menghubungi. Bisa juga Jadwal ulang, atau Gagal dengan memilih alasannya. Jangan biarkan tugas menggantung.',
    sec: 13,
  },
  {
    id: 'settle',
    step: 'Langkah 10',
    title: 'Setor uang COD',
    caption: 'Akhiri shift · check-out, lalu Setor ke kasir sesuai jumlah seharusnya.',
    vo: 'Selesai bertugas, ketuk Akhiri shift, check-out. Di Setoran tunai, cocokkan uang dengan angka Seharusnya disetor, isi jumlahnya, lalu ketuk Setor ke kasir. Kepala depot akan memverifikasi.',
    sec: 14,
  },
  {
    id: 'checkout',
    step: 'Langkah 11',
    title: 'Absen pulang',
    caption: 'Akhiri shift bukan absen pulang. Buka Absen Sekarang → Check-out.',
    vo: 'Ingat, mengakhiri shift tidak sama dengan absen pulang. Buka lagi Absen Sekarang, pilih Check-out, lalu ambil foto.',
    sec: 10,
  },
  {
    id: 'more',
    step: 'Layanan mandiri',
    title: 'Fitur lainnya',
    caption: 'Cuti, kasbon, slip gaji, pengumuman & klaim pengeluaran dari HP.',
    vo: 'Di menu karyawan, Anda juga bisa mengajukan cuti dan kasbon, melihat slip gaji, membaca pengumuman, dan dari Profil mengirim klaim bensin atau parkir dengan foto struk.',
    sec: 12,
  },
  {
    id: 'outro',
    step: '',
    title: 'Rutinitas harian',
    caption: 'Absen, mulai shift, antar dengan bukti, setor, lalu absen pulang.',
    vo: 'Itu dia rutinitas harian Staff Depot: absen, mulai shift, antar dengan bukti, lalu setor dan absen pulang. Selamat bekerja!',
    sec: 10,
  },
];

export const KEPALA: Scene[] = [
  {
    id: 'intro',
    step: '',
    title: 'Kepala Depot',
    caption: 'Menjalankan depot dari HP: pantau, tugaskan, jual, dan tutup buku.',
    vo: 'Halo, Kepala Depot! Video ini memandu Anda memakai Hydromart Ops untuk menjalankan depot: memantau, menugaskan kurir, berjualan, dan menutup buku.',
    sec: 10,
  },
  {
    id: 'login',
    step: 'Langkah 1',
    title: 'Masuk & absen',
    caption: 'Masuk dengan nomor HP + kode SMS, lalu absen wajah di Absen saya.',
    vo: 'Masuk dengan nomor HP dan kode SMS. Lalu buka tab Absen saya, ketuk Absen Sekarang, pilih Check-in, dan ambil foto di area depot.',
    sec: 12,
  },
  {
    id: 'ringkasan',
    step: 'Langkah 2',
    title: 'Cek Ringkasan',
    caption: 'Pesanan masuk, yang perlu ditugaskan, kurir aktif & COD belum disetor.',
    vo: 'Layar pertama adalah Ringkasan hari ini. Di sini terlihat pesanan masuk, pesanan yang perlu ditugaskan, kurir aktif, dan uang COD yang belum disetor.',
    sec: 12,
  },
  {
    id: 'process',
    step: 'Langkah 3',
    title: 'Proses pesanan',
    caption: 'Antrean → Proses → Lanjut ke Dikonfirmasi → Lanjut ke Disiapkan.',
    vo: 'Buka tab Antrean. Pesanan baru ada di Perlu ditugaskan. Ketuk Proses, lalu Lanjut ke Dikonfirmasi, kemudian Lanjut ke Disiapkan saat galon disiapkan.',
    sec: 12,
  },
  {
    id: 'assign',
    step: 'Langkah 4',
    title: 'Tugaskan kurir',
    caption: 'Pilih kurir yang Tersedia, lalu ketuk Tugaskan ke (nama).',
    vo: 'Ketuk Tugaskan. Pilih kurir yang berstatus Tersedia dengan tugas paling sedikit, lalu ketuk Tugaskan ke nama kurir. Tugasnya langsung masuk ke HP kurir.',
    sec: 12,
  },
  {
    id: 'tracking',
    step: 'Langkah 5',
    title: 'Pantau kurir',
    caption: 'Tab Kurir menampilkan pengantaran secara langsung.',
    vo: 'Di tab Kurir, pantau pengantaran secara langsung. Jika perlu, pesanan bisa ditarik kembali ke antrean.',
    sec: 9,
  },
  {
    id: 'openshift',
    step: 'Langkah 6',
    title: 'Buka shift kasir',
    caption: 'Penjualan → isi uang kembalian awal di laci → Buka shift.',
    vo: 'Sebelum melayani pembeli di depot, buka tab Penjualan. Isi uang kembalian awal di laci, lalu ketuk Buka shift.',
    sec: 10,
  },
  {
    id: 'sale',
    step: 'Langkah 7',
    title: 'Jual di depot',
    caption: 'Pilih produk → Lanjut → metode bayar → Simpan & cetak struk.',
    vo: 'Ketuk produk untuk memasukkannya ke keranjang, lalu Lanjut. Pilih Pembeli umum, lalu metode bayar: Tunai, QRIS, atau transfer. Untuk tunai, isi uang diterima, cek kembalian, lalu ketuk Simpan dan cetak struk.',
    sec: 16,
  },
  {
    id: 'closeshift',
    step: 'Langkah 8',
    title: 'Tutup shift kasir',
    caption: 'Hitung uang di laci → Tutup & hitung selisih.',
    vo: 'Di akhir hari, ketuk Tutup shift. Hitung uang tunai di laci, masukkan angkanya, lalu ketuk Tutup dan hitung selisih. Aplikasi menampilkan selisihnya.',
    sec: 12,
  },
  {
    id: 'inventory',
    step: 'Langkah 9',
    title: 'Kelola stok',
    caption: 'Inventory → Terima untuk stok masuk, Sesuaikan untuk koreksi.',
    vo: 'Di tab Inventory, ketuk Terima saat stok datang, atau Sesuaikan untuk mengoreksi jumlah. Stok yang menipis diberi tanda supaya bisa dipesan ulang.',
    sec: 12,
  },
  {
    id: 'meter',
    step: 'Langkah 10',
    title: 'Catat meteran air',
    caption: 'Meteran pagi saat buka, meteran sore saat tutup.',
    vo: 'Buka Meteran air di tab Inventory. Isi angka meteran pagi saat depot buka dan meteran sore saat tutup, lalu ketuk Simpan.',
    sec: 10,
  },
  {
    id: 'settle',
    step: 'Langkah 11',
    title: 'Verifikasi setoran',
    caption: 'Setoran → Hitung & verifikasi → cocokkan Wajib setor → Verifikasi.',
    vo: 'Saat kurir menyetor uang COD, buka tab Setoran. Ketuk Hitung dan verifikasi, cocokkan uangnya dengan angka Wajib setor, lalu ketuk Verifikasi. Jika tidak cocok, pilih Sengketakan.',
    sec: 14,
  },
  {
    id: 'closebook',
    step: 'Langkah 12',
    title: 'Tutup buku harian',
    caption: 'Keuangan → Laporan → Tutup buku. Semua shift kasir harus sudah ditutup.',
    vo: 'Terakhir, buka Keuangan, lalu Laporan, dan ketuk Tutup buku. Pastikan semua shift kasir sudah ditutup, karena buku tidak bisa ditutup selama masih ada shift terbuka.',
    sec: 13,
  },
  {
    id: 'outro',
    step: '',
    title: 'Rutinitas harian',
    caption: 'Pagi buka, siang layani, sore tutup.',
    vo: 'Ringkasnya: pagi absen, catat meteran, dan buka shift kasir. Siang tugaskan pesanan dan layani pembeli. Sore tutup shift, verifikasi setoran, catat meteran, dan tutup buku. Selamat bekerja!',
    sec: 14,
  },
];

export const frames = (scenes: Scene[]) => scenes.reduce((n, s) => n + s.sec * FPS, 0);
