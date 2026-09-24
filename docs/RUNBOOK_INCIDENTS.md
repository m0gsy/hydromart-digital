# Apa yang dilakukan saat alert menyala

[RUNBOOK_ONCALL.md](RUNBOOK_ONCALL.md) menjawab **siapa** yang dibangunkan dan seberapa cepat. Dokumen ini
menjawab **apa yang dilakukan** — per alert, dengan perintah yang benar-benar ada di repo. Jam dua pagi
bukan waktu untuk menemukan bahwa "restart" bukan jawabannya.

Baca sekali sekarang. Yang menentukan hasilnya hampir selalu urutan: **lihat dulu, baru sentuh**.

---

## 0. Sebelum apa pun

```bash
ssh hydromart@<vps>                       # kunci milik Anda sendiri, bukan VPS_SSH_KEY milik CI
cd ~/hydromart
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile tls"
$DC ps                                    # siapa berjalan, siapa sehat
ls -t .deploy/incident-*.log | head -3    # laporan watchdog: exit code, OOMKilled, 40 baris log terakhir
git log --oneline -3; cat .deploy/last-good-sha .deploy/prev-sha
```

Tiga pertanyaan yang menyaring hampir semuanya:

1. **Apakah ada deploy dalam satu jam terakhir?** Kalau ya, tersangka pertama adalah rilis itu, dan
   jalan keluarnya `bash scripts/rollback.sh` (menarik image commit sebelumnya — sekitar satu menit;
   hanya kode, migrasi tidak ikut mundur).
2. **Apakah satu service, atau semuanya?** Semuanya berarti Postgres, disk, memori host, atau Caddy — bukan
   kode.
