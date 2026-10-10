# Bab 4 — Panduan Staff depot / Kurir (STAFF_DEPOT)

| Metadata | Nilai |
|---|---|
| Versi | 0.1 draf |
| Tanggal | 2026-10-10 |
| Klasifikasi | Internal — Terbatas |
| Peran di UI | Kurir (aplikasi "Hydromart Kurir") |
| Peran di kode | `STAFF_DEPOT` |
| Status pengujian | Belum ada pengujian yang dijalankan oleh penulis dokumen ini. Isi bab disusun dari pembacaan kode dan berkas temuan. |

**Legenda bukti.** **[V]** terverifikasi di kode · **[D]** disimpulkan, perlu konfirmasi · **[K]** perlu konfirmasi bisnis (nilai berasal dari data/pengaturan) · **[B]** diketahui bermasalah/tidak konsisten.

**Catatan hak akses (berlaku untuk seluruh bab).** Hak akses di bab ini adalah nilai BAWAAN dari `packages/access/src/index.ts`. Super admin dapat mengubahnya saat aplikasi berjalan, dan perubahan berlaku sekitar 30 detik kemudian. **[V]**

---

## 1. Gambaran peran

> **PENTING — nama peran vs fungsi sebenarnya.** Dalam permintaan dokumentasi, peran ini disebut "Staff Depot". **Di kode, `STAFF_DEPOT` adalah KURIR.** Peran ini masuk ke aplikasi `/driver` ("Hydromart Kurir"), **bukan** ke konsol `/dashboard`. Untuk `STAFF_DEPOT`, tampilan landing `/dashboard` bernilai "denied" (ditolak), sehingga peran ini **tidak punya konsol `/dashboard` sebagai halaman awal**. **[V]** (`apps/web/src/lib/roles.ts`: `canUseCourierApp` = `STAFF_DEPOT` atau `SUPER_ADMIN`; `consoleHome` kurir = `/driver`, cadangan `/hr/me`; `dashboardLandingView('STAFF_DEPOT')` = `'denied'`)
>
> Jika perusahaan bermaksud "staf depot" sebagai petugas konter/gudang yang memakai konsol, peran itu di kode adalah Kepala depot (Bab 3) atau Manajer. Tidak ada peran terpisah untuk petugas konsol non-kepala. **[B]** — lihat bagian 15.

Kurir mengantar pesanan ke pelanggan, menerima uang tunai (COD), mengambil bukti antar, menyetor uang ke kasir di akhir shift, dan melihat penghasilannya. Kurir juga memakai layanan mandiri karyawan `/hr/me` untuk absen wajah, cuti, kasbon, dan slip gaji.

Peran ini berada di dasar rantai: Staff Depot (kurir) → Kepala depot → Asisten SPV → SPV → Manajer → Direktur. Dua tingkat pertama terkunci pada satu depot. **[V]**

---

## 2. Tujuan & tanggung jawab

| Tanggung jawab | Bagian |
|---|---|
| Hadir di depot dan mulai shift (check-in) | 6.1 |
| Mengatur status Online/Istirahat/Offline dan mengakhiri shift | 6.2 |
| Mengantar pesanan: ambil barang, mulai antar, navigasi | 6.4 |
| Menerima uang tunai COD dan memberi kembalian | 6.5 |
| Mengambil bukti antar (foto, segel, nama penerima, tanda tangan) | 6.6 |
| Menandai gagal, tidak di tempat, atau jadwal ulang | 6.7–6.9 |
| Mencatat retur galon kosong | 6.10 |
| Menyetor uang COD ke kasir di akhir shift | 6.11 |
| Memantau penghasilan dan menarik saldo | 6.12 |
| Mengajukan klaim pengeluaran | 6.13 |
| Melapor insiden; membaca pengumuman | 6.14 |
| Absen wajah, cuti, kasbon, slip gaji | 6.15–6.20 |

---

## 3. Prasyarat akses

