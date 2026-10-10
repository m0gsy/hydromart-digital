# Bab 3 — Panduan Kepala depot (KEPALA_DEPOT)

| Metadata | Nilai |
|---|---|
| Versi | 0.1 draf |
| Tanggal | 2026-10-10 |
| Klasifikasi | Internal — Terbatas |
| Peran di UI | Kepala depot (keterangan di header konsol: "Operator depot") |
| Peran di kode | `KEPALA_DEPOT` |
| Status pengujian | Belum ada pengujian yang dijalankan oleh penulis dokumen ini. Isi bab disusun dari pembacaan kode dan berkas temuan. |

**Legenda bukti.** **[V]** terverifikasi di kode · **[D]** disimpulkan, perlu konfirmasi · **[K]** perlu konfirmasi bisnis (nilai berasal dari data/pengaturan) · **[B]** diketahui bermasalah/tidak konsisten.

**Catatan hak akses (berlaku untuk seluruh bab).** Hak akses yang ditulis di bab ini adalah nilai BAWAAN dari `packages/access/src/index.ts`. Super admin dapat mengubah daftar hak akses saat aplikasi berjalan, dan perubahan berlaku sekitar 30 detik kemudian. Jika Anda melihat menu atau tombol yang berbeda dari bab ini, tanyakan kepada Admin sebelum menyimpulkan ada kesalahan. **[V]**

---

## 1. Gambaran peran

Kepala depot adalah penanggung jawab harian satu depot Hydromart. Anda memegang pesanan yang masuk, kurir, stok, kas konter, dan penutupan buku harian di depot Anda. Anda tidak mengatur harga katalog, rekening/QRIS depot, atau akun staf. Hal-hal itu dipegang Manajer depot atau Kantor pusat.

Yang membedakan peran ini dari peran lain di dasbor:

- Anda memakai **konsol "Operator depot"** dengan **tab di bagian atas layar**, bukan menu samping. Peran lain (Manajer, SPV, Asisten SPV) memakai menu samping dan navigasi bawah. **[V]** (`apps/web/src/app/dashboard/layout.tsx`)
- Akun Anda **terkunci pada satu depot**. Anda tidak bisa membuka data depot lain. **[V]**
- Banyak keputusan bernilai besar tidak berhenti di Anda. Selisih opname dan selisih galon di atas batas bawaan Rp100.000 masuk ke antrean persetujuan Manajer. Pengembalian dana (refund) tidak dapat Anda ajukan. **[V]**

> **Catatan penting tentang nama peran.** Dalam bahasa sehari-hari "Staff Depot" sering dikira bawahan Kepala depot yang bekerja di konsol. Di kode, "Staff Depot" (`STAFF_DEPOT`) adalah **kurir**, dan masuk ke aplikasi `/driver`. Panduan kurir ada di Bab 4. **[V]**

---

## 2. Tujuan & tanggung jawab

| Area | Yang Anda lakukan | Bagian bab |
|---|---|---|
| Pesanan | Memproses pesanan baru, mengonfirmasi pembayaran tunai/transfer, menugaskan kurir | 6.2 |
| Pengiriman | Memantau kurir di jalan, menarik atau membatalkan pengiriman yang macet | 6.3 |
| Konter | Membuka shift kasir, mencatat penjualan konter, membatalkan salah input, menutup shift | 6.4 |
| Uang COD | Memverifikasi setoran tunai kurir | 6.5 |
| Stok | Terima barang, sesuaikan, opname, titik pesan ulang, transfer antar depot | 6.6 |
| Galon | Mencatat galon keluar dan retur | 6.7 |
| Air | Mencatat meteran air pagi dan sore | 6.8 |
| Pembukuan | Menutup buku harian setelah semua shift kasir tutup | 6.9 |
| Pemasaran lokal | Melihat promo, mengelola aturan promo depot, broadcast, serah hadiah | 6.10–6.12 |
| Tim | Jadwal shift kurir, huddle mingguan, serah terima shift, perawatan alat | 6.13–6.14 |
| Masalah | Insiden, sengketa order | 6.15–6.16 |
| Pelanggan | Direktori, CRM, impor data | 6.17 |
| Diri sendiri | Absen wajah, cuti, kasbon, slip gaji | 6.19 |

---

## 3. Prasyarat akses

1. **Akun staf aktif** dengan peran "Kepala depot".
2. **Depot penempatan sudah diisi** pada akun Anda. Tanpa depot, server menolak dengan pesan "Akun ini belum diberi tanggung jawab depot manapun." **[V]** (`packages/platform/src/nest/depot-scope.ts:166`)
3. **Nomor telepon** terdaftar untuk menerima kode masuk sekali pakai (OTP). **[V]**
4. Untuk fitur HRIS mandiri (`/hr/me`): akun Anda harus **tertaut ke data karyawan** yang dibuat HR dan berstatus aktif. Jika tidak, muncul "Akun ini belum tertaut ke data karyawan" atau "Karyawan tidak aktif". **[V]**
5. Browser modern di laptop/tablet/ponsel. Absen wajah butuh izin kamera dan lokasi (GPS).
6. Untuk mencetak struk konter: izinkan popup di browser. **[V]**

**Yang menyiapkan akses Anda:** akun dan peran dibuat oleh Kantor pusat/Admin; penempatan depot dan data karyawan oleh HR. Anda tidak dapat membuat akun sendiri. **[V]** (matriks peran: `staffAdmin` = Kantor pusat, Super admin)

---

## 4. Masuk & pengaturan awal

### Prosedur: Masuk ke konsol Operator depot

**Tujuan:** Masuk dan mendarat di "Ringkasan hari ini". **Peran:** Kepala depot. **Prasyarat:** akun aktif, nomor telepon dapat menerima SMS. **Titik awal:** halaman `/login`.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka halaman masuk. Masukkan nomor telepon akun staf Anda. | Sistem mengirim kode sekali pakai. Teks halaman: "Masuk dengan nomor teleponmu — kami kirim kode sekali pakai." |
| 2 | Pada halaman verifikasi, ketik 6 digit kode. | Kolom kode otomatis terkirim saat digit ke-6 diketik. Ada hitung mundur "Kode berlaku {m:ss} lagi." |
| 3 | Jika kode tidak datang, tunggu hitung mundur lalu tekan "Kirim ulang kode". | Pesan "Kode baru dikirim ke {nomor tersamar}." |
| 4 | Setelah berhasil, Anda diarahkan otomatis. | Anda mendarat di `/dashboard` dengan tampilan "Ringkasan hari ini" dan tab di atas layar. **[V]** |

**Hasil akhir:** Header menampilkan nama depot Anda, ikon lonceng notifikasi, inisial dan nama Anda, serta keterangan "Operator depot". **[V]**

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Kode verifikasi salah." | Kode yang diketik tidak cocok | Ketik ulang dengan teliti |
| "Kode verifikasi sudah kedaluwarsa. Minta kode baru." | Kode lewat 5 menit | Tekan "Kirim ulang kode" |
| "Terlalu banyak percobaan. Minta kode baru." | Batas percobaan habis | Minta kode baru |
| "Kode baru bisa diminta sebentar lagi. Cek SMS yang sudah masuk dulu." | Jeda antar permintaan kode | Tunggu hitung mundur |
| "Akun ini tidak aktif. Hubungi dukungan Hydromart." | Akun dinonaktifkan | Hubungi Admin/Kantor pusat |

**Izin & batasan:** Anda tidak mengatur kata sandi; masuk memakai OTP SMS. **[V]**

**Daftar periksa:**
- [ ] Nama depot di header benar.
- [ ] Ringkasan hari ini tampil (bukan layar "Pilih depot").
- [ ] Lonceng notifikasi dapat dibuka.

> **[SCREENSHOT REQUIRED: SS-kepala-depot-01 — Halaman /login dengan kolom nomor telepon terisi contoh sintetis (tanpa nomor asli)]**
> *Gambar 3.1 — Halaman masuk staf.*

> **[SCREENSHOT REQUIRED: SS-kepala-depot-02 — Layar "Ringkasan hari ini" setelah masuk: header (nama depot, lonceng, nama, "Operator depot") dan bilah tab di atas]**
> *Gambar 3.2 — Konsol Operator depot setelah masuk.*

### Layar "Pilih depot"

Jika akun Anda belum tertaut ke depot yang terbaca, Ringkasan menampilkan judul "Pilih depot" dan teks "Pilih depot yang kamu kelola untuk melihat ringkasan hari ini." Karena akun Kepala depot terkunci pada satu depot, kondisi ini berarti penempatan depot Anda bermasalah. Hubungi HR atau Admin. **[V]**

### Pengaturan awal yang disarankan

1. Buka tab **Pengaturan** (`/dashboard/operator-settings`) dan atur toggle "Notifikasi ops": "Stok menipis", "Pesanan baru masuk", "Kurir gagal antar" (bawaan aktif). **[V]**
2. Pilih bahasa ("Bahasa": ID/EN) bila perlu.
3. Daftarkan wajah Anda di **Absen saya** (`/hr/me`) supaya bisa absen (lihat 6.19).
4. Pastikan peramban mengizinkan notifikasi, kamera, lokasi, dan popup.

> **[B]** Pada layar Pengaturan, baris "Data akun" dan "Ubah PIN" tampil tetapi **tidak melakukan apa-apa** saat ditekan. Chip "Ambang low-stock default: 20 unit" juga hanya tampilan tetap dan tidak bisa diubah. Jangan mengandalkannya. **[V]** (`operator-settings/page.tsx`)

---

## 5. Menu & modul tersedia

### 5.1 Bilah tab atas (yang benar-benar tampil untuk Kepala depot)

Bilah tab bisa digeser ke samping. Sebuah garis tipis memisahkan tab utama dari tab kelola. Tidak ada navigasi bawah, tidak ada menu samping, dan tidak ada pemilih depot untuk peran ini. **[V]**

| # | Label tab | Rute | Hak akses (bawaan) | Bukti |
|---|---|---|---|---|
| 1 | Ringkasan | `/dashboard` | landing operator | **[V]** |
| 2 | Antrean | `/dashboard/orders` | `orderQueue`, `orderFulfilment` | **[V]** |
| 3 | Penjualan | `/dashboard/walk-in` | `walkInSale`, `cashierShift` | **[V]** |
| 4 | Kurir | `/dashboard/tracking` | `tracking` | **[V]** |
| 5 | Inventory | `/dashboard/inventory` | `inventoryRead`; tulis `inventoryWrite` | **[V]** |
| 6 | Retur | `/dashboard/returns` | `returnsRead`; tulis `returnsWrite` | **[V]** |
| 7 | Setoran | `/dashboard/settlements` | `courierSettle` | **[V]** |
| 8 | Pelanggan | `/dashboard/customers` | `depotCrm`; impor `depotCrmWrite` | **[V]** |
| 9 | Insiden | `/dashboard/incidents` | `incidents` | **[V]** |
| 10 | Promo | `/dashboard/promotions` | `promotionRead` (hanya baca) | **[V]** |
| 11 | Hadiah | `/dashboard/redemptions` | `rewardHandover` | **[V]** |
| 12 | Broadcast | `/dashboard/broadcast` | `depotBroadcast`, `depotCampaign` | **[V]** |
| 13 | Absen saya | `/hr/me` | `canPunchAttendance` | **[V]** |
| 14 | Shift | `/dashboard/shift` | baca: semua staf; ubah: `driverRoster` | **[V]** |
| 15 | Huddle | `/dashboard/huddle` | `depotHuddle` | **[V]** |
| 16 | Serah terima | `/dashboard/handover` | `depotHandover` | **[V]** |
| 17 | Perawatan | `/dashboard/maintenance` | `depotMaintenance` | **[V]** |
| 18 | Kelola depot | `/dashboard/depots` | `depotDirectory` (hanya baca) | **[V]** |
| 19 | Pembayaran | `/dashboard/payments` | halaman butuh `depotAdmin` | **[B]** ditolak, lihat 8 |
| 20 | Notifikasi | `/dashboard/notifications` | `opsNotif` | **[V]** |
| 21 | Laporan | `/dashboard/reports` | `orderReportsDepot`, `dailyClose` | **[V]** |
| 22 | Audit | `/dashboard/audit` | `auditRead` | **[V]** |
| 23 | Pengaturan | `/dashboard/operator-settings` | khusus operator depot | **[V]** |

### 5.2 Halaman yang ada tetapi TIDAK punya tab (hanya lewat URL)

Halaman berikut bisa dibuka Kepala depot bila mengetik alamatnya, tetapi tidak ada tautan di bilah tab. **[B]** (`operator-shell.tsx`)

| Halaman | Rute | Hak akses | Catatan |
|---|---|---|---|
| Meteran air | `/dashboard/meter` | `meterRead`/`meterWrite` | Dipakai harian, lihat 6.8 |
| Aturan promo | `/dashboard/promo-rules` | `promoRuleRead`/`promoRuleWrite` | Khusus depot sendiri, lihat 6.10 |
| Sengketa order | `/dashboard/disputes` | `depotDisputes` | Lihat 6.16 |
| CRM & follow-up | `/dashboard/crm` | `depotCrm` | Hanya baca, lihat 6.17 |
| Perkiraan | `/dashboard/forecast` | `forecast` | Hanya baca, lihat 6.18 |
| Peran & akses | `/dashboard/roles` | semua staf | Matriks hanya baca |
| Akun saya | `/dashboard/account` | semua staf | Notifikasi, bahasa, PIN persetujuan, perangkat |
| Pencarian | `/dashboard/search` | `depotDirectory` | Isi belum dibaca penulis **[D]** |
| Pengaturan depot | `/dashboard/depot-settings` | `depotAdmin` | **Ditolak** untuk Kepala depot |
| Antrean approval | `/dashboard/approvals` | `approvals` | **Ditolak**: hanya Manajer/Super admin |
| Susut | `/dashboard/wastage` | konsol manajer | **Ditolak** |

### 5.3 Peta alur kerja dan siapa yang memutuskan

```
Pesanan masuk --> [Anda] Lanjut ke Confirmed --> Lanjut ke Preparing --> Tugaskan kurir
                                                                            |
        Kurir antar (aplikasi /driver) <------------------------------------+
                  |
                  +--> COD: kurir setor di akhir shift --> [Anda] Verifikasi setoran
Opname selisih > Rp100.000 -------------> [Manajer] Antrean approval
Refund ---------------------------------> [Manajer/Finance] ajukan --> [Finance] putuskan
Tutup buku harian ---------------------> [Anda]  (buka kembali: Kantor pusat/Super admin)
```

