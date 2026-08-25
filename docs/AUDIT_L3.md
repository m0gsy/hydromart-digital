# AUDIT L3 — lima hal yang belum pernah diaudit sama sekali

Tanggal audit: **2026-08-25**. Diukur terhadap `main` pada hari itu (`f1d09796`); pengukuran
rate-limit dilakukan terhadap gateway yang berjalan saat itu, dan angka plafonnya ikut
konfigurasi kontainer tersebut — lihat catatan di §2.3.

`docs/LEGAL_OPEN_ITEMS.md` §4 menuliskan lima lubang ini sebagai "diketahui, tanpa item
untuk direproduksi". Dokumen itu benar bahwa lubangnya ada; yang salah adalah menyimpannya
sebagai rencana. **Ini bukan rencana untuk mengukur nanti — ini hasil ukuran.** Setiap angka
di bawah punya perintah atau berkas yang menghasilkannya, tepat di sebelahnya. Angka tanpa
sumber tidak ditulis; pertanyaan yang tidak bisa saya ukur dari sini dinyatakan sebagai tidak
terukur, bukan ditebak.

---

## Ruang lingkup dan metode

| Yang diaudit                                           | Cara                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Pemulihan bencana — RPO/RTO                            | baca jadwal cron nyata, **jalankan** dump + drill restore, catat detiknya |
| Uji keamanan yang dijalankan, bukan dibaca             | **kirim permintaan sungguhan** ke gateway :8080 sampai ia menjawab 429   |
| Kapasitas — apa yang patah duluan                      | ukur plafon di stack hidup, hitung sisanya dari batas yang tertulis       |
| Retensi dan penghapusan di luar jalur bukti pengiriman | enumerasi tabel di 16 basis data hidup vs eksekutor purge yang terdaftar  |
| Tinjauan legal                                         | inventaris artefak + tanya siapa yang menandatangani; **bukan** nasihat   |

**Lingkungan ukur.** Stack lokal, 26 kontainer, `hydromart-postgres` (postgres:16-alpine)
naik 4 hari, gateway `hydromart-gateway-1` (image dibuat `2026-08-15T04:50:43Z`), 168 MB data
berbibit di 16 basis data. Ini **laptop, bukan VPS** — setiap angka wall-clock di bawah diberi
label demikian dan tidak boleh dipakai sebagai baseline produksi (`docs/perf/BASELINE.md`
sudah memutuskan aturan itu; audit ini mematuhinya).

**Apa yang TIDAK saya sentuh.** Produksi. Tidak ada satu pun permintaan di dokumen ini yang
dikirim ke VPS. Semua tulis-menulis terjadi ke basis data dev lokal dan ke kontainer sekali
pakai yang dihapus setelahnya.

---

## Ringkasan temuan

| ID           | Temuan                                                                                                  | Tingkat | Pemilik           |
| ------------ | ------------------------------------------------------------------------------------------------------- | ------- | ----------------- |
| **L3-CAP-1** | Seluruh lalu lintas manusia berbagi **satu** ember 100 permintaan/60 s **per service**                   | KRITIS  | belum ada         |
| **L3-SEC-1** | Rate limit tepi bisa dilewati penuh dengan menukar nilai `Authorization` palsu setiap permintaan          | TINGGI  | belum ada         |
| **L3-DR-1**  | RPO = **24 jam**, tidak pernah dinyatakan; tidak ada WAL/PITR                                            | TINGGI  | ops (pemilik box) |
| **L3-DR-2**  | Drill restore hanya bisa lulus untuk dump yang **lebih baru dari migrasi terakhir**                       | TINGGI  | ops               |
| **L3-DR-3**  | Instrumen verifikasi backup butuh cluster hidup — mati justru saat dibutuhkan                             | TINGGI  | ops               |
| **L3-DR-4**  | RTO tak berbatas: rota on-call masih placeholder, dan gate yang mengklaim menjaganya tidak ada di CI      | TINGGI  | Anda              |
| **L3-SEC-2** | `RATE_LIMIT_*` tidak pernah sampai ke proses; nilai produksi = default Joi, bukan `.env`                  | SEDANG  | ops               |
| **L3-SEC-3** | Nol uji keamanan dinamis. Semua yang berjalan adalah pembacaan kode/dependensi                            | SEDANG  | belum ada         |
| **L3-CAP-2** | Gerbang beban mingguan mengukur stack yang limiter-nya praktis dimatikan                                  | SEDANG  | belum ada         |
| **L3-RET-1** | 2 dari 8 kebijakan retensi tanpa eksekutor; **141 dari 149 tabel tanpa kebijakan apa pun**                 | TINGGI  | Anda              |
| **L3-RET-2** | Penghapusan PDP melewatkan 9 tabel yang masih memegang nomor/nama orang yang dihapus                      | TINGGI  | Anda              |
| **L3-RET-3** | Baris kebijakan ganda dan saling bertentangan untuk data yang sama (`pesanan` vs `orders_transactions`)    | SEDANG  | Anda              |
| **L3-LEG-1** | Tabel TER **tidak dimuat** di stack; payroll memakai metode yang PMK 168/2023 gantikan                     | TINGGI  | akuntan           |
| **L3-LEG-2** | Bukti consent UU PDP belum pernah diuji pihak ketiga                                                      | SEDANG  | belum ada         |
| **L3-LEG-3** | PPN/faktur ritel tanpa pemilik (dibawa dari N15, tidak berubah)                                          | SEDANG  | belum ada         |

---

## 1. Pemulihan bencana — RPO dan RTO

### 1.1 Apa yang benar-benar terjadwal

`scripts/install-host-cron.sh --show` adalah satu-satunya sumber jadwal (komentar di skrip
lain adalah komentar; ia tidak pernah sekali pun berjalan jam 03:00). Blok yang dipasangnya:

| Jam (WIB, `CRON_TZ` dari `SCHEDULER_TZ`/`PRICING_TZ`) | Pekerjaan                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `0 3 * * *`                                           | `backup-db.sh` — `pg_dumpall` seluruh cluster                                          |
| `30 4 * * 1`                                          | `restore-db.sh --drill` — restore ke kontainer sekali pakai, verifikasi terhadap LIVE   |
| `30 6 * * 1`                                          | `rollback-drill.sh` — up/down/up ×3 per migrasi                                        |
| `*/5 * * * *`                                         | `watchdog.sh`                                                                          |

Retensi lokal: `BACKUP_KEEP=14` (`scripts/backup-db.sh`) → 14 dump. Salinan luar-kotak
bersifat opsional dan menyala hanya jika `BACKUP_S3_BUCKET` diset.

> **Ukur:** `grep -c BACKUP .env.example` → **0**. `grep -c BACKUP .env.production.example` →
> **0**. Tidak ada satu pun berkas contoh env yang menyebut variabel yang menyalakan salinan
> luar-kotak; satu-satunya tempat ia disebut adalah komentar di dalam skrip yang membacanya.
> Selama itu kosong, backup dan basis datanya mati di kotak yang sama.

### 1.2 RPO — **24 jam**, dan itu angka penuh, bukan rata-rata

Dump penuh sekali sehari dan tidak ada apa pun di antaranya:

```
psql -c "SHOW wal_level;"        -> replica
psql -c "SHOW archive_mode;"     -> off
psql -c "SHOW archive_command;"  -> (disabled)
```

`archive_mode=off` berarti **tidak ada point-in-time recovery**. Kehilangan volume pada jam
02:59 WIB membuang hampir 24 jam pesanan, pembayaran, absensi dan setoran kurir. Untuk sistem
yang memegang uang, RPO-nya bukan "sekitar sehari" — ia **tepat sepanjang jarak ke dump
terakhir**, dan hari sibuk adalah hari dengan kerugian terbesar.

