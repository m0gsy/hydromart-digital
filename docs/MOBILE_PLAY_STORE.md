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
| Approximate location      | Ya     | Opsional | Fungsi aplikasi              | Dikirim ke server untuk cari depot terdekat — lihat catatan di bawah |

**Bukan** "Financial info": pembayaran di Hydromart selesai langsung di depot (tunai/QRIS
di tempat) — tidak ada gateway pembayaran, tidak ada nomor kartu, tidak ada rekening yang
masuk ke aplikasi.

**Location — dikoreksi (J1).** Baris ini dulu menyatakan aplikasi pelanggan tidak pernah
membaca posisi. Itu salah: layar alamat dan pemilih lokasi beranda membaca posisi kasar
lalu **mengirimnya ke server** untuk mencari depot terdekat — menurut definisi Play itu
_dikumpulkan_. Yang benar: **Approximate location**, dikumpulkan **ya**, dibagikan ke
pihak ketiga **tidak**, **opsional** (pelanggan bisa mengetik alamat tanpa memberi izin),
tujuan **fungsi aplikasi** saja, terenkripsi saat transit **ya**, bisa diminta hapus
**ya**. Binari pelanggan tidak membawa `ACCESS_FINE_LOCATION` — izin itu dicabut dari
merged manifest — jadi deklarasinya tetap Approximate, bukan Precise. Mengisi formulir
Data Safety-nya adalah pekerjaan N1.

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

#### N11 — dua deklarasi yang tidak punya pemilik, sekarang punya

**`FOREGROUND_SERVICE`.** Diketahui masuk lewat AAR milik FCM dan sudah ada di allowlist
audit, tapi belum pernah dijawab: apakah kehadirannya memicu formulir deklarasi Play?
Jawabannya **tidak**, dan alasannya bisa diperiksa: formulir "Foreground service
permissions" hanya diminta Play untuk izin bertipe `FOREGROUND_SERVICE_*` (mis.
`FOREGROUND_SERVICE_LOCATION`), yang berasal dari Android 14 dan **tidak** ada di manifes
gabungan kita — dan hanya bila aplikasi benar-benar menjalankan foreground service.
Repo ini tidak punya satu pun `Service`; FCM di sini hanya menerima pesan `notification`
tampilan, yang ditangani sistem tanpa service milik aplikasi. Bila itu berubah — misalnya
pelacakan kurir dipindah ke foreground service — deklarasinya WAJIB diisi dan barisnya
harus kembali ke sini sebagai keputusan baru.

**Halaman 16 KB (Android 15+).** Repo bungkam soal ini, jadi dicatat sekarang: syaratnya
berlaku untuk **pustaka native (`.so`)**, dan aplikasi ini tidak mengirim satu pun kode
native miliknya sendiri — tidak ada `ndk`, tidak ada `abiFilters`, tidak ada modul NDK di
`build.gradle`. Yang bisa membawa `.so` adalah plugin pihak ketiga; hari ini tidak ada yang
melakukannya. `compileSdk`/`targetSdk` sudah 36, jadi ambang Play-nya terpenuhi. Yang harus
dijaga adalah aturannya, bukan angkanya: **plugin baru yang membawa `.so` mengubah jawaban
ini**, dan pemeriksanya satu perintah pada AAB yang sudah dibangun:

```bash
unzip -l app-release.aab | grep '\.so$'   # kosong = tidak ada pustaka native sama sekali
```

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
| Tablet 7 inci Ops         | 1200×2133 | `screenshot-ops-tab7-…` (empat berkas)                              |
| Tablet 10 inci Ops        | 1600×2400 | `screenshot-ops-tab10-…` (empat berkas)                             |

Ikon dan feature graphic dipakai ulang untuk kedua aplikasi — keduanya murni merek, tanpa
satu pun elemen khusus pelanggan. Screenshot **tidak** boleh dipakai ulang: listing
aplikasi staf yang memajang layar belanja pelanggan adalah undangan penolakan. Kedua belas
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
      aplikasi, deskripsi pendek + panjang dalam Bahasa Indonesia. Semuanya sudah ada di
      `docs/play-assets/` — **untuk kedua aplikasi**. Baris ini dulu berbunyi "untuk Ops
      belum satu pun screenshot"; itu sudah tidak benar dan bertentangan dengan tabel aset
      di bagian 6. Dihitung 2026-08-25: 25 PNG, di antaranya dua belas berkas Ops
      (`screenshot-ops-…` 1236×2196, `-tab7-` 1200×2133, `-tab10-` 1600×2400), dan setiap
      ukuran dicek dari header IHDR-nya, bukan dari namanya

**Setelah AAB pertama diterima:**

- [ ] Salin sidik jari **Play App Signing** SHA-256 tiap aplikasi (Setup → App integrity →
      App signing key certificate) ke `sha256_cert_fingerprints` di
      [apps/web/public/.well-known/assetlinks.json](../apps/web/public/.well-known/assetlinks.json),
      satu per `package_name`, lalu commit + deploy web. Berkas itu dilayani aplikasi web
      sendiri, jadi tidak ada perubahan Caddy atau env. **Bukan** sidik jari keystore
      upload — Play menandatangani ulang setiap AAB
