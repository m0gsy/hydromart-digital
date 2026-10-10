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

---

### 6.5 Menerima uang tunai (COD)

### Prosedur: Menerima pembayaran tunai di pintu pelanggan

**Tujuan:** Mencatat uang yang diterima dan menghitung kembalian. **Peran:** Kurir (hak `paymentSettle`). **Prasyarat:** pengantaran berstatus Diantar dengan tagihan COD. **Titik awal:** detail pengantaran > **Terima uang Rp...**.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Di detail, perhatikan tombol "Sampai tujuan · ambil bukti" yang **nonaktif**. Petunjuk: "Terima uangnya dulu — Selesai aktif setelah pembayaran tercatat." | Tombol utama **Terima uang Rp...**. |
| 2 | Tekan **Terima uang Rp...**. | Layar "Pembayaran tunai (COD)" dengan nomor pesanan dan "Total tagihan". |
| 3 | Terima uang. Isi **Uang diterima dari pelanggan** (angka saja) atau tekan chip "Uang pas" atau pecahan 50.000/100.000/150.000/200.000 (hanya pecahan yang ≥ total). | "Kembalian" dihitung langsung. |
| 4 | Tekan **Konfirmasi pembayaran** (aktif bila uang ≥ total). | "Pembayaran diterima" dan "Kembalian yang harus diberikan" Rp. |
| 5 | Berikan kembalian. Tekan **Lanjut ke bukti serah terima**. | Kembali ke detail; tombol "Uang sudah diterima" dan "Sampai tujuan · ambil bukti" aktif. Tombol "Retur galon kosong" tersedia. |

**Offline:** "Tunai tersimpan di perangkat" — "Tidak ada sinyal. Uang yang Anda terima sudah dicatat di HP dan dikirim otomatis begitu sinyal kembali. Kembaliannya dihitung server setelah itu." **[V]**

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Kurang dari total tagihan." | Uang kurang | Minta tambahan uang |
| "Tidak ada tagihan tunai yang menunggu untuk pesanan ini. Mungkin sudah dibayar atau bukan COD." | Tidak ada tagihan tunai | Lanjut ke bukti (6.6) |
| "Gagal memuat" / "Gagal konfirmasi. Coba lagi." | Gangguan | Coba lagi |

**Izin & batasan:**
- **Hanya tunai.** Aplikasi kurir tidak punya layar QRIS atau transfer. Pesanan yang sudah dibayar online tidak memiliki langkah COD. **[V]**
- Aturan "uang dulu baru selesai" dijaga **oleh tampilan aplikasi**. Server tidak mengecek pembayaran saat bukti dikirim. Namun uang COD tetap menjadi kewajiban setor Anda walau tidak tercatat (nilai wajib = yang terbesar dari tagihan COD dan uang yang tercatat). **[V]** **[B]**

**Daftar periksa:**
- [ ] Uang dihitung di depan pelanggan.
- [ ] Kembalian benar sesuai layar.

> **[SCREENSHOT REQUIRED: SS-staff-depot-06 — Layar Pembayaran tunai (COD): total tagihan, uang diterima, chip pecahan, kembalian]**
> *Gambar 4.6 — Pembayaran tunai COD.*

---

### 6.6 Bukti antar

### Prosedur: Menyelesaikan pengantaran dengan bukti

**Tujuan:** Merekam bukti serah terima. **Peran:** Kurir. **Prasyarat:** status Diantar; COD sudah dicatat bila ada. **Titik awal:** detail > **Sampai tujuan · ambil bukti**, atau kartu Tugas > **Selesaikan · ambil bukti** (non-COD). Jika koordinat tujuan ada, tampil navigasi langsung (peta, estimasi) dan bukti dibuka saat tiba.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Pada kartu "Bukti pengantaran · {pesanan}" ambil foto: **Foto pengantaran** > **Ambil foto** (atau **Ganti foto**). **Wajib.** | Foto dikompresi. |
| 2 | Pilih **Kondisi segel galon**: "Segel galon utuh & tidak bocor" atau "Segel rusak". **Wajib memilih salah satu.** | — |
| 3 | Isi **Nama penerima** (contoh "Budi Santoso"; maks 120). **Wajib.** | — |
| 4 | (Opsional) minta penerima menandatangani di kotak **Tanda tangan penerima**; **Hapus tanda tangan** untuk mengulang. | Ada catatan privasi UU PDP. |
| 5 | (Opsional) **Catatan (opsional)** (maks 255). | — |
| 6 | Tekan **Selesaikan pengantaran**. | Aplikasi membaca GPS lalu mengirim. Layar "Pengantaran selesai": Penerima, Waktu, Lokasi GPS, Bukti. |
| 7 | Tekan **Tugas berikutnya** atau **Kembali ke daftar**. | — |

Tombol **Batal** menanyakan "Batalkan bukti serah ini? Foto, nama penerima, dan tanda tangan yang sudah diisi akan hilang." bila ada isian.

**Urutan pemeriksaan sebelum kirim (kolom wajib):** foto → kondisi segel → nama penerima. Pesan: "Ambil foto bukti pengantaran dulu." · "Pilih dulu kondisi segel galonnya." · "Isi nama penerima." · "Gagal menyelesaikan pengantaran." **[V]**

> Tanda tangan **opsional**, walau slide perkenalan 2 menyebut foto, tanda tangan, dan GPS "wajib". Server mewajibkan foto, nama penerima, dan koordinat. Tanda tangan, kondisi segel, dan catatan opsional di server. **[B]** Layar sukses menulis "Foto & tanda tangan" walau tanda tangan dilewati. **[B]**

**Aturan server. [V]**
- Jarak lokasi bukti ke alamat selalu diukur. Ditolak hanya bila depot menyalakan `proofRadiusEnforced` (bawaan **mati**) dan jarak melebihi batas (bawaan 500 m): "Bukti antar diambil {m} m dari alamat tujuan (batas {r} m). Pastikan Anda di alamat pelanggan." **[K]**
- Bukti disimpan lebih dulu, lalu pesanan menjadi Delivered lalu Completed. Upah antar dikirim ke layanan penghasilan.
- Mengirim ulang bukti yang sudah selesai mengembalikan hasil sukses (tidak error).
- Bukti disimpan 12 bulan lalu dihapus otomatis sesuai UU PDP.

**Offline:** bukti masuk antrean; layar sukses menampilkan "Tersimpan di HP, menunggu sinyal" dan spanduk "Tersimpan di HP dan akan dikirim otomatis begitu ada sinyal. Serah-terimanya sudah selesai — jangan diulang." Jangan mengulang pengantaran.

**Daftar periksa:**
- [ ] Foto jelas (barang dan lokasi).
- [ ] Segel dicek sebelum memilih kondisi.
- [ ] Nama penerima dieja benar.

> **[SCREENSHOT REQUIRED: SS-staff-depot-07 — Kartu "Bukti pengantaran": foto, kondisi segel, nama penerima, kotak tanda tangan, tombol "Selesaikan pengantaran"]**
> *Gambar 4.7 — Bukti pengantaran.*

---

### 6.7 Pengantaran gagal

### Prosedur: Menandai pengantaran gagal