1. **Akun staf dengan peran Kurir** dan nomor telepon yang menerima SMS (masuk memakai kode sekali pakai/OTP).
2. **Ditempatkan di satu depot** oleh HR. Jika belum: "Belum ada depot" / "Akun kurir ini belum ditempatkan di depot. Hubungi admin depot." (tombol "Buka profil saya"). **[V]**
3. **Ponsel dengan GPS, kamera, dan koneksi data.** Check-in, bukti antar, dan absen wajah semuanya membaca lokasi. Kamera dibutuhkan untuk foto bukti, struk, dan wajah.
4. **Browser/aplikasi mengizinkan lokasi, kamera, dan notifikasi.**
5. Untuk `/hr/me`: akun tertaut ke data karyawan aktif yang dibuat HR. Jika tidak: "Akun ini belum tertaut ke data karyawan" atau "Karyawan tidak aktif". **[V]**
6. **Akun non-kurir tidak bisa membuka `/driver`.** Muncul "Halaman khusus kurir" — "Akun ini bukan kurir. Masuk dengan akun kurir untuk mengakses daftar pengantaran." **[V]**

Yang menyiapkan akses: Kantor pusat/Admin membuat akun dan peran; HR menempatkan depot, mengisi kendaraan, dan menautkan data karyawan.

---

## 4. Masuk & pengaturan awal

### Prosedur: Masuk dan menyelesaikan perkenalan pertama

**Tujuan:** Masuk ke aplikasi kurir. **Peran:** Kurir. **Prasyarat:** akun aktif. **Titik awal:** halaman `/login`.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Masukkan nomor telepon akun kurir Anda. | Kode sekali pakai dikirim lewat SMS. |
| 2 | Ketik 6 digit kode di halaman verifikasi. | Otomatis terkirim pada digit ke-6. Hitung mundur "Kode berlaku {m:ss} lagi." |
| 3 | Pertama kali: baca 4 slide perkenalan. Tombol "Lewati" ada pada slide 1–3. | Slide 1 "Selamat datang, kurir Hydromart!" · 2 "Selalu ambil bukti antar" · 3 "Kelola uang COD dengan rapi" · 4 "Kamu siap jalan!" dengan tombol "Mulai shift · check-in". |
| 4 | Tekan "Mulai shift · check-in". | Anda menuju layar check-in (6.1). |

Perkenalan hanya tampil sekali per perangkat (disimpan di peramban). **[V]** Aplikasi dirancang untuk layar ponsel selebar sekitar 384 px.

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Kode verifikasi salah." / "...sudah kedaluwarsa. Minta kode baru." | Kode keliru atau lewat 5 menit | Ketik ulang atau "Kirim ulang kode" |
| "Akun ini tidak aktif. Hubungi dukungan Hydromart." | Akun nonaktif | Hubungi Kepala depot/HR |
| "Halaman khusus kurir" | Anda masuk dengan akun non-kurir | Masuk dengan akun kurir |

**Daftar periksa:**
- [ ] Izin lokasi, kamera, dan notifikasi diberikan.
- [ ] Depot penempatan benar di Profil.

> **[SCREENSHOT REQUIRED: SS-staff-depot-01 — Slide perkenalan nomor 4 "Kamu siap jalan!" dengan tombol "Mulai shift · check-in"]**
> *Gambar 4.1 — Perkenalan kurir.*

### Layar utama dan tab bawah

Navigasi bawah memiliki tiga tab: **Tugas** (`/driver`), **Riwayat** (`/driver/history`), **Profil** (`/driver/profile`). Tab keempat "Dompet" (`/driver/earnings`) dirancang muncul di halaman dompet, tetapi karena halaman dompet menyembunyikan navigasi, tab itu praktis tidak pernah terlihat. Buka dompet lewat **Profil**. **[B]** **[D]**

Spanduk "{n} data belum terkirim" dengan tombol "Kirim sekarang" tampil di semua layar kurir bila ada data tertunda karena sinyal (lihat 6.14).

