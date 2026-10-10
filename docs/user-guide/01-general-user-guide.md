# Panduan Pengguna Hydromart — Panduan Umum

| | |
|---|---|
| **Produk** | Platform Hydromart (kode produk: `hydromart-digital`) |
| **Dokumen** | 01 — Panduan Umum |
| **Versi** | 0.1 (draf) |
| **Tanggal** | 2026-10-10 |
| **Klasifikasi** | Internal — Terbatas (boleh dibagikan ke semua pengguna platform) |
| **Bahasa** | Indonesia |

> **Catatan status dokumen.** Dokumen ini disusun dari pembacaan kode dan dokumen repositori. Belum ada pengujian yang dijalankan oleh penulis dokumen ini. Setiap klaim penting diberi tag bukti:
> **[V]** terverifikasi di kode · **[D]** disimpulkan, perlu konfirmasi · **[K]** perlu konfirmasi bisnis (nilainya berasal dari data/pengaturan) · **[B]** diketahui bermasalah atau tidak konsisten.
> Fitur yang tidak ada ditulis "Tidak tersedia".

---

## Kontrol Dokumen

| Item | Isi |
|---|---|
| Pemilik dokumen | [K] Belum ditetapkan |
| Penyusun | Tim dokumentasi (draf awal) |
| Peninjau | [K] Belum ditetapkan |
| Penyetuju | [K] Belum ditetapkan |
| Dokumen terkait | `02-customer-guide.md` (Panduan Pelanggan); panduan per peran lainnya di folder yang sama; `17-open-questions` untuk daftar hal yang perlu dikonfirmasi |
| Masa berlaku | Sampai kode atau pengaturan platform berubah. Hak akses dapat berubah saat berjalan (lihat bagian 12). |

## Riwayat Versi

| Versi | Tanggal | Perubahan | Penulis |
|---|---|---|---|
| 0.1 | 2026-10-10 | Draf pertama. | Tim dokumentasi |

## Daftar Isi

1. Tujuan dan ruang lingkup
2. Audiens
3. Gambaran sistem
4. Persyaratan akses
5. Browser dan perangkat
6. Masuk dan keluar
7. Keamanan akun (tanpa kata sandi)
8. Orientasi antarmuka
9. Navigasi dan dashboard per peran
10. Elemen umum antarmuka
11. Notifikasi dan indikator status
12. Tabel 13 peran dan konsol yang dapat dimasuki
13. Glosarium
14. Pemecahan masalah umum
15. Dukungan dan eskalasi
16. Inventaris screenshot
17. Catatan celah dan hal yang perlu dikonfirmasi

---

## 1. Tujuan dan Ruang Lingkup

**Tujuan.** Panduan ini menjelaskan hal-hal yang sama bagi semua pengguna Hydromart: apa itu platform ini, siapa yang memakainya, cara masuk, cara membaca layar, dan cara mencari bantuan. Panduan khusus tiap peran ada di dokumen terpisah.

**Dalam ruang lingkup:**
- Cara masuk dan keluar dengan nomor telepon dan kode OTP.
- Peta permukaan (aplikasi dan konsol) dan siapa yang boleh membukanya.
- Arti istilah, status, dan indikator yang muncul di banyak layar.
- Pemecahan masalah umum dan jalur bantuan yang terdokumentasi.

**Di luar ruang lingkup:**
- Langkah kerja rinci tiap peran (lihat panduan peran).
- Prosedur teknis server, penerapan, dan pemeliharaan.
- Nilai bisnis yang berasal dari pengaturan (harga, minimum pesanan, ongkir). Nilai ini berbeda per depot **[K]**.

## 2. Audiens

| Pembaca | Bagian yang paling relevan |
|---|---|
| Pelanggan (masyarakat umum) | 3, 5, 6, 7, 13, 14, 15; lanjut ke Panduan Pelanggan |
| Staf depot / kurir | 3, 6, 9, 11, 12, 14 |
| Kepala depot, Asisten SPV, SPV, Manajer | 3, 9, 11, 12 |
| Pemilik waralaba | 3, 9, 12 |
| HR, Finance, Marketing, Direktur, Head office | 3, 9, 12 |
| Super admin | Semua bagian |

Bahasa dalam panduan dibuat sederhana. Istilah teknis dijelaskan di Glosarium (bagian 13).

## 3. Gambaran Sistem

Hydromart adalah platform pemesanan dan operasional **depot air isi ulang**. Pelanggan memesan galon dan air minum lewat aplikasi. Depot menyiapkan pesanan, kurir mengantar, dan kantor pusat memantau jaringan. Sistem yang sama juga mengurus stok, kas, penggajian, dan kehadiran karyawan. **[V]** (README dan struktur `apps/web/src/app`)

### 3.1 Jenis kepemilikan depot: HKP dan Waralaba

| Jenis | Arti | Catatan |
|---|---|---|
| **HKP** | Depot milik perusahaan sendiri | Istilah dari glosarium BRD **[V]** |
| **Waralaba** | Depot milik mitra waralaba | Pemiliknya memakai peran "Pemilik waralaba" untuk melihat kinerja depotnya **[V]** |

Aturan bisnis dari PRD (BR-016): setiap depot hanya punya satu jenis kepemilikan, dan laporan kantor pusat bisa disaring menurut jenis depot. **[D]**

### 3.2 Permukaan (aplikasi dan konsol)

