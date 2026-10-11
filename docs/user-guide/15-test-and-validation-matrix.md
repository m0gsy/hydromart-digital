# Bab 15 — Matriks Uji dan Validasi

| Metadata | Nilai |
|---|---|
| Versi | 0.1 draf |
| Tanggal | 2026-10-10 |
| Klasifikasi | Internal — Terbatas |
| Status pengujian | **Belum ada pengujian yang dijalankan oleh tim dokumentasi.** Semua skenario di bab ini berstatus "Not Tested". |
| Dokumen pasangan | Bab 11 (Proses Bisnis End-to-End) dan Bab 2–10 (panduan peran). |

**Legenda bukti.** **[V]** terverifikasi di kode · **[D]** disimpulkan, perlu konfirmasi · **[K]** perlu konfirmasi bisnis · **[B]** diketahui bermasalah/tidak konsisten.

**Catatan hak akses.** Hak akses dalam skenario adalah nilai BAWAAN dari `packages/access/src/index.ts`. Super admin dapat mengubahnya saat runtime (±30 detik). Sebelum menguji, catat matriks yang sedang berlaku (`/hq/access`) agar hasil dapat dibandingkan. **[V]**

---

## 1. Tujuan dan aturan pemakaian

1. Bab ini memberi **rencana uji manual terstruktur** untuk setiap alur di Bab 11. Penguji (tim QA atau pemilik proses) menjalankan sendiri, lalu mengisi kolom hasil aktual dan status.
2. Kolom **Hasil aktual** berisi "Belum diuji oleh tim dokumentasi" dan kolom **Status** berisi "Not Tested" pada semua baris. **Jangan mengubah status menjadi Pass kecuali Anda sendiri menjalankan skenario dan menyimpan buktinya** (tangkapan layar, ID pesanan sintetis, jam).
3. Nilai yang berasal dari pengaturan (**[K]**) harus dibaca dari lingkungan uji sebelum membandingkan hasil.
4. Pesan error dari server yang berbahasa Inggris dikutip apa adanya; arti ada di bab panduan terkait.
5. Jangan memakai data nyata. Gunakan data sintetis di bagian 2. Jangan menulis nomor telepon asli, kode OTP, token, atau kunci API di berkas hasil uji.
6. Jangan menguji di produksi tanpa izin tertulis pemilik. Skenario yang mengubah uang, stok, atau akun harus dijalankan di lingkungan uji atau pada depot uji.
7. Setelah menjalankan, isi bagian akhir tiap baris: tanggal, penguji, status (Pass / Fail / Blocked / N/A), nomor cacat.

**Definisi status:** Not Tested (belum dijalankan) · Pass · Fail · Blocked (tidak bisa dijalankan karena prasyarat) · N/A (tidak berlaku di lingkungan).

**Format ID:** `TS-<modul>-<nn>`. Modul: AUTH (akun dan sesi), ORD (pesanan), PAY (pembayaran), DEL (pengiriman), COD (setoran), REF (batal dan refund), GAL (galon), POS (kasir), OPN (opname), APR (approval), PO (pengadaan), INC (insiden dan sengketa), SUB (langganan), LOY (voucher, poin, hadiah), FRA (waralaba), PRC (harga), STF (staf dan akses), HRM (karyawan), ATT (absensi), LEV (cuti), KAS (kasbon), PRL (payroll), ASG (lintas depot), PDP (UU PDP), CLM (klaim kurir), WDR (tarik saldo kurir), JOB (pekerjaan terjadwal), SEC (keamanan dan pembatasan), RPT (laporan dan ekspor), ERR (pemulihan error).

---

## 2. Data uji sintetis dan lingkungan

| Kode | Isi | Catatan |
|---|---|---|
| U-CUS | Pelanggan uji: nomor `+62811000000xx` (sintetis, dibuat oleh tim uji), nama "Pelanggan Uji A", "Pelanggan Uji B" | Nomor harus bisa menerima OTP di lingkungan uji. Jangan ditulis di hasil. |
| U-DEPOT1 / U-DEPOT2 | Dua depot uji berstatus aktif, stok produk cukup, tujuan pembayaran terisi di U-DEPOT1 dan tidak terisi di U-DEPOT2 | Dipakai untuk uji batas lintas depot dan metode bayar. |
| U-WARA | Depot Waralaba uji dengan akun Pemilik waralaba | Contoh dari seed: BDG-01 dan SBY-01 adalah depot waralaba; JKT-01 milik pusat. |
| U-PROD | Produk uji: galon isi ulang, galon baru, air botol | Contoh seed: harga galon isi ulang Rp20.000. **[K]** |
| U-STAF-* | Satu akun per peran: Kepala depot, Staf depot (kurir), Asisten SPV, SPV, Manajer, Direktur, Head office, Finance, Marketing, HR, Pemilik waralaba, Super admin | Finance dan Marketing tidak dibuat oleh seed standar; buat lewat skrip seed-hierarki atau undangan. **[V]** |
| U-VCH | Voucher uji: persen, nominal, gratis ongkir, satu kedaluwarsa, satu kuota habis | Dibuat Manajer/Marketing. |
| U-BANK | Rekening uji sintetis (nama bank, nomor palsu) | Tidak boleh rekening nyata. |
| U-FACE | Perangkat dengan kamera dan GPS; wajah relawan yang memberi persetujuan | Untuk absensi. |
| T-AMBANG | Nilai ambang yang berlaku: refund HQ, auto-pass approval, klaim otomatis, radius check-in, radius depot | Catat dari lingkungan sebelum uji. **[K]** |