- [ ] **SEMUA** sertifikat App signing, bukan yang pertama saja. Play memegang kunci
      klasik dan kunci pasca-kuantum berdampingan, dan verifikasi bisa memeriksa yang mana
      pun. `id.hydromart.ops` sempat terkirim satu rilis penuh hanya dengan satu dari tiga,
      ditambah kunci upload yang justru dilarang di atas — dan tidak ada apa pun yang
      berbunyi, karena App Links gagal terbuka: tautan diam-diam tetap membuka browser.
      `scripts/check-assetlinks.mjs` kini menolak keduanya di CI
- [ ] Cek `curl -s https://<WEB_DOMAIN>/.well-known/assetlinks.json`
- [ ] Di perangkat uji: `adb shell pm verify-app-links --re-verify id.hydromart.app`,
      karena Android menyimpan hasil verifikasinya
- [ ] Tanpa langkah ini App Links tidak terverifikasi dan tautan terbuka di browser —
      bukan kerusakan, hanya kehilangan fitur, dan tidak terlihat dari dalam aplikasi
- [ ] Rekrut **15–20** penguji (lantai 12), mulai closed testing 14 hari

**Status terukur 2026-08-25 (N10).** Empat item assetlinks di atas **sudah selesai**, dan
buktinya bukan ingatan: `curl -s https://hydromart-digital.com/.well-known/assetlinks.json`
menjawab 200 dengan **tiga** sidik jari per `package_name` untuk kedua paket, dan isinya
byte-identik dengan `apps/web/public/.well-known/assetlinks.json` di repo. Yang masih
berulang dari blok itu hanya `adb shell pm verify-app-links --re-verify` di **setiap**
perangkat penguji baru, karena Android menyimpan hasil verifikasinya per-perangkat, bukan
per-domain.

Urutan yang mengubah daftar di atas menjadi satu duduk kerja — beserta naskah yang
dipegang tiap penguji — ada di bagian 11.

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
`versionCode` **diturunkan** dari nomor run, bukan dari tag: `run_number * 100 +
run_attempt` (N7). Nomor run saja tidak cukup — ia **tidak naik saat Re-run**, dan Re-run
adalah respons paling wajar ketika publish gagal setelah bundle-nya sukses; rebuild itu
menghasilkan AAB dengan `versionCode` yang sudah pernah dilihat Play, dan Play menolaknya
tanpa jalan keluar selain tag baru.

## 9. Cara memperlambat rilis, dan cara menghentikannya (N8)

Sampai N8, rilis punya satu kecepatan — semua orang sekaligus — dan satu tuas berhenti,
yaitu gerbang versi. Sekarang workflow `mobile.yml` menerima tiga input, dan **default-nya
persis perilaku lama** (`internal` / `completed` / tanpa fraksi):

| Input | Arti |
| --- | --- |
| `track` | `internal`, `alpha`, `beta`, `production` |
| `rollout_status` | `completed` = semua sekaligus · `inProgress` = bertahap · `draft` · `halted` |
| `user_fraction` | porsi pengguna, mis. `0.1`. Hanya dipakai bila `rollout_status: inProgress` |

**Yang diukur, bukan diasumsikan:** track `internal` **mengabaikan** `userFraction` — Play
hanya melakukan rollout bertahap pada `production`, `beta`, dan `alpha`. Selama rilis masih
di internal testing, satu-satunya rem yang nyata adalah gerbang versi. Jadi urutan yang
benar untuk rilis pertama ke publik adalah: `production` + `inProgress` + `user_fraction:
0.1`, naikkan bertahap, dan **baru** `completed`.

### Menghentikan rilis yang sudah jalan

Tiga tuas, dari yang paling cepat:

1. **Halt rollout** — **di Play Console**, bukan dari workflow. Buka rilis pada track yang
   sama → **Halt rollout**. Menghentikan penyebaran ke pengguna baru; yang sudah menerima
   tetap memilikinya.

   **Dikoreksi 2026-08-25 (N10).** Baris ini dulu berbunyi "jalankan workflow dengan
   `rollout_status: halted`". Itu tidak bisa dilakukan, dan bukan karena salah tulis:
   ketiga input di tabel atas hanya dibaca di dalam job `publish`, dan `publish` — sama
   seperti `bundle` — dijaga `if: github.event_name == 'push'` (`mobile.yml:307` dan
   `mobile.yml:534`). Jadi sebuah `workflow_dispatch` hanya menjalankan job `testable`
   (dua APK debug) dan tidak pernah menyentuh Play sama sekali; sementara pada tag push
   `github.event.inputs.*` semuanya kosong, sehingga ekspresi di baris 562–575 selalu
   jatuh ke `internal` + `completed` + fraksi kosong. Ketiga tuas itu hari ini
   **dekorasi**, dan begitu juga `version_name` — pada tag push nama versinya datang dari
   `${GITHUB_REF_NAME#mobile-v}`. Selama itu belum diperbaiki, halt adalah pekerjaan
   tangan di konsol, dan itulah satu-satunya bentuk yang MTTR di bawah bisa menjanjikan.
2. **Gerbang versi (N5)** — `MOBILE_MIN_VERSION_CODE_BY_ID` di VPS, lalu restart gateway.
   Ini yang menghentikan build yang sudah TERPASANG, dan sejak N5 ia bisa diarahkan ke satu
   paket saja: menaikkan lantai aplikasi pelanggan tidak lagi mematikan kurir di tengah
   antar. Berlaku dalam hitungan menit, tanpa rebuild dan tanpa review.