| Permukaan | Alamat (rute) | Untuk siapa | Fungsi singkat |
|---|---|---|---|
| Aplikasi pelanggan | `/` (beranda), `/products`, `/cart`, `/checkout`, `/orders`, `/account`, dan lainnya | Pelanggan | Belanja, bayar, lacak pesanan, poin, langganan |
| Aplikasi kurir | `/driver` | Staf depot (kode: STAFF_DEPOT) | Tugas antar, riwayat, profil, dompet kurir |
| Konsol depot | `/dashboard` | Kepala depot, Asisten SPV, SPV, Manajer, Direktur, Head office, Pemilik waralaba, Marketing, Super admin (sesuai hak akses) | Pesanan, stok, kas, laporan, promo |
| Konsol HQ | `/hq` | Head office, Direktur, Finance, Super admin | Pantauan jaringan, keuangan pusat, pengaturan pusat |
| Konsol HR | `/hr` | HR, Head office, Direktur, Finance, Manajer, SPV, Asisten SPV, Super admin | Karyawan, absensi, cuti, kasbon, penggajian |
| HRIS mandiri | `/hr/me` | Karyawan depot yang absen | Absen wajah, kehadiran saya, slip gaji, cuti |
| Konsol manajer mobile | `/m/manager` | Manajer, Super admin | Persetujuan, tim, harga, notifikasi di ponsel |

Sumber: `apps/web/src/lib/roles.ts` (`CONSOLE_PREFIXES`, `consoleHome`, gerbang masuk) **[V]**. Rute `/m/manager` dikhususkan untuk aplikasi Android "Hydromart Ops"; di web, Manajer masuk ke `/dashboard` **[V]**.

Halaman publik (tanpa masuk): beranda, daftar produk, `/promo`, `/help`, `/track`, `/waralaba`, `/kebijakan-privasi`, `/syarat-ketentuan`, `/hapus-akun`. **[V]**

> **[SCREENSHOT REQUIRED: SS-umum-01 — Beranda aplikasi pelanggan dalam keadaan belum masuk (tamu): hero, promo, kategori, depot terdekat.]**
> *Gambar 3.1 — Beranda pelanggan sebagai tamu.*

## 4. Persyaratan Akses

| Syarat | Pelanggan | Karyawan / mitra |
|---|---|---|
| Nomor telepon seluler Indonesia yang aktif dan dapat menerima SMS | Wajib **[V]** | Wajib **[V]** |
| Akun terdaftar | Dibuat sendiri lewat pendaftaran | Dibuat lewat undangan oleh pihak yang berwenang; peran ditetapkan oleh sistem, bukan dipilih sendiri **[V]** (`canGrantRole`) |
| Kata sandi | Tidak ada | Tidak ada |
| Data karyawan terhubung (khusus `/hr/me`) | Tidak berlaku | Wajib. Server hanya menjawab bila akun punya data karyawan sendiri **[V]** |
| Koneksi internet | Wajib | Wajib. Sebagian fitur kurir dan absen menyimpan antrean saat luring lalu mengirim ulang **[V]** (`offline-queue.ts`) |

Format nomor yang diterima: `08…`, `62…`, `+62…`, atau `8…`. Spasi, tanda hubung, dan tanda kurung diabaikan. Hasilnya harus nomor seluler Indonesia (`+628` diikuti 7–11 digit). Contoh yang benar: `081234567890`. **[V]**

## 5. Browser dan Perangkat

**Pernyataan resmi:** Tidak ada matriks dukungan browser resmi di dokumen repositori (README, DEPLOY, ARCHITECTURE). **[V]**

Yang dapat dipastikan dari kode:
- Web dibangun dengan Next.js dan Tailwind v4. Tailwind v4 membutuhkan browser modern (setara Chrome 111 atau lebih baru, rilis Maret 2023). **[D]** Ini kesimpulan teknis, bukan pernyataan resmi.
- Pengujian otomatis hanya berjalan di Chromium (Desktop Chrome). **[V]**
- Ponsel Android lama dengan WebView yang tidak diperbarui bisa kehilangan seluruh tampilan. Perbaikan berupa layar "Perbarui Android System WebView" baru direncanakan, belum dipastikan ada. **[D]**
- Aplikasi Android (Capacitor): "Hydromart" untuk pelanggan dan "Hydromart Ops" untuk staf internal. Rilis pertama hanya Android; iOS direncanakan belakangan. Pembaruan lewat Play Store. **[V]** (`mobile/capacitor.config.ts`, `docs/MOBILE_APPS_PLAN.md`)
- Status Play Store per 2026-09-25: masih pengujian internal. **[K]** Cek status terbaru sebelum menyebut aplikasi tersedia untuk umum.

Saran praktis (bukan jaminan): pakai Chrome atau browser modern lain yang selalu diperbarui, dan perbarui Android System WebView di ponsel.

## 6. Masuk dan Keluar

Masuk memakai **nomor telepon dan kode OTP lewat SMS**. Tidak ada kata sandi. Masuk dengan Google sudah dihapus. **[V]** (`login.service.ts`)

### 6.1 Angka penting kode OTP

| Hal | Nilai bawaan | Bukti |
|---|---|---|
| Panjang kode | 6 digit (layar menyediakan 6 kotak) | **[V]** `env.validation.ts`. Server bisa disetel 4–8, tetapi layar tetap 6 kotak **[B]** |
| Masa berlaku | 300 detik (5 menit) | **[V]** Dapat disetel sampai maksimum 600 detik |
| Percobaan salah | Maksimal 5 per kode | **[V]** |
| Jeda kirim ulang | 60 detik | **[V]** |
| Penggunaan | Sekali pakai; kode baru membatalkan kode lama | **[V]** |
| Batas permintaan kode | Dibatasi per alamat IP (bawaan 20 per menit) | **[V]** |

