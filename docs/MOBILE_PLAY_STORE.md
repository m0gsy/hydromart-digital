# Hydromart di Google Play — berkas yang harus diisi

Fase 7 punya dua bagian yang sangat berbeda. Yang satu **pekerjaan**: menentukan data apa
yang dikumpulkan, izin mana yang benar-benar dipakai, dan apa yang terjadi kalau seseorang
minta akunnya dihapus. Yang satu lagi **klik di Play Console**: mengunggah ikon,
menempelkan teks, mencentang kotak.

Dokumen ini berisi bagian pertama, sudah selesai, dalam bentuk yang tinggal disalin. Yang
tersisa untuk Anda ada di bagian terakhir.

---

## 1. Data Safety

Play menanyakan, per jenis data: dikumpulkan atau tidak, dibagikan ke pihak ketiga atau
tidak, wajib atau opsional, untuk apa, dienkripsi saat transit, dan apakah pengguna bisa
minta dihapus. Jawabannya di bawah, per **binary** — karena keduanya berbeda jauh dan
mengisi keduanya dengan jawaban yang sama adalah cara termudah untuk salah.

Tiga jawaban berlaku untuk **semua** baris di kedua tabel, jadi tidak diulang:

- **Dienkripsi saat transit:** ya. Caddy memaksa HTTPS, dan `usesCleartextTraffic=false`
  di manifest berarti Android memblokir permintaan http apa pun yang tersisa.
- **Dibagikan ke pihak ketiga:** tidak. Tidak ada SDK iklan, tidak ada analytics, tidak
  ada Crashlytics — lihat "Yang sengaja tidak ada" di `MOBILE_APPS_PLAN.md`.
- **Bisa diminta hapus:** ya, lewat jalur di bagian 3.

### App 1 — Hydromart (`id.hydromart.app`, pelanggan)

| Jenis data (istilah Play) | Kumpul | Wajib    | Tujuan                       | Catatan                                                      |
| ------------------------- | ------ | -------- | ---------------------------- | ------------------------------------------------------------ |
| Name                      | Ya     | Wajib    | Fungsi aplikasi              | Nama penerima di pesanan dan alamat                          |
| Phone number              | Ya     | Wajib    | Fungsi aplikasi, autentikasi | Satu-satunya identitas login (OTP)                           |
| Address                   | Ya     | Wajib    | Fungsi aplikasi              | Buku alamat + patokan; kurir butuh ini untuk mengantar       |
| Photos                    | Ya     | Opsional | Fungsi aplikasi              | Foto profil saja. Diambil kamera; galeri tidak pernah dibaca |
| Purchase history          | Ya     | Wajib    | Fungsi aplikasi              | Riwayat pesanan, poin, tier                                  |
| Device or other IDs       | Ya     | Opsional | Fungsi aplikasi              | Token FCM, hanya kalau notifikasi diizinkan                  |
| App interactions          | Ya     | Wajib    | Fungsi aplikasi              | Status pesanan & notifikasi in-app                           |

**Bukan** "Financial info": pembayaran di Hydromart selesai langsung di depot (tunai/QRIS
di tempat) — tidak ada gateway pembayaran, tidak ada nomor kartu, tidak ada rekening yang
masuk ke aplikasi. **Bukan** "Location": aplikasi pelanggan tidak pernah membaca posisi;
alamat diketik, bukan diambil dari GPS.

### App 2 — Hydromart Ops (`id.hydromart.ops`, staf)

Semua baris di atas tidak berlaku — Ops bukan aplikasi belanja. Yang berlaku:

| Jenis data (istilah Play)    | Kumpul | Wajib    | Tujuan          | Catatan                                                                       |
| ---------------------------- | ------ | -------- | --------------- | ----------------------------------------------------------------------------- |
| Name                         | Ya     | Wajib    | Fungsi aplikasi | Nama karyawan                                                                 |
| Phone number                 | Ya     | Wajib    | Autentikasi     | Login OTP                                                                     |
| Precise location             | Ya     | Wajib    | Fungsi aplikasi | Posisi kurir saat antaran terbuka. **Foreground saja** — lihat bagian 4       |
| Photos                       | Ya     | Wajib    | Fungsi aplikasi | Foto bukti kirim (PoD) dan absen wajah, keduanya dari kamera langsung         |
| Salary / employment info     | Ya     | Wajib    | Fungsi aplikasi | Slip gaji, cuti, absensi (masuk "Personal info → Other info")                 |
| Financial info (transaksi)   | Ya     | Wajib    | Fungsi aplikasi | Setoran kurir, kas konter, tutup harian — uang depot, bukan data bank pribadi |
| Device or other IDs          | Ya     | Opsional | Fungsi aplikasi | Token FCM                                                                     |
| Customer data (pihak ketiga) | Ya     | Wajib    | Fungsi aplikasi | Nama/alamat/telepon pelanggan yang dilayani staf                              |

