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