Mulai tiap sesi uji dengan: versi aplikasi, lingkungan, matriks akses (ringkas), tanggal, nama penguji.

---

## 3. Skenario uji manual

Kolom: **ID · Skenario bisnis · Aktor/peran · Prasyarat · Data uji · Langkah · Hasil diharapkan · Hasil aktual · Status · Bagian dokumen**. "HA" = "Belum diuji oleh tim dokumentasi". Bagian dokumen merujuk bab panduan (Bab 2–10) dan alur Bab 11 (F01 dst.).

### 3.1 Akun, masuk, dan sesi (AUTH)

| ID | Skenario bisnis | Aktor | Prasyarat | Data uji | Langkah | Hasil diharapkan | Hasil aktual | Status | Bagian dokumen |
|---|---|---|---|---|---|---|---|---|---|
| TS-AUTH-01 | Daftar akun pelanggan dengan data lengkap | Pelanggan | Nomor belum terdaftar | U-CUS; nama; email; persetujuan privasi dicentang | Buka `/register`; isi kolom; tekan **Kirim kode verifikasi**; masukkan 6 digit | Akun aktif, masuk, notifikasi "Selamat datang di Hydromart" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §4 |
| TS-AUTH-02 | Daftar tanpa persetujuan privasi (kolom wajib kosong) | Pelanggan | — | Nomor valid, kotak tidak dicentang | Buka `/register`; isi nomor; jangan centang | Tombol **Kirim kode verifikasi** nonaktif | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §4 |
| TS-AUTH-03 | Nomor tidak valid (input tak valid) | Pelanggan | — | `12345`, `+1555…` (sintetis) | Isi nomor, kirim | "Nomor HP Indonesia tidak valid. Contoh: 081234567890." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §4 |
| TS-AUTH-04 | Email sudah dipakai akun lain | Pelanggan | Ada akun dengan email X | Email X | Daftar dengan email X | "Email ini sudah dipakai akun lain." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §4 |
| TS-AUTH-05 | Masuk dengan OTP benar | Pelanggan | Akun aktif | U-CUS | `/login` → kirim kode → masukkan kode | Masuk, diarahkan ke tujuan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §4 |
| TS-AUTH-06 | OTP salah lima kali | Pelanggan | Akun aktif | Kode salah ×5 | Masukkan kode salah berulang | "Terlalu banyak percobaan. Minta kode baru." Kotak terkunci | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §4 |
| TS-AUTH-07 | OTP kedaluwarsa (sesi/kode kedaluwarsa) | Pelanggan | Kode dikirim | Tunggu > 5 menit | Masukkan kode lama | "Kode verifikasi sudah kedaluwarsa. Minta kode baru." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §4 |
| TS-AUTH-08 | Kirim ulang kode sebelum 60 detik (kirim ganda) | Pelanggan | Kode baru dikirim | — | Tekan kirim ulang cepat berkali-kali | "Kode baru bisa diminta sebentar lagi…"; hitung mundur "Kirim ulang dalam {n}d" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §4 |
| TS-AUTH-09 | Masuk dengan akun dinonaktifkan | Pelanggan/staf | Akun SUSPENDED/DELETED | Akun uji | Masuk dengan OTP | "Akun ini tidak aktif. Hubungi dukungan Hydromart." (staf: "This account has been suspended.") | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §4, Bab 10 §6.5 |
| TS-AUTH-10 | Sesi kedaluwarsa karena menganggur | Staf | Kebijakan menit idle diatur | Idle melewati batas | Tunggu, lalu lakukan aksi setelah token segar kedaluwarsa | Diminta masuk lagi ("The session was idle for too long.") | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.13 |
| TS-AUTH-11 | Ganti nomor telepon | Pelanggan | Masuk | Nomor baru sintetis | `/account/edit` → Ganti nomor → kode → konfirmasi | Semua perangkat keluar; SMS ke nomor lama | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §4 |
| TS-AUTH-12 | Ganti nomor ke nomor sudah dipakai | Pelanggan | Nomor B sudah akun lain | Nomor B | Ganti ke B | "Nomor ini sudah terdaftar. Silakan masuk." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §4 |
| TS-AUTH-13 | Keluar dari semua perangkat | Pelanggan | Dua sesi aktif | Dua perangkat | Akun → Keluar dari semua perangkat | Kedua perangkat diminta masuk lagi | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 (perangkat dan persetujuan) |