3. **Rilis perbaikan** — tag baru, `versionCode` naik sendiri.

**MTTR yang dinyatakan** (sebelumnya tidak pernah dinyatakan sama sekali): halt ≤ 15 menit
sejak keputusan; gerbang versi ≤ 15 menit; rilis perbaikan ≤ 2 jam ke internal, dan
bergantung review Play untuk track publik. Angka-angka ini adalah janji operasional, bukan
pengukuran — yang pertama menguji salah satunya harus memperbaruinya dengan angka nyata.

## 10. Binari mana yang masih terpasang di lapangan (N9)

Aplikasi ini **tidak** membungkus web yang bergerak: `cap sync` menyalin ekspor statis beku
ke dalam APK, jadi deploy web tidak mengubah UI binari yang sudah terpasang. Risikonya
adalah skew API terhadap binari di lapangan — dan tidak ada satu pun catatan tentang versi
mana yang masih hidup. Lantai kompatibilitas adalah tebakan, dan menghapus endpoint adalah
tebakan di atas tebakan.

Sejak N9 setiap permintaan dari binari membawa `X-App-Id` dan `X-App-Version`, dan
`enableMetrics` menghitungnya sebagai `client_app_requests_total{app,version}` — bounded
oleh konstruksi (dua paket, satu label per build yang masih terpasang; peramban tidak
mengirim keduanya). Sebelum menghapus atau mengubah endpoint:

```promql
sum by (app, version) (increase(client_app_requests_total[7d]))
```

Versi terendah yang masih muncul di situ adalah lantai kompatibilitasnya. Kalau kosong,
jawabannya bukan "tidak ada yang terpasang" — jawabannya "belum ada binari yang mengirim
header ini", yaitu setiap build sebelum N9.

Setelah kedua app ada di Play, listing terisi, dan rilis pertama lolos review **dengan
tangan**, isi secret opsional `PLAY_SERVICE_ACCOUNT_JSON` (isi berkas kunci service account
apa adanya, sebagai teks). Sejak saat itu tiap tag `mobile-v*` naik sendiri ke **track
internal**. Tanpa secret itu langkahnya skip dengan notice dan run tetap hijau — jadi tidak
ada yang perlu dimatikan lebih dulu.

Track-nya `internal` dan tidak pernah `production`: internal testing terbit dalam hitungan
menit ke daftar nama tertentu, dan itu satu-satunya track yang tidak bisa menjangkau publik
karena kecelakaan. Menaikkannya ke closed testing dan seterusnya tetap keputusan yang
diambil orang di konsol.

## 11. Dari repo ke penguji, dalam satu duduk (N10)

Bagian 7 adalah daftar apa yang belum dikerjakan; bagian ini adalah **urutannya**, dengan
perintah dan nama layar konsol yang sebenarnya, supaya satu orang bisa menyelesaikannya
dalam satu duduk tanpa menebak langkah berikutnya. Semua angka di bawah diukur pada
2026-08-25, bukan dikira-kira, dan yang mengukurnya disebutkan supaya bisa diukur ulang.

### 11.1 Empat fakta yang menentukan urutannya

**Satu: `workflow_dispatch` tidak membangun AAB apa pun.** Job `bundle` dan `publish`
dua-duanya dijaga `if: github.event_name == 'push'` (`mobile.yml:307`, `mobile.yml:534`),
dan satu-satunya `push` yang memicu workflow ini adalah tag `mobile-v*`. Yang jalan dari
tombol **Run workflow** hanyalah job `testable` — dua APK **debug** untuk disideload, yang
memang gunanya (bagian 6 dan 7 benar soal itu). Jadi tidak ada jalan lain menuju sebuah AAB
selain sebuah tag. Empat input dispatch (`version_name`, `track`, `rollout_status`,
`user_fraction`) hanya dibaca di dalam dua job yang tidak pernah jalan pada dispatch, jadi
hari ini keempatnya dekorasi — lihat koreksi di bagian 9.

**Dua: unggahannya manual, dan itu keadaan yang benar.** `PLAY_SERVICE_ACCOUNT_JSON` belum
diisi, jadi step gerbang di job `publish` mencetak notice dan seluruh unggahan di-skip
sementara run tetap hijau. Yang lain sudah lengkap: keempat `ANDROID_*` dan
`GOOGLE_SERVICES_JSON_BASE64` terpasang sebagai secret, `MOBILE_API_URL`
(`https://api.hydromart-digital.com`) dan `MOBILE_WEB_HOST` (`hydromart-digital.com`)
terpasang sebagai **variables** — dua-duanya dicek dengan `gh variable list` dan
`gh secret list`, dan job `bundle` gagal keras kalau salah satu variable kosong
(`mobile.yml:344-351`).

