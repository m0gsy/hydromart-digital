# Bab 5 — Panduan Supervisor (SPV)

| | |
|---|---|
| Versi | 0.1 draf |
| Tanggal | 2026-10-10 |
| Klasifikasi | Internal — Terbatas |
| Peran | Supervisor ("SPV", kode sistem `SUPERVISOR`) |
| Lampiran | Peran Manajer ("MANAGER") |

> **Catatan hak akses (baca dahulu).** Hak akses di bab ini adalah nilai BAWAAN dari `packages/access/src/index.ts`. SUPER_ADMIN dapat mengubahnya saat sistem berjalan, dan perubahan berlaku dalam kira-kira 30 detik. Bila layar Anda berbeda dari bab ini, tanyakan ke Admin. Bab ini belum diuji langsung di aplikasi oleh penulisnya; semua isi berasal dari pembacaan kode dan temuan tim.

> **Arti tag bukti.** **[V]** terverifikasi di kode · **[D]** disimpulkan, perlu konfirmasi · **[K]** perlu konfirmasi bisnis · **[B]** diketahui bermasalah atau tidak konsisten.

---

## 1. Gambaran peran

SPV adalah pengawas beberapa depot sekaligus. SPV berada di tengah rantai pembinaan:

`Staff Depot → Kepala Depot → Asisten SPV → SPV → Manajer → Direktur` **[V]** (komentar `index.ts` baris 15-16)

Ciri utama SPV:

- Melihat banyak depot, bukan satu. Daftar depot SPV ditentukan oleh peta hierarki yang diatur Admin.
- Banyak layar bersifat baca saja (memantau). Namun beberapa layar membolehkan SPV mengubah data. Lihat bagian 5 dan bagian 9.
- Tidak memegang keputusan kasbon dan tidak memegang antrean approval. Dua hal itu tidak termasuk hak SPV **[V]**.
- Mendarat di halaman "Operasi" bertipe eksekutif (ringkasan 30 hari terakhir).

> **[B] Kontradiksi dengan komentar kode.** Komentar di `packages/access/src/index.ts` (baris 35-40) menyebut SPV dan Asisten SPV hanya "oversight reads, no writes, no money, no approvals". Kenyataannya, daftar kemampuan SPV mencakup menulis di insiden, sengketa order, target depot, dan buku kas, serta aksi pengiriman. Panduan ini mengikuti **daftar kemampuan di kode**, bukan komentarnya. Pemilik produk perlu memastikan apakah ini memang disengaja.

## 2. Tujuan dan tanggung jawab

| Tanggung jawab | Penjelasan singkat | Bukti |
|---|---|---|
| Memantau kinerja depot binaan | Membaca ringkasan penjualan, ketepatan antar (SLA), tren, depot dan pelanggan teratas | [V] |
| Mengawasi antrean pesanan dan pengiriman | Melihat antrean, melacak kurir, menarik atau membatalkan pengiriman bila perlu | [V] |
| Menangani insiden operasional | Mencatat dan menyelesaikan insiden depot | [V] |
| Menangani sengketa order | Menyelesaikan sengketa dari pelanggan | [V] |
| Menetapkan target depot | Mengatur target bulanan | [V] |
| Mengawasi buku kas | Melihat kas masuk/keluar, mencatat, dan mengoreksi entri | [V] |
| Meminta peminjaman karyawan | Mengajukan permintaan ke HR agar karyawan depot lain dipinjamkan | [V] |
| Mengelola kehadiran dan data diri | Absen wajah, cuti, slip gaji, kasbon sendiri lewat "Absen saya" | [V] |

SPV melapor ke Manajer. Asisten SPV melapor ke SPV. Lihat Bab 6 dan Lampiran A.

## 3. Prasyarat akses

| Syarat | Keterangan |
|---|---|
| Akun staf aktif | Dibuat oleh HR dan Admin. SPV tidak dapat membuat akunnya sendiri. |
| Peran "SPV" | Label peran di bagian bawah menu: "Peran: SPV" **[V]** |
| Hierarki terisi | Admin harus menempatkan SPV di peta hierarki (menu `/hq/hierarchy`, "Hierarki pembinaan"). Tanpa itu daftar depot kosong. **[V]** |
| Perangkat | Peramban web (desktop atau ponsel). Aplikasi Ops di ponsel memuat `/dashboard/*`. **[V]** |
| Nomor HP terdaftar | Masuk memakai kode OTP ke nomor yang terdaftar. **[D]** |

### 3.1 Cakupan multi-depot

Cakupan SPV dihitung dari tiga sumber, lalu digabung **[V]**:

1. Depot asal di akun (bila ada).
2. Hierarki: depot milik semua Asisten SPV yang menjadi bawahan SPV.
3. Hak langsung: depot tambahan yang diberikan Admin secara khusus ("Depot titipan langsung"). Dipakai untuk depot yang belum punya Asisten SPV atau untuk serah terima sementara.

Aturan penting:

- Depot hanya "menggantung" pada Asisten SPV. **Depot yang belum punya Asisten SPV tidak masuk cakupan siapa pun** kecuali diberi hak langsung atau dilihat Kantor pusat **[V]**.
- Perubahan hierarki atau hak langsung baru terlihat sekitar **±60 detik** kemudian (pesan Admin: "Tersimpan. Berlaku di seluruh service dalam 60 detik.") **[V]**.
- Bila layanan hierarki sedang tidak dapat dihubungi, sistem tetap memakai depot asal akun saja untuk sementara. Bila akun tidak punya depot asal, muncul kesalahan 503 "Depot scope lookup failed." (arti: pencarian cakupan depot gagal) **[V]**.
- SPV tidak dapat mengubah cakupannya sendiri. Hanya SUPER_ADMIN **[V]**.
- Setiap daftar di sistem otomatis dipersempit ke depot dalam cakupan. Tidak ada daftar "seluruh jaringan" untuk SPV **[V]**.

| Pesan sistem | Arti | Solusi |
|---|---|---|
| Akun ini belum diberi tanggung jawab depot manapun. | Cakupan SPV kosong | Minta Admin mengisi hierarki atau hak langsung |
| Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya. | Anda membuka depot di luar cakupan | Pilih depot lain dari pemilih depot, atau minta Admin menambah cakupan |
| Gagal memuat daftar depot. | Pemilih depot tidak dapat memuat | Muat ulang halaman; bila berulang, hubungi Admin |
| Depot scope lookup failed. | Pencarian cakupan gagal (503) | Tunggu beberapa menit, coba lagi, lalu lapor ke Admin |

## 4. Masuk dan pengaturan awal

### Prosedur: Masuk dan memilih konteks depot