### 3.2 Pesanan pelanggan (ORD), pembayaran (PAY), pengiriman (DEL), setoran (COD)

| ID | Skenario bisnis | Aktor | Prasyarat | Data uji | Langkah | Hasil diharapkan | Hasil aktual | Status | Bagian dokumen |
|---|---|---|---|---|---|---|---|---|---|
| TS-ORD-01 | Checkout pesanan COD dalam jangkauan | Pelanggan | Keranjang berisi; alamat bertitik di radius U-DEPOT1 | U-CUS, U-PROD ×2 | Checkout; metode **Bayar di tempat**; **Buat pesanan** | Banner "Pesanan berhasil dibuat!"; status Dipesan; depot menerima notifikasi | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6, F01 |
| TS-ORD-02 | Alamat di luar radius | Pelanggan | Titik di luar semua depot | Koordinat jauh | Checkout | Tombol nonaktif atau pesan "Titik alamat ini di luar radius antar semua depot kami…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-ORD-03 | Di bawah minimum pesanan | Pelanggan | Minimum depot Rp X | Subtotal < X | Checkout | "Minimum pesanan di depot ini Rp {min}. Kurang Rp {kurang} lagi." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-ORD-04 | Keranjang kosong (kolom wajib kosong) | Pelanggan | Keranjang kosong | — | Buka `/checkout` | "Keranjangmu kosong. Tambahkan produk sebelum checkout." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-ORD-05 | Alamat belum lengkap | Pelanggan | Alamat baru tanpa kota | Kolom Kota kosong | Checkout | "Lengkapi alamat pengiriman dulu." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-ORD-06 | Tekan Buat pesanan dua kali (kirim ganda) | Pelanggan | Checkout siap | — | Klik dua kali cepat | Hanya satu pesanan terbentuk | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-ORD-07 | Stok tidak cukup | Pelanggan | Stok U-PROD kecil | Jumlah > stok | Checkout | "Insufficient stock at the fulfilling depot: {kode} (need n, have m)." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-ORD-08 | Antar sekarang saat depot tutup | Pelanggan | Di luar jam depot | — | Pilih Antar sekarang | "Depot sedang tutup — antar sekarang tidak tersedia…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-ORD-09 | Kepala depot memajukan pesanan | Kepala depot | Pesanan Dipesan di depotnya | Pesanan TS-ORD-01 | Antrean → **Proses** → **Lanjut ke Confirmed** → **Lanjut ke Preparing** | Status Dikonfirmasi lalu Disiapkan; pindah ke chip "Perlu ditugaskan"; pelanggan diberi tahu saat Dikonfirmasi | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.2, F01 |
| TS-ORD-10 | Dua staf memperbarui pesanan bersamaan | Kepala depot, Manajer | Pesanan sama terbuka di dua sesi | — | Keduanya menekan Lanjut | Satu berhasil, satu mendapat "This order was already updated by someone else. Reload and try again." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.2 |
| TS-ORD-11 | Pelanggan melacak dan melihat kurir | Pelanggan | Pesanan ditugaskan | — | Buka rincian pesanan | Bilah kemajuan, kartu kurir, penyegaran 15 detik | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-ORD-12 | Bagikan tautan lacak | Pelanggan | Pesanan punya tautan | — | **Bagikan link lacak**, buka tanpa login | Hanya nomor, status, kota, ETA, nama depan kurir; tanpa nama/telepon/alamat | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-ORD-13 | Menilai pesanan | Pelanggan | Pesanan Tiba/Selesai | 5 bintang | **Nilai pesanan** → **Kirim ulasan** | "Terima kasih atas ulasanmu!"; ulang → "Pesanan ini sudah dinilai." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-PAY-01 | Transfer dengan bukti dan konfirmasi staf | Pelanggan, Kepala depot | Metode transfer di U-DEPOT1 | Foto jpeg < 5 MB | Pelanggan unggah bukti; staf **Konfirmasi lunas** | Pembayaran PAID; pesanan Dikonfirmasi | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6, Bab 3 §6.2 |
| TS-PAY-02 | Bukti bayar format tidak didukung | Pelanggan | Pembayaran transfer | Berkas PDF | Pilih foto | "unsupported file type (allowed: jpeg, png, webp)" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-PAY-03 | Bukti bayar > 5 MB | Pelanggan | — | Gambar 8 MB | Pilih foto | Dikompres atau ditolak sesuai batas; catat perilaku | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-PAY-04 | Depot tanpa tujuan pembayaran | Pelanggan | U-DEPOT2 | — | Pilih transfer/QRIS | "Depot belum mengatur rekening/QRIS. Hubungi depot." atau hanya tunai ditawarkan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-PAY-05 | Tandai pembayaran gagal lalu bayar lagi | Kepala depot, Pelanggan | Pembayaran PENDING | — | **Tandai gagal** → pelanggan **Coba bayar lagi** | Pembayaran FAILED lalu pembayaran baru; pesanan tetap ada | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.2 |
| TS-PAY-06 | Pembayaran non-tunai tidak dikonfirmasi 24 jam | Sistem | Pembayaran transfer PENDING | Tunggu > 24 jam (atau ubah TTL di lingkungan uji) | Biarkan sapuan jam :25 | Pembayaran Gagal; tunai tidak tersentuh | Belum diuji oleh tim dokumentasi | Not Tested | F22 |
| TS-PAY-07 | Gerbang pembayaran online (EWALLET/VA) | Pelanggan | Penyedia aktif di lingkungan uji **[K]** | Stub gerbang | Bayar, webhook PAID bertanda tangan | Pesanan Dikonfirmasi otomatis | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-DEL-01 | Penugasan kurir berhasil | Kepala depot | Pesanan Disiapkan; kurir Online | Kurir uji | Antrean → **Tugaskan** → pilih kurir | Status Kurir ditugaskan; kurir menerima tugas | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.2 |
| TS-DEL-02 | Kurir belum check-in | Kepala depot | Kurir tanpa shift | — | Tugaskan | "This courier is not checked in and available." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.2 |
| TS-DEL-03 | Kurir melebihi batas aktif | Kepala depot | Kurir sudah pegang 1 antar | Batas 1 | Tugaskan lagi | "This driver already has the maximum number of active deliveries." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.2 |
| TS-DEL-04 | Check-in shift di luar radius | Kurir | Jarak > batas | 300 m dari depot | Mulai shift | "You are {n} m from the depot. Check in within {r} m." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.1 |
| TS-DEL-05 | Antar non-COD selesai dengan bukti | Kurir | Status Diantar | Foto, segel utuh, nama penerima sintetis | **Selesaikan · ambil bukti** | Pengantaran Selesai; pesanan Tiba lalu Selesai; poin diberikan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.6 |
| TS-DEL-06 | Bukti tanpa foto atau nama penerima | Kurir | Status Diantar | Foto kosong | Selesaikan | "Ambil foto bukti pengantaran dulu."; "Isi nama penerima." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.6 |
| TS-DEL-07 | Bukti diambil jauh dari alamat | Kurir | `proofRadiusEnforced` aktif **[K]** | GPS 800 m | Selesaikan | Ditolak dengan pesan jarak; bila fitur mati, diterima | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.6 |
| TS-DEL-08 | Antar gagal dan uang dikembalikan | Kurir | Pesanan COD, uang sudah diterima | "Sudah saya kembalikan" | **Gagal** → alasan → jawab pertanyaan uang | Pengantaran Gagal; pesanan Dibatalkan; pembayaran tunai dibalik | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.7 |
| TS-DEL-09 | No-show kurang upaya kontak | Kurir | Status Diantar | 1 upaya, < 5 menit | **Tandai tidak di tempat** | "A no-show needs at least {n} contact attempts and {s}s of waiting." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.8 |
| TS-DEL-10 | Jadwal ulang lalu penugasan ulang | Kurir, Kepala depot | Status Diantar | Waktu baru ke depan | **Jadwal ulang** → simpan; Kepala depot tugaskan lagi | Pesanan kembali Disiapkan; pelanggan diberi tahu "Pengiriman dijadwalkan ulang" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.9 |
| TS-DEL-11 | Waktu jadwal ulang sudah lewat | Kurir | — | Waktu lampau | Simpan | "Waktu antar ulang tidak boleh sudah lewat" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.9 |
| TS-DEL-12 | Tarik pengiriman ke antrean | Kepala depot | Pengiriman aktif | Alasan | **Tarik ke antrean** | Pesanan kembali ke Disiapkan; alasan wajib | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.3 |
| TS-DEL-13 | Kurir offline menyelesaikan antar | Kurir | Putuskan jaringan | Bukti lengkap | Selesaikan offline; sambung jaringan | Tersimpan di HP; terkirim otomatis; tidak diulang | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.14 |
| TS-DEL-14 | Kurir mengakses pengantaran kurir lain (akses tak sah) | Kurir B | Pengantaran milik kurir A | ID pengantaran | Buka/ubah lewat URL atau API | 403 "This delivery is assigned to another driver." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.4 |
| TS-COD-01 | COD: terima uang dan kembalian | Kurir | Pesanan COD Diantar | Total Rp 45.000; diterima Rp 50.000 | **Terima uang** → pecahan → **Konfirmasi pembayaran** | Kembalian Rp 5.000; tombol bukti aktif | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.5 |
| TS-COD-02 | Uang kurang dari total | Kurir | — | Rp 30.000 | Konfirmasi | "Kurang dari total tagihan." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.5 |
| TS-COD-03 | Setoran akhir shift pas | Kurir, Kepala depot | Shift Selesai (check-out) | Jumlah = wajib | Kurir **Setor ke kasir**; Kepala depot **Verifikasi** | Setoran Terverifikasi; riwayat tampil di aplikasi kurir | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.11, Bab 3 §6.5 |
| TS-COD-04 | Setoran sebelum check-out | Kurir | Shift masih Online | — | Setor | "Check out of the shift before settling its cash." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.11 |
| TS-COD-05 | Setoran kurang, selisih dibebankan | Kepala depot | Setoran kurang | Kurang Rp 10.000 | Centang **Bebankan selisih** → Verifikasi | Potongan "Selisih kurang setoran COD" di penghasilan kurir | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.5 |
| TS-COD-06 | Setoran lebih tanpa catatan | Kepala depot | Lebih > Rp 5.000 | Lebih Rp 8.000, catatan kosong | Verifikasi | "Explain the surplus in the note before verifying this deposit." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.5 |
| TS-COD-07 | Sengketakan tanpa alasan | Kepala depot | — | Alasan kosong | **Sengketakan** | "Isi alasan sengketa." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.5 |
| TS-COD-08 | Setoran dikirim dua kali | Kurir | Shift sudah disetor | — | Setor lagi | "This shift has already been settled." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.11 |
| TS-COD-09 | Kurir mencoba verifikasi setoran sendiri (akses tak sah) | Kurir | — | — | Buka `/dashboard/settlements` | Ditolak; hak `courierSettle` tidak dimiliki | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §9 |
| TS-COD-10 | Pembebanan ke buku upah gagal | Kepala depot | Layanan penghasilan terganggu (simulasi) **[D]** | — | Verifikasi dengan beban | "Pembebanan selisih ke kurir belum tercatat…" setoran tetap menunggu; aman diulang | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.5 |