Nilai bawaan dapat diubah lewat konfigurasi server. **[K]** Konfirmasi nilai produksi.

### Prosedur: Masuk ke akun

**Tujuan:** Membuka akun dengan nomor telepon. **Peran:** Semua peran. **Prasyarat:** Nomor seluler aktif yang bisa menerima SMS. **Titik awal:** Halaman `/login` (pelanggan) atau `/hq/login` (pintu staf; hasilnya sama).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka halaman masuk. Isi kolom **Nomor telepon** (wajib). Awalan "🇮🇩 +62" sudah tersedia; contoh isian `81234567890`. | Kolom menerima angka. |
| 2 | Tekan **Kirim kode**. | Pindah ke halaman `/verify`. SMS berisi kode 6 digit dikirim. |
| 3 | Ketik 6 digit kode di kotak yang tersedia. | Setelah digit ke-6, layar otomatis memverifikasi. Tombol **Verifikasi & lanjut** juga tersedia. |
| 4 | Tunggu pengalihan. | Anda masuk. Pelanggan diarahkan ke halaman tujuan atau toko; staf diarahkan ke konsolnya (lihat bagian 9). |

**Isi SMS** (login): "Kode Login HYDROMART … Masukkan kode OTP {kode} untuk melanjutkan login. Kode berlaku selama 5 menit. Abaikan pesan ini jika Anda tidak melakukan permintaan login." **[V]** (`zenziva-otp-delivery.adapter.ts`)

**Cara mengenali sukses:** halaman berpindah dari `/verify` ke beranda, toko, atau konsol. Hitung mundur "Kode berlaku {m:ss} lagi." hanya tampil selama menunggu.

**Bila nomor belum terdaftar:** sistem tidak menolak. Nomor baru otomatis menjadi pendaftaran dan layar verifikasi menampilkan "Selesaikan pendaftaran." **[V]** (anti-enumerasi). Pelanggan baru sebaiknya memakai `/register` agar bisa mengisi nama, email, kode referral, dan persetujuan.

**Bila kode tidak datang:** tombol berubah dari "Kirim ulang dalam {n}d" menjadi **Kirim ulang kode** setelah 60 detik. Setelah dikirim ulang: "Kode baru dikirim ke {nomor tersamar}."

**Hasil akhir:** Sesi aktif di perangkat ini.

**Masalah umum:**

| Pesan di layar | Arti | Solusi |
|---|---|---|
| Nomor HP Indonesia tidak valid. Contoh: 081234567890. | Format nomor salah | Periksa nomor; pakai nomor seluler Indonesia |
| Kode verifikasi salah. | Kode tidak cocok | Ketik ulang. Maksimal 5 kali per kode |
| Terlalu banyak percobaan. Minta kode baru. | 5 kali salah. Kotak kode terkunci | Tekan **Kirim ulang kode** |
| Kode verifikasi sudah kedaluwarsa. Minta kode baru. | Lewat 5 menit | Tekan **Kirim ulang kode** |
| Kode baru bisa diminta sebentar lagi. Cek SMS yang sudah masuk dulu. | Belum 60 detik | Tunggu, cek SMS yang sudah masuk |
| Kode belum bisa dikirim sekarang. Coba lagi. | Gerbang SMS menolak | Coba lagi sebentar |
| Kodenya sedang dikirim dan bisa terlambat beberapa detik. Tunggu sebentar sebelum minta kode baru. | Gerbang SMS lambat menjawab | Tunggu beberapa detik |
| Terlalu banyak permintaan kode. Tunggu sebentar, lalu minta kode lagi. | Batas permintaan terlampaui | Tunggu satu menit, ulangi |
| Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi. | Batas umum terlampaui | Tunggu, ulangi |
| Akun ini tidak aktif. Hubungi dukungan Hydromart. | Akun ditangguhkan atau dihapus | Hubungi dukungan (bagian 15) |
| Nomor ini sudah terdaftar tapi belum diverifikasi. Kami kirim ulang kodenya. | Pendaftaran belum selesai | Masukkan kode yang baru |
| Nomor telepon tidak ditemukan. Silakan mulai lagi dari halaman masuk. | Halaman verifikasi dibuka tanpa nomor | Tekan **Kembali ke masuk** |
| Tidak bisa memulai proses masuk. | Kegagalan umum | Coba lagi; bila berulang, lihat bagian 14 |

Semua pesan di atas dikutip dari kamus bahasa (`auth.ts`, `errors.ts`). **[V]**

**Izin dan batasan:** Kode berlaku sekali dan hanya untuk nomor yang bersangkutan. Jangan membagikan kode kepada siapa pun. SMS resmi memuat peringatan yang sama.

**Daftar periksa:**
- [ ] Nomor seluler Indonesia dan dapat menerima SMS.
- [ ] Sinyal cukup; SMS belum terblokir pemblokir SMS.
- [ ] Kode dimasukkan dalam 5 menit.

> **[SCREENSHOT REQUIRED: SS-umum-02 — Halaman `/login` dengan kolom Nomor telepon dan tombol "Kirim kode".]**
> *Gambar 6.1 — Halaman masuk.*

> **[SCREENSHOT REQUIRED: SS-umum-03 — Halaman `/verify` dengan 6 kotak kode, hitung mundur "Kode berlaku", dan tombol "Kirim ulang dalam {n}d".]**
> *Gambar 6.2 — Halaman verifikasi kode.*

### 6.2 Keluar

