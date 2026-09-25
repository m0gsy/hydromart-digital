# Pemulihan bencana — kotaknya hilang seluruhnya

Dokumen ini untuk satu skenario: **VPS-nya tidak ada lagi.** Volume mati, VM terhapus, akun
di-suspend, ransomware. Bukan "satu service crash" — itu urusan watchdog dan restart policy.

Ditulis karena sampai 2026-08-31 prosedurnya hanya ada di kepala orang. `grep -rn 'into-prod'
docs/` cuma menemukan dua kalimat yang mengeluhkan bahwa ia tak pernah dilatih.

Baca sekali sekarang, saat tidak sedang terjadi. Yang kedua kalinya Anda akan membacanya
dengan tangan gemetar.

---

## Apa yang Anda punya, dan apa yang tidak

| Ada                                                            | Di mana                                           | Sedalam apa                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Dump seluruh cluster, tiap malam 03:00                         | `s3://hydromart-backup/db/`                       | 14 malam (`BACKUP_KEEP`)                                                                                                 |
| `.env` terenkripsi, tiap malam 03:25                           | `s3://hydromart-backup/env/`                      | 14 malam                                                                                                                 |
| Berkas objek (foto PoD, bukti transfer, dll), tiap malam 03:40 | `s3://hydromart-backup/objects/<bucket>/`         | salinan `pod/` dan `payment-proof/` kedaluwarsa **395 hari** (12 bulan janji privasi + 1 bulan); sisanya tidak dipangkas |
| Kode                                                           | GitHub, `main`                                    | seluruh riwayat                                                                                                          |
| Image per commit                                               | `ghcr.io/m0gsy/hydromart-digital-<service>:<sha>` | selama GHCR menyimpannya                                                                                                 |

**Yang TIDAK ada, dan harus Anda tahu sebelum mulai:**

- **Berkas objek kini disalin, tapi masih di penyedia yang sama.** `scripts/backup-objects.mjs`
  menyalin SEMUA bucket objek (auth, product, delivery, hr — customer dan payment ikut bucket
  auth) ke `s3://hydromart-backup/objects/<bucket>/` tiap malam 03:40, dan menyalakan
  versioning di bucket asalnya. Yang belum tertutup: salinan itu masih di BiznetGio.
  **Kehilangan AKUN NEO tetap kehilangan keduanya sekaligus.**
- **RPO 24 jam.** Tidak ada WAL archiving. Kehilangan volume pukul 02:59 membuang hampir
  sehari penuh pesanan dan setoran kurir. Tidak ada cara memulihkannya.
- **RTO penuh belum pernah diukur.** Yang terukur: drill mingguan memulihkan dump terbaru ke kluster
  scratch di kotak yang sama — 21 Sep 2026, 131 MB dalam 14 detik (35 detik dengan verifikasi 16 database
  terhadap yang hidup). Itu bukan RTO: kotak baru, dekripsi env, penarikan image, dan pemulihan objek
  belum pernah diulang. Angka di bawah adalah urutan langkah, bukan janji durasi.

---

## Yang Anda butuhkan sebelum bisa mulai

1. **Kunci privat `.env`** — `hydromart-env-private.pem`. **Tidak ada di server, itu memang
   intinya.** Tanpa ini, dump-nya bisa dipulihkan tapi tidak ada yang tahu konfigurasinya.
2. **Kredensial NEO Object Storage** — untuk mengunduh dari `hydromart-backup`.
3. **Akses GitHub** — untuk kode dan image.
4. **Sebuah kotak baru** dengan Docker + Docker Compose v2.

Kalau nomor 1 hilang, berhenti dan baca bagian terakhir dokumen ini.

---

## Langkah

### 1. Ambil kedua artefak

Dari mesin mana pun yang punya kredensial NEO:

```bash
# Daftar apa yang ada, dan pilih malam yang Anda percayai
aws --endpoint-url https://nos.jkt-1.neo.id s3 ls s3://hydromart-backup/db/
aws --endpoint-url https://nos.jkt-1.neo.id s3 ls s3://hydromart-backup/env/

aws --endpoint-url https://nos.jkt-1.neo.id s3 cp s3://hydromart-backup/db/hydromart-<TANGGAL>.sql.gz .
aws --endpoint-url https://nos.jkt-1.neo.id s3 cp s3://hydromart-backup/env/env-<TANGGAL>.enc .
```