---

## 5. Menu & modul tersedia

| Label | Rute | Isi | Bukti |
|---|---|---|---|
| Tugas | `/driver` | "Pengantaran saya": pengantaran aktif, penghitung Aktif/Selesai/Tepat | **[V]** |
| Riwayat | `/driver/history` | Pengantaran Selesai dan Gagal | **[V]** |
| Profil | `/driver/profile` | Data diri dan pintu ke semua menu lain | **[V]** |
| Check-in | `/driver/shift/check-in` | Mulai shift | **[V]** |
| Status ketersediaan | `/driver/shift/status` | Online/Istirahat/Offline, Akhiri shift | **[V]** |
| Detail pengantaran | `/driver/deliveries/detail?id=` | Aksi per status | **[V]** |
| Pembayaran tunai | `/driver/deliveries/detail/pay` | Terima uang COD | **[V]** |
| Gagal / Tidak di tempat / Jadwal ulang / Retur | `/driver/deliveries/detail/fail`, `/no-show`, `/reschedule`, `/returns` | Kasus khusus | **[V]** |
| Pendapatan | `/driver/earnings` | Saldo, tarik saldo, rincian | **[V]** |
| Riwayat penghasilan | `/driver/earnings/history` | Buku besar upah | **[V]** |
| Target shift | `/driver/goal` | Target dan insentif | **[V]** |
| Setoran tunai | `/driver/settlement` | Setoran akhir shift | **[V]** |
| Riwayat setoran | `/driver/settlement/history` | Setoran lalu | **[V]** |
| Klaim pengeluaran | `/driver/expenses` | Bensin, parkir, servis | **[V]** |
| Performa mingguan | `/driver/performance` | Peringkat dan SLA | **[V]** |
| Rute multi-stop | `/driver/route` | Urutan stop | **[V]** |
| Pengumuman | `/driver/announcements` | Siaran depot | **[V]** |
| Lapor insiden | `/driver/incidents/new` | Laporan darurat | **[V]** |
| Bantuan & FAQ | `/driver/help` | FAQ dan kontak depot | **[V]** |
| Pengaturan | `/driver/settings` | Notifikasi, tampilan, bahasa | **[V]** |
| Absen & slip gaji | `/hr/me` | HRIS mandiri | **[V]** |

**Baris Profil:** "Kendaraan" (Motor/Mobil/"Belum diatur"; diatur HR, tidak bisa diubah di sini), "Depot penempatan" (diatur HR), "Absen & slip gaji", "Performa mingguan", "Pendapatan", "Setoran tunai (COD)", "Klaim pengeluaran", "Pengumuman", "Lapor insiden", "Pengaturan", "Bantuan & FAQ", "Keluar". Footer "Hydromart Kurir · v1.0.0". **[V]**

**Tidak tersedia untuk kurir:** konsol `/dashboard`, pembayaran QRIS/transfer (aplikasi kurir hanya menangani **tunai**), pengisian meteran air lewat aplikasi kurir (hak akses `meterWrite` ada, tetapi tidak ada tautan; halaman `/dashboard/meter` terbuka lewat URL; belum jelas apakah kurir diminta memakainya **[K]**).

**Hak akses bawaan Staff Depot (ringkas):** antrean pesanan (baca), konfirmasi pembayaran tunai, pembayaran upah kurir, setoran (`courierDeposit`, hanya kurir), retur galon (`courierReturn`, hanya kurir), baca siaran depot, preferensi notifikasi sendiri. **Tidak dimiliki:** penjualan konter, shift kasir, tulis inventori, edit jadwal shift, daftar insiden depot. **[V]**

---

## 6. Prosedur langkah demi langkah

### 6.1 Check-in shift

### Prosedur: Memulai shift (check-in di depot)