### Yang harus dinyatakan jelas: dua hal berbeda yang sama-sama "wajah"

Ini pertanyaan yang paling mungkin memicu balasan reviewer, jadi jawabannya disiapkan
sekarang, bukan nanti:

- **Absen wajah HR** (`/hr/me/check-in`) **mengirim frame ke server.** Itu pengumpulan
  data biometrik dan dinyatakan sebagai Photos di tabel Ops.
- **Login biometrik (F3b) tidak mengirim apa pun ke mana pun.** Sidik jari atau wajah
  hanya membuka kunci Keystore di perangkat itu; aplikasi tidak pernah melihat, menyimpan,
  atau mengirimkan datanya, dan API Android tidak mengizinkannya sekalipun kami mau. Ia
  **tidak** masuk Data Safety, karena tidak ada data yang dikumpulkan — hanya kunci lokal
  yang dibuka.

Aplikasi pelanggan tidak punya absen wajah sama sekali.

---

## 2. Justifikasi izin

Satu baris per izin, dan kalimat inilah yang dipakai kalau Play menanyakannya. Daftar yang
sama ada di `mobile/scripts/audit-manifest.mjs`; keduanya harus tetap sama.

| Izin                     | Dipakai untuk                                                 | Diminta kapan                            |
| ------------------------ | ------------------------------------------------------------- | ---------------------------------------- |
| `INTERNET`               | Bicara dengan API Hydromart                                   | Tidak perlu izin runtime                 |
| `POST_NOTIFICATIONS`     | Notifikasi status pesanan (FCM)                               | Setelah pesanan pertama, bukan saat boot |
| `CAMERA`                 | Foto bukti kirim & absen wajah (`getUserMedia`, bukan galeri) | Saat kamera dibuka                       |
| `ACCESS_COARSE_LOCATION` | Posisi kurir selama antaran terbuka                           | Saat antaran dibuka                      |
| `ACCESS_FINE_LOCATION`   | Sama, akurasi alamat                                          | Saat antaran dibuka                      |
| `USE_BIOMETRIC`          | Membuka sesi tersimpan di perangkat                           | Saat aplikasi dibuka, kalau ada sesi     |

Sisanya (`ACCESS_NETWORK_STATE`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, `VIBRATE`,
`c2dm.permission.RECEIVE`, `FOREGROUND_SERVICE`) tidak diminta oleh kode mana pun di repo
ini — semuanya dibawa masuk oleh Firebase Cloud Messaging lewat manifest AAR-nya. Tidak
memunculkan dialog apa pun ke pengguna, tapi tetap terdaftar di skrip audit supaya
kemunculannya adalah keputusan, bukan kejutan.