Ambil `.env` dari malam **yang sama atau lebih baru** daripada dump-nya. Konfigurasi yang lebih
tua bisa menunjuk ke hal yang belum ada saat itu.

### 2. Buka `.env`

```bash
openssl smime -decrypt -binary -inform DER -in env-<TANGGAL>.enc \
  -inkey hydromart-env-private.pem -out .env
```

Kalau ini gagal, kunci privatnya salah dan tidak ada jalan lain — enkripsinya asimetris,
justru supaya kotak yang jatuh tidak membawa kunci pembukanya.

Sertifikat publik yang dipakai kotak ada di repo (`ops/env-backup-public.pem`, dibuat 2026-09-25,
berlaku sampai 2036); pasangan pribadinya dibuat di laptop pemilik dan **harus dipindahkan ke
password manager** — bukan disimpan di laptop itu saja. Untuk membuktikan salinan malam ini ada dan
terbaca: **Actions → Deploy → mode `backup-env`**.

### 3. Siapkan kotak baru

```bash
git clone https://github.com/m0gsy/hydromart-digital.git hydromart
cd hydromart
cp /path/ke/.env .env
```

Periksa sebelum lanjut — nilai yang menunjuk ke mesin lama akan gagal diam-diam:

```bash
bash scripts/env-doctor.sh --inspect
grep -E '^(WEB_DOMAIN|API_DOMAIN|IMAGE_PREFIX)=' .env
```

