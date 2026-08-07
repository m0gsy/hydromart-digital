# Hydromart Mobile — dua aplikasi Android ke Google Play

## Context

Hydromart hari ini adalah **satu** aplikasi Next.js 15.5 (`output: 'standalone'`) yang
berjalan sebagai server Node di VPS di belakang Caddy, plus 17 microservice NestJS di
belakang satu gateway. Tidak ada satu pun jejak mobile di repo — nol `capacitor.config`,
nol `android/`, nol manifest PWA, dan `apps/web/public/` isinya cuma `.gitkeep` + `sw.js`.

Tujuannya: dua binary Android di Google Play, membungkus web app yang **sama** lewat
Capacitor, dengan aset **di-bundle ke dalam APK** (bukan wrapper yang menunjuk URL live).
Kurir bekerja di area sinyal jelek dan `apps/web/src/lib/offline-queue.ts` sudah ada
persis karena itu — wrapper URL mati total tanpa jaringan, bahkan shell-nya tidak bisa
dimuat.

### Keputusan yang sudah dikunci

| Topik                | Keputusan                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Platform rilis 1     | **Android saja.** Kode ditulis lintas-platform supaya iOS tinggal `npx cap add ios` nanti                      |
| Rute dinamis         | **Diubah semua ke query-param, web ikut berubah**                                                              |
| Fitur native rilis 1 | Push FCM, gerbang versi minimum, deep link (App Links), login biometrik                                        |
| Update               | **Play Store saja, tanpa OTA** — API wajib backward-compatible dan gerbang versi wajib ada sejak rilis pertama |

---

## Siapa bisa apa di dalam app

**Aturan pokok: app tidak menciptakan izin baru.** `CAPABILITIES` di
[packages/access/src/index.ts](packages/access/src/index.ts) tetap satu-satunya sumber
kebenaran — dibaca oleh guard NestJS _dan_ oleh konsol web, jadi app mewarisi matriks yang
sama persis. Yang berubah hanya pembungkusnya.

### App 1 — **Hydromart** (`id.hydromart.app`) · role `CUSTOMER`

24 halaman pelanggan. Yang bisa dilakukan:

- **Belanja**: jelajah katalog + detail produk, favorit, keranjang, checkout, langganan
  berulang.
- **Pesanan**: riwayat, lacak pesanan berjalan, ulangi pesanan, batalkan, beri ulasan.
- **Alamat**: buku alamat + patokan (landmark) yang sampai ke kurir.
- **Loyalti & promo**: poin, tier, katalog hadiah, voucher, promo, kode referral.
- **Akun**: profil, unggah foto, tema/bahasa, notifikasi, bantuan, kebijakan privasi,
  ekspor & hapus data (UU PDP), pendaftaran waralaba.
- **Native**: push FCM pesanan, kamera untuk foto profil, deep link dari notifikasi.

### App 2 — **Hydromart Ops** (`id.hydromart.ops`)

Satu binary, empat pengalaman berbeda — layar pertama ditentukan role saat login, memakai
`isConsolePath()` + role-landing yang sudah ada.

**`STAFF_DEPOT` — kurir.** 6 capability: `orderQueue`, `meterWrite`, `meterRead`,
`paymentSettle`, `courierPayout`, `courierReturn`. Surface `/driver/*` (24 halaman):

- Rute hari ini, daftar antaran, detail antaran, navigasi ke alamat + patokan.
- **Bukti kirim**: foto PoD lewat kamera, tanda tangan, catatan gagal-kirim, pelanggan
  tidak di tempat, jadwal ulang.
- Terima pembayaran tunai/QRIS di tempat, galon kembali (retur), klaim biaya.
- Shift: check-in/check-out, status, riwayat, target & performa, pendapatan, setoran.
- Insiden, pengumuman depot, bantuan, profil.
- **Ini pengguna yang paling butuh offline** — antrean IndexedDB yang sudah ada menampung
  punch, check-in shift, dan foto PoD sampai sinyal kembali.

**`KEPALA_DEPOT` — kepala depot.** 26 capability. Surface `/dashboard/*`, konsol operasi
depot penuh:

- **Kasir/POS**: `walkInSale` + `cashierShift` — penjualan konter, buka/tutup shift kasir,
  serah terima, buku kas, cetak struk.
- **Pesanan**: antrean pesanan, pelacakan kurir, penugasan roster kurir.
- **Stok**: baca _dan_ tulis inventori, susut (wastage), retur, meteran air.
- **Uang**: selesaikan pembayaran, setoran kurir, tutup harian (`dailyClose`).
- **Depot**: insiden, pemeliharaan, huddle harian, siaran depot, CRM pelanggan depot,
  serah terima hadiah, sengketa, log audit, ramalan permintaan.
- Tidak punya: harga global, staf, waralaba, keuangan lintas depot.

**`ASSISTANT_SUPERVISOR` — asisten SPV.** 10 capability, **semuanya baca**: `dashboard`,
`orderQueue`, `inventoryRead`, `meterRead`, `returnsRead`, `tracking`, `forecast`,
`depotCrm`, `auditRead`, `hrView`.

- Melihat **banyak depot** sekaligus (cakupan depot diselesaikan server), tapi tidak
  menulis apa pun: nol kasir, nol uang, nol persetujuan. Ini disengaja dan tertulis di
  komentar `packages/access/src/index.ts:35-37`.
- Di ponsel ini justru pas: dashboard ringkasan, antrean pesanan, posisi kurir, stok,
  ramalan — pengawasan sambil jalan.