| Tindakan | Di mana | Akibat |
|---|---|---|
| **Keluar** | Halaman Akun (`/account`) | Menutup sesi perangkat ini saja **[V]** |
| **Keluar dari sini** / **Keluarkan** | Akun → Perangkat & sesi | Menutup sesi satu perangkat |
| **Keluar dari semua perangkat** | Akun → Perangkat & sesi | Semua perangkat, termasuk yang ini, diminta masuk lagi. Ada dialog konfirmasi |

Di konsol staf, tombol **Keluar** ada di rel menu dan bilah bawah konsol depot, HQ, dan HR (komponen `ConsoleSignOut`). **[V]** Letak persisnya di layar dijelaskan di panduan peran masing-masing. Untuk pelanggan, lihat Panduan Pelanggan.

### 6.3 Lama sesi

| Hal | Nilai | Bukti |
|---|---|---|
| Token akses | 15 menit, diperbarui otomatis | **[V]** (`JWT_ACCESS_TTL` 900 detik) |
| Token penyegar | 30 hari | **[V]** (`JWT_REFRESH_TTL` 2.592.000 detik) |
| Batas diam (idle) | Diatur kantor pusat. Komentar kode menyebut bawaan 15 menit. Nol atau kosong berarti tanpa batas | **[K]** Nilai produksi belum diketahui |
| Penggunaan ulang token lama | Seluruh keluarga sesi dicabut demi keamanan | **[V]** |

Bila sesi habis, Anda akan diminta masuk lagi. Sesi staf yang habis dikembalikan ke pintu masuk staf (`/hq/login`, atau `/login` bila pintu itu tidak ada di aplikasi). **[V]** (`staffDoor`)

Aplikasi Android: bila sesi masih tersimpan, layar menawarkan "Buka dengan sidik jari atau PIN, tanpa kode SMS." **[V]** (komponen BiometricRetry; hanya aplikasi native **[D]**)

## 7. Kata Sandi dan Keamanan Akun

- **Tidak ada kata sandi.** Akun dilindungi oleh nomor telepon dan kode OTP SMS. Fitur "lupa kata sandi" Tidak tersedia (PRD FR-007 tidak diterapkan). **[V]**
- Kode OTP disimpan dalam bentuk acak (hash), sekali pakai, dan terkunci setelah 5 percobaan salah. **[V]**
- Pelanggan dapat melihat daftar perangkat yang sedang masuk dan mengeluarkannya.
- Mengganti nomor telepon memakai dua langkah: kode dikirim ke nomor **baru**, lalu semua perangkat dikeluarkan dan Anda masuk lagi dengan nomor baru. Nomor lama menerima pemberitahuan. **[V]**
- Jangan membagikan kode OTP. Petugas Hydromart tidak pernah perlu menanyakannya. **[D]**
- Peringatan: nomor telepon adalah kunci akun. Bila ponsel hilang, hubungi dukungan (bagian 15) dan keluarkan perangkat lain dari menu Akun bila masih bisa masuk.

## 8. Orientasi Antarmuka

| Area | Isi |
|---|---|
| **Aplikasi pelanggan, web** | Bilah atas: Belanja, Pesanan, ikon keranjang (dengan jumlah), lonceng notifikasi (dengan jumlah belum dibaca), Akun atau Masuk **[V]** (`nav.tsx`) |
| **Aplikasi pelanggan, ponsel** | Bilah bawah: Beranda, Belanja, Pesanan, Akun **[V]** (`bottom-nav.tsx`) |
| **Pemilih lokasi** | Di header: "Pilih lokasi pengiriman", "Gunakan lokasi saya", "Atau pilih kota depot" **[V]** |
| **Aplikasi kurir** | Bilah bawah: tab Tugas, Riwayat, Profil; tab Dompet muncul di layar penghasilan, setoran, dan klaim biaya **[V]** (`driver-shell.tsx`) |
| **Konsol depot** | Rel menu di kiri (grup menu menurut hak akses) dan bilah bawah di ponsel. Kepala depot memakai tampilan tab di atas (konsol operator) **[V]** |
| **Konsol HQ** | Rel menu HQ; berisi pintu keluar ke `/dashboard`, `/hr`, `/resellers` **[V]** |
| **Tur perkenalan** | Tiga slide sekali tampil bagi pelanggan baru: "Atur lokasi antar", "Pesan galon & air", "Lacak sampai depan pintu" dengan tombol Lewati, Lanjut, Mulai **[V]** |

Halaman konsol tidak memakai bilah belanja pelanggan. Menu yang tidak boleh Anda buka tidak ditampilkan, atau menampilkan layar akses ditolak. **[V]**

> **[SCREENSHOT REQUIRED: SS-umum-04 — Konsol depot (`/dashboard`) dengan rel menu kiri, tampilan peran Manajer.]**
> *Gambar 8.1 — Konsol depot.*

> **[SCREENSHOT REQUIRED: SS-umum-05 — Layar akses ditolak (AccessDeniedHq) dengan tombol kembali ke konsol.]**
> *Gambar 8.2 — Layar akses ditolak.*

---

## 9. Navigasi dan Dashboard per Peran

Setelah masuk, sistem memilih halaman awal dengan fungsi `consoleHome` berdasarkan peran. Bila ada parameter tujuan (`next`) yang sah, Anda diarahkan ke sana lebih dulu. **[V]** (`roles.ts`, `login/page.tsx`)

### 9.1 Pintu masuk (halaman awal) per peran

