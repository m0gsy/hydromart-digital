# Bab 6 — Panduan Asisten Supervisor (Asisten SPV)

| | |
|---|---|
| Versi | 0.1 draf |
| Tanggal | 2026-10-10 |
| Klasifikasi | Internal — Terbatas |
| Peran | Asisten SPV (kode sistem `ASSISTANT_SUPERVISOR`) |

> **Catatan hak akses (baca dahulu).** Hak akses di bab ini adalah nilai BAWAAN dari `packages/access/src/index.ts`. SUPER_ADMIN dapat mengubahnya saat sistem berjalan, dan perubahan berlaku dalam kira-kira 30 detik. Bila layar Anda berbeda dari bab ini, tanyakan ke Admin. Bab ini belum diuji langsung di aplikasi oleh penulisnya; semua isi berasal dari pembacaan kode dan temuan tim.

> **Arti tag bukti.** **[V]** terverifikasi di kode · **[D]** disimpulkan, perlu konfirmasi · **[K]** perlu konfirmasi bisnis · **[B]** diketahui bermasalah atau tidak konsisten.

> **Jangan menganggap Asisten SPV sama dengan SPV atau Manajer.** Ketiganya punya hak yang berbeda. Lihat tabel perbandingan di bagian 5. Hak khas Asisten SPV yang tidak dimiliki SPV adalah **memutuskan kasbon** di depot sendiri.

---

## 1. Gambaran peran

Asisten SPV adalah pengawas harian beberapa depot yang ditugaskan langsung kepadanya. Dalam rantai pembinaan:

`Staff Depot → Kepala Depot → Asisten SPV → SPV → Manajer → Direktur` **[V]**

Ciri utama:

- **Depot "menggantung" pada Asisten SPV.** Hierarki sistem menempelkan depot hanya pada Asisten SPV; SPV dan Manajer mengetahui depot lewat Asisten SPV di bawah mereka **[V]**.
- Sebagian besar hak adalah **baca saja** (memantau).
- Satu pengecualian yang disengaja: Asisten SPV **memutuskan kasbon** karyawan di depot sendiri (`kasbonApprove`). Ini keputusan uang sekaligus persetujuan **[V]** (komentar `index.ts` baris 367-383).
- Mendarat di "Operasi" bertipe eksekutif (ringkasan 30 hari terakhir), sama dengan SPV.

> **[B] Kontradiksi kode.** Komentar header `index.ts` baris 35-40 menyatakan "oversight reads, no writes, no money, no approvals", lalu menyebut kasbon sebagai satu-satunya pengecualian. Namun daftar kemampuan Asisten SPV juga memuat dua kemampuan tulis pengiriman/pesanan (`orderFulfilment` dan `tracking`). Panduan ini mengikuti daftar kemampuan, bukan komentarnya.

## 2. Tujuan dan tanggung jawab

| Tanggung jawab | Penjelasan singkat | Bukti |
|---|---|---|
| Memutuskan kasbon di depot sendiri | Setujui (dengan cicilan dan bulan mulai potong) atau tolak (dengan alasan) | [V] |
| Pengawasan harian depot | Membaca landing, antrean pesanan, tracking, inventori, retur galon, meteran, perkiraan | [V] |
| Tindakan pengiriman bila mendesak | Memajukan status pesanan, menugaskan, menarik, atau membatalkan pengiriman | [V] |
| Mengawasi pelanggan dan CRM | Melihat direktori pelanggan dan tindak lanjut (baca) | [V] |
| Mengurus data diri | Absen wajah, cuti, slip gaji lewat "Absen saya" | [V] |
| Melapor ke SPV | Menyampaikan temuan dan eskalasi | [D] |

## 3. Prasyarat akses

| Syarat | Keterangan |
|---|---|
| Akun staf aktif | Dibuat HR/Admin |
| Peran "Asisten SPV" | Label di bawah menu: "Peran: Asisten SPV" **[V]** |
| Depot ditugaskan | Admin menetapkan Asisten SPV untuk setiap depot di `/hq/hierarchy` ("Asisten SPV tiap depot"). **Hanya Admin** yang dapat mengubahnya **[V]** |
| Perangkat | Peramban web (desktop/ponsel) |

### 3.1 Cakupan depot

Cakupan Asisten SPV dihitung dari **[V]**:

1. Depot asal di akun (bila ada).
2. Hierarki: semua depot yang mencatat dirinya sebagai Asisten SPV.
3. Hak langsung tambahan dari Admin ("Depot titipan langsung").

Konsekuensi penting:

- Perubahan penugasan baru berlaku sekitar **±60 detik** kemudian.
- **Kasbon hanya muncul untuk depot dalam cakupan Anda.** Daftar kasbon dipersempit ke depot Anda **[V]**.
- Depot yang belum punya Asisten SPV tidak terlihat oleh siapa pun di rantai (SPV, Manajer, Asisten SPV), kecuali ada hak langsung. Kasbon depot itu hanya bisa diputuskan Manajer (yang punya hak langsung) atau HR/Admin **[V]**.
- Asisten SPV tidak dapat mengubah cakupannya sendiri.

| Pesan sistem | Arti | Solusi |
|---|---|---|
| Akun ini belum diberi tanggung jawab depot manapun. | Cakupan kosong | Minta Admin menempatkan Anda di hierarki |
| Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya. | Depot di luar cakupan | Pilih depot lain |
| Gagal memuat daftar depot. | Pemilih depot gagal | Muat ulang; bila berulang, lapor Admin |

## 4. Masuk dan pengaturan awal

### Prosedur: Masuk dan memilih konteks depot

**Tujuan:** Masuk ke konsol dan memilih depot yang ingin dilihat.
**Peran:** Asisten SPV.
**Prasyarat:** Akun staf aktif dengan depot ditugaskan.
**Titik awal:** Halaman masuk staf, lalu "Operasi" (`/dashboard`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka halaman masuk staf dan isi nomor HP terdaftar | Kode OTP dikirim **[D]** |
| 2 | Masukkan kode OTP | Anda masuk ke "Operasi" tampilan eksekutif |
| 3 | Periksa bagian bawah menu kiri | "Peran: Asisten SPV" |
| 4 | Buka pemilih depot | Daftar depot binaan Anda: nama dan `{kode} · {kota}` |
| 5 | Pilih satu depot atau "Semua depot" | `{kode} · konteks aktif` atau "{n} lokasi · gabungan" |

**Hasil akhir:** Anda berada di konsol dengan konteks depot.
**Masalah umum:** Lihat bagian 3.1 dan 8.
**Izin & batasan:** "Semua depot" tidak mengubah angka landing (jumlah seluruh depot cakupan). Halaman yang butuh satu depot memakai depot pertama dalam daftar secara diam-diam **[V]**. Pilih depot secara eksplisit saat memeriksa satu depot.
**Daftar periksa:**
- [ ] Peran tertulis "Asisten SPV"
- [ ] Depot di pemilih sesuai depot binaan saya

> **[SCREENSHOT REQUIRED: SS-asisten-supervisor-01 — Menu kiri Asisten SPV dengan pemilih depot terbuka dan teks "Peran: Asisten SPV" di bagian bawah]**
> *Gambar 6.1 — Menu kiri dan pemilih depot Asisten SPV.*

## 5. Tabel perbandingan: Asisten SPV, SPV, dan Manajer

Sumber: `packages/access/src/index.ts` (CAPABILITIES), selisih dihitung dari daftar kemampuan **[V]**. Jumlah kemampuan bawaan: Asisten SPV 15, SPV 21, Manajer 70.

### 5.1 Perbandingan kemampuan inti

| Aspek | Asisten SPV | SPV | Manajer |
|---|---|---|---|
| Rantai pembinaan | Di atas Kepala depot, di bawah SPV | Di atas Asisten SPV | Di atas SPV |
| Depot dalam cakupan | Yang ditugaskan langsung kepadanya | Depot semua Asisten SPV bawahannya | Depot semua Asisten SPV di bawah SPV bawahannya |
| Landing | Eksekutif | Eksekutif | Manajer (kartu + widget aksi); di ponsel `/m/manager` |
| Dasbor "Operasi" | Ya | Ya | Ya |
| Antrean pesanan (baca) | Ya | Ya | Ya |
| Memajukan status pesanan | Ya | Ya | Ya |
| Tugaskan / tarik / batalkan pengiriman | Ya | Ya | Ya |
| Konfirmasi lunas / tandai gagal | Tidak | Tidak | Ya |
| Ajukan refund | Tidak | Tidak | Ya |
| Penjualan depot (kasir) | Tidak | Tidak | Ya |
| Inventori, retur galon, meteran | Baca saja | Baca saja | Tulis |
| Notifikasi ops | **Tidak** | Ya | Ya |
| Reseller / Agen | **Tidak** | Baca | Tulis |
| Insiden | **Tidak** | Ya (catat dan selesaikan) | Ya |
| Sengketa order | **Tidak** | Ya (selesaikan) | Ya |
| Target & goals | **Tidak** | Ya (simpan) | Ya |
| Buku kas | **Tidak** | Ya (catat dan koreksi) | Ya |
| Rekonsiliasi bayar | **Tidak** | Baca | Baca + konfirmasi lunas |
| Pelanggan dan CRM (baca) | Ya | Ya | Ya |
| Impor / tulis CRM | Tidak | Tidak | Ya |
| Laporan L/R | Ya (baca) | Ya (baca) | Ya |
| Audit log (baca) | Ya | Ya | Ya |
| Absen saya (absen wajah) | Ya | Ya | **Tidak tampil** di menu |
| Pengajuan pinjam karyawan | **Tidak** | **Ya** | Ya |
| **Memutuskan kasbon** | **Ya (depot sendiri)** | **Tidak** | Ya (hanya bila depot tanpa Asisten SPV) |
| Cuti tahap 1 | Tidak (baca antrean) | Tidak (baca antrean) | Ya |
| Antrean approval | Tidak | Tidak | Ya |
| Pembelian (PO, pemasok) | Tidak | Tidak | Ya |
| Klaim pengeluaran | Tidak | Tidak | Ya (sampai batas) |
| Pengaturan depot, harga, produk, voucher | Tidak | Tidak | Ya |
| Tutup buku harian / bulanan | Tidak | Tidak | Ya |

### 5.2 Selisih kemampuan (dari kode)

| Kategori | Kemampuan |
|---|---|
| Hanya SPV (tidak dimiliki Asisten SPV) | `opsNotif`, `resellerView`, `incidents`, `depotFinance`, `depotTargets`, `depotDisputes`, `employeeAssignRequest` |
| Hanya Asisten SPV (tidak dimiliki SPV) | `kasbonApprove` |
| Dimiliki Asisten SPV dan SPV, tidak dimiliki Manajer | Tidak ada. Semua kemampuan keduanya juga dimiliki Manajer |
| Dimiliki Asisten SPV | `auditRead`, `dashboard`, `depotCrm`, `forecast`, `hrView`, `inventoryRead`, `kasbonApprove`, `meterRead`, `orderFulfilment`, `orderQueue`, `ownNotifPrefs`, `paymentRead`, `returnsRead`, `tracking`, `trackingRead` |

### 5.3 Perbandingan keputusan kasbon dan cuti

| Keputusan | Asisten SPV | SPV | Manajer |
|---|---|---|---|
| Kasbon di depot yang punya Asisten SPV | Hanya Asisten SPV depot itu | Tidak | Ditolak: "Kasbon ini diputuskan oleh asisten supervisor depotnya." |
| Kasbon di depot tanpa Asisten SPV | Tidak terjangkau (tidak ada di cakupan) | Tidak | Ya, bila depot ada di cakupannya lewat hak langsung |
| Kasbon milik sendiri | Dilarang: "Kasbon sendiri tidak bisa Anda setujui." | — | Dilarang |
| Mengajukan kasbon pribadi | Lewat HR (akun tidak terikat satu depot) | Lewat HR | Lewat HR |
| Cuti tahap 1 | Tidak | Tidak | Ya |
| Cuti tahap 2 | HR | HR | HR |

HR dan Admin juga memegang `kasbonApprove`, tetapi tunduk pada aturan yang sama: bila depot punya Asisten SPV, hanya Asisten SPV itu yang boleh memutuskan **[V]**.

> **[B]** Teks halaman penolak "Insiden hanya tersedia untuk operator dan manajer depot." dan komentar RBAC tidak sepenuhnya cocok dengan hak yang ada; ikuti tabel ini.

## 6. Menu dan modul tersedia

### 6.1 Menu yang terlihat oleh Asisten SPV

| Kelompok | Label menu | Rute | Jenis | Bukti |
|---|---|---|---|---|
| Ringkasan | Operasi | `/dashboard` | Baca | [V] |
| Operasi harian | Antrean pesanan | `/dashboard/orders` | Baca + aksi status/kurir | [V] |
| Operasi harian | Live tracking | `/dashboard/tracking` | Aksi tarik/batalkan | [V] |
| Operasi harian | Inventori | `/dashboard/inventory` | Baca ("Hanya lihat") | [V] |
| Operasi harian | Retur galon | `/dashboard/returns` | Baca | [V] |
| Operasi harian | Meteran air | `/dashboard/meter` | Baca | [V] |
| Operasi harian | Perkiraan | `/dashboard/forecast` | Baca | [V] |
| Tim & jadwal | Absen saya | `/hr/me` | Data diri | [V] |
| Tim & jadwal | Jadwal shift | `/dashboard/shift` | Baca | [V] |
| Pelanggan & pertumbuhan | Pelanggan | `/dashboard/customers` | Baca | [V] |
| Pelanggan & pertumbuhan | CRM & follow-up | `/dashboard/crm` | Baca | [V] |
| Keuangan · usulan | Laporan L/R | `/dashboard/monthly-pnl` | Baca | [V] |
| Keuangan · usulan | Performa tim | `/dashboard/team-performance` | Ditolak server | [B] |
| Referensi | Peran & akses | `/dashboard/roles` | Baca | [V] |
| Referensi | Audit log | `/dashboard/audit` | Baca | [V] |
| Referensi | Akun saya | `/dashboard/account` | Akun sendiri | [V] |

### 6.2 Yang TIDAK terlihat

Notifikasi ops, Reseller / Agen, Insiden, Sengketa order, Target & goals, Buku kas, Rekonsiliasi bayar, Komisi kurir, Tinjauan bulanan, Antrean approval, serta seluruh menu Manajer **[V]**.

### 6.3 Menu "Performa tim" [B]

Menu tampil karena gerbangnya memakai `dashboard`, tetapi data di baliknya meminta `deliveryReports` dan `staffDirectory` yang tidak dimiliki Asisten SPV. Hasilnya layar galat atau kosong **[D]**.

### 6.4 Pintu masuk ke antrean kasbon (penting)

Antrean kasbon ada di `/hr/loans/requests` ("Antrean Kasbon"). **Tidak ada menu di rel Asisten SPV yang menuju `/hr`** kecuali "Absen saya" **[D]**. Jalan masuk:

1. Tautan dari notifikasi "pengajuan kasbon" (jenis `LOAN_REQUEST_SUBMITTED`, dikirim via WhatsApp atau dalam aplikasi) **[V]**. Di aplikasi ponsel Ops, halaman `/hr/loans/*` dilayani sehingga ketukan notifikasi dapat membuka antrean **[D]**.
2. Mengetik alamat `/hr/loans` di desktop, lalu tautan "Antrean pengajuan kasbon" **[V]**.
3. Menu "Kasbon" pada rel konsol HR (`/hr/loans`) setelah berada di `/hr` **[V]**.

Konsol `/hr` dapat dibuka karena Asisten SPV memegang `hrView` **[V]**.

> **[SCREENSHOT REQUIRED: SS-asisten-supervisor-02 — Halaman "Operasi" Asisten SPV (tampilan eksekutif) dengan menu kiri: perhatikan tidak ada Insiden, Sengketa, Buku kas, Target]**
> *Gambar 6.2 — Landing dan menu Asisten SPV.*

## 7. Prosedur langkah demi langkah

### Prosedur: Memutuskan kasbon di depot sendiri

**Tujuan:** Menyetujui atau menolak pengajuan kasbon karyawan di depot binaan.
**Peran:** Asisten SPV (kemampuan `kasbonApprove`).
**Prasyarat:**
- Ada pengajuan berstatus "Menunggu keputusan" di depot dalam cakupan Anda.
- Pengaju bukan Anda sendiri.
- Anda tercatat sebagai Asisten SPV depot itu.
**Titik awal:** `/hr/loans/requests` ("Antrean Kasbon"), dibuka lewat notifikasi, atau `/hr/loans` lalu tautan "Antrean pengajuan kasbon" (lihat bagian 6.4).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka "Antrean Kasbon" | Judul "Antrean Kasbon", subjudul "{n} pengajuan menunggu keputusan"; filter status bawaan "Menunggu keputusan" |
| 2 | Baca baris: nama karyawan · kode, tanggal, nominal, lencana status, "Alasan: ..." | Anda tahu siapa meminta berapa dan mengapa |
| 3 | Putuskan setuju atau tolak (lihat langkah 4a/4b). Pertimbangkan riwayat kehadiran dan kasbon berjalan di `/hr/loans` | |
| 4a | **Setuju:** isi **Cicilan per bulan (Rp)** (bilangan bulat > 0) dan **Mulai potong (YYYY-MM)** (bulan, wajib); isi **Catatan** (opsional, maks. 300 karakter); tekan "Setujui" | Toast "Kasbon disetujui."; status "Disetujui"; sistem membuat pinjaman dan cicilan dipotong lewat penggajian mulai bulan itu |
| 4b | **Tolak:** isi **Catatan** berisi alasan (wajib); tekan "Tolak" | Toast "Kasbon ditolak."; status "Ditolak"; karyawan diberi tahu |
| 5 | Muat ulang daftar bila perlu | Pengajuan yang sudah diputuskan hilang dari filter bawaan |

**Hasil akhir:** Pengajuan berstatus "Disetujui" (pinjaman terbentuk) atau "Ditolak". Karyawan menerima pemberitahuan (`LOAN_REQUEST_APPROVED` atau `LOAN_REQUEST_REJECTED`) **[V]**. Hasil persetujuan tampil di daftar kasbon (`/hr/loans`) dan di slip gaji karyawan.

**Kolom wajib dan batas:**

| Kolom | Wajib? | Aturan |
|---|---|---|
| Cicilan per bulan (Rp) | Ya (untuk setuju) | Bilangan bulat lebih dari 0 |
| Mulai potong (YYYY-MM) | Ya (untuk setuju) | Format tahun-bulan |
| Catatan | Ya untuk tolak | Maks. 300 karakter |

Tidak ada batas atas nominal kasbon di sistem; batas itu masih keputusan bisnis yang belum diambil **[K]**. Tanyakan kebijakan perusahaan sebelum menyetujui nominal besar.

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| Cicilan dan bulan mulai wajib diisi untuk menyetujui. | Cicilan atau bulan kosong | Isi keduanya |
| Alasan penolakan wajib diisi. | Menolak tanpa catatan | Tulis alasan |
| Pengajuan ini sudah dijawab orang lain. Muat ulang daftarnya. | Sudah diputuskan (konflik 409) | Muat ulang |
| Keputusan gagal disimpan. | Galat umum | Coba lagi |
| Tidak ada pengajuan kasbon di depot Anda. | Daftar kosong | Tidak ada tugas; atau periksa cakupan |
| Kasbon sendiri tidak bisa Anda setujui. | Pengaju adalah Anda | Minta atasan; kasbon Anda diajukan lewat HR |
| Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya. | Depot pengaju di luar cakupan | Teruskan ke pihak berwenang |
| Kasbon ini diputuskan oleh asisten supervisor depotnya. | Anda bukan Asisten SPV depot itu | Teruskan ke Asisten SPV yang benar |
| Pengajuan ini sudah diputuskan. | Status bukan "Menunggu keputusan" | Muat ulang |
| Cicilan per bulan harus bilangan bulat lebih dari 0 | Cicilan tidak valid | Perbaiki |
| Bulan mulai potong harus format YYYY-MM | Format salah | Gunakan contoh 2026-11 |
| (503, layanan depot tidak terjangkau) | Pemeriksaan penugasan gagal; sistem menolak demi aman | Coba lagi nanti; lapor Admin bila berulang |

**Izin & batasan:**
- Hanya Asisten SPV depot itu (dan HR/Admin bila depot tanpa asisten) yang boleh memutuskan **[V]**.
- Tidak boleh memutuskan kasbon sendiri **[V]**.
- Salinan layar yang lama ditolak sistem demi mencegah tabrakan (muat ulang).
- Karyawan hanya dapat memiliki satu pengajuan terbuka pada satu waktu **[V]**.

**Daftar periksa:**
- [ ] Saya membuka pengajuan dari depot saya
- [ ] Cicilan dan bulan mulai potong terisi dan masuk akal
- [ ] Alasan penolakan tertulis jelas
- [ ] Nominal sesuai kebijakan perusahaan **[K]**

> **[SCREENSHOT REQUIRED: SS-asisten-supervisor-03 — "Antrean Kasbon" dengan satu pengajuan "Menunggu keputusan": kolom Cicilan per bulan (Rp), Mulai potong (YYYY-MM), Catatan, dan tombol Setujui/Tolak]**
> *Gambar 6.3 — Memutuskan kasbon.*

> **[SCREENSHOT REQUIRED: SS-asisten-supervisor-04 — Toast "Kasbon disetujui." atau "Kasbon ditolak." setelah keputusan]**
> *Gambar 6.4 — Hasil keputusan kasbon.*

---

### Prosedur: Mengeskalasi kasbon bila depot tanpa Asisten SPV

**Tujuan:** Memastikan kasbon tetap terjawab bila depot tidak punya Asisten SPV.
**Peran:** Asisten SPV (sebagai pelapor), Manajer atau HR (pemutus).
**Prasyarat:** Karyawan melapor kasbonnya macet, atau Anda menemukan depot tanpa Asisten SPV.
**Titik awal:** Tidak ada layar khusus. Eskalasi dilakukan lewat komunikasi ke Manajer atau HR **[D]**.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Konfirmasi dengan Admin/HR apakah depot punya Asisten SPV di `/hq/hierarchy` | Dari Admin: depot "Belum ditugaskan" berarti tanpa asisten |
| 2 | Bila tanpa asisten, sampaikan ke Manajer yang punya hak langsung atas depot, atau ke HR | Manajer atau HR memutuskan di antrean kasbon yang sama |
| 3 | Minta Admin menetapkan Asisten SPV bagi depot | Setelah ±60 detik, depot masuk cakupan Asisten SPV |

**Hasil akhir:** Kasbon diputuskan oleh pihak berwenang atau depot diberi Asisten SPV.
**Masalah umum:** Bila Manajer yang tidak berhak mencoba memutuskan kasbon di depot yang punya Asisten SPV, ia mendapat "Kasbon ini diputuskan oleh asisten supervisor depotnya." Itu perilaku sengaja, bukan galat **[V]**.
**Izin & batasan:** Anda tidak dapat memutuskan kasbon depot yang tidak ada dalam cakupan Anda. Hanya Admin yang dapat menetapkan Asisten SPV **[V]**; staf import tidak dapat membuat peran Asisten SPV **[D]**.
**Daftar periksa:**
- [ ] Saya sudah memberi tahu Manajer/HR dan Admin

---

### Prosedur: Pengawasan harian depot binaan

**Tujuan:** Memastikan depot berjalan baik dan menangkap masalah dini.
**Peran:** Asisten SPV.
**Titik awal:** "Operasi" (`/dashboard`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka "Operasi"; baca Pendapatan, SLA tepat waktu, Rata-rata antar, Terlewat / gagal | Ringkasan 30 hari seluruh depot binaan |
| 2 | Pilih satu depot di pemilih depot untuk pemeriksaan rinci | Konteks depot berubah |
| 3 | Buka "Antrean pesanan"; cari pesanan lama tertahan | Daftar pesanan dalam cakupan |
| 4 | Buka "Live tracking"; periksa pengiriman berjalan | Posisi dan status |
| 5 | Buka "Inventori"; cari stok menipis | Baris stok; aksi diganti "Hanya lihat" |
| 6 | Buka "Retur galon" dan "Meteran air" | Data baca saja |
| 7 | Buka "Perkiraan" | Prakiraan kebutuhan |
| 8 | Buka "Jadwal shift" | Susunan staf hari itu |
| 9 | Catat temuan dan laporkan ke Kepala depot atau SPV | |

**Hasil akhir:** Ada daftar temuan harian.
**Izin & batasan:**
- Inventori, retur galon, meteran, jadwal shift: **hanya melihat**. Perubahan dilakukan Kepala depot atau Manajer **[V]**.
- Anda **tidak** mendapat "Notifikasi ops" (peringatan stok menipis dan insiden kurir). Pantau stok dan insiden secara manual atau minta SPV/Kepala depot meneruskan **[V]**.
- Anda tidak memiliki menu "Insiden"; insiden dicatat Kepala depot, SPV, atau Manajer **[V]**.

**Daftar periksa:**
- [ ] Landing dibaca sebagai gabungan semua depot
- [ ] Setiap depot diperiksa satu per satu bila ada anomali
- [ ] Temuan dilaporkan ke SPV atau Kepala depot

> **[SCREENSHOT REQUIRED: SS-asisten-supervisor-05 — "Inventori" Asisten SPV dengan teks "Hanya lihat" pada baris stok]**
> *Gambar 6.5 — Inventori baca saja.*

---

### Prosedur: Menindak pengiriman bermasalah

**Tujuan:** Menarik atau membatalkan pengiriman macet, atau menugaskan ulang kurir.
**Peran:** Asisten SPV (juga SPV, Manajer, Kepala depot).
**Prasyarat:** Pesanan atau pengiriman bermasalah ditemukan.
**Titik awal:** "Live tracking" atau "Antrean pesanan".

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka "Live tracking" dan pilih pengiriman | Rincian pengiriman |
| 2 | Tekan "Tarik ke antrean" atau "Batalkan pengiriman" | Kotak alasan ("Alasan menarik pengiriman ini dari kurir?" atau "Alasan membatalkan pengiriman ini?") |
| 3 | Tulis alasan dan konfirmasi | Pengiriman ditarik atau dibatalkan |
| 4 | Di "Antrean pesanan", buka pesanan berstatus menyiapkan dan tugaskan kurir lain | Pengiriman baru dibuat |

**Hasil akhir:** Pengiriman kembali bergerak atau dibatalkan dengan alasan tercatat.
**Izin & batasan:** Aksi ini mengubah data nyata **[V]**. Hubungi Kepala depot terlebih dahulu. Anda tidak dapat mengonfirmasi pembayaran atau mengajukan refund **[V]**.
**Daftar periksa:**
- [ ] Alasan jelas dan dapat diaudit
- [ ] Kepala depot diberi tahu

---

### Prosedur: HRIS mandiri ("Absen saya")

**Tujuan:** Absen wajah, melihat slip gaji, mengajukan cuti.
**Peran:** Asisten SPV.
**Titik awal:** "Tim & jadwal" > "Absen saya" (`/hr/me`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka "Absen saya" | Halaman layanan mandiri |
| 2 | Lakukan absen wajah dan lokasi | Absen tercatat |
| 3 | Ajukan cuti bila perlu | Pengajuan menunggu tahap 1 (Manajer), lalu tahap 2 (HR) |

**Izin & batasan:**
- Absen di luar semua depot dalam cakupan ditahan "Menunggu persetujuan" sampai HR memutuskan **[V]**.
- Absen offline yang terlalu lama ditolak: "Absen offline sudah terlalu lama. Minta entri manual ke HR." **[V]**
- **Kasbon pribadi tidak dapat diajukan sendiri.** Akun tanpa satu depot ditolak: "Kasbon diputuskan oleh asisten supervisor depot, dan akun ini tidak terikat pada satu depot. Ajukan lewat HR." **[V]**

**Daftar periksa:**
- [ ] Absen dilakukan di dalam jangkauan depot
- [ ] Kasbon pribadi diajukan lewat HR

> **[SCREENSHOT REQUIRED: SS-asisten-supervisor-06 — Halaman "Absen saya" Asisten SPV]**
> *Gambar 6.6 — HRIS mandiri.*

## 8. Kolom wajib dan aturan validasi (ringkasan)

| Formulir | Kolom wajib | Aturan |
|---|---|---|
| Setujui kasbon | Cicilan per bulan (Rp), Mulai potong (YYYY-MM) | Cicilan bilangan bulat > 0; format tahun-bulan |
| Tolak kasbon | Catatan (alasan) | Maks. 300 karakter |
| Tarik / batalkan pengiriman | Alasan | Teks bebas |
| Cuti sendiri | Tanggal mulai, selesai, alasan | Tanggal selesai tidak sebelum mulai; rentang harus memuat hari kerja; tidak bentrok; kuota cukup (cuti tahunan dan izin mengurangi kuota) |

## 9. Kesalahan umum dan solusi

| Gejala atau pesan | Arti | Solusi |
|---|---|---|
| Tidak menemukan menu antrean kasbon | Tidak ada tautan dari rel; hanya lewat `/hr/loans` atau notifikasi | Lihat bagian 6.4 |
| Antrean kasbon kosong | Tidak ada pengajuan, atau depot di luar cakupan | Periksa cakupan dengan Admin |
| Kasbon ini diputuskan oleh asisten supervisor depotnya. | Anda bukan Asisten SPV depot pengaju | Teruskan ke Asisten SPV yang benar |
| Kasbon sendiri tidak bisa Anda setujui. | Pengaju adalah Anda | Minta atasan melalui HR |
| Menu "Performa tim" galat | Server menolak peran Anda **[B]** | Minta data ke Manajer |
| Tidak ada "Notifikasi ops" / "Insiden" | Bukan hak Asisten SPV | Minta SPV atau Kepala depot |
| "You do not have permission to perform this action." | Di luar hak (arti: Anda tidak punya izin melakukan tindakan ini) | Berhenti; hubungi SPV |
| Tombol "Konfirmasi lunas" tidak ada | Bukan hak Anda | Kepala depot, Manajer, atau Finance |

## 10. Batasan peran (apa yang TIDAK boleh)

| Larangan | Alasan | Alternatif |
|---|---|---|
| Memutuskan kasbon sendiri | Dilarang sistem | Minta HR/atasan |
| Memutuskan kasbon depot yang bukan binaan Anda | Hanya Asisten SPV depot itu | Teruskan |
| Menyetujui cuti | Bukan tahap Anda; hanya Manajer/HR | Lihat antrean cuti saja |
| Mengajukan pinjam karyawan | Hanya Manajer dan SPV | Minta SPV |
| Mencatat insiden atau menyelesaikan sengketa | Tidak ada kemampuan | Minta SPV/Kepala depot/Manajer |
| Mengatur target, buku kas | Tidak ada kemampuan | Minta SPV/Manajer |
| Konfirmasi lunas, refund | Bukan hak | Kepala depot/Manajer/Finance |
| Mengubah stok, harga, produk, promo, voucher | Bukan hak | Kepala depot/Manajer |
| Mengubah hierarki atau hak akses | Hanya Admin | Admin |
| Membagikan akun atau OTP | Melanggar keamanan | — |

## 11. Pertimbangan keamanan

- Keputusan kasbon adalah keputusan uang. Pastikan identitas pengaju dan alasan wajar sebelum menyetujui. Tidak ada batas nominal di sistem **[K]**.
- Jangan menyetujui kasbon atas tekanan dari pihak lain tanpa alasan tertulis. Alasan penolakan dan catatan tersimpan.
- Jangan membagikan akun atau kode OTP. Setiap keputusan tercatat atas nama Anda.
- Data pribadi karyawan (alasan kasbon, gaji) bersifat rahasia; jangan dikirim lewat percakapan umum.
- Keluar dari akun setelah memakai perangkat bersama.
- Laporkan segera ke Admin bila menu atau hak Anda tampak berubah dari bab ini.

## 12. Kegiatan akhir hari dan berkala

| Kapan | Kegiatan |
|---|---|
| Awal hari | Cek "Operasi", notifikasi pengajuan kasbon, pengiriman macet |
| Siang hari | Pantau "Live tracking", "Antrean pesanan", "Jadwal shift" |
| Akhir hari | Putuskan semua kasbon yang bisa diputuskan; laporkan temuan ke SPV |
| Mingguan | Periksa stok dan retur galon tiap depot; bandingkan SLA |
| Bulanan | Baca "Laporan L/R" tiap depot; pastikan tiap depot masih punya penugasan Asisten SPV yang benar |

## 13. Skenario praktis

**Skenario 1 — Kasbon masuk.** Anda menerima notifikasi pengajuan kasbon. Buka antrean, baca alasan, setujui dengan cicilan misalnya Rp200.000 per bulan mulai 2026-11 (contoh sintetis), atau tolak dengan alasan. Karyawan diberi tahu.

**Skenario 2 — Anda ditolak "Kasbon ini diputuskan oleh asisten supervisor depotnya."** Anda bukan Asisten SPV depot itu. Teruskan ke Asisten SPV yang tercatat.

**Skenario 3 — Depot baru tanpa Asisten SPV.** Kasbon karyawan depot itu tidak sampai ke siapa pun. Laporkan ke Admin untuk menugaskan Asisten SPV, atau minta Manajer/HR memutuskan sementara.

**Skenario 4 — Pesanan terlambat.** Landing menunjukkan "Terlewat / gagal" naik. Telusuri di "Antrean pesanan" dan "Live tracking". Bila kurir macet, "Tarik ke antrean" dengan alasan; bila perlu minta Kepala depot menugaskan kurir lain.

**Skenario 5 — Anda ingin mengajukan kasbon pribadi.** Sistem menolak karena akun tidak terikat satu depot. Hubungi HR.

**Skenario 6 — Ada insiden di depot.** Anda tidak punya menu "Insiden". Minta Kepala depot, SPV, atau Manajer mencatatnya.

## 14. Daftar periksa penyelesaian

- [ ] Saya tahu depot mana yang menjadi binaan saya
- [ ] Saya bisa membuka antrean kasbon dan memutuskannya
- [ ] Saya tahu eskalasi bila depot tanpa Asisten SPV
- [ ] Saya paham perbedaan hak Asisten SPV, SPV, dan Manajer
- [ ] Saya paham yang tidak boleh saya lakukan
- [ ] Saya tahu kasbon pribadi lewat HR

## 15. Inventaris screenshot bab ini

| ID | Layar | Kondisi | Status |
|---|---|---|---|
| SS-asisten-supervisor-01 | Menu kiri dan pemilih depot | "Peran: Asisten SPV" | Belum diambil |
| SS-asisten-supervisor-02 | Landing "Operasi" dan menu | Tanpa Insiden/Sengketa/Buku kas/Target | Belum diambil |
| SS-asisten-supervisor-03 | Antrean Kasbon | Satu pengajuan menunggu keputusan | Belum diambil |
| SS-asisten-supervisor-04 | Toast hasil keputusan | "Kasbon disetujui." / "Kasbon ditolak." | Belum diambil |
| SS-asisten-supervisor-05 | Inventori baca saja | "Hanya lihat" | Belum diambil |
| SS-asisten-supervisor-06 | Absen saya | Hari berjalan | Belum diambil |

## 16. Catatan celah dan hal yang perlu dikonfirmasi

Rujuk ke `17-open-questions`.

| No | Celah | Tag |
|---|---|---|
| A1 | Tidak ada tautan menu dari rel Asisten SPV ke antrean kasbon; hanya notifikasi atau alamat langsung | [D] |
| A2 | Tujuan ketukan notifikasi `LOAN_REQUEST_SUBMITTED` di aplikasi belum diverifikasi | [D] |
| A3 | Tidak ada batas nominal kasbon | [K] |
| A4 | Mekanisme eskalasi (siapa menghubungi siapa) bila depot tanpa Asisten SPV belum didokumentasikan secara resmi | [K] |
| A5 | Menu "Performa tim" tampil namun ditolak server | [B] |
| A6 | Komentar RBAC "tanpa tulis" bertentangan dengan `orderFulfilment` dan `tracking` | [B] |
| A7 | Asisten SPV tanpa "Notifikasi ops" sehingga stok menipis tidak diberi tahu otomatis | [K] |
| A8 | Cara staf mendapat peran dan penempatan Asisten SPV selain `/hq/hierarchy` (hanya Admin) | [K] |
| A9 | Tidak ada batas waktu (SLA) keputusan kasbon yang ditetapkan | [K] |

> Catatan penomoran: bab ini memiliki 16 bagian karena bagian 5 (tabel perbandingan) ditambahkan di antara bagian "Prasyarat/Masuk" dan "Menu". Urutan wajib struktur bab peran tetap terpenuhi.