**L3-DR-1 — TINGGI.** RPO nyata = 24 jam; belum pernah dinyatakan di mana pun. `grep -rn
'\bRPO\b'` di seluruh repo hanya menemukan dua kalimat yang mengatakan ia belum dinyatakan:
`docs/LEGAL_OPEN_ITEMS.md:52` dan `docs/PRODUCTION_READINESS_AUDIT.md:178`.

**Yang harus berubah untuk memperbaikinya**, dari yang termurah:

1. `archive_mode=on` + `archive_command` ke bucket NEO yang sama → RPO turun ke ukuran satu
   segmen WAL (menit, bukan jam). Ini satu baris `command:` di `docker-compose.prod.yml`
   sebelah `max_connections=150`, plus tempat menaruh WAL-nya.
2. Dump lebih sering, hanya untuk basis data uang (`hydromart_order`, `hydromart_payment`,
   `hydromart_payout`) — lebih murah dari WAL, tapi RPO terbaiknya tetap = interval dump.
3. `BACKUP_S3_BUCKET` diset. Tanpa ini, RPO untuk **kehilangan kotak** bukan 24 jam melainkan
   tak terhingga: tidak ada salinan di luar mesin yang mati.

### 1.3 RTO — bagian mesinnya diukur, bagian manusianya tak berbatas

Dijalankan hari ini, terhadap cluster 168 MB / 16 basis data:

| Langkah                                          | Terukur                                      | Perintah                                                               |
| ------------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------- |
| `pg_dumpall` + gzip                              | **6 s**                                      | `docker exec hydromart-postgres pg_dumpall -U hydromart \| gzip > f.gz` |
| Ukuran dump                                      | 1.094.970 B terkompresi / 4.644.367 B mentah | `wc -c`, `gunzip -c … \| wc -c`                                        |
| Postgres sekali pakai sampai siap terima koneksi  | **19 s**                                     | `docker run -d postgres:16-alpine` + loop `pg_isready`                  |
| Restore dump ke dalamnya                         | **27 s**                                     | `gunzip -c f.gz \| docker exec -i … psql -q -U hydromart -d postgres`   |
| **Drill lengkap ujung ke ujung**                 | **80 s**                                     | `BACKUP_DIR=… bash scripts/restore-db.sh --drill`                       |

Jadi **langkah memuat ulang data ≈ 46 detik** pada volume hari ini (19 s kontainer + 27 s
restore). Itu satu-satunya bagian RTO yang punya angka.

Sisanya tidak punya:

- **Deteksi.** `docs/RUNBOOK_ONCALL.md` §6: `PostgresDown` `for: 2m` → notifikasi pertama
  paling lambat **~2 m 45 s**. Terukur dari konfigurasi, bukan aspirasi.
- **Manusia menjawab.** §3 menjanjikan 15 menit untuk primer — dan §3 sendiri mengakui tidak
  ada perangkat yang menegakkannya: `ops/alertmanager.yml` punya satu `receiver`, tanpa
  `routes`, tanpa acknowledge, `repeat_interval: 4h`.
- **Siapa manusianya.** Tidak ada.

  ```
  node scripts/check-oncall-rota.mjs   -> exit 1, "6 masalah": kolom Nama dan Kontak
                                          Primer/Sekunder/Bisnis semuanya masih placeholder
  ```

- **Memulihkan ke produksi belum pernah dilatih.** Yang terjadwal adalah `--drill`
  (non-destruktif, ke kontainer sekali pakai). `--into-prod` tidak pernah dijalankan oleh apa
  pun; ia bahkan tidak menghentikan service aplikasi sebelum menulis di atas cluster hidup —
  pesan terakhirnya adalah "restore complete. Restart the app services so they reconnect",
  *setelah* restore. Selama restore itu, 17 service masih terhubung dan masih menulis.

**L3-DR-4 — TINGGI.** RTO tidak bisa dinyatakan sebagai satu angka, karena bagian
terpanjangnya adalah orang yang belum ada namanya. Yang bisa dinyatakan hari ini:

> **RTO = 2 m 45 s (deteksi) + T(manusia, tak berbatas) + ~1 menit (muat ulang data pada
> volume hari ini) + T(restart 17 service, belum pernah diukur).**

**Yang harus berubah**, berurutan: (1) isi tabel rota — itu satu commit dan ia mengubah suku
tak-berbatas menjadi 15 menit; (2) jalankan `check-oncall-rota.mjs` di CI (§1.3b); (3) latih
`--into-prod` sekali terhadap kotak staging dan catat wall-clock-nya di sini; (4) tentukan
urutan stop/restore/start supaya restore tidak berlomba dengan 17 penulis.

### 1.3b Gate yang menjaga rota tidak pernah dijalankan

`docs/RUNBOOK_ONCALL.md` §3 menulis: "selama tabel ini kosong CI **merah**, bukan diam".

```
node scripts/check-oncall-rota.mjs >/dev/null 2>&1; echo $?    -> 1
grep -rn "check-oncall-rota" .github/workflows/                -> (tidak ada satu pun)
```

Skripnya benar-benar merah. Ia hanya tidak dipanggil oleh workflow mana pun — satu-satunya
tempat namanya muncul di luar dirinya sendiri adalah cuplikan YAML *saran* di dalam
runbook-nya sendiri (§8, "Pemeriksa rota"). Ini kelas cacat yang sama yang sudah dikenal repo ini:
pemeriksaan yang tidak pernah merah karena tidak pernah berjalan.

**L3-DR-4b — TINGGI, dan ini yang termurah di seluruh dokumen.** Tambahkan dua baris ke
`ci.yml`. Bukti bahwa gate-nya bisa merah **dan** bisa hijau sudah ada: `--self-test`.

### 1.4 Drill restore hanya bisa membuktikan dump termuda

`scripts/restore-db.sh --drill` membandingkan hasil restore dengan **LIVE**: jumlah tabel
sama, jumlah migrasi terpasang sama, tabel terbesar tidak kosong. Perbandingan migrasinya
adalah kesetaraan ketat:

```sh
if [ "${sm:-0}" != "${lm:-0}" ]; then
  echo "  ❌ $db: ${sm:-0} applied migrations restored, live has ${lm:-0}"
```

Konsekuensinya, dan ia tidak kecil: **setiap dump yang lebih tua dari migrasi terakhir akan
dilaporkan GAGAL.** Dari 14 dump yang disimpan, hanya yang termuda punya peluang lulus, dan
hanya jika tidak ada deploy yang membawa migrasi sejak ia diambil. Deploy repo ini memang
menerapkan migrasi sendiri, jadi jendela itu nyata.

Ini terlihat langsung pada run hari ini, dan penyebabnya perlu dipisahkan dengan jujur:

```
drill: restoring …/hydromart-20260825-194900.sql.gz ...
  ❌ hydromart_order:   18 applied migrations restored, live has 22
  ❌ hydromart_payment:  7 applied migrations restored, live has 9
ERROR: … does not restore to a usable copy of the live cluster
[report] recorded DRILL=FAILED
```

Empat migrasi `hydromart_order` yang "hilang" itu **diterapkan 4 detik setelah dump saya
mulai**, oleh pekerjaan lain di mesin ini:

```
psql -d hydromart_order -c 'SELECT migration_name, started_at FROM "_prisma_migrations"
                            ORDER BY started_at DESC LIMIT 4;'
-> 20260822130000_order_status_changed_at_index   2026-08-25 12:49:04.450+00
   20260822100000_order_status_changed_at         2026-08-25 12:49:04.260+00
   20260821160000_subscription_failure_tracking   2026-08-25 12:49:04.223+00
   20260820120000_order_subscription_link         2026-08-25 12:49:04.175+00
# dump dimulai 12:49:00Z; dump memuat 18 baris, live 22:
comm -13 dump-order.txt live-order.txt   -> tepat keempat nama di atas
```

