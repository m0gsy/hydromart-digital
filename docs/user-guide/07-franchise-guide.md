# Bab 7 — Panduan Waralaba (Pemilik Waralaba)

| Metadata | Nilai |
|---|---|
| Versi | 0.1 draf |
| Tanggal | 2026-10-10 |
| Klasifikasi | Internal — Terbatas |
| Peran utama | Waralaba (kode: `FRANCHISE_OWNER`, label di UI: "Pemilik waralaba") |
| Peran terkait | Kantor pusat (HQ: `HEAD_OFFICE`, `DIREKTUR`, `FINANCE`), Admin (`SUPER_ADMIN`), Manajer (`MANAGER`) |

**Legenda tag bukti.** **[V]** terverifikasi di kode · **[D]** disimpulkan, perlu konfirmasi · **[K]** perlu konfirmasi bisnis (nilai berasal dari data/pengaturan) · **[B]** diketahui bermasalah/tidak konsisten. Fitur yang tidak ada ditulis "Tidak tersedia".

> **Penting.** Dokumen ini ditulis dari pembacaan kode dan dokumen proyek. Belum ada pengujian yang dijalankan oleh penulis dokumen ini. Hak akses yang disebut adalah nilai **bawaan** dari `packages/access/src/index.ts`. Admin (`SUPER_ADMIN`) dapat mengubahnya saat aplikasi berjalan (berlaku sekitar 30 detik setelah disimpan). Jika perilaku di lapangan berbeda dari bab ini, tanyakan ke Admin untuk melihat matriks hak akses terbaru.

---

## 1. Gambaran peran

Pemilik waralaba adalah mitra usaha yang memiliki satu atau lebih depot Hydromart berstatus **Waralaba**. Pemilik **bukan** petugas operasional depot. Pemilik tidak melayani pesanan, tidak mengatur stok, dan tidak mengelola karyawan. Pemilik memantau hasil usaha dan mencairkan saldo hasil penjualan.

Ringkasnya:

- Pemilik **melamar** lewat halaman publik `/waralaba` (tanpa login).
- Kantor pusat (HQ) **meninjau** lamaran, lalu **membuat akun pemilik** dan **mendaftarkan depot** dengan pemilik tersebut.
- Pemilik masuk ke **konsol pemilik** (menu "Waralabaku", "Payout & komisi", dan lainnya) dan memantau depotnya.
- Setiap pesanan selesai di depot waralaba menambah saldo pemilik, dikurangi komisi HQ. Pemilik mencairkan saldo ke rekening bank yang sudah diverifikasi HQ.

Kata kunci yang dipakai di bab ini:

| Istilah | Arti |
|---|---|
| Waralaba | Depot milik mitra. Di sistem: jenis kepemilikan `WARALABA`. |
| Milik pusat (HKP) | Depot milik perusahaan. Tidak punya pemilik dan tidak punya payout. **[V]** |
| Saldo tersedia | Jumlah bersih semua catatan buku kas pemilik sejak awal. **[V]** |
| Komisi HQ | Potongan persentase dari penjualan yang menjadi bagian kantor pusat. **[V]** |
| Pencairan (withdrawal) | Permintaan memindahkan saldo ke rekening bank pemilik. **[V]** |
| `Depot.ownerId` | Penghubung antara depot dan akun pemilik. Dasar semua pembatasan akses. **[V]** |

## 2. Tujuan & tanggung jawab

Tujuan pemilik waralaba di Hydromart:

1. Mengajukan kemitraan dengan data calon depot yang benar.
2. Memantau pendapatan, stok kritis, ketepatan pengiriman, SDM, dan pelanggan di depot miliknya.
3. Mendaftarkan rekening tujuan pencairan dan menunggu verifikasi HQ.
4. Mengajukan pencairan saldo bila perlu.
5. Memastikan depot miliknya dijalankan oleh Kepala depot dan staf yang ditugaskan HQ.

Tanggung jawab yang **tidak** dipegang pemilik lewat aplikasi: menyetujui apa pun, mengubah harga, mengelola staf, memasukkan stok, memproses pesanan. Lihat Bagian 9.

## 3. Prasyarat akses

| Prasyarat | Penjelasan | Bukti |
|---|---|---|
| Lamaran disetujui HQ | Tanpa lamaran yang disetujui, tidak ada akun pemilik. | **[V]** |
| Akun pemilik dibuat HQ | HQ membuat akun lewat "＋ Undang staf" dengan peran "Pemilik waralaba". Nomor masuk = nomor telepon undangan. | **[V]** |
| Depot didaftarkan dengan pemilik | HQ mengisi kolom "Pemilik waralaba" saat "Onboard depot". Tanpa ini, depot waralaba tidak bisa dibuat. | **[V]** |
| Nomor ponsel aktif | Masuk memakai kode OTP yang dikirim ke nomor telepon. | **[V]** (lihat Bab Umum) |
| Perangkat | Peramban web di komputer atau ponsel. Di layar kecil muncul bilah navigasi bawah. | **[V]** |

> **Catatan hak akses.** Nilai bawaan dari `packages/access/src/index.ts`. Admin dapat mengubahnya saat berjalan (sekitar 30 detik). Rincian kemampuan pemilik: `returnsRead`, `franchise`, `payout`, `forecast`, `depotDirectory`, `ownNotifPrefs`. Pemilik **tidak** punya `dashboard`, `orderQueue`, `inventoryRead`, `depotFinance`, `reports`, `audit`. **[V]**

## 4. Masuk & pengaturan awal

### 4.1 Alur dari pendaftaran sampai bisa masuk

```
Calon mitra isi /waralaba  ->  HQ tinjau di "Lamaran waralaba"  ->  HQ setujui
   ->  HQ undang akun "Pemilik waralaba"  ->  HQ "Onboard depot" (isi pemilik)
   ->  Pemilik masuk (OTP)  ->  otomatis ke "Waralabaku"
```

Persetujuan lamaran **tidak** membuat akun dan **tidak** membuat depot secara otomatis. Dua langkah itu dilakukan HQ secara terpisah. **[V]**

### 4.2 Masuk pertama kali

1. Buka halaman masuk Hydromart.
2. Masukkan nomor telepon yang didaftarkan HQ.
3. Masukkan kode OTP yang dikirim ke nomor itu.
4. Sistem membawa Anda ke `/dashboard`, lalu otomatis mengalihkan ke `/dashboard/franchise` ("Waralabaku"). **[V]**

Jika muncul pesan akun tidak dikenal atau ditangguhkan, hubungi HQ. Peran Anda tidak mengubah apa pun di sisi pemilik.

### 4.3 Pengaturan awal yang disarankan

| Urutan | Tindakan | Tempat |
|---|---|---|
| 1 | Pastikan Anda masuk ke "Waralabaku" dan depot Anda tampil di kartu "Depot". | Menu "Waralabaku" |
| 2 | Daftarkan rekening tujuan pencairan. | "Payout & komisi" > "Rekening tujuan pencairan" |
| 3 | Beri tahu HQ bahwa rekening sudah didaftarkan agar diverifikasi. | Di luar aplikasi **[D]** |
| 4 | Atur bahasa dan alert notifikasi. | "Akun saya" |

## 5. Menu & modul tersedia

Pemilik melihat **8 item menu** di rel kiri (desktop). Daftar ini dihitung dari aturan tampil tiap menu terhadap hak akses bawaan; belum dijalankan di aplikasi. **[V/D]**

| No | Grup | Label menu | Rute | Hak akses penentu | Bukti |
|---|---|---|---|---|---|
| 1 | Ringkasan | Waralabaku | `/dashboard/franchise` | `franchise` | **[V]** |
| 2 | Ringkasan | Pencarian | `/dashboard/search` | `depotDirectory` | **[V]** |
| 3 | Operasi harian | Retur galon | `/dashboard/returns` | `returnsRead` (hanya baca) | **[V]** |
| 4 | Operasi harian | Perkiraan | `/dashboard/forecast` | `forecast` | **[V]** |
| 5 | Tim & jadwal | Jadwal shift | `/dashboard/shift` | semua staf | **[V]** |
| 6 | Keuangan · usulan | Payout & komisi | `/dashboard/payout` | `payout` | **[V]** |
| 7 | Referensi | Peran & akses | `/dashboard/roles` | semua staf | **[V]** |
| 8 | Referensi | Akun saya | `/dashboard/account` | semua staf | **[V]** |

Tidak ada pintu "Konsol HQ". Pemilik tidak bisa membuka `/hq/*`. **[V]**