- Catatan yang sempat membingungkan saat audit: `canUseOperatorConsole()` hanya bernilai
  benar untuk KEPALA_DEPOT, jadi sekilas tampak SPV tidak punya pintu. Itu keliru —
  [dashboard/layout.tsx:11-18](apps/web/src/app/dashboard/layout.tsx#L11-L18) memakainya
  untuk memilih **bentuk shell**, bukan akses: KEPALA_DEPOT dapat konsol top-tab, "setiap
  role staf lain" tetap dapat rail kiri di bawah `/dashboard/*` yang sama.

**`SUPERVISOR` — supervisor.** 16 capability: semua milik asisten SPV, **plus** `opsNotif`,
`resellerView`, `incidents`, `depotFinance`, `depotTargets`, `depotDisputes`.

- Tambahannya: keuangan depot, target, sengketa, insiden, daftar reseller/agen, notifikasi
  operasi. Masih tanpa kasir, tanpa tulis stok, tanpa persetujuan.

**`MANAGER` — manajer.** 45 capability. Surface `/m/manager/*` — konsol mobile 8 halaman
yang memang **dibangun khusus untuk ponsel**, bukan konsol desktop yang diperkecil:

- Beranda ringkasan, **antrean persetujuan** + detail keputusan (`approvals`), harga
  (`pricing`), tim (`team`), notifikasi, akun.
- Manajer juga memegang `/dashboard/*` penuh kalau dibuka, tapi `/m/manager` adalah layar
  pendaratannya di app.

**`/hr/me/*` — 7 halaman, dipakai SEMUA empat role ops.** Ini nyaris terlewat dari rencana.
`canPunchAttendance()` di [roles.ts:150-155](apps/web/src/lib/roles.ts#L150-L155) memberi
pintu ke STAFF_DEPOT, KEPALA_DEPOT, ASSISTANT_SUPERVISOR **dan** SUPERVISOR: absen wajah
(`check-in`), enroll wajah, riwayat absen saya, slip gaji saya, cuti saya, pengumuman.

Ini justru fitur **paling native** di seluruh proyek — kamera untuk absen wajah, dan
`offline-queue.ts` sudah punya jenis pekerjaan `'hrPunch'` yang dibangun persis untuk ini.
Mengeluarkannya berarti app Ops tidak bisa absen, padahal itu hal pertama yang dilakukan
setiap orang setiap pagi. **Masuk rilis 1.**

**Yang TIDAK masuk rilis 1:** `/hq/*` (63 halaman) dan sisa `/hr/*` (29 halaman konsol
admin HR) — keduanya konsol desktop-first untuk HEAD_OFFICE, DIREKTUR, FINANCE, HR,
MARKETING, SUPER_ADMIN. Setelah Fase 1c, berkasnya **tidak ikut ter-export** ke binary
mana pun; folder rutenya dipangkas sebelum build.

---

## Sembilan temuan yang membentuk rencana ini

Semua diverifikasi terhadap kode saat ini.

**1. Auth cookie MATI di WebView — dan senyap.**
[session-bff.ts:41-54](services/gateway-service/src/routing/session-bff.ts#L41-L54) menyetel
`hm_at`/`hm_rt` dengan `sameSite: 'lax'`. Origin WebView Capacitor adalah
`https://localhost`, jadi permintaan ke `https://api.<domain>` bersifat **cross-site** dan
cookie `lax` tidak terkirim sama sekali. Login tampak berhasil, lalu semua 401.

Jalan keluarnya sudah ada:
[gateway.setup.ts:90-93](services/gateway-service/src/gateway.setup.ts#L90-L93) menulis
`if (!req.headers.authorization)` — header `Authorization` eksplisit **dibiarkan utuh dan
menang**, dan [jwt-auth.guard.ts:86-93](packages/platform/src/nest/jwt-auth.guard.ts#L86-L93)
memang hanya membaca header. Jadi jalur bearer sudah hidup untuk semua rute terproksi;
yang tertutup hanya 3 endpoint siklus-sesi di BFF.

**2. Web Push mati di Android WebView** (tidak ada `PushManager`), jadi
[push.ts:9-16](apps/web/src/lib/push.ts#L9-L16) mengembalikan `false` dan push diam-diam
tidak aktif. FCM harus dibangun.

**3. `output: 'export'` hanya terhalang dua hal.** Nol `middleware.ts`, nol `route.ts`,
nol `'use server'`, nol `generateStaticParams`; 315 dari 400 berkas sudah `'use client'`.
Penghalangnya: 21 berkas halaman di bawah 14 segmen dinamis, dan `headers()` di
[next.config.mjs:29-41](apps/web/next.config.mjs#L29-L41).

**4. Tidak ada ikon sama sekali.** `sw.js:16-17` menunjuk `/icon-192.png` yang tidak ada —
bug notifikasi web yang sudah hidup hari ini.

**5. `viewportFit: 'cover'` tidak ada** di
[layout.tsx:23-27](apps/web/src/app/layout.tsx#L23-L27), padahal 7 tempat memakai
`env(safe-area-inset-bottom)` — inset itu **sekarang pun** resolve ke 0.

**6. POS mati di WebView.** [receipt.ts:73,76](apps/web/src/lib/receipt.ts#L73-L76) memakai
`window.open` + `window.print()`; keduanya tidak didukung Android WebView. Untungnya
`printReceipt` sudah mengembalikan boolean dan pemanggilnya sudah menangani kegagalan.

**7. Unduhan berkas punya satu titik sempit**, [downloadBlob() di csv.ts:116](apps/web/src/lib/csv.ts#L116) —
tapi 4 tempat membuat object URL sendiri dan melewatinya, termasuk
`account/page.tsx:380` (ekspor data UU PDP, **masuk cakupan pelanggan**).

**8. 9 `target="_blank"` + `tel:` + `wa.me` + `maps.google.com`** gagal senyap atau
membajak WebView; yang paling sakit di jalur kurir `driver/deliveries/[id]/page.tsx:81,91,253`.

**9. Tidak ada endpoint versi.** Versi app adalah konstanta hardcoded di
[account/page.tsx:55](apps/web/src/app/account/page.tsx#L55). Tanpa OTA, gerbang versi
adalah satu-satunya cara memaksa klien rusak untuk update.

---

## Enam jebakan yang ditemukan review desain — dan koreksinya

**J1 — Header `X-Client: native` adalah lubang keamanan; pakai `Origin`.**
Rancangan awal saya menyalakan mode bearer lewat header yang bisa diset klien. XSS di web
bisa memanggil `token/refresh` dengan `credentials:'include'` + header itu; browser
melampirkan cookie `hm_rt`, gateway mengira native, dan **mengembalikan refresh token
30 hari ke dalam body yang bisa dibaca XSS** — persis serangan yang SEC-4 dibangun untuk
mencegah. Gerbangnya harus `Origin` (browser tidak bisa memalsukannya):

```ts
const NATIVE_ORIGINS = new Set(['https://localhost', 'capacitor://localhost']);
const isNative = (req: Request) => NATIVE_ORIGINS.has(req.headers.origin ?? '');
```

Konsekuensi yang harus diterima sadar: `https://localhost` adalah origin **setiap** app
Capacitor di perangkat itu. Justru itu sebabnya bearer benar dan cookie salah — cookie
tidak boleh pernah dinyalakan lagi untuk origin itu.

**J2 — `trailingSlash: true` wajib.** Tanpa itu export menghasilkan `out/products.html`,
sedangkan penyaji lokal Capacitor mencari `products/index.html` → 404 → layar putih di
setiap hard-load dan setiap deep link. _Diverifikasi di perangkat pada hari pertama._

**J3 — Suspense di root layout adalah jawaban yang salah.** Itu memenuhi syarat build,
tapi membuat 226 berkas HTML ter-export dirender sebagai fallback — membuang shell statis
seluruh app demi memperbaiki satu berkas. Repo ini sudah memecahkannya sendiri di
[hq/depots/page.tsx:29](apps/web/src/app/hq/depots/page.tsx#L29) (`window.location`
menghindari syarat Suspense saat generasi statis). Pakai ulang pola itu sebagai satu hook
`useRouteId()` → **nol batas Suspense baru** untuk 21 halaman.

**J4 — Tailwind v4 menuntut Chrome 111+ (Maret 2023).** `@theme` di `globals.css`
dikompilasi jadi `@property` + `oklch()` + cascade layer. Versi WebView **tidak** terikat
level SDK Android dan bisa dibekukan pengguna. Di ponsel murah dengan WebView lama seluruh
tema runtuh. Butuh gerbang boot ±15 baris (`CSS.supports('color','color-mix(in srgb, red, blue)')`)
→ "Perbarui Android System WebView". **Ini tidak bisa diperbaiki setelah rilis.**

**J5 — Rate limit dikunci per-NAT, bukan per-pengguna.**
[gateway.setup.ts:36-56](services/gateway-service/src/gateway.setup.ts#L36-L56) memakai
`req.ip` dengan `trust proxy = 1`. Delapan kurir di balik satu router 4G berbagi satu
penghitung, dan antrean offline membanjir serempak saat sinyal kembali. `keyGenerator`
berbasis hash header `Authorization` (±5 baris) memperbaikinya — dan memperbaiki web juga.

**J6 — Reviewer Play tidak bisa menerima OTP.** Login hanya OTP telepon. Ini penyebab
penolakan yang sangat umum. Butuh nomor reviewer yang di-seed dengan OTP tetap (dijaga
env) atau video demo.

Koreksi kecil lain yang sudah masuk rencana: `next/font/google` **aman** di export
(diunduh saat build, di-self-host); `images.unoptimized` **tidak perlu** (nol `next/image`
di repo); ambil `@capacitor/geolocation` (`geo.ts` sudah satu titik sempit, dan izin
runtime tanpa plugin cuma ~75% pasti); `getUserMedia` untuk foto PoD dan face check-in
**tetap tanpa plugin** tapi wajib diuji di perangkat nyata minggu pertama karena
`@capacitor/camera` bukan pengganti setara (face-capture butuh _stream_ hidup, bukan
jepretan).

---

## Arsitektur

**Auth**: bearer untuk native (digerbangi `Origin`), cookie tetap utuh untuk web. Rotasi +
deteksi reuse keluarga di `session.service.ts` tidak disentuh — transportnya saja yang
beda. Sisi klien butuh `token-store` yang sinkron di memori + persist async ke Keystore,
dihidrasi saat boot sebelum permintaan pertama, dan **persist harus selesai sebelum
`refreshSession()` resolve** — kalau app mati di antaranya, token lama diputar ulang dan
deteksi reuse mencabut seluruh keluarga, memaksa pengguna OTP ulang.

**Rute**: 21 halaman dinamis → query-param, **43 tempat link di 32 berkas** ikut berubah.
Entri di `apps/web/src/lib/endpoints/*.ts` adalah URL **API**, bukan rute Next — tidak
berubah. Nol SEO hilang: semua halaman sudah `'use client'`, jadi nol metadata per-halaman
hari ini.

**Repo**: `mobile/` di **root**, bukan `apps/mobile`. Ini bukan selera —
[deploy-common.sh:90-95](scripts/lib/deploy-common.sh#L90-L95) memetakan `apps/*/*` ke nama
service Docker, sehingga `apps/mobile/` membuat `scripts/deploy.sh` mencoba membangun
kontainer `mobile` yang tidak pernah ada, lalu `rollback.sh` menyala. `mobile/` di root
tidak cocok pola mana pun, jadi lewat begitu saja — dan `ci-affected.sh` mengembalikan
`false` untuk perubahan yang cuma menyentuh Android. Ia juga punya lockfile sendiri dan
**tidak** masuk array `workspaces` root, supaya menambah dependensi Capacitor tidak memicu
`needs_full_rebuild` dan membangun ulang 20 image Docker. Dua binary dari satu `mobile/`
lewat dua **product flavor** Gradle, bukan dua salinan folder `android/`.

---

## Fase

### Fase 0 — Perbaikan web murni · ~2 hari · **bisa merge ke `main` hari ini juga**

Tiga di antaranya bug web yang sudah hidup, bukan pekerjaan mobile:

- `uploadFile()` di [api.ts:222-247](apps/web/src/lib/api.ts#L222-L247) tidak punya retry
  refresh 401. Komentarnya berasumsi token masih segar karena pemanggil baru saja memuat
  data — asumsi itu **salah** untuk antrean offline yang membilas foto PoD berjam-jam
  kemudian. Artinya **setiap unggahan bukti kirim dari antrean gagal 401.**
- `keyGenerator` rate limit (J5).
- 2 `fetch` mentah yang melewati `api.ts` sama sekali (`hr/reports/page.tsx:22`,
  `hr/payroll/[id]/page.tsx:40`) → 401 permanen di native.
- `viewportFit: 'cover'`; `100vh` sisa di `global-error.tsx:19`.
- `APP_VERSION` jadi dibaca dari env.
- `downloadBlob()` dijadikan satu-satunya jalur unduh (4 tempat dialihkan ke sana).
- Halaman publik hapus akun (syarat Play).
- Ikon PNG 192/512 + maskable, favicon, manifest, perbaiki `sw.js`.

### Fase 1 — Export-ability · ~5–8 hari · **yang terbesar**

- `next.config.mjs` bercabang `MOBILE_BUILD`: `output:'export'`, **`trailingSlash:true`**,
  `distDir` terpisah, `headers()` dilepas. _Hati-hati:_
  `apps/web/test/security-headers.test.ts` memanggil `nextConfig.headers!()` dengan
  non-null assertion — akan meledak kalau `MOBILE_BUILD` bocor ke env vitest.
- `useRouteId()` baru (J3), lalu 21 halaman `[id]/page.tsx` → `detail/page.tsx` dengan
  `useParams()` → `useRouteId()`, lalu 43 tempat link.
- Tiga helper jalur-platform: `openExternal()`, cabang native di `downloadBlob()`, jalur
  cetak kedua untuk `printReceipt`.
- `safe-area-inset-top` **tidak** ditambal per-halaman — `StatusBar.setOverlaysWebView(false)`
  satu panggilan, bukan audit 226 halaman.
- **Gerbang CI paling murah dan paling berharga**: tambahkan
  `MOBILE_BUILD=1 npm run build -w @hydromart/web` ke job `verify`. ±2 menit, tanpa
  secret, dan menangkap regresi kelas J2/J3 di setiap PR.
- Proyek Playwright kedua yang menyajikan `out/` statis — inilah yang membuktikan J2 nyata.

### Fase 1c — Ukuran APK · ~1 hari · **hasil terbesar per jam kerja di seluruh rencana**

Rancangan awal saya menumpuk 226 halaman ke **kedua** binary dan menunda optimasi. Setelah
diperiksa, levernya ternyata murah dan aman, jadi ia masuk rilis 1.

**Lever utama: pangkas `src/app` per binary sebelum build.** Skrip prebuild ±15 baris yang
memindahkan folder rute yang tidak dipakai binary itu ke luar sementara, lalu
mengembalikannya. Dua fakta yang membuat ini aman — keduanya sudah saya verifikasi, bukan
diasumsikan:

- **Nol berkas di luar `src/app/` yang mengimpor dari `src/app/`.** Semua komponen bersama
  hidup di `src/components` dan `src/lib`. Memindahkan folder rute tidak memutus impor
  siapa pun.
- **`exceljs` hanya dijangkau dari `/dashboard/*`, `/hq/*`, `/hr/*`** (15 halaman + satu
  komponen). Nol halaman pelanggan menyentuhnya. Begitu folder itu dipangkas, exceljs —
  paket terberat di dependency tree (~950 KB terminifikasi) — **rontok sendiri lewat
  tree-shaking.** Tidak perlu dynamic import, tidak perlu akal-akalan.

Hasilnya:

| Binary                | Halaman          | Dipangkas                                                           |
| --------------------- | ---------------- | ------------------------------------------------------------------- |
| Hydromart (pelanggan) | **25** dari 226  | `/hq`, `/hr`, `/dashboard`, `/driver`, `/m` — 201 halaman + exceljs |
| Hydromart Ops         | **109** dari 226 | `/hq`, sisa `/hr` di luar `/hr/me` — 92 halaman                     |

Perlu dicatat jujur: pemangkasan ini **menggantikan** kalimat di bagian role bahwa "berkas
`/hq` tetap ikut ter-export". Setelah Fase 1c, tidak lagi — dan itu bonus keamanan kecil
di samping bonus ukurannya.

**Lever pendukung:**

- **Kirim AAB, bukan APK.** Play mengirim split per-perangkat, jadi pengguna hanya mengunduh
  ABI + kepadatan layar miliknya. Ini gratis dan sudah jadi jalur di Fase 6.
- `minifyEnabled` + `shrinkResources` di Gradle release.
- Salin **hanya** `out/` ke `www/`, jangan pernah `.next/` — jebakan klasik yang menggandakan
  ukuran tanpa terlihat.
- Font `Plus_Jakarta_Sans` sekarang memuat 5 bobot (400–800). Turunkan ke 3 kalau desain
  mengizinkan; tiap bobot ±25 KB woff2.

**Tiga akibat yang harus ikut berubah — kalau tidak, fase ini merusak fase lain:**

1. **Dua export, bukan satu.** Konsekuensinya `cap sync` tidak bisa dipanggil sekali.
   Tiap flavor Gradle butuh aset sendiri di source set-nya
   (`android/app/src/customer/assets/public` dan `src/ops/assets/public`), jadi alur build
   di Fase 3 dan Fase 6 jadi: export pelanggan → sync ke flavor customer → export ops →
   sync ke flavor ops. Waktu build CI kira-kira dua kali lipat.
2. **Pemangkasan harus per-path, bukan per-folder puncak.** App Ops menyimpan `/hr/me`
   tapi membuang sisa `/hr` — dan `src/app/hr/layout.tsx` **wajib ikut tinggal**, kalau
   tidak `/hr/me` kehilangan shell-nya. Skripnya menerima daftar path, bukan daftar
   folder tingkat satu.
3. **Playwright harus tahu build mana yang diuji.** `walk-in.spec.ts` dan
   `hr-checkin.spec.ts` menyentuh `/dashboard` dan `/hr`, yang **tidak ada** di export
   pelanggan. Proyek Playwright statis dijalankan terhadap export **Ops**; `smoke` dan
   `checkout` terhadap export pelanggan. Kalau ini tidak dipisah, suite-nya merah bukan
   karena ada bug.

Ukurannya **diukur, bukan ditebak**: langkah pertama fase ini adalah mencatat `du -sh out/`
sebelum dan sesudah, dan angkanya masuk ke deskripsi PR. Kalau pemangkasan tidak
menghasilkan selisih berarti, fase ini dibatalkan dan skripnya dibuang — bukan
dipertahankan demi rencana.

### Fase 2 — Auth bearer · ~4 hari (1,5 hari di antaranya tes gateway ke 98%)

`session-bff.ts` + `isNative(req)` by Origin; `token-store` + hidrasi; cabang
`Authorization` di `api.ts`; gerbang refresh berbasis **kepemilikan token**, bukan profil
di localStorage (Android bisa membersihkan localStorage WebView sementara Keystore
selamat → logout senyap padahal token valid); logout native harus mencabut ke upstream
(sekarang BFF membaca RT dari cookie, native tidak punya, jadi token hidup 30 hari);
`CORS_ALLOWED_ORIGINS` += `https://localhost`.

### Fase 3 — Shell Capacitor · ~4–5 hari

`mobile/` sesuai tata letak di atas. Plugin minimum: `@capacitor/app` (tombol back +
deep link), `@capacitor/preferences`, `@capacitor/status-bar`, `@capacitor/keyboard`,
`@capacitor/geolocation`, `@capacitor/filesystem` + `@capacitor/share`.
Komponen `native-bridge.tsx` di root layout: tombol back (default Capacitor **tidak**
menutup sheet/modal, dan `router.back()` dipakai 17 tempat), gerbang versi WebView (J4),
handler deep link, gerbang versi minimum. `sw.js` tidak perlu dinonaktifkan — `push.ts`
sudah menggerbanginya dan SW tidak akan pernah terdaftar; **jangan** menambah SW caching,
itu cara tercepat mengirim app yang tidak bisa diupdate.

### Fase 4 — Push FCM · ~4 hari

**Tanpa model baru dan tanpa migration.** `WebPushSubscription.endpoint` divalidasi
`@IsString()`, bukan `@IsUrl()` — token FCM disimpan berprefiks `fcm:<token>`. Ini bukan
kemalasan kosong: `pending_migrations()` di `deploy-common.sh` menegakkan konvensi _skema
rilis satu putaran sebelum pembacanya_, jadi model baru = **dua rilis**, prefiks = **satu**.
Repo ini sudah memakai pola prefiks yang sama untuk satuan meteran air. Harganya: nama
tabel jadi kurang jujur — dibayar dengan komentar di skema.
Adapter FCM HTTP v1 ditulis tangan dengan `node:crypto` (JWT RS256 → tukar access token,
±60 baris), konsisten dengan `scripts/gen-vapid.mjs` dan adapter web-push yang juga
tulis-tangan; **jangan** menarik `firebase-admin`. Composite sender memilih transport dari
prefiks. `FCM_*` wajib masuk skema Joi atau `check-env-contract.mjs` menggagalkan CI, dan
nilai kosong harus **mematikan** push (tiru pola `enabled` VAPID) atau crm tidak boot di CI.
⚠️ Lantai coverage crm-service **98/98/98/98** berlaku penuh.

### Fase 3b — Login biometrik + deep link · ~3 hari · **setelah F2 hijau**

Keduanya hanya lapisan di atas hal yang sudah jadi, jadi dikerjakan setelah token store
dan shell bekerja — bukan sebelumnya.

**Biometrik.** Bukan metode login baru: OTP tetap satu-satunya cara _mendapat_ token.
Biometrik hanya **membuka kembali** refresh token yang sudah tersimpan, supaya pengguna
tidak OTP ulang tiap kali app dimatikan. Plugin: satu untuk secure storage berbasis
Keystore/StrongBox (bukan `@capacitor/preferences`, yang cuma SharedPreferences polos),
satu untuk prompt biometrik. Aturan yang harus ditulis eksplisit, bukan diserahkan ke
default plugin:

- Perangkat tanpa biometrik terdaftar → jatuh ke alur OTP biasa, tidak diblokir.
- Gagal biometrik N kali → hapus token, paksa OTP. Jangan pernah sediakan bypass.
- Logout menghapus entri Keystore, bukan cuma memori.
- Sidik jari/wajah **tidak pernah** dikirim ke server — yang dijaga cuma kunci lokal.
  Ini beda total dari face check-in HR (yang memang mengirim frame ke server) dan
  perbedaannya harus jelas di form Data Safety.

**Deep link (App Links).** Tiga bagian, dan bagian ketiga yang biasanya terlupa:

1. `assetlinks.json` disajikan Caddy dari `{$WEB_DOMAIN}/.well-known/` — satu blok baru di
   `Caddyfile`, berisi sidik jari SHA-256 sertifikat **Play App Signing** (bukan kunci
   upload). Dua entri, satu per `applicationId`.
2. `intentFilter` di `AndroidManifest.xml` + handler `appUrlOpen` dari `@capacitor/app`.
3. **Tujuan notifikasi ada tapi selalu sama.** `PushPayload.url` memang ada di port, dan
   [notification.service.ts:49](services/crm-service/src/application/services/notification.service.ts#L49)
   mengisinya — tapi **hardcoded `'/notifications'`** untuk ke-18 event. Jadi pekerjaannya
   bukan menambah field (pipanya sudah nyambung ujung ke ujung), melainkan memberi tujuan
   **per-event**: pesanan dikirim membuka pesanan itu, voucher membuka voucher itu.
   Handler-nya juga harus menulis ulang bentuk lama `/orders/<id>` menjadi
   `/orders/detail?id=<id>`, karena rute berubah di F1 sementara notifikasi lama masih
   beredar di perangkat.

Izin `POST_NOTIFICATIONS` (Android 13+) adalah izin runtime — harus diminta pada momen yang
masuk akal (setelah pesanan pertama), bukan saat boot pertama, atau tingkat penolakannya
tinggi dan tidak bisa diminta ulang dengan mudah.

### Fase 5 — Gerbang versi minimum · ~1 hari · **JANGAN DIPOTONG**

`GET /mobile-config` publik di gateway, dikecualikan rate limit seperti `/health`. Dibaca
dari env, divalidasi Joi. **Jangan** didaftarkan di `apps/web/src/lib/endpoints/` —
`check-endpoint-contracts.mjs` akan menolaknya karena tidak ada service pemilik. Berkas
`scripts/endpoint-contract-allowlist.json` **belum pernah ada** — `existsSync(...) ? ... : []`
di baris 149 membuatnya jatuh ke allowlist kosong, jadi menambahkannya berarti menciptakan
berkas allowlist pertama repo ini. Ada jalan keluar (`--update`), tapi lebih bersih
memanggil dengan literal di satu berkas, seperti `/health` sudah dipanggil.

Ini harus ada **sebelum unggahan Play pertama.** Gerbang versi tidak bisa dipasang
belakangan ke binary yang sudah ada di tangan pengguna.

### Fase 6 — CI/CD · ~2–3 hari

Satu workflow baru `mobile.yml`, terpisah dari 4 yang ada supaya tidak pernah jadi gerbang
deploy backend. Dipicu tag, bukan setiap PR. Langkah: export → `npm ci` di `mobile/` →
`cap sync` → `gradlew bundleRelease` → tandatangani → artifact AAB.
Secret: keystore base64 + 3 password/alias, `google-services.json` base64 (disuntik CI,
jangan di-commit — gitleaks), lalu service account Play. Var `MOBILE_API_URL` dengan
penjaga `test -n` seperti `apps/web/Dockerfile:18`: kalau kosong, `api.ts:7` jatuh ke
`http://localhost:8080` yang **cleartext** dan Android memblokirnya jadi error jaringan
tak terbaca. Set `usesCleartextTraffic=false` untuk rilis.
`mobile/android/**` masuk `.prettierignore`.
Daftar **Play App Signing** sejak awal — dengan itu keystore Anda hanya kunci _upload_ dan
kehilangannya masih bisa dipulihkan. Tanpa itu, keystore hilang = app tidak bisa diupdate
selamanya.

### Fase 7 — Toko · ~3 hari kerja, tapi lihat catatan kalender di bawah

Data Safety (lokasi presisi, foto, data pribadi, data keuangan, device ID FCM, berkas),
URL + jalur hapus akun, target API level Capacitor 7 (35), justifikasi tiap izin, dan
akses reviewer (J6). **Audit manifest yang sudah digabung** — jangan sampai ada plugin
menyelundupkan `READ_MEDIA_IMAGES`, karena itu memicu deklarasi Photo & Video yang
prosesnya panjang. Pastikan juga `geo.ts` murni foreground; lokasi latar butuh foreground
service + deklarasi + video demo dan menambah minggu di review.

Aset listing yang harus dibuat dari nol (belum ada apa pun): ikon 512×512, feature graphic
1024×500, minimal 2 screenshot ponsel per app, deskripsi pendek + panjang dalam Bahasa
Indonesia, dan kategori. Untuk app Ops, deskripsi harus jujur bahwa ia hanya untuk staf —
Play menolak app yang tampak publik tapi seluruh isinya di balik login tanpa penjelasan.

**Dua proyek Firebase / dua `google-services.json`** — satu per `applicationId`. Token FCM
tidak berlaku lintas app.

Rilis bertahap: internal testing → closed testing → production, dengan staged rollout
(misalnya 10% dulu). Ini juga yang membuat gerbang versi (F5) berguna sejak hari pertama.

⚠️ **Catatan kalender yang bisa menggeser jadwal berminggu-minggu, dan harus dicek
sekarang, bukan nanti:** akun Google Play **pribadi** yang baru dibuat wajib menjalankan
closed testing dengan minimal 12 penguji yang ikut serta selama 14 hari berturut-turut
sebelum boleh mengajukan akses produksi. Akun **organisasi** dikecualikan. Kalau Hydromart
mendaftar sebagai pribadi, tambahkan ±3 minggu kalender di ujung — dan mulai perekrutan
penguji **paralel dengan Fase 1**, jangan menunggu binary siap. Kebijakan ini pernah
berubah; verifikasi teksnya di Play Console saat mendaftar.

---

## Urutan

```text
F0 ──────────────────────────────────► bisa dirilis ke web sekarang, nol ketergantungan mobile
     │
     ├─► F1 (export) ─┬─► F3 (shell) ─┬─► F3b (biometrik + deep link)
     │                │               ├─► F4 (FCM)
     └─► F2 (auth) ───┘               ├─► F5 (gerbang versi) ← wajib sebelum unggah pertama
                                      └─► F6 (CI) ─► F7 (toko)

 (paralel, dari hari ke-1) akun Play + keystore + Firebase + rekrut 12 penguji
```

F1 dan F2 bisa paralel (berkas beda, service beda). Yang di baris terakhir bukan koding
tapi jalur kritis sungguhan — kalau baru dimulai saat binary siap, ia yang jadi penghambat.

---

## Verifikasi

1. `cd apps/web && npm run typecheck && npm run lint && npm test`; untuk service yang
   disentuh, `npm run test:cov` di direktori service itu — ambang **98/98/98/98**.
2. Jangan pernah `npm test` dari root repo — timeout 600 detik, exit 255 (runner mati,
   bukan test gagal). Node lokal saat ini **v25.9.0** sedangkan repo mengunci
   `>=20.20 <21` (`.nvmrc` = 20.20.2); build export harus di Node 20 atau hasil lokal
   tidak mewakili CI.
3. `node scripts/check-endpoint-contracts.mjs` dan `node scripts/check-env-contract.mjs`
   hijau.
4. **Bukti bahwa Fase 1 selesai**: `MOBILE_BUILD=1 npx next build` menghasilkan `out/`
   tanpa error, lalu Playwright `smoke` lolos terhadap `out/` yang disajikan statis.
5. Playwright yang ada (`smoke`, `authed`, `checkout`, `walk-in`, `hr-checkin`) semuanya
   menyentuh rute yang berubah — dijalankan setelah konversi.
6. Migration: tidak ada (Fase 4 sengaja tanpa migration).

### Yang wajib dibuktikan di perangkat Android nyata, minggu pertama

Diurutkan berdasarkan risiko, bukan kenyamanan:

1. **`getUserMedia` di WebView Capacitor polos** — menggerbangi foto PoD _dan_ face
   check-in HR, dan tidak ada pengganti murah kalau gagal.
2. **`trailingSlash` + resolusi path penyaji lokal** — menggerbangi semuanya.
3. **Tailwind v4 di ponsel target sungguhan**, termasuk satu unit Android 8/9 dengan
   WebView lama.
4. `webDir` relatif ke `../apps/web/out` (cadangannya: langkah salin).
5. Login OTP → panggilan terlindung → refresh diam-diam → logout, semuanya lewat bearer.
6. Kurir: buka antaran → foto PoD → **matikan jaringan** → selesaikan → nyalakan jaringan
   → antrean terkirim.
7. Push FCM saat app di background dan saat app dimatikan; deep link membuka halaman yang
   benar.
8. Tombol back menyusuri riwayat dan **menutup sheet/modal**, tidak menutup app.
9. Kasir `/dashboard/walk-in`: cetak struk lewat jalur native.
10. Keyboard Android tidak menindih bottom-nav di `/verify` dan `/checkout`.
11. Biometrik: daftar → app dimatikan → buka ulang → sidik jari membuka sesi tanpa OTP;
    lalu gagal N kali → token terhapus → OTP dipaksa; lalu perangkat tanpa biometrik
    terdaftar tetap bisa masuk lewat OTP.

## Yang sengaja TIDAK ada di rencana ini

Supaya tidak terbaca sebagai kelalaian:

- **Crash reporting / analytics.** Play Vitals sudah memberi ANR + crash gratis tanpa
  kode. Crashlytics ditambahkan kalau Vitals terbukti kurang, bukan sebelum.
- **In-app update API** dan **in-app review prompt.** Gerbang versi (F5) sudah menutup
  kasus wajibnya; sisanya kenyamanan.
- **Cetak struk ke printer termal Bluetooth.** `printReceipt` sekarang mengandalkan dialog
  cetak sistem. Kalau kasir depot memakai printer termal, itu plugin dan protokol
  tersendiri — perlu dipastikan dulu perangkat apa yang sebenarnya dipakai di depot.
- **iOS.** Butuh akun Apple Developer (belum ada) + D-U-N-S untuk entitas organisasi
  (1–2 minggu kalender di luar kendali kita) + runner macOS.
  _(Optimasi ukuran APK dulu ada di daftar ini. Setelah dicek, ternyata levernya murah dan
  aman, jadi ia naik jadi Fase 1c di atas.)_

---

## Ukuran, dan satu tuas yang bisa memotongnya separuh

| Fase                      | Hari                               |
| ------------------------- | ---------------------------------- |
| F0 perbaikan web          | 2                                  |
| F1 export                 | 5–8                                |
| F1c ukuran APK            | 1                                  |
| F2 auth                   | 4                                  |
| F3 shell                  | 4–5                                |
| F3b biometrik + deep link | 3                                  |
| F4 FCM                    | 4                                  |
| F5 gerbang versi          | 1                                  |
| F6 CI/CD                  | 2–3                                |
| F7 toko                   | 3                                  |
| **Total**                 | **±29–34 hari kerja ≈ 6–7 minggu** |

Ditambah kalender di luar koding: akun Play (verifikasi identitas bisa makan hari) dan —
kalau akunnya pribadi — 14 hari closed testing dengan 12 penguji.

**Tuasnya: rilis satu audiens dulu.** Kalau App 1 (pelanggan) dirilis sendiri, yang gugur
adalah face capture, unggah PoD, antrean offline, ekspor XLSX/CSV, `window.print`,
geolokasi kurir, pertanyaan lokasi-latar, PII karyawan di form Data Safety — **dan 18 dari
21 konversi rute** (pelanggan cuma punya `orders/[id]`, `orders/[id]/review`,
`products/[id]`). ±6 minggu jadi ±3.

Saya **tidak** menyarankan itu di sini, karena Anda memilih cakupan ops dengan sadar dan
justru kurirlah yang paling butuh app native — merekalah alasan `offline-queue.ts` ada.
Tapi tuasnya nyata dan keputusannya harus diambil **sebelum Fase 1**, karena itu yang
menentukan berapa rute yang dikonversi.

**Jangan pernah dipotong:** gerbang versi minimum (F5) dan gerbang versi WebView (J4).
Keduanya tidak bisa dipasang setelah binary ada di tangan pengguna.

## Jejak audit — apa yang saya buktikan sendiri vs apa yang masih asumsi

Setiap klaim di rencana ini saya cek balik ke kode. Hasilnya:

**Terbukti benar (dibaca langsung di berkasnya):**

- `orders/[id]/page.tsx:107` memanggil `useSearchParams()` tanpa `<Suspense>` di berkasnya
  → build export **pasti** gagal. Ini penghalang nyata, bukan teori.
- `SubscribePushDto.endpoint` divalidasi `@IsString()` (baris 19), bukan `@IsUrl()` →
  pendekatan prefiks `fcm:` di F4 sah, dan itu yang menghemat satu putaran rilis.
- `security-headers.test.ts` baris 21 dan 43 memanggil `nextConfig.headers!()` sementara
  tipenya `headers?:` → kalau `MOBILE_BUILD` bocor ke env vitest, tes ini meledak.
- `hq/depots/page.tsx:29` benar-benar berisi preseden `window.location` beserta alasannya
  → `useRouteId()` di J3 memakai ulang pola repo, bukan mengarang.
- `router.back()` dipakai di **17 berkas** → penanganan tombol back bukan detail kecil.
- `.prettierignore` ada dan isinya 7 baris; `mobile/` tidak tercakup.
- `svc_of()` memetakan `apps/*/*` ke nama service Docker → `apps/mobile/` memang merusak
  deploy.
- `gateway.setup.ts:90-93` memang membiarkan `Authorization` eksplisit menang → jalur
  bearer tidak perlu menyentuh guard mana pun.

**Salah, dan sudah dikoreksi di atas:**

- Saya kira payload notifikasi belum punya tujuan. Salah — `PushPayload.url` ada dan
  **terisi**, cuma di-hardcode `'/notifications'` untuk semua event.
- Saya kira `endpoint-contract-allowlist.json` ada tapi kosong. Berkasnya **belum pernah
  ada**.
- Saya mengeluarkan seluruh `/hr/*` dari rilis 1. Salah — `/hr/me/*` adalah layar absen
  wajah harian keempat role ops, dan `offline-queue.ts` punya `'hrPunch'` persis untuk itu.

**Masih asumsi, hanya bisa dijawab perangkat nyata** — sudah masuk daftar uji minggu
pertama, dan urutannya memang berdasarkan ini:

- Apakah `getUserMedia` memicu prompt izin di WebView Capacitor polos (±80% yakin).
- Apakah `trailingSlash` cukup untuk resolusi path penyaji lokal Capacitor (±85%).
- Apakah izin geolokasi diberikan tanpa `@capacitor/geolocation` (±75% — karena itu
  plugin-nya diambil, bukan dipertaruhkan).
- Apakah `headers()` di bawah `output:'export'` adalah error atau sekadar peringatan
  (±80% peringatan). Tidak penting: tetap dilepas di mode mobile.
- Apakah `webDir` relatif ke luar folder proyek diterima (cadangannya langkah salin).

Yang **tidak** bisa saya buktikan tanpa menjalankan build — dan itu sengaja tidak saya
jalankan karena ini masih tahap rencana: `MOBILE_BUILD=1 next build` benar-benar
menghasilkan `out/`. Itu langkah pertama Fase 1, dan hasilnya bisa memunculkan galat yang
tidak ada di daftar mana pun di atas.

## Rem darurat kalau rilis ternyata bermasalah

Tanpa OTA, tiga tuas ini yang tersedia — dan ketiganya harus sudah ada **sebelum** unggahan
pertama, bukan disiapkan saat panik:

1. **Gerbang versi minimum (F5)** — memaksa update. Ini rem paling kasar dan paling pasti.
2. **Feature flag** — `FeatureFlag` di admin-service sudah ada lengkap dengan persentase
   rollout. Fitur native baru (biometrik, FCM) dibungkus flag supaya bisa dimatikan dari
   server tanpa rilis baru.
3. **Staged rollout Play** — mulai 10%, hentikan kalau Vitals memburuk.

Yang **tidak** tersedia: menarik binary yang sudah terpasang. Karena itu kompatibilitas
mundur API bukan anjuran melainkan syarat — setiap perubahan kontrak harus aditif selama
masih ada versi lama beredar.

## Catatan jujur

Ini pekerjaan beberapa sesi, bukan satu. Saya kerjakan berurutan, satu fase per branch
dari `main`, dan melapor di setiap fase selesai.

Satu hal yang perlu diketahui sekarang: **Fase 2 menyentuh jalur login setiap pengguna web
yang ada.** Cabangnya dirancang supaya web tidak berubah sama sekali (origin bukan native →
perilaku cookie persis seperti sekarang), tapi itu tetap kode di jalur auth produksi dan
pantas mendapat perhatian review terbesar dari seluruh rencana ini.