Jadi kegagalan spesifik itu adalah **kecelakaan lingkungan saya, bukan cacat produk** — dan
saya menuliskannya justru karena ia mendemonstrasikan dua sifat struktural yang nyata:

1. `pg_dumpall` **tidak** mengambil satu snapshot lintas basis data. Tiap basis data adalah
   snapshot sendiri. Dump yang diambil sementara migrasi berjalan memulihkan cluster dengan
   basis data pada versi skema yang berbeda-beda — dan tidak ada apa pun yang melarang
   nightly backup bertabrakan dengan deploy.
2. Instrumen yang seharusnya membuktikan backup itu berguna akan berteriak "Backups are
   UNVERIFIED until this passes" ke `ALERT_WEBHOOK_URL` untuk kejadian yang benar-benar
   normal (dump semalam + deploy pagi ini). Alarm yang menyala saat tidak ada yang salah
   adalah alarm yang akan dimatikan orang.

**L3-DR-2 — TINGGI.** Perbaikannya bukan melonggarkan pemeriksaan sampai ia tidak bisa gagal.
Yang benar: bandingkan migrasi dengan **himpunan migrasi yang ada di dalam dump**, bukan
dengan live — "setiap migrasi yang dump ini klaim terpasang benar-benar terpasang di hasil
restore, dan tidak ada tabel yang hilang relatif terhadap skema pada versi ITU". Live tetap
dipakai untuk "data ikut kembali", karena di situ live memang referensi yang benar.

Dan satu langkah operasional yang tidak butuh kode: ambil lock antara backup dan deploy,
supaya dump tidak pernah dimulai di tengah `prisma migrate deploy`.

### 1.5 Verifikasi backup mati tepat pada bencananya

```sh
LIVE_DBS="$(docker exec "$CONTAINER" psql … "SELECT datname FROM pg_database WHERE datname LIKE 'hydromart%'…")"
if [ -z "$LIVE_DBS" ]; then
  echo "ERROR: the LIVE cluster reports no hydromart databases — nothing to verify a restore against"
  exit 1
fi
```

Drill membutuhkan cluster hidup sebagai referensi. Dalam bencana yang sesungguhnya — volume
hilang, kotak mati — cluster hidup **tidak ada**, dan satu-satunya alat yang bisa mengatakan
"dump ini bisa dipakai" menolak berjalan. Alatnya benar untuk pemantauan mingguan, dan tidak
ada untuk pemulihan.

**L3-DR-3 — TINGGI.** Yang menutupnya: mode kedua yang memverifikasi dump **terhadap dirinya
sendiri** (setiap basis data ada, jumlah tabel > 0, setiap `_prisma_migrations` punya baris,
tabel terbesar per basis data tidak kosong) tanpa menyentuh live. Itu pemeriksaan yang lebih
lemah — dan ia satu-satunya yang tersedia pada hari Anda membutuhkannya.

### 1.6 Satu selisih dokumen yang akan menggigit

`DEPLOY.md:268` masih memberi contoh blok cron **tanpa** `CRON_TZ`, dan menaruh drill di
`0 4 * * 1`; `install-host-cron.sh` memasang `30 4 * * 1` **dan** `CRON_TZ`. Host berjalan
UTC. Siapa pun yang menyalin blok dari DEPLOY.md alih-alih menjalankan skripnya akan
mendapatkan kembali bug C1b yang sudah diperbaiki: backup "03:00" menyala 10:00 WIB, di tengah
jam kerja.

**Tingkat: RENDAH**, tapi biaya perbaikannya satu suntingan.

---

## 2. Uji keamanan yang DIJALANKAN — rate limit di tepi, pada beban nyata

### 2.1 Yang berjalan hari ini adalah pembacaan, bukan pengujian

`.github/workflows/security.yml` menjalankan, mingguan dan pada tiap PR: **gitleaks** (pohon
kerja, bukan riwayat), **semgrep** (hanya severity ERROR), **syft** (SBOM CycloneDX),
**trivy** (base image + salah-konfigurasi Dockerfile/compose). Semuanya bagus, dan semuanya
statis.

Yang **tidak ada**: satu pun uji yang menembakkan permintaan ke sistem yang berjalan untuk
memeriksa properti keamanan. `services/gateway-service/test/e2e/rate-limit.e2e.spec.ts` ada,
dan ia adalah supertest in-process terhadap satu instans dengan penghitung di memori — yaitu
persisnya hal yang rencana L3 sebut sebagai bukan pengujian.

**L3-SEC-3 — SEDANG.** Nol uji keamanan dinamis. Yang menutupnya bukan "beli pentest": mulai
dari matriks otorisasi yang dijalankan terhadap stack hidup (bahannya sudah ada di
`scripts/f6-rbac-check.mjs` dan `scripts/role-browser-pass.mjs`), lalu satu uji limiter yang
berjalan di luar proses seperti di §2.5.

### 2.2 Konfigurasi limiter yang benar-benar dipakai proses

```
docker inspect hydromart-gateway-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -i rate
-> (kosong)
grep -rn "RATE_LIMIT" docker-compose.yml docker-compose.prod.yml
-> (tidak ada)
```

`RATE_LIMIT_TTL_SECONDS`, `RATE_LIMIT_MAX`, `RATE_LIMIT_OTP_MAX` dan `RATE_LIMIT_BURST_MAX`
**tidak pernah diteruskan** oleh compose mana pun ke service mana pun. Satu-satunya berkas
compose yang menyebutnya adalah `docker-compose.test.yml` dan `.uat/docker-compose.uat.yml`,
dan keduanya **menaikkannya** — itulah sebabnya tidak ada yang pernah menyadari. Jadi:

- `.env.example:236` menulis `RATE_LIMIT_MAX=100`. Nilai itu tidak pernah mencapai proses.
- Yang berlaku adalah default Joi di `services/gateway-service/src/config/env.validation.ts`:
  `RATE_LIMIT_MAX=600`, `TTL=60`, `BURST_MAX=300`, `OTP_MAX=20`.

Terukur, satu permintaan:

```
curl -sD - -o /dev/null http://localhost:8080/l3-rate-limit-probe | grep -i ratelimit
-> RateLimit-Policy: 600;w=60
   RateLimit-Limit: 600
```

**L3-SEC-2 — SEDANG.** Batas produksi adalah **6× angka yang didokumentasikan**, dan tidak ada
cara mengubahnya lewat `.env` sama sekali. `docs/perf/BASELINE.md` bahkan memberi instruksi
`RATE_LIMIT_MAX=100000 docker compose … up -d gateway` untuk menaikkan limiter sebelum uji
beban — **instruksi itu tidak melakukan apa pun**, karena tidak ada blok `environment` yang
membaca variabel itu. Termasuk langkah ketiganya ("lalu kembalikan"), yang mengembalikan
sesuatu yang tidak pernah berubah. Yang menutupnya: satu baris
`RATE_LIMIT_MAX: ${RATE_LIMIT_MAX:-600}` di anchor `*shared`, dan `.env.example` disamakan
dengan default yang sebenarnya berlaku.

### 2.3 Di mana ia benar-benar menjawab 429 — diukur

600 permintaan berurutan ke jalur yang tidak dilayani upstream mana pun
(`/l3-rate-limit-probe` → 404 dari catch-all gateway; limiter adalah `app.use`, jadi ia tetap
menghitung, dan tidak ada service yang dibebani):

```json
{"first429":599,"ok":598,"retryAfter":"20","limit":"600","elapsedMs":6300}
```

**598 permintaan diterima dalam 6,3 detik (≈95 req/s) dari satu klien anonim sebelum penolakan
pertama.** Header pada 429: `Retry-After: 20`, `RateLimit-Limit: 600`, body
`{"statusCode":429,"message":"Too many requests"}`.