**Navigasi bawah di ponsel.** Empat tab pertama: "Ringkasan" (`/dashboard/franchise`), "Antrean" (`/dashboard/orders`), "Perkiraan" (`/dashboard/forecast`), dan "Menu lainnya" yang membuka daftar menu yang sama dengan rel kiri. **[V]**

> **[B] Tab "Antrean".** Tab ini tampil untuk pemilik, tetapi hak akses `orderQueue` tidak mencakup pemilik. Layar kemungkinan kosong atau menolak. **[D]** Abaikan tab ini.

**Pengalih depot.** Di rel ada pengalih depot dengan label "Semua depot", "konteks aktif", "{n} lokasi", dan "{n} lokasi · gabungan". Server hanya mengembalikan depot yang `ownerId`-nya adalah akun Anda. **[V]**

> **[SCREENSHOT REQUIRED: SS-waralaba-01 — Rel menu kiri konsol pemilik dengan 8 item menu terlihat dan pengalih depot menampilkan jumlah lokasi milik pemilik]**
> *Gambar 7.1 — Menu konsol pemilik waralaba.*

---

## 6. Prosedur langkah demi langkah

Daftar prosedur:

| No | Prosedur | Pelaku |
|---|---|---|
| 6.1 | Mendaftar sebagai calon mitra waralaba | Calon mitra (publik) |
| 6.2 | Peninjauan lamaran oleh HQ | HQ (informasi untuk pemilik) |
| 6.3 | Undangan akun dan onboarding depot | HQ (informasi untuk pemilik) |
| 6.4 | Memantau usaha di "Waralabaku" | Pemilik |
| 6.5 | Mendaftarkan rekening tujuan pencairan | Pemilik |
| 6.6 | Mencairkan saldo ("Cairkan saldo") | Pemilik |
| 6.7 | Membaca buku kas dan komisi | Pemilik |
| 6.8 | Memakai Perkiraan, Retur galon, dan Pencarian | Pemilik |
| 6.9 | Mengatur alert di "Akun saya" | Pemilik |
| 6.10 | Alur rilis payout oleh HQ ("Ajukan rilis" dan "Setujui & rilis") | HQ (informasi untuk pemilik) |

### Prosedur 6.1: Mendaftar sebagai calon mitra waralaba

**Tujuan:** Mengirim lamaran kemitraan dengan data calon depot.
**Peran:** Calon mitra. Tidak perlu login. **[V]**
**Prasyarat:** Nomor WhatsApp aktif. Kode depot, nama depot, kota, provinsi, titik lokasi, nilai investasi, dan proyeksi omzet sudah disiapkan.
**Titik awal:** Halaman `/waralaba` ("Jadi mitra waralaba"). Halaman ini juga dibuka dari baris "Jadi mitra waralaba" di halaman `/account`. **[V]**

> **Tidak ada unggah dokumen.** Formulir publik tidak punya kolom unggah file. Dokumen seperti KTP dan NPWP tidak dikirim lewat formulir ini. Yang Anda terima hanya **nomor tanda terima**. Cara menyerahkan dokumen ke HQ **tidak tertulis di kode** dan perlu dikonfirmasi bisnis. **[V][K]**

Isi pengantar di layar: "Isi data calon depot Anda. Tim kami meninjau setiap pengajuan dan menghubungi lewat nomor yang Anda tulis."

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka `/waralaba`. | Formulir "Jadi mitra waralaba" tampil. Tidak diminta login. |
| 2 | Bagian "Data pemohon": isi "Nama lengkap" (wajib). | Jika kosong saat kirim: "Nama pemohon wajib diisi." |
| 3 | Isi "Nomor WhatsApp" (wajib). Contoh: 081234567890. | Nomor dinormalkan ke format +628…. Jika salah: "Nomor WhatsApp belum benar. Contoh: 081234567890." |
| 4 | Bagian "Calon depot": isi "Kode depot usulan" (wajib), misalnya BDG-02. | Kode dikirim dalam huruf besar tanpa spasi tepi. Kosong: "Kode depot usulan wajib diisi." |
| 5 | Isi "Nama depot" (wajib). | Kosong: "Nama depot wajib diisi." |
| 6 | Isi "Kota" dan "Provinsi" (wajib). | Kosong: "Kota wajib diisi." / "Provinsi wajib diisi." |
| 7 | Bagian "Titik lokasi": tekan "Gunakan lokasi saya" **di lokasi calon depot**, atau ketik "Lintang (latitude)" dan "Bujur (longitude)" manual. | Tombol berubah "Mengambil lokasi…". Gagal: "Lokasi tidak bisa diambil. Isi koordinat manual atau coba lagi." Kosong: "Titik lokasi wajib diisi." |
| 8 | Bagian "Rencana keuangan": isi "Nilai investasi (Rp)" dan "Proyeksi omzet per bulan (Rp)". | Harus angka 0 atau lebih. Salah: "Nilai investasi dan proyeksi omzet harus angka 0 atau lebih." |
| 9 | Centang persetujuan pemrosesan data (tidak pernah tercentang otomatis). | Tidak dicentang: "Persetujuan pemrosesan data wajib dicentang sebelum mengirim." |
| 10 | Tekan "Kirim pengajuan". | Layar "Pengajuan terkirim" dengan "Nomor tanda terima", "Kode depot usulan", "Waktu kirim". |
| 11 | **Simpan nomor tanda terima** (foto layar atau salin). | Tidak ada halaman cek status untuk pemohon. **[V]** |
| 12 | (Opsional) Tekan "Kirim pengajuan lain". | Formulir kosong kembali. |

Teks persetujuan di layar: "Saya setuju data yang saya isi di formulir ini diproses sesuai Kebijakan Privasi Hydromart. Pengajuan yang ditolak dihapus paling lama 24 bulan sejak keputusannya." **[V]**

**Aturan server tambahan** (tidak terlihat di layar sampai ditolak): nama pemohon maksimal 150 karakter; kode depot maksimal 30; nama depot maksimal 150; kota dan provinsi maksimal 100; nilai investasi dan proyeksi omzet harus **bilangan bulat** (desimal ditolak server meskipun layar hanya memeriksa angka tidak negatif). **[V]**

**Hasil akhir:** Lamaran masuk antrean HQ dengan tahap "Baru". Layar menampilkan tanda terima.

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Pengajuan gagal terkirim. Coba lagi sebentar lagi." | Kegagalan umum (jaringan atau server). | Tunggu sebentar, coba lagi. |
| "A depot with this code already exists." (bahasa Inggris dari server) | Sudah ada depot aktif dengan kode itu. | Ganti "Kode depot usulan", misalnya naikkan nomor urut. **[V]** |
| Pesan batas kirim dari server | Pengiriman dibatasi **3 kali per jam**. **[V]** | Tunggu sekitar satu jam. |
| "Nomor WhatsApp belum benar. Contoh: 081234567890." | Format nomor tidak cocok pola +628 diikuti 7–11 angka. | Tulis ulang tanpa spasi atau tanda. |

**Izin & batasan:** Dua lamaran boleh mengusulkan kode yang sama selama belum ada depot hidup berkode itu. **[V]**

**Daftar periksa:**
- [ ] Nomor WhatsApp benar dan aktif.
- [ ] Titik lokasi diambil di lokasi calon depot.
- [ ] Angka investasi dan omzet bulat, tanpa titik/koma desimal.
- [ ] Persetujuan data dicentang.
- [ ] Nomor tanda terima tersimpan.

> **[SCREENSHOT REQUIRED: SS-waralaba-02 — Formulir "Jadi mitra waralaba" di /waralaba terisi sebagian, tampak bagian "Data pemohon", "Calon depot", "Titik lokasi", "Rencana keuangan", kotak persetujuan, dan tombol "Kirim pengajuan"]**
> *Gambar 7.2 — Formulir pendaftaran calon mitra.*

> **[SCREENSHOT REQUIRED: SS-waralaba-03 — Layar "Pengajuan terkirim" dengan "Nomor tanda terima", "Kode depot usulan", "Waktu kirim" (data sintetis) dan tombol "Kirim pengajuan lain"]**
> *Gambar 7.3 — Tanda terima pengajuan.*

---

### Prosedur 6.2: Peninjauan lamaran oleh HQ

**Tujuan:** Memberi tahu pemilik bagaimana lamaran diproses. Prosedur ini dijalankan HQ; pemohon tidak melihat layarnya.
**Peran:** Kantor pusat (`HEAD_OFFICE`), `DIREKTUR`, `SUPER_ADMIN`. `FINANCE` tidak punya akses. **[V]**
**Prasyarat:** Lamaran sudah masuk.
**Titik awal:** Konsol HQ > "Lamaran waralaba" (`/hq/applications`).