**Tujuan:** Membuka shift supaya bisa menerima tugas. **Peran:** Kurir. **Prasyarat:** berada di depot; GPS menyala; belum ada shift terbuka di depot lain. **Titik awal:** `/driver/shift/check-in` (otomatis bila belum ada shift).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka aplikasi. Jika belum ada shift terbuka, layar check-in muncul otomatis. | "Selamat datang, {nama}". "Check-in di depot untuk memulai shift dan menerima tugas." |
| 2 | Baca daftar periksa: "Depot penempatan / Lokasi terverifikasi", "Kendaraan / Kondisi baik · siap jalan", "Baterai HP {n}%". | Baterai di bawah 50% menampilkan "Disarankan isi daya penuh"; selain itu "Daya cukup untuk shift". Baris pertama dan kedua adalah tampilan tetap (hijau); verifikasi sebenarnya dilakukan server saat tombol ditekan. **[B]** |
| 3 | Jika ada antrean: baca "{n} pesanan menunggu di antrian depot untuk shiftmu." | — |
| 4 | Tekan **Mulai shift · check-in**. | Aplikasi membaca GPS lalu mengirim lokasi. Berhasil: Anda diarahkan ke `/driver` dan diminta izin notifikasi (sekali). |

Catatan di layar: "Lokasi terekam sebagai bukti mulai shift."

**Aturan server. [V]** (`shift.service.ts`)
- Anda harus berada dalam radius depot, **bawaan 200 meter** (pengaturan per depot 10–2000 m) **[K]**.
- Jika sudah ada shift terbuka di depot lain, ditolak.
- Jika shift terbuka di depot yang sama dan belum kedaluwarsa, sistem mengembalikan shift itu (aman diulang).
- Shift lama yang terlewat check-out otomatis ditutup pada waktu akhir yang diharapkan, lalu shift baru dibuka.
- Lama shift bawaan 8 jam; jatah istirahat bawaan 60 menit. **[K]**

**Offline:** Bila tidak ada sinyal, check-in disimpan di ponsel: "Tidak ada jaringan. Check-in tersimpan di HP dan otomatis terkirim saat jaringan kembali — shift baru mulai setelah terkirim."

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "You are {n} m from the depot. Check in within {r} m." | Anda {n} meter dari depot; batas {r} m | Dekati depot lalu coba lagi |
| "You already have an open shift. Check out before starting a new one." | Masih ada shift terbuka | Akhiri shift lama (6.2) |
| "Could not verify the depot location. Please try again." | Lokasi depot gagal diverifikasi | Coba lagi sebentar |
| "Akses lokasi ditolak. Izinkan lokasi untuk aplikasi ini di Setelan, lalu coba lagi." | Izin lokasi ditolak | Aktifkan izin lokasi |
| "Lokasi tidak bisa didapat. Nyalakan Lokasi/GPS di perangkat, lalu coba lagi." | GPS mati | Nyalakan GPS |
| "Sinyal lokasi belum ketemu. Coba lagi di tempat yang lebih terbuka." | Waktu tunggu habis | Pindah ke tempat terbuka |
| "Perangkat ini tidak mendukung lokasi." | Perangkat tidak mendukung | Pakai perangkat lain |
| "Gagal check-in. Coba lagi." | Kesalahan umum | Coba lagi |
| "Data offline sudah lebih dari {n} jam. Hubungi admin depot." | Catatan tertunda terlalu tua (bawaan 12 jam) | Hubungi Kepala depot **[D]** |

**Izin & batasan:** Anda hanya menerima tugas baru bila shift berstatus Online. Check-in tidak otomatis menjadi absen karyawan (lihat 6.17). **[V]**

**Daftar periksa:**
- [ ] Berada di depot dan GPS aktif.
- [ ] Baterai cukup (>50%).
- [ ] Status "Online" setelah check-in.

> **[SCREENSHOT REQUIRED: SS-staff-depot-02 — Layar check-in: daftar periksa dan tombol "Mulai shift · check-in"]**
> *Gambar 4.2 — Check-in shift.*