| Peran (nama di layar) | Kode peran | Halaman awal di web | Catatan |
|---|---|---|---|
| Pelanggan | CUSTOMER | `/products` (toko) | Lalu mengikuti tujuan bila ada **[V]** |
| Staf depot | STAFF_DEPOT | `/driver` | Aplikasi kurir. Bila tidak tersedia, `/hr/me` **[V]** |
| Kepala depot | KEPALA_DEPOT | `/dashboard` | Tampilan konsol operator: ringkasan aksi harian **[V]** |
| Asisten SPV | ASSISTANT_SUPERVISOR | `/dashboard` | Pengawasan banyak depot, hak tulis terbatas **[V]** |
| SPV | SUPERVISOR | `/dashboard` | Sama seperti di atas **[V]** |
| Manajer | MANAGER | `/dashboard` (web); `/m/manager` (aplikasi Android Ops) | Ditolak masuk `/hq` **[V]** |
| Direktur | DIREKTUR | `/hq` | **[V]** |
| Pemilik waralaba | FRANCHISE_OWNER | `/dashboard` | Dialihkan ke ringkasan waralaba miliknya **[V]** |
| Head office | HEAD_OFFICE | `/hq` | **[V]** |
| Finance | FINANCE | Layar `/hq` pertama yang boleh dibuka | Tidak punya kapabilitas `dashboard`, jadi bukan `/hq` ringkasan **[V]** |
| HR | HR | `/hr` | **[V]** |
| Marketing | MARKETING | `/dashboard/campaigns` | Tidak punya kapabilitas `dashboard` **[V]** |
| Super admin | SUPER_ADMIN | `/hq` | Dapat membuka semua konsol **[V]** |

Aplikasi Android Ops tidak memuat `/hq` dan konsol HR (kecuali `/hr/me`); peran HQ dan HR diarahkan ke permukaan lain yang tersedia. **[V]** Aplikasi itu belum tentu sudah dirilis ke publik. **[K]**

### 9.2 Dashboard yang muncul di `/dashboard`

Halaman `/dashboard` memilih tampilan menurut peran **[V]** (`dashboardLandingView`):

| Tampilan | Peran | Isi singkat |
|---|---|---|
| Waralaba | Pemilik waralaba | Ringkasan kinerja depot miliknya |
| Operator | Kepala depot | Ringkasan aksi harian |
| Manajer | Manajer | KPI operasional, persetujuan, stok, kurir |
| Eksekutif | Asisten SPV, SPV, Direktur, Head office, Super admin | KPI latensi dan daftar teratas jaringan |
| Ditolak | Peran tanpa kapabilitas `dashboard` | Layar akses ditolak |

### 9.3 Jalan pintas dan "Kembali ke konsol"

Tombol di layar akses ditolak berlabel **Kembali ke halaman saya** dan membawa Anda ke halaman awal peran Anda. **[V]** Teks layar itu berjudul "Khusus HQ" dan menyebut "Konsol Admin & Super Admin hanya untuk head office dan super admin", walaupun layar yang sama juga dipakai konsol HR. **[B]** Abaikan judul bila Anda berada di konsol HR.

Notifikasi staf punya umpan sendiri menurut konsol (`/hq/notifications`, `/dashboard/notifications`, `/m/manager/notifications`). Kurir tidak punya umpan operasional dan diarahkan ke aplikasi kurir. `/notifications` hanya untuk pelanggan. **[V]** (`notificationHome`)

> **[SCREENSHOT REQUIRED: SS-umum-06 — Halaman awal `/hq` untuk peran Head office.]**
> *Gambar 9.1 — Konsol HQ.*

> **[SCREENSHOT REQUIRED: SS-umum-07 — Halaman awal `/driver` (tab Tugas) untuk Staf depot.]**
> *Gambar 9.2 — Aplikasi kurir.*

## 10. Elemen Umum Antarmuka

| Elemen | Fungsi | Bukti |
|---|---|---|
| **Chip / lencana status** | Label berwarna kecil untuk status (nada: netral, tebal, garis, amber, sukses) | **[V]** `components/ui.tsx` |
| **Dialog konfirmasi** | Muncul sebelum tindakan yang tidak bisa dibatalkan, mis. "Batalkan pesanan?" | **[V]** `confirm.tsx` |
| **Lembar detail** | Panel geser untuk detail baris | **[V]** `detail-sheet.tsx` |
| **Pemilih depot** | Di konsol depot (selain Kepala depot), pemilih depot global menentukan depot yang dilihat | **[V]** `DepotProvider` |
| **Banner antrean luring** | "{n} data belum terkirim" dengan tombol **Kirim sekarang** dan **Hapus data offline**. Membuang data bersifat permanen: itu satu-satunya salinan | **[V]** `hrFix.ts` |
| **Impor CSV** | Beberapa konsol menyediakan impor berkas CSV | **[V]** `csv-import.tsx` |
| **Bahasa** | Pilihan Indonesia atau Inggris di pengaturan akun. Bahasa bawaan Indonesia | **[V]** `locale-context.tsx` |
| **Tema** | Terang, Gelap, atau Sistem | **[V]** kamus `account` |
| **Keranjang & lonceng** | Lencana jumlah di bilah atas pelanggan | **[V]** `nav.tsx` |

Layar kosong menampilkan teks penjelas, misalnya "Tidak ada notifikasi" dengan "Update pesanan & promo akan tampil di sini." **[V]** Tombol yang sedang memproses biasanya berubah teks (misalnya "Mengirim…", "Mengunggah…") dan nonaktif selama proses. **[V]**

## 11. Notifikasi dan Indikator Status

### 11.1 Saluran notifikasi