**Tahap lamaran** (label di layar HQ): Baru → Verifikasi dokumen → Survei → Disetujui atau Ditolak. HQ boleh memindahkan tahap bebas di antara tiga tahap pertama, tidak ada urutan yang dipaksa. **[V]**

**Daftar periksa dokumen (4 butir).** Tidak ada unggah file; ini hanya centang manual oleh peninjau. **[V]**

| Butir | Label di layar |
|---|---|
| ktpNpwp | "KTP & NPWP terverifikasi" |
| locationProof | "Bukti kepemilikan lokasi" |
| capitalDeposit | "Setoran modal awal" |
| fieldSurvey | "Survei lapangan" |

Status butir: "Menunggu" → "Terverifikasi" → "Ditolak" → kembali "Menunggu" (berputar setiap klik). Lencana "Lengkap" muncul bila keempatnya terverifikasi, selain itu "Belum lengkap".

| Langkah | Tindakan HQ | Respons sistem |
|---|---|---|
| 1 | Buka "Lamaran waralaba". | Antrean "Antrean persetujuan mitra baru · terlama dulu". Tiap baris: nama pemohon, lencana tahap, usia ("{n} hari", merah bila 5 hari atau lebih), nama usulan, "kota · telepon", tombol "Tinjau". |
| 2 | Tekan "Tinjau". | Detail: "Usulan depot", "Kontak", "Investasi", "Proyeksi omzet/bln", "Kelengkapan dokumen". |
| 3 | Hubungi pemohon lewat WhatsApp dan kumpulkan dokumen di luar aplikasi. | Di luar sistem. **[D]** |
| 4 | Klik tiap butir daftar periksa sesuai hasil verifikasi. | Status butir berubah. |
| 5 | Pilih "Ubah tahap": "Baru", "Verifikasi dokumen", atau "Survei". | Tahap berubah. |
| 6 | Putuskan: "Setujui & provision" atau "Tolak". | Tahap menjadi "Disetujui" atau "Ditolak". Setelah itu lamaran terkunci. |

Catatan penting bagi pemohon:

- Persetujuan **tidak diblokir** walau daftar periksa belum lengkap. Lencana "Lengkap" hanya penanda. **[V]**
- Penolakan **tidak punya kolom alasan**. **[V]**
- Tidak ada notifikasi otomatis ke pemohon pada kode yang dibaca. Pemohon dihubungi manual lewat WhatsApp. **[V][K]**
- Lamaran yang sudah diputuskan: server menjawab 409 "This application has already been approved or rejected." (bahasa Inggris; artinya "Lamaran ini sudah disetujui atau ditolak."). **[V]**
- Lamaran ditolak dihapus berkala oleh sistem; teks persetujuan menyebut paling lama 24 bulan sejak keputusan. **[V]**

**Hasil akhir:** Lamaran berstatus "Disetujui" atau "Ditolak".

---

### Prosedur 6.3: Undangan akun dan onboarding depot

**Tujuan:** Menjadikan pemohon yang disetujui sebagai pemilik yang bisa masuk dan memiliki depot.
**Peran:** HQ. Undang staf: `HEAD_OFFICE`, `SUPER_ADMIN`. Buat/ubah depot: `MANAGER`, `SUPER_ADMIN`. **[V]**
**Titik awal:** Setelah "Setujui & provision" di detail lamaran, atau langsung dari "Direktori staf" dan "Depot".

Tahapan nyata (tidak ada otomatisasi yang menghubungkannya):

| Langkah | Tindakan HQ | Respons sistem |
|---|---|---|
| 1 | Di detail lamaran, tekan "Setujui & provision". | Hanya tahap berubah ke "Disetujui". Toast: "Lamaran {nama} disetujui — lanjut provision depot". Browser membuka `/hq/depots?onboard=1` dengan data usulan terisi (kode, nama, jenis Waralaba, kota, provinsi, lintang, bujur). |
| 2 | Buat akun pemilik: menu "Direktori staf" > "＋ Undang staf". Pilih peran "Pemilik waralaba". Isi nomor telepon dan nama. | Akun langsung aktif. Untuk peran ini, posisi/gaji tidak diminta dan tidak dibuat data karyawan. Nomor masuk = nomor undangan. **[V]** |
| 3 | Buka "Onboard depot". Isi Kode, Nama depot, Kepemilikan = "Waralaba", **"Pemilik waralaba"** (pilih akun tadi), Alamat, Kota, Provinsi, Latitude, Longitude, Radius km, Ongkir, Min order, dan data "Pembayaran ke depot". | Tombol "Buat depot". Gagal: "Gagal menyimpan depot." |
| 4 | Pantau kelengkapan di "Onboarding depot". | Daftar langkah dengan progres "{done}/{total} langkah selesai". |

**Peringatan bagi HQ:**

- Nama dan telepon pemohon **tidak** ikut terbawa ke formulir depot. Akun pemilik harus dibuat manual. **[V]**
- Data usulan tersimpan hanya di tab peramban (sessionStorage). Jika HQ berpindah halaman, data hilang dan harus diketik ulang. **[D]**
- Depot jenis Waralaba tanpa pemilik ditolak: 400 "A franchise (WARALABA) depot must have an owner." (artinya "Depot waralaba harus punya pemilik."). Berlaku saat membuat dan mengubah (pemilik tidak bisa dikosongkan). **[V]**
- Bila daftar pemilik kosong, formulir menampilkan: "Belum ada akun Pemilik waralaba. Buat dulu di Direktori staf." **[V]**
- Tombol buat/ubah/tangguhkan depot di layar HQ tidak dibatasi per peran, tetapi server hanya menerima `MANAGER` dan `SUPER_ADMIN`. `HEAD_OFFICE` dan `DIREKTUR` akan melihat penolakan server. **[V][D]**

Langkah onboarding yang dihitung otomatis dari data (tidak disimpan terpisah): "Verifikasi dokumen legal", "Survei lokasi & radius layanan", "Provision depot di sistem" (ketiganya selesai otomatis setelah depot ada), "Isi jam operasional", "Tetapkan pemilik waralaba" (khusus waralaba; selesai bila pemilik terisi), "Isi stok awal & harga", "Onboarding staf & kurir", "Aktifkan kanal pembayaran". Status baris: "Selesai" atau "Menunggu"; tombol "Buka". **[V]**

**Hasil akhir:** Pemilik dapat masuk dan melihat depotnya di "Waralabaku". Kepala depot, staf, dan kurir untuk depot itu adalah akun terpisah yang ditugaskan HQ; pemilik tidak mengelolanya. **[V][D]**

> **[SCREENSHOT REQUIRED: SS-waralaba-04 — Formulir "Onboard depot" dengan Kepemilikan "Waralaba" dan pilihan "Pemilik waralaba" terbuka (tampilan HQ, data sintetis)]**
> *Gambar 7.4 — Penghubung depot dan pemilik pada onboarding.*

---

### Prosedur 6.4: Memantau usaha di "Waralabaku"

**Tujuan:** Melihat ringkasan 30 hari terakhir seluruh depot milik Anda.
**Peran:** Pemilik waralaba.
**Prasyarat:** Depot sudah didaftarkan HQ atas nama Anda.
**Titik awal:** Menu "Waralabaku" (`/dashboard/franchise`). Ini juga halaman pertama setelah masuk.

Judul "Waralabaku"; subjudul "30 hari terakhir di seluruh depot yang kamu miliki." Rentang tetap 30 hari, tidak ada pemilih tanggal. **[V]**

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Buka "Waralabaku". | Empat kartu angka tampil. |
| 2 | Baca kartu "Pendapatan" (total Rp, petunjuk "{n} pesanan"). | Pendapatan semua depot milik Anda. |
| 3 | Baca "Depot" (jumlah), "Stok kritis" ("baris di bawah minimum" atau "stok aman"), "SLA tepat waktu" (persen atau "—", petunjuk "{onTime}/{total} terkirim"). | |
| 4 | Baca kartu "SDM hari ini": "Terlambat", "Tidak hadir", "Karyawan aktif", "Gaji bulan ini". | "Gaji bulan ini" = gaji bersih berjalan bulan ini. Kartu disembunyikan bila sumber data tidak tersedia. |
| 5 | Baca kartu "CRM pelanggan": "Aktif", "Baru", "Tidak aktif", "Perlu follow-up", petunjuk "Repeat rate {pct}%". | |
| 6 | Baca kartu "Depot": per depot tampil nama, kode, penanda "nonaktif", "{n} pesanan", "{n} kritis", pendapatan. | Kosong: "Belum ada depot yang ditugaskan padamu." atau "Direktori depot tidak tersedia." |