Satu lagi yang hanya terlihat di manifest hasil merge:
`<applicationId>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, dibawa androidx.core. Izin
tingkat signature yang aplikasi berikan **hanya kepada dirinya sendiri**, supaya broadcast
yang didaftarkan dengan `RECEIVER_NOT_EXPORTED` tidak bisa dijangkau aplikasi lain. Tidak
pernah meminta apa pun ke pengguna dan tidak muncul di listing Play. Namanya memuat
applicationId, jadi ia berbeda antar-binary dan dicocokkan dengan pola di skrip audit,
bukan string persis.

### Yang sengaja TIDAK diminta

- **`ACCESS_BACKGROUND_LOCATION`** — butuh foreground service, deklarasi tertulis, dan
  video demo, dan menambah berminggu-minggu di review. `lib/geo.ts` hanya membaca posisi
  saat kurir sedang melihat layarnya.
- **`READ_MEDIA_IMAGES` / `READ_EXTERNAL_STORAGE`** — memicu proses deklarasi Photo &
  Video. Tidak ada satu pun berkas di perangkat yang dibaca aplikasi ini, dan itulah
  pernyataan yang benar — bukan "semuanya lewat `getUserMedia`", karena hanya absen wajah
  HR yang begitu. Foto bukti kirim memakai `<input type="file" capture="environment">`,
  yang diterjemahkan Capacitor menjadi intent kamera; kalau intent itu tidak bisa
  diluncurkan ia jatuh ke pemilih dokumen sistem, dan pemilih dokumen tidak butuh izin
  penyimpanan apa pun karena penggunanya sendiri yang memilih berkasnya. Agar jatuhnya
  tidak terjadi karena alasan yang salah, manifest mendeklarasikan `<queries>` untuk
  `android.media.action.IMAGE_CAPTURE` — tanpa itu, package visibility Android 11 membuat
  kamera tak terlihat dan setiap bukti kirim membuka galeri. Ini justru risiko yang paling
  mudah masuk tanpa disadari lewat plugin, dan itu sebabnya audit di bawah menolak izin
  yang tidak ada di daftar, bukan sekadar memperingatkan izin yang sudah diketahui buruk.
- **`QUERY_ALL_PACKAGES`**, **`SCHEDULE_EXACT_ALARM`**, **`REQUEST_INSTALL_PACKAGES`** —
  tidak ada yang membutuhkannya.

### Audit manifest gabungan

```bash
cd mobile
npm run audit:manifest                # manifest kita + semua plugin terpasang
node scripts/audit-manifest.mjs android/app/build/intermediates/merged_manifests/release/AndroidManifest.xml
```

Bentuk pertama untuk dijalankan kapan saja; bentuk kedua adalah yang benar-benar mengikat,
karena hanya manifest hasil merge yang memperlihatkan izin yang dibawa AAR. CI menjalankan
bentuk kedua untuk **kedua** binary setelah `bundleRelease` dan **menggagalkan build**
kalau ada izin yang belum dijustifikasi. Perbaikannya bukan menambah nama ke daftar
diam-diam, melainkan menulis kalimat pembenarannya di tabel di atas dulu — kalimat itu
persis yang akan diminta Play.

---

## 3. Jalur hapus akun

Play mewajibkan URL publik yang bisa dibuka **tanpa login dan tanpa memasang aplikasi**.
Sudah ada, sejak F0:

- **URL:** `https://<WEB_DOMAIN>/hapus-akun` — isikan ini di Play Console → App content →
  Data deletion.
- Halaman itu menyebut pengembang, kedua aplikasi yang dicakup, langkah permintaannya, dan
  yang paling penting bagi reviewer: **apa yang dihapus dan apa yang tetap disimpan.**
- Di dalam aplikasi, jalur yang sama ada di **Akun → Hapus akun**, dan ia mengeksekusi
  langsung, bukan mengirim email ke seseorang.
- Apa yang sebenarnya terjadi ada di `hydromart-pdp-item13`: data pribadi
  dianonimkan, bukan dihapus dari baris pesanan — catatan penjualan wajib disimpan menurut
  hukum pajak, dan Data Safety menyebut ini apa adanya, bukan mengklaim penghapusan total.

---

## 4. Akses reviewer (J6)

Login hanya OTP telepon. Reviewer Play ada di negara lain, tidak akan menerima SMS
Indonesia, dan **"tidak bisa masuk" adalah salah satu alasan penolakan paling umum.**

**Mekanismenya sudah ada di kode.** `REVIEWER_PHONE` + `REVIEWER_OTP_CODE` di `.env`
membuat nomor yang disebut menerima kode tetap, bukan acak. Yang tidak berubah: kode itu tetap
di-hash, tetap kedaluwarsa, tetap sekali pakai, tetap dibatasi jumlah percobaan. **Tidak
ada jalan pintas di jalur verifikasi** — yang berubah hanya nilai yang digenerate, dan itu
disengaja: kredensial yang bisa ditebak berbeda jauh dari kredensial yang tidak diperiksa.

Aturan yang mengikat:

- **Dua-duanya kosong = fitur tidak ada.** Mengisi nomor tanpa kode membuat auth-service
  gagal boot — bukan setengah aktif, karena setengah aktif terlihat persis seperti bekerja
  sampai reviewer mencobanya.
- Arahkan ke **akun demo khusus**: nol pesanan asli, bukan nomor orang sungguhan. Siapa
  pun yang tahu pasangan itu bisa masuk sebagai akun tersebut.
- **SMS tidak dikirim ke nomor reviewer.** Reviewer sudah memegang kodenya dari Play
  Console, jadi pengiriman hanya menagih biaya dan mengetuk ponsel orang yang tidak pernah
  meminta — nomor demo tidak selalu SIM milik perusahaan. Yang dilewati hanya
  pengirimannya; tantangannya tetap dibuat, tetap kedaluwarsa, tetap diverifikasi.
- Ganti kodenya setelah review selesai, atau kosongkan keduanya untuk mematikan fitur.

**Dua nomor, bukan satu.** `REVIEWER_PHONE` menerima daftar dipisah koma. Aplikasi
pelanggan butuh akun ber-role `CUSTOMER`, Ops butuh akun staf, dan satu nomor hanya
memikul satu role — dengan satu slot, kedua review harus antre bergantian. Akun stafnya
tempatkan di **depot demo**: di depot produksi, reviewer membaca nama, alamat, dan telepon
pelanggan sungguhan.

```bash
REVIEWER_PHONE=+6281100000098,+6281100000099
REVIEWER_OTP_CODE=246810
```

Langkah di Play Console → App content → App access:

1. Buat akun demo untuk tiap binary, isi `REVIEWER_PHONE` + `REVIEWER_OTP_CODE` di `.env`
   VPS, lalu `docker compose up -d auth`. Buktikan sendiri dengan login memakai pasangan
   itu sebelum submit — kalau Anda tidak bisa masuk, reviewer juga tidak.
2. Nomor + kode itu ditempel di kolom "App access" beserta satu kalimat: aplikasi ini
   memakai OTP, gunakan kode ini.
3. Untuk **Hydromart Ops**, tambahkan lagi: deskripsi harus jujur bahwa aplikasi ini hanya
   untuk staf depot. Play menolak aplikasi yang tampak publik tapi seluruh isinya di balik
   login tanpa penjelasan — dan Ops seluruhnya begitu.

Cadangan kalau OTP tetap belum siap: video demo satu menit yang memperlihatkan login
sampai layar utama. Lebih lemah, tapi diterima.

---

## 5. Target API level

`mobile/android/variables.gradle` memakai `targetSdkVersion = 36`, memenuhi syarat Play
saat ini. Nilainya berubah saat Capacitor di-upgrade — bukan sesuatu yang perlu diatur
sendiri di sini.

Konsekuensinya bukan administratif: sejak API 35 Android memaksa edge-to-edge dan
`StatusBar.setOverlaysWebView(false)` menjadi no-op. Aplikasi memang menggambar di bawah
status bar, jadi yang menahan chrome-nya adalah `env(safe-area-inset-top)` di app bar —
bukan panggilan plugin itu, yang sudah dihapus.

---

## 6. Teks listing — tinggal salin

Wajib diisi sebelum rilis ke track mana pun, termasuk closed testing. Batas Play: judul 30
karakter, deskripsi pendek 80, deskripsi panjang 4000.

### App 1 — Hydromart (`id.hydromart.app`)

**Judul**

```
Hydromart
```

**Deskripsi pendek**

```
Pesan galon isi ulang & air kemasan dari depot terdekat, diantar ke rumah.
```

**Deskripsi panjang**