> **[B] Dua "check-in" yang berbeda.** Check-in shift (layanan pengiriman, radius depot 200 m) **tidak terhubung** ke absen wajah karyawan (layanan HR, geofence hanya bila depot mengaturnya). Anda wajib melakukan keduanya. Mana yang dipakai perusahaan untuk menghitung gaji belum diketahui **[K]**. Absen karyawan memengaruhi gaji; check-in shift memengaruhi penugasan dan jendela setoran. **[V]**

---

### 6.2 Status ketersediaan, istirahat, dan akhiri shift

### Prosedur: Istirahat dan mengakhiri shift

**Tujuan:** Menjeda tugas baru dan menutup shift. **Peran:** Kurir. **Titik awal:** pil "Online"/"Istirahat" di kanan atas **Tugas**, atau `/driver/shift/status`.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Tekan pil status di kanan atas halaman **Tugas**. | Layar "Status ketersediaan". |
| 2 | Pilih **Online** ("Menerima tugas baru otomatis"), **Istirahat** ("Jeda sementara · tugas aktif tetap jalan"), atau **Offline** ("Berhenti terima tugas baru"). | Saat Istirahat tampil hitung mundur mm:ss "Sisa jatah istirahat". Info: "Saat istirahat/offline, pesanan baru dialihkan ke kurir lain oleh admin depot." |
| 3 | Saat selesai bekerja, pastikan semua pengantaran selesai, gagal, atau dijadwalkan ulang. | — |
| 4 | Tekan tombol merah **Akhiri shift · check-out**. | Aplikasi membaca GPS lalu menutup shift. Anda kembali ke layar check-in. |

Tanpa shift: "Belum mulai shift" — "Check-in dulu untuk mengatur status ketersediaan."

**Aturan. [V]** (`domain/shift.ts`, `shift.service.ts`)
- Perpindahan yang diizinkan: Online → Istirahat/Offline/Selesai; Istirahat → Online/Offline/Selesai; Offline → Online/Selesai.
- Hanya status Online yang mendapat penugasan.
- Istirahat melebihi jatah **dicatat, bukan diblokir**. Komentar kode menyebut kelebihan bisa menjadi potongan, tetapi sisi gaji belum terverifikasi. **[D]**
- Check-out **tidak** memeriksa radius depot.

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Masih ada {n} pengantaran berjalan. Selesaikan, gagalkan, atau jadwalkan ulang dulu sebelum tutup shift." | Masih ada pengantaran aktif | Selesaikan/gagalkan/jadwalkan ulang |
| "Cannot move a shift from X to Y." | Perpindahan status tidak diizinkan | Muat ulang lalu pilih status lain |

**Daftar periksa:**
- [ ] Tidak ada pengantaran aktif sebelum check-out.
- [ ] Setelah check-out lanjut ke setoran (6.11).

> **[SCREENSHOT REQUIRED: SS-staff-depot-03 — Layar "Status ketersediaan" dengan tiga pilihan dan hitung mundur istirahat]**
> *Gambar 4.3 — Status ketersediaan.*

---

### 6.3 Mengambil pesanan sendiri (opsional per depot)

Kartu "Pesanan belum diambil" muncul di **Tugas** hanya bila depot mengaktifkan `courierSelfClaimEnabled` (bawaan **mati**). **[K]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Baca "Pesanan yang sudah menunggu lebih dari {menit} menit dan belum ada kurirnya." (bawaan 10 menit). | Daftar pesanan. |
| 2 | Tekan **Ambil**. | "Pesanan diambil. Cek daftar pengantaran Anda." |

Kosong: "Tidak ada pesanan yang menunggu." Pesan server: "Ambil pesanan sendiri belum diaktifkan di depot ini." · "Pesanan ini baru masuk. Tunggu sebentar sebelum bisa diambil sendiri." · "Pesanan ini tidak bisa diambil sendiri." · "Pesanan ini sudah diambil orang lain." Pengambilan sendiri tunduk pada batas pengantaran aktif dan syarat shift Online. **[V]**