### 4. Nyalakan hanya Postgres, lalu pulihkan

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres
CONFIRM=RESTORE bash scripts/restore-db.sh --into-prod hydromart-<TANGGAL>.sql.gz
```

`--into-prod` menolak berjalan tanpa `CONFIRM=RESTORE`, dan mencetak durasinya di akhir. Angka
itu adalah RTO Anda yang sebenarnya — catat.

### 5. Nyalakan sisanya

```bash
bash scripts/deploy.sh --all
```

Dengan `IMAGE_PREFIX` terisi ini menarik image per-commit dan memakan menit. Tanpa itu ia
**membangun 19 image di kotak yang baru lahir** dan memakan puluhan menit — lihat "Registry
mode" di `DEPLOY.md`.

### 6. Kembalikan berkas objeknya

```bash
node scripts/backup-objects.mjs --restore --dry-run   # lihat dulu, selalu
node scripts/backup-objects.mjs --restore
```

Database memulihkan BARIS yang menunjuk ke foto; langkah ini memulihkan fotonya. Tanpa ini
setiap pesanan lama punya bukti pengantaran dan bukti transfer yang mengarah ke berkas yang
tidak ada — dan itu baru ketahuan saat ada sengketa, bukan hari ini.

`--restore` hanya menulis key yang **belum ada** di bucket hidup. Ia tidak pernah menimpa: kalau
bucket-nya hilang sebagian, salinan lama tidak boleh mengubur yang masih selamat.

### 7. Buktikan, jangan berasumsi

```bash
curl -s https://<API_DOMAIN>/health
bash scripts/smoke.sh
bash scripts/check-backup-freshness.sh
```

Yang terakhir penting: kotak baru belum punya cron. Jalankan
`bash scripts/install-host-cron.sh`, atau backup berikutnya tidak akan pernah terjadi dan
Anda akan mengulangi hari ini tanpa jaring.

---

## Lembar latihan saat pindah VPS

Keputusan pemilik 2026-09-25: latihan "kotak hilang seluruhnya" dijalankan **sekali, saat pindah VPS**, di
kotak baru **sebelum DNS dipindahkan**. Pindah VPS adalah satu-satunya kesempatan yang tak perlu
dibuat-buat. Isi kolom kanan sambil berjalan; selisih antara perkiraan dan kenyataan adalah temuannya.

| #   | Langkah (bagian di atas)                                                 | Mulai | Selesai | Durasi | Perkiraan | Lulus jika                                    |
| --- | ------------------------------------------------------------------------ | ----- | ------- | ------ | --------- | --------------------------------------------- |
| 1   | Ambil dump + `.env` terenkripsi dari bucket (langkah 1)                  |       |         |        | 5 mnt     | kedua berkas ada, ukuran wajar                |
| 2   | Buka `.env` dengan kunci privat dari password manager (2)                |       |         |        | 2 mnt     | `.env` terbaca; `env-doctor --inspect` bersih |
| 3   | Siapkan kotak: clone, `.env`, periksa nilai yang menunjuk mesin lama (3) |       |         |        | 15 mnt    | tak ada nilai menunjuk IP/host lama           |
| 4   | Postgres saja, lalu `restore-db.sh --into-prod` (4)                      |       |         |        | 10 mnt    | angka durasi tercetak; 16 database cocok      |
| 5   | `deploy.sh --all` dengan image dari registry (5)                         |       |         |        | 10 mnt    | semua container `healthy`                     |
| 6   | `backup-objects.mjs --restore` (6)                                       |       |         |        | 5 mnt     | jumlah objek sama dengan bucket lama          |
| 7   | `smoke.sh`, `check-backup-freshness.sh`, pasang cron (7)                 |       |         |        | 10 mnt    | smoke hijau; cron terpasang                   |
| 8   | Ubah DNS, tunggu propagasi, cek `/health` dari luar                      |       |         |        | 30 mnt    | Uptime hijau dari GitHub                      |
|     | **Total (RTO yang sebenarnya)**                                          |       |         |        | ~90 mnt   | dicatat di dokumen ini setelahnya             |

Setelah latihan: tulis total durasi di sini, langkah yang ternyata salah atau hilang, dan perbaiki
dokumen ini pada hari yang sama. Sebelum memulai, jalankan **Deploy → `restore-rehearsal`** (langkah 6
tanpa risiko: memulihkan beberapa objek ke prefix sementara dan membuktikan byte-nya sama).

---

## Kalau kunci privat `.env` hilang

Dump-nya masih bisa dipulihkan — datanya utuh. Yang hilang adalah konfigurasinya, dan itu
harus dibangun ulang dari `.env.example` plus setiap kredensial dibuat baru: kunci S3,
rahasia JWT (semua sesi keluar), kredensial Zenziva, DSN Sentry, service account FCM.

Perkiraan jujur: setengah hari, dan setiap pelanggan harus login ulang.

**Itu sebabnya kunci privat itu disimpan di tempat yang selamat dari server.** Kalau saat
membaca ini Anda tidak yakin ada di mana, berhenti dan pastikan sekarang — bukan nanti.

---

## Yang belum ditutup, dan disebut supaya tidak jadi kejutan

- **Satu penyedia memegang semuanya — dan ternyata itu BUKAN keputusan biaya.** Mesin,
  satu-satunya salinan database, dan seluruh berkas objek ada di BiznetGio. Alasan yang
  selalu dipakai untuk menunda adalah ongkos. Diukur 2026-08-31, ongkosnya nol:

  | Yang harus disalin                               | Ukuran     |
  | ------------------------------------------------ | ---------- |
  | 14 dump database (seluruh riwayat yang disimpan) | **2,9 MB** |
  | `*-products` — 9 objek                           | 4,6 MB     |
  | `*-pod` — 7 objek (bukti antar + tanda tangan)   | 0,4 MB     |
  | `*-facer` — 25 objek (absen wajah)               | 0,2 MB     |
  | **Total**                                        | **~8 MB**  |

  Delapan megabyte. Cloudflare R2 memberi 10 GB gratis tanpa biaya egress; Backblaze B2
  memberi 10 GB gratis. Seluruh sistem ini muat 1.250 kali di dalam kuota gratis salah
  satunya. Yang menghalangi bukan uang, melainkan ~30 menit menyiapkan bucket kedua dan
  satu pasang kunci.

  **Kodenya sudah siap (2026-09-25).** `scripts/backup-second-provider.sh` menyalin dump terbaru dan
  bucket bukti ke penyedia kedua setiap malam pukul 04:00, lewat skrip yang sama dengan yang pertama
  (`backup-offsite.sh`, `backup-objects.mjs`) — hanya nama variabelnya `BACKUP2_*`. Ia menolak endpoint yang
  satu host dengan penyedia pertama (dua salinan di satu penyedia adalah satu salinan) dan menolak
  konfigurasi setengah jalan. `check-backup-freshness.sh` ikut memantau log-nya dan membaca dump-nya
  kembali byte demi byte dari sana. Tak diisi = "satu penyedia saja", keluar 0.

  **Yang tinggal Anda kerjakan (~30 menit, gratis):**

  Keputusan pemilik 2026-09-25: penyedia kedua adalah **Backblaze B2**, dengan kunci yang **tidak bisa
  menghapus**. Langkah berikut mengikuti dokumentasi B2 dan belum diuji di akun Anda; `backup-second` di
  langkah 3 adalah pembuktiannya.

  1. Di B2: buat bucket **privat** (mis. `hydromart-backup2`); aktifkan **Object Lock** dan
     **Versioning/Keep all versions** pada bucket itu. Buat **application key yang dibatasi ke bucket itu**
     dengan kemampuan `listBuckets, listFiles, readFiles, writeFiles` — **tanpa `deleteFiles`**. UI B2 hanya
     menawarkan "Read and Write / Read Only / Write Only", dan yang pertama menyertakan hapus; kunci
     berkemampuan khusus dibuat lewat CLI: `b2 key create --bucket hydromart-backup2 hydromart-backup2