**Tiga: tag terbaru tidak boleh diunggah.** `mobile-v1.4.0` = run **43 attempt 2**, jadi
`versionCode` **4302**, `versionName` 1.4.0; artefaknya `hydromart-aab-1.4.0` (11,6 MB, dua
AAB) masih ada, dibuat 2026-08-18 dan kedaluwarsa 2026-09-17. Tapi commit-nya
(`acaa6587`) **129 commit di belakang `origin/main`**. Aturan bagian 8 berlaku apa adanya:
buat tag baru. Ini bukan kehati-hatian teoretis — di antara kedua titik itu ada, antara
lain, perbaikan J1 (izin lokasi yang terus diminta padahal sudah diberikan) dan perbaikan
global-error yang membuat halaman apa pun menampilkan "Ada yang tidak beres".

**Empat: `versionCode` berikutnya sekitar 5801, dan itu bukan pilihan Anda.** Run terakhir
`mobile.yml` bernomor **57**, dan nomor run naik untuk **setiap** run workflow ini —
termasuk job `compile` di PR mana pun yang menyentuh `mobile/**`. Jadi tag berikutnya
kira-kira `58 * 100 + 1 = 5801`, jauh di atas 4302, dan angkanya tidak punya hubungan apa
pun dengan nama versi. Jangan pernah menuliskan `versionCode` yang diharapkan di catatan
rilis; bacalah dari log step **Version numbers** pada run yang bersangkutan.

### 11.2 Checklist pra-unggah, berurutan

Dijalankan dari atas ke bawah. Setiap langkah menyebut berkas, perintah, atau layar
konsolnya, dan setiap langkah punya satu jawaban yang benar — kalau jawabannya bukan itu,
berhenti di situ, karena langkah berikutnya akan berhasil tapi menghasilkan barang yang
salah.

| #   | Langkah                              | Perintah / layar                                                                                            | Yang harus terlihat                              |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | Tentukan commit-nya                  | `git fetch origin --tags --prune` lalu `git log --oneline -1 origin/main`                                    | SHA yang mau dirilis                             |
| 2   | CI hijau untuk SHA **itu**           | `gh run list --workflow=ci.yml --commit $(git rev-parse origin/main) --limit 1 --json status,conclusion,url` | `"status":"completed"` dan `"conclusion":"success"` |
| 3   | Uji gerbangnya lebih dulu            | `bash scripts/mobile-release-gate.sh $(git rev-parse origin/main) origin/main`                              | baris `release-gate: … — releasing`              |
| 4   | Konfigurasi build ada                | `gh variable list` dan `gh secret list`                                                                     | 2 variable + 5 secret dari 11.1                  |
| 5   | Data Safety terisi, dua form         | Play Console → **App content → Data safety**, isi dari bagian 1                                              | "Complete" di **kedua** aplikasi                 |
| 6   | Content rating, target audience      | Play Console → **App content**                                                                              | tidak ada task merah                             |
| 7   | URL hapus akun                       | Play Console → **App content → Data deletion**, nilai dari bagian 6                                          | `…/hapus-akun`                                   |
| 8   | Akses reviewer hidup                 | `.env` VPS: `REVIEWER_PHONE` + `REVIEWER_OTP_CODE`, lalu `docker compose up -d auth`                        | **Anda sendiri** bisa login dengan pasangan itu  |
| 9   | Listing + aset                       | Play Console → **Main store listing**, teks & berkas dari bagian 6                                           | judul, deskripsi, ≥2 screenshot per aplikasi     |
| 10  | assetlinks masih benar               | `curl -s https://hydromart-digital.com/.well-known/assetlinks.json`                                          | 3 sidik jari per `package_name`                  |
| 11  | Tag, lalu tunggu                     | `git tag mobile-v1.4.1 && git push origin mobile-v1.4.1` lalu `gh run watch`                                 | job `bundle` hijau (≈20–45 menit)                |
| 12  | Ambil AAB-nya                        | `gh run download <run-id> -n hydromart-aab-1.4.1`                                                            | `hydromart-customer.aab` + `hydromart-ops.aab`   |
| 13  | Tidak ada pustaka native menyelundup | `unzip -l hydromart-customer.aab` lalu cari akhiran `.so`                                                    | **kosong** — lihat "Halaman 16 KB" di bagian 2   |
| 14  | Catat `versionCode`-nya              | log run, step **Version numbers**                                                                            | angkanya, di catatan rilis Anda                  |
| 15  | Unggah                               | Play Console → **Testing → Internal testing → Create new release**                                           | dua rilis, satu per aplikasi                     |
| 16  | Catatan rilis                        | kolom **Release notes**, `id-ID`                                                                             | Bahasa Indonesia, apa yang berubah               |
| 17  | Terbitkan                            | **Save → Review release → Start rollout to Internal testing**                                                | status "Available to internal testers"           |

Langkah 2 dan 3 tampak duplikat dan bukan: langkah 3 menjalankan gerbang yang sama yang
akan menolak tag Anda, **sebelum** tag itu ada. Menemukan penolakannya di sini murah;
menemukannya setelah tag terkirim berarti tag itu harus dilewati atau dihapus, dan 11.6
menjelaskan kenapa keduanya berbiaya.

Langkah 8 bukan formalitas. Satu-satunya cara masuk ke aplikasi ini adalah OTP SMS
Indonesia, dan penguji internal pertama Anda mungkin sudah termasuk orang yang tidak
memegang nomor Indonesia.

### 11.3 12 penguji × 14 hari: mana kebijakan Play, mana pilihan kita

