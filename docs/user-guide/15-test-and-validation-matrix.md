# Bab 15 — Matriks Uji dan Validasi

| Metadata | Nilai |
|---|---|
| Versi | 0.1 draf |
| Tanggal | 2026-10-10 |
| Klasifikasi | Internal — Terbatas |
| Status pengujian | **Eksekusi terstruktur parsial 2026-10-14** di stack uji lokal pada kode setelah PR #664 (lihat bagian "Eksekusi terstruktur 2026-10-14" di akhir bab): skenario alur uang yang dijalankan berstatus Pass/Fail/Blocked; semua skenario lain tetap "Not Tested". |
| Dokumen pasangan | Bab 11 (Proses Bisnis End-to-End) dan Bab 2–10 (panduan peran). |

**Pembaruan 2026-10-14 (sejak PR #664).** Ekspektasi skenario dicocokkan ulang dengan kode setelah PR #664 digabung (`docs/OPEN_GAPS_DECISIONS_2026-10.md`). Ekspektasi yang berubah ditandai "(sejak PR #664)". Skenario baru ber-ID lanjutan (mis. TS-PRL-16 s.d. TS-PRL-21, TS-STF-23 s.d. TS-STF-28, TS-PDP-13 s.d. TS-PDP-16) berstatus Not Tested. Sebagian skenario sudah dijalankan pada 2026-10-14 (lihat "Eksekusi terstruktur 2026-10-14" di akhir bab); baris yang dijalankan membawa hasil aktual, status, dan cap "2026-10-14, uji lokal, kode setelah PR #664". Baris tanpa cap itu tetap Not Tested.

**Legenda bukti.** **[V]** terverifikasi di kode · **[D]** disimpulkan, perlu konfirmasi · **[K]** perlu konfirmasi bisnis · **[B]** diketahui bermasalah/tidak konsisten.

**Catatan hak akses.** Hak akses dalam skenario adalah nilai BAWAAN dari `packages/access/src/index.ts`. Super admin dapat mengubahnya saat runtime (±30 detik). Sebelum menguji, catat matriks yang sedang berlaku (`/hq/access`) agar hasil dapat dibandingkan. **[V]**

---

## 1. Tujuan dan aturan pemakaian

1. Bab ini memberi **rencana uji manual terstruktur** untuk setiap alur di Bab 11. Penguji (tim QA atau pemilik proses) menjalankan sendiri, lalu mengisi kolom hasil aktual dan status.
2. Kolom **Hasil aktual** berisi "Belum diuji oleh tim dokumentasi" dan kolom **Status** berisi "Not Tested" pada baris yang belum dijalankan (baris yang sudah dijalankan pada 2026-10-14 membawa hasilnya sendiri). **Jangan mengubah status menjadi Pass kecuali Anda sendiri menjalankan skenario dan menyimpan buktinya** (tangkapan layar, ID pesanan sintetis, jam).
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
| TS-AUTH-09 | Masuk dengan akun dinonaktifkan | Pelanggan/staf | Akun SUSPENDED/DELETED | Akun uji | Masuk dengan OTP | "Akun ini tidak aktif. Hubungi dukungan Hydromart." (staf: "This account has been suspended.") (sejak PR #664: sesi yang sudah ada tidak bisa diperpanjang, lihat TS-SEC-10) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §4, Bab 10 §6.5 |
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
| TS-ORD-09 | Kepala depot memajukan pesanan | Kepala depot | Pesanan Dipesan di depotnya | Pesanan TS-ORD-01 | Antrean → **Proses** → **Lanjut ke Dikonfirmasi** → **Lanjut ke Disiapkan** | Status Dikonfirmasi lalu Disiapkan; pindah ke chip "Perlu ditugaskan"; pelanggan diberi tahu saat Dikonfirmasi | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.2, F01 |
| TS-ORD-10 | Dua staf memperbarui pesanan bersamaan | Kepala depot, Manajer | Pesanan sama terbuka di dua sesi | — | Keduanya menekan Lanjut | Satu berhasil, satu mendapat "This order was already updated by someone else. Reload and try again." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.2 |
| TS-ORD-11 | Pelanggan melacak dan melihat kurir | Pelanggan | Pesanan ditugaskan | — | Buka rincian pesanan | Bilah kemajuan, kartu kurir, penyegaran 15 detik | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-ORD-12 | Bagikan tautan lacak | Pelanggan | Pesanan punya tautan | — | **Bagikan link lacak**, buka tanpa login | Hanya nomor, status, kota, ETA, nama depan kurir; tanpa nama/telepon/alamat | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-ORD-13 | Menilai pesanan | Pelanggan | Pesanan Tiba/Selesai | 5 bintang | **Nilai pesanan** → **Kirim ulasan** | "Terima kasih atas ulasanmu!"; ulang → "Pesanan ini sudah dinilai." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-ORD-14 | Label status pesanan berbahasa Indonesia (sejak PR #664) | Pelanggan, Kepala depot | Pesanan di beberapa status | Pesanan TS-ORD-01 dan lanjutannya | Buka daftar pesanan, rincian pesanan, `/track`, struk, dan Antrean staf | Label: Dipesan, Dikonfirmasi, Disiapkan, Kurir ditugaskan, Diambil kurir, Dalam perjalanan, Tiba, Selesai, Dibatalkan, Dibatalkan di kasir; tidak ada label Inggris (Order placed, dst.) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6, Bab 14 §4.1 |
| TS-ORD-15 | Checkout menampilkan estimasi Deposit galon, tidak masuk total (sejak PR #664) | Pelanggan | Keranjang berisi galon; depot punya tarif deposit > 0 | U-PROD galon ×2 | Buka `/checkout`; bandingkan baris dan total | Baris "Deposit galon (2 galon)" dengan keterangan "Titipan yang dicatat depot saat galon diantar, dikembalikan saat galon kembali. Belum termasuk dalam total yang dibayar."; total pesanan TIDAK bertambah; bila tarif tidak terbaca atau 0, baris tidak tampil | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6, Bab 13 T-21 |
| TS-ORD-16 | Pemberitahuan layar per-depot saat "Semua depot" (sejak PR #664) | Manajer/SPV dengan ≥ 2 depot | Pemilih depot = Semua depot | — | Buka layar per-depot (mis. Persetujuan, Setoran); lalu buka Pesanan (gabungan) | Layar per-depot menampilkan "Menampilkan {nama depot}. Layar ini bekerja per depot, bukan gabungan. Pilih depot di pojok kiri untuk beralih."; layar gabungan (pesanan, churn, aturan promo, impor) tidak menampilkannya | Belum diuji oleh tim dokumentasi | Not Tested | Bab 13 T-15 |
| TS-PAY-01 | Transfer dengan bukti dan konfirmasi staf | Pelanggan, Kepala depot | Metode transfer di U-DEPOT1 | Foto jpeg < 5 MB | Pelanggan unggah bukti; staf **Konfirmasi lunas** | Pembayaran PAID; pesanan Dikonfirmasi | Transfer dibuat PENDING (pesanan CREATED); unggah jpeg 201; Kepala depot konfirmasi -> PAID, pesanan CONFIRMED. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 2 §6, Bab 3 §6.2 |
| TS-PAY-02 | Bukti bayar format tidak didukung | Pelanggan | Pembayaran transfer | Berkas PDF | Pilih foto | "unsupported file type (allowed: jpeg, png, webp)" | API: berkas PDF -> 400 "unsupported file type (allowed: jpeg, png, webp)"; tanpa berkas -> 400 "file is required". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 2 §6 |
| TS-PAY-03 | Bukti bayar > 5 MB | Pelanggan | — | Gambar 8 MB | Pilih foto | Dikompres atau ditolak sesuai batas; catat perilaku | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-PAY-04 | Depot tanpa tujuan pembayaran | Pelanggan | U-DEPOT2 | — | Pilih transfer/QRIS | "Depot belum mengatur rekening/QRIS. Hubungi depot." atau hanya tunai ditawarkan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-PAY-05 | Tandai pembayaran gagal lalu bayar lagi | Kepala depot, Pelanggan | Pembayaran PENDING | — | **Tandai gagal** → pelanggan **Coba bayar lagi** | Pembayaran FAILED lalu pembayaran baru; pesanan tetap ada | Kepala depot tandai gagal -> FAILED; pelanggan bayar lagi -> pembayaran baru PENDING; pesanan tetap CREATED. Tombol UI tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 3 §6.2 |
| TS-PAY-06 | Pembayaran non-tunai tidak dikonfirmasi 24 jam | Sistem | Pembayaran transfer PENDING | Tunggu > 24 jam (atau ubah TTL di lingkungan uji) | Biarkan sapuan jam :25 | Pembayaran Gagal; tunai tidak tersentuh | Waktu disimulasikan (createdAt pembayaran dimundurkan 30 jam di DB uji) lalu sapuan internal expire-pending: transfer PENDING -> FAILED (expired 1), pembayaran tunai PENDING tidak tersentuh. Jam :25 tidak ditunggu. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | F22 |
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
| TS-COD-02 | Uang kurang dari total | Kurir | — | Rp 30.000 | Konfirmasi | "Kurang dari total tagihan." | API: terima Rp30.000 dari Rp50.000 -> 422 PAYMENT_CASH_SHORT, pesan Inggris "Cash received (30000) is less than the amount due (50000)." (kalimat Indonesia "Kurang dari total tagihan." berasal dari UI, tidak diperiksa). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.5 |
| TS-COD-03 | Setoran akhir shift pas | Kurir, Kepala depot | Shift Selesai (check-out) | Jumlah = wajib | Kurir **Setor ke kasir**; Kepala depot **Verifikasi** | Setoran Terverifikasi; riwayat tampil di aplikasi kurir | Shift check-out, kurir setor sesuai (Rp50.000): Kepala depot Verifikasi -> VERIFIED. Riwayat di aplikasi kurir tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.11, Bab 3 §6.5 |
| TS-COD-04 | Setoran sebelum check-out | Kurir | Shift masih Online | — | Setor | "Check out of the shift before settling its cash." | API: setor sebelum check-out -> 422 SHIFT_NOT_ENDED "Check out of the shift before settling its cash.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.11 |
| TS-COD-05 | Setoran kurang, selisih dibebankan (sejak PR #664: oleh Manajer) | Manajer (atau Super admin) | Setoran kurang | Kurang Rp 10.000 | Centang **Bebankan selisih** → Verifikasi | Potongan "Selisih kurang setoran COD" di penghasilan kurir | Setoran kurang Rp10.000: Manajer verifikasi dengan chargedToDriver -> VERIFIED, chargedToDriver true; buku upah kurir mendapat CASH_VARIANCE -10000 "Selisih kurang setoran COD". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 3 §6.5 |
| TS-COD-06 | Setoran lebih tanpa catatan | Kepala depot | Lebih > Rp 5.000 | Lebih Rp 8.000, catatan kosong | Verifikasi | "Explain the surplus in the note before verifying this deposit." | API: setoran lebih Rp8.000 tanpa catatan -> 422 SETTLEMENT_SURPLUS_NOTE_REQUIRED "Explain the surplus in the note before verifying this deposit."; dengan catatan -> VERIFIED. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 3 §6.5 |
| TS-COD-07 | Sengketakan tanpa alasan | Kepala depot | — | Alasan kosong | **Sengketakan** | "Isi alasan sengketa." | UI: Sengketakan tanpa alasan -> "Isi alasan sengketa."; dengan alasan -> Sengketa. Perbedaan di API (G-152): note kosong -> 400, tetapi note berisi spasi saja diterima 201; sengketa kedua pada setoran yang sudah Sengketa diterima dan menimpa catatan pertama. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 3 §6.5 |
| TS-COD-08 | Setoran dikirim dua kali | Kurir | Shift sudah disetor | — | Setor lagi | "This shift has already been settled." | API: setor kedua pada shift sama -> 409 SETTLEMENT_ALREADY_EXISTS "This shift has already been settled.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.11 |
| TS-COD-11 | Kasir non-manajer tidak bisa membebankan selisih (sejak PR #664) | Kepala depot (atau Finance) | Setoran kurang | Kurang Rp 10.000 | Buka Setoran → Hitung & verifikasi; cari opsi bebankan; lalu coba kirim `chargedToDriver` lewat API (uji teknis) | Opsi bebankan tidak tampil dan layar menyatakan "Membebankan selisih ke kurir hanya bisa oleh manajer. Anda bisa memverifikasi tanpa membebankan."; verifikasi tanpa beban berhasil; lewat API: 403 "Membebankan selisih ke kurir harus disetujui manajer. Verifikasi tanpa membebankan, atau minta manajer yang memverifikasi." | UI: Kepala depot melihat "Membebankan selisih ke kurir hanya bisa oleh manajer. Anda bisa memverifikasi tanpa membebankan." tanpa kotak bebankan; Manajer melihat kotak "Bebankan selisih Rp 10.000 ke saldo kurir". API: Kepala depot dan Finance -> 403 SETTLEMENT_CHARGE_NEEDS_MANAGER (pesan Indonesia sesuai panduan); Supervisor -> 403 FORBIDDEN; verifikasi tanpa beban oleh Kepala depot berhasil. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 3 §6.5, Bab 13 T-51 |
| TS-COD-12 | Verifikasi setoran berstatus Sengketa (sejak PR #664) | Kepala depot/Manajer | Setoran Sengketa (TS-COD-07) | Catatan penyelesaian | Buka setoran Sengketa; Verifikasi tanpa catatan; lalu dengan catatan | Tombol Verifikasi tampil dan tombol Sengketa tidak; tanpa catatan: "Isi catatan penyelesaian sengketa."; dengan catatan: Terverifikasi | UI: filter Sengketa -> hanya tombol Verifikasi (tanpa Sengketakan); tanpa catatan -> "Isi catatan penyelesaian sengketa."; API dengan catatan -> VERIFIED (catatan ditambahkan di belakang catatan sengketa). Perbedaan di API (G-152): tanpa catatan pesannya "Explain the surplus in the note..." (kode surplus dipakai ulang); beban oleh Kepala depot pada Sengketa tetap 403. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 3 §6.5, Bab 13 T-51 |
| TS-COD-09 | Kurir mencoba verifikasi setoran sendiri (akses tak sah) | Kurir | — | — | Buka `/dashboard/settlements` | Ditolak; hak `courierSettle` tidak dimiliki | API: kurir (STAFF_DEPOT) GET/POST verify pada /settlements -> 403 FORBIDDEN. Pengalihan halaman UI tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §9 |
| TS-COD-10 | Pembebanan ke buku upah gagal | Kepala depot | Layanan penghasilan terganggu (simulasi) **[D]** | — | Verifikasi dengan beban | "Pembebanan selisih ke kurir belum tercatat…" setoran tetap menunggu; aman diulang | payout-service dimatikan: Manajer verifikasi dengan beban -> 422 SETTLEMENT_CHARGE_UNDELIVERABLE "Pembebanan selisih ke kurir belum tercatat di buku upahnya, jadi setoran ini belum diverifikasi. Coba lagi."; setoran tetap SUBMITTED. Setelah hidup: ulangi berhasil, tepat satu baris variance. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 3 §6.5 |

### 3.3 Pembatalan dan refund (REF), galon (GAL)

| ID | Skenario bisnis | Aktor | Prasyarat | Data uji | Langkah | Hasil diharapkan | Hasil aktual | Status | Bagian dokumen |
|---|---|---|---|---|---|---|---|---|---|
| TS-REF-01 | Pelanggan membatalkan pesanan belum ditugaskan, belum bayar | Pelanggan | Status Dipesan | Alasan "Berubah pikiran" | **Batalkan pesanan** | Status Dibatalkan; pembayaran Gagal; stok dilepas | API: batal pesanan CREATED + transfer PENDING -> 201, pesanan CANCELLED, pembayaran FAILED. Pelepasan stok tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 2 §6, F02 |
| TS-REF-02 | Pembatalan setelah kurir ditugaskan | Pelanggan | Status Kurir ditugaskan | — | Buka rincian | Tombol hilang; pesan "Kurir sudah ditugaskan…"; tombol **Hubungi depot** | API 409 ORDER_NOT_CANCELLABLE ("An order in status DRIVER_ASSIGNED can no longer be cancelled."). UI: tombol Batalkan hilang, tampil "Kurir sudah ditugaskan, jadi pesanan tidak bisa lagi dibatalkan dari sini. Depot masih bisa menghentikannya." Tombol Hubungi depot TIDAK tampil karena depot uji tidak punya nomor telepon (kode: hanya bila ada nomor). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 2 §6 |
| TS-REF-03 | Batal setelah jadwal ulang (pernah ditugaskan) | Pelanggan | Pesanan pernah Ditugaskan lalu kembali Disiapkan | — | Coba batal | Tidak bisa dibatalkan pelanggan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-REF-04 | Batal pesanan lunas ≤ ambang | Pelanggan, Finance | Pembayaran PAID ≤ Rp100.000 | Total Rp 60.000 | Batal | Refund diproses langsung; pembayaran REFUNDED | Transfer PAID Rp75.000 lalu batal: pembayaran REFUNDED langsung, approval NONE. Batas pas Rp100.000 juga langsung REFUNDED (<=). Refund Manajer Rp50.000 juga langsung. UI pelanggan: "Refund Rp 75.000 sudah diproses. Sampai ke sumber dana dalam 1-3 hari kerja.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | F02 |
| TS-REF-05 | Batal pesanan lunas > ambang | Pelanggan | PAID > Rp100.000 | Total Rp 150.000 | Batal | Persetujuan refund PENDING; muncul di `/hq/refunds`; uang belum bergerak | Transfer PAID Rp150.000 lalu batal: pesanan CANCELLED, pembayaran tetap PAID, refundApproval PENDING, muncul di antrean Finance. Catatan: kolom refundedAmount sudah terisi 150000 padahal masih PENDING. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.7 |
| TS-REF-06 | Finance menyetujui refund | Finance | Item PENDING | — | `/hq/refunds` → **Setujui** | Toast "Refund {order} disetujui"; pembayaran REFUNDED | API: Finance setujui -> 201, pembayaran REFUNDED, approval APPROVED. Toast UI tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.7 |
| TS-REF-07 | Finance menolak refund tanpa alasan | Finance | Item PENDING | Alasan kosong | **Tolak** | Alasan wajib; tidak bisa lanjut | API: reject tanpa reason -> 400 (reason wajib string, minimal 4 karakter; "tes" ditolak). Dengan alasan valid -> REJECTED. Tombol UI tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.7 |
| TS-REF-08 | Head office mencoba menyetujui refund (akses tak sah) | Head office | Item PENDING | — | Tekan **Setujui** | Server menolak (tidak punya `refundQueue`) | API: Head office dan Direktur POST approve -> 403 FORBIDDEN. Tampilnya tombol di UI tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.7 [B] |
| TS-REF-09 | Kepala depot mencari tombol Ajukan refund | Kepala depot | Pembayaran PAID | — | Buka rincian pesanan | Tombol **Ajukan refund** tidak tampil | API: Kepala depot POST /refund -> 403. Tombol di UI tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 3 §6.2 |
| TS-REF-10 | Menolak refund untuk pesanan yang sudah dibatalkan | Finance | Pesanan Dibatalkan, refund PENDING | — | Cari tombol Tolak | Tombol tidak muncul; "Pesanan dibatalkan — refund wajib dikembalikan" | API: reject refund pesanan CANCELLED -> 422 REFUND_CANCELLED_ORDER "Pesanan ini sudah dibatalkan, jadi refundnya tidak bisa ditolak - uang pelanggan harus dikembalikan."; status tetap PENDING. Tombol UI tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.7 |
| TS-REF-11 | Refund diputuskan dua kali | Finance | Item sudah APPROVED | — | Setujui lagi (dua tab) | "This refund is not awaiting approval." | API: approve kedua -> 409 REFUND_NOT_PENDING "This refund is not awaiting approval.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.7 |
| TS-REF-12 | Pembatalan otomatis pesanan terbengkalai | Sistem | Pesanan Dipesan > batas menit **[K]** | Pesanan uji | Tunggu sapuan jam :05 | Pesanan Dibatalkan; pelanggan menerima notifikasi | Belum diuji oleh tim dokumentasi | Not Tested | F22 |
| TS-REF-13 | Pembalikan pembayaran gagal saat batal | Pelanggan | Layanan pembayaran terganggu (simulasi) **[D]** | — | Batal | Pesanan tidak dibatalkan (gagal-tertutup) | payment-service dimatikan: batal pesanan PAID -> 422 ORDER_PAYMENT_REVERSAL_FAILED ("Pembayaran belum bisa dikembalikan, jadi penjualan tidak dibatalkan. Coba lagi sebentar."), pesanan tetap CONFIRMED. Setelah hidup lagi: batal berhasil, pembayaran REFUNDED. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | F02 |
| TS-REF-14 | Sengketa dengan resolusi Refund > ambang | Kepala depot/SPV/Manajer | Sengketa Terbuka | Nilai Rp 150.000 | **Refund** | Permintaan refund menunggu persetujuan Finance | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 (Sengketa) |
| TS-REF-15 | Status refund dan janji 1–3 hari kerja di rincian pesanan pelanggan (sejak PR #664) | Pelanggan, Finance | Tiga pesanan: refund diproses, refund menunggu, refund ditolak | TS-REF-04, TS-REF-05, TS-REF-07 | Pelanggan buka rincian tiap pesanan | Berturut-turut: "Refund {nominal} sudah diproses. Sampai ke sumber dana dalam 1–3 hari kerja." · "Refund diajukan dan menunggu persetujuan pusat. Setelah disetujui, diproses 1–3 hari kerja." · "Pengajuan refund tidak disetujui. Hubungi depot bila ada pertanyaan."; tidak ada notifikasi refund | UI pelanggan (390x844) menampilkan tepat tiga kalimat: diproses ("Refund Rp 75.000 sudah diproses. Sampai ke sumber dana dalam 1-3 hari kerja."), menunggu ("Refund diajukan dan menunggu persetujuan pusat. Setelah disetujui, diproses 1-3 hari kerja."), ditolak ("Pengajuan refund tidak disetujui. Hubungi depot bila ada pertanyaan."). Notifikasi refund tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 2 §6, Bab 13 T-30 |
| TS-REF-16 | Syarat dan Ketentuan Pasal 8 selaras dengan aturan batal (sejak PR #664) | Pelanggan | T&K berlaku 14 Oktober 2026 | — | Buka halaman Syarat dan Ketentuan, Pasal 8; bandingkan dengan TS-REF-01/02 | Teks "dapat membatalkan sebelum kurir ditugaskan" selaras dengan perilaku TS-REF-01 dan TS-REF-02 | Halaman /syarat-ketentuan: "Berlaku sejak 14 Oktober 2026"; Pasal 8: "Kamu bisa membatalkan sebelum kurir ditugaskan; setelah itu pembatalan bergantung pada persetujuan depot." Selaras dengan REF-01 dan REF-02. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 2, Bab 13 T-33 |
| TS-GAL-01 | Retur galon baik oleh kurir | Kurir | Pengantaran Diantar | 2 galon, Baik | **Retur galon kosong** → **Catat retur** | "Retur tercatat"; stok galon bertambah | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.10 |
| TS-GAL-02 | Retur galon rusak | Kurir | — | 1 galon, Rusak | Catat | Deposit tidak dikembalikan di layar kurir; persetujuan DEPOSIT_REFUND dibuat bila > ambang | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.10, F03 |
| TS-GAL-03 | Retur jumlah 0 | Kepala depot | — | 0 | **Simpan retur** | "Masukkan jumlah galon (lebih dari 0)." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.7 |
| TS-GAL-04 | Refund deposit melebihi yang ditahan | Kepala depot | Deposit tertahan kecil | Deposit Rp 100.000 > tertahan | Simpan | "Deposit refund exceeds the deposit this depot still holds…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.7 |
| TS-GAL-05 | Retur melebihi galon beredar | Kepala depot | Beredar 3 | Retur 30 | Simpan | Retur tercatat; persetujuan GALLON_VARIANCE bila nilai > ambang | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.7 |
| TS-GAL-06 | Retur kurir diulang karena offline | Kurir | Retur sudah tercatat | Ulang kirim | Kirim ulang | "Sudah tercatat sebelumnya" (tidak ganda) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.10 |
| TS-GAL-07 | Pengingat galon belum kembali | Sistem | Pelanggan melewati batas pinjam | — | Sapuan 09:00 | Notifikasi "Galon belum dikembalikan"; tidak lebih dari sekali per 7 hari | Belum diuji oleh tim dokumentasi | Not Tested | F22 |
| TS-GAL-08 | Teks deposit di T&K Pasal 6 selaras dengan checkout dan buku depot (sejak PR #664) | Pelanggan | — | Galon 2 | Baca Pasal 6; bandingkan dengan TS-ORD-15 dan retur TS-GAL-01 | Pasal 6 menyatakan depot mencatat deposit saat antar dan mengembalikannya saat galon kembali utuh; nilai tampil di checkout hanya sebagai perkiraan di luar total **[K]** | Belum diuji oleh tim dokumentasi | Not Tested | Bab 13 T-21 |

### 3.4 Kasir (POS), opname (OPN), approval (APR), pengadaan (PO)

| ID | Skenario bisnis | Aktor | Prasyarat | Data uji | Langkah | Hasil diharapkan | Hasil aktual | Status | Bagian dokumen |
|---|---|---|---|---|---|---|---|---|---|
| TS-POS-01 | Buka shift kasir | Kepala depot | Tidak ada shift terbuka | Modal Rp 200.000 | **Buka shift** | "Shift dibuka."; bilah "Shift terbuka" | API: buka shift modal Rp200.000 -> 201 OPEN. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 3 §6.4, F04 |
| TS-POS-02 | Buka shift kedua | Kepala depot | Shift terbuka | — | Buka lagi | "You already have an open shift at this depot…" | API: buka kedua -> 409 SHIFT_ALREADY_OPEN "You already have an open shift at this depot. Close it before opening another.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 3 §6.4 |
| TS-POS-03 | Jual tanpa shift | Kepala depot | Tidak ada shift | — | Simpan penjualan | Tombol "Buka shift dulu" nonaktif; server "Buka shift kasir dulu…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-04 | Penjualan tunai pas | Kepala depot | Shift terbuka; stok | Galon ×2, tunai pas | **Simpan & cetak struk** | Pesanan Selesai (lencana Walk-in); struk terbuka | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-05 | Tunai kurang | Kepala depot | — | Tunai < total | Simpan | "Uang tunai kurang dari total." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-06 | Simpan dua kali (kirim ganda) | Kepala depot | — | Tombol sama | Klik/ulang | Satu penjualan (kunci idempotensi) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-07 | Voucher tanpa nomor HP | Kepala depot | Voucher uji | Kode, HP kosong | Simpan | "Isi nomor HP pembeli dulu — voucher menempel pada akun." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-08 | Batalkan penjualan salah input | Kepala depot | Penjualan dibuat dalam shift | Alasan sintetis | **Batalkan penjualan** | Status Dibatalkan di kasir; stok kembali; poin ditarik | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-09 | Batalkan tanpa alasan | Kepala depot | — | Alasan kosong | Konfirmasi | Alasan wajib | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-10 | Batalkan penjualan hari lain | Kepala depot | Penjualan kemarin | — | Batalkan | "Penjualan ini bukan hari ini… Ajukan refund." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-11 | Tutup shift dengan selisih | Kepala depot | Shift berpenjualan | Hitung kurang Rp 5.000 | **Tutup shift** → hitung | Kartu "Shift ditutup": Seharusnya, Dihitung, Selisih negatif (merah) | API: tutup shift modal Rp200.000, dihitung Rp195.000 -> CLOSED, variance -5000 (kartu UI tidak diperiksa). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 3 §6.4 |
| TS-POS-12 | Tutup shift milik kasir lain | Kepala depot | Shift kasir B terbuka | — | Coba tutup | "This shift belongs to another cashier."; Manajer dapat menutup | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-POS-13 | Tutup buku dengan shift terbuka | Kepala depot | Shift terbuka | — | **Tutup buku** | "Masih ada {n} shift kasir terbuka…" | API: tutup buku dengan shift terbuka -> 400 "Masih ada 1 shift kasir terbuka. Tutup shift dulu, baru buku harian.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 3 §6.9 |
| TS-POS-14 | Tutup buku sukses | Kepala depot | Semua shift tertutup | Tanggal hari ini | **Tutup buku** | Lencana "Buku ditutup"; snapshot kas | API: tutup buku 2026-10-14 setelah semua shift tertutup -> 201 dengan snapshot kas (cashIn, cashOut, konter, COD). Lencana UI tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 3 §6.9 |
| TS-POS-15 | Tutup buku dua kali | Kepala depot | Hari sudah ditutup | — | Tutup lagi | "Hari ini sudah ditutup." | API: tutup kedua -> 400 "Hari ini sudah ditutup.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 3 §6.9 |
| TS-POS-16 | Kepala depot mencari tombol Buka kembali | Kepala depot | Hari ditutup | — | Buka laporan harian | Tombol **Buka kembali** tidak tampil | API: Kepala depot POST reopen -> 403. Tombol UI tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 3 §6.9 |
| TS-POS-17 | Head office membuka kembali hari | Head office | Hari ditutup | — | `/dashboard/reports` → **Buka kembali** | Hari terbuka; bisa ditutup lagi | API: Head office reopen -> 201, hari terbuka; tutup buku lagi berhasil. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.30 |
| TS-POS-18 | Direktur/Finance mencoba Buka kembali (akses tak sah) | Direktur | Hari ditutup | — | Cari/tekan tombol | Tidak tersedia atau ditolak | API: Direktur dan Finance reopen -> 403 FORBIDDEN. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.30 |
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
| TS-APR-03 | Tahan lalu putuskan | Manajer | Item PENDING | — | Tahan; periksa daftar (sejak PR #664 item Ditahan tetap tampil bersama Menunggu); buka; Setujui | HELD (tetap terlihat di daftar) lalu APPROVED | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.3 |
| TS-APR-04 | Pengaju memutuskan pengajuannya sendiri | Manajer yang juga pengaju | Item diajukan oleh Manajer itu | — | Setujui | "Pengaju tidak boleh memutuskan pengajuannya sendiri — teruskan ke atasan." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.3 |
| TS-APR-05 | Keputusan dua kali | Manajer | Item APPROVED | — | Setujui lagi | "This approval item has already been approved or rejected." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.3 |
| TS-APR-06 | SPV/Kepala depot membuka antrean (akses tak sah) | SPV | — | — | Buka `/dashboard/approvals` | Tidak tampil/ditolak | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 §5.2 |
| TS-APR-07 | Manajer depot lain (lintas depot) | Manajer | Item milik depot di luar cakupan | — | Buka detail via URL | "Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.1 |
| TS-APR-08 | Nilai di bawah ambang otomatis disetujui | Kepala depot | Ambang Rp100.000 | Nilai Rp 50.000 | Picu retur rusak kecil | Item APPROVED "Disetujui otomatis (di bawah ambang)" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.3 |
| TS-APR-09 | Ubah batas auto-pass oleh Manajer (akses tak sah) | Manajer | — | Nilai baru | Ubah di Pengaturan | 403 "You do not have permission to perform this action." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.30 |
| TS-APR-10 | Ubah batas auto-pass oleh Super admin | Super admin | — | Rp 150.000 | Pengaturan → Simpan | Tersimpan; tercatat di audit | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.30, Bab 10 §6.16 |
| TS-APR-11 | Detail approval membaca nominal/galon (sejak PR #664) | Manajer | Item Selisih retur galon dan Refund deposit (retur rusak) PENDING | TS-GAL-02, TS-GAL-05 | Buka detail tiap item (desktop) | Selisih retur galon menampilkan jumlah galon selisih; Deposit dikembalikan menampilkan nominal (bukan Rp0), baik dari kunci `deposit` maupun `depositRefunded` | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.3, Bab 13 T-27 |
| TS-PO-01 | Buat dan kirim PO | Manajer | Pemasok; stok di bawah titik pesan | Item, biaya Rp 15.000 | **Buat PO draft** → **Kirim ke pemasok** | Draft → Dikirim | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.4, F06 |
| TS-PO-02 | PO tanpa pemasok atau item | Manajer | — | — | Buat | "Pilih pemasok dulu."; "Pilih minimal satu item." | Belum diuji oleh tim dokumentasi | Not Tested | F06 |
| TS-PO-03 | Biaya satuan kosong | Manajer | — | Biaya 0 | Buat | `unitCostIdr must be at least 1…` | Belum diuji oleh tim dokumentasi | Not Tested | F06 |
| TS-PO-04 | Terima sebagian lalu sisanya tidak datang | Manajer | PO Dikirim | Datang 8 dari 10; alasan | Terima | Stok +8 (RECEIPT); baris ditutup "Kurang kirim" | Belum diuji oleh tim dokumentasi | Not Tested | F06 |
| TS-PO-05 | Terima melebihi sisa | Manajer | PO Dikirim | 12 dari 10 | Terima | "Line N … would exceed the M still outstanding…" | Belum diuji oleh tim dokumentasi | Not Tested | F06 |
| TS-PO-06 | Kirim PO yang bukan Draft | Manajer | PO Dikirim | — | Kirim lagi | "Only a DRAFT purchase order can be sent." | Belum diuji oleh tim dokumentasi | Not Tested | F06 |
| TS-PO-07 | Terima PO yang masih Draft | Manajer | PO Draft | — | Terima | "Only a SENT purchase order can be received." | Belum diuji oleh tim dokumentasi | Not Tested | F06 |
| TS-PO-08 | Kepala depot / SPV membuka PO (akses tak sah) | Kepala depot | — | — | Buka `/dashboard/purchase-orders` | Ditolak; judul gerbang "Akses terbatas" (sejak PR #664; sebelumnya "Khusus manajer depot") | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.4 |
| TS-PO-09 | Hapus pemasok yang dipakai PO | Manajer | Pemasok punya PO | — | Hapus | Ditolak oleh server | Belum diuji oleh tim dokumentasi | Not Tested | F06 |

### 3.5 Insiden dan sengketa (INC), langganan (SUB), voucher/poin/hadiah (LOY)

| ID | Skenario bisnis | Aktor | Prasyarat | Data uji | Langkah | Hasil diharapkan | Hasil aktual | Status | Bagian dokumen |
|---|---|---|---|---|---|---|---|---|---|
| TS-INC-01 | Lapor insiden depot lalu selesaikan | Kepala depot/SPV | Depot terpilih | Judul sintetis | **Laporkan insiden** → **Kirim laporan** → catatan ≥ 3 karakter → **Tandai selesai** | Status Baru → Selesai | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 (Insiden), F07 |
| TS-INC-02 | Judul terlalu pendek | SPV | — | "Ab" | Kirim | "Judul terlalu pendek — tulis apa yang terjadi." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 |
| TS-INC-03 | Selesaikan tanpa catatan | SPV | Insiden Baru | Catatan 2 huruf | Tandai selesai | "Tulis catatan penyelesaian minimal 3 karakter." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 |
| TS-INC-04 | Asisten SPV membuka insiden (akses tak sah) | Asisten SPV | — | — | Buka `/dashboard/incidents` | Tidak tampil/ditolak | Belum diuji oleh tim dokumentasi | Not Tested | Bab 6 §5 |
| TS-INC-05 | Kurir lapor insiden Darurat | Kurir | Masuk di aplikasi | Jenis Kecelakaan, tingkat Darurat | **Kirim laporan** | "Insiden darurat diteruskan ke tim operasional."; notifikasi "Insiden kurir" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.14 |
| TS-INC-06 | Kurir lapor kronologi terlalu pendek | Kurir | — | 2 huruf | Kirim | Tombol/validasi menolak (3–1000 karakter) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.14 |
| TS-INC-07 | Catat sengketa dengan kolom wajib kosong | Manajer/Kepala depot/SPV | — | Nomor order kosong | **Simpan sengketa** | "Nomor order, nama pelanggan, dan keterangan wajib diisi." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 (Sengketa) |
| TS-INC-08 | Tolak sengketa tanpa catatan | SPV | Sengketa Terbuka | Catatan kosong | **Tolak** | Catatan wajib | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 |
| TS-INC-09 | Selesaikan sengketa dengan Kirim ulang | Kepala depot | Sengketa Terbuka | — | **Kirim ulang** | Status Selesai | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.16 |
| TS-INC-10 | Resolusi sengketa yang sudah final | SPV | Sengketa Selesai | — | Selesaikan lagi | Ditolak (hanya Terbuka) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 |
| TS-INC-11 | Pelanggan ajukan komplain | Pelanggan | Masuk | Ringkasan 10 huruf | **Ajukan komplain** → **Kirim komplain** | "Komplain terkirim…"; status "Menunggu ditangani" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 (bantuan) |
| TS-INC-12 | Komplain kolom wajib kosong | Pelanggan | — | Ringkasan kosong | Kirim | "Isi ringkasan masalahnya dulu." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-INC-13 | HQ tugaskan, balas, selesaikan tiket | Head office | Tiket Terbuka | Balasan sintetis | **Assign ke saya** → **Kirim** → **Tandai selesai** | Terbuka → Ditugaskan → Selesai; pelanggan melihat "Balasan Hydromart"; tidak ada notifikasi | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.24 |
| TS-INC-14 | Buka dan selesaikan insiden platform | Head office | — | Judul, layanan | **＋ Insiden baru** → tambah pembaruan → selesai | Berlangsung → Selesai | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.23 |
| TS-INC-15 | Insiden platform kolom wajib kosong | Head office | — | Judul kosong | Buka insiden | Tidak bisa disimpan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.23 |
| TS-SUB-01 | Buat langganan | Pelanggan | Alamat bertitik | Galon ×2 mingguan | **Mulai langganan** | "Langganan dibuat."; status Aktif | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 (Langganan), F08 |
| TS-SUB-02 | Alamat tanpa titik peta | Pelanggan | Alamat tanpa lokasi | — | Mulai | "Alamat ini belum punya titik peta…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-SUB-03 | Tanggal pertama lampau | Pelanggan | — | Kemarin | Mulai | Ditolak | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-SUB-04 | Jeda dan lanjutkan | Pelanggan | Aktif | — | **Jeda** → **Lanjutkan** | Dijeda → Aktif; tidak ada pesanan saat dijeda | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-SUB-05 | Batalkan lalu ubah | Pelanggan | — | — | **Batalkan** → ganti alamat | "A cancelled subscription can no longer be changed." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-SUB-06 | Jeda otomatis setelah 3 kegagalan | Sistem | Skenario gagal buat pesanan (stok kosong) | 3 siklus | Jalankan sapuan | Status Dijeda; notifikasi jeda | Belum diuji oleh tim dokumentasi | Not Tested | F08 |
| TS-SUB-07 | Pesanan langganan jatuh tempo | Sistem | Aktif, jatuh tempo | — | Sapuan jam :00 | Pesanan dibuat, notifikasi "Pesanan diterima" | Belum diuji oleh tim dokumentasi | Not Tested | F08, F22 |
| TS-SUB-08 | Pelanggan B mengubah langganan A (akses tak sah) | Pelanggan B | Langganan milik A | ID | Jeda via API | Ditolak (bukan pemilik) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-LOY-01 | Voucher valid persen | Pelanggan | U-VCH | Kode | **Terapkan** di checkout | Potongan tampil sesuai batas maksimum | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 (voucher) |
| TS-LOY-02 | Voucher kedaluwarsa | Pelanggan | — | Kode kedaluwarsa | Terapkan | "This voucher has expired." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-LOY-03 | Voucher kuota habis | Pelanggan | — | Kode kuota habis | Terapkan | "This voucher has reached its usage limit." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-LOY-04 | Voucher di bawah minimal belanja | Pelanggan | — | Subtotal kecil | Terapkan | "Your order must be at least {angka} to use this voucher." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-LOY-05 | Voucher milik pelanggan lain | Pelanggan B | Voucher khusus A | Kode | Terapkan | "Voucher ini khusus untuk pelanggan yang menerimanya." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-LOY-06 | Voucher bersama harga agen | Pelanggan agen | Akun agen | Kode | Terapkan | "Diskon reseller berlaku otomatis. Voucher tidak bisa dipakai bersama harga reseller." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-LOY-07 | Poin masuk setelah Selesai | Pelanggan | Pesanan Selesai | Subtotal Rp 45.000 | Cek saldo | Poin = subtotal ÷ 1.000 dibulatkan ke bawah (nilai bawaan **[K]**) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-LOY-08 | Referral berhasil | Pelanggan A, B baru | Kode A | B daftar dengan kode; B selesaikan pesanan pertama | Cek poin | A +500, B +250 (bawaan **[K]**) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 (referral) |
| TS-LOY-09 | Kode referral sendiri atau pelanggan lama | Pelanggan | — | Kode sendiri | Pakai | "Kode tidak dapat digunakan." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-LOY-10 | Tukar poin hadiah | Pelanggan | Poin cukup | Hadiah uji | **Tukar** → pilih depot | "{nama} berhasil ditukar!"; status "Menunggu diambil" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-LOY-11 | Poin tidak cukup / hadiah habis | Pelanggan | — | Poin kecil | Tukar | Tombol "Kurang"/"Habis"; "You do not have enough points…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-LOY-12 | Serah hadiah di depot | Kepala depot | Penukaran ACTIVE | Kode | `/dashboard/redemptions` → **Sudah diambil** | Toast "Hadiah ditandai sudah diambil."; pelanggan tidak bisa membatalkan lagi | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.12 |
| TS-LOY-13 | Serah hadiah dua kali | Kepala depot A, B | — | — | Tekan bersamaan | "Hadiah ini baru saja diserahkan oleh depot lain." (satu berhasil) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.12 |
| TS-LOY-14 | Batalkan penukaran setelah diambil | Pelanggan | Status USED | — | **Batalkan** | "Hadiah ini sudah diambil, jadi penukarannya tidak bisa dibatalkan." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-LOY-15 | Batalkan penukaran sebelum diambil | Pelanggan | ACTIVE | — | **Batalkan** | Poin kembali | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-LOY-16 | Kepala depot membuat voucher (akses tak sah) | Kepala depot | — | — | Cari halaman voucher | Tidak ada halaman; API menolak | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.10 |
| TS-LOY-17 | Kepala depot kirim broadcast ke segmen | Kepala depot | — | Judul, pesan | **Kirim broadcast** | Kampanye dibuat; sapuan 2 menit mengirim ke kotak masuk | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.11 |
| TS-LOY-18 | Broadcast tanpa judul | Kepala depot | — | Kosong | Kirim | "Isi judul dan pesan dulu." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.11 |

### 3.6 Waralaba (FRA) dan harga (PRC)

| ID | Skenario bisnis | Aktor | Prasyarat | Data uji | Langkah | Hasil diharapkan | Hasil aktual | Status | Bagian dokumen |
|---|---|---|---|---|---|---|---|---|---|
| TS-FRA-01 | Kirim lamaran waralaba lengkap | Calon mitra | — | Data sintetis | `/waralaba` → **Kirim pengajuan** | Layar "Pengajuan terkirim" dengan Nomor tanda terima | Belum diuji oleh tim dokumentasi | Not Tested | Bab 7 §6.1, F10 |
| TS-FRA-02 | Persetujuan data tidak dicentang | Calon mitra | — | — | Kirim | "Persetujuan pemrosesan data wajib dicentang sebelum mengirim." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 7 §6.1 |
| TS-FRA-03 | WhatsApp salah format | Calon mitra | — | `0812` | Kirim | "Nomor WhatsApp belum benar. Contoh: 081234567890." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 7 §6.1 |
| TS-FRA-04 | Investasi desimal | Calon mitra | — | 1500000.5 | Kirim | Ditolak server (harus bilangan bulat) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 7 §6.1 |
| TS-FRA-05 | Kode depot usulan sudah dipakai | Calon mitra | Depot aktif berkode sama | Kode ada | Kirim | "A depot with this code already exists." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 7 §6.1 |
| TS-FRA-06 | Kirim lebih dari 3 kali per jam | Calon mitra | — | 4 pengiriman | Kirim berulang | Dibatasi (pesan batas kirim) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 7 §6.1 |
| TS-FRA-07 | HQ meninjau dan setujui lamaran | Head office | Lamaran Baru | — | `/hq/applications` → Tinjau → **Setujui & provision** | Tahap Disetujui; form onboarding terisi sebagian | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.8 |
| TS-FRA-08 | Tolak lamaran | Head office | — | — | **Tolak** | Tahap Ditolak (tanpa alasan, tanpa konfirmasi) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.8 |
| TS-FRA-09 | Putuskan lamaran yang sudah final | Head office | Lamaran Disetujui | — | Ubah/tolak | "This application has already been approved or rejected." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.8 |
| TS-FRA-10 | Setujui tanpa checklist lengkap | Head office | Checklist belum lengkap | — | Setujui | Disetujui (checklist tidak wajib) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.8 |
| TS-FRA-11 | Keuangan membuka lamaran (akses tak sah) | Finance | — | — | Buka `/hq/applications` | "Khusus HQ" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.8 |
| TS-FRA-12 | Undang Pemilik waralaba | Head office | — | Nomor sintetis | **＋ Undang staf**, peran Pemilik waralaba | Akun aktif tanpa kartu karyawan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.4 |
| TS-FRA-13 | Onboard depot Waralaba tanpa pemilik | Manajer/Super admin | — | Pemilik kosong | **Buat depot** | "A franchise (WARALABA) depot must have an owner." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.3 |
| TS-FRA-14 | Head office mencoba onboard depot (akses tak sah) | Head office | — | — | Buat depot | Ditolak server (403) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.3 [B] |
| TS-FRA-15 | Kode depot ganda | Manajer | — | Kode ada | Buat | "A depot with this code already exists." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.3 |
| TS-FRA-16 | Tangguhkan depot dengan konfirmasi kode | Manajer/Super admin | Depot uji | Kode persis | **Tangguhkan** → ketik kode | Depot "Ditangguhkan"; tombol aktif hanya bila kode cocok | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.3 |
| TS-FRA-17 | Daftar rekening tujuan pencairan | Pemilik | Masuk | Data U-BANK | **Daftarkan rekening** | Status "Menunggu verifikasi kantor pusat" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 7 §6.5 |
| TS-FRA-18 | Nomor rekening tidak sah | Pemilik | — | 123 | Daftarkan | Validasi 6–30 karakter menolak | Belum diuji oleh tim dokumentasi | Not Tested | Bab 7 §6.5 |
| TS-FRA-19 | Finance verifikasi rekening | Finance | Rekening PENDING | — | **Verifikasi** | Toast "Rekening diverifikasi" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.6 |
| TS-FRA-20 | Finance tolak rekening | Finance | — | — | **Tolak** | Pemilik melihat "Ditolak: tanpa alasan" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.6 |
| TS-FRA-21 | Pemilik cairkan saldo | Pemilik | Rekening terverifikasi, saldo > 0 | Rp 100.000 | **Cairkan saldo** | Pesan sukses "… diajukan ke {ref}, menunggu transfer." (sejak PR #664; sebelumnya "dikirim ke"); Ref `WD-…`; saldo berkurang; status PROCESSING; kartu "Riwayat penarikan" menampilkan baris dengan status "Menunggu transfer" (sejak PR #664) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 7 §6.6 |
| TS-FRA-39 | Pemilik cairkan di bawah minimum Rp50.000 (sejak PR #664) | Pemilik | Rekening terverifikasi; saldo ≥ Rp100.000 | Rp 40.000 | Cairkan saldo | 400 "Minimum penarikan Rp50.000."; tanpa biaya penarikan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 7 §6.6, Bab 13 T-60 |
| TS-FRA-40 | Riwayat penarikan dan status (sejak PR #664) | Pemilik, Finance | Penarikan Lunas dan Gagal (TS-FRA-31, TS-FRA-32) | — | Buka Payout & komisi | "Riwayat penarikan": Menunggu transfer / Sudah ditransfer / Gagal (saldo dikembalikan), dengan Ref dan tanggal | Belum diuji oleh tim dokumentasi | Not Tested | Bab 7 §6.6, Bab 13 T-61 |
| TS-FRA-41 | Label skema komisi (sejak PR #664) | Finance | — | — | Buka `/hq/forms/commission` | Subjudul "Persentase komisi HQ per depot" (bukan "payout") | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.22, Bab 13 T-59 |
| TS-FRA-22 | Cairkan melebihi saldo | Pemilik | — | Jumlah > saldo | Cairkan | "Withdrawal of {requested} exceeds available balance {available}." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 7 §6.6 |
| TS-FRA-23 | Cairkan tanpa rekening terverifikasi | Pemilik | Rekening PENDING | — | Cairkan | Tombol nonaktif / "Belum ada rekening tujuan yang terverifikasi…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 7 §6.6 |
| TS-FRA-24 | Cairkan dua kali cepat (kirim ganda) | Pemilik | Saldo cukup untuk satu | — | Klik dua kali | Tidak potong ganda atau pesan melebihi saldo | Belum diuji oleh tim dokumentasi | Not Tested | Bab 7 §6.6 |
| TS-FRA-25 | Ajukan rilis | Finance | Pemilik punya saldo | — | **Ajukan rilis** | Pengajuan PENDING untuk seluruh saldo | API: Finance ajukan rilis saldo Rp300.000 (rekening terverifikasi) -> 201 PENDING. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.6 |
| TS-FRA-26 | Ajukan rilis kedua untuk pemilik sama | Finance | Pengajuan PENDING | — | Ajukan lagi | "Pencairan untuk pemilik ini sudah diajukan dan menunggu persetujuan." | API: pengajuan kedua pemilik sama -> 409 PAYOUT_RELEASE_ALREADY_REQUESTED "Pencairan untuk pemilik ini sudah diajukan dan menunggu persetujuan.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.6 |
| TS-FRA-27 | Pengaju menyetujui sendiri | Super admin (pengaju) | Pengajuan miliknya | — | **Setujui & rilis** | "Pengaju pencairan tidak boleh menyetujui pengajuannya sendiri." | API: Super admin pengaju setujui dan tolak pengajuan sendiri -> 403 PAYOUT_RELEASE_SELF_APPROVAL "Pengaju pencairan tidak boleh menyetujui pengajuannya sendiri.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.6 |
| TS-FRA-28 | Direktur setujui rilis | Direktur | Pengajuan Finance | — | **Setujui & rilis** | Penarikan PROCESSING; saldo dipotong | API: Direktur setujui pengajuan Finance -> APPROVED; penarikan Rp300.000 PROCESSING; saldo pemilik turun menjadi Rp200.000 (Finance sendiri -> 403). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.6 |
| TS-FRA-29 | Direktur tolak rilis | Direktur | — | — | **Tolak** | Toast "Pengajuan ditolak"; saldo tidak bergerak | API: Direktur tolak pengajuan Super admin dengan alasan -> REJECTED; saldo Rp200.000 tidak bergerak. Toast UI tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.6 |
| TS-FRA-30 | Head office tekan Setujui & rilis (akses tak sah) | Head office | — | — | Tekan | Tombol tidak tampil/ditolak | API: Head office setujui rilis -> 403 FORBIDDEN. Tombol UI tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.6 |
| TS-FRA-31 | Finance tandai Lunas | Finance | Penarikan PROCESSING | — | **Lunas** | Status Lunas, final | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.6 |
| TS-FRA-32 | Finance tandai Gagal | Finance | — | — | **Gagal** | Saldo dikembalikan "Pencairan gagal, saldo dikembalikan" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.6 |
| TS-FRA-33 | Tandai penarikan yang sudah final | Finance | Penarikan PAID | — | Gagal | "Withdrawal is already PAID; only a PROCESSING withdrawal can be settled." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.6 |
| TS-FRA-34 | Pemilik A melihat data depot pemilik B (batas lintas waralaba) | Pemilik A | Depot milik B | ID depot B | Buka via URL/API | Data B tidak tampil; hanya depot sendiri | Belum diuji oleh tim dokumentasi | Not Tested | Bab 7 §9 |
| TS-FRA-35 | Pesanan Selesai mengkredit saldo pemilik | Sistem | Depot waralaba dengan skema komisi | Pesanan Selesai | Cek buku kas pemilik | Kredit penjualan dan potongan komisi | Belum diuji oleh tim dokumentasi | Not Tested | Bab 7 §6.7 |
| TS-FRA-36 | Depot tanpa skema komisi | Sistem | Skema belum ada | — | Cek komisi | Komisi 0% (perilaku yang didokumentasikan **[K]**) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.22 |
| TS-FRA-37 | Terapkan skema komisi | Finance | — | 10% | `/hq/forms/commission` → **Terapkan skema baru** | "Skema komisi baru diterapkan." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.22 |
| TS-FRA-38 | Skema komisi di luar rentang | Finance | — | 120 | Terapkan | Diabaikan/ditolak ("Commission percentage must be between 0 and 100.") | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.22 |
| TS-PRC-01 | Setujui usulan override harga | Head office | Usulan PENDING | — | `/hq/pricing` → **Setujui** | Aturan harga aktif prioritas 100 | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.10 |
| TS-PRC-02 | Tolak usulan | Direktur | — | — | **Tolak** | Harga tidak berubah | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.10 |
| TS-PRC-03 | Pengusul menyetujui sendiri (di atas ambang) | Super admin pengusul | Dampak > Rp100.000 | — | Setujui | "Usulan ini Anda sendiri yang mengajukan dan nilainya di atas batas auto-pass…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.10 |
| TS-PRC-04 | Putuskan usulan yang sudah final | Head office | — | — | Setujui lagi | "This price-override proposal has already been approved or rejected." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.10 |
| TS-PRC-05 | Impor CSV harga menjadi usulan | Manajer | — | CSV sintetis | Impor | Tiap baris menjadi usulan menunggu | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.10 |
| TS-PRC-06 | Kepala depot mengisi harga khusus depot | Kepala depot | Baris PRODUK | Rp 21.000 | **Harga** → **Simpan harga** | Berlaku langsung tanpa persetujuan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.6 |
| TS-PRC-07 | Finance membuka Tata kelola harga (akses tak sah) | Finance | — | — | Buka `/hq/pricing` | "Khusus HQ" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.10 |

### 3.7 Staf dan akses (STF), karyawan (HRM)

| ID | Skenario bisnis | Aktor | Prasyarat | Data uji | Langkah | Hasil diharapkan | Hasil aktual | Status | Bagian dokumen |
|---|---|---|---|---|---|---|---|---|---|
| TS-STF-01 | Undang Kepala depot | Super admin | Depot uji | Nomor sintetis, posisi, gaji | `/hq/staff` → **＋ Undang staf** | Akun aktif; kartu karyawan di HR | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.2, F12 |
| TS-STF-02 | Undang tanpa depot untuk Staf depot | Super admin | — | Depot kosong | Kirim | "Peran staf depot wajib terikat ke satu depot." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.2 |
| TS-STF-03 | Nomor tidak sah | Super admin | — | `123` | Kirim | `"X" is not a valid Indonesian mobile number.` | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.2 |
| TS-STF-04 | Posisi/gaji kosong | Super admin | — | Posisi kosong | Kirim | "Posisi dan gaji wajib diisi…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.2 |
| TS-STF-05 | Undang ulang nomor sama dengan peran baru | Super admin | Akun ada | Peran berbeda | Undang | Akun dipromosikan, bukan ganda; akun nonaktif ikut aktif | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.3 |
| TS-STF-06 | Head office memberi peran Direktur (akses tak sah) | Head office | — | Peran Direktur | Undang | Pilihan tidak ditawarkan; server "Peran DIREKTUR hanya boleh diberikan oleh SUPER_ADMIN." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.7 |
| TS-STF-07 | HR memberi Manajer; Head office memberi Manajer | HR; Head office | — | Peran Manajer | Beri lewat jabatan | HR berhasil; Head office ditolak "Peran MANAGER hanya boleh diberikan oleh SUPER_ADMIN atau HR." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.7 |
| TS-STF-08 | Nonaktifkan akun | Super admin | Akun aktif | — | **Nonaktifkan** | Lencana Nonaktif; masuk baru ditolak; semua token penyegar akun dicabut (sejak PR #664) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.5 |
| TS-STF-09 | Akses sisa setelah nonaktif (jeda token akses) | Staf yang dinonaktifkan | Sesi aktif | Token < 15 menit | Dinonaktifkan; lakukan aksi dengan token akses lama; lalu coba perpanjang sesi | Aksi masih bisa sampai ±15 menit (token akses, tidak ada pengecekan status per permintaan **[K]**); perpanjangan sesi gagal segera karena token penyegar dicabut (sejak PR #664) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.5, F13 |
| TS-STF-10 | Aktifkan kembali | Super admin | Nonaktif | — | **Aktifkan** | Masuk lagi | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.5 |
| TS-STF-11 | Hapus akun staf | Super admin | Admin lain ada | Nama persis | **Hapus** → ketik nama | Akun DELETED, kartu HR dianonimkan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.6 |
| TS-STF-23 | Nonaktifkan akun sendiri (sejak PR #664) | Super admin | Masuk sebagai Super admin A; ada Super admin B | Akun A | `/hq/staff` → baris akun sendiri → **Nonaktifkan** | Ditolak "Akun sendiri tidak bisa dinonaktifkan."; akun tetap aktif | API: Super admin nonaktifkan diri sendiri -> 400 "Akun sendiri tidak bisa dinonaktifkan.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 10 §6.5, Bab 13 T-05 |
| TS-STF-24 | Nonaktifkan Super admin terakhir (sejak PR #664) | Super admin | Tepat dua akun Super admin aktif (A dan B); satu akun lain berhak menonaktifkan (mis. B atau jalur HR) | Dua akun Super admin | Nonaktifkan A (berhasil); lalu coba nonaktifkan B (yang tersisa) | Penonaktifan Super admin terakhir ditolak "Ini super admin terakhir. Angkat super admin lain dulu sebelum menonaktifkan." | Dengan dua Super admin: nonaktifkan yang kedua berhasil; Head office coba nonaktifkan yang terakhir -> 400 "Ini super admin terakhir. Angkat super admin lain dulu sebelum menonaktifkan." (akun kedua diaktifkan kembali). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 10 §6.5, Bab 13 T-05 |
| TS-STF-25 | Head office tidak bisa membuat sesama Head office (sejak PR #664) | Head office | — | Peran Head office | Buka form undang; cek daftar peran; coba kirim peran Head office lewat API (uji teknis) | Daftar peran hanya Staf depot, Kepala depot, Asisten SPV, SPV, Pemilik waralaba; lewat API: "Peran HEAD_OFFICE hanya boleh diberikan oleh SUPER_ADMIN."; Super admin masih bisa | API: Head office undang HEAD_OFFICE -> 403 AUTH_ROLE_ESCALATION "Peran HEAD_OFFICE hanya boleh diberikan oleh SUPER_ADMIN."; SUPER_ADMIN juga ditolak untuk Head office; undang STAFF_DEPOT berhasil; Super admin undang HEAD_OFFICE berhasil. Daftar peran di form UI tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.4, Bab 13 17.3 |
| TS-STF-26 | Undang staf dari `/dashboard/staff` (sejak PR #664) | Head office/Super admin | — | Nomor sintetis, posisi, gaji | Buka `/dashboard/staff`; kirim undangan | Memakai form undang HQ yang membawa kolom karyawan; tidak lagi gagal 400 karena kolom wajib tidak terkirim | Belum diuji oleh tim dokumentasi | Not Tested | Bab 13 18.6 |
| TS-STF-27 | Tab rel Kepala depot sesuai kapabilitas (sejak PR #664) | Kepala depot | — | — | Lihat tab pengelolaan di rel operator | Tab Pembayaran TIDAK tampil; tab Meteran, Prakiraan, Aturan promo, Sengketa, CRM, Peran, Akun tampil sesuai kapabilitas peran; tombol tulis Promo hanya bila punya `promotionWrite` | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3, Bab 14 §2.2 |
| TS-STF-28 | Menu SPV sesuai kapabilitas server (sejak PR #664) | SPV | — | — | Lihat menu: Komisi kurir, Tinjauan bulanan, Performa tim | Menu tampil hanya bila peran memegang `courierSettle`, `dailyClose`, `deliveryReports`; tidak ada menu yang berujung 403 | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5, Bab 13 T-16 |
| TS-STF-12 | Hapus akun sendiri | Super admin | — | — | Hapus diri | "Akun sendiri tidak bisa dihapus." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.6 |
| TS-STF-13 | Hapus Super admin terakhir | Super admin | Hanya satu | — | Hapus | "Ini super admin terakhir…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.6 |
| TS-STF-14 | Head office mencoba Hapus (akses tak sah) | Head office | — | — | Cari tombol | Tombol Hapus tidak tampil | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.6 |
| TS-STF-15 | Impor staf massal dengan baris bermasalah | Head office | — | 5 baris, 1 peran terbatas | Unggah → Import | Baris peran terbatas gagal dengan pesan; lainnya dibuat | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.5 |
| TS-STF-16 | Ubah matriks hak akses | Super admin | Ada peran uji | Satu kapabilitas | `/hq/access` klik sel → **Simpan** | Berlaku ±30–45 detik; tercatat | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.1 |
| TS-STF-17 | Cabut Super admin dari accessMatrixWrite | Super admin | — | — | Cabut → Simpan | "SUPER_ADMIN tidak boleh dilepas dari accessMatrixWrite." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.1 |
| TS-STF-18 | Non-admin membuka editor matriks (akses tak sah) | Head office | — | — | Buka `/hq/access` | Tidak ada di menu; simpan ditolak | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.1 |
| TS-STF-19 | Hierarki: tugaskan Asisten SPV ke depot | Super admin | — | Depot uji | `/hq/hierarchy` → pilih asisten | "Tersimpan. Berlaku di seluruh service dalam 60 detik." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.8 |
| TS-STF-20 | Atasan melingkar | Super admin | — | A atasan B, B atasan A | Simpan | "Penugasan ini membentuk lingkaran atasan-bawahan." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.8 |
| TS-STF-21 | Manajer melihat depot di luar hierarki (batas lintas depot) | Manajer | Depot bukan binaan | — | Buka data depot via URL | Ditolak "Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 Lampiran A.1 |
| TS-STF-22 | Kepala depot pada depot lain (batas lintas depot) | Kepala depot A | Pesanan depot B | ID | Buka `/dashboard/orders?order=<id>` | Ditolak | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.2 |
| TS-HRM-01 | Tambah karyawan | HR | — | Data sintetis | `/hr/employees/new` → **Tambah Karyawan** | Toast "Karyawan ditambahkan"; kode `HR-####`; akun login dibuat | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.1, F13 |
| TS-HRM-02 | Nomor sudah dipakai akun lain | HR | Nomor milik akun X | Nomor X | Simpan | Kartu kuning; tombol "Ya, gunakan akun itu" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.1 |
| TS-HRM-03 | Gaji 0 / NIK 15 digit | HR | — | Gaji 0; NIK pendek | Simpan | "Gaji harian (dailyRate) wajib > 0."; "NIK harus 16 digit angka." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.1 |
| TS-HRM-04 | Head office memberi Manajer lewat HR | Head office | — | Jabatan Manager | Simpan | Ditolak server; sejak PR #664 alasan 4xx dari auth-service (mis. "Peran MANAGER hanya boleh diberikan oleh SUPER_ADMIN atau HR.") diteruskan ke layar HR; kegagalan 401 tetap dianggap gangguan layanan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.1 |
| TS-HRM-05 | Offboarding: Resign dengan tanggal keluar | HR | Karyawan aktif | Tanggal keluar | Edit → Resign → Simpan | Akun login ditangguhkan; slip terakhir bisa dibuat | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.6 |
| TS-HRM-11 | Karyawan dinonaktifkan HR: sesi dicabut (sejak PR #664) | HR | Karyawan aktif dengan sesi login | — | Edit → Status Nonaktif/Resign → Simpan; karyawan coba memperpanjang sesi | Login dimatikan; token penyegar dicabut; token akses lama bertahan ≤ 15 menit | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.6, Bab 13 T-58 |
| TS-HRM-06 | Resign tanpa tanggal keluar lalu payroll | HR | — | Tanggal kosong | Generate payroll | "Karyawan berstatus RESIGNED tanpa tanggal keluar…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.6 |
| TS-HRM-07 | Ubah depot dengan penugasan terbuka | HR | Ada penugasan | — | Edit depot | 409 "Karyawan ini punya penugasan depot yang terjadwal atau berjalan…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.2 |
| TS-HRM-08 | Enroll wajah tanpa persetujuan | HR | — | — | **Simpan Enroll** tanpa centang | Tombol nonaktif | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.5 |
| TS-HRM-09 | Unggah dokumen format salah / > 5 MB | HR | — | .exe; 8 MB | Unggah | "Tipe file tidak didukung…"; "Ukuran file melebihi 5MB" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.5 |
| TS-HRM-10 | HR depot lain mengubah karyawan (batas lintas depot) | HR terkunci depot | Karyawan depot lain | — | Edit | Ditolak/dibatasi | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.1 [D] |

### 3.8 Absensi (ATT), cuti (LEV), kasbon (KAS)

| ID | Skenario bisnis | Aktor | Prasyarat | Data uji | Langkah | Hasil diharapkan | Hasil aktual | Status | Bagian dokumen |
|---|---|---|---|---|---|---|---|---|---|
| TS-ATT-01 | Enroll wajah sendiri | Karyawan | Akun tertaut karyawan | U-FACE | `/hr/me/enroll` → 1–3 foto → centang persetujuan → **Simpan** | "Wajah berhasil didaftarkan" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.16, F14 |
| TS-ATT-02 | Enroll tanpa persetujuan | Karyawan | — | Tanpa centang | Simpan | Tombol nonaktif atau pesan persetujuan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.16 |
| TS-ATT-03 | Check-in tepat waktu | Karyawan | Wajah terdaftar; GPS | U-FACE | **Absen Sekarang** → Check-in | "Check-in berhasil"; status Hadir | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.17 |
| TS-ATT-04 | Check-in terlambat | Karyawan | Shift mulai + toleransi lewat | — | Check-in | Status Terlambat dengan menit | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.17 |
| TS-ATT-05 | Check-in dua kali | Karyawan | Sudah check-in | — | Check-in lagi | "Sudah check-in hari ini" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.17 |
| TS-ATT-06 | Check-out tanpa check-in | Karyawan | Belum check-in | — | Check-out | "Belum check-in hari ini" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.17 |
| TS-ATT-07 | Wajah orang lain (akses tak sah) | Karyawan B | Wajah A terdaftar | Wajah B | Check-in sebagai A | "Wajah tidak cocok" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.17 |
| TS-ATT-08 | Di luar geofence | Karyawan | Geofence aktif **[K]** | GPS jauh | Check-in | "Di luar area absen depot ({m} m dari titik)…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.17 |
| TS-ATT-09 | Absen offline lalu sambung | Karyawan | Putuskan jaringan | — | Check-in offline; sambung dalam 10 menit | Diterima normal; > 10 menit menjadi "Menunggu persetujuan" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.17 |
| TS-ATT-10 | Absen offline > 24 jam | Karyawan | — | Antrean tua | Kirim | "Absen offline sudah terlalu lama. Minta entri manual ke HR." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.17 |
| TS-ATT-11 | HR setujui absen tertahan | HR | Ada absen Menunggu | — | Setujui | Hadir atau Terlambat | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.8 |
| TS-ATT-12 | HR tolak absen tertahan | HR | — | — | Tolak | Status Absen | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.8 |
| TS-ATT-13 | Koreksi status tanpa alasan | HR | Catatan ada | Alasan kosong | **Koreksi** | Alasan wajib | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.8 |
| TS-ATT-14 | Entri manual pada hari yang sudah punya catatan | HR | Catatan ada | — | Simpan | 409 "Hari itu sudah punya catatan kehadiran…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.8 |
| TS-ATT-15 | Kamera ditolak | Karyawan | Izin kamera ditolak | — | Buka absen | Pesan izin kamera dan tombol "Coba lagi" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.16 |
| TS-LEV-01 | Ajukan cuti tahunan | Karyawan | Kuota cukup | 2 hari kerja | `/hr/me/leave` → **Ajukan Cuti** | "Pengajuan cuti terkirim"; Menunggu atasan; penyetuju diberi tahu | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.18, F15 |
| TS-LEV-02 | Kolom wajib kosong | Karyawan | — | Alasan kosong | Ajukan | "Alasan wajib diisi." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.18 |
| TS-LEV-03 | Kuota tidak cukup | Karyawan | Sisa 1 hari | 3 hari | Ajukan | "Sisa kuota cuti {x} hari, pengajuan {y} hari" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.18 |
| TS-LEV-04 | Rentang bentrok | Karyawan | Ada pengajuan pada rentang | — | Ajukan | "Sudah ada pengajuan cuti pada rentang tanggal tersebut" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.18 |
| TS-LEV-05 | Rentang tanpa hari kerja | Karyawan | — | Sabtu–Minggu | Ajukan | "Rentang tanggal tidak memuat hari kerja" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.18 |
| TS-LEV-06 | Persetujuan dua tahap lengkap | Manajer lalu HR | Pengajuan Menunggu atasan | Dua akun berbeda | Manajer setujui; HR setujui | Disetujui; absensi Cuti ditulis; kuota terpotong | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.10 |
| TS-LEV-07 | Tolak tanpa catatan | Manajer | — | Catatan kosong | Tolak | "Alasan penolakan wajib diisi" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.10 |
| TS-LEV-08 | Pemohon memutuskan cuti sendiri | HR sebagai pemohon | HR mengajukan cuti sendiri | — | Setujui | 403 "Tidak bisa memutuskan pengajuan cuti Anda sendiri" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.10 |
| TS-LEV-09 | Orang yang sama memutuskan kedua tahap | HR | Tahap 1 diputuskan HR itu | — | Putuskan tahap 2 | 403 "Tahap kedua harus diputuskan orang lain…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.10 |
| TS-LEV-10 | Batalkan saat menunggu | Karyawan | Menunggu | — | **Batalkan** | Dibatalkan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.18 |
| TS-LEV-11 | Batalkan cuti yang sudah disetujui | Karyawan | Disetujui | — | Batalkan | 409 "Pengajuan berstatus APPROVED tidak bisa cancel" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.18 |
| TS-LEV-12 | Kepala depot memutuskan cuti kurir (akses tak sah) | Kepala depot | — | — | Cari antrean cuti | Tidak ada akses (`leaveApprove`) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.18 |
| TS-LEV-13 | Manajer depot lain memutuskan (lintas depot) | Manajer | Karyawan depot di luar cakupan | — | Setujui | Ditolak akses depot | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.10 |
| TS-KAS-01 | Ajukan kasbon | Karyawan | Depot punya Asisten SPV; gaji pokok terisi ≥ nominal (sejak PR #664) | Rp 500.000 | `/hr/me/kasbon` → **Ajukan Kasbon** | "Pengajuan kasbon terkirim."; Asisten SPV diberi tahu | API: karyawan ajukan Rp500.000 -> 201 PENDING. Notifikasi Asisten SPV tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.19, F16 |
| TS-KAS-02 | Dua pengajuan terbuka | Karyawan | Ada pengajuan PENDING | — | Ajukan lagi | 409 "Masih ada pengajuan kasbon yang belum diputuskan." | API: pengajuan kedua -> 409 "Masih ada pengajuan kasbon yang belum diputuskan.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.19 |
| TS-KAS-03 | Nominal 0 atau alasan kosong | Karyawan | — | 0 | Ajukan | "Nominal harus lebih dari 0."; "Alasan wajib diisi." | API: nominal 0 -> 400 "amount must be a positive number"; alasan kosong -> 400 "Alasan kasbon wajib diisi" (kalimat "Nominal harus lebih dari 0." berasal dari UI, tidak diperiksa). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.19 |
| TS-KAS-04 | Asisten SPV setujui dengan cicilan | Asisten SPV | Pengajuan di depotnya | Cicilan Rp 100.000; mulai 2026-11 | Setujui | "Kasbon disetujui."; pinjaman dibuat; potongan di slip | Asisten SPV depot itu setujui dengan cicilan Rp100.000 mulai 2026-11 -> APPROVED; pinjaman dibuat (pokok 500000, cicilan 100000, startPeriod 2026-11, aktif). Potongan di slip tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 6 (Kasbon), F16 |
| TS-KAS-05 | Setujui tanpa cicilan | Asisten SPV | — | Kosong | Setujui | "Cicilan dan bulan mulai wajib diisi untuk menyetujui." | API: setujui tanpa cicilan -> 400 "Cicilan per bulan harus bilangan bulat lebih dari 0" (kalimat berbeda dari panduan). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.11 |
| TS-KAS-06 | Tolak tanpa alasan | Asisten SPV | — | — | Tolak | "Alasan penolakan wajib diisi." | API: tolak tanpa catatan -> 400 "Alasan penolakan wajib diisi". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.11 |
| TS-KAS-07 | Manajer/HR memutuskan padahal ada Asisten SPV | Manajer | Depot punya asisten | — | Setujui | 403 "Kasbon ini diputuskan oleh asisten supervisor depotnya." | HR memutuskan kasbon depot beraasisten -> 403 "Kasbon ini diputuskan oleh asisten supervisor depotnya." Manajer uji (Manajer Depot Cikini) -> 403 "Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya." karena di luar lingkup depot. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.11 |
| TS-KAS-08 | Eskalasi saat depot tanpa asisten | Manajer | Depot tanpa asisten | — | Setujui | Berhasil | Depot Cikini tanpa asisten: Manajer setujui -> APPROVED. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 6 (Eskalasi kasbon) |
| TS-KAS-09 | Memutuskan kasbon sendiri | Asisten SPV pemohon | Kasbon miliknya | — | Setujui | "Kasbon sendiri tidak bisa Anda setujui." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.11 |
| TS-KAS-10 | Dua penyetuju bersamaan | Asisten SPV A, B | Pengajuan sama | — | Keduanya setujui | "Pengajuan ini sudah dijawab orang lain. Muat ulang daftarnya." | Keputusan kedua dengan seenUpdatedAt lama -> 409 STALE_WRITE "Data ini sudah diubah orang lain sejak Anda membukanya." (kalimat berbeda dari panduan). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.11 |
| TS-KAS-11 | Kepala depot / SPV memutuskan (akses tak sah) | SPV | — | — | Buka `/hr/loans/requests` | Server menolak (`kasbonApprove`) | API: SPV GET /loan-requests -> 403 FORBIDDEN. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 6 §10 |

| TS-KAS-12 | Kasbon melebihi 1x gaji pokok (sejak PR #664) | Karyawan | Gaji bulanan Rp 3.000.000 (harian: tarif x 26) | Rp 4.000.000 | Ajukan Kasbon | 400 "Kasbon melebihi batas 1x gaji pokok (Rp3.000.000)."; nominal = batas diterima | Gaji bulanan Rp5.000.000, ajukan Rp6.000.000 -> 400 "Kasbon melebihi batas 1x gaji pokok (Rp5.000.000)." Nominal pas batas tidak diuji. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.19, Bab 13 T-28 |
| TS-KAS-13 | Gaji pokok belum diisi (sejak PR #664) | Karyawan | Tarif bulanan/harian kosong | Rp 100.000 | Ajukan Kasbon | 400 "Gaji pokok Anda belum diisi sehingga batas kasbon tidak bisa dihitung. Hubungi HR." | Tarif bulanan dan harian dikosongkan di DB uji (lalu dipulihkan): 400 "Gaji pokok Anda belum diisi sehingga batas kasbon tidak bisa dihitung. Hubungi HR.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.19, Bab 13 T-28 |
| TS-KAS-14 | Pengajuan kedaluwarsa 3 hari kerja (sejak PR #664) | Asisten SPV, Karyawan | Pengajuan PENDING berumur > 3 hari kerja (atur tanggal di lingkungan uji **[D]**) | — | Penyetuju coba memutuskan; lalu karyawan membuka/mengajukan lagi | Keputusan ditolak 409 "Pengajuan ini kedaluwarsa (lewat 3 hari kerja); pemohon perlu mengajukan lagi."; pengajuan menjadi Dibatalkan dengan catatan "Kedaluwarsa: tidak diputuskan dalam 3 hari kerja."; karyawan dapat mengajukan lagi | createdAt dimundurkan 6 hari di DB uji: keputusan -> 409 "Pengajuan ini kedaluwarsa (lewat 3 hari kerja); pemohon perlu mengajukan lagi."; pengajuan CANCELLED dengan catatan "Kedaluwarsa: tidak diputuskan dalam 3 hari kerja."; karyawan dapat mengajukan lagi (juga lewat pembersihan malas saat mengajukan). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.11, Bab 13 T-28 |

### 3.9 Payroll (PRL), lintas depot (ASG)

| ID | Skenario bisnis | Aktor | Prasyarat | Data uji | Langkah | Hasil diharapkan | Hasil aktual | Status | Bagian dokumen |
|---|---|---|---|---|---|---|---|---|---|
| TS-PRL-01 | Generate slip bulan lalu | HR | Bulan sudah berakhir | Karyawan uji | `/hr/payroll` → **Generate** | "Payroll digenerate"; status Draft | API: generate 2026-09 oleh HR -> 201 DRAFT (createdBy = akun HR). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.12, F17 |
| TS-PRL-02 | Generate bulan berjalan | HR | — | Bulan ini | Generate | "Periode {YYYY-MM} belum selesai…" | API: 400 "Periode 2026-10 belum selesai. Payroll baru bisa dibuat setelah bulan itu berakhir.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.12 |
| TS-PRL-03 | Generate tanpa memilih karyawan | HR | — | — | Generate | "Isi employeeId untuk generate" | API: tanpa employeeId -> 400 "employeeId must be a UUID" (pesan validasi Inggris; kalimat UI tidak diperiksa). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.12 |
| TS-PRL-04 | Batch sedepot | HR | Depot dengan karyawan Aktif | U-DEPOT1 | **Buat sedepot** | "{n} draf ditulis"; karyawan Resign tidak ikut | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.12 |
| TS-PRL-05 | Hitung ulang Draft | HR | Slip Draft; data berubah | — | **Hitung ulang** | "Slip dihitung ulang" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.12 |
| TS-PRL-06 | Setujui Draft | HR (akun BUKAN pembuat slip, sejak PR #664) | — | — | **Setujui** → konfirmasi | "Payroll disetujui"; status Disetujui | API: HR kedua (bukan pembuat) setujui -> 201 APPROVED, approvedBy = akun HR kedua. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.12 |
| TS-PRL-07 | Hitung ulang slip Disetujui | HR | — | — | Hitung ulang | "Hanya payroll DRAFT yang bisa dihitung ulang (saat ini APPROVED)" | API: regenerate slip APPROVED -> 409 "Hanya payroll DRAFT yang bisa dihitung ulang (saat ini APPROVED)". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.12 |
| TS-PRL-08 | Tandai dibayar sebelum disetujui | HR | Slip Draft | — | Bayar | "Hanya payroll APPROVED yang bisa dibayar (saat ini DRAFT)" | API: bayar slip DRAFT -> 409 "Hanya payroll APPROVED yang bisa dibayar (saat ini DRAFT)". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.12 |
| TS-PRL-09 | Tandai dibayar | Finance | Disetujui | — | **Tandai Dibayar** | Dibayar; final; sistem tidak memindahkan uang | API: Finance bayar slip APPROVED -> 201 PAID. Tidak ada perpindahan uang oleh sistem (tidak diperiksa lebih jauh). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.12 |
| TS-PRL-10 | Akun yang sama membuat, menyetujui, membayar (diperbarui sejak PR #664) | HR | — | — | Buat slip, lalu coba Setujui dengan akun yang sama | Setujui DITOLAK 403 "Slip ini dibuat oleh akun Anda sendiri; persetujuan harus dari orang lain (atau Super Admin)." Setelah akun lain menyetujui, Tandai Dibayar tidak dibatasi oleh pembuat/penyetuju yang sama (catat sebagai temuan kebijakan **[K]**) | HR pembuat setujui slip sendiri -> 403 "Slip ini dibuat oleh akun Anda sendiri; persetujuan harus dari orang lain (atau Super Admin)." Setelah HR kedua setujui, Finance bayar tanpa pembatasan pembuat/penyetuju. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.12 [K] |
| TS-PRL-11 | Manajer/SPV menekan Setujui (akses tak sah) | Manajer | — | — | Cari tombol | Tombol tidak tampil (`hrPayroll`) | API: Manajer dan SPV setujui -> 403 FORBIDDEN (tombol UI tidak diperiksa). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.12 |
| TS-PRL-12 | Karyawan membaca slip sendiri dan slip orang lain | Karyawan | — | ID slip lain | Buka `/hr/me/payroll`; ubah ID | Slip sendiri tampil; orang lain 404 "Payroll tidak ditemukan" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.20 |
| TS-PRL-13 | Kasbon dipotong di slip | HR | Kasbon disetujui | — | Generate | Baris "Cicilan pinjaman" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.12 |
| TS-PRL-14 | Impor slip riwayat bulan berjalan | HR | — | Baris bulan ini | Impor | "Hanya bulan yang sudah lewat yang bisa diimpor sebagai riwayat" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.12 |
| TS-PRL-15 | Unduh PDF slip | Karyawan | Slip ada | — | **Unduh PDF** | Berkas terunduh; gagal: "Gagal unduh" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.20 |
| TS-PRL-16 | Super admin menyetujui slip yang ia buat sendiri (sejak PR #664) | Super admin | Slip Draft dibuat oleh Super admin yang sama | — | **Setujui** → konfirmasi | Berhasil (Super admin dikecualikan dari larangan persetujuan sendiri); status Disetujui | Super admin generate slip lalu setujui sendiri -> 201 APPROVED. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.12, Bab 13 T-56 |
| TS-PRL-17 | Super admin membatalkan persetujuan dengan alasan (sejak PR #664) | Super admin | Slip Disetujui (belum Dibayar) | Alasan "Salah periode" | Rincian payroll → isi "Alasan membatalkan persetujuan (wajib):" → **Batalkan persetujuan** | Toast "Persetujuan dibatalkan; slip kembali ke DRAFT."; status Draft; approvedBy dikosongkan; audit PAYROLL_UNAPPROVE memuat alasan | Super admin Batalkan persetujuan dengan alasan "Salah periode" -> 200, status DRAFT, approvedBy kosong; audit PAYROLL_UNAPPROVE memuat reason. UI: tombol Batalkan persetujuan nonaktif sampai alasan diisi; toast tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.12, Bab 13 T-56 |
| TS-PRL-18 | Batal persetujuan oleh bukan Super admin (sejak PR #664) | HR/Finance | Slip Disetujui | — | Cari tombol; lalu panggil `POST /payroll/:id/unapprove` (uji teknis) | Tombol tidak tampil; server 403 "Hanya Super Admin yang bisa membatalkan persetujuan payroll." | API: HR dan Finance unapprove -> 403 "Hanya Super Admin yang bisa membatalkan persetujuan payroll."; UI: HR tidak melihat tombol. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.12, Bab 13 T-56 |
| TS-PRL-19 | Batal persetujuan tanpa alasan atau alasan < 3 karakter (sejak PR #664) | Super admin | Slip Disetujui | Alasan kosong / "ab" | Isi alasan; tekan tombol | Tombol nonaktif bila alasan < 3 karakter; server menolak alasan kosong ("Alasan wajib diisi.") | UI: tombol nonaktif tanpa alasan. API: reason kosong/"ab" -> 400 validasi ("reason must be longer than or equal to 3 characters"); hanya alasan berisi spasi yang menghasilkan "Alasan wajib diisi.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.12 |
| TS-PRL-20 | Batal persetujuan setelah Dibayar atau pada Draft (sejak PR #664) | Super admin | Slip Dibayar; slip Draft | — | Cari tombol; panggil API unapprove | Tombol hanya tampil saat Disetujui; server 409 "Hanya payroll APPROVED yang bisa dibatalkan persetujuannya (saat ini {STATUS})" | API: unapprove slip PAID -> 409 "Hanya payroll APPROVED yang bisa dibatalkan persetujuannya (saat ini PAID)"; slip DRAFT -> 409 (saat ini DRAFT). Tampil/tidaknya tombol UI pada slip PAID tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.12, Bab 13 T-56 |
| TS-PRL-21 | Setelah batal persetujuan, penyetuju kedua menyetujui ulang (sejak PR #664) | HR lain | Slip kembali Draft (TS-PRL-17) | — | Setujui lagi dengan akun yang bukan pembuat | Status Disetujui lagi; approvedBy akun baru | Setelah batal, HR kedua setujui lagi -> APPROVED, approvedBy akun baru. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 8 §6.12 |
| TS-ASG-01 | Fitur mati: halaman permintaan pinjam | Manajer | `DEPOT_ASSIGNMENT_ENABLED` mati | — | Buka `/hr/depot-requests` | "Penugasan lintas depot belum diaktifkan" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.19, F18 |
| TS-ASG-02 | Ajukan pinjam (fitur aktif) | Manajer | Fitur aktif; karyawan memenuhi syarat | Kode `HR-0012` (sintetis) | Isi form → **Ajukan** | "Permintaan terkirim ke HR"; status Diajukan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 (pinjam karyawan) |
| TS-ASG-03 | Kode karyawan salah | Manajer | — | `XX-1` | Ajukan | "Karyawan tidak ditemukan" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 |
| TS-ASG-04 | Depot tujuan di luar cakupan | Manajer | — | Depot lain | Ajukan | "Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 |
| TS-ASG-05 | Tanggal akhir kosong | Manajer | — | — | Ajukan | "Tanggal akhir peminjaman wajib diisi…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 |
| TS-ASG-06 | Kepala depot / Asisten SPV mengajukan (akses tak sah) | Kepala depot | — | — | Buka halaman | Ditolak | Belum diuji oleh tim dokumentasi | Not Tested | Bab 5 |
| TS-ASG-07 | HR setujui permintaan | HR | Status Diajukan | — | **Setujui** | Terjadwal; berpindah pada tanggal mulai | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.19 |
| TS-ASG-08 | HR tolak tanpa alasan | HR | — | Alasan 2 huruf | **Tolak** | "Alasan penolakan wajib diisi." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.19 |
| TS-ASG-09 | Penugasan bertabrakan | HR | Penugasan lain berjalan | — | Rencanakan | "Penugasan bertabrakan dengan penugasan lain yang masih berjalan atau terjadwal." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.19 |
| TS-ASG-10 | Mundur tanggal pada bulan payroll terkunci | HR | Slip bulan itu Dibayar | — | Rencanakan mundur | Ditolak dengan pesan payroll sudah disetujui/dibayar | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.19 |
| TS-ASG-11 | Penugasan mulai dan berakhir otomatis | Sistem | Terjadwal | — | Sapuan 15 menit pada tanggal mulai; hari terakhir | Berjalan lalu Selesai; kembali ke depot asal | Belum diuji oleh tim dokumentasi | Not Tested | F18, F22 |

### 3.10 UU PDP (PDP), klaim kurir (CLM), tarik saldo kurir (WDR)

| ID | Skenario bisnis | Aktor | Prasyarat | Data uji | Langkah | Hasil diharapkan | Hasil aktual | Status | Bagian dokumen |
|---|---|---|---|---|---|---|---|---|---|
| TS-PDP-01 | Minta salinan data | Pelanggan | Masuk | — | Akun → **Minta salinan data** | "Permintaan terkirim. Kantor pusat akan meninjau."; Menunggu ditinjau | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 (UU PDP), F19 |
| TS-PDP-02 | Permintaan sejenis ganda | Pelanggan | Permintaan terbuka | — | Kirim lagi | "Permintaan sejenis masih diproses." | API: permintaan DELETE kedua -> 409 PDP_REQUEST_OPEN "Permintaan sejenis masih diproses.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 2 |
| TS-PDP-03 | HQ setujui salinan | Head office | Permintaan Menunggu | — | `/hq/pdp` → **Setujui** | JSON terunduh; pelanggan dapat mengunduh dalam 7 hari | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.29 |
| TS-PDP-04 | Unduh sebelum disetujui | Pelanggan | Menunggu | — | **Unduh salinan data** | "Ekspor data belum disetujui…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-PDP-05 | Unduh setelah 7 hari | Pelanggan | Disetujui > 7 hari | — | Unduh | "Persetujuan ekspor sudah lewat 7 hari…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 |
| TS-PDP-06 | Minta hapus akun lalu HQ setujui | Pelanggan, Head office | Akun uji tanpa pesanan terbuka (sejak PR #664 wajib; lihat TS-PDP-13) | — | Minta hapus → konfirmasi; HQ setujui | Akun dianonimkan; pesanan/pembayaran disimpan tanpa identitas; langganan batal | Setelah menambah env ORDER_SERVICE_URL/CUSTOMER_SERVICE_URL/DELIVERY_SERVICE_URL/LOYALTY_SERVICE_URL/ADMIN_SERVICE_URL ke kontainer auth (override di luar repo): HQ setujui pelanggan tanpa pesanan terbuka -> COMPLETED, akun DELETED, nama diganti "Pengguna dihapus". Tanpa env itu SETIAP persetujuan hapus akun -> 503 (G-149). Pesanan tersimpan dan langganan batal tidak diperiksa; 3 dari 6 eksekutor penghapusan gagal (G-150). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 2, Bab 9 §6.29 |
| TS-PDP-07 | HQ tolak tanpa alasan | Head office | — | Alasan kosong | **Tolak** | Alasan wajib | API: reject tanpa reason -> 400 "reason should not be empty". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.29 |
| TS-PDP-08 | Direktur/Finance membuka PDP (akses tak sah) | Direktur | — | — | Buka `/hq/pdp` | "Khusus HQ" / ditolak | API: Direktur GET antrean -> 403 FORBIDDEN. Halaman UI tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.29 |
| TS-PDP-09 | Permintaan melewati 72 jam | Head office | Permintaan > 3 hari | — | Buka antrean | Lencana merah "LEWAT BATAS 3x24 jam"; urut terlama dulu | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.29 |
| TS-PDP-10 | Putuskan dua kali | Head office | Sudah diputuskan | — | Setujui lagi | "Permintaan ini sudah diputuskan." | API: setujui ulang -> 409 PDP_REQUEST_DECIDED "Permintaan ini sudah diputuskan.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.29 |
| TS-PDP-11 | Masuk setelah akun dihapus | Pelanggan | Akun DELETED | — | Masuk | Ditolak "Akun ini tidak aktif…" | Login dengan nomor akun yang sudah DELETED tidak ditolak: respons 200 purpose REGISTRATION (nomor dianggap belum terdaftar, OTP pendaftaran dikirim). Tidak ada pesan "Akun ini tidak aktif..." (G-153). (2026-10-14, uji lokal, kode setelah PR #664) | Fail | Bab 2 |
| TS-PDP-12 | Hapus akun staf lewat layar PDP | Super admin | Akun staf | — | Hapus lewat HQ staf | Layar PDP tidak untuk staf; gunakan Hapus staf | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.19 |
| TS-PDP-13 | Hapus akun ditolak bila ada pesanan terbuka (sejak PR #664) | Pelanggan, Head office | Pelanggan punya pesanan Dipesan/Disiapkan/Dalam perjalanan; permintaan hapus akun diajukan | — | `/hq/pdp` → **Setujui** | 409 PDP_OPEN_ORDERS "Akun ini masih punya {n} pesanan yang belum selesai. Tunggu pesanan selesai atau dibatalkan, atau minta Super Admin memaksa penghapusan."; akun tidak berubah; Head office tidak melihat dialog paksa | Pelanggan dengan 1 pesanan CREATED: HQ setujui -> 409 PDP_OPEN_ORDERS "Akun ini masih punya 1 pesanan yang belum selesai. Tunggu pesanan selesai atau dibatalkan, atau minta Super Admin memaksa penghapusan."; akun tetap ACTIVE; UI HQ menampilkan pesan itu tanpa dialog paksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.29, Bab 13 T-05 |
| TS-PDP-14 | Non-Super admin memaksa hapus (sejak PR #664) | Head office | Seperti TS-PDP-13 | — | Kirim `force: true` lewat API (uji teknis) | 403 "Hanya Super Admin yang boleh memaksa penghapusan." | API: Head office kirim force:true -> 403 "Hanya Super Admin yang boleh memaksa penghapusan.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §6.29, Bab 13 T-05 |
| TS-PDP-15 | Super admin memaksa hapus lewat dialog (sejak PR #664) | Super admin | Seperti TS-PDP-13 | — | `/hq/pdp` → Setujui → ditolak → dialog "Paksa hapus akun?" → **Ya, paksa hapus** | Akun dianonimkan; audit mencatat penghapusan paksa (forced) dan jumlah pesanan terbuka | UI Super admin: setujui -> ditolak -> dialog "Paksa hapus akun?" dengan tombol "Ya, paksa hapus" tampil. Pemaksaan dijalankan via API oleh Super admin: COMPLETED, akun DELETED; audit pdp.request.anonymised memuat forced true dan openOrders 1. Klik tombol dialog tidak dijalankan. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 10, Bab 13 T-05 |
| TS-PDP-16 | Hapus akun saat order-service tak terjangkau, fail-closed (sejak PR #664) | Head office | Order-service dimatikan (simulasi **[D]**) | — | Setujui permintaan hapus akun | Ditolak dengan pesan layanan tak tersedia (mis. "order-service tidak terjangkau: …"); akun tidak dihapus | order-service dimatikan: HQ setujui hapus akun -> 503 "order-service tidak terjangkau: fetch failed"; akun tetap ACTIVE (gagal-tertutup). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 13 T-05 |
| TS-CLM-01 | Klaim ≤ Rp50.000 dengan struk | Kurir | `courierPayout` | Rp 30.000, foto struk | `/driver/expenses` → **Kirim klaim** | Disetujui otomatis; saldo bertambah | Klaim Rp30.000, Rp50.000 dengan struk -> tetap PENDING (tidak otomatis). Penyebab lingkungan: setuju-otomatis menuntut struk yang terbukti ada di penyimpanan objek (RECEIPT_STORAGE_BASE_URL di payout-service kosong di docker-compose.test.yml dan penyimpanan hanya stub). Tidak dapat dibuktikan di stack ini. (2026-10-14, uji lokal, kode setelah PR #664) | Blocked | Bab 4 §6.13, F20 |
| TS-CLM-02 | Klaim tanpa struk | Kurir | — | Rp 30.000 tanpa foto | Kirim | Menunggu persetujuan Manajer/Finance | Klaim Rp30.000 tanpa struk -> PENDING; batas otomatis dari API: autoApproveMaxIdr 50000. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.13 |
| TS-CLM-03 | Klaim kolom wajib kosong | Kurir | — | Keterangan kosong | Kirim | Tombol nonaktif | API: keterangan kosong -> 400 "description should not be empty". Tombol UI nonaktif tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.13 |
| TS-CLM-04 | Manajer setujui klaim ≤ Rp500.000 | Manajer | Klaim Menunggu | Rp 200.000 | Setujui | Disetujui; saldo kurir bertambah | Manajer setujui klaim Rp200.000 -> APPROVED, saldo kurir bertambah. Batas pas Rp500.000 juga diterima Manajer. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 5 Lampiran A.5 |
| TS-CLM-05 | Manajer setujui klaim di atas batas | Manajer | Klaim Rp 800.000 | — | Setujui | "Klaim di atas Rp{limit} harus disetujui FINANCE." | Manajer setujui Rp800.000 dan Rp500.001 -> 403 EXPENSE_APPROVAL_ABOVE_LIMIT "Klaim di atas Rp500.000 harus disetujui FINANCE."; Finance setujui Rp800.000 -> APPROVED. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 5 Lampiran A.5 |
| TS-CLM-06 | Tolak klaim | Manajer | — | Catatan | Tolak | Ditolak; kurir melihat alasan | Manajer tolak klaim Rp60.000 dengan catatan -> REJECTED, tanpa mutasi saldo; kurir melihatnya di daftar klaim. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.13 |
| TS-CLM-07 | Putuskan klaim yang sudah final | Finance | Klaim Disetujui | — | Setujui | "Only a pending expense claim can be approved or rejected." | API: setujui klaim yang sudah APPROVED -> 409 EXPENSE_NOT_PENDING "Only a pending expense claim can be approved or rejected.". (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.13 |
| TS-CLM-08 | Kepala depot menyetujui klaim (akses tak sah) | Kepala depot | — | — | Cari antrean | Tidak ada (`expenseApprove`) | API: Kepala depot GET dan approve /expenses -> 403 FORBIDDEN. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.13 |
| TS-WDR-01 | Daftar rekening kurir lalu tarik | Kurir, Finance | Saldo ≥ Rp50.000 (sejak PR #664) | U-BANK | Daftar → Finance verifikasi → **Tarik** | Saldo langsung berkurang; Diproses; kemudian Terkirim | Kurir daftar rekening (PENDING) -> Finance verifikasi -> tarik Rp50.000 (minimum pas) dan Rp100.000: status PROCESSING, saldo langsung berkurang (Rp1.556.000 -> Rp1.406.000); Finance Tandai Dibayar -> PAID. Head office -> 403. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.12, F21 |
| TS-WDR-02 | Tarik melebihi saldo | Kurir | — | Jumlah > saldo | Tarik | "Jumlah melebihi saldo tersedia." | API: 422 PAYOUT_INSUFFICIENT_BALANCE, pesan Inggris "Withdrawal of 99999999 exceeds available balance 1556000." (kalimat UI tidak diperiksa). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.12 |
| TS-WDR-05 | Penarikan di bawah minimum Rp50.000 (sejak PR #664) | Kurir | Rekening terverifikasi; saldo ≥ Rp100.000 | Rp 40.000 | Tarik | 400 "Minimum penarikan Rp50.000."; saldo tidak berubah; Rp50.000 diterima (bawaan `MIN_WITHDRAWAL_IDR`, catat nilai di T-AMBANG) | Kurir tarik Rp40.000 dan Rp49.999 -> 400 PAYOUT_BELOW_MINIMUM "Minimum penarikan Rp50.000."; saldo tidak berubah; Rp50.000 diterima. Berlaku juga untuk pemilik waralaba (Rp40.000 ditolak). MIN_WITHDRAWAL_IDR bawaan 50000. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.12, Bab 13 T-52 |
| TS-WDR-03 | Tarik tanpa rekening terverifikasi | Kurir | Rekening PENDING | — | Tarik | "Daftarkan rekening dan tunggu verifikasi sebelum menarik saldo." | API: tanpa rekening dan dengan rekening PENDING -> 422 PAYOUT_DESTINATION_NOT_VERIFIED "Belum ada rekening tujuan yang terverifikasi. Daftarkan rekening dan tunggu verifikasi kantor pusat sebelum menarik saldo." (lebih panjang dari kalimat panduan). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.12 |
| TS-WDR-04 | Penarikan gagal mengembalikan saldo | Finance | Penarikan PROCESSING | — | **Gagal** | Saldo kembali; catatan "Penarikan gagal, saldo dikembalikan" | Finance tandai Gagal (alasan diisi) pada PROCESSING Rp100.000 -> FAILED, saldo kembali +Rp100.000, buku: "Penarikan gagal - Rekening ditolak bank". Gagal/Lunas kedua kali -> 409 PAYOUT_WITHDRAWAL_NOT_PROCESSING. Tanpa alasan, catatan bawaan "Penarikan gagal, saldo dikembalikan" tidak diuji. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §6.12 |

### 3.11 Pekerjaan otomatis (JOB), keamanan dan pembatasan (SEC), laporan dan ekspor (RPT), pemulihan error (ERR)

| ID | Skenario bisnis | Aktor | Prasyarat | Data uji | Langkah | Hasil diharapkan | Hasil aktual | Status | Bagian dokumen |
|---|---|---|---|---|---|---|---|---|---|
| TS-JOB-01 | Kesehatan sapuan terjadwal | Head office | Penjadwal berjalan | — | `/hq/health` | Kartu "Sapuan terjadwal" menampilkan status tiap sapuan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.28, F22 |
| TS-JOB-02 | Sapuan "Belum pernah jalan" | Admin | Sapuan baru | — | Cek kartu | Ditandai "Belum pernah jalan" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.28 |
| TS-JOB-03 | Antrean efek pesanan dicoba ulang | Sistem | Pesanan Selesai; layanan loyalti terganggu lalu pulih | — | Tunggu sapuan 10 menit | Poin akhirnya masuk sekali | Belum diuji oleh tim dokumentasi | Not Tested | F01, F22 |
| TS-JOB-04 | Peringatan SLA terlambat | Sistem | Pengiriman melewati jendela SLA | — | Sapuan 10 menit | Satu peringatan per pengiriman; tidak mengganti kurir | Belum diuji oleh tim dokumentasi | Not Tested | F22 |
| TS-JOB-05 | Pengingat isi ulang | Sistem | Pelanggan 14 hari tanpa pesanan | — | Sapuan 08:00 | Notifikasi "Saatnya isi ulang?" | Belum diuji oleh tim dokumentasi | Not Tested | F22 |
| TS-JOB-06 | Permintaan ulasan | Sistem | Pesanan Tiba | — | Tunggu 30 menit | Satu notifikasi "Beri penilaian" | Belum diuji oleh tim dokumentasi | Not Tested | F22 |
| TS-JOB-07 | Laporan terjadwal | Head office | Jadwal dibuat | — | Tunggu sapuan jam :17 | Berkas di `/hq/exports`; tidak ada email | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.15 |
| TS-JOB-08 | Pemindaian fraud | Sistem | 3 refund selesai dalam 30 hari | — | Sapuan 11:10 | Item Terbuka; akun tidak diblokir otomatis | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.25 |
| TS-JOB-09 | Blokir akun lewat fraud | Head office | Item Ditinjau | — | **Blokir** | Akun pelanggan tidak bisa masuk; **Tandai aman** mengaktifkan lagi | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.25 |
| TS-JOB-10 | Sapuan retensi dengan pratinjau | Admin | Dataset uji | — | `/hq/retention` → Pratinjau → Jalankan | Jumlah baris cocok pratinjau; data keuangan tidak dihapus | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.12 |
| TS-JOB-11 | Retensi di bawah batas bawah | Admin | — | Audit 30 hari | Ubah | Ditolak dengan alasan (batas 365 hari) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.12 |
| TS-JOB-12 | Kedaluwarsa poin mati bawaan | Sistem | `pointExpirySweepEnabled` belum diisi | — | Sapuan 03:45 | Poin tidak kedaluwarsa | Belum diuji oleh tim dokumentasi | Not Tested | F22 [K] |
| TS-SEC-01 | Pelanggan membuka halaman staf | Pelanggan | — | URL `/dashboard`, `/hq` | Buka | Ditolak/diarahkan; tidak ada data staf | API: token pelanggan ke /auth/staff, /payout/hq/pending, /settlements -> 403 FORBIDDEN. Pengalihan URL halaman tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 2 §9 |
| TS-SEC-02 | Pelanggan B membuka pesanan pelanggan A | Pelanggan B | Pesanan A | ID | Buka `/orders/detail?id=` | 404/403 | API: pelanggan B GET pesanan A -> 404 ORDER_NOT_FOUND; GET pembayaran A -> 404 PAYMENT_NOT_FOUND. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 2 §9 |
| TS-SEC-03 | Pelanggan B mengunggah bukti bayar pesanan A | Pelanggan B | — | ID | Unggah via API | Ditolak | API: pelanggan B unggah jpeg ke pembayaran PENDING pelanggan A -> 404 PAYMENT_NOT_FOUND. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 2 §9 [D] |
| TS-SEC-04 | Kurir membuka konsol depot | Kurir | — | `/dashboard` | Buka | Diarahkan ke `/driver` atau ditolak | API: kurir ke /settlements dan /approvals -> 403. Pengalihan halaman /dashboard tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 4 §9 |
| TS-SEC-05 | Matriks hak akses diubah, efek 30 detik | Admin, Head office | Peran uji | Cabut satu hak | Ubah; uji sebelum dan sesudah 45 detik | Berlaku setelah ±30–45 detik | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.1 |
| TS-SEC-06 | Tombol tampil tetapi server menolak | Direktur | — | Tombol "Ajukan rilis" | Tekan | Server menolak (403); catat sebagai temuan UI **[B]** (tab Pembayaran dan Promo Kepala depot sudah disaring sejak PR #664) | API: Direktur POST /payout/hq/release -> 403 FORBIDDEN. Tampilnya tombol di UI tidak diperiksa. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 9 §1.2 |
| TS-SEC-07 | Kunci API dan webhook | Admin | — | Cakupan webhooks:read | Buat kunci; panggil rute di luar cakupan | Ditolak per cakupan; kunci tampil sekali | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.9 |
| TS-SEC-08 | IP allowlist hanya API mitra | Admin | Allowlist diisi | IP lain | Akses konsol HQ dari IP lain | Konsol HQ tetap terbuka (tidak ditegakkan); API mitra ditolak | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.13 [B] |
| TS-SEC-09 | Token penyegar dipakai ulang | Pengguna | Dua penyegaran | Token lama | Pakai token lama | Seluruh sesi dicabut ("This session was terminated for security reasons.") | Dua penyegaran dengan token lama: pertama 200; pemakaian ulang token lama -> 401 "Session expired."; token terbaru juga ditolak (seluruh keluarga sesi dicabut). Kalimat berbeda dari panduan ("This session was terminated for security reasons."). (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 10 §6.13 |
| TS-SEC-10 | Sesi tidak bisa diperpanjang setelah akun dinonaktifkan (sejak PR #664) | Staf, pelanggan, karyawan HR | Sesi aktif; login lalu dimatikan | Akun uji | Nonaktifkan akun; di perangkat korban coba segarkan sesi/muat ulang setelah token akses habis | Pembaruan sesi gagal ("This account has been suspended." atau diminta masuk ulang); token akses lama masih bisa sampai ±15 menit | Staf depot masuk (token akses terbit 13:38, kedaluwarsa 15 menit kemudian), Super admin nonaktifkan: pembaruan sesi langsung 401 "Session expired."; login baru 403 AUTH_ACCOUNT_NOT_ACTIVE "This account has been suspended."; token akses lama masih diterima /auth/me dan rute data hingga habis masa berlaku, lalu 401 "Invalid or expired access token." (dicek 13:53). Pelanggan dan karyawan HR tidak diuji terpisah. (2026-10-14, uji lokal, kode setelah PR #664) | Pass | Bab 10 §6.5, Bab 13 T-05 |
| TS-RPT-01 | Ekspor laporan harian depot | Kepala depot | Ada pesanan | — | Laporan → **Ekspor Excel/CSV/PDF** | Berkas "laporan-harian" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.9 |
| TS-RPT-02 | Ekspor laporan pendapatan HQ | Head office | — | 30 hari, per Depot, XLSX | `/hq/reports/export` | Berkas `pendapatan-depot-…xlsx`; bila data parsial, ekspor ditahan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.14 |
| TS-RPT-03 | Ekspor tanpa hak (izin ekspor) | Finance | — | — | Buka `/hq/reports/export` | "Khusus HQ" / ditolak | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.14 |
| TS-RPT-04 | Ekspor log audit | Head office | — | — | `/hq/audit` → **Ekspor** | `audit-{tanggal}.xlsx`; bila terlalu besar pesan penolakan; dengan filter aktif (TS-RPT-07) berkas hanya memuat entri yang disaring (sejak PR #664) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.27 |
| TS-RPT-07 | Filter log audit: aksi, tanggal, hasil (sejak PR #664) | Head office/Super admin | Ada entri berhasil dan ditolak pada beberapa tanggal | Aksi persis mis. depot.suspend; Dari/Sampai tanggal; Hasil | `/hq/audit` → isi "Aksi (persis, …)", "Dari tanggal", "Sampai tanggal", "Hasil" (Semua/Berhasil/Ditolak / gagal) | Daftar hanya memuat entri yang cocok; hari "Sampai tanggal" ikut; **Reset filter** mengosongkan; tanpa hasil: "Tidak ada entri yang cocok dengan filter ini." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.27, Bab 13 T-38 |
| TS-RPT-08 | Ekspor audit mengikuti filter (sejak PR #664) | Head office | Filter aktif (TS-RPT-07) | — | Tekan **Ekspor** | Isi berkas sama dengan daftar yang disaring (bukan seluruh jejak) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.27 |
| TS-RPT-05 | Rekonsiliasi dan Net payout "—" | Finance | — | Depot waralaba | `/hq/reconciliation` | Net payout "—" (nilai tak terbaca bukan nol) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.12 [B] |
| TS-RPT-06 | Laporan HR beban BPJS | HR | Slip ada | — | Laporan | Angka cocok dengan slip | Belum diuji oleh tim dokumentasi | Not Tested | Bab 8 §6.17 |
| TS-ERR-01 | Jaringan putus saat checkout | Pelanggan | — | Matikan jaringan | Checkout | Pesan gagal; pesanan tidak ganda saat dicoba lagi | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-ERR-02 | Pembayaran gagal dimulai setelah pesanan dibuat | Pelanggan | Gangguan penyedia (simulasi) | — | Tekan lagi | Pesanan yang sama dipakai | Belum diuji oleh tim dokumentasi | Not Tested | Bab 2 §6 |
| TS-ERR-03 | Penjualan tersimpan tetapi pembayaran belum tercatat | Kepala depot | Gangguan pembayaran (simulasi) | — | **Coba lagi catat pembayaran** | "Pembayaran {pesanan} tercatat." | Belum diuji oleh tim dokumentasi | Not Tested | Bab 3 §6.4 |
| TS-ERR-04 | Antrean offline kurir: membuang konfirmasi COD | Kurir | Antrean berisi konfirmasi COD | — | Tekan buang | Dialog "Buang data ini?" dengan peringatan uang tidak tercatat | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.14 |
| TS-ERR-05 | Penolakan bisnis 4xx tetap di antrean | Kurir | Aksi offline ditolak server | — | Sambung jaringan | Tetap di antrean dengan pesan server | Belum diuji oleh tim dokumentasi | Not Tested | Bab 4 §6.14 |
| TS-ERR-06 | Edit bentrok dua pengguna | Head office | Data depot sama | — | Dua tab simpan | "Orang lain sudah mengubah data ini sejak Anda membukanya…" | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.3 |
| TS-ERR-07 | Layanan sumber gagal sebagian | Head office | Satu layanan dimatikan (lingkungan uji) | — | Buka `/hq` | "Sebagian data gagal dimuat…"; "—" bukan nol | Belum diuji oleh tim dokumentasi | Not Tested | Bab 9 §6.1 |
| TS-ERR-08 | Matriks gagal dimuat tampil bawaan | Admin | Layanan matriks terganggu (simulasi) | — | Buka `/hq/access` | Grid menampilkan nilai bawaan; muat ulang sebelum simpan | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.1 [B] |
| TS-ERR-09 | Sesi kedaluwarsa di tengah formulir | Staf | Sesi habis | — | Kirim formulir | Diminta masuk lagi; data formulir tidak hilang atau hilang (catat) | Belum diuji oleh tim dokumentasi | Not Tested | Bab 1 |
| TS-ERR-10 | Webhook mitra gagal berulang | Admin | Endpoint uji mati | — | Picu peristiwa | Percobaan ulang 1m, 5m, 25m… lalu DEAD | Belum diuji oleh tim dokumentasi | Not Tested | Bab 10 §6.10 |

---

## 4. Bukti uji otomatis yang SUDAH ADA di repo (bukan dijalankan oleh dokumentasi ini)

> **Peringatan.** Seluruh isi bagian ini adalah **klaim dari repo**, dibaca dari berkas sumber dan `.uat/STATE.md`. Tim dokumentasi **tidak menjalankan ulang** satu pun tes ini. Tanggal dan commit hasil yang tercatat **tidak diverifikasi ulang**. Jangan menyalin angka ini sebagai hasil Pass untuk skenario di bagian 3.

### 4.1 Playwright e2e (`apps/web/e2e/*.spec.ts`)

Konfigurasi: `apps/web/playwright.config.ts` (proyek `chromium`, Desktop Chrome saja); perintah `npm run test:e2e` (`apps/web/package.json`); pembantu masuk OTP: `apps/web/e2e/helpers/auth.ts`, `otp.ts`. Pengujian peramban lain tidak ada di CI.

| ID turunan | Skenario menurut judul tes | Berkas | Skenario Bab 15 terkait |
|---|---|---|---|
| E2E-SMOKE-1 | landing page renders | `apps/web/e2e/smoke.spec.ts:8` | — |
| E2E-SMOKE-2 | catalog page loads its shell | `smoke.spec.ts:14` | — |
| E2E-SMOKE-3 | login submits a phone and routes to OTP verify | `smoke.spec.ts:21` | TS-AUTH-05 |
| E2E-AUTH-1 | OTP login establishes an authenticated cookie session | `apps/web/e2e/authed.spec.ts:14` | TS-AUTH-05 |
| E2E-AUTH-2 | a protected page loads over the cookie session | `authed.spec.ts:31` | TS-SEC-01 |
| E2E-AUTH-3 | authenticated customer can add a seeded product to cart | `authed.spec.ts:45` | TS-ORD-01 |
| E2E-CHK-1 | authenticated customer places an order through manual checkout | `apps/web/e2e/checkout.spec.ts:17` | TS-ORD-01 |
| E2E-POS-1 | records a cash sale at the counter and prints a receipt (walk-in) | `apps/web/e2e/walk-in.spec.ts:10` | TS-POS-04 |
| E2E-HR-1 | face check-in captures a frame and posts through the cookie session | `apps/web/e2e/hr-checkin.spec.ts:12` | TS-ATT-03 |
| E2E-HR-2 | a full-size face frame survives the whole ingress path | `hr-checkin.spec.ts:86` | TS-ATT-03 |
| E2E-HR-3 | a punch taken offline is queued on device and flushed on reconnect (melewati sendiri bila uji kehidupan klien menolak bingkai, `:163`) | `hr-checkin.spec.ts:105` | TS-ATT-09 |
| E2E-PERF-1 | `/hq` dalam anggaran 15 permintaan API (diukur pada 12 depot) | `apps/web/e2e/request-budget.spec.ts` (sekitar baris 120–141) | TS-ERR-07 (tidak langsung) |
| E2E-PERF-2 | `/products` dalam anggaran 15 permintaan API | `request-budget.spec.ts` | — |
| Ekspor statis | jalur APK terekspor terselesaikan, tanpa backend | `apps/web/e2e-static/export.spec.ts`, `apps/web/playwright.static.config.ts`; skrip `run-export-tests.mjs customer|ops` | — |

### 4.2 Alur integrasi API (`test/integration/flow.mjs`)

Pengendali: `test/integration/run.mjs`; stub gerbang: `test/integration/gateway-stub.mjs`; perintah `npm run test:integration` (menjalankan `docker-compose.yml` dan `docker-compose.test.yml`).

| ID | Skenario menurut berkas | Berkas | Skenario Bab 15 terkait |
|---|---|---|---|
| INT-1 coreLoop | daftarkan pelanggan → checkout → bayar tunai/konfirmasi → maju sampai Selesai → poin loyalti diberikan lintas layanan | `test/integration/flow.mjs:276-338` | TS-ORD-01, TS-LOY-07 |
| INT-1b stampedEdits | edit produk dengan cap kesegaran masuk ke DB (konkurensi optimistik) | `flow.mjs:997-1041` | TS-ERR-06 |
| INT-2 depotRoutedLoop | checkout diarahkan ke depot yang mencakup, ongkir per depot, stok dicadangkan lalu dikurangi | `flow.mjs:340-410` | TS-ORD-01 |
| INT-3 onlineWebhookLoop | EWALLET lewat gerbang stub → webhook PAID bertanda tangan → pesanan Dikonfirmasi | `flow.mjs:412-483` | TS-PAY-07 |
| INT-4 failurePaths | di bawah minimum, di luar area, stok tidak cukup ditolak 422 | `flow.mjs:485-630` | TS-ORD-02, TS-ORD-03, TS-ORD-07 |
| INT-5 qrisLoop | QRIS tetap PENDING sampai staf konfirmasi, tanpa gerbang | `flow.mjs:713-798` | TS-PAY-01 |
| INT-6 deliveryLeg | check-in shift (geofence) → tugaskan → ambil → mulai → konfirmasi tunai COD → bukti → Selesai → setoran diajukan dan diverifikasi → upah kurir dikredit | `flow.mjs:800-995` | TS-DEL-05, TS-COD-01, TS-COD-03 |

### 4.3 Harness UAT (`.uat/`)

Naskah sumber `UAT_Script_Hydromart_v2.1.xlsx` berada **di luar repo** (439 kasus, 29 modul, ditambah lembar cakupan 199 halaman). Pengendali: `.uat/run.mjs` (hasil ke `results.json`), `.uat/lib.mjs`, `otp-sink.mjs`, `seed-queues.mjs`, `pages.mjs` (smoke 199 halaman — menurut `STATE.md` **belum dikerjakan**), `rebuild.sh`; CI `.github/workflows/uat.yml` (hanya melapor karena lima kasus naskah bertentangan dengan keputusan desain yang disengaja, `STATE.md:51-55`). ID kasus berbentuk `UAT-M<modul>-<nn>`.

**Hasil terakhir yang tercatat di repo** (`.uat/STATE.md:37-40`): **398 Pass / 36 N/A / 5 Blocked dari 439** (garis dasar 2026-07-27: 368/34/37). Pekerjaan terbuka menurut berkas yang sama: smoke 199 halaman dan pengisian workbook (`STATE.md:30-31`). Cacat harness yang sudah diperbaiki: M11-06, M21-03 (`STATE.md:42-47`). **Tanggal dan commit hasil ini tidak diverifikasi ulang oleh dokumentasi ini.**

| Modul | Judul (menurut header berkas) | Berkas | Jumlah kasus (hitungan grep di repo) | Modul Bab 15 terkait |
|---|---|---|---|---|
| M1 | Autentikasi & Sesi | `.uat/m01-auth.mjs` | 26 | AUTH |
| M2–M5 | Profil & Alamat; Katalog; Keranjang & Checkout; Voucher & Promo | `.uat/m02-m05.mjs` (+ `m30-gaps.mjs`) | 9 / 9 / 18 / 18 | ORD, LOY |
| M6–M7 | Pembayaran & Refund; Pengiriman, Kurir & Bukti Terima | `.uat/m06-m07.mjs` | 16 / 25 | PAY, REF, DEL |
| M8–M9 | Depot, Inventori & Pengadaan; Loyalty, Referral & Langganan | `.uat/m08-m09.mjs` | 18 / 13 | OPN, PO, LOY, SUB |
| M10–M12 | HR, Absensi & Payroll; Franchise, HQ & Pelaporan; RBAC, Keamanan & Audit | `.uat/m10-m12.mjs` | 16 / 11 / 13 | HRM, ATT, PRL, FRA, SEC |
| M13–M17 | Non-Fungsional; E2E; Galon & Deposit; Inventori Lanjutan; Kas & Shift | `.uat/m13-m17.mjs` | 8 / 7 / 16 / 14 / 18 | GAL, POS, OPN |
| M18–M21 | Harga Grosir-Override-Reseller; Pembatalan & Langganan; Payout Kurir; Notifikasi | `.uat/m18-m21.mjs` | 17 / 16 / 19 / 13 | PRC, REF, SUB, WDR |
| M22–M25 | Forecast & Rekomendasi; Administrasi Sistem; Payroll Lanjutan; Laporan Lanjutan | `.uat/m22-m25.mjs` | 10 / 21 / 17 / 18 | STF, PRL, RPT |
| M26–M29 | Portal Manajer Mobile; Halaman Publik & Aksesibilitas; Konsistensi Lintas Surface; Zona Waktu & Mata Uang | `.uat/m26-m29.mjs` | 9 / 15 / 16 / 13 | APR, SEC |

Total 439 ID unik. Pemetaan modul Bab 15 pada kolom terakhir bersifat **perkiraan penulis dokumen** dari judul modul, bukan dari membaca isi tiap kasus **[D]**.

### 4.4 Celah bukti otomatis yang tampak dari daftar di atas

Berdasarkan judul tes (bukan hasil menjalankan), area berikut **tidak tampak** punya tes otomatis di daftar yang dibaca. Ini hanya penunjuk prioritas uji manual, dan harus dipastikan ke pemilik tes: pembatalan oleh pelanggan setelah kurir ditugaskan; persetujuan refund Finance dan ambang; rilis payout empat mata; PDP; cuti dua tahap pemisahan tugas; kasbon eskalasi; penugasan lintas depot (fitur mati bawaan); pengujian peramban selain Chromium dan perangkat Android (WebView). PR #664 menambah/menyesuaikan tes unit pada berkas berikut (dibaca dari daftar perubahan git, TIDAK dijalankan): `services/auth-service/test/unit/account.service.spec.ts`, `data-subject.service.spec.ts`, `open-orders-adapter.spec.ts`, `audit.service.spec.ts`; `services/hr-service/test/unit/payroll.service.spec.ts`, `loan-request.service.spec.ts`, `identity.http.adapter.spec.ts`; `services/delivery-service/test/unit/settlement.service.spec.ts`; `services/payout-service/test/payout.service.spec.ts`, `courier-payout.service.spec.ts`; `packages/access/src/capabilities.spec.ts`; `apps/web/test/grantable-roles.test.ts`. Ini memberi sinyal bagi skenario baru (TS-PRL-16..21, TS-COD-11/12, TS-PDP-13..16, TS-STF-23..25, TS-WDR-05, TS-FRA-39, TS-KAS-12..14), tetapi bukan hasil Pass.

---

## 5. Lembar pelaksanaan (diisi penguji)

| Isian | Nilai |
|---|---|
| Tanggal uji | 2026-10-14 (eksekusi parsial; lihat bagian "Eksekusi terstruktur 2026-10-14") |
| Penguji | Agen QA otomatis (Claude Code) atas permintaan tim dokumentasi; bukan pemilik proses |
| Lingkungan dan versi | Stack lokal docker compose (`docker-compose.yml` + `docker-compose.test.yml`), Postgres uji; image auth, hr, delivery, payout, order, payment, depot dibangun ulang dari kode HEAD (setelah PR #664); web `next build` + `next start` :3000; migrasi `20261014120000_payment_refund_requested_by` diterapkan |
| Matriks hak akses saat uji | Bawaan kode (`packages/access/src/index.ts`); tidak ada override runtime |
| Nilai ambang saat uji (T-AMBANG) | Refund HQ Rp100.000 (`/payments/refunds/rules`: 100000; batas pas Rp100.000 diproses langsung); klaim otomatis Rp50.000 (`autoApproveMaxIdr`: 50000); klaim Manajer s.d. Rp500.000; minimum penarikan Rp50.000; selisih setoran perlu catatan bila lebih > Rp5.000; kasbon 1x gaji pokok, kedaluwarsa 3 hari kerja; TTL pembayaran non-tunai 24 jam; token akses 900 detik |
| Jumlah skenario dijalankan / Pass / Fail / Blocked / N/A | 104 dari 406 dijalankan: 102 Pass / 1 Fail / 1 Blocked / 0 N/A; 302 tetap Not Tested |
| Nomor cacat terbuka | G-149 s.d. G-155 (Bab 17 bagian 12.1); Fail: TS-PDP-11 (G-153); Blocked: TS-CLM-01 (G-154) |

**Aturan menutup siklus uji:**
- [ ] Semua skenario berisiko tinggi (REF, COD, FRA-21..33, PRL, STF, PDP, SEC) sudah dijalankan.
- [ ] Setiap Fail punya nomor cacat dan bukti.
- [ ] Setiap Blocked punya alasan dan pemilik tindak lanjut.
- [ ] Setiap perilaku bertanda **[B]** dibandingkan dengan keputusan bisnis (perbaiki kode atau perbarui panduan).
- [ ] Setiap nilai bertanda **[K]** dicatat di T-AMBANG.

## 6. Keterlacakan: alur Bab 11 ke modul uji

| Alur Bab 11 | Modul uji Bab 15 |
|---|---|
| F01 | AUTH, ORD, PAY, DEL, COD |
| F02 | REF |
| F03 | GAL, APR |
| F04 | POS |
| F05 | OPN, APR |
| F06 | PO |
| F07 | INC |
| F08 | SUB |
| F09 | LOY |
| F10 | FRA |
| F11 | PRC |
| F12 | STF |
| F13 | HRM, STF |
| F14 | ATT |
| F15 | LEV |
| F16 | KAS |
| F17 | PRL |
| F18 | ASG |
| F19 | PDP |
| F20 | CLM |
| F21 | WDR |
| F22 | JOB |
| F23 | JOB (TS-JOB-08, TS-JOB-09) |
| Lintas alur | SEC, RPT, ERR |

## 7. Catatan celah dan hal yang perlu dikonfirmasi

| No | Catatan | Tanda |
|---|---|---|
| T1 | Nilai ambang dan pengaturan (refund, auto-pass, radius, SLA, kuota, tarif) harus dibaca dari lingkungan sebelum uji | [K] |
| T2 | Skenario yang bergantung pada simulasi gangguan layanan (TS-COD-10, TS-REF-13, TS-ERR-03, TS-ERR-08) memerlukan cara menyuntik kegagalan di lingkungan uji; belum ada prosedur di repo | [D] |
| T3 | Skenario gerbang pembayaran online (TS-PAY-07) memerlukan penyedia atau stub aktif; status di produksi belum diketahui | [K] |
| T4 | Skenario penugasan lintas depot (ASG) hanya dapat dijalankan bila `DEPOT_ASSIGNMENT_ENABLED` dinyalakan di lingkungan uji | [K] |
| T5 | Akun Finance dan Marketing tidak dibuat oleh seed standar; sediakan sebelum uji | [V] |
| T6 | Hasil perilaku yang diberi tanda [B] (mis. Head office menekan tombol yang ditolak server) sebaiknya dicatat sebagai temuan, bukan sekadar Pass/Fail | [B] |
| T7 | Pengujian peramban dan perangkat selain Chromium desktop belum ada bukti otomatis; Android WebView lama dapat kehilangan tema (rekomendasi uji perangkat nyata) | [D] |
| T8 | Hasil UAT 398/36/5 adalah klaim repo, bukan hasil dokumen ini | [V] |
| T9 | (2026-10-14) Skenario bertanda "sejak PR #664" memerlukan build yang memuat PR #664 (commit 53d6a6c); hasil lama sebelum itu tidak berlaku | [V] |
| T10 | (2026-10-14) TS-PRL-17..21 butuh akun Super admin dan akun HR/Finance terpisah; TS-KAS-14 butuh cara memundurkan tanggal buat pengajuan di lingkungan uji; TS-PDP-16 butuh cara mematikan order-service | [D] |


## Pengamatan lingkungan uji lokal (2026-10-11)

> **Catatan (2026-10-14).** Pengamatan di bawah dibuat SEBELUM PR #664 digabung. Beberapa hasil kini berbeda di kode terbaru: label status pesanan tidak lagi berbahasa Inggris (layar staf, halaman lacak publik, struk memakai Dipesan, Dikonfirmasi, Disiapkan, dst.); tab Pembayaran tidak lagi tampil untuk Kepala depot; checkout menampilkan estimasi "Deposit galon"; halaman payout menampilkan "Riwayat penarikan"; dan kata "Order placed → Confirmed → Preparing" pada baris kedua kini berbunyi Dipesan → Dikonfirmasi → Disiapkan. Isi tabel tidak diubah karena merupakan hasil nyata saat itu; ulangi pengamatan bila perlu.

Bagian ini mencatat apa yang **benar-benar dijalankan** saat mengambil screenshot di stack uji lokal (data sintetis, bukan produksi). Ini **bukan** pengujian terstruktur dan tidak mengubah status skenario di atas menjadi Pass. Tujuannya hanya membedakan hal yang sempat diamati dari hal yang murni dibaca dari kode.

| Yang dijalankan | Hasil yang teramati | Skenario terkait | Status |
|---|---|---|---|
| Pelanggan mendaftar, menambah alamat (geolokasi browser), mengisi keranjang, checkout COD | Pesanan terbuat dan tampil di daftar pesanan. Nama yang diisi saat mendaftar tidak tampil di Akun ("—") [B] | TS-AUTH, TS-ORD | Observed, bukan Pass |
| Kepala depot memajukan status Order placed → Confirmed → Preparing lewat detail pesanan | Berhasil satu langkah per pembukaan detail; tombol "Proses" hanya memilih pesanan [B] | TS-ORD, TS-STF | Observed, bukan Pass |
| Kepala depot menugaskan kurir | Kurir yang belum check-in ditolak dengan pesan berbahasa Inggris "This courier is not checked in and available." [B] | TS-DEL | Observed, bukan Pass |
| Kurir check-in, ambil barang, mulai antar, terima COD, isi bukti antar (foto sintetis), selesai | Pengantaran selesai dan halaman sukses tampil; teks retensi bukti kacau [B] | TS-DEL, TS-COD | Observed, bukan Pass |
| Pelanggan membuka detail pesanan dan halaman lacak publik | Detail pesanan berbahasa Indonesia; halaman lacak memakai label status Inggris [B] | TS-ORD | Observed, bukan Pass |
| Kepala depot membuka shift kasir dengan kolom modal awal kosong | Shift terbuka dengan "Modal awal Rp 0" (tidak ada validasi wajib isi) [B] | TS-KAS, TS-POS | Observed, bukan Pass |
| Login OTP per peran (pelanggan, kurir, kepala depot, SPV, Asisten SPV, waralaba, HR, Kantor pusat, Admin; plus Finance, Marketing, Manajer, Direktur untuk sesi) | Semua sesi berhasil dibuat; layar tiap peran terbuka | TS-AUTH | Observed, bukan Pass |

Tidak dijalankan: pembatalan dan refund, setoran COD, opname dan antrean approval, pengadaan, langganan, voucher dan poin, payout waralaba, payroll, cuti, kasbon, absensi (hanya halaman dibuka), PDP, impor CSV, ekspor, kegagalan layanan, kedaluwarsa sesi, dan penonaktifan pengguna. Dua bug lingkungan uji yang ditemukan agen (`seed-hierarchy.mjs` gagal 400 pada stack baru; Dockerfile bergantung pada `apk add openssl` yang diblokir proxy) adalah masalah penyiapan, bukan masalah pengguna, dan dicatat di berkas temuan J.

---

## Eksekusi terstruktur 2026-10-14

Bagian ini mencatat eksekusi nyata skenario alur uang Bab 15 di stack uji lokal pada kode setelah PR #664 (data sintetis; nomor telepon, token, dan rahasia tidak ditulis). Hasil per skenario ada di kolom "Hasil aktual" dan "Status" tiap barisnya, dengan cap "2026-10-14, uji lokal, kode setelah PR #664". Bagian "Pengamatan lingkungan uji lokal (2026-10-11)" di atas dibiarkan apa adanya.

**Cara menjalankan.** Lapisan API lewat gateway (:8080) dengan login OTP nyata per peran (Kepala depot, Staf depot/kurir, Manajer, Finance, Head office, Direktur, HR, Super admin, Pemilik waralaba, Asisten SPV, pelanggan baru); lapisan UI dengan Playwright (Chromium) untuk teks refund pelanggan, Syarat dan Ketentuan, layar Verifikasi setoran COD (Kepala depot dan Manajer), detail slip payroll, dan antrean PDP. Skenario yang tidak ditandai "UI" di kolom hasil hanya diperiksa lewat API; tampilan tombol dan toast tidak dinilai.

**Penyimpangan dari kondisi nyata yang dipakai agar skenario bisa dijalankan** (dicatat jujur, bukan bagian perilaku produk):
- Waktu disimulasikan dengan mengubah `createdAt` di database uji (TS-PAY-06: pembayaran dimundurkan 30 jam; TS-KAS-14: pengajuan dimundurkan 6 hari). Sapuan terjadwal tidak ditunggu.
- Gangguan layanan disimulasikan dengan `docker stop` sementara: payment-service (TS-REF-13), payout-service (TS-COD-10), order-service (TS-PDP-16); semua dihidupkan lagi.
- Layanan `auth` ditambah lima variabel alamat layanan lewat berkas override di luar repo (lihat G-149); tanpa itu seluruh persetujuan hapus akun menjawab 503. TS-PDP-06, 13, 14, 15 dijalankan setelah penambahan itu.
- Saldo kurir pada TS-WDR didanai lewat klaim pengeluaran yang disetujui (jalur nyata); saldo pemilik waralaba didanai lewat endpoint internal pencatatan pendapatan (jalur layanan-ke-layanan, nilai sintetis).
- Tarif gaji satu karyawan uji dikosongkan lalu dipulihkan (TS-KAS-13); status karyawan uji diubah lalu dipulihkan (Aktif).

**Ringkasan per modul**

| Modul | Dijalankan | Pass | Fail | Blocked | Not Tested (modul) |
|---|---|---|---|---|---|
| REF (batal dan refund) | 13 | 13 | 0 | 0 | 3 (REF-03, 12, 14) |
| COD (setoran) | 11 | 11 | 0 | 0 | 1 (COD-01) |
| WDR (tarik saldo kurir) | 5 | 5 | 0 | 0 | 0 |
| PAY (status pembayaran) | 4 | 4 | 0 | 0 | 3 (PAY-03, 04, 07) |
| POS (kasir, tutup buku) | 9 | 9 | 0 | 0 | 11 |
| PRL (payroll) | 15 | 15 | 0 | 0 | 6 |
| CLM (klaim kurir) | 8 | 7 | 0 | 1 | 0 |
| PDP (UU PDP) | 10 | 9 | 1 | 0 | 6 |
| STF (staf dan akses) | 3 | 3 | 0 | 0 | 25 |
| SEC (keamanan) | 7 | 7 | 0 | 0 | 3 |
| KAS (kasbon) | 13 | 13 | 0 | 0 | 1 (KAS-09) |
| FRA (rilis payout waralaba, FRA-25 s.d. 30) | 6 | 6 | 0 | 0 | 35 |
| **Jumlah** | **104** | **102** | **1** | **1** | **302 (seluruh matriks)** |

**Temuan terpenting**
1. **Hapus akun tidak bisa jalan dengan konfigurasi compose di repo** (G-149): `auth` tidak diberi alamat order-service dan layanan lain, sehingga setiap persetujuan hapus akun ditolak 503 fail-closed. Setelah konfigurasi dilengkapi, aturan PR #664 (PDP_OPEN_ORDERS, paksa hanya Super admin, gagal-tertutup saat order-service mati) terbukti berjalan.
2. **Eksekutor penghapusan PDP salah alamat** (G-150): tiga dari enam (pengantaran, tiket bantuan, poin) gagal 404/400, tetapi permintaan tetap COMPLETED dan akun DELETED.
3. **Login nomor akun terhapus** (TS-PDP-11, G-153, satu-satunya Fail): dijawab sebagai nomor belum terdaftar (OTP pendaftaran), bukan "Akun ini tidak aktif".
4. **Pemisahan tugas refund** (G-128 dikonfirmasi): Finance mengajukan lalu menyetujui refund Rp150.000 sendiri; `refundRequestedBy` tetap NULL. Sebaliknya payroll (pembuat tidak boleh menyetujui; hanya Super admin boleh membatalkan persetujuan), beban selisih COD (hanya Manajer/Super admin), dan rilis payout (pengaju tidak boleh menyetujui sendiri) ditegakkan server seperti panduan.
5. **Perilaku PR #664 terbukti**: ambang refund (Rp100.000 pas diproses langsung, Rp150.000 antre), status refund di detail pesanan, minimum penarikan Rp50.000, batas kasbon 1x gaji pokok dan kedaluwarsa 3 hari kerja, penonaktifan diri sendiri dan Super admin terakhir ditolak, Head office tidak bisa membuat Head office, refresh token langsung dicabut sementara token akses lama hidup sampai habis.
6. **Perbedaan kecil**: API setoran menerima sengketa dengan catatan berisi spasi dan menimpa catatan sengketa lama (G-152); rel HR menampilkan kunci terjemahan mentah `hrFix.nav.hqConsole` (G-151); klaim kurir tidak bisa otomatis di stack uji karena penyimpanan struk tidak dikonfigurasi (TS-CLM-01 Blocked, G-154); banyak kalimat panduan adalah teks UI sedangkan API menjawab kalimat lain (G-155).

**Tidak dijalankan (tetap Not Tested):** semua baris tanpa cap di atas, antara lain REF-03/12/14, COD-01, POS-03 s.d. 10/12/19/20, PRL-04/05/12 s.d. 15, PDP-01/03/04/05/09/12, STF-01 s.d. 22 dan 26 s.d. 28, SEC-05/07/08, KAS-09, serta seluruh modul di luar daftar prioritas. Pengujian peramban selain Chromium dan perangkat nyata tidak dilakukan.