**Tujuan:** Menutup pengantaran yang tidak bisa dilakukan. **Peran:** Kurir. **Titik awal:** detail > tombol merah **Gagal** (tersedia untuk Ditugaskan, Diambil, Diantar).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Tekan **Gagal**. | Layar "Tandai pengantaran gagal". |
| 2 | Pilih **Alasan**: "Alamat tidak ditemukan", "Pelanggan menolak", "Barang rusak", "Pelanggan tidak bisa dihubungi"; atau tulis di "Atau tulis alasan lain" (maks 255). | Tombol **Tandai gagal** aktif setelah ada alasan. |
| 3 | Bila Anda sudah memegang uang tunai: jawab "Uang tunai {nominal} sudah diterima. Dikembalikan ke pelanggan?" — "Sudah saya kembalikan" (tidak ditagihkan di setoran) atau "Masih saya pegang" (ikut disetor). **Wajib dijawab.** | Jawaban menentukan setoran akhir shift. |
| 4 | Tekan **Tandai gagal**. | Pengantaran Gagal. |

**Akibat. [V]** (`delivery.service.ts:505-560`) Status Gagal bersifat akhir dan **pesanan ikut dibatalkan**. Jika Anda memilih uang sudah dikembalikan, pembayaran tunai dibalik; bila pembalikan tidak bisa dipastikan, seluruh tindakan ditolak. Pesan: "Gagal menandai gagal. Coba lagi." Dapat masuk antrean offline.

> Karena gagal membatalkan pesanan pelanggan, pakai **Jadwal ulang** (6.9) bila pesanan masih bisa diantar.

---

### 6.8 Pelanggan tidak di tempat (no-show)

### Prosedur: Menandai pelanggan tidak di tempat

**Tujuan:** Menutup pengantaran setelah usaha menghubungi pelanggan. **Peran:** Kurir. **Prasyarat:** status Diantar. **Titik awal:** detail > **Tidak di tempat** (hanya saat Diantar).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Tekan **Tidak di tempat**. | Teks "Hubungi pelanggan minimal 2 kali dan tunggu sebelum menandai tidak di tempat." Hitung mundur "Sisa waktu tunggu" (mm:ss). Penghitung "{n} dari {min} percobaan kontak tercatat". |
| 2 | Hubungi pelanggan: **Telepon** atau **Chat WhatsApp**. Tiap upaya tercatat di daftar "Upaya kontak" ("Tercatat"). | Jika tidak ada nomor: "Nomor pelanggan tidak tersimpan di pengantaran ini." Tombol WhatsApp membuka aplikasi WhatsApp Anda sendiri (nomor 0xxx menjadi 62xxx); sistem tidak mengirim pesan. |
| 3 | Setelah jumlah upaya dan waktu tunggu terpenuhi, tekan **Tandai tidak di tempat**. | Lokasi Anda terekam sebagai bukti. Pengantaran Gagal dengan alasan "Pelanggan tidak di tempat (no-show)." dan pesanan dibatalkan. |
| 4 | Bila pelanggan datang: tekan **Pelanggan datang?** > **Lanjut serah terima**. | Kembali ke alur bukti. |

**Ambang. [K]** Bawaan: minimal **2 upaya** kontak dan **300 detik** (5 menit) menunggu. Teks "minimal 2 kali" di layar ditulis tetap, sedangkan nilai sebenarnya bisa diubah per depot. **[B]**

**Masalah umum:** "Gagal mencatat. Coba lagi." · "Gagal menandai. Coba lagi." · "A no-show needs at least {n} contact attempts and {s}s of waiting." (butuh minimal {n} upaya kontak dan {s} detik menunggu).

---

### 6.9 Jadwal ulang

### Prosedur: Menjadwalkan ulang pengantaran

**Tujuan:** Menunda pengantaran ke waktu baru. **Peran:** Kurir. **Titik awal:** detail > **Jadwal ulang** (Ditugaskan/Diambil/Diantar).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Tekan **Jadwal ulang**. | "Jadwal ulang pengantaran". |
| 2 | Isi **Waktu antar baru** (tanggal-jam; tidak boleh sudah lewat). **Wajib.** | — |
| 3 | (Opsional) pilih **Slot**: "Pagi (09:00–12:00)", "Siang (12:00–15:00)", "Sore (15:00–18:00)". (Opsional) **Catatan** (maks 60 untuk slot). | — |
| 4 | Jawab pertanyaan uang tunai bila Anda memegang uang (sama seperti 6.7). | — |
| 5 | Tekan **Simpan jadwal ulang**. | Pengantaran Dijadwalkan ulang, Anda bebas dari tugas. Pesanan kembali ke Disiapkan dan pelanggan diberi tahu. |

**Akibat:** untuk percobaan kedua, **Kepala depot harus menugaskan ulang**. Anda tidak otomatis memegangnya lagi. Pesan: "Waktu antar ulang tidak boleh sudah lewat" · "Gagal menjadwalkan ulang. Coba lagi." Batas jumlah jadwal ulang tidak ditemukan di kode **[D]**. Pengantaran Dijadwalkan ulang tidak tampil di **Riwayat**. **[B]**

---

### 6.10 Retur galon kosong

### Prosedur: Mencatat galon kosong yang dibawa kembali

**Tujuan:** Mencatat galon kosong dari pelanggan. **Peran:** Kurir (hak `courierReturn`, hanya kurir). **Prasyarat:** pengantaran berstatus Diantar. **Titik awal:** detail > **Retur galon kosong**.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Tekan **Retur galon kosong**. | Layar "Retur galon kosong". |
| 2 | Atur **Jumlah galon kembali** dengan tombol "Kurangi"/"Tambah" (1–99). | — |
| 3 | Pilih **Kondisi galon**: "Baik" atau "Rusak". | Catatan: "Galon rusak dicatat tapi tidak mengembalikan deposit." |
| 4 | Tekan **Catat retur**. | "Retur tercatat" — "{n} galon ({baik|rusak}) · deposit dikembalikan" dengan nominal. Bila sudah pernah: "Sudah tercatat sebelumnya". |

Nominal deposit dihitung server dari tarif deposit depot. Kata "deposit dikembalikan" tetap tampil untuk galon rusak walau nilainya 0. **[B]** Tanpa depot terhubung: "Pengantaran ini belum terhubung ke depot, jadi retur tidak bisa dicatat." Gagal: "Gagal mencatat retur. Coba lagi." Offline: "Retur galon tersimpan di perangkat…". **[V]**

---

### 6.11 Setoran akhir shift

### Prosedur: Menyetor uang COD ke kasir