Dipisah karena mencampurnya berbahaya di dua arah — melanggar yang pertama menunda rilis
berminggu-minggu, sementara memperlakukan yang kedua sebagai hukum membuat orang menolak
keputusan yang sebenarnya boleh diubah.

**Kebijakan Play**, sudah dicatat repo ini di `MOBILE_APPS_PLAN.md` bagian
"⚠️ Akun pribadi: 12 penguji × 14 hari": akun Play yang dipakai adalah akun **pribadi**,
jadi sebelum boleh mengajukan akses produksi, akun harus menjalankan **closed testing
dengan minimal 12 penguji yang opt-in selama 14 hari berturut-turut**. Akun organisasi
dikecualikan; kita tidak. Catatan yang sama menyuruh **memverifikasi teksnya di Play
Console saat mendaftar**, khususnya apakah 14 hari itu diukur per-akun atau per-app dan
apakah penguji wajib tetap opt-in sepanjang periode — kebijakan ini pernah berubah dan
bisa berbeda per-wilayah. Jadi jangan mengutip angka dari dokumen ini ke pihak lain; kutip
layar konsolnya.

**Yang paling mudah salah, dan belum tertulis di mana pun sampai sekarang: internal
testing TIDAK dihitung.** Hitungan 12 × 14 melekat pada track **closed**. Internal testing
adalah track lain dengan gunanya sendiri — sampai 100 alamat email, terbit dalam hitungan
menit, tanpa antre review untuk tiap pembaruan — dan itulah yang dipakai bagian ini.
Menghabiskan empat belas hari di internal testing menghasilkan **nol** hari kredit.
Urutannya: internal dulu untuk membuktikan binary-nya hidup di tangan orang, **baru**
closed testing untuk memulai jamnya.

**Pilihan proyek ini, bukan aturan Play** — semuanya dari `MOBILE_APPS_PLAN.md`, dan
semuanya boleh ditinjau ulang: merekrut **15–20** orang bukan 12, karena 12 adalah lantai
dan satu orang yang mencopot opt-in di hari ke-9 bisa membatalkan hitungan; menjalankan
closed testing pada **aplikasi pelanggan**, bukan Ops, karena Ops seluruhnya di balik login
staf; mengelola roster sebagai **daftar email di Play Console** alih-alih Google Group,
karena Group menambah satu setelan izin yang kalau salah membuat penguji melihat "item not
available".

**Cara menambahkan penguji.** Play Console → **Test and release → Testing → Internal
testing** → tab **Testers** → **Create email list** → tempel alamatnya → **Save** →
**Save changes** pada rilisnya. Lalu **Copy link** pada URL opt-in dan kirimkan. Tiap
penguji harus membuka URL itu **dengan akun Google yang sama** dengan yang ada di daftar,
menerima undangan, lalu memasang dari Play. Aplikasi Ops punya daftarnya sendiri; jangan
pakai satu daftar untuk dua aplikasi, karena penguji pelanggan tidak punya alasan memegang
aplikasi staf — dan bagian 4 sudah menjelaskan apa yang dilihat orang yang membukanya.

**Bukti yang Google minta: tidak ada yang Anda unggah.** Play menghitungnya sendiri dari
catatan opt-in track closed dan menampilkan hitungannya di layar **Apply for production**
(berapa penguji, berapa hari). Jadi satu-satunya "pekerjaan bukti" adalah menjaga orang
tetap opt-in, dan satu-satunya angka yang benar adalah angka di layar itu — kalau ia tidak
setuju dengan daftar Anda, **layar itu yang benar**. Konsekuensi praktisnya dua: minta
penguji jangan menghapus aplikasinya sampai Anda bilang selesai, dan jangan pernah
menjanjikan tanggal rilis produksi berdasarkan hitungan sendiri.

Roster pengujinya adalah alamat Google orang sungguhan. Ia **tidak ada di repo ini** dan
tidak boleh ditaruh di sini — `docs/play-assets/` untuk aset listing, bukan untuk daftar
orang. Tempatnya Play Console.

### 11.4 Naskah uji per penguji

Diturunkan dari layar yang benar-benar ada di masing-masing binary, karena checklist yang
menyebut layar yang tidak dibawa binary itu lebih buruk daripada tidak ada checklist: ia
melaporkan bug yang tidak ada dan melatih orang mengabaikan sisanya. Sumbernya `TARGETS`
dan `SURFACES` di [`apps/web/scripts/build-mobile.mjs`](../apps/web/scripts/build-mobile.mjs)
— yang pertama menyebut apa yang dibuang, yang kedua menyebut apa yang hasil ekspornya
wajib dan wajib-tidak punya, dan keduanya menggagalkan build kalau tidak cocok.

Satu hal berlaku untuk keduanya: **tidak ada laporan crash yang sampai ke kita.**
`SENTRY_DSN_MOBILE` tidak diisi sebagai variable, jadi ekspor yang masuk binary tidak
membawa DSN dan tidak punya reporter sama sekali (komentar N2 di `mobile.yml:234`). Yang
tersisa adalah Play Vitals — ANR dan crash, gratis, terlambat berjam-jam — dan cerita
penguji. Karena itu kolom "apa yang terjadi" di bawah bukan formalitas: ia satu-satunya
telemetri yang ada.

#### App 1 — Hydromart (`id.hydromart.app`)

