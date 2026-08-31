# Pemulihan bencana — kotaknya hilang seluruhnya

Dokumen ini untuk satu skenario: **VPS-nya tidak ada lagi.** Volume mati, VM terhapus, akun
di-suspend, ransomware. Bukan "satu service crash" — itu urusan watchdog dan restart policy.

Ditulis karena sampai 2026-08-31 prosedurnya hanya ada di kepala orang. `grep -rn 'into-prod'
docs/` cuma menemukan dua kalimat yang mengeluhkan bahwa ia tak pernah dilatih.

Baca sekali sekarang, saat tidak sedang terjadi. Yang kedua kalinya Anda akan membacanya
dengan tangan gemetar.

---

## Apa yang Anda punya, dan apa yang tidak

| Ada | Di mana | Sedalam apa |
| --- | --- | --- |
| Dump seluruh cluster, tiap malam 03:00 | `s3://hydromart-backup/db/` | 14 malam (`BACKUP_KEEP`) |
| `.env` terenkripsi, tiap malam 03:25 | `s3://hydromart-backup/env/` | 14 malam |
| Berkas objek (foto PoD, bukti transfer, dll), tiap malam 03:40 | `s3://hydromart-backup/objects/<bucket>/` | tidak dipangkas |
| Kode | GitHub, `main` | seluruh riwayat |
| Image per commit | `ghcr.io/m0gsy/hydromart-digital-<service>:<sha>` | selama GHCR menyimpannya |

**Yang TIDAK ada, dan harus Anda tahu sebelum mulai:**

- **Berkas objek kini disalin, tapi masih di penyedia yang sama.** `scripts/backup-objects.mjs`
  menyalin SEMUA bucket objek (auth, product, delivery, hr — customer dan payment ikut bucket
  auth) ke `s3://hydromart-backup/objects/<bucket>/` tiap malam 03:40, dan menyalakan
  versioning di bucket asalnya. Yang belum tertutup: salinan itu masih di BiznetGio.
  **Kehilangan AKUN NEO tetap kehilangan keduanya sekaligus.**
- **RPO 24 jam.** Tidak ada WAL archiving. Kehilangan volume pukul 02:59 membuang hampir
  sehari penuh pesanan dan setoran kurir. Tidak ada cara memulihkannya.
- **RTO belum pernah diukur di volume produksi.** Angka di bawah adalah urutan langkah, bukan
  janji durasi.

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

## Kalau kunci privat `.env` hilang

Dump-nya masih bisa dipulihkan — datanya utuh. Yang hilang adalah konfigurasinya, dan itu
harus dibangun ulang dari `.env.example` plus setiap kredensial dibuat baru: kunci S3,
rahasia JWT (semua sesi keluar), kredensial Zenziva, DSN Sentry, service account FCM.

Perkiraan jujur: setengah hari, dan setiap pelanggan harus login ulang.

**Itu sebabnya kunci privat itu disimpan di tempat yang selamat dari server.** Kalau saat
membaca ini Anda tidak yakin ada di mana, berhenti dan pastikan sekarang — bukan nanti.

---

## Yang belum ditutup, dan disebut supaya tidak jadi kejutan

- **Satu penyedia memegang semuanya.** Mesin, satu-satunya salinan database, dan seluruh
  berkas objek ada di BiznetGio. Salinan di penyedia kedua adalah keputusan biaya yang belum
  diambil.
- **Kunci yang menulis backup juga bisa menghapusnya.** Tidak ada object-lock atau versioning
  di bucket. Ransomware dengan akses ke kotak bisa menghapus backup-nya juga.
- **Salinan objek ada, tapi belum pernah dipulihkan sungguhan.** `--restore` sudah ditulis dan
  sengaja menolak menimpa objek yang masih hidup, tapi belum pernah dijalankan di volume
  produksi.
- **Drill belum pernah dijalankan di volume produksi**, jadi setiap durasi di atas adalah
  urutan langkah, bukan angka.