**Tujuan:** Masuk ke konsol operasi dan memilih depot yang ingin dilihat.
**Peran:** SPV.
**Prasyarat:** Akun staf aktif dengan cakupan depot terisi.
**Titik awal:** Halaman masuk staf (alamat dari HR/Admin), lalu halaman "Operasi" (`/dashboard`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka halaman masuk staf dan isi nomor HP terdaftar | Sistem mengirim kode OTP **[D]** |
| 2 | Masukkan kode OTP | Anda masuk ke halaman "Operasi" bertipe eksekutif |
| 3 | Lihat bagian bawah menu kiri | Tertulis "Peran: SPV" |
| 4 | Klik pemilih depot di menu kiri | Daftar depot dalam cakupan Anda; baris menampilkan nama depot dan `{kode} · {kota}` |
| 5 | Pilih satu depot, atau pilih "Semua depot" | Pemilih menampilkan `{kode} · konteks aktif`, atau "{n} lokasi · gabungan" |
| 6 | Di ponsel, ketuk "Lainnya" untuk membuka "Menu lainnya" | Seluruh menu dan pemilih depot tampil |

**Hasil akhir:** Anda berada di konsol dengan konteks depot terpilih.
**Masalah umum:** lihat bagian 3.1 dan bagian 8.
**Izin & batasan:** Pilihan depot disimpan di peramban Anda. Pilihan yang sudah tidak ada dalam cakupan diabaikan dan daftar dimuat ulang **[V]**.
**Daftar periksa:**
- [ ] Peran di bawah menu tertulis "SPV"
- [ ] Daftar depot di pemilih sesuai wilayah binaan
- [ ] Layar "Operasi" menampilkan angka, bukan pesan "Khusus staf"

> **[SCREENSHOT REQUIRED: SS-supervisor-01 — Halaman "Operasi" SPV dengan menu kiri terbuka, pemilih depot terbuka menampilkan beberapa depot, dan teks "Peran: SPV" di bagian bawah menu]**
> *Gambar 5.1 — Menu kiri dan pemilih depot SPV.*

### 4.1 Arti "Semua depot" (penting)

| Layar | Perilaku saat "Semua depot" dipilih |
|---|---|
| "Operasi" (landing) | Angka KPI adalah **jumlah seluruh depot dalam cakupan**. Pemilih depot tidak mengubah angka landing **[V]** |
| Halaman yang butuh satu depot (Inventori, Perkiraan, rekonsiliasi bayar, Rating, dan sejenisnya) | Memakai **depot pertama dalam daftar** secara diam-diam **[V]** |
| Layar tertentu menampilkan "Menampilkan depot pertama — pilih depot di switcher untuk mengubah." | Peringatan bahwa hanya satu depot yang dibaca |

Anjuran: untuk memeriksa satu depot, selalu pilih depot itu secara eksplisit.

## 5. Menu dan modul tersedia

Menu kiri dikelompokkan. Tabel berikut hanya memuat yang **terlihat** oleh SPV. Kolom "Jenis" menunjukkan apakah SPV hanya membaca (R) atau dapat mengubah data (W). "X" berarti menu tampil tetapi server menolak data **[B]**.

### 5.1 Menu yang terlihat

| Kelompok | Label menu | Rute | Jenis untuk SPV | Bukti |
|---|---|---|---|---|
| Ringkasan | Operasi | `/dashboard` | R | [V] |
| Operasi harian | Antrean pesanan | `/dashboard/orders` | R + aksi status/kurir (W) | [V] |
| Operasi harian | Live tracking | `/dashboard/tracking` | W (tarik/batalkan pengiriman) | [V] |
| Operasi harian | Inventori | `/dashboard/inventory` | R ("Hanya lihat") | [V] |
| Operasi harian | Retur galon | `/dashboard/returns` | R | [V] |
| Operasi harian | Meteran air | `/dashboard/meter` | R | [V] |
| Operasi harian | Notifikasi ops | `/dashboard/notifications` | R | [V] |
| Operasi harian | Perkiraan | `/dashboard/forecast` | R | [V] |
| Pemasaran | Reseller / Agen | `/resellers` | R | [V] |
| Approval & supervisi | Insiden | `/dashboard/incidents` | W | [V] |
| Approval & supervisi | Sengketa order | `/dashboard/disputes` | W | [V] |
| Tim & jadwal | Absen saya | `/hr/me` | W (data diri sendiri) | [V] |
| Tim & jadwal | Jadwal shift | `/dashboard/shift` | R | [V] |
| Tim & jadwal | Target & goals | `/dashboard/targets` | W | [V] |
| Pelanggan & pertumbuhan | Pelanggan | `/dashboard/customers` | R | [V] |
| Pelanggan & pertumbuhan | CRM & follow-up | `/dashboard/crm` | R | [V] |
| Keuangan · usulan | Buku kas | `/dashboard/cashbook` | W (catat dan koreksi) | [V] |
| Keuangan · usulan | Rekonsiliasi bayar | `/dashboard/payment-recon` | R | [V] |
| Keuangan · usulan | Komisi kurir | `/dashboard/commission` | X (server menolak) | [B] |
| Keuangan · usulan | Tinjauan bulanan | `/dashboard/monthly-review` | X (server menolak) | [B] |
| Keuangan · usulan | Laporan L/R | `/dashboard/monthly-pnl` | R | [V] |
| Keuangan · usulan | Performa tim | `/dashboard/team-performance` | X (server menolak) | [B] |
| Referensi | Peran & akses | `/dashboard/roles` | R | [V] |
| Referensi | Audit log | `/dashboard/audit` | R | [V] |
| Referensi | Akun saya | `/dashboard/account` | W (akun sendiri) | [V] |

Di ponsel, bilah bawah menampilkan empat tab pertama dari: Ringkasan, Antrean, Inventori, Perkiraan; sisanya lewat "Lainnya" **[V]**.

### 5.2 Menu yang TIDAK terlihat oleh SPV

Pencarian, Penjualan depot, Susut & kerusakan, Setoran COD, Depot, Harga dinamis, Pengaturan, Staf & peran, Aturan promo, Voucher, Risiko churn, Antrean approval, Pesanan pembelian, Pemasok, Huddle mingguan, Serah terima shift, Perawatan alat, Panduan manajer, Broadcast, Loyalty & poin, Penukaran hadiah, Referral, Rekomendasi, Rating & ulasan, Langganan, Kelola produk, Harga borongan, Pembayaran & QRIS, Klaim pengeluaran, Laporan, Banding depot, Profil, Pengaturan depot **[V]**. Semuanya milik MANAGER ke atas. Lihat Lampiran A.

### 5.3 Menu yang tampil tetapi ditolak server [B]

Tiga menu masuk ke daftar SPV karena gerbang menunya longgar, sementara data di baliknya meminta kemampuan yang tidak dimiliki SPV:

| Menu | Penyebab | Yang Anda lihat |
|---|---|---|
| Komisi kurir | Data meminta kemampuan `courierSettle` (Kepala depot, Manajer, Finance, Admin) | Layar galat/kosong **[D]** wording belum diverifikasi |
| Tinjauan bulanan | Data meminta `dailyClose` dan `orderReports` | Layar galat/kosong **[D]** |
| Performa tim | Data meminta `deliveryReports` dan `staffDirectory` | Layar galat/kosong **[D]**; teks "Performa tim hanya untuk Manajer depot." hanya muncul bila kemampuan `dashboard` hilang |

Jangan menganggap ini kerusakan akun Anda. Untuk kebutuhan ini minta Manajer atau Kantor pusat.

### 5.4 Pintu masuk ke konsol HR

Tidak ada menu di rel SPV yang mengarah ke `/hr`, kecuali "Absen saya" (`/hr/me`). Halaman HR lain (misalnya `/hr/depot-requests`) dibuka dengan mengetik alamatnya di desktop, atau lewat tautan notifikasi **[D]**. Di aplikasi ponsel Ops, halaman `/hr/depot-requests` dan `/hr/leave` tidak tersedia; hanya `/hr/me/*` dan `/hr/loans/*` **[D]**.

### 5.5 Landing eksekutif

Setelah masuk, SPV mendarat di "Operasi" (`/dashboard`) dengan tampilan eksekutif, sama seperti Kantor pusat **[V]**. Subjudul: "30 hari terakhir untuk penjualan dan pengiriman."

| Bagian | Isi | Catatan |
|---|---|---|
| Pendapatan | Nilai, petunjuk "{n} pesanan" | 30 hari terakhir, jumlah semua depot dalam cakupan |
| SLA tepat waktu | Persen, petunjuk "{onTime}/{total} terkirim" | Ketepatan antar |
| Rata-rata antar | "{n} mnt", petunjuk "ambang {n} mnt" | Waktu antar rata-rata |
| Terlewat / gagal | Jumlah pesanan terlewat atau gagal | |
| Tren penjualan | Grafik; kosong: "Tidak ada penjualan pada periode ini." | |
| Pelanggan teratas | Daftar; kosong: "Belum ada pesanan pada periode ini." | |
| Depot teratas | Daftar; kosong sama seperti di atas | |

Bila sebagian data gagal dimuat, muncul "Sebagian data gagal dimuat{which}. Menampilkan yang tersedia." Layar masih bisa dipakai dengan data yang ada.

SPV **tidak** mendapat widget aksi khas Manajer ("Antrean approval", "Stok kritis", "Kurir aktif") **[V]**.

> **[SCREENSHOT REQUIRED: SS-supervisor-02 — Halaman "Operasi" tampilan eksekutif SPV: kartu Pendapatan, SLA tepat waktu, Rata-rata antar, Terlewat / gagal, grafik Tren penjualan, daftar Pelanggan teratas dan Depot teratas]**
> *Gambar 5.2 — Landing eksekutif SPV.*

## 6. Prosedur langkah demi langkah

### Prosedur: Memantau kinerja dari landing "Operasi"

**Tujuan:** Menilai kesehatan penjualan dan pengiriman depot binaan dalam 30 hari terakhir.
**Peran:** SPV.
**Prasyarat:** Cakupan depot terisi (bagian 3.1).
**Titik awal:** Menu "Ringkasan" > "Operasi" (`/dashboard`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka "Operasi" | Kartu Pendapatan, SLA tepat waktu, Rata-rata antar, Terlewat / gagal tampil |
| 2 | Baca "SLA tepat waktu" dan petunjuk "{onTime}/{total} terkirim" | Anda tahu berapa pesanan tiba tepat waktu |
| 3 | Bandingkan "Rata-rata antar" dengan "ambang {n} mnt" | Rata-rata di atas ambang berarti pengiriman lambat |
| 4 | Lihat "Terlewat / gagal" | Jumlah pesanan bermasalah; telusuri di "Antrean pesanan" |
| 5 | Baca "Tren penjualan", "Pelanggan teratas", "Depot teratas" | Gambaran pola penjualan dan depot yang menonjol |
| 6 | Untuk satu depot, buka "Laporan L/R" (`/dashboard/monthly-pnl`) | Laporan laba rugi operasional satu depot per bulan |

**Hasil akhir:** Anda punya daftar depot atau pesanan yang perlu ditindaklanjuti.
**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| Sebagian data gagal dimuat{which}. Menampilkan yang tersedia. | Satu sumber data gagal | Muat ulang; bila berulang, lapor ke Admin |
| Khusus staf / Dashboard operasi tersedia untuk manajer depot dan staf kantor pusat. | Akun tidak punya kemampuan `dashboard` | Hubungi Admin; hak akses akun Anda mungkin diubah |

**Izin & batasan:** Baca saja. Angka landing adalah jumlah semua depot dalam cakupan dan **tidak** mengikuti pemilih depot **[V]**. "Laporan L/R" membaca satu depot terpilih per bulan dan memuat peringatan "Laporan manajemen operasional, bukan laporan akuntansi statutori atau dokumen pajak." **[V]**.
**Daftar periksa:**
- [ ] Saya membaca KPI landing sebagai jumlah semua depot, bukan satu depot
- [ ] Untuk satu depot saya pilih depot itu dulu lalu membuka "Laporan L/R"

> **[B] Perhatian pada ringkasan Manajer.** Pada tampilan Manajer, kartu berlabel "Order hari ini" sebenarnya berisi total 30 hari (petunjuknya berbunyi "{n} order · 30 hari"), dan petunjuk "target 96%" tertanam tetap di kode. SPV tidak melihat kartu itu, tetapi jangan membandingkannya dengan angka SPV tanpa memeriksa periodenya.

> **[SCREENSHOT REQUIRED: SS-supervisor-03 — Halaman "Laporan L/R" satu depot: pemilih "Bulan laporan", kartu Laba operasional bersih, Margin operasional, dan status "Sumber data"]**
> *Gambar 5.3 — Laporan L/R satu depot.*

---

### Prosedur: Memantau dan menangani antrean pesanan

**Tujuan:** Memastikan pesanan bergerak dan mengambil tindakan atas pesanan macet.
**Peran:** SPV.
**Prasyarat:** Depot terpilih di pemilih depot.
**Titik awal:** "Operasi harian" > "Antrean pesanan" (`/dashboard/orders`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka "Antrean pesanan" | Daftar pesanan lintas pelanggan pada depot dalam cakupan |
| 2 | Buka satu pesanan untuk melihat rincian | Panel rincian, termasuk panel pembayaran |
| 3 | Bila perlu, ubah status pesanan | Status maju; aksi ini memakai kemampuan `orderFulfilment` **[V]** |
| 4 | Untuk pesanan berstatus menyiapkan (PREPARING), tugaskan kurir | Pengiriman dibuat (kemampuan `tracking`) **[V]** |
| 5 | Periksa panel pembayaran | Status pembayaran tampil (baca saja) |

**Hasil akhir:** Pesanan bergerak sesuai alur atau masalahnya tercatat.
**Masalah umum:** Pesan galat mengikuti server; bila tertulis dalam bahasa Inggris, salin apa adanya ke tiket dukungan.
**Izin & batasan (SPV):**

| Aksi | Boleh? | Bukti |
|---|---|---|
| Melihat antrean dan rincian pesanan | Ya | [V] |
| Memajukan status pesanan | Ya | [V] |
| Menugaskan kurir | Ya | [V] |
| "Konfirmasi lunas" / "Tandai gagal" pembayaran | **Tidak** (butuh `paymentSettle`) | [V] |
| "Ajukan refund" | **Tidak** (butuh `refundIssue`) | [V] |
| "Penjualan depot" (kasir) | **Tidak** (tidak ada menu) | [V] |

**Daftar periksa:**
- [ ] Pesanan macet sudah ditelusuri sampai ke kurir atau depot
- [ ] Saya tidak mencoba mengonfirmasi pembayaran; itu tugas Kepala depot, Staff depot, Manajer, atau Finance

> **[SCREENSHOT REQUIRED: SS-supervisor-04 — "Antrean pesanan" dengan satu pesanan terbuka, panel pembayaran tampil tanpa tombol "Konfirmasi lunas" dan tanpa "Ajukan refund"]**
> *Gambar 5.4 — Rincian pesanan sudut pandang SPV.*

---

### Prosedur: Memantau pengiriman dengan Live tracking

**Tujuan:** Melihat posisi pengiriman dan menarik atau membatalkan pengiriman bermasalah.
**Peran:** SPV.
**Prasyarat:** Ada pengiriman aktif di depot terpilih.
**Titik awal:** "Operasi harian" > "Live tracking" (`/dashboard/tracking`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka "Live tracking" | Daftar pengiriman dan posisi kurir |
| 2 | Pilih pengiriman yang bermasalah | Rincian pengiriman |
| 3 | Untuk mengembalikan pesanan ke antrean, tekan "Tarik ke antrean" | Kotak alasan: "Alasan menarik pengiriman ini dari kurir?" |
| 4 | Atau untuk membatalkan, tekan "Batalkan pengiriman" | Kotak alasan: "Alasan membatalkan pengiriman ini?" |
| 5 | Tulis alasan dan konfirmasi | Pengiriman ditarik atau dibatalkan |

**Hasil akhir:** Pengiriman kembali ke antrean atau dibatalkan, dengan alasan tercatat.
**Masalah umum:** Bila aksi gagal, baca pesan merah di layar dan ulangi; bila tetap gagal, hubungi Kepala depot atau Manajer depot itu.
**Izin & batasan:** Aksi ini mengubah data nyata dan tidak dapat dianggap "hanya melihat". Selalu tulis alasan jelas **[V]**.
**Daftar periksa:**
- [ ] Saya sudah menghubungi kurir atau Kepala depot sebelum menarik pengiriman
- [ ] Alasan yang saya tulis dapat dipahami orang lain

---

### Prosedur: Mencatat dan menyelesaikan insiden

**Tujuan:** Mencatat kejadian operasional dan menutupnya dengan catatan penyelesaian.
**Peran:** SPV (juga Kepala depot dan Manajer).
**Prasyarat:** Depot terpilih.
**Titik awal:** "Approval & supervisi" > "Insiden" (`/dashboard/incidents`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka "Insiden" | Judul "Insiden" dan penghitung "{n} terbuka"; filter "Semua", "Baru", "Ditangani", "Selesai" |
| 2 | Untuk kejadian baru, isi "Laporkan insiden": **Judul** (wajib, ringkas satu kalimat), **Jenis**, **Tingkat**, "Kurir (opsional)", "Nomor pesanan (opsional)", **Keterangan** | Bila judul terlalu pendek: "Judul terlalu pendek — tulis apa yang terjadi." |
| 3 | Tekan "Kirim laporan" | Insiden masuk daftar; gagal: "Laporan gagal dikirim." |
| 4 | Untuk menutup insiden, buka "Rincian" > isi "Catatan penyelesaian" (minimal 3 karakter) | Bila kurang: "Tulis catatan penyelesaian minimal 3 karakter." |
| 5 | Tekan "Tandai selesai" | Status menjadi "SELESAI"; gagal: "Gagal menyelesaikan insiden." |

Pilihan **Jenis**: Kurir terjatuh, Kendaraan mogok, Konflik pelanggan, Listrik padam, Galon bocor / rusak, Lainnya. Pilihan **Tingkat**: BERAT, SEDANG, RINGAN **[V]**.

Layar yang sama menampilkan "Laporan insiden kurir" (laporan dari kurir di jalan, termasuk kategori Kecelakaan, Kendaraan mogok, Pencurian / ancaman, Selisih dengan pelanggan, Barang rusak, Lainnya, dan tanda "Diteruskan ke pusat" atau "Tidak diteruskan") **[V]**.

**Hasil akhir:** Insiden tercatat dan, bila selesai, tertutup dengan catatan.
**Izin & batasan:** SPV dapat mencatat dan menyelesaikan insiden karena server memakai satu kemampuan `incidents` untuk mencatat, membaca, dan menutup **[V]**. Asisten SPV tidak punya kemampuan ini.

> **[B]** Teks pembatas layar berbunyi "Insiden hanya tersedia untuk operator dan manajer depot." dan komentar RBAC menyebut SPV tanpa tulis; padahal SPV dapat menulis. Pakai perilaku yang tertera di sini.

**Daftar periksa:**
- [ ] Judul menjelaskan apa yang terjadi
- [ ] Tingkat (BERAT/SEDANG/RINGAN) sesuai dampak
- [ ] Catatan penyelesaian menyebut siapa menangani apa

> **[SCREENSHOT REQUIRED: SS-supervisor-05 — Halaman "Insiden" dengan formulir "Laporkan insiden" terisi dan daftar insiden ber-filter "Baru"]**
> *Gambar 5.5 — Mencatat insiden.*

---

### Prosedur: Menyelesaikan sengketa order

**Tujuan:** Menutup klaim pelanggan (salah item, tidak diterima, dan sejenisnya) dengan keputusan jelas.
**Peran:** SPV (juga Kepala depot, Manajer).
**Prasyarat:** Ada sengketa berstatus "Terbuka", atau Anda ingin mencatat sengketa baru.
**Titik awal:** "Approval & supervisi" > "Sengketa order" (`/dashboard/disputes`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka "Sengketa order" | Judul "Sengketa order", "{n} terbuka · klaim pelanggan"; filter "Semua", "Terbuka", "Selesai", "Ditolak" |
| 2 | Untuk sengketa baru, buka "Catat sengketa" dan isi **Nomor order**, **Nama pelanggan**, **Kategori**, **Keterangan** (wajib); "Nilai (Rp, opsional)", "Kurir (opsional)" | Bila ada yang kosong: "Nomor order, nama pelanggan, dan keterangan wajib diisi." |
| 3 | Tekan "Simpan sengketa" | Sengketa tercatat; gagal: "Gagal mencatat sengketa." |
| 4 | Buka sengketa "Terbuka", isi "Catatan (opsional)" (wajib bila menolak: placeholder "Wajib kalau menolak") | |
| 5 | Pilih salah satu: "Refund ({amount})", "Kirim ulang", atau "Tolak" | Status menjadi "Selesai" atau "Ditolak"; gagal: "Gagal menyelesaikan sengketa." |

Kategori: Salah item, Tidak diterima, Lebih bayar, Kualitas, Lainnya **[V]**.

**Hasil akhir:** Sengketa berstatus "Selesai" (refund atau kirim ulang) atau "Ditolak".
**Izin & batasan:**
- Hanya sengketa berstatus "Terbuka" yang dapat diselesaikan **[V]**.
- Memilih "Refund" meminta refund lewat jalur pembayaran. Refund di atas ambang (bawaan Rp100.000) menunggu persetujuan HQ **[V]**, nilai ambang **[K]**.
- Asisten SPV tidak punya akses menu ini.

> **[B]** Layar menolak dengan teks "Sengketa order hanya untuk Manajer depot." bagi peran tanpa kemampuan, tetapi SPV memiliki kemampuan `depotDisputes` dan dapat menyelesaikan sengketa.

**Daftar periksa:**
- [ ] Pelanggan sudah dihubungi sebelum memilih keputusan
- [ ] Catatan keputusan terisi, wajib saat "Tolak"
- [ ] Refund bernilai besar saya beri tahu akan menunggu HQ

> **[SCREENSHOT REQUIRED: SS-supervisor-06 — Sengketa "Terbuka" dengan tombol "Refund", "Kirim ulang", "Tolak" dan kolom "Catatan (opsional)"]**
> *Gambar 5.6 — Menyelesaikan sengketa.*

---

### Prosedur: Menetapkan atau mengubah target depot

**Tujuan:** Mengatur target bulanan satu depot.
**Peran:** SPV (juga Manajer; Kantor pusat dan Direktur).
**Prasyarat:** Satu depot terpilih.
**Titik awal:** "Tim & jadwal" > "Target & goals" (`/dashboard/targets`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka "Target & goals" | Judul "Target depot", `{bulan} · hari ke-{day} dari {days}`; bilah Pendapatan, Order terkirim, SLA on-time (%), Pelanggan baru |
| 2 | Perhatikan bilah kuning | Menandai KPI di bawah laju bulan berjalan |
| 3 | Tekan "Ubah target" (atau "Set target bulan ini" bila "Belum ada target") | Formulir "Ubah target {bulan}" |
| 4 | Isi **Pendapatan (Rp)**, **Order terkirim**, **SLA on-time (%)**, **Pelanggan baru** (semua angka) | Bila bukan angka: "Semua target harus berupa angka." |
| 5 | Tekan "Simpan target" | Target tersimpan; gagal: "Gagal menyimpan target." |

**Hasil akhir:** Target bulan itu tersimpan dan bilah kemajuan memakainya.
**Izin & batasan:** SPV dapat menyimpan target (server `depotTargets` untuk seluruh kelas) **[V]**. Asisten SPV tidak punya menu ini.

> **[B]** Teks pembatas menyebut "Target & goals depot hanya untuk Manajer depot." walau SPV lolos. Perubahan target memengaruhi penilaian depot; sepakati nilainya dengan Manajer dahulu **[D]**.

**Daftar periksa:**
- [ ] Bulan yang tampil benar
- [ ] Keempat angka target terisi dan masuk akal
- [ ] Nilai disepakati dengan Manajer

---

### Prosedur: Memeriksa dan mencatat buku kas depot

**Tujuan:** Memantau kas masuk/keluar harian depot, mencatat entri, dan mengoreksi salah catat.
**Peran:** SPV (juga Manajer, Finance, Direktur).
**Prasyarat:** Satu depot terpilih.
**Titik awal:** "Keuangan · usulan" > "Buku kas" (`/dashboard/cashbook`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka "Buku kas" | Kartu "Hari ini": Masuk, Keluar, Kas bersih; daftar "Transaksi hari ini" |
| 2 | Untuk mencatat, buka "Catat kas", pilih Masuk atau Keluar | Formulir tampil |
| 3 | Isi **Kategori** (mis. Penjualan, Belanja), **Keterangan** (mis. Penjualan galon tunai), **Nominal (Rp)** > 0 | Bila kosong: "Isi kategori, keterangan, dan nominal (> 0)." |
| 4 | Tekan "Simpan" | Entri muncul; gagal: "Gagal mencatat kas." |
| 5 | Untuk mengoreksi, tekan "Koreksi" pada entri | Dialog "Koreksi entri kas" |
| 6 | Isi "Alasan koreksi" (minimal 4 huruf) lalu "Catat koreksi" | Entri kebalikan tercatat; bila alasan pendek: "Tulis alasan koreksinya (minimal 4 huruf)."; gagal: "Gagal mencatat koreksi." |
| 7 | Untuk arsip, gunakan "Ekspor Excel" atau "Laporan harian" | Berkas atau laporan terbuka |

**Hasil akhir:** Kas hari itu akurat dan setiap koreksi dapat diaudit.
**Izin & batasan:**
- Entri tidak dapat diubah atau dihapus, hanya dibalik. "Entri aslinya tetap ada. Koreksi mencatat entri kebalikannya" **[V]**.
- SPV dapat mencatat dan membalik entri (server `depotFinance` pada kelas pengendali) **[V]**. Asisten SPV tidak punya menu ini.
- "Tutup buku harian" ada di halaman Laporan, yang tidak terlihat oleh SPV **[V]**.

> **[B]** Teks pembatas "Buku kas depot hanya untuk Manajer depot." tidak sesuai kenyataan. Komentar RBAC "tanpa tulis, tanpa uang" juga bertentangan dengan kemampuan mencatat kas.

**Daftar periksa:**
- [ ] Kategori dan keterangan jelas
- [ ] Nominal tidak salah satu nol
- [ ] Koreksi disertai alasan yang dapat dipahami auditor

> **[SCREENSHOT REQUIRED: SS-supervisor-07 — Halaman "Buku kas" menampilkan kartu Masuk/Keluar/Kas bersih, formulir "Catat kas", dan dialog "Koreksi entri kas"]**
> *Gambar 5.7 — Buku kas dan koreksi.*

---

### Prosedur: Membaca laporan dan layar keuangan baca-saja

**Tujuan:** Memakai layar laporan yang tersedia untuk SPV.
**Peran:** SPV.
**Titik awal:** "Keuangan · usulan".

| Layar | Hasil untuk SPV | Catatan |
|---|---|---|
| Laporan L/R | Dapat dibuka (baca) | Satu depot, per bulan |
| Rekonsiliasi bayar | Baca saja | Pesan: "Layar ini baca-saja untuk peranmu. Konfirmasi lunas dikerjakan di antrean pesanan oleh kepala depot, staf depot, manajer, atau keuangan." Butuh depot terpilih: "Rekonsiliasi menampilkan pesanan satu depot. Pilih depot dulu." |
| Komisi kurir | Ditolak server | [B] Lihat bagian 5.3 |
| Tinjauan bulanan | Ditolak server | [B] "Tutup bulan" hanya Manajer; "Buka bulan" hanya HQ |
| Laporan (`/dashboard/reports`) | Tidak terlihat | Milik Manajer; di sana "Tutup buku harian" |
| Performa tim | Ditolak server | [B] |

SPV tidak dapat menutup buku, menutup bulan, atau memverifikasi setoran COD.

---

### Prosedur: Mengajukan pinjam karyawan (employeeAssignRequest)

**Tujuan:** Meminta HR meminjamkan karyawan dari depot lain ke depot dalam cakupan SPV.
**Peran:** SPV (dan Manajer). Asisten SPV dan Kepala depot **tidak** bisa.
**Prasyarat:**
- Fitur penugasan lintas depot aktif (bendera `DEPOT_ASSIGNMENT_ENABLED`, bawaan MATI). Bila mati, muncul "Penugasan lintas depot belum diaktifkan" **[V]**, status produksi **[K]**.
- Anda tahu kode karyawan (contoh sintetis: `HR-0012`; hint layar menulis "mis. EMP-0012", sedangkan format kode sebenarnya "HR-####" **[B]**).
**Titik awal:** `/hr/depot-requests` ("Permintaan pinjam karyawan"). Tidak ada menu ke sana dari rel SPV; ketik alamatnya di desktop atau pakai tautan dari HR **[D]**.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka halaman | Petunjuk: "Ajukan peminjaman karyawan dari depot lain untuk depot Anda. HR yang memutuskan; karyawan baru berpindah setelah disetujui." |
| 2 | Isi **Kode karyawan** (maks. 40 karakter) | |
| 3 | Pilih **Depot tujuan** ("Pilih depot tujuan"); hanya depot dalam cakupan Anda | |
| 4 | Isi **Mulai** (tanggal, tidak boleh sebelum hari ini) dan **Sampai (hari terakhir)** (wajib; peminjaman selalu bertanggal akhir) | |
| 5 | Isi "Catatan (opsional)" (maks. 300 karakter) | |
| 6 | Tekan "Ajukan" | Toast "Permintaan terkirim ke HR"; baris muncul di "Permintaan Anda" berstatus "Diajukan" |

Status yang akan Anda lihat: Diajukan, Terjadwal, Berjalan, Selesai, Dibatalkan, Gagal. Jenis selalu "Dipinjamkan" **[V]**.

**Hasil akhir:** Permintaan berstatus "Diajukan" menunggu HR. Permintaan hanya usulan: tidak memindahkan siapa pun dan tidak memakai hari kerja. Setelah HR menyetujui, status "Terjadwal"; karyawan berpindah pada tanggal mulai **[V]**.

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| Penugasan lintas depot belum diaktifkan | Fitur mati (404) | Minta Admin/HR mengaktifkan |
| Karyawan tidak ditemukan | Kode salah | Periksa kode di HR |
| Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya. | Depot tujuan di luar cakupan | Pilih depot dalam cakupan |
| Jabatan karyawan ini tidak bisa ditugaskan lintas depot (hanya staf depot sampai manajer). | Jabatan tidak memenuhi syarat | Hubungi HR |
| Karyawan ini belum punya akun login; buatkan akunnya dulu. | Belum punya akun | Minta HR membuat akun |
| Hanya karyawan aktif yang bisa ditugaskan. | Karyawan tidak aktif | Pilih karyawan lain |
| Karyawan ini belum punya depot asal. | Data HR belum lengkap | Hubungi HR |
| Depot tujuan sama dengan depot asal karyawan. | Tujuan = asal | Pilih depot lain |
| Tanggal akhir peminjaman wajib diisi dan tidak boleh sebelum tanggal mulai. | Tanggal salah | Perbaiki tanggal |
| Tanggal mulai terlalu lampau (maksimal 92 hari ke belakang). | Terlalu jauh ke belakang | Ganti tanggal |
| Tanggal mulai terlalu jauh (maksimal 366 hari ke depan). | Terlalu jauh ke depan | Ganti tanggal |
| Tanggal mulai sebelum karyawan masuk kerja. | Mulai sebelum tanggal masuk | Ganti tanggal |
| Penugasan melewati tanggal keluar karyawan. | Melewati tanggal keluar | Persingkat |
| Penugasan bertabrakan dengan penugasan lain yang masih berjalan atau terjadwal. | Bentrok | Pilih rentang lain |
| Depot tujuan tidak aktif (sedang ditutup). | Depot tutup | Pilih depot aktif |
| Gagal mengirim permintaan. | Galat umum | Coba lagi |

Beberapa masalah muncul sebagai daftar bertitik merah sekaligus.

**Izin & batasan:** Mutasi permanen tidak bisa diajukan SPV; hanya HR **[V]**.

> **[B]** Bila peran tak berhak membuka halaman ini, judul penolak berbunyi "Impor massal tidak tersedia untuk peran ini" (teks yang dipakai ulang) dan isi menyebut "Hanya manajer depot yang bisa mengajukan peminjaman karyawan" meski SPV juga berhak. Abaikan teks itu sebagai kebijakan.

> **[B]** Tidak ada kotak masuk global bagi HR; HR memutuskan dari kartu karyawan masing-masing **[D]**. Pantau status permintaan Anda di "Permintaan Anda" dan tanyakan ke HR bila lama.

**Daftar periksa:**
- [ ] Tanggal mulai dan akhir terisi
- [ ] Depot tujuan adalah depot saya
- [ ] Saya memberi tahu HR agar permintaan segera dibaca

> **[SCREENSHOT REQUIRED: SS-supervisor-08 — Halaman "Permintaan pinjam karyawan" dengan formulir terisi dan daftar "Permintaan Anda" berstatus "Diajukan"]**
> *Gambar 5.8 — Mengajukan pinjam karyawan.*

---

### Prosedur: Memakai HRIS mandiri ("Absen saya")

**Tujuan:** Absen wajah, melihat slip gaji, mengajukan cuti, dan memantau kasbon milik sendiri.
**Peran:** SPV.
**Prasyarat:** Akun terhubung ke data karyawan.
**Titik awal:** "Tim & jadwal" > "Absen saya" (`/hr/me`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka "Absen saya" | Halaman layanan mandiri karyawan |
| 2 | Lakukan absen wajah dan lokasi | Absen tercatat |
| 3 | Untuk cuti, ajukan lewat bagian cuti | Pengajuan masuk tahap 1 (Manajer) |
| 4 | Untuk kasbon, buka `/hr/me/kasbon` ("Kasbon Saya") | Lihat bagian peringatan di bawah |

> **Peringatan kasbon SPV.** Pengajuan kasbon dari akun yang tidak terikat satu depot (Asisten SPV, SPV, Manajer, Direktur) ditolak sistem: "Kasbon diputuskan oleh asisten supervisor depot, dan akun ini tidak terikat pada satu depot. Ajukan lewat HR." **[V]** Jadi SPV mengajukan kasbon lewat HR.

- Absen SPV di luar semua depot dalam cakupan ditahan ("Menunggu persetujuan") sampai HR memutuskan, dan tidak dihitung payroll sebelum diputuskan **[V]**.
- Absen offline yang terlalu lama ditolak: "Absen offline sudah terlalu lama. Minta entri manual ke HR." **[V]**
- Cuti: tahap 1 oleh Manajer, tahap 2 oleh HR. Ditolak harus ada alasan.

**Daftar periksa:**
- [ ] Absen dilakukan di dalam jangkauan depot
- [ ] Kasbon diajukan lewat HR

> **[SCREENSHOT REQUIRED: SS-supervisor-09 — Halaman "Absen saya" SPV menampilkan tombol absen dan status hari ini]**
> *Gambar 5.9 — HRIS mandiri SPV.*

---

### Prosedur: Membaca notifikasi ops, reseller, dan layar baca-saja lainnya

**Tujuan:** Mengetahui layar pemantauan lain dan batasnya.
**Peran:** SPV.

| Layar | Fungsi | Batas SPV |
|---|---|---|
| Notifikasi ops (`/dashboard/notifications`) | Peringatan operasional seperti "Stok kritis" dan "Insiden kurir"; status dibaca tersimpan per akun | Hanya SPV dan Manajer; Asisten SPV tidak punya **[V]** |
| Perkiraan (`/dashboard/forecast`) | Prakiraan | Baca saja |
| Inventori | Stok depot | Aksi diganti teks "Hanya lihat" |
| Retur galon | Retur galon | Baca saja |
| Meteran air | Pembacaan meteran | Baca saja; pencatatan oleh staf depot ke atas |
| Reseller / Agen (`/resellers`) | Pencapaian bulan berjalan | Baca saja; tambah/ubah/impor hanya Manajer |
| Pelanggan dan CRM & follow-up | Direktori pelanggan, tindak lanjut | Baca saja; impor hanya Manajer ke atas |
| Jadwal shift | Jadwal staf | Baca saja; "Atur shift" hanya Kepala depot/Manajer/HQ |
| Peran & akses | Kemampuan akun sendiri | Baca saja |
| Audit log | Jejak audit, dibatasi cakupan | Baca saja |

## 7. Kolom wajib dan aturan validasi (ringkasan)

| Formulir | Kolom wajib | Batas dan format |
|---|---|---|
| Laporkan insiden | Judul, Jenis, Tingkat, Keterangan | Judul tidak boleh terlalu pendek; Kurir dan Nomor pesanan opsional |
| Selesaikan insiden | Catatan penyelesaian | Minimal 3 karakter |
| Catat sengketa | Nomor order, Nama pelanggan, Keterangan (Kategori dipilih) | Nilai (Rp) dan Kurir opsional |
| Selesaikan sengketa | Keputusan (Refund / Kirim ulang / Tolak) | Catatan wajib bila "Tolak" |
| Target depot | Pendapatan (Rp), Order terkirim, SLA on-time (%), Pelanggan baru | Semua harus angka |
| Catat kas | Kategori, Keterangan, Nominal (Rp) | Nominal > 0 |
| Koreksi kas | Alasan koreksi | Minimal 4 huruf |
| Pinjam karyawan | Kode karyawan, Depot tujuan, Mulai, Sampai | Kode maks. 40; catatan maks. 300; mulai tidak sebelum hari ini; maks. 92 hari ke belakang dan 366 hari ke depan |
| Tarik / batalkan pengiriman | Alasan | Teks bebas |

## 8. Kesalahan umum dan solusi

| Gejala atau pesan | Arti | Solusi |
|---|---|---|
| Daftar depot kosong atau "Gagal memuat daftar depot." | Cakupan kosong atau layanan gagal | Muat ulang; bila tetap, minta Admin memeriksa hierarki |
| Akun ini belum diberi tanggung jawab depot manapun. | Belum ada depot untuk Anda | Minta Admin |
| Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya. | Depot di luar cakupan | Pilih depot lain |
| Angka landing berbeda dengan satu depot | Landing = jumlah semua depot | Pilih depot dan buka layar rinci |
| Halaman memakai "depot pertama" | Pemilih pada "Semua depot" | Pilih depot secara eksplisit |
| Menu Komisi kurir / Tinjauan bulanan / Performa tim kosong atau galat | Server menolak peran SPV **[B]** | Minta data ke Manajer |
| Depot baru saja ditambahkan namun tidak terlihat | Cakupan butuh ±60 detik, atau depot belum punya Asisten SPV | Tunggu 1-2 menit; bila tetap, minta Admin |
| "You do not have permission to perform this action." | Aksi di luar hak (Inggris; arti: Anda tidak punya izin melakukan tindakan ini) | Berhenti; minta Manajer atau HQ |
| Layar penolak "Khusus Manajer depot" | Peran tak punya hak, atau teks yang keliru **[B]** | Bila layar yang SPV biasa pakai (Buku kas, Target, Sengketa) menolak, laporkan ke Admin |

## 9. Batasan peran (yang TIDAK bisa dilakukan SPV)

| Hal | Siapa yang memutuskan |
|---|---|
| Memutuskan kasbon | Asisten SPV di depot itu; bila depot tanpa asisten, Manajer atau HR **[V]** |
| Menyetujui cuti tahap 1 | Manajer (atau HR); SPV hanya membaca antrean **[V]** |
| Antrean approval (selisih opname, refund deposit, selisih retur galon) | Manajer |
| Konfirmasi lunas, tandai gagal, ajukan refund | Kepala depot / Staff depot / Manajer / Finance; refund besar oleh HQ |
| Verifikasi setoran COD, klaim pengeluaran | Kepala depot / Manajer / Finance |
| Pembelian (pesanan pembelian, pemasok) | Manajer |
| Mengubah stok, retur galon, meteran | Kepala depot / Manajer |
| Mengubah harga, produk, voucher, promo | Manajer / Pemasaran / HQ |
| Mengubah cakupan depot atau hierarki | Admin saja |
| Mengubah hak akses | Admin saja |
| Mutasi permanen karyawan | HR |
| Menutup buku harian / bulanan | Kepala depot, Manajer, HQ |

SPV tidak boleh meminjam hak orang lain dengan membagi akun. Lihat bagian 10.

## 10. Pertimbangan keamanan

- Jangan berbagi akun atau kode OTP. Setiap aksi tercatat atas nama akun Anda (audit log).
- Aksi tulis SPV (insiden, sengketa, target, buku kas, tarik/batal pengiriman) mengubah data nyata. Tulis alasan yang jelas.
- Data pelanggan di CRM: jangan menyalin nomor telepon atau alamat keluar sistem.
- Keluar dari akun (tombol keluar di bagian bawah menu) setelah memakai perangkat bersama.
- Pemisahan tugas: orang yang mengajukan tidak boleh memutuskan pengajuannya sendiri (berlaku pada antrean approval, kasbon, dan cuti) **[V]**.
- Hak akses dapat diubah Admin saat berjalan; laporkan bila Anda melihat menu yang tidak seharusnya.

## 11. Kegiatan akhir hari dan berkala

| Kapan | Kegiatan |
|---|---|
| Awal hari | Cek "Operasi" (SLA, Terlewat / gagal), "Notifikasi ops", insiden berstatus "Baru" |
| Sepanjang hari | Pantau "Live tracking" dan "Antrean pesanan" untuk pesanan macet |
| Akhir hari | Tinjau "Buku kas" (Masuk, Keluar, Kas bersih), selesaikan atau serahkan insiden dan sengketa terbuka |
| Mingguan | Bandingkan depot teratas dan SLA; bahas dengan Asisten SPV dan Manajer |
| Bulanan | Perbarui "Target & goals"; baca "Laporan L/R" tiap depot; cek permintaan pinjam karyawan |

## 12. Skenario praktis

**Skenario 1 — Pengiriman macet.** "Terlewat / gagal" naik di landing. Buka "Antrean pesanan", temukan pesanan macet, buka "Live tracking". Bila kurir tidak dapat dihubungi, "Tarik ke antrean" dengan alasan, lalu tugaskan kurir lain di rincian pesanan.

**Skenario 2 — Pelanggan komplain "Tidak diterima".** Catat di "Sengketa order" (kategori "Tidak diterima"). Hubungi pelanggan. Pilih "Kirim ulang" bila barang belum tiba; "Refund" bila uang dikembalikan (di atas ambang menunggu HQ).

**Skenario 3 — Depot kekurangan kurir.** Ajukan "Permintaan pinjam karyawan" ke HR dengan kode karyawan, depot tujuan, tanggal mulai dan akhir. Pantau di "Permintaan Anda".

**Skenario 4 — Kasbon staf depot menumpuk.** Itu antrean Asisten SPV. Ingatkan Asisten SPV depot itu. Bila depot tanpa Asisten SPV, kasbon hanya bisa diputuskan Manajer (hak langsung) atau HR.

**Skenario 5 — Menu "Performa tim" galat.** Itu bukan kerusakan; server menolak peran SPV. Minta Manajer membagikan data.

## 13. Daftar periksa penyelesaian

- [ ] Saya paham depot mana saja dalam cakupan saya
- [ ] Saya paham landing = jumlah semua depot
- [ ] Saya tahu menu mana yang baca saja dan mana yang tulis
- [ ] Saya tahu kasbon dan cuti bukan keputusan saya
- [ ] Saya tahu cara mencatat insiden dan menyelesaikan sengketa
- [ ] Saya tahu mengajukan kasbon pribadi lewat HR

## 14. Inventaris screenshot bab ini

| ID | Layar | Kondisi | Status |
|---|---|---|---|
| SS-supervisor-01 | Menu kiri dan pemilih depot | Beberapa depot, "Peran: SPV" | Belum diambil |
| SS-supervisor-02 | Landing "Operasi" eksekutif | Data 30 hari | Belum diambil |
| SS-supervisor-03 | Laporan L/R | Satu depot terpilih | Belum diambil |
| SS-supervisor-04 | Rincian pesanan | Tanpa tombol konfirmasi/refund | Belum diambil |
| SS-supervisor-05 | Insiden | Formulir dan daftar | Belum diambil |
| SS-supervisor-06 | Sengketa order | Sengketa "Terbuka" | Belum diambil |
| SS-supervisor-07 | Buku kas | Entri dan dialog koreksi | Belum diambil |
| SS-supervisor-08 | Permintaan pinjam karyawan | Formulir terisi + riwayat | Belum diambil |
| SS-supervisor-09 | Absen saya | Hari berjalan | Belum diambil |
| SS-supervisor-10 | (Lampiran A) Antrean approval Manajer | Satu item PENDING | Belum diambil |

## 15. Catatan celah dan hal yang perlu dikonfirmasi

Rujuk ke `17-open-questions`.

| No | Celah | Tag |
|---|---|---|
| S1 | Komentar RBAC "tanpa tulis, tanpa uang, tanpa approval" bertentangan dengan hak tulis SPV pada insiden, sengketa, target, buku kas, serta aksi pengiriman | [B] |
| S2 | Menu "Komisi kurir", "Tinjauan bulanan", "Performa tim" tampil tetapi ditolak server; teks galat belum diverifikasi di peramban | [B] |
| S3 | Teks penolak "Khusus Manajer depot" pada layar yang bisa dibuka SPV (Buku kas, Target, Sengketa, Insiden) | [B] |
| S4 | Tidak ada tautan menu dari rel SPV ke `/hr/depot-requests` dan `/hr/leave` | [D] |
| S5 | Status bendera `DEPOT_ASSIGNMENT_ENABLED` di produksi | [K] |
| S6 | Ambang refund HQ (bawaan Rp100.000) di produksi | [K] |
| S7 | Teks halaman pinjam karyawan memakai judul "Impor massal tidak tersedia untuk peran ini" dan isi hanya menyebut manajer | [B] |
| S8 | Cara depot mendapat Asisten SPV selain `/hq/hierarchy` (hanya Admin) | [K] |
| S9 | Apakah SPV memang seharusnya dapat menulis di buku kas dan target | [K] |
| S10 | Hint kode karyawan "mis. EMP-0012" tidak sesuai format "HR-####" | [B] |

---

# Lampiran A — Peran Manajer (MANAGER)

> Lampiran ringkas karena SPV melapor ke dan bekerja bersama Manajer. Panduan lengkap Manajer tidak dalam cakupan bab ini. Hak akses = nilai bawaan; Admin dapat mengubahnya (±30 dtk).

## A.1 Gambaran

Manajer memegang 70 kemampuan bawaan, termasuk hampir semua kemampuan tulis operasional **[V]**. Manajer mendarat di tampilan "manager" pada `/dashboard`; di aplikasi ponsel Ops, Manajer mendarat di konsol `/m/manager` dengan tab "Beranda", "Approval", "Notif", "Tim", "Akun" **[V]**. SPV dan Asisten SPV tidak dapat membuka `/m/manager` ("Halaman khusus manajer depot") **[V]**.

Cakupan Manajer: depot milik Asisten SPV di bawah SPV bawahannya, ditambah hak langsung **[V]**. Manajer tidak dapat mengubah cakupannya sendiri.

## A.2 Menu khas Manajer

| Kelompok | Menu (rute) | Fungsi singkat |
|---|---|---|
| Approval & supervisi | Antrean approval (`/dashboard/approvals`) | Memutuskan selisih opname, refund deposit, selisih retur galon |
| Pengadaan | Pesanan pembelian (`/dashboard/purchase-orders`), Pemasok (`/dashboard/suppliers`) | Draft, kirim, terima barang |
| Operasi harian | Penjualan depot, Susut & kerusakan, Setoran COD | Kasir, laporan wastage, verifikasi setoran COD |
| Keuangan | Klaim pengeluaran, Laporan, Tinjauan bulanan, Banding depot, Performa tim | Setujui klaim kurir, tutup buku/bulan, analisis |
| Jaringan / produk | Depot, Harga dinamis, Pengaturan, Kelola produk, Harga borongan, Pembayaran & QRIS | Pengaturan depot dan harga |
| Pemasaran / pelanggan | Voucher, Aturan promo, Broadcast, Loyalty, Penukaran hadiah, Langganan | Program pelanggan |
| Tim | Huddle, Serah terima shift, Perawatan alat, Panduan manajer | Operasi tim |

## A.3 Antrean approval

Kemampuan `approvals` hanya Manajer dan Admin **[V]**. Jenis item: "Selisih opname", "Refund deposit", "Kurang setoran", "Selisih retur galon". Aksi: "Setujui", "Tahan", "Tolak" (catatan wajib untuk tolak: "Isi alasan penolakan."). Aturan penting:

- Item di bawah batas auto-pass (bawaan Rp100.000, "Batas auto-pass approval") otomatis disetujui. Nilai hanya dapat diubah HQ atau Admin **[V]**, nilai produksi **[K]**.
- Pengaju tidak boleh memutuskan pengajuannya sendiri: "Pengaju tidak boleh memutuskan pengajuannya sendiri — teruskan ke atasan." **[V]**
- Item "Tahan" hilang dari daftar (hanya PENDING yang dimuat) dan hanya dapat dibuka lewat tautan **[B]**.
- Tampilan detail desktop untuk "Selisih retur galon" dan nominal "Deposit dikembalikan" dapat menampilkan Rp0 **[B]**; tampilan ponsel benar.
- Tidak ada pengaju otomatis untuk "Kurang setoran" (COD); setoran COD diverifikasi di "Setoran COD" **[V]**.

> **[SCREENSHOT REQUIRED: SS-supervisor-10 — Antrean approval Manajer dengan satu item PENDING dan penghitung "Menunggu approval · {n} item"]**
> *Gambar A.1 — Antrean approval (rujukan SPV).*

## A.4 Pembelian

Pesanan pembelian: Draft → Dikirim → Diterima. Manajer membuat PO dari stok menipis ("Buat PO dari stok menipis"), memilih pemasok, mengirim ("Kirim ke pemasok"), dan menerima ("Terima barang → RECEIPT"). Kurang kirim diberi alasan ("Alasan sisanya tidak datang"). Pesan server bisa berbahasa Inggris, mis. "Only a SENT purchase order can be received." (arti: hanya PO berstatus Dikirim yang dapat diterima) **[V]**. SPV tidak punya akses.

## A.5 Keuangan Manajer

- Klaim pengeluaran kurir: Manajer menyetujui sampai batas bawaan Rp500.000; di atasnya wajib Finance: "Klaim di atas Rp{limit} harus disetujui FINANCE." (Manajer tetap boleh menolak) **[V]**, nilai produksi **[K]**.
- Refund pembayaran: Manajer mengajukan lewat "Ajukan refund" di rincian pesanan; nilai di atas ambang menunggu HQ/Finance **[V]**.
- Setoran COD: "Verifikasi" atau "Sengketakan"; selisih lebih dari Rp5.000 butuh catatan **[V]**.
- Tutup buku harian dan "Tutup bulan"; "Buka bulan" hanya HQ **[V]**.

## A.6 Cuti dan kasbon

- Cuti tahap 1 diputuskan Manajer (atau HR); tahap 2 HR **[V]**.
- Kasbon: Manajer dapat memutuskan hanya bila depot **tidak** punya Asisten SPV tercatat (eskalasi K2). Bila ada Asisten SPV, Manajer ditolak: "Kasbon ini diputuskan oleh asisten supervisor depotnya." **[V]**

## A.7 Perbedaan dengan SPV (ringkas)

Lihat tabel lengkap di Bab 6, bagian 3. Intinya: Manajer dapat menulis hampir semua hal operasional dan memegang approval; SPV memantau dan hanya menulis pada beberapa area; Asisten SPV hanya memantau dan memutuskan kasbon.