| Saluran | Keadaan | Bukti |
|---|---|---|
| SMS (kode OTP) | Aktif lewat penyedia SMS | **[V]** |
| Kotak masuk dalam aplikasi (`/notifications`) dan push (FCM/Web Push) | Aktif untuk pelanggan; push dapat dimatikan per pelanggan | **[V]** `crm-service` |
| WhatsApp transaksional | Dihapus. Kampanye pemasaran masih memakai WhatsApp menurut komentar kode | **[V]** |
| Email | Tidak tersedia (PRD §27 menyebut email, belum diterapkan) | **[V]** |

Push di aplikasi Android memakai FCM karena Web Push tidak berfungsi di WebView. Izin notifikasi Android 13+ diminta setelah pesanan pertama, bukan saat aplikasi pertama dibuka. **[V]** (`MOBILE_PLAY_STORE.md`)

### 11.2 Status pesanan (yang terlihat pelanggan)

| Kode | Label di layar | Arti singkat |
|---|---|---|
| CREATED | Dipesan | Pesanan masuk, menunggu konfirmasi |
| CONFIRMED | Dikonfirmasi | Sudah dikonfirmasi (otomatis bila pembayaran lunas, atau oleh staf) |
| PREPARING | Disiapkan | Depot menyiapkan |
| DRIVER_ASSIGNED | Kurir ditugaskan | Kurir sudah ditugaskan |
| PICKED_UP | Diambil kurir | Kurir sudah mengambil |
| ON_DELIVERY | Dalam perjalanan | Sedang diantar |
| DELIVERED | Tiba | Sudah sampai |
| COMPLETED | Selesai | Selesai |
| CANCELLED | Dibatalkan | Dibatalkan |
| VOIDED | Dibatalkan di kasir | Hanya untuk penjualan konter |

Urutan benar: Dipesan → Dikonfirmasi → Disiapkan → Kurir ditugaskan → Diambil kurir → Dalam perjalanan → Tiba → Selesai. Pengantaran yang dijadwalkan ulang mengembalikan status ke Disiapkan. **[V]** (`order-status.ts`)

### 11.3 Status pembayaran

PENDING (menunggu), PAID (lunas), FAILED (gagal), CANCELLED (dibatalkan), REFUNDED (dikembalikan). **[V]** `payment.ts`. Di halaman rincian pesanan, status dan metode bayar saat ini tampil sebagai kode Inggris mentah (misalnya PENDING, QRIS). **[B]** Panduan Pelanggan menjelaskan artinya.

### 11.4 Status lain yang sering terlihat

| Objek | Nilai (label di layar) |
|---|---|
| Langganan | Aktif · Dijeda · Dibatalkan |
| Penukaran hadiah | Menunggu diambil · Sudah diambil · Dibatalkan |
| Voucher | Bisa dipakai · Sudah dipakai · Kedaluwarsa · Belum berlaku · Kuota habis |
| Komplain | Menunggu ditangani · Sedang ditangani · Selesai |
| Permintaan data pribadi | Menunggu ditinjau · Selesai · Ditolak |
| Karyawan | Aktif · Nonaktif · Resign |
| Absensi | Hadir · Terlambat · Absen · Cuti · Libur · Menunggu persetujuan |
| Penggajian | Draft · Disetujui · Dibayar |
| Insiden platform | Berlangsung · Selesai |

Semua label dikutip dari kamus bahasa (`profile.ts`, `help.ts`, `subscriptions.ts`, `hrFix.ts`, `hq.ts`). **[V]**

Halaman pelacakan publik `/track` menampilkan label status berbahasa Inggris (Order placed, Confirmed, Preparing, Driver assigned, Picked up, On the way, Delivered, Completed, Cancelled). **[B]**

## 12. Tabel 13 Peran dan Konsol yang Dapat Dimasuki

> **Catatan hak akses.** Tabel ini memuat nilai BAWAAN dari `packages/access/src/index.ts` dan gerbang masuk di `apps/web/src/lib/roles.ts`. Super admin dapat mengubah hak akses saat berjalan, dan perubahan berlaku sekitar 30 detik kemudian. Tabel bisa berbeda dari keadaan sebenarnya di produksi. **[K]**

Legenda: **Ya** = gerbang masuk terbuka. **Sebagian** = halaman tertentu terbuka sesuai kapabilitas, tetapi bukan pintu utama **[D]**. **—** = ditolak.

| No | Peran (layar) | Kode | Aplikasi pelanggan | Aplikasi kurir `/driver` | Konsol depot `/dashboard` | Konsol HQ `/hq` | Konsol HR `/hr` | HRIS mandiri `/hr/me` | Manajer mobile `/m/manager` |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Pelanggan | CUSTOMER | Ya | — | — | — | — | — | — |
| 2 | Staf depot | STAFF_DEPOT | — | Ya | Sebagian | — | — | Ya | — |
| 3 | Kepala depot | KEPALA_DEPOT | — | — | Ya | — | — | Ya | — |
| 4 | Asisten SPV | ASSISTANT_SUPERVISOR | — | — | Ya | — | Ya | Ya | — |
| 5 | SPV | SUPERVISOR | — | — | Ya | — | Ya | Ya | — |
| 6 | Manajer | MANAGER | — | — | Ya | — | Ya | — | Ya |
| 7 | Direktur | DIREKTUR | — | — | Ya | Ya | Ya | — | — |
| 8 | Pemilik waralaba | FRANCHISE_OWNER | — | — | Ya (ringkasan waralaba) | — | — | — | — |
| 9 | Head office | HEAD_OFFICE | — | — | Ya | Ya | Ya | — | — |
| 10 | Finance | FINANCE | — | — | Sebagian | Ya | Ya | — | — |
| 11 | HR | HR | — | — | Sebagian | — | Ya | — | — |
| 12 | Marketing | MARKETING | — | — | Sebagian (kampanye, promo, voucher) | — | — | — | — |
| 13 | Super admin | SUPER_ADMIN | Ya | Ya | Ya | Ya | Ya | Ya | Ya |