Bila sebagian sumber data gagal dimuat, muncul: "Sebagian data gagal dimuat ({which}). Menampilkan yang tersedia." ({which} dapat berisi depot, order, delivery, inventory, hr, crm). Depot tanpa pesanan terbaca 0. Pemilik tanpa depot: SLA kosong. **[V]**

Jika Anda bukan pemilik: "Khusus pemilik waralaba" / "Dashboard ini tersedia untuk pemilik waralaba."

**Hasil akhir:** Anda tahu kondisi usaha 30 hari terakhir.
**Masalah umum:** angka 0 di depot baru = belum ada pesanan selesai; "nonaktif" = depot ditangguhkan HQ.

> **[SCREENSHOT REQUIRED: SS-waralaba-05 — Halaman "Waralabaku" dengan empat kartu angka, kartu "SDM hari ini", "CRM pelanggan", dan daftar "Depot" (data sintetis)]**
> *Gambar 7.5 — Ringkasan Waralabaku.*

---

### Prosedur 6.5: Mendaftarkan rekening tujuan pencairan

**Tujuan:** Mendaftarkan rekening bank yang akan menerima pencairan.
**Peran:** Pemilik waralaba.
**Prasyarat:** Sudah masuk. Rekening atas nama yang jelas (nama pemilik rekening).
**Titik awal:** "Payout & komisi" (`/dashboard/payout`) > kartu "Rekening tujuan pencairan".

Petunjuk di layar: "Saldo hanya bisa dicairkan ke rekening yang sudah diverifikasi kantor pusat." Satu orang hanya punya **satu** rekening. **[V]**

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Buka "Payout & komisi". Gulir ke "Rekening tujuan pencairan". | Bila belum ada: "Belum ada rekening terdaftar." |
| 2 | Isi "Nama bank" (wajib, 2–60 karakter). | |
| 3 | Isi "Nomor rekening" (wajib; hanya angka, spasi, atau tanda hubung; 6–30 karakter). | |
| 4 | Isi "Nama pemilik rekening" (wajib, 2–120 karakter). | Tombol "Daftarkan rekening" aktif bila semua valid. |
| 5 | Periksa ulang nomor dan nama. | |
| 6 | Tekan "Daftarkan rekening". | Toast "Rekening dikirim untuk verifikasi". Status: "Menunggu verifikasi kantor pusat". |
| 7 | Tunggu HQ. | Status berubah "Terverifikasi" atau "Ditolak: {alasan}". |

Status rekening:

| Status di layar | Arti | Tindakan pemilik |
|---|---|---|
| Menunggu verifikasi kantor pusat | HQ belum memutuskan. | Tunggu. Pencairan belum bisa. |
| Terverifikasi | Boleh dipakai untuk pencairan. | Lanjut ke Prosedur 6.6. |
| Ditolak: {alasan} | HQ menolak. | Daftarkan ulang dengan data yang benar. |

- Layar HQ **tidak** mengirim alasan penolakan, sehingga pemilik akan melihat "Ditolak: tanpa alasan". Hubungi HQ untuk tahu penyebabnya. **[V][B]**
- Tombol "Ganti rekening" mengembalikan status ke menunggu verifikasi, dan verifikasi lama hilang. Jangan mengganti rekening sebelum pencairan yang sedang diproses selesai. **[V][D]**
- Jika data rekening berubah di tab lain, simpan ditolak (konflik 409). Muat ulang halaman. **[V]**

**Hasil akhir:** Rekening terdaftar, menunggu verifikasi HQ.
**Izin & batasan:** Hanya HQ (`FINANCE`, `SUPER_ADMIN`) yang bisa memverifikasi atau menolak. **[V]**

**Daftar periksa:**
- [ ] Nama pemilik rekening sesuai buku tabungan.
- [ ] Nomor rekening dicek dua kali.
- [ ] HQ diberi tahu agar memverifikasi.

> **[SCREENSHOT REQUIRED: SS-waralaba-06 — Kartu "Rekening tujuan pencairan" dengan status "Menunggu verifikasi kantor pusat" (data rekening sintetis)]**
> *Gambar 7.6 — Rekening menunggu verifikasi.*

---

### Prosedur 6.6: Mencairkan saldo ("Cairkan saldo")

**Tujuan:** Memindahkan saldo ke rekening terverifikasi.
**Peran:** Pemilik waralaba (`payout` hanya untuk pemilik; data terikat ke akun yang masuk). **[V]**
**Prasyarat:** Saldo tersedia lebih dari 0 dan rekening berstatus "Terverifikasi".
**Titik awal:** "Payout & komisi" > kartu gradien "Saldo tersedia".

**Aturan utama:**

| Aturan | Isi | Bukti |
|---|---|---|
| Minimum pencairan | **Tidak ada** minimum yang ditemukan. Jumlah harus bilangan bulat rupiah lebih dari 0 dan tidak melebihi saldo. | **[V]** |
| Biaya pencairan | **Tidak ada** biaya yang ditemukan di layanan payout. | **[V]** |
| Batas harian | Tidak ditemukan. | **[V]** |
| Tujuan | Selalu rekening terverifikasi; tidak dikirim dari layar. Ditampilkan tersamar "BANK ···· 1234". | **[V]** |
| Saat diminta | Saldo **langsung berkurang** dan status menjadi PROCESSING. | **[V]** |
| Persetujuan sebelum dipotong | Tidak ada persetujuan HQ sebelum saldo dipotong. | **[V]** |

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Buka "Payout & komisi". Pastikan kartu rekening menampilkan "Terverifikasi". | Chip status rekening pada kartu "Saldo tersedia". |
| 2 | Isi "Jumlah pencairan (IDR)" (angka). Atau tekan Rp 2.000.000, Rp 5.000.000 (hanya muncul bila tidak melebihi saldo), atau "Semua". | Kolom terisi. Kolom kosong menampilkan saldo penuh sebagai petunjuk. |
| 3 | Periksa jumlah dan rekening tujuan. | |
| 4 | Tekan "Cairkan saldo". | Tombol nonaktif bila saldo 0 atau rekening belum terverifikasi. |
| 5 | Baca layar hasil. | "Pencairan diproses", "Rp X dikirim ke {BANK ···· 1234}.", "Ref" = nomor `WD-YYYYMMDD-NNNN`, "Status" = "Diproses". |
| 6 | Catat nomor "Ref". | Berguna bila perlu menghubungi HQ. |
| 7 | Tunggu HQ. | HQ menandai "Lunas" atau "Gagal". |

**Ejaan status.** Kata "dikirim" di layar bersifat optimistis. Dana belum tentu sudah masuk. Statusnya tetap **PROCESSING** sampai HQ menandai lunas. **[V][B]**

**Siklus pencairan:**

| Status | Arti | Yang terjadi pada saldo |
|---|---|---|
| PROCESSING ("Diproses") | Diminta, menunggu jawaban bank. | Sudah dipotong. |
| PAID ("Lunas") | HQ menyatakan transfer masuk. Tidak bisa dibatalkan. | Tidak berubah lagi. |
| FAILED ("Gagal") | Transfer gagal. | Dikembalikan sebagai catatan kredit "Pencairan gagal · {alasan}" atau "Pencairan gagal, saldo dikembalikan". |

**Celah antarmuka.** API menyediakan lima pencairan terakhir, tetapi halaman **tidak menampilkannya**. Pemilik tidak bisa melihat status PROCESSING, PAID, atau FAILED di layar. Satu-satunya petunjuk adalah buku kas (WITHDRAWAL dan kredit pengembalian) atau konfirmasi dari HQ. **[V][B]**

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Masukkan jumlah pencairan yang valid." | Jumlah kosong, bukan angka, atau 0. | Isi angka lebih dari 0. |
| "Daftarkan rekening dan tunggu verifikasi sebelum menarik saldo." | Belum ada rekening terverifikasi (pesan layar). | Selesaikan Prosedur 6.5. |
| "Belum ada rekening tujuan yang terverifikasi. Daftarkan rekening dan tunggu verifikasi kantor pusat sebelum menarik saldo." | Server menolak (422) karena rekening belum terverifikasi. | Tunggu verifikasi HQ. |
| "Withdrawal of {requested} exceeds available balance {available}." (Inggris) | Jumlah melebihi saldo tersedia. | Kecilkan jumlah atau pakai "Semua". |
| "Withdrawal amount must be greater than zero." (Inggris) | Jumlah harus lebih dari nol. | Isi jumlah positif. |
| "Pencairan gagal diproses." | Kegagalan umum. | Muat ulang, cek buku kas agar tidak mencairkan dua kali, lalu coba lagi. |