listBuckets,listFiles,readFiles,writeFiles`. Baca (`readFiles`) memang diperlukan: `check-backup-freshness`
     membaca dump kembali dari sana. Lalu, di konsol B2, pasang **lifecycle rule** untuk memangkas versi
     lama (mis. simpan 395 hari) — kunci tanpa hak hapus tidak bisa memangkas sendiri.
  2. Tambahkan baris ini ke secret GitHub `ENV_SET_BLOCK`, lalu **Actions → Deploy → mode `env-set`**:
     `BACKUP2_OFFSITE_DEST=s3://hydromart-backup2/hydromart`,
     `BACKUP2_S3_ENDPOINT=https://s3.<region>.backblazeb2.com`, `BACKUP2_S3_REGION=<region>` (bagian
     yang sama di endpoint, mis. `us-west-004`), `BACKUP2_S3_ACCESS_KEY_ID=…`,
     `BACKUP2_S3_SECRET_ACCESS_KEY=…`, dan **`BACKUP2_NO_DELETE=1`** (kunci ini tak bisa memangkas; tanpa
     tanda ini log malam berisi "prune failed" permanen).
  3. **Actions → Deploy → mode `backup-second`** — menyalin sekarang dan membuktikannya; jangan tunggu 04:00.
     Hijau berarti dump terbaca kembali identik dari penyedia kedua. Baris `lifecycle … unavailable
(AccessDenied)` untuk bucket ini **wajar** dengan kunci itu (aturan usia disetel di konsol B2).

  **Keputusan Anda**, dan hanya perlu dijawab sekali: lakukan tiga langkah itu, atau terima bahwa
  kehilangan akun BiznetGio menghilangkan mesin, database, dan seluruh buktinya sekaligus.

- **Kunci yang menulis backup juga bisa menghapusnya** — pada penyedia pertama. Tidak ada object-lock
  di bucket BiznetGio, dan ransomware dengan akses ke kotak bisa menghapus backup-nya juga. Penyedia
  kedua di atas menutupnya **begitu Anda membuatnya** dengan kunci tanpa `deleteFiles` dan Object Lock;
  sampai itu, celahnya terbuka.
- **Salinan objek ada, tapi belum pernah dipulihkan sungguhan.** `--restore` sudah ditulis dan
  sengaja menolak menimpa objek yang masih hidup, tapi belum pernah dijalankan di volume
  produksi.
- **Prosedur "kotak hilang seluruhnya" belum pernah dilatih.** Drill mingguan (Senin 04:30 WIB) membuktikan
  dump bisa dipulihkan dan cocok dengan basis data hidup; ia tidak membuktikan langkah 3–6 di atas.
  Pindah VPS adalah kesempatan yang sebenarnya untuk melatihnya — jalankan langkah 1–7 di kotak baru
  sebelum memindahkan DNS, dan catat durasinya di sini.
- **Salinan objek kedaluwarsa dengan sengaja.** Kebijakan privasi berjanji bukti pengantaran dan bukti
  transfer dihapus 12 bulan; salinan di bucket backup mengikuti dengan penyangga sebulan (aturan lifecycle
  dipasang `scripts/backup-objects.mjs`, tanpa satu pun panggilan delete). Pemulihan foto yang lebih tua dari
  itu memang tidak mungkin, dan itu benar.