### 3.3 Pembatalan dan refund (REF), galon (GAL)

| ID | Skenario bisnis | Aktor | Prasyarat | Data uji | Langkah | Hasil diharapkan | Hasil aktual | Status | Bagian dokumen |
|---|---|---|---|---|---|---|---|---|---|
| TS-REF-01 | Pelanggan membatalkan pesanan belum ditugaskan, belum bayar | Pelanggan | Status Dipesan | Alasan "Berubah pikiran" | **Batalkan pesanan** | Status Dibatalkan; pembayaran Gagal; stok dilepas | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6, F02 |
| TS-REF-02 | Pembatalan setelah kurir ditugaskan | Pelanggan | Status Kurir ditugaskan | — | Buka rincian | Tombol hilang; pesan "Kurir sudah ditugaskan…"; tombol **Hubungi depot** | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-REF-03 | Batal setelah jadwal ulang (pernah ditugaskan) | Pelanggan | Pesanan pernah Ditugaskan lalu kembali Disiapkan | — | Coba batal | Tidak bisa dibatalkan pelanggan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-REF-04 | Batal pesanan lunas ≤ ambang | Pelanggan, Finance | Pembayaran PAID ≤ Rp100.000 | Total Rp 60.000 | Batal | Refund diproses langsung; pembayaran REFUNDED | Belum diuji oleh tim dokumentasi | Not Tested | F02 |
| TS-REF-05 | Batal pesanan lunas > ambang | Pelanggan | PAID > Rp100.000 | Total Rp 150.000 | Batal | Persetujuan refund PENDING; muncul di `/hq/refunds`; uang belum bergerak | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.7 |
| TS-REF-06 | Finance menyetujui refund | Finance | Item PENDING | — | `/hq/refunds` → **Setujui** | Toast "Refund {order} disetujui"; pembayaran REFUNDED | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.7 |
| TS-REF-07 | Finance menolak refund tanpa alasan | Finance | Item PENDING | Alasan kosong | **Tolak** | Alasan wajib; tidak bisa lanjut | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.7 |
| TS-REF-08 | Head office mencoba menyetujui refund (akses tak sah) | Head office | Item PENDING | — | Tekan **Setujui** | Server menolak (tidak punya `refundQueue`) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.7 [B] |
| TS-REF-09 | Kepala depot mencari tombol Ajukan refund | Kepala depot | Pembayaran PAID | — | Buka rincian pesanan | Tombol **Ajukan refund** tidak tampil | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.2 |
| TS-REF-10 | Menolak refund untuk pesanan yang sudah dibatalkan | Finance | Pesanan Dibatalkan, refund PENDING | — | Cari tombol Tolak | Tombol tidak muncul; "Pesanan dibatalkan — refund wajib dikembalikan" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.7 |
| TS-REF-11 | Refund diputuskan dua kali | Finance | Item sudah APPROVED | — | Setujui lagi (dua tab) | "This refund is not awaiting approval." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.7 |
| TS-REF-12 | Pembatalan otomatis pesanan terbengkalai | Sistem | Pesanan Dipesan > batas menit **[K]** | Pesanan uji | Tunggu sapuan jam :05 | Pesanan Dibatalkan; pelanggan menerima notifikasi | Belum diuji oleh tim dokumentasi | Not Tested | F22 |
| TS-REF-13 | Pembalikan pembayaran gagal saat batal | Pelanggan | Layanan pembayaran terganggu (simulasi) **[D]** | — | Batal | Pesanan tidak dibatalkan (gagal-tertutup) | Belum diuji oleh tim dokumentasi | Not Tested | F02 |
| TS-REF-14 | Sengketa dengan resolusi Refund > ambang | Kepala depot/SPV/Manajer | Sengketa Terbuka | Nilai Rp 150.000 | **Refund** | Permintaan refund menunggu persetujuan Finance | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 (Sengketa) |
| TS-GAL-01 | Retur galon baik oleh kurir | Kurir | Pengantaran Diantar | 2 galon, Baik | **Retur galon kosong** → **Catat retur** | "Retur tercatat"; stok galon bertambah | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.10 |
| TS-GAL-02 | Retur galon rusak | Kurir | — | 1 galon, Rusak | Catat | Deposit tidak dikembalikan di layar kurir; persetujuan DEPOSIT_REFUND dibuat bila > ambang | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.10, F03 |
| TS-GAL-03 | Retur jumlah 0 | Kepala depot | — | 0 | **Simpan retur** | "Masukkan jumlah galon (lebih dari 0)." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.7 |
| TS-GAL-04 | Refund deposit melebihi yang ditahan | Kepala depot | Deposit tertahan kecil | Deposit Rp 100.000 > tertahan | Simpan | "Deposit refund exceeds the deposit this depot still holds…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.7 |
| TS-GAL-05 | Retur melebihi galon beredar | Kepala depot | Beredar 3 | Retur 30 | Simpan | Retur tercatat; persetujuan GALLON_VARIANCE bila nilai > ambang | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.7 |
| TS-GAL-06 | Retur kurir diulang karena offline | Kurir | Retur sudah tercatat | Ulang kirim | Kirim ulang | "Sudah tercatat sebelumnya" (tidak ganda) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.10 |
| TS-GAL-07 | Pengingat galon belum kembali | Sistem | Pelanggan melewati batas pinjam | — | Sapuan 09:00 | Notifikasi "Galon belum dikembalikan"; tidak lebih dari sekali per 7 hari | Belum diuji oleh tim dokumentasi | Not Tested | F22 |