Dasar tiap kolom **[V]**:
- `/driver`: `canUseCourierApp` = STAFF_DEPOT atau SUPER_ADMIN.
- `/m/manager`: `canUseManagerConsole` = MANAGER atau SUPER_ADMIN.
- `/hq`: kapabilitas `hqConsole` = HEAD_OFFICE, DIREKTUR, FINANCE, SUPER_ADMIN. MANAGER sengaja ditolak.
- `/hr`: kapabilitas `hrView` = HR, HEAD_OFFICE, DIREKTUR, FINANCE, MANAGER, SUPERVISOR, ASSISTANT_SUPERVISOR, SUPER_ADMIN. Manajer dibatasi ke depotnya sendiri.
- `/hr/me`: `canPunchAttendance` = STAFF_DEPOT, KEPALA_DEPOT, ASSISTANT_SUPERVISOR, SUPERVISOR, SUPER_ADMIN. Ini gerbang masuk saja; server hanya menjawab bila akun punya data karyawan.
- `/dashboard`: lapisan `RequireAuth` hanya meminta sudah masuk. Tiap halaman memeriksa kapabilitas sendiri, jadi kolom "Ya" berarti landing `/dashboard` terbuka dan "Sebagian" berarti hanya halaman tertentu terbuka **[D]**. Isi persis menu per peran dibahas di panduan peran.
- Kolom Pelanggan untuk Super admin: Super admin lolos semua gerbang konsol; apakah ia memakai aplikasi pelanggan tidak diuji. **[D]**

Pemetaan istilah: "Staf depot" di UI dalam kode adalah STAFF_DEPOT. Dokumen permintaan menyebut peran ini sebagai kurir; ia masuk ke `/driver`. "Head office" di kamus UI dapat ditulis "Kantor pusat" dalam panduan. **[V]**

## 13. Glosarium

| Istilah | Arti |
|---|---|
| **Depot** | Tempat pengisian dan penyimpanan air; titik pengiriman pesanan |
| **HKP** | Depot milik perusahaan sendiri |
| **Waralaba** | Depot milik mitra waralaba |
| **Galon** | Wadah air 19 liter yang diisi ulang **[D]** (ukuran tidak diverifikasi) |
| **Deposit galon** | Jaminan galon yang dipegang pelanggan; kembali saat galon dikembalikan ke depot yang sama **[V]** |
| **OTP** | Kode sekali pakai yang dikirim lewat SMS untuk masuk |
| **COD** | Bayar di tempat, tunai kepada kurir |
| **QRIS** | Kode QR pembayaran; di Hydromart memakai QRIS milik depot, dikonfirmasi staf **[V]** |
| **Voucher** | Kode diskon; satu voucher per pesanan **[V]** |
| **Poin / Tier** | Poin loyalti; tier REGULAR, SILVER, GOLD, PLATINUM menurut total poin sepanjang waktu **[V]** |
| **Referral** | Kode ajakan teman; poin masuk setelah pesanan pertama teman selesai **[V]** |
| **Langganan** | Pesanan berulang otomatis (mingguan, 2 mingguan, bulanan) |
| **Agen / reseller** | Pelanggan dengan harga khusus; tidak boleh memakai voucher bersamaan **[V]** |
| **Express ("Antar sekarang")** | Pengantaran cepat dengan biaya tambahan, jika depot menyediakan |
| **PoD** | Bukti pengantaran (foto, lokasi, waktu) **[D]** |
| **SPV** | Supervisor |
| **Kasbon** | Pinjaman/uang muka karyawan |
| **HRIS** | Sistem informasi karyawan: absensi, cuti, gaji |
| **PDP** | Perlindungan Data Pribadi (UU PDP) |
| **Sesi** | Keadaan sedang masuk di satu perangkat |
| **Kapabilitas** | Izin tertentu dalam matriks hak akses |
| **HQ** | Kantor pusat |

## 14. Pemecahan Masalah Umum

| Gejala | Kemungkinan penyebab | Yang bisa dilakukan |
|---|---|---|
| SMS kode tidak datang | Gerbang SMS lambat atau kredit SMS habis. Catatan operasional menyebut kredit SMS sebagai penyebab terumum **[V]** | Tunggu 60 detik, tekan **Kirim ulang kode**. Bila tetap gagal, hubungi dukungan |
| Kode ditolak berulang | Kode lama sudah diganti kode baru | Pakai SMS terbaru saja. Setiap permintaan baru membatalkan kode lama |
| Layar verifikasi terkunci | 5 salah ketik atau 5 menit lewat | **Kirim ulang kode** |
| Tidak bisa keluar dari semua perangkat | Gagal memuat daftar | Pesan: "Gagal memuat daftar perangkat." Muat ulang halaman |
| Layar "Khusus HQ" / akses ditolak | Peran Anda tidak memiliki kapabilitas | Tekan **Kembali ke halaman saya**. Minta Super admin menyesuaikan hak bila memang perlu |
| Menu yang biasa ada hilang | Hak akses diubah Super admin (berlaku ±30 detik) | Muat ulang; konfirmasi ke atasan |
| Tampilan rusak di ponsel Android lama | WebView terlalu tua **[D]** | Perbarui Android System WebView dan browser |
| Notifikasi tidak muncul | Izin dimatikan di perangkat | Pesan: "Notifikasi diblokir. Izinkan Hydromart di setelan perangkat, lalu coba lagi." |
| "{n} data belum terkirim" | Perangkat luring saat mencatat | Hubungkan internet, tekan **Kirim sekarang**. Jangan tekan **Buang** kecuali yakin |
| Pesan error berbahasa Inggris | Sebagian pesan server belum diterjemahkan **[B]** | Lihat arti di panduan peran; bila perlu hubungi dukungan |
| Sesi habis sendiri | Batas waktu diam atau token berakhir | Masuk lagi |
| "Terlalu banyak permintaan" | Batas laju (rate limit) | Tunggu satu menit |