3. **Apakah uangnya aman?** Kalau alert menyangkut pembayaran, berhenti dan baca bagian
   [PaymentConfirmFailing](#paymentconfirmfailing) sebelum menekan apa pun.

**Yang tidak pernah dilakukan:** `docker compose down -v` (menghapus volume Postgres), `docker volume rm`,
menghapus berkas di `/var/backups`, dan merestart Postgres dengan container aplikasi masih menulis.

---

## Situs tak terjangkau dari luar (workflow **Uptime** merah, atau pelanggan yang melapor)

Alarm di kotak tidak akan bicara kalau kotaknya yang hilang — inilah kenapa ada pemeriksaan dari luar.

1. Dari laptop/ponsel di jaringan lain: `curl -sS -m 15 -o /dev/null -w '%{http_code}\n' https://api.hydromart-digital.com/health`
   dan halaman webnya. Bedakan: **timeout** (jaringan/VPS), **502/503** (Caddy hidup, di belakangnya mati),
   **kesalahan sertifikat** (lihat `scripts/check-tls-expiry.sh`).
2. `ssh` gagal juga → VPS atau penyedia bermasalah. Buka konsol penyedia (BiznetGio) dan lihat status mesin;
   boot ulang dari sana bila perlu. `restart: unless-stopped` menyalakan lagi semuanya, dan `watchdog.sh`
   menyusul dalam lima menit untuk yang tertinggal.
3. Mesin hilang seluruhnya (volume mati, akun ditangguhkan) → [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).
4. `ssh` berhasil tapi situs mati: `$DC ps caddy gateway web`; `$DC logs --tail 80 caddy`. Caddy sehat tapi
   gateway tidak → bagian service di bawah. Caddy yang `unhealthy`: `$DC restart caddy`.

## ServiceDown / ServiceCrashLooping

```bash
$DC ps <service>
$DC logs --tail 120 <service>              # nama service = label {{service}} tanpa "-service"
docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}}' $($DC ps -q <service>)
```

- **OOMKilled=true** → lihat [ContainerOOMKilled](#containeroomkilled).
- Mati tepat setelah deploy → `bash scripts/rollback.sh`, lalu cari sebabnya dengan tenang.
- Log menyebut koneksi database habis (`P2024`, "too many clients") → [PostgresConnectionsNearMax](#postgres).
- Log menyebut variabel env / validasi config → env di `.env` berubah atau hilang: `bash scripts/env-doctor.sh --inspect`.
- Berhenti tanpa sebab (Exited 0) → `bash scripts/watchdog.sh` menjalankannya lagi dan menulis laporan insiden.

Menyalakan satu service: `$DC up -d <service>` (bukan `restart` bila image atau env berubah).

## HighErrorRate / HighLatencyP95 / EventLoopLagHigh

Label `service` menyebut siapa. `$DC logs --tail 200 <service>` — cari galat yang berulang, bukan yang
terakhir. Tanyakan: apakah **Postgres** lambat (`docker exec $($DC ps -q postgres) psql -U hydromart -c "select state, count(*) from pg_stat_activity group by 1"`),
apakah service **yang dipanggilnya** yang mati (order → product/depot/payment), atau apakah baru saja
ada deploy. Tanpa sebab lain yang jelas dalam 15 menit: rollback.

## Postgres

`PostgresDown`, `PostgresConnectionsNearMax`, `PostgresDeadlocks`.

```bash
$DC ps postgres; $DC logs --tail 100 postgres
df -h /                                    # disk penuh = Postgres berhenti menulis SEBELUM 100%
```

- **Down**: jangan hapus volume. Disk penuh? → [DiskSpaceLow](#diskspacelow). Bukan? `$DC up -d postgres`,
  tunggu `healthy`, lalu `bash scripts/watchdog.sh` untuk service yang ikut jatuh.
- **Koneksi hampir habis**: setiap service dibatasi `DB_POOL` (5) dan server mengizinkan 150; angka tinggi
  berarti ada yang membocorkan koneksi atau ada alat yang membuka banyak sesi. Lihat siapa:
  `select usename, datname, count(*) from pg_stat_activity group by 1,2 order by 3 desc;`.
- **Deadlock**: satu-dua sebulan tidak berbahaya (transaksi diulang); berulang berarti urutan kunci di
  `reserveAtomic` (depot-service) dilanggar oleh perubahan baru.
- Data rusak atau hilang: **berhenti**, jangan menulis lagi, [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) dan
  `scripts/restore-db.sh`.

## DiskSpaceLow

Disk yang sama memuat Postgres, semua dump, semua image dan TSDB Prometheus — penuh berarti data, bukan
hanya uptime, terancam.

```bash
df -h /; docker system df
bash scripts/docker-gc.sh                  # image dan cache yang tak dipakai; aman, tidak menyentuh volume
du -sh /var/backups/* ~/backups 2>/dev/null
```

Dump dipangkas ke 14 malam oleh `backup-db.sh`; log kontainer dibatasi 50 MB × 3 (`ops/docker-daemon.json`).
Kalau masih penuh setelah `docker-gc.sh`, ukur sebelum menghapus: `docker system df -v`. Naikkan disk sebelum
`DiskSpaceLow` menjadi 5%.

## HostMemoryLow / ContainerOOMKilled

```bash
docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' | sort -k2 -h | tail -5
free -h
```

`ContainerOOMKilled` berarti satu container menabrak `mem_limit` di `docker-compose.prod.yml` — bocor, atau
plafonnya terlalu rendah untuk beban baru. Naikkan plafon hanya setelah memastikan ia bukan kebocoran
(memorinya naik terus antar restart). Host yang kehabisan memori: swap 4 GB harus ada (`swapon --show`).

## NoOrdersCreated

Menyala bila dua jam berturut-turut antara 11:00–20:00 WIB tidak ada satu pun `POST /orders/checkout`
atau `/orders/walk-in`. **Semua service bisa sehat dan bisnis tetap berhenti.**

1. **Apakah depotnya memang tutup?** (hari libur di `holidays`, jam operasional kosong.) Kalau ya, ini bukan insiden.
2. Buka aplikasi pelanggan dari luar dan coba pesan. Gagal → ikuti [Situs tak terjangkau](#situs-tak-terjangkau-dari-luar-workflow-uptime-merah-atau-pelanggan-yang-melapor)
   atau [CheckoutFailing](#checkoutfailing).
3. Berhasil, tapi pelanggan tak menemukan depot / metode bayar: `bash scripts/go-live-report.sh` (baca-saja) —
   depot tanpa jam buka atau tanpa tujuan pembayaran adalah penyebab yang paling sering.

## CheckoutFailing

`>5%` percobaan checkout menjawab 5xx. `ORDER_INSUFFICIENT_STOCK` adalah 422, **bukan** 5xx — stok habis tidak
memicu alert ini.

```bash
$DC logs --tail 200 order | grep -iE "error|responded 4|responded 5"
```

Order-service membaca katalog (product), harga dan stok (depot), promo, dan loyalty lewat HTTP: yang
**mereka** kembalikan (429 dari rate limit internal, 5xx) tampil sebagai `INTERNAL_ERROR` di sini. Tanyakan
service di belakangnya, bukan hanya order. Setelah deploy → rollback.

## PaymentConfirmFailing

**Kaki uang.** Penjualan tercatat, pembayaran belum: selisih kas yang baru ketahuan berhari-hari kemudian.

- **Jangan mengonfirmasi ulang secara membabi buta.** Konfirmasi bersifat idempoten per pembayaran, tapi
  yang sedang dicari adalah _mengapa_ gagal.
- `$DC logs --tail 200 payment` dan `... order`; konfirmasi memanggil `internal-confirm` di order-service.
- Layar **Antrean efek pesanan** (HQ) memperlihatkan baris `PENDING` yang menahan uang atau stok; sweep
  `orders/outbox/internal/process` (tiap 10 menit) mencobanya lagi sendiri begitu penyebabnya pulih.
- Setelah pulih: cocokkan di rekonsiliasi depot bahwa jumlahnya sama dengan yang dipegang kasir.

## SchedulerSweepsSilent

Scheduler hidup tapi tidak menyapu apa pun selama sejam.

```bash
$DC ps scheduler; $DC logs --tail 60 scheduler
```

Buka `/hq/health`: sweep yang tidak pernah melapor tampil `NEVER RUN`, yang macet `OVERDUE`. Penyebab umum:
`INTERNAL_SERVICE_KEY` di scheduler tidak cocok dengan service (setelah rotasi), atau `ADMIN_SERVICE_HOST`
tak terisi. `$DC up -d scheduler` membuatnya ulang dengan env terkini.

## ExporterDown

`node-exporter`, `postgres-exporter`, atau `cadvisor` mati; **alert host dan Postgres buta selama itu.** `$DC up -d
<exporter>`. Perlakukan sebagai insiden kecil, bukan noise: tanpa ini, `DiskSpaceLow` tidak akan menyala.

## Container `running` tapi UNHEALTHY (dari watchdog)

Watchdog hanya **melapor**, tidak me-restart, karena proses yang hang butuh orang yang membaca lognya
lebih dulu.

```bash
$DC ps --format '{{.Service}} {{.State}} {{.Health}}'
$DC logs --tail 120 <service>
docker inspect --format '{{json .State.Health}}' $($DC ps -q <service>) | tail -c 600
```

Sesudah membaca log: `$DC restart <service>` bila prosesnya memang hang. Untuk `web`: pelanggan melihat
layar kosong; untuk `caddy`: TLS ingress; keduanya dilihat juga oleh workflow Uptime.

## Backup atau drill restore gagal / basi

Pesan datang dari `backup-db.sh`, `restore-db.sh --drill`, `check-backup-freshness.sh`, atau
`backup-offsite.sh`.

```bash
bash scripts/check-backup-freshness.sh       # umur dump, drill, salinan luar kotak
crontab -l | grep -A2 'hydromart (scripts/install-host-cron.sh)'   # kosong = blok cron tak terpasang: kotak tanpa jaring
tail -50 /var/log/hydromart-backup.log
```

Blok cron hilang (kotak baru/dibangun ulang) → `bash scripts/install-host-cron.sh`. Salinan luar kotak gagal →
cek `BACKUP_OFFSITE_DEST` dan kunci `BACKUP_S3_*` di `.env`. Sampai satu drill lulus lagi, perlakukan backup
sebagai tidak bisa dipercaya dan jalankan `bash scripts/backup-db.sh` dengan tangan.

## Deploy gagal / commit tidak terkirim

`deploy.yml` merah. Baca log run-nya; penyebab yang pernah terjadi: CI di `main` merah atau dibatalkan
(commit **tidak** dideploy dan itu memang benar), image belum terbit (`Images` workflow), migrasi gagal (kode
dikembalikan, stack yang jalan tidak disentuh), cek kesehatan gagal (rollback otomatis). Stack yang jalan
tidak pernah dibiarkan setengah-baru tanpa dikembalikan; lihat pesan `[deploy]` terakhir dan
`cat .deploy/last-good-sha`.

## OTP tak sampai (tak ada yang bisa daftar/masuk)

`$DC logs --tail 100 auth | grep -i zenziva`. Penyebab yang paling sering bukan kode: **saldo Zenziva habis**
atau kredensial berubah. Belum ada pemantauan saldonya — cek di konsol Zenziva. `OTP_DELIVERY_CHANNEL` tidak
boleh `console` di produksi (service menolak boot).

## Sertifikat TLS

`scripts/check-tls-expiry.sh` (Senin) memperingatkan di bawah 21 hari. Caddy memperbarui sendiri; kalau
berhenti diam-diam: `$DC logs --tail 100 caddy | grep -i -E "obtain|renew|error"`, pastikan port 80/443
terbuka dan DNS `A` menunjuk ke kotak ini.