```
Hydromart mengantar air minum bersih dari depot terdekat langsung ke rumah Anda.

BELANJA TANPA RIBET
• Jelajahi katalog galon isi ulang dan air kemasan lengkap dengan harga depot Anda
• Simpan produk favorit untuk pemesanan berikutnya
• Pesan ulang pesanan lama hanya dengan satu ketukan
• Langganan berulang untuk kebutuhan rutin, tanpa perlu memesan tiap minggu

LACAK SAMPAI DI DEPAN PINTU
• Pantau status pesanan dari diterima, disiapkan, sampai dalam perjalanan
• Notifikasi otomatis di setiap perubahan status
• Simpan alamat beserta patokan, supaya kurir tidak perlu menelepon

BAYAR DI TEMPAT
Bayar tunai atau QRIS langsung ke kurir saat pesanan tiba. Tidak ada kartu yang perlu
disimpan di aplikasi.

POIN DAN VOUCHER
• Kumpulkan poin dari setiap pesanan selesai
• Naik tier keanggotaan dan nikmati harga khusus
• Tukar poin dengan hadiah di katalog rewards
• Bagikan kode referral Anda dan dapatkan poin tambahan

AKUN ANDA, KENDALI ANDA
Ubah profil dan foto, atur tema dan bahasa, kelola notifikasi, ekspor data Anda, atau
hapus akun kapan saja langsung dari aplikasi — sesuai UU Perlindungan Data Pribadi.

Butuh bantuan? Halaman bantuan tersedia di dalam aplikasi.
```

### App 2 — Hydromart Ops (`id.hydromart.ops`)

Deskripsinya **harus** menyatakan sejak kalimat pertama bahwa ini aplikasi internal. Play
menolak aplikasi yang tampak publik tapi seluruh isinya di balik login tanpa penjelasan,
dan Ops seluruhnya begitu — J6 berlaku dua kali lipat di sini.

**Judul**

```
Hydromart Ops
```

**Deskripsi pendek**

```
Aplikasi internal staf Hydromart. Perlu akun karyawan yang sudah terdaftar.
```

**Deskripsi panjang**

```
APLIKASI INTERNAL — KHUSUS KARYAWAN HYDROMART

Aplikasi ini bukan untuk umum. Masuk hanya bisa dilakukan dengan nomor telepon karyawan
yang sudah didaftarkan oleh perusahaan; pendaftaran mandiri tidak tersedia. Bila Anda
pelanggan, aplikasi yang Anda cari adalah "Hydromart".

Satu aplikasi untuk seluruh operasi depot. Layar pertama menyesuaikan jabatan Anda.

KURIR
• Rute hari ini dan daftar antaran
• Navigasi ke alamat lengkap dengan patokan
• Bukti kirim: foto, tanda tangan, catatan gagal kirim, jadwal ulang
• Terima pembayaran tunai atau QRIS di tempat, catat galon kembali
• Absen masuk dan pulang, target, pendapatan, dan setoran
• Bekerja tanpa sinyal: foto dan absen tersimpan dan terkirim saat jaringan kembali

KEPALA DEPOT
• Kasir konter, buka dan tutup shift, buku kas, cetak struk
• Antrean pesanan, pelacakan kurir, penugasan roster
• Stok, susut, retur, dan meteran air
• Penyelesaian pembayaran, setoran kurir, tutup harian

SUPERVISOR DAN MANAJER
• Ringkasan banyak depot, antrean persetujuan, harga, tim
• Keuangan depot, target, sengketa, insiden

SEMUA KARYAWAN
Absen wajah, riwayat kehadiran, slip gaji, pengajuan cuti, dan pengumuman perusahaan.

Data yang ditampilkan adalah data operasional milik perusahaan dan hanya dapat diakses
oleh karyawan yang berwenang.
```

### Aset gambar

Semuanya ada di [`docs/play-assets/`](play-assets/).

| Aset                      | Ukuran    | Berkas                                                              |
| ------------------------- | --------- | ------------------------------------------------------------------- |
| Ikon                      | 512×512   | `app-icon-512.png`                                                  |
| Feature graphic           | 1024×500  | `feature-graphic-1024x500.png`                                      |
| Screenshot ponsel         | 1236×2196 | `screenshot-app-1-beranda.png`, `-2-belanja.png`, `-3-rewards.png`  |
| Screenshot tablet 7 inci  | 1200×2133 | `screenshot-tab7-1-beranda.png`, `-2-belanja.png`, `-3-rewards.png` |
| Screenshot tablet 10 inci | 1600×2844 | `screenshot-tab10-…` (tiga berkas, nama sama polanya)               |
| Screenshot ponsel Ops     | 1236×2196 | `screenshot-ops-…` (empat berkas, nama sama polanya)                |