Catatan penting tentang APA yang saya ukur: header `RateLimit-Policy: 600;w=60` dan
`RateLimit-Reset` adalah bentuk `express-rate-limit` (jendela tetap), **bukan** token bucket
yang ada di `main`. Image yang berjalan dibuat `2026-08-15T04:50:43Z`; commit token bucket
adalah `79c0b8de` (`2026-08-17 20:55:01 +0700`). Jadi:

- **Yang saya ukur** = jendela tetap 600/60 s, per-instans, di memori.
- **Yang ada di `main`** = `tokenBucket({capacity: 300, refillPerSecond: 600/60 = 10})`, yang
  akan menolak sekitar permintaan ke-301 pada ledakan cepat, lalu melewatkan 10/s selamanya.
- **Yang ada di produksi**: tidak bisa saya nyatakan dari sini. VPS berada dalam mode
  build-locally (`IMAGE_PREFIX` kosong, terukur), jadi yang jalan adalah apa pun kondisi
  `main` pada deploy terakhir. **Ini sendiri temuan kecil**: tidak ada endpoint yang
  memberi tahu limiter mana yang hidup.

Keduanya, jendela lama maupun bucket baru, **berbagi fungsi kunci yang sama** — dan di situ
masalahnya.

### 2.4 Per-instans, di memori, dan tidak dibagi — dikonfirmasi