Contoh pesan Inggris yang mungkin muncul: "Your cart is empty." (keranjang kosong), "An order in status {status} can no longer be cancelled." (pesanan pada status itu tidak bisa dibatalkan lagi), "This voucher has expired." (voucher kedaluwarsa), "Could not reach the payment provider. Please try again." (penyedia pembayaran tak terjangkau, coba lagi). **[V]**

## 15. Dukungan dan Eskalasi

Hanya jalur yang terdokumentasi di repositori yang dicantumkan.

| Jalur | Untuk siapa | Cara | Catatan |
|---|---|---|---|
| Halaman **Bantuan** (`/help`) | Semua | Topik: "Lacak & masalah pengiriman", "Pembayaran & refund", "Galon, deposit & tukar", "Akun & keamanan"; pencarian FAQ | **[V]** |
| **Chat dengan CS** | Pelanggan | Tombol membuka WhatsApp ke kontak depot pelanggan. Muncul bila depot punya nomor | Nomor milik depot, bukan pusat **[V]** |
| **Ajukan komplain** | Pelanggan (masuk) | Formulir di `/help`; status Menunggu ditangani → Sedang ditangani → Selesai; balasan berlabel "Balasan Hydromart" lewat nomor akun | **[V]** |
| Permintaan data pribadi UU PDP | Pelanggan | Menu Akun → Data pribadi saya; juga halaman `/hapus-akun` | Lihat Panduan Pelanggan |
| Surel privasi | Publik | `privacy@hydromart-digital.com` tercantum di halaman privasi dan hapus akun | **[B]** Domain itu tidak punya catatan MX per 2026-09-25 (surat berisiko tidak sampai). Dokumen `GO_LIVE.md` menyebut perbaikan lewat Cloudflare Email Routing. Status terkini **[K]** |
| Eskalasi internal (insiden platform) | Tim teknis | Papan insiden di konsol HQ (Berlangsung / Selesai). Kontak jaga ada di `docs/RUNBOOK_ONCALL.md` (tidak disalin ke sini) | Tanpa eskalasi otomatis; peringatan yang tak dijawab diposting ulang tiap 4 jam **[V]** |
| Celah keamanan | Peneliti | GitHub Security Advisories; konfirmasi diterima dalam 3 hari kerja | `SECURITY.md` **[V]** |

Tidak ada nomor telepon pusat atau jam layanan pusat yang terdokumentasi. **[K]** Tidak ada email dukungan umum yang terdokumentasi selain surel privasi di atas.

## 16. Inventaris Screenshot Bab Ini

| ID | Layar | Kondisi | Status |
|---|---|---|---|
| SS-umum-01 | Beranda pelanggan (tamu) | Belum masuk; hero, promo, kategori, depot terdekat tampil | Belum diambil |
| SS-umum-02 | Halaman `/login` | Kolom Nomor telepon kosong, tombol Kirim kode | Belum diambil |
| SS-umum-03 | Halaman `/verify` | 6 kotak, hitung mundur, tombol Kirim ulang dalam {n}d | Belum diambil |
| SS-umum-04 | Konsol depot `/dashboard` | Peran Manajer, rel menu terlihat | Belum diambil |
| SS-umum-05 | Layar akses ditolak | Tombol Kembali ke halaman saya | Belum diambil |
| SS-umum-06 | Konsol HQ `/hq` | Peran Head office | Belum diambil |
| SS-umum-07 | Aplikasi kurir `/driver` | Tab Tugas, peran Staf depot | Belum diambil |

Gunakan data contoh sintetis dan nomor telepon palsu pada semua tangkapan layar.

## 17. Catatan Celah dan Hal yang Perlu Dikonfirmasi

Daftar lengkap dirujuk ke `17-open-questions`. Yang terkait bab ini:

| No | Temuan | Tag |
|---|---|---|
| 1 | Tidak ada pernyataan dukungan browser/perangkat resmi | [K] |
| 2 | Layar verifikasi dikunci 6 kotak, server bisa disetel 4–8 digit | [B] |
| 3 | Nilai produksi batas diam sesi belum diketahui | [K] |
| 4 | `privacy@hydromart-digital.com` tanpa MX per 2026-09-25 | [B] |
| 5 | Status pembayaran dan metode tampil kode Inggris mentah; `/track` berlabel Inggris; beberapa pesan server Inggris | [B] |
| 6 | Layar akses ditolak berjudul "Khusus HQ" juga dipakai konsol lain | [B] |
| 7 | Status aplikasi Android di Play Store (pengujian internal per 2026-09-25) | [K] |
| 8 | Isi menu `/dashboard` per peran ("Sebagian") perlu dipetakan per peran | [D] |
| 9 | Jam layanan dan nomor dukungan pusat tidak terdokumentasi | [K] |
| 10 | PRD menyebut WhatsApp dan email sebagai saluran; kode hanya SMS, push, dan kotak masuk | [B] |