Ikon dan feature graphic dipakai ulang untuk kedua aplikasi — keduanya murni merek, tanpa
satu pun elemen khusus pelanggan. Screenshot **tidak** boleh dipakai ulang: listing
aplikasi staf yang memajang layar belanja pelanggan adalah undangan penolakan. Keempat
berkas Ops di atas dibuat ulang dengan
[`apps/web/scripts/play-screenshots.mjs`](../apps/web/scripts/play-screenshots.mjs) —
login kurir (`+6281100000003`) untuk dua yang pertama, kepala depot (`+6281100000005`)
untuk dua sisanya. Skrip itu membuka shift konter lebih dulu, karena tanpa shift layar
kasir hanya memperlihatkan "Belum ada shift terbuka".

Tablet opsional di Play — hanya screenshot ponsel yang wajib. Diisi karena tanpanya Play
menampilkan listing "tidak dioptimalkan untuk tablet" pada perangkat tablet, dan karena
biayanya nol: aplikasinya memang responsif. Yang 10 inci bukan versi diperbesar dari yang
7 inci — di 810dp tata letaknya berganti ke nav atas dan grid tiga kolom, sementara 600dp
masih tata letak ponsel, persis seperti di tablet sungguhan.

Ketiga screenshot itu **bukan** hasil tangkapan dari APK: semuanya diambil dari aplikasi
web di viewport ponsel (412×732 @3×, mobile+touch, akun pelanggan), tablet 7 inci
(400×711 @3×) dan tablet 10 inci (800×1422 @2× — di atas 640px chrome-nya berganti ke nav
desktop, seperti di tablet sungguhan). Isinya persis yang digambar WebView — Capacitor
menyajikan bundel yang sama — jadi sah dipakai untuk listing hari ini. Rasionya 9:16,
ukuran minimum Play terpenuhi.

Kesembilannya diambil ulang setelah redesain IA ponsel: app bar + tab bar empat slot,
pencarian di app bar pada layar Belanja, dan rewards bertab. Yang sebelumnya menggambarkan
tata letak yang sudah tidak ada.

Dua hal yang perlu Anda ketahui sebelum mengunggahnya:

- **Produk di produksi belum punya foto.** Kartu produk menggambar ikon tetesan sebagai
  pengganti. Unggah foto produk dulu kalau ingin listing terlihat penuh.
- Nama sapaan di beranda adalah nama akun reviewer ("Halo, Play."). Ganti nama akun demo
  itu kalau mengganggu, lalu ambil ulang.

Versi yang lebih baik tetap datang dari APK debug hasil **Actions → Mobile release → Run
workflow** — satu perjalanan menghasilkan dua hal sekaligus: bukti checklist perangkat dan
aset listing yang benar-benar dari binary.

### Store settings — nilai yang dipakai

| Kolom             | App pelanggan                                     | App Ops  |
| ----------------- | ------------------------------------------------- | -------- |
| Jenis aplikasi    | App                                               | App      |
| Kategori          | Food & Drink                                      | Business |
| Email kontak      | `hello@hydromart-digital.com`                     | sama     |
| Situs web         | `https://hydromart-digital.com`                   | sama     |
| Kebijakan privasi | `https://hydromart-digital.com/kebijakan-privasi` | sama     |
| Hapus akun        | `https://hydromart-digital.com/hapus-akun`        | sama     |

Keempat URL itu sudah menjawab 200 di produksi (dicek 2026-08-09).

---

## 7. Yang tersisa untuk Anda — semuanya di Play Console

Tidak satu pun bisa diselesaikan dari repo ini.

**Sebelum rilis ke track mana pun, termasuk closed testing:**

- [ ] Daftar akun Play pribadi; verifikasi identitas makan beberapa hari
- [ ] Aktifkan **Play App Signing** (tanpa ini, keystore hilang = aplikasi tidak bisa
      diperbarui selamanya)
- [ ] Buat kedua aplikasi: `id.hydromart.app` dan `id.hydromart.ops`
- [ ] Satu proyek Firebase, dua app Android, unduh **satu** `google-services.json`, jadikan
      secret `GOOGLE_SERVICES_JSON_BASE64`