**Hasil akhir:** Saldo berkurang sebesar jumlah pencairan; pencairan berstatus PROCESSING.
**Izin & batasan:** Pemilik tidak dapat membatalkan pencairan. Penyelesaian (Lunas/Gagal) hanya oleh `FINANCE` atau `SUPER_ADMIN`. **[V]**

**Daftar periksa:**
- [ ] Rekening berstatus "Terverifikasi".
- [ ] Jumlah benar sebelum menekan "Cairkan saldo".
- [ ] Nomor "Ref" dicatat.
- [ ] Buku kas dicek setelahnya.

> **[SCREENSHOT REQUIRED: SS-waralaba-07 — Kartu "Saldo tersedia" dengan kolom "Jumlah pencairan (IDR)", tombol cepat Rp 2.000.000 / Rp 5.000.000 / "Semua" dan tombol "Cairkan saldo"]**
> *Gambar 7.7 — Formulir pencairan saldo.*

> **[SCREENSHOT REQUIRED: SS-waralaba-08 — Layar sukses "Pencairan diproses" dengan "Ref" WD-… dan "Status" Diproses (data sintetis)]**
> *Gambar 7.8 — Hasil pencairan berstatus Diproses.*

---

### Prosedur 6.7: Membaca buku kas dan komisi

**Tujuan:** Memahami asal-usul saldo.
**Peran:** Pemilik waralaba.
**Titik awal:** "Payout & komisi".

Judul "Payout & komisi" memuat lencana "Usulan" (kemungkinan penanda status desain; artinya belum dikonfirmasi **[D]**). Subjudul: "Buku kas depot, komisi HQ, dan pencairan untuk pemilik waralaba."

**Empat kartu angka:**

| Kartu | Isi | Bukti |
|---|---|---|
| Saldo tersedia | Jumlah bertanda semua catatan sejak awal. | **[V]** |
| Pendapatan bulan ini | Jumlah SALE_SETTLEMENT sejak awal bulan (WIB). | **[V]** |
| Komisi HQ | Jumlah COMMISSION bulan ini. | **[V]** |
| Payout berikutnya | Tanggal 15 bulan ini bila hari ini sebelum tanggal 15, selain itu tanggal 15 bulan depan. | **[V]** |

> **[B]** "Payout berikutnya" hanya tanggal tampilan. Tidak ada penjadwal otomatis yang membayar pada tanggal itu; pencairan hanya lewat permintaan pemilik atau rilis HQ. Apakah kebijakan bisnis membayar tanggal 15 perlu dikonfirmasi. **[K]**

**Kartu "Buku kas"** menampilkan 8 catatan terbaru (tanpa tombol "lihat lagi" di layar). Baris: deskripsi, tanggal (d MMM yyyy), jumlah — hijau "+ Rp" untuk kredit, merah "− Rp" untuk debit. Kosong: "Belum ada transaksi." **[V]**

| Jenis catatan | Arah | Contoh deskripsi |
|---|---|---|
| SALE_SETTLEMENT | Kredit | "Penjualan pesanan {no}" |
| COMMISSION | Debit | "Komisi HQ {pct}% pesanan {no}" |
| WITHDRAWAL | Debit | "Pencairan saldo · WD-YYYYMMDD-NNNN" |
| Pembatalan penjualan | Kredit/debit kebalikan | "Pembatalan: …" |
| STOCK_PURCHASE | Debit | Penulis catatan ini tidak ditemukan; tidak diketahui siapa yang mengisinya **[K]** |
| ADJUSTMENT | Kedua arah | Koreksi; penulisnya tidak ditemukan, diduga manual oleh HQ **[D]** |

**Cara penghitungan per pesanan selesai [V]:**

1. Saldo bertambah sebesar **total pesanan** (termasuk ongkos kirim).
2. Komisi HQ = pembulatan (dasar komisi × persentase ÷ 100).
3. Dasar komisi = subtotal barang sebelum diskon (tidak termasuk ongkir dan diskon). Bila tidak tersedia, dipakai total pesanan.
4. Persentase = skema komisi depot yang sedang berlaku; bila belum ada skema, 0% dan tidak ada baris komisi.
5. Hasil bersih ke pemilik = total pesanan − komisi.
6. Pencatatan idempotent per pesanan (tidak dobel).

Karena pemilik dikreditkan sebesar total pesanan termasuk ongkir, sedangkan komisi hanya dari subtotal barang, biaya kurir ditanggung pemilik dari jumlah itu. **[V]**

Pembatalan penjualan kasir (void) menulis baris koreksi "Pembatalan: …" dengan persentase komisi aslinya. Buku kas bersifat tambah-saja; baris tidak dihapus. **[V]**

> **Pendapatan hilang bila pemilik tidak terhubung.** Jika depot waralaba tidak punya pemilik, pesanan selesai tidak dibukukan sama sekali (pendapatan pemilik dan komisi HQ hilang; hanya masuk log kesalahan). Jika tidak ada skema komisi, komisi 0% dan muncul peringatan ke operasional. Penyelesaian pesanan tidak pernah diblokir oleh hal ini. **[V]**

> **[B]** Label HQ "Skema komisi" memakai kata "Persentase payout per depot", padahal kode **memotong** persentase itu sebagai komisi HQ. Bab ini memakai arti kode: persentase adalah bagian HQ. **[V][B]**

> **[SCREENSHOT REQUIRED: SS-waralaba-09 — Halaman "Payout & komisi" bagian atas: lencana "Usulan", empat kartu angka, dan kartu "Buku kas" berisi baris kredit hijau dan debit merah (data sintetis)]**
> *Gambar 7.9 — Kartu angka dan buku kas.*

---

### Prosedur 6.8: Memakai Perkiraan, Retur galon, dan Pencarian

**Tujuan:** Membaca perkiraan permintaan, retur galon, dan mencari data.
**Peran:** Pemilik waralaba (semua hanya-baca).

**Perkiraan** (`/dashboard/forecast`, judul "Perkiraan permintaan"):

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Pilih depot di pengalih depot. | Server hanya menerima depot milik Anda. Lain: 403 "Akun waralaba harus memilih depot miliknya." atau "Akun waralaba ini hanya boleh mengakses depot miliknya." |
| 2 | Pilih "Rentang prediksi" (7/14/30, "{n} hari ke depan"). | |
| 3 | Pilih "Jendela riwayat" (30/60/90, "{n} hari terakhir"). | |
| 4 | Baca kartu "Prediksi pendapatan · {n} hari ke depan" ("Rata-rata / hari", "Tren") dan tabel Produk, Rata-rata / hari, Tren, Prediksi ({n}h), Hari habis, Restok, Perlu dipesan. | Tanpa riwayat: "Belum ada riwayat pendapatan untuk depot ini." / "Belum ada perkiraan". |

> **[D]** Kolom "Hari habis" dan "Perlu dipesan" membutuhkan pembacaan stok, yang tidak termasuk hak pemilik. Kemungkinan muncul pesan gagal muat dan sel bernilai "—".

**Retur galon** (`/dashboard/returns`): hanya baca. Tampil ubin "Galon di pelanggan", "Galon keluar", "Galon kembali", "Deposit tertahan" dan daftar retur untuk depot yang dipilih ("Retur untuk {depot} (dari switcher)."). Tombol "Catat retur" dan "Catat galon keluar" disembunyikan untuk pemilik. Depot milik orang lain: 403 "Akun waralaba ini hanya boleh mengakses depot miliknya." **[V]**

**Pencarian** (`/dashboard/search`): kolom "Cari depot, produk, atau nomor telepon pelanggan…", tekan Enter. Kosong: "Mulai mencari" / "Ketik kata kunci lalu tekan Enter untuk mencari di seluruh jaringan." Tanpa hasil: "Tidak ada hasil" / "Tidak ada yang cocok dengan “{q}”." Bagian hasil: Depot, Produk, Pesanan, Pelanggan. **[V]**

> **[B]** Untuk pemilik: depot yang muncul hanya milik sendiri; produk dari katalog umum; bagian Pesanan dan Pelanggan kemungkinan kosong karena hak akses tidak mencukupi; hasil depot menaut ke halaman yang tidak bisa dibuka pemilik. Subjudul "seluruh jaringan" menyesatkan. **[D]**

**Jadwal shift** (`/dashboard/shift`): tampil di menu, tetapi data jadwal dan kurir kemungkinan kosong atau ditolak untuk pemilik. **[D]**

---

### Prosedur 6.9: Mengatur alert di "Akun saya"