---

## 6. Prosedur langkah demi langkah

### 6.1 Membaca "Ringkasan hari ini"

### Prosedur: Memeriksa ringkasan awal hari

**Tujuan:** Mengetahui beban kerja depot dalam satu layar. **Peran:** Kepala depot. **Prasyarat:** sudah masuk, depot terbaca. **Titik awal:** tab **Ringkasan** (`/dashboard`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka tab **Ringkasan**. | Judul "Ringkasan hari ini" dengan tanggal hari ini. |
| 2 | Baca empat penghitung. | "Pesanan masuk", "Perlu ditugaskan", "Kurir aktif" (x dari y), "COD belum disetor". |
| 3 | Pada kartu "Perlu ditugaskan", tekan **Tugaskan** (atau tautan "Lihat antrean"). | Anda dibawa ke `/dashboard/orders`. |
| 4 | Pada kartu "Stok menipis · {jumlah}", baca tiga item teratas (tersedia / minimum). | Jika aman: "Semua item di atas ambang." |
| 5 | Pada kartu "Setoran menunggu", tekan **Verifikasi setoran**. | Anda dibawa ke `/dashboard/settlements`. |

**Arti penghitung. [V]**
- "Pesanan masuk": jumlah dari **100 pesanan terbaru** depot, termasuk yang sudah ditutup. Angka ini bukan "hari ini" secara ketat. **[B]**
- "Perlu ditugaskan": pesanan berstatus Preparing.
- "Kurir aktif": kurir yang sedang memegang pengiriman (Ditugaskan/Diambil/Diantar) dibanding semua kurir aktif depot.
- "COD belum disetor": jumlah "Wajib setor" dari setoran berstatus menunggu verifikasi.

**Hasil akhir:** Anda tahu urutan prioritas: tugaskan kurir, verifikasi setoran, isi stok.

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Pilih depot" | Depot tidak terbaca | Hubungi HR/Admin (4) |
| "Tidak ada pesanan menunggu penugasan." | Tidak ada pesanan Preparing | Tidak perlu tindakan |

**Izin & batasan:** Hanya baca.

**Daftar periksa:**
- [ ] Angka "COD belum disetor" dicatat untuk akhir hari.
- [ ] Stok menipis sudah dipesan/dibahas dengan Manajer.

> **[SCREENSHOT REQUIRED: SS-kepala-depot-03 — Ringkasan hari ini dengan empat penghitung terisi dan ketiga kartu (Perlu ditugaskan, Stok menipis, Setoran menunggu)]**
> *Gambar 3.3 — Ringkasan hari ini.*

---

### 6.2 Antrean pesanan

#### Prosedur: Memproses pesanan baru (Dikonfirmasi lalu Disiapkan)

**Tujuan:** Memajukan pesanan dari masuk sampai siap ditugaskan ke kurir. **Peran:** Kepala depot. **Prasyarat:** ada pesanan di depot Anda. **Titik awal:** tab **Antrean** (`/dashboard/orders`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka **Antrean**. Baca lencana "{n} pesanan belum selesai". | Empat chip dengan hitungan: "Perlu ditugaskan", "Diproses", "Dikirim", "Ditutup". Teks "Antrean untuk <nama depot · kode>". |
| 2 | Pilih chip **Diproses** (pesanan berstatus Order placed/Confirmed). | Daftar baris: nomor pesanan, lencana status, penerima, alamat, jumlah item, total Rp. Bila tidak ada pesanan Preparing tetapi ada Order placed/Confirmed, layar otomatis membuka chip ini. |
| 3 | Pada baris pesanan, tekan **Proses**. | Lembar detail terbuka dengan judul nomor pesanan: tanggal, lencana "Walk-in" (bila ada), penerima, telepon, alamat, "Catatan", "Jendela antar", daftar item, Subtotal/Ongkir/Diskon/Total, kotak pembayaran, "Riwayat status". |
| 4 | Periksa pembayaran (lihat prosedur berikutnya). Tekan **Lanjut ke Confirmed** (jika status Order placed). | Lembar menutup dan daftar dimuat ulang. Status menjadi Confirmed. |
| 5 | Buka pesanan lagi, tekan **Lanjut ke Preparing**. | Status menjadi Preparing. Pesanan pindah ke chip **Perlu ditugaskan**. |
| 6 | (Opsional) tekan **Cetak struk**. | Struk dibuka untuk dicetak. |

**Hal yang diperiksa sebelum menekan lanjut:** nama dan alamat penerima, item dan jumlah, metode pembayaran, serta apakah stok tersedia di depot.

**Cara mengenali sukses:** lencana status berubah, dan pesanan muncul di chip berikutnya.

**Tombol yang tersedia di UI:** hanya **Lanjut ke Confirmed** (dari Order placed) dan **Lanjut ke Preparing** (dari Confirmed). Pindah status setelahnya dilakukan oleh penugasan kurir dan aplikasi kurir. Tombol **Lanjut** dari Delivered ke Completed muncul hanya bila server memberi tanda bahwa staf boleh menyelesaikan (`staffCanComplete`, pengaturan per depot). **[V]** `order-status.ts:84-87`

**Pesanan online yang dibayar:** pembayaran online yang lunas otomatis memindahkan Order placed menjadi Confirmed. Pesanan tunai/COD tetap menunggu tombol Anda. **[D]** (`order.service.ts:2667`)

**Notifikasi ke pelanggan.** Perubahan ke Confirmed, Driver assigned, On the way, Delivered, Completed, dan Cancelled memicu notifikasi ke pelanggan. Preparing tidak memicu. Pelanggan menerimanya di kotak masuk dalam aplikasi dan notifikasi dorong (push); WhatsApp tidak lagi dipakai sebagai saluran kirim. **[V]** (temuan I)

> **[B] Label status berbahasa Inggris.** Lencana status pesanan di layar Anda tertulis dalam bahasa Inggris: Order placed, Confirmed, Preparing, Driver assigned, Picked up, On the way, Delivered, Completed, Cancelled, dan "Voided at the counter". Status pembayaran dan pengiriman juga tampil sebagai kode mentah (PENDING, PAID, FAILED, ASSIGNED, PICKED_UP, ON_DELIVERY). Padanan: Order placed = Dipesan; Confirmed = Dikonfirmasi; Preparing = Disiapkan; Driver assigned = Kurir ditugaskan; Picked up = Diambil kurir; On the way = Dalam perjalanan; Delivered = Tiba; Completed = Selesai; Cancelled = Dibatalkan; Voided at the counter = Dibatalkan di kasir. **[V]** (`apps/web/src/lib/order-status.ts:15-27`; padanan Indonesia dari `dictionaries/id/order.ts:181-192`)

**Hasil akhir:** pesanan berstatus Preparing dan siap ditugaskan.

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Gagal memperbarui pesanan." | Server menolak atau jaringan putus | Muat ulang, coba lagi |
| "Cannot move an order from X to Y." | Perpindahan status tidak diizinkan dari status sekarang | Muat ulang. Status mungkin sudah berubah oleh orang lain |
| "This order was already updated by someone else. Reload and try again." | Orang lain memperbarui pesanan lebih dulu | Muat ulang halaman lalu ulangi |
| "Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya." | Pesanan milik depot lain | Pesanan itu bukan wewenang Anda |

**Izin & batasan:**
- Anda hanya melihat pesanan depot Anda.
- **Tidak ada tombol "Batalkan pesanan"** di antrean. Pesanan yang belum pernah dikirim tidak bisa dibatalkan staf lewat UI, walau server mengizinkannya. Satu-satunya jalur pembatalan oleh staf di UI adalah "Batalkan pengiriman" pada pesanan yang sudah ditugaskan (6.3). Untuk membatalkan pesanan yang belum dikirim, minta Manajer atau Kantor pusat. **[B]** **[V]**
- Tautan langsung: `/dashboard/orders?order=<id>` membuka lembar detail pesanan itu.

**Daftar periksa:**
- [ ] Setiap pesanan Order placed/Confirmed sudah diproses.
- [ ] Pembayaran tunai/transfer yang diterima sudah dikonfirmasi (prosedur berikut).

> **[SCREENSHOT REQUIRED: SS-kepala-depot-04 — Antrean pesanan: empat chip berhitungan, beberapa baris pesanan dengan lencana status Inggris]**
> *Gambar 3.4 — Antrean pesanan dengan empat chip.*

> **[SCREENSHOT REQUIRED: SS-kepala-depot-05 — Lembar detail pesanan berstatus Order placed dengan tombol "Lanjut ke Confirmed" dan "Cetak struk"]**
> *Gambar 3.5 — Lembar detail pesanan.*

#### Prosedur: Mengonfirmasi pembayaran tunai atau transfer

**Tujuan:** Mencatat pembayaran yang sudah diterima di depot. **Peran:** Kepala depot (`paymentSettle`). **Prasyarat:** pesanan punya pembayaran berstatus PENDING. **Titik awal:** lembar detail pesanan (6.2), kotak "Pembayaran · {metode}".

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka lembar detail pesanan. Baca kotak "Pembayaran · {metode}". | Lencana status pembayaran tampil sebagai kode mentah (PENDING/PAID/FAILED). Untuk non-tunai terlihat "Bukti bayar" (gambar) atau "Belum diunggah pelanggan." |
| 2 | Jika tunai dan PENDING: isi **Uang tunai diterima (opsional)** (contoh 50000). | Petunjuk: "Diisi = kembalian ikut tercatat pada pembayaran." |
| 3 | Cocokkan uang/bukti dengan total. Tekan **Konfirmasi lunas**. | Pembayaran menjadi PAID. |
| 4 | Jika pembayaran tidak sah: tekan **Tandai gagal**. | Dialog "Tandai pembayaran gagal?" — "Pembayaran untuk {pesanan} ditandai GAGAL. Pesanannya tetap ada dan pelanggan masih bisa membayar lagi." Tekan **Tandai gagal** untuk lanjut. |

**Masalah umum:** "Gagal konfirmasi pembayaran." — ulangi; bila terus gagal, catat nomor pesanan dan hubungi Manajer.

**Izin & batasan:** Tombol **Ajukan refund** **tidak tampil** untuk Kepala depot. Hak `refundIssue` hanya dimiliki Finance, Manajer, dan Super admin. **[V]** Pembayaran QRIS/transfer tanpa bukti sebaiknya tidak dikonfirmasi sampai bukti terlihat. **[D]**

**Daftar periksa:**
- [ ] Nominal tunai yang diterima sama dengan atau lebih dari total.
- [ ] Bukti transfer/QRIS terlihat jelas sebelum "Konfirmasi lunas".

#### Prosedur: Menugaskan kurir

**Tujuan:** Mengirim pesanan Preparing ke kurir yang sedang bertugas. **Peran:** Kepala depot (`tracking`). **Prasyarat:** pesanan berstatus Preparing; kurir sudah check-in shift. **Titik awal:** **Antrean** > chip **Perlu ditugaskan**, atau kartu "Perlu ditugaskan" di Ringkasan.

Ada dua cara yang setara. Keduanya memanggil permintaan penugasan yang sama.

**Cara 1 — Panel kanan di Antrean**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Pilih chip **Perlu ditugaskan**. Pada baris pesanan, tekan **Tugaskan**. | Panel "Tugaskan kurir" dengan daftar "Kurir tersedia". |
| 2 | Pilih satu kurir. Kartu menunjukkan "Tersedia · 0 tugas aktif" atau "Sibuk · {n} tugas aktif". | Kurir sibuk terkunci. Aturan: "1 kurir hanya boleh 1 order aktif. Kurir sibuk terkunci." |
| 3 | Tekan **Tugaskan ke {nama}**. | Pesanan menjadi Driver assigned; kurir menerima tugas di aplikasi. |

**Cara 2 — Di dalam lembar detail pesanan (status Preparing)**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka pesanan Preparing. Pada bagian "Tugaskan kurir", buka daftar **Kurir** ("Pilih kurir…"). | Kurir tanpa shift terbuka berstatus nonaktif dan diberi akhiran "— belum buka shift". |
| 2 | Pilih kurir lalu tekan **Tugaskan & kirim**. | Penugasan tercatat. |

**Aturan server (urutan pemeriksaan):** **[V]** (`delivery.service.ts:263-334`)
1. Pesanan sudah punya penugasan — ditolak, kecuali penugasan sebelumnya berstatus dijadwalkan ulang.
2. Kurir harus sedang check-in shift dan berstatus Online.
3. Kurir tidak boleh melebihi batas pengantaran aktif. Bawaan 1; pengaturan per depot 1–20. **[K]**
4. Metode pembayaran harus terbaca. Jika tidak, penugasan ditolak agar kurir tidak berangkat tanpa nominal tagihan.
5. Depot dalam permintaan harus depot Anda.

Nominal COD dihitung server dari pembayaran tunai pesanan. Anda tidak mengisinya. **[V]**

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Pilih kurir yang tersedia." / "Pilih kurir." | Belum memilih | Pilih satu kurir |
| "Belum ada kurir aktif. Undang kurir di menu Staf & peran." | Tidak ada kurir terdaftar aktif | Hubungi HR/Kantor pusat. Anda tidak punya menu itu |
| "Pesanan harus disiapkan (status Preparing) sebelum kurir bisa ditugaskan." | Pesanan belum Preparing | Tekan "Buka detail pesanan", lanjutkan status |
| "This courier is not checked in and available." | Kurir belum check-in/bukan Online | Minta kurir mulai shift (Bab 4) |
| "This driver already has the maximum number of active deliveries." | Kurir sudah memegang batas pengantaran | Pilih kurir lain atau tunggu selesai |
| "This order already has a delivery assignment." | Pesanan sudah ditugaskan | Muat ulang; cek tab Kurir |
| "Metode pembayaran order ini tidak terbaca, jadi penugasan ditolak — kalau ini order tunai, kurir akan berangkat tanpa nominal tagihan. Coba lagi." | Gagal membaca data pembayaran | Coba lagi beberapa saat |
| "Gagal menugaskan kurir." | Kesalahan umum | Coba lagi |

**Izin & batasan:** Roster kurir dibaca dari daftar `driverRoster`. Anda tidak dapat menugaskan kurir depot lain.

**Daftar periksa:**
- [ ] Kurir yang dipilih berstatus Tersedia.
- [ ] Pesanan hilang dari "Perlu ditugaskan" dan muncul di "Dikirim".

> **[SCREENSHOT REQUIRED: SS-kepala-depot-06 — Panel "Tugaskan kurir" dengan satu kurir Tersedia dan satu Sibuk (terkunci)]**
> *Gambar 3.6 — Panel penugasan kurir.*

---

### 6.3 Memantau pengiriman (Kurir / Live tracking)

#### Prosedur: Memantau dan menangani pengiriman yang macet

**Tujuan:** Mengawasi kurir di jalan; menarik atau membatalkan pengiriman. **Peran:** Kepala depot (`tracking`). **Prasyarat:** ada pengiriman aktif. **Titik awal:** tab **Kurir** (`/dashboard/tracking`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka tab **Kurir**. | Judul "Live tracking". Catatan: "Driver yang sedang mengantar. Posisi diperbarui otomatis tiap 15 detik." Daftar hingga 50 pengiriman aktif. Kosong: "Tidak ada pengiriman aktif". |
| 2 | Baca kartu: "Order {n}", tujuan, lencana (ASSIGNED/PICKED_UP/ON_DELIVERY), langkah Ditugaskan > Diambil > Diantar > Tiba, nama kurir, "ETA {m} mnt", koordinat atau "Menunggu posisi driver", dan "{n} dtk/mnt/jam lalu". | Posisi diperbarui setiap 15 detik. |
| 3 | Tekan **Detail** untuk melihat Pesanan, Status, Alamat tujuan, Telepon penerima, COD / "Bukan COD", Ditugaskan. | Panel detail pengiriman. |
| 4 | Jika kurir tidak bisa lanjut: tekan **Tarik ke antrean**. Isi alasan pada dialog "Alasan menarik pengiriman ini dari kurir?". | Pengiriman menjadi dijadwalkan ulang, pesanan kembali ke Preparing, kurir bebas. Pesanan muncul lagi di "Perlu ditugaskan". |
| 5 | Jika pesanan harus dibatalkan: tekan **Batalkan pengiriman**. Isi alasan pada dialog "Alasan membatalkan pengiriman ini?". | Pengiriman gagal dan **pesanannya dibatalkan**. Pembayaran dibalik dan stok dilepas oleh layanan pesanan. |

**Aturan:** alasan **wajib** diisi; jika kosong, tidak ada yang terjadi. Dua tombol hanya muncul untuk pengiriman Ditugaskan/Diambil/Diantar. **[V]** (`tracking/page.tsx:105`; `delivery.service.ts:1066-1101`)

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Gagal memproses. Coba lagi." | Kesalahan umum | Coba lagi |
| "Cannot move a delivery from X to Y." | Status pengiriman sudah berubah | Muat ulang |
| "Khusus staf" / "Live tracking tersedia untuk staf depot." | Anda tidak punya hak `tracking` | Hubungi Admin |

**Izin & batasan:** "Batalkan pengiriman" membatalkan pesanan pelanggan. Gunakan hanya bila pelanggan/pihak berwenang sudah setuju. Pembatalan dengan pembayaran sudah lunas menyebabkan refund. Refund bernilai besar menunggu persetujuan Kantor pusat/Finance sebelum uang bergerak. **[V]**

**Daftar periksa:**
- [ ] Setiap pengiriman tanpa posisi lebih dari beberapa menit sudah dihubungi.
- [ ] Alasan tarik/batal ditulis jelas untuk jejak audit.

> **[SCREENSHOT REQUIRED: SS-kepala-depot-07 — Live tracking dengan satu kartu pengiriman aktif dan tombol "Tarik ke antrean" / "Batalkan pengiriman"]**
> *Gambar 3.7 — Live tracking.*

---

### 6.4 Penjualan di depot dan shift kasir

Semua penjualan konter wajib berada di dalam **shift kasir** yang terbuka atas nama Anda. Shift melekat pada orang (akun yang masuk), bukan pada depot saja. **[V]**

#### Prosedur: Membuka shift kasir

**Tujuan:** Membuka laci kas sebelum menjual. **Peran:** Kepala depot (`cashierShift`). **Prasyarat:** belum ada shift terbuka atas nama Anda di depot ini. **Titik awal:** tab **Penjualan** (`/dashboard/walk-in`), bilah shift di atas halaman.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka tab **Penjualan**. | Kartu "Belum ada shift terbuka": "Buka shift dulu — penjualan konter ditolak selama laci belum ada penanggung jawabnya." |
| 2 | Hitung uang kembalian di laci. Isi **Uang kembalian awal di laci** (hanya angka; contoh 200000; kosong dianggap 0). | Tombol aktif. |
| 3 | Tekan **Buka shift**. | Toast "Shift dibuka." Bilah berubah: "Shift terbuka — {nama kasir}", "Modal awal Rp X · sejak hh:mm", tombol **Tutup shift**. |

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "You already have an open shift at this depot. Close it before opening another." | Anda sudah punya shift terbuka | Tutup shift lama dulu |
| "Gagal membuka shift." | Kesalahan umum | Coba lagi |
| "Akses terbatas" / "Hanya operator dan kepala depot yang bisa mencatat penjualan di konter." | Tidak punya hak `walkInSale` | Hubungi Admin |
| "Belum ada depot" / "Pilih depot dulu dari pemilih depot." | Depot tidak terbaca | Hubungi HR/Admin |

> **[B]** Nama kasir pada bilah shift ditampilkan sebagai **nomor telepon** akun, bukan nama. **[V]** (`cashier-shift.controller.ts:26-29`)

**Daftar periksa:**
- [ ] Uang kembalian awal sudah dihitung sebelum diketik.

> **[SCREENSHOT REQUIRED: SS-kepala-depot-08 — Halaman Penjualan dengan kartu "Belum ada shift terbuka" dan kolom "Uang kembalian awal di laci"]**
> *Gambar 3.8 — Membuka shift kasir.*

#### Prosedur: Mencatat penjualan konter

**Tujuan:** Mencatat penjualan langsung (pembeli datang ke depot) dan mencetak struk. **Peran:** Kepala depot (`walkInSale`). **Prasyarat:** shift kasir terbuka; stok produk ada. **Titik awal:** tab **Penjualan**, judul "Penjualan di depot" ("Pembeli datang langsung, bayar tunai.").

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Pilih produk dan jumlah dengan tombol tambah/kurang. | Hanya produk jenis PRODUK yang punya stok yang tampil; jumlah dibatasi stok tersedia. Kosong: "Tidak ada produk siap jual di depot ini. Isi stok dulu lewat Inventory." |
| 2 | (Opsional) isi **Nama pembeli (opsional)** dan **Nomor HP (opsional)**. Tekan **Cek pelanggan**. | "Pelanggan dikenali" — harga agen atau tier ikut terhitung. Nomor HP yang diisi membuat pembeli mendapat poin dan masuk daftar pelanggan depot. Cek nomor dapat membuat akun pelanggan baru. |
| 3 | (Opsional) aktifkan **Antar ke alamat pembeli**. Isi Alamat lengkap, Kota, Nama penerima, Nomor yang bisa dihubungi kurir, Patokan (opsional). | "Ongkir dihitung per galon dan sudah masuk ke total." Bila belum lengkap: "Alamat dan nomor belum lengkap — total di bawah masih harga ambil sendiri." |
| 4 | (Opsional) isi **Galon kosong dibawa**. | Server menolak jika melebihi galon isi yang dijual. |
| 5 | (Opsional) isi **Kode voucher (opsional)** (contoh HEMAT10). | Perlu nomor HP; potongan dihitung server. |
| 6 | Periksa ringkasan: Subtotal, Diskon, Harga agen, Ongkir, Total. | Harga dihitung server. |
| 7 | Pilih **Metode pembayaran**: Tunai, QRIS, atau TRANSFER. | QRIS/TRANSFER hanya aktif jika Manajer sudah mengisi QRIS/rekening depot. |
| 8 | Jika tunai: isi **Uang tunai diterima** (atau tekan **Uang pas**). | Tampil "Kembalian" atau "Masih kurang". Tunai kurang dari total diblokir: "Uang tunai kurang dari total." |
| 9 | Tekan **Simpan & cetak struk** (tunai) atau **Pembayaran diterima & cetak struk** (QRIS/Transfer). | Toast "Penjualan {pesanan} tersimpan." Struk terbuka. Pesanan langsung berstatus Completed (lencana "Walk-in"). |

**Status tombol utama:** "Memeriksa shift…" lalu "Buka shift dulu" (nonaktif tanpa shift), lalu tombol simpan. Tombol juga nonaktif jika keranjang kosong atau total server belum terbaca. **[V]**

**Cara aman supaya tidak dobel:** setiap percobaan memakai satu kunci idempotensi. Mencoba ulang tombol yang sama mengembalikan penjualan yang sama, bukan penjualan baru. **[V]**

**Jika pembayaran gagal tercatat setelah penjualan tersimpan:** muncul kartu "Pembayaran belum tercatat" — "Penjualan {pesanan} sudah tersimpan, tapi pembayarannya belum tercatat. Uangnya ada di laci Anda — catat sekarang, selagi pembeli masih di sini." Tekan **Coba lagi catat pembayaran**. Sukses: "Pembayaran {pesanan} tercatat." **[V]**

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Buka shift kasir dulu sebelum mencatat penjualan di konter." | Server mendapati tidak ada shift terbuka | Buka shift |
| "Stok tidak cukup untuk sebagian barang. Jumlahnya sudah diperbarui — sesuaikan lalu coba lagi." | Stok berubah | Cek jumlah lalu ulangi |
| "Keranjang berubah sejak percobaan sebelumnya. Ulangi penjualan ini." | Keranjang beda dari percobaan yang sama | Mulai ulang penjualan |
| "Nomor pembeli belum bisa dicek sekarang. Coba lagi, atau kosongkan nomornya untuk jual tanpa nama." | Cek pelanggan gagal | Kosongkan nomor |
| "Tidak bisa mengecek nomor ini." | Cek pelanggan gagal | Coba lagi |
| "Isi nomor HP pembeli dulu — voucher menempel pada akun." | Voucher tanpa nomor | Isi nomor HP |
| "This voucher only waives delivery, and a counter sale has none. Keep it for a delivery order." | Voucher ongkir tidak berlaku untuk jual ambil sendiri | Simpan voucher untuk pesanan antar |
| "Reseller pricing already applies — vouchers cannot be used on this order." | Pembeli agen sudah dapat harga agen | Lepas voucher |
| "Galon kosong (X) melebihi galon isi yang dijual (Y)." | Terlalu banyak galon kosong | Kurangi |
| "Depot ini sedang tidak melayani antar dari konter." | Antar dari konter tidak aktif | Matikan opsi antar |
| "Harga belum bisa dihitung server. Coba lagi sebentar." | Gagal hitung harga | Tekan "Muat ulang" |
| "Harga khusus depot tidak terbaca — total memakai harga dasar katalog." | Harga khusus tidak terbaca | Muat ulang halaman sebelum menjual |
| "Depot ini belum mengatur tujuan pembayaran untuk metode itu." | QRIS/rekening belum diisi | Gunakan tunai; minta Manajer mengisi |
| "Struk tidak bisa dibuka — izinkan popup, lalu tekan "Cetak ulang struk"." | Popup diblokir | Izinkan popup lalu cetak ulang |
| "Gagal menyimpan penjualan." | Kesalahan umum | Coba lagi |

**Izin & batasan:** Penjualan hanya untuk depot Anda. Metode QRIS dan transfer bergantung pada pengaturan pembayaran yang hanya bisa diubah Manajer (lihat 8, tab **Pembayaran** ditolak untuk Anda). **[V]**

**Daftar periksa:**
- [ ] Shift terbuka sebelum penjualan pertama.
- [ ] Total di layar sama dengan yang disebut ke pembeli.
- [ ] Struk dicetak/diterima pembeli.

> **[SCREENSHOT REQUIRED: SS-kepala-depot-09 — Form penjualan konter: daftar produk, ringkasan harga, pilihan metode bayar, uang tunai diterima dan kembalian]**
> *Gambar 3.9 — Penjualan konter.*

#### Prosedur: Membatalkan penjualan konter yang salah

**Tujuan:** Membalik penjualan konter yang salah input pada hari dan shift yang sama. **Peran:** Kepala depot. **Prasyarat:** shift Anda terbuka; penjualan dibuat pada atau setelah shift Anda dibuka. **Titik awal:** kartu "Penjualan terakhir" atau daftar "Penjualan konter terakhir".

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Pada kartu "Penjualan terakhir" atau baris daftar, tekan **Batalkan penjualan** (label baris: "Batalkan penjualan {pesanan}"). | Dialog "Batalkan {pesanan}?" — "Uang dikembalikan ke pembeli, barang masuk stok lagi, dan poin ditarik kembali." |
| 2 | Isi **Alasan** (wajib; contoh "Pembeli salah pilih ukuran galon"). Maksimum 255 karakter. | Petunjuk: "Wajib — laci akan berkurang sebesar penjualan ini." |
| 3 | Tekan **Ya, batalkan** (atau **Tidak jadi** untuk mundur). | Toast "Penjualan {pesanan} dibatalkan." Status menjadi "Voided at the counter" dengan lencana "Dibatalkan". Stok kembali, poin ditarik, voucher dilepas. Tidak perlu persetujuan. |

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Hanya penjualan konter yang bisa dibatalkan di kasir. Pesanan antar lewat proses refund." | Itu pesanan antar, bukan konter | Refund dilakukan Manajer/Finance |
| "Penjualan ini sudah dibatalkan." | Sudah dibatalkan | Tidak perlu tindakan |
| "Penjualan ini bukan hari ini, jadi tidak bisa dibatalkan di kasir. Ajukan refund." | Penjualan lebih lama dari shift Anda | Minta Manajer mengajukan refund |
| "Pembayaran belum bisa dikembalikan, jadi penjualan tidak dibatalkan. Coba lagi sebentar." | Pembalikan pembayaran gagal | Coba lagi |
| "Gagal membatalkan penjualan." | Kesalahan umum | Coba lagi |

**Izin & batasan:** Pembatalan mengurangi uang yang diharapkan di laci. Jangan membatalkan untuk menyembunyikan selisih. Alasan tersimpan di jejak audit. **[V]**

#### Prosedur: Menutup shift dan menghitung laci

**Tujuan:** Menutup shift dan mencatat selisih kas. **Peran:** Kepala depot. **Prasyarat:** shift Anda terbuka. **Titik awal:** tab **Penjualan**, tombol **Tutup shift**.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | **Hitung dulu** uang tunai di laci. | — |
| 2 | Tekan **Tutup shift**. Isi **Uang tunai dihitung di laci** (contoh 1450000). | Petunjuk: "Hitung dulu, baru masukkan. Selisih dihitung server." Angka yang diharapkan sengaja **tidak** ditampilkan sebelum Anda mengetik. |
| 3 | (Opsional) isi **Catatan (opsional)** (contoh "Kembalian kurang Rp 2.000"). Maksimum 500 karakter. | — |
| 4 | Tekan **Tutup & hitung selisih** (aktif setelah angka diketik) atau **Batal**. | Kartu "Shift ditutup" menampilkan "Seharusnya", "Dihitung", "Selisih" (merah bila negatif). |

**Cara server menghitung.** Seharusnya = uang kembalian awal + pembayaran tunai pada shift ini. Selisih = dihitung dikurangi seharusnya (negatif berarti laci kurang). Penjualan bersih (tanpa modal awal) dicatat ke buku kas depot sebagai pemasukan kategori KONTER dengan keterangan "Tunai konter — shift {kasir}". **[V]** (`cashier-shift.service.ts`)

**Tidak ada persetujuan atas selisih kas.** Selisih hanya tercatat pada baris shift. **[V]**

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Cash taken this shift cannot be read right now, so the shift cannot be closed. Try again shortly." | Total tunai shift tidak terbaca | Shift tetap terbuka; coba lagi sebentar |
| "This shift is already closed." | Sudah ditutup | Muat ulang |
| "This shift belongs to another cashier." | Shift milik kasir lain | Anda hanya bisa menutup shift sendiri; shift kasir lain ditutup Manajer/Finance |
| "Gagal menutup shift." | Kesalahan umum | Coba lagi |

**Izin & batasan:** Kepala depot hanya menutup shift sendiri. Menutup shift orang lain (`canCloseAnyShift`) hanya Manajer, SPV, Finance, Direktur, Super admin. Selama masih ada shift kasir terbuka, **tutup buku harian ditolak** (6.9). **[V]**

**Daftar periksa:**
- [ ] Laci dihitung sebelum mengetik angka.
- [ ] Selisih tidak nol dicatat penyebabnya pada catatan.
- [ ] Shift ditutup sebelum tutup buku.

> **[SCREENSHOT REQUIRED: SS-kepala-depot-10 — Dialog tutup shift dengan kolom "Uang tunai dihitung di laci" terisi dan hasil kartu "Shift ditutup" dengan Seharusnya/Dihitung/Selisih]**
> *Gambar 3.10 — Tutup shift dan selisih kas.*

---

### 6.5 Verifikasi setoran COD

#### Prosedur: Memverifikasi setoran tunai kurir

**Tujuan:** Mencocokkan uang tunai fisik dari kurir dengan tagihan COD. **Peran:** Kepala depot (`courierSettle`; juga Manajer, Finance, Super admin). **Prasyarat:** kurir sudah check-out shift dan menekan "Setor ke kasir" di aplikasinya (Bab 4). **Titik awal:** tab **Setoran** (`/dashboard/settlements`) atau tombol **Verifikasi setoran** di Ringkasan.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka **Setoran**. Pastikan filter **Status** = "Menunggu verifikasi" (bawaan). | Judul "Verifikasi setoran COD". Teks "Shift {tanggal} · {n} setoran menunggu" dan "Depot {nama}". Tiap baris: nama kurir, "{n} pesanan COD · setor {hh:mm}", "Wajib setor" Rp. |
| 2 | Terima uang fisik dari kurir dan hitung. | — |
| 3 | Tekan **Hitung & verifikasi** pada baris kurir. | Panel menampilkan "Disetor Rp X" beserta "pas", "kurang Rp Y", atau "lebih Rp Z" (hijau bila tidak kurang, merah bila kurang). |
| 4 | Bandingkan angka "Disetor" dengan uang yang Anda hitung. | Angka "Disetor" diisi kurir sendiri; Anda yang memastikan uang fisik sama. |
| 5 | Bila kurang: centang atau kosongkan **Bebankan selisih {nominal} ke saldo kurir** (bawaan tercentang). | Menentukan apakah kekurangan memotong upah kurir. |
| 6 | Isi **Catatan** bila perlu. | Catatan **wajib** untuk sengketa, dan untuk setoran lebih di atas Rp 5.000. |
| 7 | Tekan **Verifikasi**. Atau tekan **Sengketakan** bila uang tidak cocok dan perlu diselesaikan di luar sistem. | Baris pindah ke "Terverifikasi" (chip hijau) atau "Sengketa". |

**Atau menyengketakan:** **Sengketakan** mewajibkan alasan ("Isi alasan sengketa."). Setoran berstatus Sengketa menunggu penyelesaian di luar sistem. **[V]**

**Hasil setelah verifikasi:** baris menampilkan "Disetor Rp", "Kurang Rp" (bila ada), tombol **Rincian** (Wajib setor, Disetor, Selisih, "Dibebankan ke kurir" Ya/Tidak, Catatan). Riwayat juga tampil di aplikasi kurir.

**Aturan server. [V]** (`settlement.service.ts:220-288`)
- Selisih = disetor dikurangi wajib setor (negatif = kurang).
- Setoran lebih lebih dari Rp 5.000 tanpa catatan ditolak: "Explain the surplus in the note before verifying this deposit." (artinya: jelaskan kelebihan pada catatan sebelum memverifikasi).
- Pembebanan hanya berlaku untuk kekurangan nyata. Pembebanan dikirim ke buku upah kurir **sebelum** setoran ditandai terverifikasi.
- Kelebihan setoran **tidak** dikreditkan ke kurir.

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Pembebanan selisih ke kurir belum tercatat di buku upahnya, jadi setoran ini belum diverifikasi. Coba lagi." | Pencatatan potongan ke upah gagal | Aman ditekan ulang |
| "This settlement has already been resolved." | Sudah diselesaikan | Muat ulang |
| "Isi alasan sengketa." | Alasan kosong | Isi alasan |
| "Khusus kasir depot" / "Verifikasi setoran COD tersedia untuk operator/manajer depot dan finance." | Tidak punya hak `courierSettle` | Hubungi Admin |

**Izin & batasan:**
- Tidak ada langkah persetujuan Manajer untuk setoran. Anda memutuskan sendiri apakah selisih dibebankan. Jenis persetujuan "COD_VARIANCE" ada di sistem tetapi tidak pernah dibuat. **[V]** Karena itu catat alasan dengan jelas.
- Anda **tidak dapat menyetor atas nama kurir** (`courierDeposit` hanya kurir). **[V]**
- Teks di aplikasi kurir "Selisih kurang dipotong dari upah Anda" hanya benar bila Anda mencentang pembebanan. **[V]**
- Pada setoran Sengketa, UI hanya menampilkan **Rincian**. Server sebenarnya mengizinkan setoran Sengketa diselesaikan menjadi Terverifikasi (dengan catatan), tetapi tombolnya tidak ada di UI. Minta bantuan Manajer/Kantor pusat bila perlu. **[B]**
- Tidak ada kolom untuk mengetik hasil hitung uang Anda sendiri. Hasil hitung Anda tercermin hanya lewat pilihan Verifikasi/Sengketakan dan catatan. **[B]**

**Daftar periksa:**
- [ ] Uang fisik dihitung di depan kurir.
- [ ] Keputusan beban selisih sesuai kebijakan depot **[K]**.
- [ ] Penghitung "COD belum disetor" di Ringkasan = 0 sebelum tutup buku.

> **[SCREENSHOT REQUIRED: SS-kepala-depot-11 — Panel "Hitung & verifikasi" untuk setoran kurang: Disetor, kurang Rp, kotak "Bebankan selisih", kolom Catatan, tombol Verifikasi dan Sengketakan]**
> *Gambar 3.11 — Verifikasi setoran COD.*

---

### 6.6 Inventori dan opname

#### Prosedur: Menerima barang dan menyesuaikan stok

**Tujuan:** Mencatat stok masuk dan koreksi. **Peran:** Kepala depot (`inventoryWrite`). **Prasyarat:** baris stok sudah ada untuk barang tersebut. **Titik awal:** tab **Inventory** (`/dashboard/inventory`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka **Inventory**. Pilih tab **Stok**. | Tabel kolom: Item, Stok, Dipesan, Tersedia, Min, Aksi. Filter: "Semua", "Bahan baku", "Produk", "Stok menipis". |
| 2 | Untuk barang masuk, tekan **Terima** pada baris. | Isian "Terima {unit} (mis. 10)". |
| 3 | Ketik jumlah bulat. Isi **Alasan (opsional)** (maks 300 karakter). Tekan **Terima stok**. | Stok bertambah, tercatat sebagai pergerakan. |
| 4 | Untuk koreksi, tekan **Sesuaikan**, ketik jumlah bertanda (contoh -5), tekan **Simpan penyesuaian**. | Stok berubah. Hasil akhir tidak boleh di bawah 0. |

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Isi angka bulat (boleh negatif)." | Jumlah kosong/bukan bulat | Ketik angka bulat |
| "Adjustment would drive stock below zero." | Penyesuaian membuat stok di bawah nol | Kurangi jumlah penyesuaian |
| "Khusus staf" / "Inventori tersedia untuk staf depot dan kantor pusat." | Tidak punya hak | Hubungi Admin |

Peran yang hanya boleh membaca melihat tulisan "Hanya lihat". Lencana jenis item tampil sebagai kode mentah (PRODUK, GALON, dan sebagainya). **[V]**

#### Prosedur: Opname stok (hitung fisik)

**Tujuan:** Menyamakan stok sistem dengan hitungan fisik. **Peran:** Kepala depot. **Titik awal:** **Inventory** > baris barang > **Opname**, atau tombol **Opname massal**.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Hitung fisik barang di rak. | — |
| 2 | Pada baris, buka bagian terperinci lalu **Opname**. Isi **Jumlah {unit} hasil opname** (placeholder "saat ini {n}"). | Hanya angka 0 atau lebih: "Isi jumlah 0 atau lebih." |
| 3 | Tekan **Simpan opname**. | Stok sistem **langsung** menjadi jumlah hitungan. Selisih dicatat sebagai pergerakan OPNAME. |
| 4 | Untuk banyak barang: tekan **Opname massal**. Sheet "Lembar opname": isi "Hitung fisik" (kolom: Item, Sistem, Hitung fisik, Selisih). Tekan **Simpan opname** atau **Batal**. | Hanya baris yang berubah dikirim. Satu permintaan per baris. Bila ada yang gagal: "{n} baris gagal disimpan — angkanya masih tersimpan di layar, coba lagi." Tanpa perubahan: "Belum ada perubahan untuk disimpan." |

**Persetujuan Manajer. [V]** (`inventory.service.ts:415-500`; `setting-defs.ts:58-67`)
- Nilai selisih = selisih jumlah × harga jual baris.
- Jika **lebih dari** batas auto-pass (bawaan **Rp100.000**) maka dibuat persetujuan "Selisih opname {item}" berstatus PENDING di antrean Manajer.
- Jika **sama dengan atau di bawah** batas, **tidak ada** persetujuan sama sekali (lolos otomatis).
- Barang tanpa harga jual (bahan baku) bernilai Rp0 sehingga tidak pernah memicu persetujuan.
- Perubahan stok **tidak ditahan** atau dibatalkan oleh persetujuan. Persetujuan hanyalah peninjauan sesudahnya.
- Jika setelah opname jumlah dipesan melebihi jumlah hitung, dibuat persetujuan "Stok kurang dari pesanan: {item}".
- Batas auto-pass hanya dapat diubah Kantor pusat/Super admin. **[K]** nilai per depot dapat berbeda.
- Anda tidak punya akses ke halaman persetujuan, jadi Anda tidak bisa melihat status pengajuan itu. Tanyakan kepada Manajer. **[B]**

**Daftar periksa:**
- [ ] Hitung fisik dilakukan dua kali untuk selisih besar.
- [ ] Penjelasan selisih ditulis di "Alasan".

> **[SCREENSHOT REQUIRED: SS-kepala-depot-12 — Lembar opname massal dengan kolom Item/Sistem/Hitung fisik/Selisih dan sebagian baris berubah]**
> *Gambar 3.12 — Opname massal.*

#### Prosedur lain di Inventory

| Tugas | Cara | Aturan dan pesan |
|---|---|---|
| Titik pesan ulang | Baris > **Titik pesan** > "Titik pesan ulang ({unit})" > **Simpan titik pesan** | "Stok di bawah nilai ini ditandai perlu pesan ulang. 0 = mati." Error: "Isi angka 0 atau lebih." |
| Harga jual depot | Baris PRODUK > **Harga** > "Override harga jual (IDR)" > **Simpan harga**; hapus dengan **Hapus override** | Kosongkan + Hapus untuk kembali ke harga katalog. Sumber harga tampil: "harga khusus depot" / "harga aturan aktif" / "harga katalog". Berlaku langsung tanpa persetujuan. **[V]** |
| Tambah baris stok | **Tambah baris** > "Tambah baris stok": Jenis, Produk ("Pilih produk…"), Nama barang, Satuan, Stok awal, "Stok minimum (0 = tanpa alert)", "Harga khusus depot (opsional)" | Error: "Pilih produk dari katalog dulu." / "Isi nama barangnya." / "Jumlah dan stok minimum harus angka bulat 0 atau lebih." / "Gagal membuat baris stok." Server: "A stock line for this item already exists in the depot." (baris stok sudah ada), "That product is not in the catalog (or is no longer active)." (produk tidak ada di katalog atau tak aktif). Spanduk "{n} produk katalog belum punya baris stok di depot ini" memberi tombol **Buat baris stok**. |
| Hapus baris | Baris > **Hapus baris** | Konfirmasi "Hapus baris stok ini? Hanya bisa untuk baris kosong yang belum pernah terjual." Server: "Count the line down to zero before deleting it; stock on hand is not paperwork." (nolkan stok dulu) / "This line has recorded sales — hide the product instead, its ledger is history." (sudah ada penjualan; sembunyikan produk) |
| Barang ditahan | Baris > **Ditahan oleh order** | Daftar pesanan yang menahan stok atau "Tidak ada order yang menahan stok ini." |
| Riwayat | Baris > **Riwayat stok** atau tab **Pergerakan** | Daftar pergerakan |
| Impor Excel | **Import Excel** (`/dashboard/inventory/import`) | Baris PRODUK wajib punya sku/productId; bahan baku dikosongkan. Hak `inventoryWrite`. |

#### Prosedur: Transfer stok antar depot

**Tujuan:** Mengirim atau menerima stok antar depot. **Peran:** Kepala depot (`inventoryWrite`). **Titik awal:** **Inventory** > tab **Transfer**.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Pada "Kirim ke depot lain", isi **Depot tujuan** ("Pilih depot…"), **Produk**, **Jumlah**. Kirim. | Stok pengirim langsung berkurang. Pengiriman dibatasi stok tersedia (stok dikurangi pesanan). |
| 2 | Untuk membatalkan kiriman keluar, tekan **Tarik kembali** pada daftar "Transfer keluar". | Barang kembali ke depot pengirim. |
| 3 | Untuk kiriman masuk, pada "Transfer masuk (menunggu dihitung)", hitung barang lalu tekan **Terima**. | Stok depot Anda bertambah. |

| Pesan | Arti | Solusi |
|---|---|---|
| "Insufficient stock at the fulfilling depot: ..." | Stok tersedia pengirim tidak cukup | Kurangi jumlah |
| "Depot asal dan tujuan sama." | Tujuan = asal | Pilih depot lain |
| "Transfer ini sudah diterima atau dibatalkan." | Sudah final | Muat ulang |

---

### 6.7 Retur galon

#### Prosedur: Mencatat retur galon kosong dan galon keluar

**Tujuan:** Mencatat galon kosong yang kembali ke depot dan galon isi yang keluar (deposit). **Peran:** Kepala depot (`returnsWrite`). **Prasyarat:** hak `returnsRead`/`returnsWrite`. **Titik awal:** tab **Retur** (`/dashboard/returns`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka **Retur**. | Judul "Retur galon" dan "Retur untuk {depot}". Kartu: "Galon di pelanggan", "Galon keluar", "Galon kembali" (+ "{n} rusak"), "Deposit tertahan". Daftar baris: "{n} galon", lencana "Rusak", deposit Rp. |
| 2 | Tekan **Catat retur**. Isi **Jumlah galon** (wajib, lebih dari 0). | Error bila kosong: "Masukkan jumlah galon (lebih dari 0)." |
| 3 | Isi **Deposit dikembalikan (IDR)**. Kosong berarti tanpa deposit. | Error: "Deposit harus 0 atau lebih." |
| 4 | Pilih **Kondisi**: "Baik (dipakai ulang)" atau "Rusak". Isi **Catatan (opsional)**. | — |
| 5 | Tekan **Simpan retur**. | Retur tercatat. Galon kondisi Baik menambah stok baris GALON (jika baris ada). Kondisi Rusak tidak menambah stok. |
| 6 | Untuk galon keluar: tekan **Catat galon keluar**. Isi **Jumlah galon**, **Deposit ditahan (IDR)**, catatan. Tekan **Simpan**. | Galon keluar tercatat. Error: "Gagal menyimpan galon keluar." |

> Formulir retur **tidak punya kolom pelanggan**. Retur dibandingkan dengan total depot, bukan per pelanggan. **[V]**

**Aturan server. [V]** (`gallon-return.service.ts:60-330`)
- Refund deposit lebih besar dari deposit yang masih ditahan depot ditolak: "Deposit refund exceeds the deposit this depot still holds (refunding X, Y held)." (refund melebihi deposit yang ditahan).
- Retur melebihi galon yang beredar **tidak ditolak**. Retur tercatat dan dibuat persetujuan "GALLON_VARIANCE" untuk Manajer. Nilainya = tarif deposit bawaan Rp20.000 × galon kelebihan. Lolos otomatis jika Rp100.000 atau kurang (kira-kira sampai 5 galon kelebihan pada nilai bawaan). **[K]**
- Retur kondisi Rusak membuat persetujuan "DEPOSIT_REFUND". Retur tanpa pelanggan yang dikenali juga membuat persetujuan serupa; deposit tidak dibayar sampai diputuskan. **[V]**
- Catatan retur disimpan lebih dulu; persetujuan dibuat sesudahnya dengan upaya terbaik.

**Masalah umum:** "Gagal menyimpan retur." / "Gagal menyimpan galon keluar." — ulangi; jika berulang, laporkan ke Manajer.

**Impor saldo galon:** tombol **Import Saldo Galon Pelanggan** (`/dashboard/returns/import`). Hak `returnsWrite`. Akun pelanggan PENDING dibuat untuk nomor baru. Impor ini **tidak mengubah stok fisik GALON**. **[V]**

**Izin & batasan:** Keputusan atas persetujuan galon ada di Manajer. Anda hanya melihat akibatnya.

**Daftar periksa:**
- [ ] Jumlah galon dihitung fisik sebelum dicatat.
- [ ] Galon rusak dipisahkan dari yang baik.

> **[SCREENSHOT REQUIRED: SS-kepala-depot-13 — Halaman Retur galon dengan empat kartu ringkasan dan formulir "Catat retur"]**
> *Gambar 3.13 — Retur galon.*

---

### 6.8 Meteran air

#### Prosedur: Mencatat meteran air pagi dan sore

**Tujuan:** Mencatat angka meteran produksi air untuk mendeteksi kebocoran atau galon keluar tak tercatat. **Peran:** Kepala depot (`meterWrite`). **Prasyarat:** hak `meterRead`/`meterWrite`. **Titik awal:** alamat `/dashboard/meter` (diketik langsung; **tidak ada tab** — **[B]**).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Ketik `/dashboard/meter` di peramban. | Judul "Meteran air", bagian "Catat meteran". Petunjuk: "Isi angka pagi saat buka, angka sore saat tutup. Form yang sama dipakai dua kali." |
| 2 | Pagi: isi **Meteran pagi (m³)**. Opsional **Air baku pagi (m³, opsional)** dan **Level tandon pagi (%, opsional)**. Tekan **Simpan**. | Tanggal diisi hari ini. Tombol berubah "Menyimpan…". |
| 3 | Sore: isi **Meteran sore (m³)** (opsional air baku dan level tandon sore). Tekan **Simpan**. | Kartu hasil: "Air keluar (meteran)", "Air terjual (tercatat)" ("{n} galon terkirim · Rp"), "Selisih" ("± {galon} galon setara (acuan {liter} L)"), "Nilai selisih", "Rendemen RO", "Level tandon", "Perkiraan sisa air", "Perkiraan habis dalam", "Riwayat selisih". |

**Aturan. [V]** (`meter.service.ts`)
- Angka numerik ≥ 0, maksimal 3 desimal.
- Meteran sore tanpa meteran pagi: 422 "Meteran awal hari ini belum dicatat, jadi meteran akhir belum bisa disimpan."
- Meteran sore lebih kecil dari pagi: 422 "Angka meteran produksi akhir tidak boleh lebih kecil dari angka awal." (atau untuk air baku).
- Bentrok edit (dua orang) menghasilkan konflik 409.
- Bila selisih melewati ambang (bawaan 200 liter **[K]**): peringatan "Selisih melewati ambang {liter} liter. Cek galon yang keluar tanpa tercatat, kebocoran, atau salah ketik angka meteran." Satu peringatan "Selisih meteran air" juga dikirim sekali per hari ke nomor/saluran peringatan depot.
- Tidak ada alur persetujuan.

**Masalah umum:** "Gagal menyimpan meteran." atau pesan server di atas. "Akses terbatas" / "Rekonsiliasi meteran air hanya untuk staf depot ke atas." bila tidak punya hak.

**Daftar periksa:**
- [ ] Angka pagi dicatat saat buka.
- [ ] Angka sore dicatat sebelum tutup buku.
- [ ] Peringatan selisih ditindaklanjuti (kebocoran/salah ketik).

> **[SCREENSHOT REQUIRED: SS-kepala-depot-14 — Halaman Meteran air: form catat meteran dan kartu hasil Selisih/Rendemen RO]**
> *Gambar 3.14 — Meteran air.*

---

### 6.9 Laporan dan tutup buku harian

#### Prosedur: Membaca laporan harian dan mingguan

**Tujuan:** Meninjau hasil depot. **Peran:** Kepala depot. **Titik awal:** tab **Laporan** (`/dashboard/reports`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka **Laporan**. Pilih tab **harian** atau **mingguan**. | Tanpa depot terbaca: "Pilih depot" — "Pilih depot di switcher untuk melihat laporan operasional." |
| 2 | Tab harian: pilih **Tanggal laporan**. | Judul "Laporan harian · {tanggal}". Kartu: "Pesanan selesai", "Pendapatan", "COD disetor" (+ "Kas konter"), "Gagal antar". Tabel "Per kurir" (Kurir/Selesai/Gagal/COD), "Galon" (Retur masuk, Keluar, Rusak), "Stok menipis", dan tabel pesanan (No. pesanan, Waktu, Status, Penerima, Kurir, Galon, Subtotal, Ongkir, Diskon, Total). |
| 3 | (Opsional) tekan **Ekspor Excel**, **CSV**, atau **PDF**. | File "laporan-harian". Gagal: "Gagal mengekspor laporan." |
| 4 | Tab mingguan: baca "Laporan mingguan": Pesanan, Rata-rata per hari, SLA tepat waktu, Pendapatan per hari, Produk terlaris, "Kurir terbaik pekan ini". | — |

#### Prosedur: Menutup buku harian

**Tujuan:** Mengunci angka kas dan COD satu hari. **Peran:** Kepala depot (`dailyClose`; juga Manajer, Kantor pusat, Direktur, Super admin). **Prasyarat:** semua shift kasir depot sudah ditutup. **Titik awal:** **Laporan** > tab **harian**.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Pastikan semua shift kasir tertutup (6.4) dan setoran COD terverifikasi (6.5). | — |
| 2 | Pilih **Tanggal laporan**. Tinjau angka. | — |
| 3 | Tekan **Tutup buku**. | Server menyimpan snapshot kas masuk, kas keluar, kas konter, COD disetor, COD diharapkan untuk hari itu (zona waktu depot). Lencana "Buku ditutup". |

**Penolakan yang mungkin. [V]** (`daily-close.service.ts`)

| Pesan | Arti | Solusi |
|---|---|---|
| "Masih ada {n} shift kasir terbuka. Tutup shift dulu, baru buku harian." | Ada shift kasir terbuka di depot | Tutup shift (milik Anda sendiri, atau minta Manajer menutup shift orang lain) |
| "Hari ini sudah ditutup." | Hari itu sudah ditutup | Tidak perlu tindakan |
| "Bulan {YYYY-MM} sudah ditutup. Buka bulan itu dulu untuk mengubah hari {tanggal}." | Bulan sudah dikunci | Hanya Kantor pusat yang bisa membuka |
| "Tanggal tidak valid (pakai YYYY-MM-DD)." | Tanggal tidak valid | Pilih ulang |
| "Gagal menutup buku." | Kesalahan umum | Coba lagi |
| "Status tutup buku tidak bisa dibaca." | Status tidak terbaca | Muat ulang |

Total COD yang tidak terbaca membuat penutupan gagal dengan aman (tidak jadi ditutup). **[V]**

**Setelah ditutup:** lencana "Buku ditutup". Uang yang masuk setelah tutup tampil sebagai "{n} entri masuk setelah tutup ({nominal})". Tombol **Buka kembali** hanya terlihat untuk Kantor pusat dan Super admin. **Kepala depot tidak pernah melihatnya.** **[V]**

**Hal yang tidak dipaksa sistem. [V]** Tutup buku hanya diblokir oleh shift kasir yang masih terbuka. Sistem **tidak memaksa** setoran COD harus terverifikasi sebelum tutup, dan tidak memeriksa selisih. Pastikan sendiri "COD belum disetor" = 0. **[B]**

**Hasil akhir:** hari terkunci. Tidak ada persetujuan atasan.

**Daftar periksa:**
- [ ] Semua shift kasir tertutup.
- [ ] Semua setoran COD terverifikasi atau disengketakan dengan catatan.
- [ ] Opname dan meteran sore selesai.
- [ ] Tutup buku ditekan untuk tanggal yang benar.

> **[SCREENSHOT REQUIRED: SS-kepala-depot-15 — Laporan harian dengan tombol "Tutup buku" dan, pada kondisi kedua, lencana "Buku ditutup"]**
> *Gambar 3.15 — Tutup buku harian.*

---

### 6.10 Promo dan aturan promo

#### Tab Promo (hanya baca secara server)

**Titik awal:** tab **Promo** (`/dashboard/promotions`). Anda bisa melihat daftar promo dan tombol **Analitik**. Halaman juga menampilkan **Promo baru**, **Edit**, dan **Hapus**, tetapi server hanya mengizinkan Marketing, Manajer, dan Super admin menulis. Jika Anda menekannya, server menjawab 403 "You do not have permission to perform this action." (artinya: Anda tidak punya izin melakukan tindakan ini). Pesan di layar bisa berupa "Gagal menyimpan promo." atau "Gagal menghapus promo." **[B]** **[V]** (`promotions/page.tsx:340-415`; `access/index.ts:125`)

Untuk membuat atau mengubah promo spanduk, minta Manajer atau Marketing. Voucher tidak punya halaman untuk Anda.

#### Prosedur: Membuat aturan promo otomatis untuk depot sendiri

**Tujuan:** Membuat promo otomatis saat checkout (jadwal, produk, kelipatan) untuk depot Anda. **Peran:** Kepala depot (`promoRuleWrite`). **Prasyarat:** hak `promoRuleRead`/`promoRuleWrite`. **Titik awal:** alamat `/dashboard/promo-rules` (diketik langsung — **tidak ada tab**, **[B]**).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka `/dashboard/promo-rules`. | Judul "Aturan promo" — "Promo otomatis saat checkout — jadwal, produk, kelipatan". |
| 2 | Tekan **＋ Aturan baru**. Isi **Nama**. | — |
| 3 | Pilih **Jenis**: "Harga khusus (SPECIAL_PRICE)", "Beli X dapat Y (BUY_X_GET_Y)", "Potongan ongkir (SHIPPING_DISCOUNT)", "Diskon persen per produk (PERCENTAGE_OFF)", "Gratis produk lain (BUNDLE_GIFT)", "Diskon minimum belanja (ORDER_DISCOUNT)". | Kolom menyesuaikan jenis. |
| 4 | Isi **Depot (ID)** = depot Anda. Atur Produk/Semua produk, Kategori, Mulai, Berakhir, Hari, Jam mulai, Jam berakhir, Qty minimum/maksimum, Channel (Aplikasi, Kasir), Aktif, "Hanya pelanggan baru". | Kosongkan Depot (berlaku jaringan) **tidak** bisa untuk Anda. |
| 5 | Simpan. | Aturan tampil dengan lencana "Aktif"/"Nonaktif" dan tombol **Edit**, **Hapus**, **Duplikat**. |

**Pesan validasi:** "Nama wajib diisi." · "Isi diskon persen dengan bilangan 1-99." · "Isi minimum belanja dan potongannya (nominal, atau persen 1-99)." · "Isi jumlah beli, jumlah gratis, dan pilih produk hadiah." · "Hadiah harus produk yang berbeda — untuk produk yang sama pakai Beli X Gratis Y." · "Gagal menyimpan aturan promo." · "Aturan promo ini sudah pernah dipakai — nonaktifkan saja, jangan hapus." (aturan terpakai tidak boleh dihapus). **[V]**

**Izin & batasan:** Aturan **jaringan** (tanpa depot) terlihat tetapi **Edit/Hapus disembunyikan**. Anda hanya bisa mengubah aturan depot Anda. Tidak ada persetujuan atas aturan depot. Dampaknya langsung ke harga pelanggan, jadi koordinasikan dengan Manajer. **[V]**

**Daftar periksa:**
- [ ] Rentang tanggal dan jam benar.
- [ ] Aturan dicoba pada contoh keranjang.

> **[SCREENSHOT REQUIRED: SS-kepala-depot-16 — Halaman Aturan promo dengan daftar aturan dan formulir "＋ Aturan baru"]**
> *Gambar 3.16 — Aturan promo depot.*

---

### 6.11 Broadcast

#### Prosedur: Mengirim pengumuman ke kurir atau pelanggan depot

**Tujuan:** Menyampaikan info ke kurir aktif atau ke segmen pelanggan depot. **Peran:** Kepala depot (`depotBroadcast`; pelanggan memakai `depotCampaign`). **Titik awal:** tab **Broadcast** (`/dashboard/broadcast`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka **Broadcast**, tekan **Pesan baru**. Pilih **Kirim ke**: "Kurir aktif", "Semua pelanggan", "Berisiko churn" (tidak order ≥60 hari), atau "Pelanggan baru" (≤30 hari). | Untuk pelanggan tampil "Kirim ke {n} pelanggan". Catatan: "Broadcast pelanggan hanya ke pelanggan depot Anda. Kampanye lintas depot & email/SMS dikelola tim marketing." |
| 2 | Untuk kurir: pilih **Level** (Info, Mendesak, Terjadwal). | — |
| 3 | Isi **Judul** (maks 120; contoh "Stok galon 19L menipis") dan **Pesan** (maks 2000). | — |
| 4 | Tekan **Kirim broadcast**. | Untuk kurir: pemberitahuan di aplikasi kurir, daftar "Terkirim". Untuk pelanggan: kampanye dibuat lalu dikirim bertahap oleh penjadwal (sapuan tiap 2 menit). |

**Masalah umum:** "Isi judul dan pesan dulu." · "Gagal mengirim broadcast." · "A campaign needs at least one recipient." (kampanye butuh minimal satu penerima). Kosong: "Belum ada broadcast terkirim."

**Izin & batasan:** Tidak ada persetujuan atas blast pelanggan di kode. Anda bertanggung jawab atas isi dan jumlah penerima. Kampanye lintas depot dan email/SMS bukan wewenang Anda. Saluran pesan pelanggan adalah kotak masuk aplikasi dan notifikasi dorong; WhatsApp tidak lagi menjadi saluran kirim. **[V]** (temuan I) Beberapa teks di UI atau komentar kode masih menyebut WhatsApp. **[B]**

**Daftar periksa:**
- [ ] Segmen penerima benar sebelum menekan kirim.
- [ ] Pesan ke kurir pakai level "Mendesak" hanya untuk hal darurat.

---

### 6.12 Penukaran hadiah

#### Prosedur: Menyerahkan hadiah yang ditukar poin

**Tujuan:** Menyerahkan hadiah kepada pelanggan lalu menandainya. **Peran:** Kepala depot (`rewardHandover`). **Titik awal:** tab **Hadiah** (`/dashboard/redemptions`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka **Hadiah**. | Judul "Penukaran hadiah" — "Hadiah yang sudah ditukar poin dan menunggu diambil pelanggan." Baris: "Kode", "{n} poin", "Menunggu sejak {waktu}", "Depot mana pun" bila tanpa depot pengambilan. |
| 2 | Minta pelanggan menunjukkan kode di layar. **Cocokkan kode.** | Petunjuk: "Cocokkan kode di layar pelanggan sebelum menyerahkan hadiah. Setelah ditandai, pelanggan tidak bisa membatalkan lagi." |
| 3 | Serahkan hadiah, tekan **Sudah diambil**. | Toast "Hadiah ditandai sudah diambil." |

**Pesan:** "Gagal menandai hadiah." · "Penukaran ini sudah dibatalkan." · "Hadiah ini baru saja diserahkan oleh depot lain." · "Penukaran hadiah tidak ditemukan." Kosong: "Tidak ada hadiah yang menunggu diambil." Klik berulang tidak berbahaya (idempoten). **[V]**

---

### 6.13 Jadwal shift kurir

#### Prosedur: Mengatur jadwal shift mingguan kurir

**Tujuan:** Menjadwalkan kurir Pagi/Sore/Libur per hari. **Peran:** Kepala depot (`driverRoster`; semua staf boleh membaca). **Titik awal:** tab **Shift** (`/dashboard/shift`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka **Shift**. Pilih pekan dengan "Pekan sebelumnya"/"Pekan {rentang}"/"Pekan berikutnya". | "Jadwal shift kurir" + nama depot. Legenda Pagi/Sore/Libur. |
| 2 | Tekan **Atur shift**. | Tombol menjadi "Selesai atur". |
| 3 | Tekan sel kurir × hari untuk berganti: Libur → Pagi → Sore → Libur. | Sel kosong dianggap Libur. |
| 4 | (Opsional) tekan **Salin minggu lalu**. | Bila kosong: "Minggu lalu kosong, tidak ada yang disalin." Gagal: "Gagal menyalin jadwal minggu lalu." |
| 5 | Tekan **Selesai atur**. | Perubahan tersimpan. Gagal: "Gagal menyimpan shift." |
| 6 | (Opsional) **Ekspor Excel** atau **CSV**. | Gagal Excel: "Gagal membuat file Excel. Coba ekspor CSV." |

Kosong: "Belum ada kurir" — "Belum ada kurir aktif untuk dijadwalkan di depot ini." Ini jadwal **kurir**. Absen Anda sendiri ada di **Absen saya**. **[V]**

> Jadwal ini tidak otomatis mengunci kurir. Penugasan memeriksa kurir yang sudah check-in shift, bukan jadwal. **[D]**

---

### 6.14 Huddle, serah terima shift, dan perawatan alat

> **[B]** Tiga halaman ini menampilkan pesan penolakan "Khusus Manajer depot" untuk peran yang tidak berwenang. Kepala depot **berwenang** (`depotHuddle`, `depotHandover`, `depotMaintenance`). Pesan itu hanya muncul bila hak Anda dicabut Admin. **[V]**

#### Huddle mingguan (tab Huddle)

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Buka **Huddle**. Bila belum ada: "Belum ada huddle minggu ini" — tekan **Mulai huddle**. | Minggu dihitung mulai Senin. |
| 2 | **Kehadiran**: tekan **Catat kehadiran**/**Ubah kehadiran**, ketik (contoh "8 dari 9 hadir"), **Simpan**. | — |
| 3 | **Agenda & catatan**: **Tambah agenda**, isi **Judul agenda** dan **Catatan**, **Tambah**. | Kosong: "Belum ada agenda." |
| 4 | **Action item · {selesai}/{total} selesai**: **Tambah action item**, isi **Action item** dan **Penanggung jawab**, **Tambah**. | — |

Error: "Gagal menyimpan huddle." Bentrok edit dijaga (versi terakhir yang dilihat).

#### Prosedur: Serah terima shift

**Tujuan:** Memindahkan tanggung jawab shift dengan daftar periksa. **Titik awal:** tab **Serah terima**.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Tekan "Serah terima baru". Atur **Shift dari** (bawaan Pagi) dan **Shift ke** (bawaan Sore). | — |
| 2 | Isi **Staf serah** dan **Staf terima** (**wajib**). | Kosong: "Isi nama staf serah dan terima." |
| 3 | Tandai **Checklist**: ketuk item untuk berganti kosong → sebagian → selesai. Bawaan: "Hitung kas laci", "Cek stok galon & segel", "Order tertunda dialihkan", "Insiden terbuka diberi tahu", "Setoran COD diverifikasi". | — |
| 4 | Isi **Catatan (opsional)**, tekan **Buat serah terima**. | Gagal: "Gagal membuat serah terima." |
| 5 | Buka detail ("{selesai} dari {total} selesai"), tekan **Tandatangani serah terima**. | Berubah menjadi "Sudah ditandatangani" + waktu. Gagal: "Gagal menandatangani serah terima." |

> **[B]** Layar menyuruh melengkapi sisa item sebelum menandatangani, tetapi tombol **tidak dikunci** dan server tidak memeriksa checklist. Tanda tangan bisa diberikan walau checklist belum selesai. Disiplin ada pada Anda. **[V]** (`handover.service.ts:66-69`)

#### Perawatan alat (tab Perawatan)

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Buka **Perawatan**. | Judul "Perawatan alat", "{depot} · {n} jatuh tempo". Lencana: "Jatuh tempo", "{n} hari lagi", "Baru", "Sehat". Kosong: "Belum ada jadwal". |
| 2 | Tekan **Jadwalkan**. Isi **Nama alat** (contoh "Filter RO membran"), **Kategori** (contoh "Filtrasi"), **Interval (hari)**, **Servis berikutnya** (tanggal). | Semua **wajib**: "Nama, kategori, interval, dan tanggal berikutnya wajib diisi." |
| 3 | Tekan **Simpan jadwal**. | Gagal: "Gagal menjadwalkan." |
| 4 | Setelah alat diservis, tekan **Tandai servis** pada barisnya. | Tanggal berikutnya dihitung dari interval. Gagal: "Gagal menandai servis." |

Teks interval: "Servis tiap {n} hari" atau "Servis tiap {n} bln". **[V]**

**Daftar periksa:**
- [ ] Huddle mingguan dicatat.
- [ ] Serah terima shift ditandatangani kedua pihak.
- [ ] Alat jatuh tempo dijadwalkan servis.

---

### 6.15 Insiden

#### Prosedur: Melaporkan dan menyelesaikan insiden depot

**Tujuan:** Mencatat kejadian operasional dan menutupnya. **Peran:** Kepala depot (`incidents`). **Titik awal:** tab **Insiden** (`/dashboard/incidents`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka **Insiden**. Filter: "Semua", "Baru" (OPEN), "Ditangani" (IN_PROGRESS), "Selesai" (RESOLVED). | Judul "Insiden" dan "{n} terbuka". Kosong: "Tidak ada insiden". |
| 2 | Tekan **Laporkan insiden**. Pilih **Jenis**: Kurir terjatuh, Kendaraan mogok, Konflik pelanggan, Listrik padam, Galon bocor / rusak, Lainnya. | — |
| 3 | Pilih **Tingkat**: BERAT, SEDANG, RINGAN. | — |
| 4 | (Opsional) **Kurir (opsional)**, **Nomor pesanan (opsional)** (contoh HM-260902-001), **Nomor HP pelanggan**. | Dengan nomor HP, keluhan "Konflik pelanggan" juga masuk antrean pusat; kartu bertanda "Diteruskan ke pusat" atau "Tidak diteruskan". |
| 5 | Isi **Judul** ("Ringkas dalam satu kalimat"; 3–120 karakter) dan **Keterangan** (maks 1000). | — |
| 6 | Tekan **Kirim laporan**. | Gagal: "Judul terlalu pendek — tulis apa yang terjadi." / "Laporan gagal dikirim." |
| 7 | Untuk menutup: pada kartu tekan **Tindak lanjut** atau **Tandai selesai**, isi **Catatan penyelesaian** (min 3 karakter; contoh "Sudah ditangani manajer, pelanggan dihubungi"). | Gagal: "Tulis catatan penyelesaian minimal 3 karakter." / "Gagal menyelesaikan insiden." Hasil: "Diselesaikan {waktu}". |

Daftar kedua **Laporan insiden kurir** (hanya baca): "Dilaporkan kurir dari jalan. Yang HIGH sudah masuk feed ops; sisanya dibaca di sini." Kosong: "Belum ada laporan insiden dari kurir depot ini." Ada tautan "Lihat foto". **[V]**

**Izin & batasan:** Kode mengizinkan Kepala depot menyelesaikan insiden, walau komentar hak akses menyebut Manajer yang menyelesaikan. **[V]** (`access/index.ts:293-295`) Hanya laporan kurir tingkat Darurat (HIGH) yang diteruskan ke tim operasional. **[V]**

---

### 6.16 Sengketa order

#### Prosedur: Mencatat dan menyelesaikan sengketa pelanggan

**Tujuan:** Menangani klaim pelanggan atas pesanan. **Peran:** Kepala depot (`depotDisputes`). **Titik awal:** alamat `/dashboard/disputes` (**tidak ada tab**, **[B]**).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Ketik `/dashboard/disputes`. | "Sengketa order" — "{n} terbuka · klaim pelanggan". Chip: Semua, Terbuka, Selesai, Ditolak. |
| 2 | Tekan "Catat sengketa". Isi **Nomor order** (contoh ORD-2418), **Nama pelanggan**, **Kategori** (Salah item, Tidak diterima, Lebih bayar, Kualitas, Lainnya), **Nilai (Rp, opsional)**, **Kurir (opsional)**, **Keterangan**. | Wajib: nomor order, nama pelanggan, keterangan. Pesan: "Nomor order, nama pelanggan, dan keterangan wajib diisi." |
| 3 | Tekan **Simpan sengketa**. | Sengketa berstatus OPEN. |
| 4 | Untuk menutup, isi **Catatan (opsional)** lalu pilih **Refund ({nominal})**, **Kirim ulang**, atau **Tolak**. | **Tolak** → Ditolak. **Kirim ulang** hanya menandai selesai; **tidak membuat pesanan pengganti**. |

> **[B] Refund tidak dapat dijalankan oleh Kepala depot.** Tombol **Refund** meminta refund dengan hak akses Anda, sedangkan hak `refundIssue` hanya milik Finance, Manajer, Super admin. Permintaan ditolak, sengketa tetap OPEN, dan muncul "Refund tidak bisa diminta: {alasan}". Teruskan sengketa bernilai uang ke Manajer. Refund bernilai besar tetap butuh persetujuan Kantor pusat/Finance. **[V]** (`dispute.service.ts:100-124`; teks penolakan **[D]**)

Alasan tidak-bisa-refund yang mungkin: "integrasi refund belum dikonfigurasi", "sesi tidak terbaca, refund tidak diminta", "pesanan {ref} tidak ditemukan", "nomor {ref} cocok dengan {n} pesanan". Pesan lain: "This dispute has already been resolved or rejected." (sengketa sudah selesai/ditolak) · "Gagal menyelesaikan sengketa." Teks penolakan akses "Khusus Manajer depot" menyesatkan; Kepala depot berwenang. **[B]**

---

### 6.17 Pelanggan, CRM, dan impor

#### Direktori pelanggan (tab Pelanggan)

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Buka **Pelanggan**. Cari lewat **Cari nama atau telepon**. | Kolom: Pelanggan, Pesanan, Galon dipinjam, Terakhir, Detail. Lencana "Langganan"; "Tanpa nama"; "Data galon depot belum tersambung". |
| 2 | Tekan baris untuk detail. | Statistik: Total pesanan, Nilai belanja, Galon dipinjam; "Risiko churn" (dengan saran retensi); "Deposit galon"; "Pesanan terakhir"; "Alamat" ("Utama", "Dalam jangkauan"/"Luar jangkauan"). |
| 3 | Tombol **Hubungi** membuka panggilan telepon. | — |

> **[B]** Tombol **Buatkan pesanan** pada detail pelanggan **tidak membuat pesanan**; hanya membuka antrean pesanan. Foto pendaftaran agen tidak tampil untuk Kepala depot. **[V]** (`customers/detail/page.tsx:276-280`)

#### Prosedur: Impor pelanggan atau alamat dari Excel

**Tujuan:** Memasukkan banyak pelanggan sekaligus. **Peran:** Kepala depot (`depotCrmWrite`). **Titik awal:** **Pelanggan** > **Import Excel** atau **Import Alamat Pelanggan**.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Pastikan satu depot terpilih. | Jika tidak: "Pilih satu depot dulu di pemilih depot". Untuk Kepala depot, depot Anda otomatis satu. |
| 2 | Tekan **Unduh template Excel**. Isi kolom: **fullName*** (≤120), **phone*** (≤32, nomor HP Indonesia), addressLine (≤255), city, province, landmark. | Mengisi alamat berarti kota wajib. |
| 3 | Tekan **Pilih file** (.xlsx atau .csv saja, maks 500 baris). | Ringkasan "{n} baris siap" / "{n} baris bermasalah". |
| 4 | Unduh baris bermasalah (**Unduh baris bermasalah** / **Unduh baris gagal**), perbaiki, unggah ulang. | — |

Pesan: "Maksimal {max} baris per file (file ini {count})." · "bukan nomor HP Indonesia yang sah" · "Format lama (.xls / .ods) tidak bisa dibaca..." · "File kosong atau tidak punya baris data." · "Kolom wajib hilang: {kolom}." · "Impor gagal, coba lagi." Pelanggan yang diimpor tetap mendaftar lewat OTP dan otomatis tertaut. **[V]**

#### CRM & follow-up (hanya URL)

Alamat `/dashboard/crm`, hanya baca. Kartu: "Baru" (order pertama ≤30 hari), "Aktif" (order ≤30 hari terakhir), "Tidak aktif" (tidak order >30 hari), "Total pelanggan", "Repeat rate". "Antrean follow-up" berisi pelanggan tanpa order >60 hari dengan tombol **WhatsApp** (membuka tautan wa.me dengan templat sapaan). Ini membuka aplikasi WhatsApp Anda sendiri, bukan kirim sistem. **[V]** **[B]** karena tidak ada tab.

---

### 6.18 Halaman pendukung lain

| Halaman | Rute | Apa yang Anda lihat/lakukan | Catatan |
|---|---|---|---|
| Notifikasi | `/dashboard/notifications` (tab Notifikasi + lonceng) | "Riwayat notifikasi"; kelompok "Hari ini"/"Kemarin"; tombol **Tandai semua dibaca**; filter Semua, Belum dibaca, Pesanan, Stok, Kurir, Penjualan, HR; lencana "Gagal kirim". Kosong: "Tidak ada peringatan". | Teks "dari seluruh jaringan depot" **[B]**; umpan sebenarnya hanya depot Anda. Status baca tersimpan per akun. Hanya "Stok menipis" dan "Insiden kurir" berjudul Indonesia; event lain tampil sebagai kode mentah. |
| Audit | `/dashboard/audit` | "Jejak audit" depot Anda, chip Semua, Harga, Pengembalian dana, Staf. Hanya baca. | Kosong: "Belum ada aktivitas" |
| Perkiraan | `/dashboard/forecast` (URL) | "Perkiraan permintaan", pilihan "Rentang prediksi" dan "Jendela riwayat", tabel produk dan "Prediksi pendapatan". Hanya baca. | Kosong: "Belum ada perkiraan" |
| Kelola depot | tab **Kelola depot** | Daftar/Peta, detail depot (Profil, Alamat, Koordinat, Radius layanan, Ongkir, Min. order, Hari libur, Ringkasan stok). | **Hanya baca.** Tombol "Depot baru", "Ubah", "Jam & libur", "Nonaktifkan/Aktifkan" disembunyikan untuk Anda. |
| Pembayaran | tab **Pembayaran** | Kosong | **[B]** Tab tampil tetapi ditolak: "Akses manajer depot" — "Pengaturan pembayaran hanya untuk manajer depot dan super admin." QRIS/rekening diatur Manajer. |
| Pengaturan depot | `/dashboard/depot-settings` | Ditolak: "Khusus Manajer depot" — "Pengaturan depot butuh hak depotAdmin." | **[V]** |
| Peran & akses | `/dashboard/roles` | Matriks hak akses hanya baca ("Read-only"). | Hanya Super admin dapat mengubahnya. Daftar tampil adalah nilai bawaan. |
| Akun saya | `/dashboard/account` | "Pengaturan": "Alert yang dikirim", "Bahasa", "PIN persetujuan", "Perangkat masuk". | — |

---

### 6.19 HRIS mandiri untuk Kepala depot (/hr/me)

**Titik awal:** tab **Absen saya** (`/hr/me`). Layar bersih tanpa tab; tautan "← Kembali ke konsol" kembali ke dasbor. Prasyarat: akun tertaut ke karyawan aktif. **[V]**

Menu: "Halo, {nama}" — "Layanan mandiri karyawan". Kartu: "Absen Sekarang", "Absensi Saya", "Slip Gaji Saya", "Cuti Saya", kasbon, "Pengumuman", "Daftar / Perbarui Wajah". Prosedur lengkapnya sama dengan yang dipakai kurir dan dijelaskan terperinci di Bab 4, bagian 6.15–6.20. Ringkasan khusus Kepala depot:

| Tugas | Langkah singkat | Catatan |
|---|---|---|
| Daftar wajah (sekali) | **Daftar / Perbarui Wajah** > **Ambil Foto** (1–3 foto) > centang persetujuan > **Simpan** | Wajib sebelum absen pertama. |
| Absen | **Absen Sekarang** > pilih Check-in/Check-out > **Ambil Foto** | Perlu kamera dan GPS. Geofence depot hanya berlaku bila depot mengaturnya. |
| Cuti | **Cuti Saya** > isi Jenis, Mulai, Selesai, Alasan > **Ajukan Cuti** | Tahap 1: **Manajer** (atau HR); tahap 2: HR. Anda tidak menyetujui cuti. |
| Kasbon | **Kasbon Saya** > Nominal, Alasan > **Ajukan Kasbon** | Diputuskan Asisten SPV depot bila ada; bila tidak ada, Manajer/HR. Anda tidak memutuskan kasbon. Cicilan ditentukan penyetuju. |
| Slip gaji | **Slip Gaji Saya** > pilih periode > **Unduh PDF** | Slip berstatus Draft juga terlihat sebelum HR menyetujui; angka bisa berubah. **[B]** |

**Waktu absen vs shift kasir:** absen wajah (HRIS) dan shift kasir (konter) adalah dua hal terpisah. Absen wajah tidak membuka shift kasir. **[V]**

---

## 7. Kolom wajib & aturan validasi (ringkasan)

| Formulir | Kolom wajib | Batas/format | Bukti |
|---|---|---|---|
| Buka shift kasir | — (kosong = 0) | Angka bulat 0..batas | **[V]** |
| Tutup shift kasir | Uang tunai dihitung | Bulat 0..batas; catatan ≤500 | **[V]** |
| Penjualan konter | Produk/jumlah; metode bayar; tunai ≥ total | Voucher butuh nomor HP; galon kosong ≤ galon isi | **[V]** |
| Batalkan penjualan | Alasan | ≤255 karakter | **[V]** |
| Konfirmasi pembayaran | — | Uang tunai diterima opsional | **[V]** |
| Tarik/Batalkan pengiriman | Alasan | Teks bebas | **[V]** |
| Verifikasi setoran | Catatan bila sengketa atau setoran lebih >Rp5.000 | — | **[V]** |
| Terima/Sesuaikan stok | Jumlah bulat | Alasan ≤300; hasil tidak <0 | **[V]** |
| Opname | Jumlah hitung ≥0 | Alasan ≤300 | **[V]** |
| Tambah baris stok | Jenis, produk/nama, satuan | Stok awal & minimum bulat ≥0 | **[V]** |
| Retur galon | Jumlah >0 | Deposit ≥0; refund ≤ deposit ditahan | **[V]** |
| Meteran | Pagi dulu, sore ≥ pagi | ≥0, 3 desimal | **[V]** |
| Tutup buku | Tanggal | YYYY-MM-DD; catatan ≤500 | **[V]** |
| Broadcast | Judul, pesan | Judul ≤120, pesan ≤2000 | **[V]** |
| Insiden | Judul 3–120, keterangan ≤1000 | Catatan selesai 3–1000 | **[V]** |
| Sengketa | Nomor order, nama, keterangan | — | **[V]** |
| Serah terima | Staf serah, staf terima | Shift 1–60; staf 1–120 karakter | **[V]** |
| Perawatan | Nama, kategori, interval, tanggal | — | **[V]** |
| Impor pelanggan | fullName, phone | ≤500 baris; .xlsx/.csv | **[V]** |

---

## 8. Kesalahan umum & solusi

| Gejala | Penyebab | Solusi |
|---|---|---|
| Tab **Pembayaran** menolak akses | Hak `depotAdmin` hanya Manajer/Super admin | Minta Manajer mengisi QRIS/rekening **[B]** |
| Tombol di **Promo** menghasilkan error 403 | Server hanya baca untuk Anda | Minta Manajer/Marketing **[B]** |
| Halaman meteran, aturan promo, sengketa, CRM tidak ada di tab | Halaman hanya lewat URL | Simpan alamatnya sebagai bookmark **[B]** |
| Badge status berbahasa Inggris | Terjemahan belum terpasang | Lihat padanan di 6.2 **[B]** |
| Tidak bisa membatalkan pesanan Preparing | Tidak ada tombol di UI | Minta Manajer atau gunakan "Batalkan pengiriman" bila sudah ditugaskan **[B]** |
| Tidak bisa melihat status persetujuan opname/galon | Halaman persetujuan hanya Manajer | Tanya Manajer **[B]** |
| Setoran Sengketa tidak bisa diselesaikan | Tombol tidak ada di UI | Hubungi Manajer/Kantor pusat **[B]** |
| "Pesanan masuk" tidak sama dengan jumlah hari ini | Memakai 100 pesanan terbaru | Pakai **Laporan** > harian untuk angka resmi **[B]** |
| Pesan error server berbahasa Inggris | Server belum menerjemahkan | Lihat terjemahan di tabel masalah tiap prosedur |
| "Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya." | Anda menyentuh data depot lain | Wajar; depot Anda terkunci **[V]** |
| "You do not have permission to perform this action." | Hak akses tidak ada (artinya: tidak punya izin) | Minta peran yang berwenang atau Admin |

---

## 9. Batasan peran (apa yang TIDAK bisa; butuh persetujuan siapa)

### 9.1 Batas wewenang Kepala depot, Manajer, dan Kantor pusat

| Situasi | Kepala depot dapat | Butuh |
|---|---|---|
| Opname dengan nilai selisih **> Rp100.000** (bawaan, `approvalAutoPassIdr`) | Menyimpan hitungan (stok langsung berubah) | **Manajer** memutuskan di Antrean approval (Setujui/Tolak/Tahan) |
| Opname ≤ Rp100.000 | Selesai sendiri | Tidak ada persetujuan sama sekali |
| Stok kurang dari pesanan setelah opname | Menyimpan hitungan | Persetujuan Manajer "Stok kurang dari pesanan: {item}" |
| Retur galon melebihi saldo beredar; retur rusak; retur tanpa pelanggan | Mencatat retur | Persetujuan Manajer (GALLON_VARIANCE / DEPOSIT_REFUND) |
| Mengubah batas auto-pass Rp100.000 | **Tidak bisa** | **Kantor pusat** atau Super admin (`approvalThresholdWrite`) |
| Kekurangan setoran COD | Memutuskan sendiri: bebankan ke kurir atau tidak, atau sengketakan | Tidak ada persetujuan (jenis COD_VARIANCE tidak dipakai) |
| Selisih laci kas saat tutup shift | Hanya tercatat | Tidak ada persetujuan |
| Refund pesanan ("Ajukan refund", tombol Refund pada sengketa) | **Tidak bisa** | Manajer/Finance mengajukan; Finance memutuskan; nilai besar (>Rp100.000 bawaan `REFUND_HQ_THRESHOLD`) menunggu persetujuan Kantor pusat/Finance |
| Membuka kembali hari yang sudah ditutup | **Tidak bisa** | **Kantor pusat** atau Super admin |
| Membuat/mengubah/menghapus promo spanduk | Hanya melihat | Marketing atau Manajer |
| Voucher | Tidak punya halaman | Marketing atau Manajer |
| Aturan promo | **Bisa**, hanya depot sendiri | Aturan jaringan oleh pusat |
| Data depot, jam buka, hari libur, QRIS/rekening, ongkir, radius, harga katalog | **Tidak bisa** | **Manajer** (`depotAdmin`) |
| Harga jual per baris stok ("Harga") | **Bisa**, langsung berlaku | Impor harga massal masuk persetujuan Kantor pusat |
| Akun staf dan peran | **Tidak bisa** | Kantor pusat (`staffAdmin`), Super admin |
| Pesanan pembelian dan pemasok | **Tidak bisa** | Manajer |
| Susut, loyalty, referral, rating, langganan, target, harga borongan, buku kas, rekonsiliasi pembayaran, komisi, ulasan bulanan | **Tidak punya menu** | Manajer dan peran keuangan |
| Menutup shift kasir orang lain | **Tidak bisa** | Manajer/SPV/Finance/Direktur/Super admin |
| Menyetor COD atas nama kurir | **Tidak bisa** | Kurir sendiri |
| Menyetujui klaim pengeluaran kurir | **Tidak bisa** (`expenseApprove`) | Manajer (sampai Rp500.000 bawaan), Finance di atasnya |
| Menyetujui cuti | **Tidak bisa** | Tahap 1 Manajer/HR, tahap 2 HR |
| Menyetujui kasbon | **Tidak bisa** | Asisten SPV (jika ada), Manajer, HR |
| Membatalkan pesanan yang belum dikirim | Tidak ada tombol | Manajer/Kantor pusat |
| Data depot lain | **Terkunci** | — |

> Seluruh nilai ambang di atas adalah bawaan kode. Pengaturan depot atau Kantor pusat dapat berbeda. **[K]**

### 9.2 Terkunci pada satu depot

Peran Kepala depot dan kurir terkunci pada satu depot yang tercantum di token akses. Nama depot lain dalam permintaan ditolak dengan "Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya." Akun tanpa depot ditolak dengan "Akun ini belum diberi tanggung jawab depot manapun." Karena itu tidak ada pemilih depot di header Anda. Penempatan diubah HR. **[V]**

### 9.3 Masalah UI yang diketahui

1. **[B]** Tab ditolak server: **Pembayaran** tampil di bilah tab tetapi ditolak.
2. **[B]** Halaman hanya lewat URL (tanpa tab): Meteran air, Aturan promo, Sengketa order, CRM & follow-up, Perkiraan, Peran & akses, Akun saya, Pencarian.
3. **[B]** Status berbahasa Inggris: status pesanan; status pembayaran/pengiriman tampil sebagai kode mentah.
4. **[B]** Tombol tampil tetapi server menolak: **Promo baru**, **Edit**, **Hapus** pada tab Promo.
5. **[B]** Pesan penolakan menyesatkan ("Khusus Manajer depot") pada halaman yang Kepala depot berwenang atasnya.
6. **[B]** Tombol tidak ada di UI walau server mendukung: batalkan pesanan, selesaikan setoran Sengketa.
7. **[B]** "Data akun", "Ubah PIN", dan "Ambang low-stock default" pada Pengaturan tidak berfungsi.

---

## 10. Pertimbangan keamanan

- **Keluar setelah selesai.** Tombol **Keluar** ada di tab **Pengaturan**. Jangan meninggalkan konsol terbuka di komputer bersama.
- **Satu orang, satu akun.** Shift kasir melekat pada akun. Jangan bergantian memakai satu akun; selisih kas akan ditagih kepada pemilik shift.
- **Kode OTP rahasia.** Jangan bagikan kode ke siapa pun, termasuk yang mengaku dari pusat.
- **Alasan jujur.** Alasan pembatalan, penarikan, dan sengketa tersimpan di jejak audit.
- **Data pelanggan.** Nomor HP pelanggan dilindungi UU PDP. Jangan menyalin ke luar sistem. Bukti antar disimpan 12 bulan lalu dihapus otomatis. **[V]**
- **Data wajah.** Anda bisa menarik persetujuan dan menghapus data wajah sendiri dari menu Daftar Wajah.
- **Struk dan popup.** Izinkan popup hanya untuk situs Hydromart.
- **Pembagian tugas (maker-checker).** Pengaju tidak boleh memutuskan pengajuannya sendiri ("Pengaju tidak boleh memutuskan pengajuannya sendiri — teruskan ke atasan."). Jangan mencoba meminta Manajer menyetujui item Anda secara tidak tercatat.
- Hak akses di bab ini adalah nilai bawaan; Super admin dapat mengubahnya dan perubahan berlaku sekitar 30 detik.

---

## 11. Kegiatan akhir hari/berkala

### Pembukaan (urutan yang disarankan **[D]**)

1. Masuk, baca **Ringkasan** dan lonceng notifikasi.
2. **Meteran air**: catat "Meteran pagi (m³)" (`/dashboard/meter`).
3. **Absen saya** > **Absen Sekarang** (check-in wajah).
4. **Penjualan** > **Buka shift** dengan modal awal.
5. Cek **Shift** (jadwal) dan **Kurir** (siapa yang sudah check-in; penugasan menolak kurir yang belum check-in).
6. **Serah terima** dari shift sebelumnya; **Inventory** > "Stok menipis".

### Sepanjang hari

- **Antrean**: proses Order placed/Confirmed, konfirmasi pembayaran, tugaskan kurir.
- **Kurir**: pantau; tarik/batalkan pengiriman macet.
- **Penjualan**: penjualan konter; batalkan salah input.
- **Retur** dan **Inventory** sesuai kejadian; **Setoran** saat kurir check-out; **Insiden**, **Hadiah**, **Pelanggan**, **Broadcast** bila perlu.

### Akhir hari (urutan wajib karena ketergantungan)

1. Pastikan setiap setoran COD terverifikasi; "COD belum disetor" = 0 (tidak dipaksa sistem).
2. **Inventory** > **Opname** / **Opname massal**.
3. **Meteran air**: "Meteran sore (m³)".
4. **Penjualan** > **Tutup shift** > hitung laci.
5. **Serah terima**: buat dan tandatangani untuk shift berikutnya.
6. **Laporan** > harian > **Tutup buku**.
7. **Absen saya** > Check-out.

### Berkala

- **Mingguan:** Huddle, jadwal shift kurir, perawatan alat, laporan mingguan.
- **Bulanan:** tinjau kinerja bersama Manajer; Kepala depot tidak punya menu laporan bulanan.

### Tugas terjadwal sistem yang berdampak pada depot Anda (WIB)

| Jam | Kegiatan otomatis | Dampak |
|---|---|---|
| Tiap jam :05 | Pesanan status Order placed lebih dari 60 menit dibatalkan otomatis; Confirmed/Preparing lebih dari 24 jam dibatalkan ("stalled at the depot"). Stok dilepas, pembayaran dibalik | Proses pesanan tepat waktu agar tidak batal sendiri **[K]** |
| Tiap jam :25 | Pembayaran non-tunai PENDING lebih dari 24 jam digagalkan | Konfirmasi pembayaran cepat |
| Tiap 10 menit | Peringatan sekali per pengiriman yang terlambat dari batas SLA depot | Hanya melapor, tidak mengalihkan |
| 09:00 | Pengingat galon belum kembali ke pelanggan | — |
| 13:00 dan 21:00 | Laporan penjualan depot ("Penjualan depot hari ini") | Masuk ke notifikasi depot |
| Tiap 2 menit | Kampanye pelanggan yang sedang terkirim diproses bertahap | — |

**[V]** (`scripts/scheduler/crontab`; temuan I bagian 3)

---

## 12. Skenario praktis

**Skenario A — Kurir kekurangan setoran.** Kurir menyetor Rp475.000 dari wajib Rp500.000. Buka **Setoran** > **Hitung & verifikasi**. Panel menunjukkan "kurang Rp 25.000". Hitung uang fisik. Bila benar kurang, biarkan **Bebankan selisih** tercentang dan isi catatan, lalu **Verifikasi**. Bila kurir menyangkal dan perlu diselidiki, pilih **Sengketakan** dengan alasan. Tidak ada Manajer yang perlu menyetujui; Anda yang bertanggung jawab.

**Skenario B — Selisih opname galon.** Hitung fisik 48, sistem 50, harga jual Rp20.000: nilai selisih Rp40.000, di bawah batas Rp100.000. Simpan opname; tidak ada persetujuan. Bila selisih 8 galon (Rp160.000), simpan opname lalu beri tahu Manajer karena persetujuan "Selisih opname" masuk antrean mereka.

**Skenario C — Pelanggan meminta refund.** Anda tidak melihat **Ajukan refund**. Catat kasus di **Sengketa order** bila perlu dan teruskan ke Manajer atau Finance. Jangan menekan Refund pada sengketa karena akan ditolak.

**Skenario D — Lupa tutup shift.** Tutup buku ditolak "Masih ada {n} shift kasir terbuka." Tutup shift Anda. Jika shift milik kasir lain, minta Manajer menutupnya (pesan "This shift belongs to another cashier." bila Anda mencoba).

**Skenario E — Pembeli konter salah pilih ukuran.** Pada hari dan shift yang sama, tekan **Batalkan penjualan** dengan alasan, lalu input ulang. Bila sudah lewat hari, minta Manajer mengajukan refund.

**Skenario F — Kurir tidak bisa dihubungi, pesanan tertahan.** Di tab **Kurir**, tekan **Tarik ke antrean** dengan alasan. Pesanan kembali ke "Perlu ditugaskan" lalu tugaskan kurir lain.

---

## 13. Daftar periksa penyelesaian

- [ ] Saya masuk dan melihat nama depot yang benar.
- [ ] Bisa memproses pesanan, mengonfirmasi pembayaran, dan menugaskan kurir.
- [ ] Bisa membuka dan menutup shift kasir dengan hitungan laci yang benar.
- [ ] Bisa memverifikasi setoran COD dan memahami keputusan beban selisih.
- [ ] Bisa opname dan memahami ambang Rp100.000.
- [ ] Tahu halaman yang hanya lewat URL (meteran, aturan promo, sengketa, CRM).
- [ ] Tahu apa yang butuh Manajer atau Kantor pusat (bagian 9).
- [ ] Bisa tutup buku harian setelah semua shift kasir tutup.
- [ ] Sudah mendaftarkan wajah dan bisa absen.

---

## 14. Inventaris screenshot bab ini

| ID | Layar | Kondisi | Status |
|---|---|---|---|
| SS-kepala-depot-01 | Halaman masuk `/login` | Nomor sintetis terisi | Belum diambil |
| SS-kepala-depot-02 | Ringkasan hari ini + header + bilah tab | Setelah masuk | Belum diambil |
| SS-kepala-depot-03 | Ringkasan: empat penghitung dan tiga kartu | Ada data contoh | Belum diambil |
| SS-kepala-depot-04 | Antrean pesanan, empat chip | Beberapa pesanan | Belum diambil |
| SS-kepala-depot-05 | Lembar detail pesanan Order placed | Tombol Lanjut ke Confirmed | Belum diambil |
| SS-kepala-depot-06 | Panel "Tugaskan kurir" | Satu kurir Tersedia, satu Sibuk | Belum diambil |
| SS-kepala-depot-07 | Live tracking | Satu pengiriman aktif | Belum diambil |
| SS-kepala-depot-08 | Penjualan: "Belum ada shift terbuka" | Belum ada shift | Belum diambil |
| SS-kepala-depot-09 | Form penjualan konter | Keranjang terisi, tunai | Belum diambil |
| SS-kepala-depot-10 | Tutup shift dan hasil selisih | Selisih negatif | Belum diambil |
| SS-kepala-depot-11 | Panel verifikasi setoran | Setoran kurang | Belum diambil |
| SS-kepala-depot-12 | Lembar opname massal | Sebagian baris berubah | Belum diambil |
| SS-kepala-depot-13 | Retur galon | Kartu + formulir | Belum diambil |
| SS-kepala-depot-14 | Meteran air | Form + kartu hasil | Belum diambil |
| SS-kepala-depot-15 | Laporan harian dengan Tutup buku | Sebelum dan sesudah tutup | Belum diambil |
| SS-kepala-depot-16 | Aturan promo | Daftar + form | Belum diambil |

---

## 15. Catatan celah & hal yang perlu dikonfirmasi

Rujuk ke berkas `17-open-questions` untuk daftar terpadu.

**Celah teknis ([B]) yang perlu diputuskan tim produk:**
1. Pemetaan peran "Staff Depot" = kurir, bukan petugas konsol.
2. Tab Pembayaran ditolak, tab Promo menampilkan tombol tulis, halaman hanya via URL.
3. Tidak ada tombol batal pesanan dan tidak ada penyelesaian setoran Sengketa di UI.
4. Setoran COD diputuskan satu orang tanpa persetujuan; tutup buku tidak mensyaratkan setoran terverifikasi.
5. Kepala depot tidak bisa melihat status persetujuan yang dipicunya.
6. Halaman Persetujuan menampilkan jumlah Rp0 untuk sebagian tipe (dugaan **[D]**, cek visual oleh Manajer).

**Perlu konfirmasi bisnis ([K]):**
1. Batas auto-pass approval Rp100.000 per depot di produksi, tarif deposit galon Rp20.000, ambang selisih meteran 200 liter, batas pengantaran aktif per kurir, pengaturan `staffCanComplete`.
2. Kebijakan pembebanan kekurangan setoran COD: kapan dibebankan.
3. Tenggat setoran COD kurir dan tenggat tutup buku harian.
4. Siapa yang menyetujui pembatalan pesanan yang belum dikirim bila Kepala depot tidak dapat membatalkannya.
5. Apakah Kepala depot sebaiknya memegang tab untuk Meteran air, Sengketa, dan Aturan promo.
6. Isi halaman `/dashboard/search` belum dibaca penulis.