`services/gateway-service/src/rate-limit/token-bucket.ts` menyimpan ember di `new Map()` di
dalam proses; komentarnya sudah menyatakannya ("correct for exactly one gateway process. Two
replicas hold two buckets and grant twice the rate between them"). Compose produksi
menjalankan satu `gateway`, tanpa `deploy.replicas`, jadi hari ini pernyataan itu benar dan
tidak ada pembagian antar-instans yang perlu diuji. Yang perlu dicatat: **plafon ini menguap
pada replika kedua**, dan tidak ada apa pun yang akan mengatakannya.

### 2.5 Bypass: tukar `Authorization`, dan embernya baru — TINGGI

`rateLimitKey()` (`gateway.setup.ts:38`) memilih kunci ember dari **kredensial mentah**,
sebelum ada apa pun yang mengautentikasinya:

```ts
const credential = req.headers.authorization ?? readCookie(req, AT_COOKIE);
if (credential) return `t:${createHash('sha256').update(credential).digest('base64url').slice(0, 22)}`;
return `i:${req.ip ?? 'unknown'}`;
```

Komentar di atasnya menulis bahwa lalu lintas anonim "has neither and keeps the IP bucket".
Itu benar hanya untuk penelepon yang **tidak mengirim** header. Mengirim
`Authorization: Bearer <sampah-acak>` juga anonim — dan ia memilih sendiri kunci embernya.

Diukur. Enam permintaan, satu perintah, membaca `RateLimit-Remaining`:

```
anon#1 598   anon#2 597   anon#3 596     <- satu ember per IP, turun
auth#1 599   auth#2 598                  <- token A: ember sendiri
authB#1 599                              <- token B: ember ketiga
```

Lalu 700 permintaan, masing-masing dengan nilai bearer berbeda, dari satu alamat:

```json
{"sent":700,"got429":0,"first429":null,"elapsedMs":2482,"reqPerSec":282}
```

**700 permintaan, nol 429, 282 req/s dari satu IP.** Tanpa header itu, klien yang sama
ditolak pada permintaan ke-599. Plafon tepi, untuk siapa pun yang bersedia menulis satu
header, tidak ada.

**L3-SEC-1 — TINGGI.** Ini berlaku pada `main`, bukan hanya pada image yang berjalan: fungsi
kuncinya tidak berubah di `79c0b8de`.

Yang menutupnya, dan urutannya penting:

1. Kunci pada klaim `sub` **setelah** token diverifikasi, bukan pada byte header sebelumnya.
   Komentar `ponytail:` di fungsi itu sudah menyebut `sub` sebagai alternatif; alasan untuk
   memilihnya ternyata bukan kerapian, tapi ini.
2. Sampai itu terjadi: kredensial yang **belum** terverifikasi harus jatuh ke ember IP, bukan
   mendapat ember sendiri. Satu percabangan, dan ia mengubah bypass menjadi bukan bypass.
3. Uji yang membuktikannya harus di luar proses (dua nilai bearer palsu, satu IP, hitung
   429), karena e2e in-process yang ada sekarang **lulus** dengan perilaku yang salah.

**Tidak saya uji, dengan sengaja:** tingkat OTP
(`/auth/api/v1/auth/(register|login|otp/resend)`). Kodenya memakai kunci `otp:${req.ip}` —
murni alamat — jadi trik di atas **tidak** berlaku di sana, dan itu kabar baik karena jalur
itulah yang mengirim SMS berbayar. Saya tidak menembakkan permintaan ke sana karena satu
register sungguhan berarti satu pesan ke nomor milik seseorang. Menguji jalur itu butuh
kredensial Zenziva sandbox — bukan sesuatu yang boleh saya tebak.

---

## 3. Kapasitas — berapa banyak, dan yang mana patah duluan

### 3.1 Jawabannya, dan itu bukan basis data

**Yang patah duluan adalah throttler NestJS di dalam tiap service, pada 100 permintaan per
60 detik — satu ember untuk SELURUH platform.**

Setiap service memasang `ThrottlerGuard` sebagai `APP_GUARD` dengan
`{ ttl: RATE_LIMIT_TTL_SECONDS*1000, limit: RATE_LIMIT_MAX }`. Default di 17 dari 17 service:

```
for s in product order depot auth customer delivery payment crm dashboard hr admin \
         loyalty promo referral payout recommendation forecast; do
  grep -h "RATE_LIMIT_MAX" services/$s-service/src/config/env.validation.ts | grep -oE "default\([0-9]+\)"
done
-> default(100) ×17,  dan RATE_LIMIT_TTL_SECONDS default(60) ×17
```

Dan compose tidak menimpanya (§2.2). Kuncinya adalah `req.ip`. **Tidak satu pun service
menyetel `trust proxy`** — hanya gateway:

```
grep -rn "trust proxy" --include=*.ts services/ packages/ | grep -v node_modules
-> hanya services/gateway-service/** (kode + test)
```

Tanpa `trust proxy`, `req.ips` kosong dan `req.ip` adalah peer socket — yaitu **kontainer
gateway**, untuk setiap permintaan pelanggan yang pernah masuk. Jadi satu ember 100/60 s
dibagi oleh semua orang.

Dibuktikan, dengan dua alamat klien yang sengaja dibedakan:

```json
{"first429":101,"acceptedFromClientA":50,"acceptedFromClientB":50,
 "verdict":"ONE SHARED BUCKET for both clients"}
```

Dan 429-nya memang datang dari upstream, bukan dari tepi — gateway masih punya 596 token
tersisa pada saat yang sama:

```
HTTP/1.1 429 Too Many Requests
RateLimit-Limit: 600            <- header GATEWAY, masih longgar
RateLimit-Remaining: 596
{"statusCode":429,"code":"RATE_LIMITED","message":"ThrottlerException: Too Many Requests",
 "path":"/api/v1/products?limit=1"}      <- path INTERNAL: ini product-service yang menolak
```

**L3-CAP-1 — KRITIS.**

- Plafon keras: **≤ 6.000 permintaan/jam ke service tersibuk**, untuk seluruh platform
  digabung. Bukan per pengguna, per depot, atau per kurir. Total.
- Konsekuensi kedua, dan lebih buruk dari plafonnya: **penolakan layanan sepele, tanpa
  autentikasi.** Siapa pun yang mengirim 100 permintaan katalog dalam satu menit membuat
  `product-service` menjawab 429 untuk **semua pelanggan** selama sisa jendela itu. Saya
  memicunya dua kali tanpa sengaja, sambil mengukur latensi.
- Panggilan antar-service tidak ikut terjepit: `order → product` berjalan langsung ke
  `http://product:3003`, jadi peer socket-nya adalah kontainer pemanggil dan ia punya ember
  sendiri. Yang terjepit adalah tepatnya lalu lintas manusia.

Yang menutupnya: gateway sudah menjadi satu-satunya pintu masuk dan sudah punya limiter
per-pemanggil. Limiter kedua di dalam setiap service, yang dikunci pada alamat gateway, tidak
menambah proteksi apa pun dan hanya menambah plafon bersama. Pilih satu: (a) buang
`ThrottlerGuard` dari service dan biarkan tepi yang membatasi, atau (b) naikkan limit service
ke angka yang jelas di atas beban puncak dan perlakukan ia sebagai sabuk pengaman anti-loop,
bukan kontrol. Yang **tidak** boleh: menyetel `trust proxy` di 17 service supaya mereka
percaya `X-Forwarded-For` — itu memindahkan pilihan kunci ember ke tangan penelepon, yaitu
L3-SEC-1 dikalikan tujuh belas.

### 3.2 Plafon lain, dan jaraknya

| Plafon                                  | Angka                     | Sumber                                                                          | Jarak dari beban hari ini          |
| --------------------------------------- | ------------------------- | ------------------------------------------------------------------------------- | ---------------------------------- |
| Throttler per service (semua pengguna)  | **100 / 60 s**            | terukur, §3.1                                                                   | **inilah yang mengikat**           |
| `readAllPages` — laporan menolak jendela | **20.000 baris**          | `docs/QUERY_BOUNDS.md`: `max: 20_000`, `onOverflow` → `ReportRangeTooLargeError` | 813 pesanan di seluruh cluster     |
| `findMany` tanpa `take`                 | dipotong pada **500**     | `queryBoundsMiddleware` (`@hydromart/platform`)                                  | jauh                               |
| Kolam koneksi Prisma                    | 17 × `DB_POOL=5` = **85** | `docker-compose.prod.yml:73-92`                                                  | 62 backend saat idle               |
| `max_connections` server                | **150** (3 disisihkan)    | `SHOW max_connections` → 150                                                    | sisa ~62 untuk psql/dump/exporter  |
| Memori per kontainer service            | 512 MB, `cpus: 1.0`       | anchor `*svc`                                                                   | tidak diukur                       |
| Postgres                                | 2 GB, `cpus: 2.0`, `shared_buffers=128MB` | prod compose + `SHOW shared_buffers`                            | tidak diukur                       |

Beban terukur hari ini (`SELECT count(*)`, per basis data):

```
depots=66   orders=813   deliveries=153   employees=151   cluster=168 MB
notifications=3033   order_status_history=2592   audit_logs(hr)=2237   audit_logs(auth)=2010
otp_tokens=772   stock_reservations=787   consent_records=668   refresh_tokens=554
delivery_status_history=491   vouchers=224   products=103   proofs_of_delivery=76
```

Indeks yang diaudit **ada dan datanya bersih** — ini dijalankan, tidak diasumsikan:

```
bash scripts/verify-indexes.sh
-> PASS — all audit indexes present and data is clean. (exit 0)
   orders_createdAt_idx, orders_status_createdAt_idx, orders_depotId_createdAt_idx,
   deliveries_deliveredAt_idx, deliveries_depotId_deliveredAt_idx, + 4 partial unique
```

Latensi baca lewat gateway, **laptop, 99 sampel, BUKAN baseline** (`docs/perf/BASELINE.md`
memutuskan bahwa angka laptop tidak sebanding dengan VPS; ini hanya orde besaran, supaya audit
ini melaporkan sesuatu yang terukur alih-alih "belum pernah diukur"):

| Endpoint                                 | min     | p50     | p95     | max      |
| ---------------------------------------- | ------- | ------- | ------- | -------- |
| `GET /products/api/v1/products?limit=20` | 19,0 ms | 28,0 ms | 64,8 ms | 287,2 ms |
| `GET /depots/api/v1/depots`              | 19,7 ms | 24,0 ms | 42,1 ms | 161,1 ms |

### 3.3 Gerbang beban tidak bisa melihat plafon yang mengikat

`.github/workflows/load.yml` berjalan tiap Minggu 02:00 WIB terhadap stack yang ia boot
sendiri dari `docker-compose.test.yml` — dan berkas itu menyetel:

```
docker-compose.test.yml:33  RATE_LIMIT_MAX: 1000000
docker-compose.test.yml:34  RATE_LIMIT_BURST_MAX: 1000000
```

Jadi uji beban mingguan mengukur konfigurasi yang **tidak ada di produksi**, dengan plafon
yang mengikat (L3-CAP-1) dinaikkan 10.000×. Ambangnya pun relatif terhadap dirinya sendiri:
`CHECKOUT_P95_MS=1500` pada 10 VU, `FRANCHISE_P95_MS=2000` dan `PERFORMANCE_P95_MS=3000` pada
5 VU. Ia mendeteksi regresi fan-out — itu tugasnya dan ia melakukannya — tapi ia **secara
struktural tidak bisa** menemukan atap.

Dan tabel hasilnya masih kosong: `docs/perf/BASELINE.md` → `| _not yet run_ | | | | |`.

**L3-CAP-2 — SEDANG.** Yang menutupnya bukan mengubah workflow beban (mematikan limiter di
sana adalah keputusan yang benar untuk mengukur fan-out). Yang kurang adalah **skenario
kedua**: satu run dengan konfigurasi limiter produksi, yang tugasnya justru berhenti pada 429
pertama dan **melaporkan pada permintaan ke berapa**. Itu angka atap, dan ambangnya satu
baris: "429 pertama harus datang setelah N permintaan".

### 3.4 Yang belum bisa dijawab, dan satu ukuran yang menyelesaikannya

Saya tidak bisa menyatakan "berapa depot / kurir / pesanan per jam" sebagai angka bisnis dari
sini, dan menebaknya akan menjadi tepatnya jenis angka yang dokumen ini ada untuk
menggantikan. Yang bisa saya lakukan adalah mereduksi tiap pertanyaan menjadi **satu** ukuran:

| Tidak diketahui                | Satu ukuran yang menyelesaikannya                                                                                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pesanan/jam sebelum patah      | Permintaan ke service tersibuk **per pesanan selesai** (hitung dari log gateway selama satu checkout skrip). Plafon = 6.000 ÷ angka itu, sampai L3-CAP-1 diperbaiki.                                                          |
| Depot maksimum                 | p95 dashboard pemilik pada N depot, N = 1/10/50/100, terhadap salinan berbibit. Fan-out sudah rata secara teori (S-1: 3 HTTP untuk N depot) dan itu **belum pernah** dijalankan pada N besar.                                  |
| Kurir maksimum                 | Ping GPS/menit × jumlah kurir vs plafon `delivery-service`. Ping sudah murah (S-17); plafonnya tetap 100/60 s bersama.                                                                                                        |
| Kapan Postgres jadi pengikat   | k6 pada VPS-class dengan L3-CAP-1 dinaikkan, sambil membaca `pg_stat_activity` dan `pg_stat_statements`. Sampai plafon throttler diangkat, basis data **tidak akan pernah** menjadi pengikat — jadi ukuran ini harus menunggu. |
| Kapan laporan bulanan menolak  | Sudah pasti: 20.000 baris dalam jendela. Untuk satu depot dengan 55 pesanan/hari, itu jatuh di tahun pertama. Tidak butuh uji beban — butuh keputusan apakah menolak adalah perilaku yang benar pada skala itu.                |

---

## 4. Retensi dan penghapusan di luar jalur bukti pengiriman

Ada dua mesin, dan keduanya nyata. Yang tidak pernah dienumerasi adalah **apa yang berada di
luar keduanya**. Itulah temuan bagian ini.

### 4.1 Mesin pertama: sweep retensi nightly

`scripts/scheduler/crontab:68` → `30 3 * * *` → `POST admin:3017 retention/internal/purge`.
`PurgeService.run()` membaca `retention_policies`, mencari eksekutor per dataset, dan
melaporkan yang tidak punya sebagai `UNENFORCED` alih-alih melewatkannya diam-diam.
Desainnya sudah jujur; yang belum pernah dibaca adalah hasilnya.

Kebijakan di basis data hidup (8 baris):

```
psql -d hydromart_admin -c 'SELECT dataset, "dataClass", "windowDays" FROM retention_policies ORDER BY 1;'
```

| dataset                  | dataClass   | windowDays | Eksekutor?                                              |
| ------------------------ | ----------- | ---------- | ------------------------------------------------------- |
| `audit_logs`             | OPERATIONAL | 734        | ✅ DELETE → auth-service                                 |
| `hr_employee_records`    | HR          | 1825       | ✅ DELETE → hr-service (anonimisasi)                      |
| `hr_face_embeddings`     | HR          | 30         | ✅ DELETE → hr-service                                    |
| `log_audit`              | OPERATIONAL | 730        | ❌ **UNENFORCED** — tidak ada eksekutor dengan nama ini    |
| `notifications_messages` | MARKETING   | 90         | ✅ DELETE → crm-service                                   |
| `orders_transactions`    | FINANCIAL   | 3650       | — EXEMPT, memang tidak pernah dihapus                     |
| `pesanan`                | OPERATIONAL | 2555       | ❌ **UNENFORCED**                                         |
| `proof_of_delivery`      | OPERATIONAL | 365        | ✅ DELETE → delivery-service                              |

Eksekutor terdaftar: 5, dari
`services/admin-service/src/infrastructure/http/purge-executor.registry.ts`.

**L3-RET-3 — SEDANG.** Dua pasang baris menggambarkan data yang sama dengan aturan berbeda:
`audit_logs` (734 hari) vs `log_audit` (730 hari), dan `orders_transactions` (FINANCIAL, kebal
purge) vs `pesanan` (OPERATIONAL, 2555 hari, **boleh** dihapus). Konsol menampilkan keduanya.
Yang menang adalah yang punya eksekutor — jadi hari ini pesanan aman karena `pesanan` tidak
punya eksekutor, bukan karena aturannya benar. Tambahkan eksekutor bernama `pesanan` dan Anda
punya jalur yang menghapus pesanan berumur 7 tahun sementara baris di sebelahnya bersumpah
menyimpannya 10 tahun.
*Catatan kejujuran:* ini terlihat di cluster **dev lokal**. Jalankan query yang sama di
produksi sebelum memperbaikinya; kalau di sana bersih, yang perlu diperbaiki adalah bibitnya.

**L3-RET-1 — TINGGI, dan ini angka intinya.** Cluster punya **149 tabel** (di luar
`_prisma_migrations`), dihitung per basis data:

```
admin 18, auth 7, crm 8, customer 7, delivery 8, depot 27, forecast 6, hr 28,
loyalty 5, order 9, payment 2, payout 9, product 2, promo 5, recommendation 5, referral 3
```

Delapan dataset punya kebijakan. **141 tabel tidak punya kebijakan sama sekali** — bukan
"tidak ditegakkan", tapi tidak pernah diklasifikasikan. Yang paling perlu dijawab, dengan
jumlah baris hari ini:

| Tabel                                       |     Baris | Mengapa ia butuh keputusan                                                        |
| ------------------------------------------- | --------: | --------------------------------------------------------------------------------- |
| `auth.otp_tokens` (`targetPhone`)           |       772 | kode OTP + nomor telepon, disimpan selamanya; kegunaannya berakhir dalam menit     |
| `auth.refresh_tokens`                       |       554 | keluarga sesi; tidak ada jendela                                                  |
| `auth.consent_records`                      |       668 | **bukti** consent — mungkin memang harus abadi, tapi itu keputusan yang belum ditulis |
| `hr.audit_logs`                             |     2.237 | eksekutor `audit_logs` menunjuk **AUTH_SERVICE_URL**; jejak audit HR tidak tersentuh |
| `order.order_status_history`                |     2.592 | tumbuh per transisi status, per pesanan, tanpa batas                              |
| `delivery.delivery_status_history`          |       491 | idem, untuk pengiriman                                                            |
| `delivery.shifts` (`checkInLat/Lng`)        |       135 | **lokasi staf**, di luar jalur PoD                                                |
| `delivery.contact_attempts`                 |        58 | riwayat kontak ke pelanggan                                                       |
| `delivery.field_incidents` (`lat/lng`)      |        15 | lokasi + narasi insiden                                                           |
| `admin.support_tickets` / `ticket_messages` |   14 / 14 | teks bebas dari pelanggan, dengan `customerPhone`                                  |
| `admin.export_logs` (`requestedByEmail`)    |        13 | siapa mengekspor apa                                                              |
| `crm.web_push_subscriptions`                |        18 | endpoint perangkat milik satu orang                                               |
| `hr.attendance`, `hr.employee_documents`    |   73 / 18 | di bawah `hr_employee_records`? Hanya jika pegawainya **keluar**; tidak ada jendela untuk yang masih bekerja |

Titik paling terang di seluruh bagian ini: **`proof_of_delivery` punya jendela 365 hari dan
eksekutor yang berjalan. Data lokasi di luar PoD — `shifts.checkInLat/checkOutLat`,
`deliveries.lastLat/lastLng`, `field_incidents.lat/lng` — tidak punya keduanya.** Itu
persisnya kalimat yang rencana L3 tulis, sekarang dengan nama tabel dan jumlah barisnya.

Kolom lokasi, dihitung, bukan diingat:

```
psql -d hydromart_delivery -c "SELECT table_name||'.'||column_name FROM information_schema.columns
  WHERE table_schema='public' AND (column_name ILIKE '%lat%' OR column_name ILIKE '%lng%' …)"
-> deliveries.destinationLat/Lng, deliveries.lastLat/Lng, field_incidents.lat/lng,
   proofs_of_delivery.latitude/longitude, shifts.checkInLat/Lng, shifts.checkOutLat/Lng
```

Satu dari enam pasang tercakup.

### 4.2 Mesin kedua: penghapusan atas permintaan (UU PDP)

Alur: `DataSubjectService.approve()` → `customerData.anonymise()` (customer-service) +
`requests.anonymiseCustomer()` (auth-service), lalu untuk staf `hr.anonymiseEmployee()`.
Yang benar-benar ditulis, dari `PdpPrismaRepository.anonymise()`:

- `customer.addresses` → `recipientName`, `phone`, `notes` ditimpa
- `customer.saved_payment_methods`, `favorites`, `notification_preferences` → dihapus
- `customer.customer_profiles` → `birthdate`, `lastBirthdayRewardYear` dinolkan
- `auth.customers` → identitas anonim, status `DELETED`

**L3-RET-2 — TINGGI.** Enumerasi setiap kolom di cluster yang memegang nama/telepon/email,
lalu silang dengan daftar di atas:

```
for db in auth customer crm delivery order admin loyalty referral promo payout depot; do
  psql -d hydromart_$db -c "SELECT table_name||'.'||column_name FROM information_schema.columns
    WHERE table_schema='public'
      AND column_name ~* '(phone|whatsapp|email|^nik|recipient|customerName|fullName|nama)'"
done
```

Yang **tidak** disentuh oleh penghapusan, padahal masih memegang orang itu:

| Kolom                                       | Baris | Catatan                                                                        |
| ------------------------------------------- | ----: | ------------------------------------------------------------------------------ |
| `auth.otp_tokens.targetPhone`               |   772 | nomor yang persis ingin dilupakan orang itu                                    |
| `crm.notifications.phone`                   | 3.033 | riwayat pesan, per nomor                                                       |
| `crm.campaign_recipients.phone`             |    17 | daftar penerima kampanye                                                       |
| `delivery.deliveries.recipientPhone`        |   153 | tidak dianonimkan, tidak disebut sebagai dikecualikan                          |
| `delivery.proofs_of_delivery.recipientName` |    76 | ada jendela 365 hari — jadi ia hilang **suatu hari**, bukan saat diminta        |
| `admin.support_tickets.customerPhone`       |    14 | plus teks bebas di `ticket_messages`                                           |
| `depot.order_disputes.customerName`         |    18 | snapshot nama di service lain                                                  |
| `order.subscriptions.phone`/`recipientName` |    21 | **instruksi masa depan yang masih aktif**, bukan catatan sejarah                |
| `customer.reseller_profiles`                |     0 | dibaca oleh `exportFor()` sebagai data pribadi, **tidak** ada di `anonymise()`  |

`order.orders.phone`/`recipientName`/`driverPhone` (813 baris) **memang** disengaja: payload
ekspor menyatakannya di `notIncluded`, kelas FINANCIAL, 10 tahun. Itu keputusan yang tertulis
dan saya tidak menyebutnya cacat. Sembilan baris di tabel atas tidak punya kalimat seperti itu
di mana pun.

Dua yang paling tajam:

- `order.subscriptions` bukan sejarah. Ia adalah langganan yang masih akan mengirim air ke
  nomor telepon yang pemiliknya sudah meminta dihapus.
- `customer.reseller_profiles` diekspor sebagai data pribadi oleh kode yang sama yang tidak
  menganonimkannya. Satu berkas, dua metode, satu tabel terlewat.

Yang menutupnya: daftar itu, di satu tempat, sebagai kontrak — persis seperti
`purge-executor.registry.ts` melakukannya untuk retensi ("dataset absen dari daftar ini
dilaporkan UNENFORCED, bukan dilewatkan diam-diam"). Penghapusan tidak punya registry
setaranya; ia punya satu metode `anonymise()` yang tidak tahu tabel apa yang tidak
diketahuinya.

---

## 5. Tinjauan legal — artefak apa yang ada, dan tanda tangan apa yang kurang

Bagian ini **tidak memberi nasihat hukum**. Ia mendaftar apa yang ada di repo, apa yang
terukur di stack, dan siapa yang harus menandatangani apa.

### 5.1 Tabel TER (PPh 21) — dan ia bahkan belum menyala

Artefak: `services/hr-service/reference/pph21-ter-pmk-168-2023.json` — tiga tabel PMK 168/2023
(kategori A/B/C), 508 baris JSON, bentuknya dibuktikan oleh
`services/hr-service/test/unit/ter-table-reference.spec.ts`. `setting-defs.ts:215` menyatakan
statusnya dengan jelas: "It is a reference, NOT a default: nothing loads it".

Yang belum pernah diperiksa siapa pun adalah apakah ia dimuat. Terukur:

```
psql -d hydromart_hr -c "SELECT key, scope, length(value) FROM service_settings ORDER BY key;"
-> geofenceRadiusM|DEPOT|1
```

**Tidak ada baris `pph21TerTableJson`.** Jadi di stack ini `pph21Monthly()` melewati cabang
TER dan memakai estimasi progresif tahunan
(`services/hr-service/src/domain/statutory.ts:271` dan seterusnya) — metode yang PMK 168/2023
gantikan untuk pemotongan bulanan.

**L3-LEG-1 — TINGGI.** Ada dua hal terpisah di sini dan keduanya butuh pemilik:

1. **Tanda tangan akuntan atas angka di berkas rujukan** — ini yang `LEGAL_OPEN_ITEMS.md` §2
   sudah sebut. Belum ada.
2. **Keputusan apakah ia dipakai sama sekali.** Selama setelan itu kosong, payroll memakai
   metode lain — dan tidak ada satu pun peringatan yang mengatakannya. Baris log `error` hanya
   muncul jika JSON-nya **tidak valid**; JSON yang **tidak ada** sepenuhnya senyap.

Yang menutupnya: **jangan** memuat berkas itu sebagai default (dokumen ini tidak
merekomendasikan itu, dan komentar di `setting-defs.ts` menjelaskan alasannya dengan benar).
Yang dibutuhkan: nama akuntan + tanggal peninjauan, lalu satu tindakan menempelkan tabelnya,
lalu satu payslip yang dihitung dua kali dan dicocokkan. Sampai itu terjadi, angka payroll
adalah hitungan yang masuk akal, bukan hitungan yang dipertanggungjawabkan — dan sekarang kita
tahu ia bahkan bukan hitungan yang **metodenya** sesuai regulasi.

### 5.2 Bukti persetujuan UU PDP — belum pernah diuji pihak ketiga

Yang ADA, dan hidup: `auth.consent_records` (**668 baris** terukur),
`auth.data_subject_requests` (0 baris — belum pernah ada permintaan), audit
`pdp.request.created` / `.exported` / `.anonymised` / `staff.account.deleted`, ekspor yang
dibangun saat diminta (tidak disimpan, supaya tidak ada salinan kedua untuk bocor), dan aturan
"belum pernah ditanya ≠ menolak".

Yang BELUM: siapa pun di luar tim ini memeriksa apakah **bentuk** buktinya cukup bila diminta.

**L3-LEG-2 — SEDANG. PEMILIK: belum ada.** Yang dibutuhkan adalah tinjauan pihak ketiga atas
tiga pertanyaan konkret, bukan audit umum: (a) apakah ledger consent membuktikan *apa* yang
disetujui, bukan hanya *bahwa* disetujui; (b) apakah `notIncluded` pada ekspor adalah dasar
yang sah untuk menahan riwayat pesanan; (c) apakah anonimisasi-bukan-penghapusan memenuhi
permintaan penghapusan. Ketiganya adalah keputusan yang sudah diambil dan didokumentasikan;
tak satu pun pernah dinilai dari luar.

Temuan L3-RET-2 di atas adalah masukan langsung untuk tinjauan itu: sembilan tabel masih
memegang nomor telepon atau nama orang yang sudah dihapus.

### 5.3 PPN dan faktur ritel — tidak berubah, masih tanpa pemilik

Dibawa apa adanya dari `docs/LEGAL_OPEN_ITEMS.md` §1 (N15), yang tetap akurat: harga
diperlakukan non-PPN, tidak ada baris pajak di quote/struk/laporan mana pun, tidak ada nomor
seri faktur, tidak ada NPWP pembeli, tidak ada e-Faktur. Keputusan itu **hanya benar selama
depot memang bukan PKP**.

**L3-LEG-3 — SEDANG. PEMILIK: belum ada.** Audit ini tidak menambah apa pun selain menegaskan
bahwa ia masih tanpa pemilik pada 2026-08-25, dan mengulang peringatan §1: jangan menambahkan
baris PPN ke kode sebelum pertanyaan "apakah ada depot yang melewati ambang PKP" dijawab.

---

## 6. Yang TIDAK bisa saya audit dari sini, dan mengapa

Ditulis eksplisit supaya tidak ada baris di atas yang terbaca lebih kuat dari seharusnya.

1. **Perilaku produksi.** Tidak satu pun permintaan dikirim ke VPS. Semua angka rate-limit,
   latensi dan kapasitas berasal dari stack lokal. Yang berjalan di produksi adalah build
   lokal dari `main` pada deploy terakhir (`IMAGE_PREFIX` kosong, terukur), yang berarti
   **limiter mana yang hidup di sana tidak diketahui** — jendela tetap 600/60 s, atau token
   bucket 300 + 10/s.
2. **Jadwal cron produksi.** Saya membaca `install-host-cron.sh` (sumber kebenarannya), bukan
   `crontab -l` di kotaknya. Kalau blok itu belum pernah dipasang di sana, seluruh §1.1 salah
   ke arah yang lebih buruk, bukan lebih baik. **Satu perintah menutup ini:**
   `crontab -l | sed -n '/>>> hydromart/,/<<< hydromart/p'` di VPS.
3. **Waktu restore pada volume produksi.** 46 detik itu untuk dump 4,6 MB. Prod lebih besar
   dengan faktor yang saya tidak tahu. Angkanya harus diambil ulang di sana, dan itu satu
   perintah: `time BACKUP_DIR=… bash scripts/restore-db.sh --drill`.
4. **Apakah salinan luar-kotak aktif.** `BACKUP_S3_BUCKET` diset atau tidak hanya terlihat di
   `.env` kotak itu. Tidak terdokumentasi di berkas contoh mana pun (terukur: 0 kecocokan),
   jadi kemungkinan terbesarnya tidak — tapi itu dugaan, dan saya menandainya sebagai dugaan.
5. **Tingkat OTP.** Tidak diuji, sengaja: satu register sungguhan mengirim satu SMS berbayar
   ke nomor milik seseorang.
6. **Ambang PKP dan angka pajak.** Bukan hal yang bisa diukur dari kode, dan bukan hal yang
   boleh saya tebak.
7. **Baris kebijakan retensi produksi.** Tabel §4.1 dibaca dari cluster **dev**. Duplikat
   `pesanan`/`log_audit` mungkin polusi bibit lokal. Query yang sama di prod menyelesaikannya.
8. **Apakah 100/60 s benar-benar mengikat di produksi.** Ia mengikat di sini, dan compose
   produksi tidak menimpanya, jadi ia seharusnya mengikat di sana juga. Yang membuktikannya
   satu permintaan berulang ke satu endpoint baca di prod — dan itu berarti sengaja
   menjatuhkan layanan satu service selama satu menit, jadi lakukan di luar jam operasi atau
   di staging.

---

## 7. Apa yang menutup tiap temuan, diurutkan menurut biaya

| #  | Tindakan                                                                                      | Menutup           | Biaya                                      |
| -- | --------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------ |
| 1  | Isi tabel rota on-call, dan jalankan `check-oncall-rota.mjs` di CI                             | L3-DR-4, L3-DR-4b | satu commit                                |
| 2  | Kredensial yang belum terverifikasi jatuh ke ember IP, bukan ember sendiri                      | L3-SEC-1          | satu percabangan + satu uji di luar proses  |
| 3  | Teruskan `RATE_LIMIT_*` di anchor `*shared`; samakan `.env.example` dengan default sebenarnya   | L3-SEC-2          | satu baris compose                          |
| 4  | Buang `ThrottlerGuard` dari 17 service (tepi sudah membatasi), atau naikkan limitnya jauh       | **L3-CAP-1**      | kecil di kode, besar dalam keputusan        |
| 5  | Bandingkan migrasi drill dengan himpunan di dalam dump, bukan dengan live                       | L3-DR-2           | satu fungsi                                 |
| 6  | Mode drill kedua yang tidak butuh cluster hidup                                                | L3-DR-3           | satu fungsi                                 |
| 7  | Registry penghapusan PDP, dengan 9 tabel di §4.2 sebagai barisnya                              | L3-RET-2          | sedang                                      |
| 8  | Klasifikasikan 141 tabel; mulai dari 13 baris di §4.1                                          | L3-RET-1          | sedang, dan butuh keputusan bisnis           |
| 9  | `archive_mode=on` + arsip WAL ke NEO; set `BACKUP_S3_BUCKET`                                   | L3-DR-1           | sedang + biaya bulanan                      |
| 10 | Skenario beban kedua dengan limiter produksi, ambangnya "429 pertama setelah N"                 | L3-CAP-2          | sedang                                      |
| 11 | Nama + tanggal untuk: akuntan (TER), penguji PDP pihak ketiga, pemilik PPN ritel                | L3-LEG-1/2/3      | bukan pekerjaan kode                        |

Setiap baris di dokumen ini yang mendapat pemilik dan tanggal harus keluar dari sini dan masuk
ke tempat yang mengikat — kode, kontrak, atau kebijakan. Aturan yang sama yang
`docs/LEGAL_OPEN_ITEMS.md` tulis untuk dirinya sendiri berlaku di sini: audit yang isinya tetap
lengkap setelah setahun adalah audit yang tidak dibaca siapa pun.

---

## Lampiran — setiap perintah yang menghasilkan angka di atas

```bash
# —— DR ——
bash scripts/install-host-cron.sh --show                 # jadwal sebenarnya (bukan komentar)
docker exec hydromart-postgres psql -tAX -U hydromart -d postgres -c "SHOW wal_level;"        # replica
docker exec hydromart-postgres psql -tAX -U hydromart -d postgres -c "SHOW archive_mode;"     # off
docker exec hydromart-postgres psql -tAX -U hydromart -d postgres -c "SHOW archive_command;"  # (disabled)
time docker exec hydromart-postgres pg_dumpall -U hydromart | gzip > /tmp/d.sql.gz            # 6 s
time BACKUP_DIR=/tmp bash scripts/restore-db.sh --drill                                       # 80 s
node scripts/check-oncall-rota.mjs; echo $?                                                   # 1
grep -rn "check-oncall-rota" .github/workflows/                                               # kosong
grep -c BACKUP .env.example .env.production.example                                            # 0 0

# —— Rate limit di tepi (jalur read-only, 404 dari catch-all gateway) ——
curl -sD - -o /dev/null http://localhost:8080/l3-rate-limit-probe | grep -i ratelimit         # 600;w=60
# 600 permintaan berurutan tanpa header             -> 429 pertama di #599, Retry-After 20
# 700 permintaan, Authorization: Bearer <unik> tiap  -> 0x429, 282 req/s
docker inspect hydromart-gateway-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -i rate  # kosong
grep -rn "RATE_LIMIT" docker-compose.yml docker-compose.prod.yml                              # kosong

# —— Kapasitas ——
# 2 alamat klien berbeda, bergantian -> 429 pertama di #101 (50 diterima per klien)
curl -s http://localhost:8080/products/api/v1/products?limit=1   # body 429: ThrottlerException
grep -rn "trust proxy" --include=*.ts services/ packages/ | grep -v node_modules   # hanya gateway
docker exec hydromart-postgres psql -tAX -U hydromart -d postgres -c "SHOW max_connections;"  # 150
docker exec hydromart-postgres psql -tAX -U hydromart -d postgres \
  -c "SELECT count(*) FROM pg_stat_activity;"                                                 # 62 idle
bash scripts/verify-indexes.sh                                                                # PASS, exit 0

# —— Retensi ——
docker exec hydromart-postgres psql -X -U hydromart -d hydromart_admin \
  -c 'SELECT dataset, "dataClass", "windowDays" FROM retention_policies ORDER BY 1;'          # 8 baris
cat services/admin-service/src/infrastructure/http/purge-executor.registry.ts                 # 5 eksekutor
# jumlah tabel per basis data, kolom lokasi, kolom nama/telepon: lihat §3.2, §4.1, §4.2

# —— Legal ——
docker exec hydromart-postgres psql -tAX -U hydromart -d hydromart_hr \
  -c "SELECT key, scope FROM service_settings ORDER BY key;"      # tidak ada pph21TerTableJson
```