- [ ] Isi Data Safety dari bagian 1 — dua form, satu per aplikasi, dan isinya berbeda
- [ ] Content rating, target audience, kategori
- [ ] URL hapus akun dari bagian 3
- [ ] Akses reviewer dari bagian 4 (akun demo + dua env, lalu tempel di App access)
- [ ] Uji di ponsel sungguhan sebelum unggahan pertama: Actions → **Mobile release** → Run
      workflow menghasilkan dua APK debug yang bisa di-sideload, tanpa perlu akun Play.
      Jalankan checklist perangkat di `MOBILE_APPS_PLAN.md` — beberapa itemnya tidak bisa
      diperbaiki setelah binary ada di tangan pengguna
- [ ] Aset listing: ikon 512×512, feature graphic 1024×500, ≥2 screenshot ponsel per
      aplikasi, deskripsi pendek + panjang dalam Bahasa Indonesia. Untuk app pelanggan
      semuanya sudah ada di `docs/play-assets/`; untuk Ops belum satu pun screenshot

**Setelah AAB pertama diterima:**

- [ ] Salin sidik jari **Play App Signing** SHA-256 tiap aplikasi (Setup → App integrity →
      App signing key certificate) ke `sha256_cert_fingerprints` di
      [apps/web/public/.well-known/assetlinks.json](../apps/web/public/.well-known/assetlinks.json),
      satu per `package_name`, lalu commit + deploy web. Berkas itu dilayani aplikasi web
      sendiri, jadi tidak ada perubahan Caddy atau env. **Bukan** sidik jari keystore
      upload — Play menandatangani ulang setiap AAB
- [ ] Cek `curl -s https://<WEB_DOMAIN>/.well-known/assetlinks.json`
- [ ] Di perangkat uji: `adb shell pm verify-app-links --re-verify id.hydromart.app`,
      karena Android menyimpan hasil verifikasinya
- [ ] Tanpa langkah ini App Links tidak terverifikasi dan tautan terbuka di browser —
      bukan kerusakan, hanya kehilangan fitur, dan tidak terlihat dari dalam aplikasi
- [ ] Rekrut **15–20** penguji (lantai 12), mulai closed testing 14 hari

---

## 8. Bundle mana yang diunggah, dan kapan berhenti mengunggahnya sendiri

**Aturannya bukan nomor versi, melainkan: unggah tag yang dibuat dari `main` terkini.**
Ditulis begini karena versi yang disebut namanya langsung basi — dan sudah pernah, dua
kali:

- `mobile-v1.0.0` membuktikan jalur rilisnya utuh tapi membawa ikon placeholder.
- `mobile-v1.0.1` membawa ikon asli dan enam perbaikan, lalu **pass verifikasi kedua
  menemukan enam lagi** — termasuk satu yang membuat setiap foto bukti kirim membuka
  galeri, bukan kamera, di Android 11+. Tag itu dibuat sebelum perbaikan tersebut masuk,
  jadi AAB-nya membawa bug itu.

Jadi sebelum mengunggah, periksa satu hal: apakah tag yang dipegang lebih baru dari commit
terakhir di `main`. Kalau tidak, buat tag baru dan pakai yang itu. Ini murah — satu tag,
dua puluh menit build — dan jauh lebih murah daripada menarik rilis dari track yang sudah
punya penguji di dalamnya.

AAB tiap tag ada sebagai artifact di run-nya (`hydromart-aab-<versi>`), bertahan 30 hari.
`versionCode` diambil dari nomor run, bukan dari tag — Play menolak `versionCode` yang
pernah ia lihat, dan menjalankan ulang tag yang sama harus menghasilkan angka lebih tinggi.

Setelah kedua app ada di Play, listing terisi, dan rilis pertama lolos review **dengan
tangan**, isi secret opsional `PLAY_SERVICE_ACCOUNT_JSON` (isi berkas kunci service account
apa adanya, sebagai teks). Sejak saat itu tiap tag `mobile-v*` naik sendiri ke **track
internal**. Tanpa secret itu langkahnya skip dengan notice dan run tetap hijau — jadi tidak
ada yang perlu dimatikan lebih dulu.

Track-nya `internal` dan tidak pernah `production`: internal testing terbit dalam hitungan
menit ke daftar nama tertentu, dan itu satu-satunya track yang tidak bisa menjangkau publik
karena kecelakaan. Menaikkannya ke closed testing dan seterusnya tetap keputusan yang
diambil orang di konsol.