**Tujuan:** Menyerahkan uang tunai yang terkumpul dan mencatatnya. **Peran:** Kurir (hak `courierDeposit`, hanya kurir). **Prasyarat:** shift sudah **berakhir** (check-out). **Titik awal:** **Profil** > "Setoran tunai (COD)", atau **Pendapatan** > "Setor uang tunai" (`/driver/settlement`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Lakukan check-out (6.2). | — |
| 2 | Buka **Setoran tunai (COD)**. | Kartu "Shift selesai" + "Check-out {tanggal jam}". Jika tidak ada: "Tidak ada shift untuk disetor" — "Selesaikan dan check-out shift dulu. Setoran muncul setelah kamu check-out." (tombol "Lihat riwayat setoran"). |
| 3 | Hitung semua uang tunai COD shift ini. | "Hitung semua uang tunai COD yang kamu kumpulkan shift ini, lalu masukkan jumlah yang kamu setor ke kasir." |
| 4 | Isi **Jumlah disetor ke kasir** (angka bulat ≥ 0). **Wajib**; tombol nonaktif bila kosong. | Tampil "Seharusnya disetor" (atau "Belum bisa dibaca") dan "Akan disetor". Bila kurang: "Kurang {nominal} dari yang seharusnya. Selisih kurang dipotong dari upah Anda." Bila lebih: "Lebih {nominal} dari yang seharusnya. Periksa lagi hitungannya." |
| 5 | Serahkan uang fisik ke kasir (Kepala depot/Manajer/Finance). Tekan **Setor ke kasir**. | Kartu "Setoran tercatat" / "Menunggu verifikasi kasir": "Total tagihan COD", "Kamu setor", "Kurang"/"Lebih"/"Selisih". |
| 6 | Tekan **Selesai**. | Menuju riwayat setoran. |

**Cara nilai "Seharusnya" dihitung. [V]** (`settlement.service.ts`) Jumlah COD pada pengantaran Anda yang selesai dalam rentang check-in sampai check-out: untuk pengantaran selesai nilainya yang terbesar antara tagihan COD dan uang yang tercatat dibayar; untuk yang lain, uang tunai yang tercatat dibayar (misal pesanan gagal tetapi uang Anda pegang). Nilai dikunci saat Anda menyetor. Selisih = disetor dikurangi seharusnya (negatif = kurang).

**Arti status. [V]** "Menunggu verifikasi" → "Terverifikasi" atau "Sengketa". Kasir yang memutuskan.

> **[B] Kalimat "dipotong dari upah Anda" tidak selalu benar.** Kekurangan hanya memotong upah bila kasir memverifikasi dengan pilihan *bebankan selisih ke kurir*. Bantuan & FAQ berkata kekurangan "menjadi tanggungan kurir". Kelebihan setoran **tidak** dikreditkan kepada Anda. **[V]**

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Check out of the shift before settling its cash." | Shift belum berakhir | Check-out dulu |
| "This shift has already been settled." | Sudah pernah disetor | Lihat Riwayat setoran |
| "Could not compute the expected cash total. Please try again." | Total yang diharapkan tak terbaca | Coba lagi |
| "Gagal menyetor. Coba lagi." | Kesalahan umum | Coba lagi |

**Izin & batasan:** Satu setoran per shift. **Tidak bisa diedit atau dibatalkan** setelah dikirim dan tidak bisa membantah selisih di aplikasi. Hubungi Kepala depot bila ada keberatan. Aplikasi tidak mengingatkan menyetor dan tenggat setoran tidak ditemukan di kode **[K]**. Setoran **tidak** masuk antrean offline; butuh sinyal. **[V]**

**Riwayat setoran** (`/driver/settlement/history`): lencana Menunggu verifikasi/Terverifikasi/Sengketa; "Total tagihan", "Kamu setor", "Kurang|Lebih", "Selisih dibebankan ke kamu."; tombol "Lihat detail" (Total tagihan, Kamu setor, Selisih, "Dibebankan ke kamu" Ya/Tidak, "Jumlah pesanan", "Diverifikasi", "Catatan kasir"). Kosong: "Belum ada setoran".

**Daftar periksa:**
- [ ] Check-out sebelum setoran.
- [ ] Uang dihitung dua kali.
- [ ] Angka yang diketik = uang yang diserahkan.

> **[SCREENSHOT REQUIRED: SS-staff-depot-08 — Layar setoran: "Seharusnya disetor", kolom jumlah, peringatan kurang, tombol "Setor ke kasir"]**
> *Gambar 4.8 — Setoran tunai akhir shift.*

---

### 6.12 Penghasilan dan penarikan saldo

### Prosedur: Memeriksa penghasilan dan menarik saldo

**Tujuan:** Melihat upah per antar dan mencairkan saldo. **Peran:** Kurir. **Titik awal:** **Profil** > "Pendapatan" (`/driver/earnings`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka **Pendapatan**. | Kartu biru "Saldo tersedia" dan "Bulan ini" (upah + insentif bulan berjalan). Baris tautan "Target shift" dan "Setor uang tunai". |
| 2 | Lihat "Rincian" (8 catatan terakhir; hijau = masuk, merah = keluar). Tekan "Lihat semua" untuk **Riwayat penghasilan**. | Jenis: Upah, Bonus, Potongan, Selisih setoran, Penarikan, Penyesuaian. 20 per halaman; "Sebelumnya"/"Berikutnya"; kosong "Belum ada catatan". |
| 3 | Daftarkan rekening: pada panel penarikan atau kartu "Rekening tujuan pencairan", isi **Nama bank**, **Nomor rekening**, **Nama pemilik rekening**, tekan **Daftarkan rekening** (atau **Ganti rekening**). | Status: "Menunggu verifikasi kantor pusat" → "Terverifikasi" atau "Ditolak: {alasan}". |
| 4 | Tekan **Tarik saldo** (nonaktif bila saldo ≤ 0). Isi **Jumlah penarikan**. | Panel "Tarik saldo". |
| 5 | Tekan **Tarik** (aktif bila jumlah > 0, ≤ saldo, dan rekening terverifikasi). | Saldo langsung berkurang; penarikan berstatus "Diproses". Kemudian "Terkirim" atau "Gagal" (saldo dikembalikan, catatan "Penarikan gagal, saldo dikembalikan"). |

Daftar "Riwayat penarikan" menampilkan 5 terakhir.

**Pesan:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Jumlah melebihi saldo tersedia." | Melebihi saldo | Kurangi |
| "Daftarkan rekening dan tunggu verifikasi sebelum menarik saldo." / "Belum ada rekening tujuan yang terverifikasi. Daftarkan rekening dan tunggu verifikasi kantor pusat sebelum menarik saldo." | Rekening belum terverifikasi | Tunggu Kantor pusat |
| "Withdrawal amount must be greater than zero." | Jumlah ≤ 0 | Isi jumlah positif |
| "Withdrawal of {x} exceeds available balance {y}." | Penarikan melebihi saldo | Kurangi |
| "Gagal menarik saldo. Coba lagi." | Kesalahan umum | Coba lagi |

**Cara upah dihitung. [V]** Per pengantaran selesai: tarif dasar + bonus jam sibuk (bila selesai dalam jendela sibuk) + bonus tepat waktu (bila selesai dalam batas SLA depot sejak penugasan, bawaan 120 menit). Bonus berjenjang bulanan dikreditkan sekali saat jumlah antar bulan mencapai jenjang ("Bonus {n} pengiriman"). **Nilai rupiahnya adalah data** yang diatur Finance/Super admin dan tidak tercantum di kode **[K]**. Jika depot belum punya aturan upah, upah tidak tercatat (tanpa pemberitahuan). **[V]** Potongan: "Selisih kurang setoran COD" (bila dibebankan); Penyesuaian +: "Klaim pengeluaran disetujui".

**Pencairan dilakukan manual** oleh Finance/Super admin (diduga). Jadwal pencairan tidak ditemukan di kode; FAQ berbunyi "sesuai jadwal payout depot" dan juga "bisa ditarik kapan saja". Pertanyaan FAQ "payout mingguan" bertentangan dengan penarikan kapan saja. **[K]** **[B]**

**Target shift** (`/driver/goal`): progres pekan ini terhadap target mingguan (bawaan 45 pesanan **[K]**), "Penghasilan bulan ini", "Insentif berjenjang" ("Bonus {nominal} · diterima/kurang {n} antar/terkunci", "Dihitung per bulan berjalan di depotmu").

> **[SCREENSHOT REQUIRED: SS-staff-depot-09 — Layar Pendapatan: Saldo tersedia, Bulan ini, tombol Tarik saldo, panel rekening]**
> *Gambar 4.9 — Pendapatan dan penarikan.*

---

### 6.13 Klaim pengeluaran

### Prosedur: Mengajukan klaim bensin, parkir/tol, servis

**Tujuan:** Mengganti biaya yang Anda keluarkan. **Peran:** Kurir. **Titik awal:** **Profil** > "Klaim pengeluaran" (`/driver/expenses`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Pilih **Jenis pengeluaran**: Bensin, Parkir / tol, Servis kendaraan, Lainnya. | — |
| 2 | Isi **Jumlah** (rupiah bulat > 0). | — |
| 3 | Isi **Keterangan** (contoh "bensin shift pagi"; maks 280). **Wajib.** | — |
| 4 | Ambil **Foto struk** dengan kamera. | "Struk siap diunggah." Petunjuk: "Wajib untuk persetujuan otomatis. Tanpa struk, klaim menunggu persetujuan depot." |
| 5 | Tekan **Kirim klaim** (aktif bila jumlah > 0 dan keterangan terisi). | Klaim masuk "Riwayat klaim" dengan status "Menunggu" (kuning), "Disetujui" (hijau), atau "Ditolak" (merah, "Alasan: {catatan}"). |

**Aturan persetujuan. [V]**
- **Otomatis disetujui** bila struk valid (gambar ada dan belum dipakai klaim lain) **dan** jumlah ≤ Rp50.000 (bawaan; depot hanya boleh menurunkan) **[K]**. Saldo langsung bertambah ("Disetujui otomatis (di bawah ambang)").
- Selain itu **menunggu persetujuan Manajer atau Finance** (bukan Kepala depot). Manajer menyetujui sampai Rp500.000 (bawaan); di atas itu hanya Finance/Super admin. Manajer boleh menolak di atas batas.
- Klaim disetujui → saldo bertambah (dicairkan lewat Tarik saldo). Ditolak → tidak ada uang; alasan terlihat.
- Teks bantuan menyebut "persetujuan depot" dan catatan kaki menyebut "manajer"; yang menyetujui sebenarnya Manajer/Finance. **[B]**

**Pesan:** "Gagal mengirim klaim. Coba lagi." · kosong "Belum ada klaim" · "Klaim di atas Rp500.000 harus disetujui FINANCE." (tampil di sisi penyetuju) · "Only a pending expense claim can be approved or rejected." (hanya klaim berstatus menunggu yang dapat diputuskan). Klaim tidak masuk antrean offline dan tidak bisa diedit atau ditarik setelah dikirim. **[V]**

**Eskalasi:** klaim lama tertahan → hubungi Kepala depot agar menyampaikan ke Manajer.

---

### 6.14 Fitur lain: insiden, pengumuman, performa, rute, riwayat, pengaturan, bantuan, dan antrean offline

**Lapor insiden** (`/driver/incidents/new`, dari Profil > "Lapor insiden"):

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Pilih **Jenis insiden**: Kecelakaan, Kendaraan mogok, Pencurian / ancaman, Sengketa pelanggan, Barang rusak, Lainnya. **Wajib.** | — |
| 2 | Pilih **Tingkat**: Ringan, Sedang (bawaan), Darurat. | — |
| 3 | Isi **Kronologi** ("Jelaskan singkat apa yang terjadi"; 3–1000 karakter). **Wajib.** (Opsional) **Foto bukti (opsional)**. | — |
| 4 | Tekan **Kirim laporan**. | "Laporan terkirim". Darurat: "Insiden darurat diteruskan ke tim operasional. Tetap di tempat aman." Lainnya: "Terima kasih. Laporanmu sudah dicatat." Tombol "Kembali ke tugas". Gagal: "Gagal mengirim laporan. Coba lagi." |

Hanya laporan **Darurat** yang diteruskan ke operasional; Ringan dan Sedang hanya dicatat. Halaman bantuan menyebut "lokasi terkirim ke depot & ops", tetapi laporan tidak membawa koordinat. **[B]** Dalam keadaan darurat sebenarnya, **telepon Kepala depot atau nomor darurat dulu**. Laporan tidak dibaca seketika. **[D]** Laporan tidak masuk antrean offline.

**Pengumuman depot** (`/driver/announcements`): siaran dari Kepala depot/Manajer. Lencana "Mendesak", "Terjadwal", "Info"; titik "Belum dibaca"; semua otomatis ditandai dibaca saat dibuka. Spanduk merah di **Tugas** untuk siaran mendesak yang belum dibaca. Kosong: "Belum ada pengumuman". Tanpa depot: "Belum ada depot penempatan". Ini **berbeda** dari pengumuman HR di `/hr/me/announcements`. **[V]**

**Riwayat** (`/driver/history`): penghitung "Selesai" dan "Gagal", baris nomor pesanan, alamat/alasan gagal, waktu; ketuk untuk detail. Kosong "Belum ada riwayat". Pengantaran Dijadwalkan ulang tidak tampil. **[B]**

**Performa mingguan** (`/driver/performance`): navigasi pekan, "Peringkat depot minggu ini" (naik/turun), "Antar selesai", "Rating", "Antar per hari", "Tepat waktu (SLA)", "Gagal antar", "Target mingguan".

**Rute multi-stop** (`/driver/route`): urutan stop, jarak, "Mulai rute · stop 1"; kosong "Belum ada rute aktif". Muncul bila Anda punya beberapa pengantaran aktif, yang hanya mungkin jika depot menaikkan batas aktif (bawaan 1). **[D]**

**Pengaturan** (`/driver/settings`): Notifikasi (Tugas baru, Pesan pelanggan, Payout & insentif, Promo & pengumuman, Jangan ganggu "Di luar shift · 22.00 – 05.00"); Tampilan (Terang/Gelap/Sistem); Bahasa (Indonesia/English). Preferensi notifikasi tersimpan per akun; bahasa dan tema per perangkat.

**Bantuan & FAQ** (`/driver/help`): pencarian, kategori ("Bukti antar", "COD & setoran", "Penghasilan", "Shift & tugas"), 5 pertanyaan, "Kontak darurat depot" dengan tombol "Telepon" dan "Chat admin". Teks FAQ "minimal 5 menit" (no-show) sesuai nilai bawaan. **[V]**

**Antrean offline.** Bila sinyal hilang, tindakan ini disimpan di ponsel dan dikirim ulang otomatis: Absen wajah, Mulai shift, Bukti pengantaran, Uang tunai diterima, Retur galon kosong, Pengantaran gagal, Jadwal ulang. **Tidak** masuk antrean: konfirmasi diambil, mulai antar, tidak di tempat, setoran, klaim pengeluaran, penarikan, laporan insiden. Pengiriman ulang mencoba sampai 6 kali dengan jeda bertambah. Penolakan bisnis (4xx) tetap di antrean dengan pesan server untuk Anda buang. Spanduk: "{jumlah} data belum terkirim" + **Kirim sekarang**. Tombol buang memunculkan "Buang data ini?": 'Buang "{jenis}" dari antrean? Ini satu-satunya salinannya — tidak dikirim ulang dan tidak pernah sampai ke server. Kalau ini konfirmasi COD, uangnya sudah diterima tapi tidak akan pernah tercatat.' **Jangan membuang** konfirmasi COD kecuali Kepala depot menyetujui. **[V]**

> **[SCREENSHOT REQUIRED: SS-staff-depot-10 — Spanduk "{n} data belum terkirim" dengan tombol "Kirim sekarang" dan dialog "Buang data ini?"]**
> *Gambar 4.10 — Antrean offline.*

> **[SCREENSHOT REQUIRED: SS-staff-depot-11 — Formulir Lapor insiden dengan jenis, tingkat, kronologi]**
> *Gambar 4.11 — Lapor insiden.*

---

## HRIS mandiri (/hr/me) — gambaran

Bagian 6.15–6.20 membahas HRIS mandiri. Gerbangnya: `canPunchAttendance` (Staff Depot/kurir, Kepala depot, Asisten SPV, SPV, Super admin). Server tidak membatasi menurut peran tetapi menuntut akun tertaut ke data karyawan aktif. Layar adalah halaman sederhana tanpa tab; tautan "← Kembali ke konsol" membawa kurir kembali ke `/driver`. **[V]**

### 6.15 Menu /hr/me

Masuk dari **Profil** > "Absen & slip gaji". Sapaan "Halo, {nama}" — "Layanan mandiri karyawan". Kartu: **Absen Sekarang** ("Check-in / check-out dengan verifikasi wajah"), **Absensi Saya**, **Slip Gaji Saya**, **Cuti Saya** ("Ajukan cuti & lihat sisa kuota"), **Kasbon**, **Pengumuman** ("Kabar dari HR untuk Anda"), **Daftar / Perbarui Wajah**, dan "← Kembali ke konsol". **[V]**

> **[SCREENSHOT REQUIRED: SS-staff-depot-12 — Menu /hr/me dengan semua kartu]**
> *Gambar 4.12 — Menu layanan mandiri karyawan.*

### 6.16 Daftar wajah (wajib sebelum absen pertama)

### Prosedur: Mendaftarkan wajah

**Tujuan:** Menyimpan data wajah untuk absen. **Peran:** Kurir. **Prasyarat:** izin kamera; akun tertaut ke karyawan. **Titik awal:** `/hr/me/enroll` ("Daftar Wajah").

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka **Daftar / Perbarui Wajah**. | "Daftar Wajah" — "Ambil 1–3 foto wajah yang jelas untuk absensi". Pratinjau kamera depan. |
| 2 | Tekan **Ambil Foto** hingga 3 kali. Gerakkan kepala sedikit atau kedipkan mata. | Penghitung "{n} foto siap". Tombol ambil nonaktif setelah 3 foto. |
| 3 | Centang **Persetujuan data wajah** ("Saya setuju foto wajah saya diproses menjadi data biometrik untuk absensi. Saya bisa menarik persetujuan ini kapan saja, dan datanya dihapus."). **Wajib.** | Tombol **Simpan** aktif. |
| 4 | Tekan **Simpan** (atau **Reset** untuk mengulang). | Toast "Wajah berhasil didaftarkan" dan kartu "Wajah terdaftar. Kamu bisa absen sekarang." |

**Menarik persetujuan:** tombol "Tarik persetujuan & hapus data wajah" > konfirmasi "Hapus data wajah Anda? Absensi wajah berhenti bekerja sampai Anda mendaftar lagi." > toast "Data wajah dihapus".

| Pesan | Arti | Solusi |
|---|---|---|
| "Gagal enroll" | Pendaftaran gagal | Coba lagi |
| "Minimal satu frame wajah diperlukan" | Belum ada foto | Ambil foto |
| "Wajah ini sudah terdaftar untuk karyawan lain" | Wajah sama dengan karyawan lain (kemiripan di atas 0,75) | Hubungi HR |
| "Karyawan ini belum menyetujui pemakaian data wajah. Rekam persetujuannya dulu." | Persetujuan belum dicentang | Centang persetujuan |
| Kamera ditolak ("Coba lagi") | Izin kamera ditolak | "Kalau izin kamera pernah ditolak, aktifkan lagi lewat setelan peramban, lalu tekan Coba lagi." |

HR juga dapat mendaftarkan wajah atas nama karyawan. **[V]**

### 6.17 Absen wajah (check-in / check-out)

### Prosedur: Absen masuk dan pulang

**Tujuan:** Mencatat kehadiran karyawan. **Peran:** Kurir. **Prasyarat:** wajah terdaftar; GPS aktif. **Titik awal:** **Absen Sekarang** (`/hr/me/check-in`, "Absensi Wajah").

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka **Absen Sekarang**. Baca "Hari ini: depot {nama}". | Tombol pilihan **Check-in** (bawaan) / **Check-out**. |
| 2 | Pilih Check-in atau Check-out. Tekan **Ambil Foto**. | Uji kehidupan sederhana: dua bingkai dibandingkan (~350 ms). Jika gagal: "Deteksi wajah kurang meyakinkan. Gerakkan kepala/kedip lalu coba lagi." (tidak ada yang terkirim). |
| 3 | Izinkan lokasi. | Bila GPS tak ada: "Perangkat tidak mendukung GPS" / "Izinkan akses lokasi (GPS) untuk absen". |
| 4 | Tunggu hasil. | Toast "Check-in berhasil" / "Check-out berhasil". Kartu: status, "Masuk {HH:mm}", " · Keluar {HH:mm}", " · Terlambat {n} menit". |

Offline: "Tidak ada sinyal. Absen disimpan di perangkat dan dikirim otomatis nanti." **[V]**

**Aturan server. [V]** (`attendance.service.ts`)
- Wajah harus cocok (ambang 0,62 bawaan).
- Satu check-in per hari; check-out butuh check-in. Shift malam: baris hari sebelumnya yang masih terbuka (≤24 jam) ditutup.
- **Geofence** hanya berlaku bila depot mengatur titik dan radius (bawaan radius 0 = nonaktif; GPS hanya direkam). Bila aktif dan Anda di luar: "Di luar area absen depot ({m} m dari titik). Absen harus di lokasi." **[K]**
- Terlambat dihitung terhadap jam mulai shift ditambah toleransi (bawaan 15 menit); status Terlambat dan potongan terlambat bawaan Rp10.000 per kejadian **[K]**.
- Absen offline diterima bila sampai ke server dalam 10 menit (bawaan); lebih lama berstatus "Menunggu persetujuan" untuk HR; lebih dari 24 jam ditolak: "Absen offline sudah terlalu lama. Minta entri manual ke HR."
- Pesan: "Wajah tidak cocok" · "Wajah belum di-enroll" · "Sudah check-in hari ini" · "Belum check-in hari ini" · "Sudah check-out hari ini".

**Status kehadiran:** Hadir, Terlambat, Absen, Cuti, Libur, "Menunggu persetujuan" (HR yang memutuskan). **[V]**

**Absensi Saya** (`/hr/me/attendance`): daftar 60 per halaman (tanggal, masuk–keluar, "+{n}m" terlambat, status). Koreksi hanya lewat HR; Anda tidak bisa membantah di aplikasi. **[B]**

**Eskalasi:** salah absen, "Menunggu persetujuan" tertahan, atau wajah tidak dikenali → **Kepala depot**, lalu HR.

> **[SCREENSHOT REQUIRED: SS-staff-depot-13 — Layar Absensi Wajah: pilihan Check-in/Check-out, kamera, hasil "Check-in berhasil"]**
> *Gambar 4.13 — Absen wajah.*

### 6.18 Cuti

### Prosedur: Mengajukan cuti

**Tujuan:** Meminta cuti. **Peran:** Kurir. **Titik awal:** **Cuti Saya** (`/hr/me/leave`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka **Cuti Saya**. | Teks "Kuota {kuota} hari · terpakai {n} · sisa {n}". |
| 2 | Pilih **Jenis cuti**: Cuti tahunan (potong kuota), Sakit, Izin (potong kuota), Darurat. | — |
| 3 | Isi **Mulai** dan **Selesai** (tanggal) dan **Alasan** (contoh "Acara keluarga"; maks 300). **Semua wajib.** | Petunjuk: hari libur nasional dan libur mingguan tidak memotong kuota. |
| 4 | Tekan **Ajukan Cuti**. | Toast "Pengajuan cuti terkirim". |

Pesan klien: "Tanggal mulai dan selesai wajib diisi." · "Alasan wajib diisi." Pesan server: "Tanggal selesai sebelum tanggal mulai" · "Rentang tanggal tidak memuat hari kerja" · "Sudah ada pengajuan cuti pada rentang tanggal tersebut" · "Sisa kuota cuti {x} hari, pengajuan {y} hari". Gagal: "Gagal mengirim pengajuan."

**Alur persetujuan. [V]** Menunggu atasan → Menunggu HR → Disetujui; Ditolak (alasan wajib) di salah satu tahap; Dibatalkan. Tahap 1: **Manajer** atau HR. Tahap 2: **HR/Kantor pusat/Direktur**. Orang tahap 2 harus berbeda dari tahap 1; tidak ada yang memutuskan cuti sendiri. **Kepala depot tidak menyetujui cuti kurir.** Atasan diberi tahu saat pengajuan. Setelah disetujui akhir, hari kerja dalam rentang tercatat "Cuti" dan kuota terpotong (tahunan dan izin saja).

**Batalkan:** tombol **Batalkan** saat masih menunggu > konfirmasi "Batalkan pengajuan cuti ini? Pengajuan ditarik dari antrean atasan, dan mengajukan ulang berarti memulai persetujuan dari awal." Cuti **Disetujui tidak bisa dibatalkan sendiri** (409 "Pengajuan berstatus APPROVED tidak bisa cancel"); minta HR. **[V]** **[B]** Kuota tahunan bawaan 12 hari, dihitung proporsional pada tahun masuk **[K]**. Tidak ada kolom lampiran (surat dokter) di UI. **[B]**

### 6.19 Kasbon

### Prosedur: Mengajukan kasbon

**Tujuan:** Meminta pinjaman uang muka gaji. **Peran:** Kurir. **Titik awal:** **Kasbon Saya** (`/hr/me/kasbon`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Isi **Nominal (Rp)** (bulat > 0; contoh 500000). | — |
| 2 | Isi **Alasan** ("Untuk apa kasbon ini dipakai"; maks 300). | — |
| 3 | Tekan **Ajukan Kasbon**. | "Pengajuan kasbon terkirim." Muncul di "Riwayat pengajuan". |

Hanya **satu pengajuan terbuka** pada satu waktu: 409 "Masih ada pengajuan kasbon yang belum diputuskan." Anda **tidak** menentukan cicilan atau bulan mulai potong; penyetuju yang menentukan. Pesan klien: "Nominal harus lebih dari 0." · "Alasan wajib diisi." Gagal: "Pengajuan kasbon gagal dikirim."

**Siapa memutuskan. [V]** Asisten SPV depot Anda, bila ada di data depot. Jika depot tidak punya, Manajer atau HR (eskalasi). Penyetuju menetapkan "Cicilan per bulan (Rp)" dan "Mulai potong (YYYY-MM)". Setelah disetujui, gaji dipotong tiap bulan sebesar cicilan (atau sisa) sampai lunas, muncul sebagai potongan "Kasbon" di slip. **Kepala depot tidak menyetujui kasbon.** Tidak ada batas nominal di kode; batas ada pada kebijakan penyetuju **[K]**. Pencairan uang kasbon sendiri tidak dilacak di aplikasi **[D]**.

**Batalkan:** tombol **Batalkan** saat PENDING > konfirmasi "Batalkan pengajuan kasbon ini? Pengajuan ditarik dari antrean penyetuju." Status: Menunggu keputusan, Disetujui ("Disetujui — potongannya muncul di daftar kasbon dan di slip gaji."), Ditolak ("Alasan penolakan: {catatan}"), Dibatalkan. Pesan: "Pengajuan dibatalkan." · "Pengajuan gagal dibatalkan." · 409 "Pengajuan ini sudah diputuskan."

### 6.20 Slip gaji dan pengumuman HR

**Slip Gaji Saya** (`/hr/me/payroll`): daftar 24 terbaru (periode YYYY-MM, hari hadir, tanggal buat, gaji bersih, status Draft/Disetujui/Dibayar). Detail: "Slip Gaji {periode}", "{n} hari hadir", rincian item (potongan merah: Terlambat, Mangkir, Kasbon, BPJS dan sebagainya), "Gaji Bersih (Net)", kartu "Gross", "Bonus", "Potongan", tombol **Unduh PDF** (gagal: "Gagal unduh"). Kosong: "Belum ada slip gaji". **[V]**

- Slip berstatus **Draft** juga terlihat sebelum HR menyetujui. Angka dapat berubah. **[B]**
- Slip orang lain: 404 "Payroll tidak ditemukan".
- Rumus komponen gaji berasal dari pengaturan HR (tarif harian/bulanan, potongan terlambat bawaan Rp10.000, lembur ×1,5 hari kerja dan ×2 hari libur, BPJS Kesehatan karyawan 1%, JHT 2%, JP 1%). **[K]** Penghasilan per antar ada di dompet kurir (`/driver/earnings`), terpisah dari slip gaji. Apakah kurir menerima gaji harian **dan** upah per antar adalah kebijakan bisnis yang belum diketahui. **[K]**

**Pengumuman HR** (`/hr/me/announcements`): judul, tingkat (Informasi, Perhatian, Mendesak), tag "Baru", isi, tanggal, tombol **Tandai sudah dibaca**. Kosong "Belum ada pengumuman untuk Anda." Gagal: "Gagal menandai sudah dibaca." Berbeda dari pengumuman depot di aplikasi kurir.

---

## 7. Kolom wajib & aturan validasi (ringkasan)

| Formulir | Kolom wajib | Batas/format |
|---|---|---|
| Check-in shift | GPS | Dalam 200 m dari depot (bawaan) |
| Pembayaran tunai | Uang diterima | ≥ total tagihan |
| Bukti antar | Foto, kondisi segel, nama penerima | Nama ≤120; catatan ≤255; tanda tangan opsional |
| Gagal | Alasan; jawaban uang tunai bila memegang | Alasan ≤255 |
| Tidak di tempat | Upaya kontak dan waktu tunggu | Bawaan 2 upaya, 300 detik |
| Jadwal ulang | Waktu antar baru | Tidak boleh lampau; slot ≤60 |
| Retur galon | Jumlah, kondisi | 1–99 |
| Setoran | Jumlah disetor | Bulat ≥ 0; shift sudah berakhir |
| Tarik saldo | Jumlah; rekening terverifikasi | > 0 dan ≤ saldo |
| Klaim pengeluaran | Jenis, jumlah, keterangan | Jumlah > 0; keterangan ≤280; struk untuk persetujuan otomatis |
| Insiden | Jenis, kronologi | Kronologi 3–1000 |
| Daftar wajah | 1–3 foto, persetujuan | — |
| Cuti | Jenis, mulai, selesai, alasan | Alasan ≤300 |
| Kasbon | Nominal, alasan | Bulat >0; alasan ≤300; satu terbuka |

---

## 8. Kesalahan umum & solusi

| Gejala | Penyebab | Solusi |
|---|---|---|
| Pesan error berbahasa Inggris | Pesan server belum diterjemahkan | Gunakan terjemahan di tabel tiap prosedur; semua pesan Inggris di bab ini diberi arti |
| Tombol "Sampai tujuan · ambil bukti" nonaktif | COD belum dicatat | Terima uang dulu (6.5) |
| Tidak bisa check-out | Masih ada pengantaran aktif | Selesaikan, gagalkan, atau jadwalkan ulang |
| Tidak bisa setor | Shift belum berakhir | Check-out dulu |
| Tidak mendapat tugas | Status bukan Online; atau Kepala depot belum menugaskan | Cek pil status; hubungi Kepala depot |
| Tidak bisa tarik saldo | Rekening belum terverifikasi atau saldo 0 | Daftarkan rekening; tunggu Kantor pusat |
| "Akun ini bukan kurir" | Salah akun | Masuk dengan akun kurir |
| "Akun ini belum tertaut ke data karyawan" | HR belum menautkan | Hubungi HR |
| Spanduk "data belum terkirim" | Tindakan menunggu sinyal | Cari sinyal, tekan Kirim sekarang |
| Check-in "You are {n} m from the depot" | Di luar radius | Datang ke depot |

---

## 9. Batasan peran (apa yang TIDAK bisa; butuh persetujuan siapa)

### 9.1 Yang tidak tersedia

- Tidak ada konsol `/dashboard` sebagai halaman awal. **[V]**
- Tidak bisa menugaskan pesanan, mengubah status pesanan, atau mengatur jadwal shift (hak `driverRoster` bukan milik kurir; jadwal hanya dibaca).
- Tidak bisa memverifikasi setoran, menjual di konter, mengubah stok, atau menyetujui apa pun.
- Tidak ada QRIS atau transfer di aplikasi kurir.
- Tidak bisa mengedit atau membatalkan setoran, klaim, atau cuti yang sudah disetujui.
- Tidak bisa membantah selisih setoran atau absensi di aplikasi.

### 9.2 Apa yang butuh persetujuan peran lain

| Tindakan | Diputuskan oleh | Bukti |
|---|---|---|
| Penugasan pengantaran | **Kepala depot** (atau Manajer/SPV/Asisten SPV); atau ambil sendiri bila depot mengaktifkan | **[V]** |
| Penugasan ulang setelah jadwal ulang | **Kepala depot** | **[V]** |
| Verifikasi setoran COD dan keputusan beban selisih | **Kepala depot**, Manajer, Finance, atau Super admin | **[V]** |
| Klaim pengeluaran ≤ Rp50.000 dengan struk sah | Otomatis (tanpa orang) | **[V]** |
| Klaim pengeluaran di atas itu | **Manajer** (sampai Rp500.000); **Finance**/Super admin di atasnya | **[V]** |
| Verifikasi rekening pencairan | **Kantor pusat** | **[V]** |
| Pencairan penarikan ("Terkirim"/"Gagal") | Finance/Super admin (diduga) | **[D]** |
| Cuti | Tahap 1 **Manajer** atau HR; tahap 2 **HR**/Kantor pusat/Direktur | **[V]** |
| Kasbon | **Asisten SPV** depot (bila ada), jika tidak Manajer/HR | **[V]** |
| Koreksi absen, absen "Menunggu persetujuan" | **HR** | **[V]** |
| Slip gaji disetujui dan dibayar | **HR/Finance** | **[V]** |
| Pembatalan pesanan, refund | Kepala depot (batal pengiriman), Manajer/Finance (refund) | **[V]** |

### 9.3 Eskalasi

1. **Masalah di jalan** (kecelakaan, ancaman, barang rusak): laporkan lewat **Lapor insiden** dan segera hubungi **Kepala depot**; pakai "Kontak darurat depot" di Bantuan & FAQ.
2. **Masalah penugasan/tugas/uang tunai/setoran/klaim lama:** **Kepala depot**. Bila tidak terjawab, **SPV/Asisten SPV** atau **Manajer** depot.
3. **Absen, cuti, kasbon, slip gaji, wajah, penempatan depot, kendaraan:** **HR**.
4. **Rekening pencairan, penarikan tertahan:** **Kantor pusat/Finance** (lewat Kepala depot).

**[K]** Jalur eskalasi yang tepat (nomor, jam) belum tercantum di kode; "Kontak darurat depot" berisi nomor yang diatur depot.

### 9.4 Catatan tentang peran

Di kode, `STAFF_DEPOT` adalah kurir dan **tidak** punya konsol `/dashboard` sebagai landing; ia diarahkan ke `/driver` (cadangan `/hr/me`). Petugas depot yang memakai konsol adalah Kepala depot. **[V]**

---

## 10. Pertimbangan keamanan

- **Lokasi dan foto** Anda direkam saat check-in, bukti antar, dan absen. Data wajah bersifat biometrik; Anda dapat menarik persetujuan dan menghapusnya.
- **Uang tunai.** Uang COD adalah tanggung jawab Anda sampai diverifikasi kasir. Setor di akhir shift dan jangan menunda.
- **Jangan membuang antrean offline** tanpa tahu isinya (konfirmasi COD hilang selamanya).
- **Jangan berbagi kode OTP** atau meminjamkan ponsel yang sedang masuk.
- **Privasi pelanggan.** Nomor dan alamat pelanggan hanya untuk mengantar. Jangan menyimpan atau membagikan. Bukti antar disimpan 12 bulan lalu dihapus sesuai UU PDP.
- **Keluar** dari aplikasi (Profil > Keluar) bila ponsel dipakai bersama.
- Hak akses di bab ini adalah nilai bawaan; Super admin dapat mengubahnya (±30 detik).

---

## 11. Kegiatan akhir hari/berkala

**Awal shift:**
1. Datang ke depot (≤ 200 m). Buka aplikasi, **Mulai shift · check-in**.
2. **Absen wajah** (`/hr/me/check-in`) — terpisah dari check-in shift.
3. Pastikan status **Online**; baca **Pengumuman**.

**Sepanjang shift:** Konfirmasi diambil → Mulai antar → (COD: Terima uang) → Bukti → Tugas berikutnya. Masalah: Tidak di tempat / Jadwal ulang / Gagal. Istirahat lewat pil status (jatah bawaan 60 menit).

**Akhir shift:**
1. Selesaikan, gagalkan, atau jadwalkan ulang semua pengantaran aktif.
2. **Akhiri shift · check-out**.
3. **Setoran tunai (COD)**: hitung, ketik jumlah, **Setor ke kasir**, serahkan uang. Pantau status verifikasi.
4. **Absen wajah** Check-out.
5. Periksa **Pendapatan** dan **Riwayat penghasilan**.

**Berkala:** klaim pengeluaran (dengan struk), penarikan saldo, performa mingguan, cuti/kasbon bila perlu, slip gaji tiap periode.

**Tugas sistem yang memengaruhi Anda:** pesanan tertahan di depot lebih dari 24 jam dibatalkan otomatis; peringatan SLA dikirim ke operator bila pengantaran terlambat; shift yang lupa check-out ditutup otomatis pada waktu akhir saat Anda check-in berikutnya; foto bukti dihapus sesuai kebijakan retensi (harian 03:30 WIB). **[V]** (temuan I)

---

## 12. Skenario praktis

**Skenario A — Pelanggan COD Rp60.000 membayar Rp100.000.** Di layar pembayaran pilih chip 100.000 atau ketik 100000. Layar menampilkan kembalian Rp40.000. Konfirmasi, berikan kembalian, lanjut ke bukti.

**Skenario B — Alamat tidak ditemukan, pelanggan tidak mengangkat telepon.** Telepon dua kali lewat **Tidak di tempat**, tunggu 5 menit, lalu tandai. Atau tandai **Gagal** dengan alasan "Alamat tidak ditemukan". Keduanya membatalkan pesanan; bila masih bisa dicoba lagi, gunakan **Jadwal ulang**.

**Skenario C — Pelanggan sudah bayar tetapi menolak barang.** Pada **Gagal**, jawab "Sudah saya kembalikan" bila uang dikembalikan; jika tidak, pilih "Masih saya pegang" supaya ikut disetor.

**Skenario D — Sinyal hilang saat bukti.** Selesaikan bukti seperti biasa. Layar menampilkan "Tersimpan di HP, menunggu sinyal". Jangan ulangi. Spanduk akan terkirim begitu sinyal kembali.

**Skenario E — Setoran kurang Rp10.000.** Layar menampilkan peringatan kurang. Ketik jumlah sebenarnya dengan jujur. Kasir memutuskan apakah dipotong dari upah. Jika berkeberatan, bicarakan dengan Kepala depot.

**Skenario F — Klaim bensin Rp30.000.** Foto struk, isi klaim. Disetujui otomatis dan saldo bertambah. Klaim Rp80.000 menunggu Manajer.

---

## 13. Daftar periksa penyelesaian

- [ ] Saya paham bahwa Staff Depot = kurir dan tidak punya konsol `/dashboard`.
- [ ] Bisa check-in shift (≤200 m) dan check-out.
- [ ] Bisa mengantar dari diambil sampai bukti.
- [ ] Bisa menerima COD dan memberi kembalian.
- [ ] Tahu kapan memakai Gagal, Tidak di tempat, Jadwal ulang.
- [ ] Bisa menyetor COD setelah check-out.
- [ ] Bisa mengajukan klaim dan menarik saldo.
- [ ] Wajah terdaftar dan bisa absen.
- [ ] Tahu siapa yang menyetujui cuti/kasbon/klaim/setoran dan ke siapa eskalasi.

---

## 14. Inventaris screenshot bab ini

| ID | Layar | Kondisi | Status |
|---|---|---|---|
| SS-staff-depot-01 | Slide perkenalan 4 | Tombol "Mulai shift · check-in" | Belum diambil |
| SS-staff-depot-02 | Check-in shift | Daftar periksa tampil | Belum diambil |
| SS-staff-depot-03 | Status ketersediaan | Mode Istirahat dengan hitung mundur | Belum diambil |
| SS-staff-depot-04 | Tugas | Satu kartu Ditugaskan | Belum diambil |
| SS-staff-depot-05 | Detail pengantaran | Status Diantar | Belum diambil |
| SS-staff-depot-06 | Pembayaran tunai COD | Uang diterima > total | Belum diambil |
| SS-staff-depot-07 | Bukti pengantaran | Semua kolom terisi | Belum diambil |
| SS-staff-depot-08 | Setoran akhir shift | Peringatan kurang | Belum diambil |
| SS-staff-depot-09 | Pendapatan | Saldo + panel rekening | Belum diambil |
| SS-staff-depot-10 | Antrean offline | Spanduk + dialog buang | Belum diambil |
| SS-staff-depot-11 | Lapor insiden | Formulir terisi | Belum diambil |
| SS-staff-depot-12 | Menu /hr/me | Semua kartu | Belum diambil |
| SS-staff-depot-13 | Absen wajah | Hasil check-in | Belum diambil |

---

## 15. Catatan celah & hal yang perlu dikonfirmasi

Rujuk ke berkas `17-open-questions` untuk daftar terpadu.

**Celah teknis ([B]):**
1. Nama "Staff Depot" di permintaan = kurir di kode; tidak ada peran petugas konsol non-kepala. Konfirmasi apakah perusahaan memerlukan peran tersebut.
2. Dua "check-in" tidak terhubung (shift dan absen wajah).
3. Teks tetap vs pengaturan: "minimal 2 kali" (no-show), tanda tangan "wajib" di perkenalan, "lokasi terkirim" pada insiden darurat, "dipotong dari upah", "payout mingguan" vs kapan saja, "Foto & tanda tangan" pada layar sukses.
4. Aturan "uang dulu baru selesai" hanya di UI; server tidak mengecek.
5. Pesan error berbahasa Inggris tampil mentah ke kurir (check-in, setoran, penarikan, no-show).
6. Tab "Dompet" praktis tak terlihat; pengantaran Dijadwalkan ulang tak muncul di Riwayat.
7. Kurir tidak dapat membantah selisih setoran/absen, tidak dapat membatalkan cuti yang sudah disetujui, dan melihat slip Draft.
8. Tidak ada pintu ke halaman Meteran air untuk kurir walau hak `meterWrite` dimiliki.

**Perlu konfirmasi bisnis ([K]):**
1. Nilai tarif upah, bonus jam sibuk, bonus tepat waktu, insentif berjenjang, target mingguan.
2. Kebijakan pembebanan kekurangan setoran; tenggat setoran.
3. Jadwal dan lama pemrosesan penarikan; siapa yang membayar.
4. Batas kasbon, kebijakan surat dokter untuk cuti sakit.
5. Apakah kurir digaji harian dan per antar sekaligus.
6. Apakah kurir diminta mencatat meteran air.
7. Nomor/jalur eskalasi darurat resmi.