Membawa dua puluh rute tingkat atas ditambah beranda, dan tidak satu pun konsol —
`src/app` punya 27 folder, enam di antaranya dibuang oleh `TARGETS.customer` dan satu
(`fonts`) bukan rute. Yang **tidak ada di binary ini**,
dan karena itu tidak boleh dilaporkan sebagai hilang: `/hq`, `/hr`, `/dashboard`,
`/driver`, `/m`, `/resellers`.

| #   | Alur              | Layar yang dilewati                                                                                                                       | Yang membuatnya gagal                                                                            |
| --- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | Masuk             | `/login` → `/verify` → beranda `/`                                                                                                        | keyboard menutupi kolom OTP; kode tidak pernah datang                                            |
| 2   | Belanja           | tab **Belanja** `/products` → cari di app bar → `/products/detail` → tambah → `/cart`                                                     | harga berbeda dari yang di kartu; keranjang lupa isinya setelah app ditutup                       |
| 3   | Checkout          | `/cart` → `/checkout` (alamat + **patokan** + catatan) → buat pesanan                                                                     | ongkos ekspres salah; catatan tidak sampai ke kurir                                              |
| 4   | Lacak dan ulas    | tab **Pesanan** `/orders` → `/orders/detail` → setelah selesai `/orders/detail/review`                                                    | status tidak pernah berubah; tombol ulas tidak muncul                                            |
| 5   | Alamat dan lokasi | `/addresses` → tambah alamat, beri izin **"Kira-kira saja"** → depot terdekat muncul; lalu **tolak** izinnya dan ketik alamat manual      | app tetap meminta izin padahal sudah diberikan (J1); menolak izin membuat alamat tidak bisa disimpan |
| 6   | Poin dan promo    | `/rewards` (bertab) → `/vouchers` → `/promo` → `/referral` → `/subscriptions`                                                             | poin tidak bertambah; voucher tidak bisa dipakai di checkout                                     |
| 7   | Akun              | tab **Akun** `/account` → `/account/edit` (foto lewat **kamera**) → tema → bahasa → notifikasi → ekspor data → `/hapus-akun`               | kamera tidak terbuka, atau membuka galeri; tema tidak bertahan setelah app dimatikan              |
| 8   | Notifikasi & push | `/notifications`; lalu **matikan app sepenuhnya**, minta depot mengubah status pesanan, ketuk notifikasinya                                | notifikasi tidak datang; ketukan membuka beranda, bukan pesanannya                               |
| 9   | Tautan dalam      | kirim `https://hydromart-digital.com/orders` ke diri sendiri lewat WhatsApp, lalu ketuk                                                   | terbuka di browser, bukan di app                                                                 |
| 10  | Sisanya           | `/favorites`, `/help`, `/waralaba`                                                                                                        | halaman kosong; tombol back menutup app alih-alih kembali                                        |

Tautan dalam yang diklaim binary ini persis dua puluh: `/products`, `/orders`, `/cart`,
`/checkout`, `/account`, `/promo`, `/rewards`, `/vouchers`, `/referral`, `/subscriptions`,
`/waralaba`, `/help`, `/notifications`, `/addresses`, `/favorites`, `/login`, `/register`,
`/kebijakan-privasi`, `/hapus-akun`, dan `/` persis (`mobile.yml:438-457`). Tautan di luar
daftar itu memang membuka browser.

#### App 2 — Hydromart Ops (`id.hydromart.ops`)

Membawa `/driver`, `/m/manager`, `/hr/me`, seluruh `/dashboard`, `/resellers` — **dan juga
seluruh toko pelanggan**, karena binary ini hanya membuang `/hq` dan konsol HR. Yang
**tidak ada di dalamnya**: `/hq` seutuhnya, dan konsol HR selain `/hr/me` (jadi
`/hr/payroll` dan `/hr/employees` tidak ada).

Layar pertama ditentukan jabatan, oleh `consoleHome()` di
[`apps/web/src/lib/roles.ts`](../apps/web/src/lib/roles.ts): kurir → `/driver`; manajer di
perangkat native → `/m/manager`; jabatan berkonsol lain → `/dashboard`; jabatan kantor
pusat → `/hq` tidak ada di binary ini sehingga jatuh ke `/dashboard`, lalu `/hr/me`.
**Mendarat bukan di layar yang Anda duga adalah temuan yang layak dilaporkan** — dan
sekaligus satu-satunya cara membuktikan jalur fallback itu di lapangan.