**Tujuan:** Memilih alert yang dikirim ke Anda dan mengubah bahasa.
**Peran:** Pemilik waralaba.
**Titik awal:** "Akun saya" (`/dashboard/account`, judul halaman "Pengaturan").

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Buka "Akun saya". | Bagian "Alert yang dikirim". |
| 2 | Nyalakan/matikan: "Approval baru" ("Saat operator minta persetujuan"), "Stok kritis" ("Saat stok di bawah ambang"), "Ringkasan harian" ("Rekap operasional tiap pagi"). | Disimpan sebagai preferensi notifikasi sendiri. |
| 3 | Bagian "Akun": ubah "Bahasa" (ID/EN). | |

> **[B]** Baris "PIN persetujuan" dan "Perangkat masuk" hanya tampilan dan belum berfungsi. Alert di atas berorientasi depot; apakah benar-benar terkirim ke pemilik belum diketahui. **[V][K]**

**Peran & akses** (`/dashboard/roles`) menampilkan matriks "Peran & hak akses" hanya-baca; peran Anda berlabel "Pemilik waralaba".

---

### Prosedur 6.10: Alur rilis payout oleh HQ ("Ajukan rilis" dan "Setujui & rilis")

**Tujuan:** Menjelaskan jalur kedua uang keluar yang dimulai HQ, agar pemilik tidak bingung.
**Peran:** HQ. Pemilik hanya terdampak.
**Titik awal (HQ):** "Pembayaran & payout" (`/hq/payments`).

Ada **dua jalur berbeda** pencairan:

| | Jalur 1: pemilik mengajukan sendiri | Jalur 2: HQ merilis saldo penuh |
|---|---|---|
| Pemicu | Pemilik menekan "Cairkan saldo". | HQ menekan "Ajukan rilis" untuk pemilik bersaldo positif. |
| Persetujuan sebelum uang bergerak | **Tidak ada.** | Ada: dua orang berbeda (maker-checker). |
| Siapa memulai | Pemilik. | `FINANCE` atau `SUPER_ADMIN` (`hqPayout`). |
| Siapa menyetujui | Tidak ada. HQ hanya menutup hasil bank. | `DIREKTUR` atau `SUPER_ADMIN` (`hqPayoutApprove`), **bukan** pengaju sendiri. |
| Jumlah | Sesuai permintaan pemilik. | **Seluruh saldo** saat disetujui. |
| Status awal pencairan | PROCESSING | PROCESSING (setelah disetujui) |
| Penutupan | HQ "Lunas" atau "Gagal" | HQ "Lunas" atau "Gagal" |

Alur jalur 2 di layar HQ:

| Langkah | Tindakan HQ | Respons |
|---|---|---|
| 1 | Kartu "Rilis payout waralaba": per pemilik bersaldo positif, "Jatuh tempo {tanggal}". Tekan "Ajukan rilis". | Toast "Pengajuan rilis untuk {pemilik} dikirim, menunggu persetujuan". Hanya satu pengajuan terbuka per pemilik; lainnya ditolak: "Pencairan untuk pemilik ini sudah diajukan dan menunggu persetujuan." |
| 2 | Orang **lain** dengan hak persetujuan membuka "Pengajuan rilis menunggu persetujuan" ("Diajukan oleh {pelaku}"). | Tombol "Setujui & rilis" dan "Tolak" hanya tampil untuk pemegang `hqPayoutApprove`. |
| 3 | Tekan "Setujui & rilis". Konfirmasi: "Setujui pengajuan ini? Saldo pemilik akan dipotong dan ditransfer." | Toast "Pengajuan disetujui, payout dirilis". Terbentuk pencairan PROCESSING ke rekening terverifikasi pemilik. |
| 3b | Atau "Tolak". Konfirmasi: "Tolak pengajuan ini? Tidak ada saldo yang bergerak." | Toast "Pengajuan ditolak". Alasan tidak diisi dari layar. |
| 4 | Di kartu "Penarikan menunggu jawaban bank", setelah bank menjawab, tekan "Lunas" atau "Gagal". | "Tandai penarikan ini sudah dibayar? Tidak bisa dibatalkan." / "Tandai penarikan ini gagal? Saldonya akan dikembalikan dan ini tidak bisa dibatalkan." |

Pesan penolakan dari server: pengaju menyetujui sendiri → 403 "Pengaju pencairan tidak boleh menyetujui pengajuannya sendiri."; sudah diputuskan → 409 "Pengajuan pencairan ini tidak ditemukan atau sudah diputuskan."; bila rilis gagal (misalnya rekening belum terverifikasi) pengajuan kembali PENDING. Petunjuk layar: "PROCESSING berarti saldonya sudah dipotong. Tandai LUNAS kalau transfernya masuk, atau GAGAL untuk mengembalikan saldonya." **[V]**

Pencairan oleh pemilik (jalur 1) tampil langsung di "Penarikan menunggu jawaban bank" dan **tidak pernah** tampil di "Pengajuan rilis menunggu persetujuan". **[V]**

Verifikasi rekening oleh HQ: kartu "Rekening tujuan menunggu verifikasi", petunjuk "Cocokkan nama dan nomor rekening sebelum memverifikasi. Pencairan hanya ke rekening terverifikasi.", tombol "Verifikasi" ("Verifikasi rekening ini? Pencairan berikutnya akan dikirim ke sana.") dan "Tolak" ("Tolak rekening ini? Pemiliknya harus mendaftarkan ulang."). **[V]**

> **[B]** Asumsi lama "pemilik minta → FINANCE ajukan → DIREKTUR setujui" **tidak sesuai kode**. Pasangan Ajukan/Setujui hanya untuk rilis yang dimulai HQ.

> **[SCREENSHOT REQUIRED: SS-waralaba-10 — Layar HQ "Pembayaran & payout": kartu "Rilis payout waralaba" dengan tombol "Ajukan rilis" dan kartu "Pengajuan rilis menunggu persetujuan" dengan tombol "Setujui & rilis"/"Tolak" (data sintetis)]**
> *Gambar 7.10 — Alur rilis payout di sisi HQ.*

---

## 7. Kolom wajib & aturan validasi (ringkasan)

| Formulir | Kolom | Wajib | Format / batas | Pesan bila salah |
|---|---|---|---|---|
| Pendaftaran `/waralaba` | Nama lengkap | Ya | maks 150 | "Nama pemohon wajib diisi." |
| | Nomor WhatsApp | Ya | `+628` + 7–11 angka (input 08…) | "Nomor WhatsApp belum benar. Contoh: 081234567890." |
| | Kode depot usulan | Ya | maks 30; huruf besar otomatis | "Kode depot usulan wajib diisi." |
| | Nama depot | Ya | maks 150 | "Nama depot wajib diisi." |
| | Kota / Provinsi | Ya | maks 100 | "Kota wajib diisi." / "Provinsi wajib diisi." |
| | Lintang / Bujur | Ya | angka koordinat sah | "Titik lokasi wajib diisi." |
| | Nilai investasi (Rp) | Ya | bilangan bulat ≥ 0 | "Nilai investasi dan proyeksi omzet harus angka 0 atau lebih." |
| | Proyeksi omzet per bulan (Rp) | Ya | bilangan bulat ≥ 0 | sama |
| | Persetujuan data | Ya | dicentang | "Persetujuan pemrosesan data wajib dicentang sebelum mengirim." |
| Rekening | Nama bank | Ya | 2–60 | tombol tidak aktif |
| | Nomor rekening | Ya | angka/spasi/strip, 6–30 | tombol tidak aktif |
| | Nama pemilik rekening | Ya | 2–120 | tombol tidak aktif |
| Pencairan | Jumlah pencairan (IDR) | Ya | bilangan bulat > 0, ≤ saldo | "Masukkan jumlah pencairan yang valid." |

Semua nilai di tabel berasal dari kode. **[V]**

## 8. Kesalahan umum & solusi

| Gejala / pesan | Penyebab | Solusi |
|---|---|---|
| Tidak bisa masuk setelah lamaran disetujui | Akun pemilik belum dibuat HQ (persetujuan tidak otomatis membuatnya). | Minta HQ mengundang akun dengan peran "Pemilik waralaba". |
| "Belum ada depot yang ditugaskan padamu." | Depot belum didaftarkan atas akun Anda. | Minta HQ mengisi "Pemilik waralaba" pada depot. |
| Angka "Pendapatan" tetap 0 padahal ada penjualan | Depot tanpa pemilik, atau pesanan belum selesai. | Minta HQ memeriksa pemilik depot di "Jaringan waralaba" (baris merah "Belum ada pemilik — pendapatan depot ini tidak terbukukan"). |
| Komisi 0 | Skema komisi belum diatur ("komisi belum diatur"). | Minta HQ mengatur "Skema komisi". |
| Tombol "Cairkan saldo" abu-abu | Saldo 0 atau rekening belum "Terverifikasi". | Cek saldo dan status rekening. |
| "Ditolak: tanpa alasan" | HQ menolak tanpa kolom alasan. | Hubungi HQ, daftarkan ulang. |
| Pencairan lama "Diproses" | Menunggu HQ menandai Lunas/Gagal. | Hubungi HQ dengan nomor "Ref". |
| 403 "This depot belongs to another owner." | Mencoba membuka depot milik pemilik lain. | Pilih depot milik Anda. |
| Halaman tertentu kosong/menolak (Antrean, Jadwal shift, sebagian Pencarian) | Menu tampil, hak akses tidak ada. | Abaikan; bukan kesalahan Anda. **[D]** |