---

### 6.4 Mengantar pesanan

### Prosedur: Mengambil barang dan mulai mengantar

**Tujuan:** Menjalankan pengantaran dari ditugaskan sampai tiba. **Peran:** Kurir. **Prasyarat:** shift Online; ada tugas dari Kepala depot. **Titik awal:** **Tugas** (`/driver`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka **Tugas**. | "Pengantaran saya"; pil Online/Istirahat; penghitung "Aktif", "Selesai", "Tepat". Kartu tugas aktif: nomor pesanan, lencana status, alamat, satu tombol utama sesuai status. Kosong: "Belum ada tugas aktif" — "Tugas baru akan muncul di sini saat admin depot menugaskan pesanan kepada kamu." |
| 2 | Jika ada spanduk merah siaran mendesak, ketuk untuk membaca. | Menuju **Pengumuman**. |
| 3 | Siapkan barang di depot. Tekan **Konfirmasi barang diambil**. | Status Ditugaskan → Diambil. |
| 4 | Tekan **Mulai antar**. | Status → Diantar. Sistem menghitung estimasi tiba untuk pelanggan. |
| 5 | Buka kartu (nomor pesanan) untuk detail. Gunakan **Navigasi** (membuka Google Maps ke koordinat) dan **Telepon** (menelepon penerima; abu-abu bila tidak ada nomor). | Detail: alamat, jendela antar, "Patokan: {catatan}", "Rincian pesanan" (item × jumlah, chip "COD Rp..."), "Riwayat status" (Ditugaskan → Diambil → Diantar → Selesai dengan jam). |
| 6 | Setibanya di lokasi, lanjutkan ke 6.5 (COD) atau 6.6 (bukti). | — |

**Status pengiriman (label di aplikasi):** Ditugaskan · Diambil · Diantar · Selesai · Gagal · Dijadwalkan ulang. **[V]**

**Aturan penting. [V]**
- Satu kurir hanya boleh memegang **1 pengantaran aktif** (bawaan, per depot 1–20) **[K]**. Rute multi-stop baru bermakna bila depot menaikkan batas ini.
- Pengantaran milik kurir lain: 403 "This delivery is assigned to another driver." (artinya: pengantaran ini ditugaskan ke kurir lain).
- Pembaruan bentrok: 409 "This delivery was already updated. Reload and try again." (sudah diperbarui, muat ulang).
- Sinkronisasi pesanan gagal: 422 "Could not update the order for this delivery. Please try again." (coba lagi).
- Tindakan yang sudah berhasil lalu diulang (retry offline) mengembalikan hasil sebelumnya, bukan error.
- Jika pesanan COD, kartu **Tugas** untuk status Diantar tidak menyediakan "Selesai" langsung; tombolnya "Ambil uang Rp... dulu · buka pesanan". Non-COD: "Selesaikan · ambil bukti".

**Masalah umum:** "Aksi gagal. Coba lagi." atau pesan server di atas. Muat gagal: "Tidak ditemukan".

**Izin & batasan:** Anda tidak bisa memilih pesanan sendiri kecuali fitur ambil-sendiri aktif. Pengalihan pesanan dilakukan Kepala depot.

**Daftar periksa:**
- [ ] Barang cocok dengan rincian pesanan sebelum berangkat.
- [ ] Nomor telepon penerima terlihat.

> **[SCREENSHOT REQUIRED: SS-staff-depot-04 — Layar Tugas dengan satu kartu pengantaran berstatus Ditugaskan dan tombol "Konfirmasi barang diambil"]**
> *Gambar 4.4 — Daftar tugas.*

> **[SCREENSHOT REQUIRED: SS-staff-depot-05 — Detail pengantaran berstatus Diantar: Navigasi, Telepon, Rincian pesanan, Riwayat status, dan baris tombol Tidak di tempat/Jadwal ulang/Gagal]**
> *Gambar 4.5 — Detail pengantaran.*