| Peran         | Alur yang harus dijalani                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kurir         | `/driver/shift/check-in` → tab **Tugas** `/driver` → `/driver/deliveries/detail` → foto PoD → **matikan jaringan** → `…/success` → nyalakan jaringan, banner antrean offline harus hilang sendiri → coba juga `…/fail`, `…/no-show`, `…/reschedule`, `…/returns`, `…/pay` → `/driver/settlement` → tab **Dompet** `/driver/earnings`, `/driver/expenses` → `/driver/history`, `/driver/route`, `/driver/goal`, `/driver/performance`, `/driver/incidents/new`, `/driver/announcements`, `/driver/settings`, tab **Profil** `/driver/profile` |
| Kepala depot  | `/dashboard/shift` buka shift → `/dashboard/walk-in` jual lalu **cetak struk** → `/dashboard/cashbook` → `/dashboard/orders` → `/dashboard/tracking` → `/dashboard/settlements` dan `/dashboard/payment-recon` → `/dashboard/inventory`, `/dashboard/wastage`, `/dashboard/returns`, `/dashboard/meter` → tutup shift                                                                                                                             |
| Manajer / SPV | `/m/manager` → `/m/manager/approvals` → `/m/manager/approvals/detail` → `/m/manager/pricing` → `/m/manager/team` → `/m/manager/notifications` → `/m/manager/account`                                                                                                                                                                                                                                                                            |
| Semua staf    | `/hr/me` → `/hr/me/enroll` → `/hr/me/check-in` (absen **wajah**) → `/hr/me/attendance` → `/hr/me/payroll` → `/hr/me/payroll/detail` → `/hr/me/leave` → `/hr/me/announcements`                                                                                                                                                                                                                                                                   |

Binary ini hanya mengklaim **dua** prefiks tautan dalam, `/driver` dan `/m`
(`mobile.yml:486-487`). Tautan ke `/dashboard/…` **memang** membuka browser; itu bukan bug
dan jangan dilaporkan sebagai bug.

#### Yang dilaporkan penguji, dan tiga hal yang hanya mereka bisa buktikan

Untuk setiap temuan: **merek dan tipe ponsel**, **versi Android**, **versi Android System
WebView** (Setelan → Aplikasi → Android System WebView), nama layar atau URL-nya, apa yang
dilakukan, apa yang terjadi, dan satu tangkapan layar. Versi WebView ada di daftar karena
beberapa cacat di proyek ini hanya muncul di bawah WebView 140 — `env()` yang melaporkan 0
dan menaruh bottom-nav tepat di atas tombol gestur adalah salah satunya — dan tidak ada
image emulator di tangan kami yang bisa menirunya.

Tiga item checklist perangkat di `MOBILE_APPS_PLAN.md` masih **belum pernah terbukti**, dan
ketiganya mustahil dibuktikan dari sini. Armada penguji justru untuk ini:

- **item 3** — Tailwind v4 di ponsel target sungguhan, termasuk satu unit Android 8/9
  ber-WebView lama. Tidak ada image emulator stok yang cukup tua.
- **item 7** — push FCM saat app di **background** dan saat app **dimatikan**, lalu deep
  link membuka halaman yang benar. Butuh perangkat, akun Play, dan proyek Firebase yang
  sama dengan binary-nya.
- **item 11** — biometrik: daftar → app dimatikan → buka ulang → sidik jari membuka sesi
  tanpa OTP; lalu gagal N kali → token terhapus → OTP dipaksa; lalu perangkat **tanpa**
  biometrik terdaftar tetap bisa masuk lewat OTP.

Satu uji lagi yang hanya mungkin setelah ada binary terpasang, dan yang paling mahal kalau
disesali: **gerbang versi**. Naikkan `MOBILE_MIN_VERSION_CODE_BY_ID` untuk **satu** paket
saja di `.env` VPS, restart gateway, buka aplikasi itu — harus muncul layar
"Versi aplikasi sudah usang" (`native-bridge.tsx`) — lalu buka binary yang **lain** dan
pastikan ia masih jalan normal. Itu membuktikan dua hal sekaligus: tuas berhentinya nyata,
dan ia bisa diarahkan ke satu paket (N5). Kembalikan nilainya setelah selesai. Gerbang ini
sengaja **fail-open**, jadi kalau tidak terjadi apa-apa, kecurigaan pertama adalah gateway
tidak terbaca — bukan bahwa penguji salah langkah.

### 11.5 Bagaimana repo memberi tahu bahwa sebuah rilis boleh diunggah

Satu berkas menjawabnya: [`scripts/mobile-release-gate.sh`](../scripts/mobile-release-gate.sh),
dijalankan sebagai step pertama job `bundle` (`mobile.yml:324-329`). Ia menegakkan **dua**
syarat, dan tidak lebih:

1. **Commit-nya ada di `main`.** `git merge-base --is-ancestor <sha> <branch>` — bukan "ada
   commit dengan pesan yang sama di main", bukan "bisa dijangkau dari suatu ref". Workflow
   melakukan `git fetch --no-tags origin main:refs/remotes/origin/main` lebih dulu, karena
   checkout dangkal membawa satu commit dan setiap pertanyaan leluhur di atasnya adalah
   dusta. Penolakannya:
   `!! <sha> is not an ancestor of <branch> — release tags are cut from <branch> only`.
2. **Seluruh CI sudah hijau untuk SHA itu persis.**
   `gh run list --workflow=ci.yml --commit <sha> --limit 1`, dan hanya `success` yang lolos.
   Bukan sebagian gerbang yang dijiplak ke sini — jiplakan akan melenceng dan tetap tidak
   lengkap; yang diminta adalah `ci.yml` yang sesungguhnya atas commit yang sesungguhnya.

Dua rincian di dalamnya persis yang menyelamatkan Anda dari salah paham:

- **Kosong dibaca sebagai penolakan, bukan persetujuan.** `--jq '.[0].conclusion // empty'`
  tidak mencetak apa pun bila belum ada run, dan skrip menjawab
  `!! no CI run recorded for <sha> — nothing has tested this commit`. Inilah **jebakan tag
  mendahului CI**: dorong tag beberapa detik setelah merge, CI-nya masih berjalan,
  `conclusion` masih kosong, dan rilisnya ditolak dengan kalimat yang terdengar seperti
  "commit ini tidak pernah diuji". Perbaikannya adalah menunggu — langkah 2 di 11.2. Ini
  bukan hipotesis: dijalankan atas `origin/main` pada 2026-08-25 12:50 UTC, gerbangnya
  menjawab `!! no CI run recorded for f1d09796… — nothing has tested this commit`,
  sementara `gh run list --workflow=ci.yml --commit f1d09796…` pada detik yang sama
  memperlihatkan satu run dengan `"status":"in_progress"` dan `"conclusion":""`. Commit-nya
  sehat; yang belum ada hanyalah jawabannya.
- **SHA singkat dinormalkan lebih dulu.** `gh run list --commit` hanya cocok dengan 40
  karakter penuh; SHA singkat mengembalikan daftar kosong, yang tanpa normalisasi terbaca
  sebagai "tidak pernah diuji". Skripnya memanggil `git rev-parse --verify` dulu supaya
  orang yang menjalankannya dengan tangan tidak diberi tahu bahwa commit bagusnya belum
  diuji — gerbang yang berdusta adalah gerbang yang dimatikan orang.

Gerbang ini bisa merah, dan itu dibuktikan bukan dijanjikan:
[`scripts/mobile-release-gate.test.sh`](../scripts/mobile-release-gate.test.sh) menyuntikkan
`CI_CONCLUSION_CMD` sebagai stub, jadi kedua syarat bisa dijatuhkan tanpa jaringan.

```bash
bash scripts/mobile-release-gate.test.sh
```

Yang gerbang ini **tidak** periksa, jadi tetap tugas Anda: apakah tag-nya lebih baru dari
`main` — commit boleh jadi leluhur `main` dan tetap 129 commit basi, persis kasus
`mobile-v1.4.0` di 11.1 — apakah listing dan Data Safety terisi, dan apakah nomor versinya
masuk akal untuk manusia.

### 11.6 Kalau seseorang me-run ulang sebuah tag

`versionCode = run_number * 100 + run_attempt`. Perkalian 100 itu memang ada supaya re-run
**bisa** dilakukan: `run_number` tidak bergerak saat **Re-run**, hanya `run_attempt` yang
bergerak, jadi tanpa perkalian itu rebuild menghasilkan AAB dengan `versionCode` yang sudah
pernah dilihat Play, dan Play menolaknya tanpa jalan keluar selain tag baru (N7). Skemanya
jalan; run 42 dan run 43 dua-duanya baru hijau di **attempt 2**, dan itu bukan kebetulan —
re-run adalah reaksi paling wajar terhadap job yang gagal di tengah.

Yang tetap rusak, dan tidak diselesaikan oleh perkalian itu:

- **Nama versi berhenti menunjuk satu binary.** Attempt 1 dan attempt 2 dari tag yang sama
  dua-duanya bernama `1.4.0`, tapi `versionCode`-nya 4301 dan 4302 dan bytenya berbeda.
  Kalau 4301 sempat diuji di ponsel atau diunggah, lalu yang naik kemudian 4302, yang Anda
  uji bukan yang dipegang penguji — dan tidak ada apa pun di listing Play yang
  memperlihatkan bedanya. Karena itu langkah 14 di 11.2 mencatat `versionCode`, bukan nama
  versinya.
- **Nama artefaknya tidak memuat attempt.** Ia `hydromart-aab-<versi>`, jadi kalau attempt
  pertama sudah sampai ke step **Upload the bundles** sebelum gagal, unggahan attempt kedua
  memakai nama yang sudah ada di run yang sama. Periksa log step itu alih-alih menganggap
  artefak yang Anda unduh berasal dari attempt terakhir.
- **Gerbang di 11.5 dijalankan ulang juga.** Kalau di antara dua attempt itu `main` ditulis
  ulang, atau CI untuk commit itu di-run ulang dan jadi merah, attempt kedua **gagal** di
  tempat attempt pertama lolos. Itu disengaja, bukan flake.
- **`run_attempt` di atas 99 gagal keras**, dengan kalimatnya sendiri:
  `run_attempt N exceeds the 99 this scheme reserves; tag a new release instead`
  (`mobile.yml:393`). Skema ini menyisakan 99 attempt per run dan tidak berpura-pura punya
  lebih.

**Yang dilakukan sebagai gantinya: buat tag baru.** `mobile-v1.4.1` alih-alih me-run ulang
`mobile-v1.4.0`. Biayanya satu tag dan dua puluh sampai empat puluh lima menit build, dan
imbalannya satu nama versi yang menunjuk tepat satu binary — selamanya, di log Play, di
catatan penguji, dan di `client_app_requests_total{app,version}` di bagian 10.

Dan satu larangan yang tidak punya pengecualian: **jangan pernah menghapus lalu mendorong
ulang nama tag yang pernah menghasilkan AAB yang diunggah.** `versionCode`-nya akan tetap
naik, jadi Play menerimanya tanpa protes — dan sejak saat itu satu nama versi berarti dua
binary yang berbeda, yang persis kegagalan yang sudah dicatat bagian 8 dua kali.