### 3.4 Kasir (POS), opname (OPN), approval (APR), pengadaan (PO)

| ID | Skenario bisnis | Aktor | Prasyarat | Data uji | Langkah | Hasil diharapkan | Hasil aktual | Status | Bagian dokumen |
|---|---|---|---|---|---|---|---|---|---|
| TS-POS-01 | Buka shift kasir | Kepala depot | Tidak ada shift terbuka | Modal Rp 200.000 | **Buka shift** | "Shift dibuka."; bilah "Shift terbuka" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4, F04 |
| TS-POS-02 | Buka shift kedua | Kepala depot | Shift terbuka | — | Buka lagi | "You already have an open shift at this depot…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-03 | Jual tanpa shift | Kepala depot | Tidak ada shift | — | Simpan penjualan | Tombol "Buka shift dulu" nonaktif; server "Buka shift kasir dulu…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-04 | Penjualan tunai pas | Kepala depot | Shift terbuka; stok | Galon ×2, tunai pas | **Simpan & cetak struk** | Pesanan Selesai (lencana Walk-in); struk terbuka | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-05 | Tunai kurang | Kepala depot | — | Tunai < total | Simpan | "Uang tunai kurang dari total." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-06 | Simpan dua kali (kirim ganda) | Kepala depot | — | Tombol sama | Klik/ulang | Satu penjualan (kunci idempotensi) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-07 | Voucher tanpa nomor HP | Kepala depot | Voucher uji | Kode, HP kosong | Simpan | "Isi nomor HP pembeli dulu — voucher menempel pada akun." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-08 | Batalkan penjualan salah input | Kepala depot | Penjualan dibuat dalam shift | Alasan sintetis | **Batalkan penjualan** | Status Dibatalkan di kasir; stok kembali; poin ditarik | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-09 | Batalkan tanpa alasan | Kepala depot | — | Alasan kosong | Konfirmasi | Alasan wajib | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-10 | Batalkan penjualan hari lain | Kepala depot | Penjualan kemarin | — | Batalkan | "Penjualan ini bukan hari ini… Ajukan refund." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-11 | Tutup shift dengan selisih | Kepala depot | Shift berpenjualan | Hitung kurang Rp 5.000 | **Tutup shift** → hitung | Kartu "Shift ditutup": Seharusnya, Dihitung, Selisih negatif (merah) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-12 | Tutup shift milik kasir lain | Kepala depot | Shift kasir B terbuka | — | Coba tutup | "This shift belongs to another cashier."; Manajer dapat menutup | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-13 | Tutup buku dengan shift terbuka | Kepala depot | Shift terbuka | — | **Tutup buku** | "Masih ada {n} shift kasir terbuka…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.9 |
| TS-POS-14 | Tutup buku sukses | Kepala depot | Semua shift tertutup | Tanggal hari ini | **Tutup buku** | Lencana "Buku ditutup"; snapshot kas | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.9 |
| TS-POS-15 | Tutup buku dua kali | Kepala depot | Hari sudah ditutup | — | Tutup lagi | "Hari ini sudah ditutup." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.9 |
| TS-POS-16 | Kepala depot mencari tombol Buka kembali | Kepala depot | Hari ditutup | — | Buka laporan harian | Tombol **Buka kembali** tidak tampil | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.9 |
| TS-POS-17 | Head office membuka kembali hari | Head office | Hari ditutup | — | `/dashboard/reports` → **Buka kembali** | Hari terbuka; bisa ditutup lagi | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.30 |
| TS-POS-18 | Direktur/Finance mencoba Buka kembali (akses tak sah) | Direktur | Hari ditutup | — | Cari/tekan tombol | Tidak tersedia atau ditolak | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.30 |
| TS-POS-19 | Tutup buku saat COD belum terverifikasi | Kepala depot | COD belum disetor > 0 | — | Tutup buku | Sistem **tidak** memblokir (perilaku yang didokumentasikan) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.9 [B] |
| TS-POS-20 | Total COD tak terbaca saat tutup | Kepala depot | Layanan pembayaran terganggu **[D]** | — | Tutup buku | Gagal aman, tidak jadi ditutup | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.9 |
| TS-OPN-01 | Opname selisih kecil | Kepala depot | Baris stok berharga jual | Selisih bernilai ≤ ambang | Simpan opname | Stok berubah; tidak ada persetujuan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.6, F05 |
| TS-OPN-02 | Opname selisih besar | Kepala depot | — | Selisih bernilai > Rp100.000 | Simpan opname | Stok langsung berubah; persetujuan "Selisih opname" PENDING | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.6 |
| TS-OPN-03 | Opname nilai negatif atau kosong | Kepala depot | — | `-3`, kosong | Simpan | "Isi jumlah 0 atau lebih." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.6 |
| TS-OPN-04 | Opname massal sebagian gagal | Kepala depot | — | 3 baris, 1 tidak sah | **Opname massal** | "{n} baris gagal disimpan…"; angka tetap di layar | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.6 |
| TS-OPN-05 | Penyesuaian stok di bawah nol | Kepala depot | Stok 3 | -5 | Sesuaikan | "Adjustment would drive stock below zero." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.6 |
| TS-OPN-06 | Opname membuat hitungan < jumlah dipesan | Kepala depot | Ada stok dipesan | Hitung < dipesan | Simpan | Persetujuan "Stok kurang dari pesanan: {item}" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.6 |
| TS-OPN-07 | Transfer stok antar depot | Kepala depot A, B | Dua depot | Jumlah ≤ tersedia | A kirim; B **Terima** | Stok A berkurang; stok B bertambah; status Di jalan → Diterima | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.6 |
| TS-OPN-08 | Transfer ke depot sama atau kelebihan | Kepala depot | — | Tujuan = asal | Kirim | "Depot asal dan tujuan sama." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.6 |
| TS-OPN-09 | Kepala depot A menerima transfer milik depot lain (batas lintas depot) | Kepala depot A | Transfer tujuan depot C | ID transfer | Terima lewat API/URL | Ditolak (akses depot) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §9 |
| TS-APR-01 | Manajer menyetujui item | Manajer | Item PENDING dari orang lain | — | `/dashboard/approvals` → Setujui | Item APPROVED; stok tidak berubah | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.3 |
| TS-APR-02 | Tolak tanpa alasan | Manajer | Item PENDING | Catatan kosong | Tolak | "Isi alasan penolakan." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.3 |
| TS-APR-03 | Tahan lalu putuskan | Manajer | Item PENDING | — | Tahan; buka lewat tautan; Setujui | HELD lalu APPROVED | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.3 |
| TS-APR-04 | Pengaju memutuskan pengajuannya sendiri | Manajer yang juga pengaju | Item diajukan oleh Manajer itu | — | Setujui | "Pengaju tidak boleh memutuskan pengajuannya sendiri — teruskan ke atasan." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.3 |
| TS-APR-05 | Keputusan dua kali | Manajer | Item APPROVED | — | Setujui lagi | "This approval item has already been approved or rejected." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.3 |
| TS-APR-06 | SPV/Kepala depot membuka antrean (akses tak sah) | SPV | — | — | Buka `/dashboard/approvals` | Tidak tampil/ditolak | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 §5.2 |
| TS-APR-07 | Manajer depot lain (lintas depot) | Manajer | Item milik depot di luar cakupan | — | Buka detail via URL | "Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.1 |
| TS-APR-08 | Nilai di bawah ambang otomatis disetujui | Kepala depot | Ambang Rp100.000 | Nilai Rp 50.000 | Picu retur rusak kecil | Item APPROVED "Disetujui otomatis (di bawah ambang)" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.3 |
| TS-APR-09 | Ubah batas auto-pass oleh Manajer (akses tak sah) | Manajer | — | Nilai baru | Ubah di Pengaturan | 403 "You do not have permission to perform this action." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.30 |
| TS-APR-10 | Ubah batas auto-pass oleh Super admin | Super admin | — | Rp 150.000 | Pengaturan → Simpan | Tersimpan; tercatat di audit | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.30, Bab 10 §6.16 |
| TS-PO-01 | Buat dan kirim PO | Manajer | Pemasok; stok di bawah titik pesan | Item, biaya Rp 15.000 | **Buat PO draft** → **Kirim ke pemasok** | Draft → Dikirim | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.4, F06 |
| TS-PO-02 | PO tanpa pemasok atau item | Manajer | — | — | Buat | "Pilih pemasok dulu."; "Pilih minimal satu item." | Belum diuji oleh tim dokumentasi | Not Tested | F06 |
| TS-PO-03 | Biaya satuan kosong | Manajer | — | Biaya 0 | Buat | `unitCostIdr must be at least 1…` | Belum diuji oleh tim dokumentasi | Not Tested | F06 |
| TS-PO-04 | Terima sebagian lalu sisanya tidak datang | Manajer | PO Dikirim | Datang 8 dari 10; alasan | Terima | Stok +8 (RECEIPT); baris ditutup "Kurang kirim" | Belum diuji oleh tim dokumentasi | Not Tested | F06 |
| TS-PO-05 | Terima melebihi sisa | Manajer | PO Dikirim | 12 dari 10 | Terima | "Line N … would exceed the M still outstanding…" | Belum diuji oleh tim dokumentasi | Not Tested | F06 |
| TS-PO-06 | Kirim PO yang bukan Draft | Manajer | PO Dikirim | — | Kirim lagi | "Only a DRAFT purchase order can be sent." | Belum diuji oleh tim dokumentasi | Not Tested | F06 |
| TS-PO-07 | Terima PO yang masih Draft | Manajer | PO Draft | — | Terima | "Only a SENT purchase order can be received." | Belum diuji oleh tim dokumentasi | Not Tested | F06 |
| TS-PO-08 | Kepala depot / SPV membuka PO (akses tak sah) | Kepala depot | — | — | Buka `/dashboard/purchase-orders` | Ditolak; gerbang "Khusus manajer depot" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.4 |
| TS-PO-09 | Hapus pemasok yang dipakai PO | Manajer | Pemasok punya PO | — | Hapus | Ditolak oleh server | Belum diuji oleh tim dokumentasi | Not Tested | F06 |