## 9. Batasan peran (apa yang TIDAK bisa; butuh persetujuan siapa)

Pemilik **tidak** memiliki peran operasional di depot mana pun. **[V]**

| Tidak bisa | Penyebab | Lakukan lewat |
|---|---|---|
| Membuat/mengubah/menangguhkan depot | Butuh `depotAdmin` (`MANAGER`, `SUPER_ADMIN`). | HQ/Admin |
| Mengubah pemilik depot | Sama. | HQ/Admin |
| Mengatur komisi | Butuh `commissionRuns` (`FINANCE`, `SUPER_ADMIN`). | HQ |
| Memverifikasi rekening sendiri | `hqPayout` (`FINANCE`, `SUPER_ADMIN`). | HQ |
| Membatalkan atau menandai lunas pencairan | `hqPayout`. | HQ |
| Mengelola antrean pesanan, penjualan kasir, stok, harga, voucher, promo | Hak akses tidak dimiliki. | Kepala depot / Manajer |
| Mengelola staf dan kurir | Butuh `staffAdmin`. | HQ (`HEAD_OFFICE`, `SUPER_ADMIN`) |
| Memutuskan persetujuan, penyelesaian kas, laporan, audit | Hak akses tidak dimiliki. | Peran depot / HQ |
| Mengusulkan atau melihat override harga | Tidak punya kemampuan harga. | Manajer depot + HQ |
| Membuka `/hq/*` | Bukan peran konsol HQ. | – |
| Menambah catatan retur galon | `returnsWrite` tidak mencakup pemilik. | Kepala depot / Manajer |

### 9.1 Akses waralaba vs akses depot

Bagian ini menjawab pertanyaan paling sering: "Saya pemilik, tetapi mengapa tidak bisa memproses pesanan di depot saya?" Jawabannya: akses pemilik bersifat **kepemilikan dan keuangan**, sedangkan akses depot bersifat **operasional** dan dipegang akun lain.

**Tabel: Akses waralaba vs akses depot**

| Aspek | Akses waralaba (Pemilik waralaba, `FRANCHISE_OWNER`) | Akses tingkat depot (Kepala depot `KEPALA_DEPOT`, Staff depot `STAFF_DEPOT`, Manajer `MANAGER`) |
|---|---|---|
| Tujuan akses | Memantau hasil usaha dan keuangan | Menjalankan operasional harian depot |
| Dasar pembatasan | `Depot.ownerId` = akun pemilik. Satu pemilik bisa punya banyak depot; satu depot punya satu pemilik. | Penempatan depot pada akun (`depotId`), atau hierarki untuk Manajer/SPV |
| Halaman awal | `/dashboard/franchise` ("Waralabaku") | Antrean/konsol operasional depot (Kepala depot) atau `/driver` (Staff depot) |
| Antrean & proses pesanan | Tidak ada | Ada (sesuai peran) |
| Penjualan kasir, kas harian | Tidak ada | Ada (Kepala depot, Manajer) |
| Stok (lihat/ubah) | Tidak ada | Ada (sesuai peran) |
| Harga & override harga | Tidak ada | Manajer mengusulkan; HQ memutuskan |
| Direktori staf / kurir | Tidak ada | Sesuai peran; pengelolaan akun oleh HQ |
| Retur galon | Hanya baca depot sendiri | Kepala depot dan Manajer dapat mencatat |
| Perkiraan permintaan | Ya, depot sendiri | Tergantung hak akses |
| Buku kas pemilik, saldo, komisi | **Ya** (hanya pemilik; terikat akun) | Tidak |
| Daftarkan rekening & cairkan saldo | **Ya** | Tidak |
| Membaca data depot (termasuk bank/pembayaran) | Ya, hanya depot sendiri (`/depots/mine`); tidak bisa mengubah | Sesuai peran |
| Membuat/mengubah/menangguhkan depot | Tidak | Hanya Manajer/Admin (`depotAdmin`) |
| Menyetujui apa pun | Tidak | Sesuai peran (Kepala depot, SPV, dsb.) |
| Konsol HQ `/hq/*` | Tidak | Tidak (kecuali peran HQ) |
| Akun | Dibuat HQ lewat "＋ Undang staf"; tanpa data karyawan | Dibuat HQ/HR; punya data karyawan |
| Cakupan data | Hanya depot dengan `ownerId` = akun Anda | Hanya depot penempatan/hierarkinya |

Catatan keamanan dari tabel: Pemilik tidak diberi daftar depot lewat penjaga cakupan depot biasa; server memakai pencocokan `ownerId` langsung untuk setiap pembacaan depot, retur, dan perkiraan. Payout dan buku kas bahkan tidak memiliki parameter depot; semuanya terikat ke akun yang masuk. **[V]**

> **Catatan hak akses.** Nilai bawaan dari `packages/access/src/index.ts`. Admin dapat mengubahnya saat berjalan (sekitar 30 detik).

### 9.2 Kendali HQ atas waralaba

HQ memegang kendali berikut. Tabel ini membantu pemilik memahami siapa yang memutuskan apa.

| Kendali HQ | Layar HQ | Peran bawaan | Dampak bagi pemilik |
|---|---|---|---|
| Menilai lamaran | "Lamaran waralaba" | `HEAD_OFFICE`, `DIREKTUR`, `SUPER_ADMIN` | Diterima/ditolak |
| Membuat akun pemilik | "Direktori staf" > "＋ Undang staf" | `HEAD_OFFICE`, `SUPER_ADMIN` | Bisa masuk |
| Mendaftarkan depot dan pemilik | "Onboard depot" | `MANAGER`, `SUPER_ADMIN` | Depot muncul di "Waralabaku" |
| Memantau jaringan | "Jaringan waralaba" (hanya baca) | `HEAD_OFFICE`, `DIREKTUR`, `FINANCE`, `SUPER_ADMIN` | – |
| Menetapkan skema komisi (berlaku mulai tanggal tertentu) | "Skema komisi" ("Terapkan skema baru") | Terapkan: `FINANCE`, `SUPER_ADMIN`. Lihat: juga `HEAD_OFFICE`, `DIREKTUR` | Mengubah potongan pada pesanan berikutnya |
| Memverifikasi/menolak rekening | "Pembayaran & payout" | `FINANCE`, `SUPER_ADMIN` | Menentukan bisa tidaknya mencairkan |
| Menandai Lunas/Gagal | "Penarikan menunggu jawaban bank" | `FINANCE`, `SUPER_ADMIN` | Menutup pencairan |
| Mengajukan rilis saldo penuh | "Ajukan rilis" | `FINANCE`, `SUPER_ADMIN` | Saldo dirilis ke rekening |
| Menyetujui rilis | "Setujui & rilis" | `DIREKTUR`, `SUPER_ADMIN` | Uang bergerak |
| Menangguhkan/mengaktifkan depot | "Tangguhkan" / "Aktifkan" di detail depot | `MANAGER`, `SUPER_ADMIN` | Pesanan dialihkan, staf kehilangan akses |
| Memutuskan override harga | "Tata kelola harga" | `HEAD_OFFICE`, `DIREKTUR`, `SUPER_ADMIN` | Harga depot |

Detail penting:

- **Skema komisi** bersifat tambah-saja dan punya tanggal berlaku; tanggal di masa depan berarti terjadwal. Persentase harus 0–100 (kesalahan server: "Commission percentage must be between 0 and 100."). Daftarnya memuat seluruh depot termasuk milik pusat; mengisi persentase pada depot milik pusat tidak berdampak karena tanpa pemilik. Siapa yang menerapkan tercatat. `HEAD_OFFICE`/`DIREKTUR` melihat halaman tetapi ditolak saat menerapkan. **[V]**
- **Penangguhan depot** lewat dialog "Tangguhkan Depot?" yang meminta mengetik kode depot. Dampak yang tertulis: pesanan aktif dialihkan ke depot terdekat; staf dan kurir kehilangan akses; radius cakupan dikembalikan ke depot terdekat (dua terakhir berlabel "Perkiraan"). Depot tampil "Ditangguhkan" bagi HQ dan "nonaktif" bagi pemilik. **Tidak ada kode yang membekukan payout** saat depot ditangguhkan; saldo tetap bisa dicairkan. Apakah itu sesuai kebijakan perlu konfirmasi. **[V][K]**
- Daftar "Jaringan waralaba" memperlihatkan per depot: nama, kode, "Nonaktif", pemilik, "{kota} · komisi {n}%" atau "komisi belum diatur", "menunggu rilis" beserta jumlah, tombol "Buka depot". Kartu "Menunggu rilis ke pemilik" menjumlahkan saldo pemilik yang siap dicairkan HQ. Kosong: "Belum ada depot waralaba." **[V]**

## 10. Pertimbangan keamanan

- Masuk dengan OTP ke nomor telepon. Jangan membagikan kode OTP kepada siapa pun, termasuk petugas Hydromart.
- Jangan membagikan akses akun. Semua pencairan atas nama akun Anda.
- Periksa nomor rekening dua kali. Pencairan hanya ke rekening yang diverifikasi, dan mengganti rekening mengulang verifikasi.
- Anda hanya melihat depot milik Anda. Bila melihat depot orang lain, laporkan ke HQ.
- Nonaktif/ditangguhkan: akun dengan status ditangguhkan ditolak saat masuk dan saat pembaruan sesi. Token yang sudah terbit kemungkinan berlaku sampai habis masa berlakunya (15 menit). **[V][D]**
- Data pelamar diproses dengan persetujuan privasi; lamaran ditolak dihapus berkala. **[V]**
- Contoh nomor telepon di dokumen ini sintetis.

## 11. Kegiatan akhir hari/berkala

| Frekuensi | Kegiatan |
|---|---|
| Harian | Buka "Waralabaku": cek pendapatan, "Stok kritis", "SLA tepat waktu", kartu "SDM hari ini". |
| Mingguan | Cek buku kas di "Payout & komisi"; cek "Perkiraan" untuk 7/14/30 hari. |
| Sebelum pencairan | Pastikan rekening "Terverifikasi"; cek saldo; catat nomor "Ref" sesudahnya. |
| Setelah pencairan | Pastikan baris "Pencairan saldo · WD-…" tampil di buku kas; konfirmasi Lunas/Gagal ke HQ. |
| Bulanan | Cocokkan "Pendapatan bulan ini" dan "Komisi HQ" dengan catatan sendiri. Selisih dilaporkan ke HQ. |
| Berkala | Periksa "Akun saya" (alert, bahasa). |

## 12. Skenario praktis

**Skenario A — Melamar sampai bisa masuk.** Budi (sintetis) mengisi `/waralaba`, mencatat nomor tanda terima. HQ memverifikasi dokumen lewat WhatsApp, mencentang daftar periksa, menekan "Setujui & provision". HQ mengundang akun "Pemilik waralaba" untuk nomor Budi, lalu "Onboard depot" dengan Budi sebagai pemilik. Budi masuk dengan OTP dan melihat depotnya di "Waralabaku".

**Skenario B — Mencairkan Rp 5.000.000.** Saldo Rp 8.000.000, rekening "Terverifikasi". Budi menekan Rp 5.000.000, lalu "Cairkan saldo". Saldo menjadi Rp 3.000.000; layar menampilkan "Ref". HQ menandai "Lunas" setelah transfer masuk.

**Skenario C — Pencairan gagal.** Bank menolak transfer. HQ menekan "Gagal". Buku kas menampilkan kredit "Pencairan gagal · …"; saldo kembali. Budi memeriksa nomor rekening, mengganti jika salah (verifikasi diulang), lalu mencairkan lagi.

**Skenario D — Pendapatan 0.** Depot baru belum ada pesanan, atau depot tanpa pemilik. Budi menghubungi HQ; HQ memeriksa "Jaringan waralaba".

**Skenario E — Rekening ditolak.** Status "Ditolak: tanpa alasan". Budi menghubungi HQ, memperbaiki nama pemilik rekening, mendaftarkan ulang.

## 13. Daftar periksa penyelesaian

- [ ] Lamaran terkirim dan nomor tanda terima disimpan.
- [ ] HQ menyetujui, mengundang akun, dan mendaftarkan depot atas nama Anda.
- [ ] Anda dapat masuk dan melihat depot di "Waralabaku".
- [ ] Rekening terdaftar dan "Terverifikasi".
- [ ] Anda paham jalur pencairan: Cairkan saldo → PROCESSING → Lunas/Gagal.
- [ ] Anda tahu batasan: tidak ada operasional depot dan tidak ada persetujuan.
- [ ] Alert di "Akun saya" sesuai kebutuhan.

## 14. Inventaris screenshot bab ini

| ID | Layar | Kondisi | Status |
|---|---|---|---|
| SS-waralaba-01 | Rel menu konsol pemilik | 8 item menu, pengalih depot | Belum diambil |
| SS-waralaba-02 | Formulir `/waralaba` | Terisi sebagian | Belum diambil |
| SS-waralaba-03 | "Pengajuan terkirim" | Tanda terima tampil | Belum diambil |
| SS-waralaba-04 | "Onboard depot" (HQ) | Kepemilikan Waralaba, pilihan pemilik terbuka | Belum diambil |
| SS-waralaba-05 | "Waralabaku" | Empat kartu + daftar depot | Belum diambil |
| SS-waralaba-06 | Kartu "Rekening tujuan pencairan" | Status menunggu verifikasi | Belum diambil |
| SS-waralaba-07 | Kartu "Saldo tersedia" | Kolom jumlah + tombol cepat | Belum diambil |
| SS-waralaba-08 | "Pencairan diproses" | Ref WD-… dan Status Diproses | Belum diambil |
| SS-waralaba-09 | "Payout & komisi" | Kartu angka + Buku kas | Belum diambil |
| SS-waralaba-10 | "Pembayaran & payout" (HQ) | Ajukan rilis / Setujui & rilis | Belum diambil |

## 15. Catatan celah & hal yang perlu dikonfirmasi

Rujukan: lihat `17-open-questions`.

| No | Celah | Tag |
|---|---|---|
| 1 | Formulir publik tidak ada unggah dokumen dan tidak ada halaman cek status pemohon; cara menyerahkan KTP/NPWP/bukti lokasi/setoran modal tidak tertulis (diduga WhatsApp). | [V][K] |
| 2 | Persetujuan tidak membuat akun maupun depot; nama/telepon pemohon tidak terbawa; data usulan hanya di sessionStorage. | [V] |
| 3 | Persetujuan boleh dengan daftar periksa belum lengkap; penolakan tanpa alasan; tidak ada notifikasi otomatis ke pemohon. | [V][K] |
| 4 | Tanggal "Payout berikutnya" (15) hanya tampilan; kebijakan pembayaran tanggal 15 belum jelas. | [V][K] |
| 5 | Halaman payout tidak menampilkan riwayat/status pencairan; buku kas hanya 8 catatan terakhir tanpa "lihat lagi". | [V][B] |
| 6 | Teks sukses "dikirim" menyesatkan; status riil PROCESSING. | [V][B] |
| 7 | Penolakan rekening tanpa alasan di layar HQ ("Ditolak: tanpa alasan"). | [V][B] |
| 8 | Pesan error server berbahasa Inggris tampil apa adanya (kode depot sudah ada, jumlah melebihi saldo, depot waralaba harus punya pemilik, dsb.). | [V][B] |
| 9 | Label "Persentase payout per depot" pada "Skema komisi" bertentangan dengan perilaku (persentase = komisi HQ). | [V][B] |
| 10 | Penangguhan depot tidak membekukan payout; kebijakan perlu konfirmasi. | [V][K] |
| 11 | Menu/tab "Antrean", "Jadwal shift", sebagian "Pencarian" tidak berguna bagi pemilik; baris "PIN persetujuan" dan "Perangkat masuk" tidak berfungsi; lencana "Usulan" belum jelas. | [V][B] |
| 12 | Penghubung STOCK_PURCHASE dan ADJUSTMENT: penulisnya tidak ditemukan. | [K] |
| 13 | Tombol depot di layar HQ tidak dibatasi peran padahal server hanya menerima `MANAGER`/`SUPER_ADMIN`. | [V][B] |
| 14 | Hak akses di bab ini adalah nilai bawaan; Admin dapat mengubahnya saat berjalan. | [V] |
| 15 | Belum ada pengujian yang dijalankan oleh penulis dokumen ini. | – |
