# Siapa yang dibangunkan, dan oleh apa (N12)

Sebelum dokumen ini: alert menyala ke satu webhook tanpa nama orang di belakangnya,
tautannya kosong, ada 12 alert infrastruktur dan **nol** alert bisnis, dan satu-satunya
runbook di repo cakupannya satu deploy HR. Tidak ada rotasi, tidak ada eskalasi, tidak ada
halaman status pelanggan.

Yang berubah di kode ada di bawah. Yang **tidak bisa** diselesaikan dari repo — nama orang,
nomor telepon, dan siapa yang menjawab pukul dua pagi — ditandai **PEMILIK: Anda**.

---

## 1. Apa yang sekarang bisa membangunkan orang

| Alert                                | Kelas                    | Arti                                                   |
| ------------------------------------ | ------------------------ | ------------------------------------------------------ |
| `ServiceDown`, `ServiceCrashLooping` | infra · critical         | prosesnya mati atau berputar-putar                     |
| `HighErrorRate`, `HighLatencyP95`    | infra · critical/warning | prosesnya hidup tapi menjawab salah atau lambat        |
| `ExporterDown`, host & datastore     | infra                    | yang mengukur ikut mati, disk, memori, Postgres/Redis  |
| **`NoOrdersCreated`**                | **bisnis · critical**    | dua jam tanpa satu pun pesanan dibuat, di jam buka     |
| **`CheckoutFailing`**                | **bisnis · critical**    | >5% percobaan checkout menjawab 5xx                    |
| **`PaymentConfirmFailing`**          | **bisnis · critical**    | kaki uang gagal — penjualan tercatat, pembayaran tidak |
| **`SchedulerSweepsSilent`**          | **bisnis · warning**     | scheduler hidup tapi tidak menyapu apa pun             |

Empat yang terakhir baru. Semuanya tidak butuh instrumentasi baru — dibangun di atas
histogram HTTP yang sudah ada. Itu juga membatasi apa yang bisa dikatakannya: mereka
berkata "pesanan berhenti dibuat", bukan "pesanan salah".

**Yang masih tidak bisa dijawab siapa pun dari luar:** apakah angka-angkanya BENAR. Selisih
kas, harga yang salah, poin yang tidak masuk — tidak ada alert untuk itu dan tidak akan ada
sampai service memancarkan metrik bisnisnya sendiri. Ditulis di sini supaya diamnya tidak
terbaca sebagai sehat.

## 2. Tautan di dalam notifikasi

Alertmanager membangun tautan notifikasi dari `--web.external-url`. Tanpa itu ia memakai
hostname kontainer (`http://<container-id>:9093/...`) — URL yang ditolak Discord dengan 400
dan tidak bisa dibuka siapa pun. Itulah sebabnya `title_link` sengaja dikosongkan dulu.

Sekarang: setel `ALERTMANAGER_EXTERNAL_URL` di `.env`. Kalau Anda hanya membukanya lewat
terowongan SSH, `http://localhost:9093` adalah jawaban yang sah — dan itu default-nya.

## 3. Rotasi dan eskalasi — **PEMILIK: Anda**

Isi tabel ini dan commit. Tidak ada nilai default yang jujur di sini: rotasi yang ditebak
repo adalah rotasi yang tidak ada orangnya.

Tabel di antara dua penanda di bawah dibaca mesin. `node scripts/check-oncall-rota.mjs`
menolak: setiap sel yang masih placeholder, nama yang tidak berbentuk nama, kontak yang bukan
nomor/email yang bisa dihubungi, nomor yang jelas-jelas tebakan (`081234567890`), primer dan
sekunder yang ternyata orang yang sama, janji jawab yang lebih lama dari eskalasinya — dan
hilangnya penanda itu sendiri. Jadi selama tabel ini kosong CI **merah**, bukan diam; dan
menghapus barisnya tidak membuatnya hijau, karena tiga peran di bawah wajib ada.

<!-- ROTA:BEGIN — dibaca scripts/check-oncall-rota.mjs; jangan hapus penanda ini -->

| Peran                   | Nama     | Kontak (WhatsApp/telepon atau email) | Jam                         | Janji waktu jawab |
| ----------------------- | -------- | ------------------------------------ | --------------------------- | ----------------- |
| Primer                  | ISI-NAMA | ISI-KONTAK                           | 24/7                        | 15 menit          |
| Sekunder                | ISI-NAMA | ISI-KONTAK                           | eskalasi ketika primer diam | 30 menit          |
| Bisnis (depot/keuangan) | ISI-NAMA | ISI-KONTAK                           | jam kerja 09:00-20:00 WIB   | 2 jam             |

<!-- ROTA:END -->

Kontak yang diterima hanya dua bentuk, karena hanya dua bentuk yang bisa membangunkan orang:
nomor Indonesia (`+62…`, `08…`) atau email. Nama grup chat bukan kontak on-call — grup itu
sudah menerima alert-nya, dan itulah masalah yang dokumen ini ada untuk menutup.

Aturan eskalasi yang disarankan, sampai Anda menggantinya:

1. `critical` → primer, langsung. Tidak dijawab dalam 15 menit → sekunder.
2. `warning` → tidak membangunkan siapa pun; dibaca pada jam kerja berikutnya.
3. Alert bisnis (`NoOrdersCreated`, `PaymentConfirmFailing`) → primer **dan** pemilik
   bisnis: keduanya kehilangan uang, dan yang kedua tahu apakah depot memang tutup.

Tidak satu pun dari tiga aturan itu ditegakkan oleh perangkat. `ops/alertmanager.yml` punya
**satu** `receiver` dan tidak punya `routes`, jadi `warning` dan `critical` mendarat di chat
yang sama dengan kenyaringan yang sama; tidak ada acknowledge, tidak ada panggilan telepon,
tidak ada eskalasi otomatis. Yang benar-benar terjadi pada alert yang tidak dijawab: ia
diposting ulang setiap `repeat_interval: 4h`. Empat jam, bukan lima belas menit — angka 15
menit di atas adalah janji manusia, dan §6 menghitung apa yang mesin benar-benar berikan.

## 4. Halaman status pelanggan

**Tidak ada, dan sengaja belum dibuat.** Halaman status yang di-host di infrastruktur yang
sama dengan yang sedang mati adalah halaman status yang ikut mati. Membuatnya benar berarti
host di luar VPS ini — keputusan biaya, bukan keputusan kode. **PEMILIK: Anda.**

Sementara itu, jalur yang sudah ada dan berfungsi: WhatsApp depot di `/help` (K1.5 menambah
jalur komplain yang tidak bergantung pada nomor depot terisi).

## 5. Dua pemeriksaan mingguan yang sekarang berjalan sendiri

| Skrip                            | Kapan       | Apa yang ditangkapnya                                                                                                                                                                                      |
| -------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/check-tls-expiry.sh`    | Senin 05:15 | sertifikat < 21 hari. Perpanjangan otomatis, dan itu justru sebabnya tidak ada yang menontonnya — kegagalannya bukan galat perpanjangan yang berisik, melainkan perpanjangan yang diam-diam berhenti (N13) |
| `scripts/check-log-retention.sh` | Senin 05:45 | `ops/docker-daemon.json` tidak pernah disalin ke host, atau Docker tidak pernah di-restart sesudahnya. Default Docker tak terbatas, dan itu mengisi disk (N14)                                             |

Keduanya dipasang oleh `scripts/install-host-cron.sh` dan melapor ke webhook yang sama.
Keduanya juga bisa dijalankan tangan kapan saja.

**Pengiriman log ke luar kotak: tidak ada.** Forensik pasca-insiden terbatas pada 50 MB × 3
per kontainer, dan kalau kotaknya hilang, lognya ikut hilang — sama seperti backup sebelum
disalin keluar (L2.7). Ini keputusan biaya yang belum diambil, bukan cacat yang terlewat.

---

## 6. Berapa lama sebelum ada yang tahu — angka dari `ops/`, bukan aspirasi

Keterlambatan sebelum notifikasi pertama = `for:` pada rule + satu `scrape_interval` (15s,
`ops/prometheus.yml`) + `group_wait: 30s` (`ops/alertmanager.yml`). Jadi janji waktu jawab di
§3 dihitung **sejak pesan masuk**, bukan sejak kerusakan mulai; yang di bawah ini adalah
selisih yang tidak bisa dijanjikan siapa pun karena sudah dibakar di konfigurasi.

| Alert                                                            | Kelas    | `for:`              | Notifikasi pertama paling lambat | Yang diharapkan dari primer                              |
| ---------------------------------------------------------------- | -------- | ------------------- | -------------------------------- | -------------------------------------------------------- |
| `ServiceCrashLooping`, `ContainerOOMKilled`, `PostgresDeadlocks` | critical | 0m                  | ~45s                             | jawab dalam janji §3                                     |
| `ServiceDown`, `PostgresDown`                                    | critical | 2m                  | ~2m45s                           | jawab dalam janji §3                                     |
| `HighErrorRate`, `CheckoutFailing`, `PaymentConfirmFailing`      | critical | 5m                  | ~5m45s                           | jawab dalam janji §3                                     |
| `DiskSpaceLow`                                                   | critical | 10m                 | ~10m45s                          | `scripts/docker-gc.sh` sebelum rebuild berikutnya        |
| `NoOrdersCreated`                                                | critical | 10m (jendela 2 jam) | ~2j 11m                          | konfirmasi ke bisnis: depot tutup, atau app tidak sampai |
| `HighLatencyP95`, `HostMemoryLow`                                | warning  | 10m                 | ~10m45s                          | dibaca jam kerja berikutnya                              |
| `ExporterDown`, `EventLoopLagHigh`, `PostgresConnectionsNearMax` | warning  | 5m                  | ~5m45s                           | dibaca jam kerja berikutnya                              |
| `SchedulerSweepsSilent`                                          | warning  | 30m                 | ~30m45s                          | dibaca jam kerja berikutnya                              |

Tiga hal yang tabel ini membuat jujur, dan ketiganya adalah keputusan yang sudah diambil di
konfigurasi, bukan cacat:

1. **`NoOrdersCreated` bukan alert dua menit.** Jendelanya dua jam, jadi checkout bisa mati
   dua jam sebelum ada yang dibangunkan. Memendekkannya berarti memalsukan alert setiap
   subuh di kota kecil — lihat komentar hour-of-day guard di `ops/alert-rules.yml`.
2. **`warning` bisa hilang sama sekali.** `inhibit_rules` membungkam `warning` selama ada
   `critical` dengan label `service` yang sama. Itu sengaja (satu halaman per insiden), tapi
   artinya "tidak ada warning" bukan bukti tidak ada masalah lambat.
3. **Alert yang pulih memberi tahu.** `send_resolved: true`, jadi tidak perlu menunggu
   diam untuk menyimpulkan sudah beres — kalau pesan RESOLVED tidak datang, belum beres.

## 7. Sebelum shift pertama: akses yang harus sudah ada

Tanpa semua ini, orang yang dibangunkan hanya bisa membaca alert dan tidak bisa
menindaknya. Daftarnya konkret dari repo, bukan generik:

| Yang dibutuhkan                                                                                                              | Di mana                                                                                                         | Kalau tidak ada                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSH ke satu VPS itu (kunci **miliknya sendiri**, bukan `VPS_SSH_KEY` milik CI)                                               | host yang sama dengan `secrets.VPS_HOST`, repo di `secrets.VPS_REPO_PATH`                                       | tidak ada satu pun tindakan di bawah ini mungkin                                                                                                                |
| Keanggotaan grup `docker` di host                                                                                            | `docker compose` di `docker-compose.prod.yml`                                                                   | tidak bisa melihat log, tidak bisa restart apa pun                                                                                                              |
| Terowongan SSH untuk dasbor                                                                                                  | semuanya terikat loopback: Grafana `127.0.0.1:3300`, Prometheus `127.0.0.1:9090`, Alertmanager `127.0.0.1:9093` | tidak ada dasbor yang bisa dibuka dari internet — tidak ada halaman login untuk dicari                                                                          |
| Password Grafana                                                                                                             | `GRAFANA_ADMIN_PASSWORD` di `.env` host; `GF_USERS_ALLOW_SIGN_UP: "false"`                                      | tidak ada akun yang bisa dibuat sendiri; harus dibuatkan                                                                                                        |
| Akses ke chat yang menerima alert                                                                                            | webhook di `ops/alertmanager.webhook-url` (tidak di-commit)                                                     | alert menyala untuk ruangan yang dia tidak ada di dalamnya                                                                                                      |
| Kemampuan baca `.env` di host                                                                                                | dibutuhkan hampir semua skrip ops                                                                               | **catat risikonya**: `.env` itu berisi seluruh rahasia platform — memberi akses on-call berarti memberi itu juga. Tidak ada pemisahan yang lebih halus hari ini |
| Wewenang menjalankan `scripts/deploy.sh`, `rollback.sh`, `rebuild-stale.sh`, `docker-gc.sh`, `backup-db.sh`, `restore-db.sh` | `scripts/` di host                                                                                              | bisa mendiagnosis, tidak bisa memulihkan                                                                                                                        |
| Hak dispatch workflow di GitHub                                                                                              | `.github/workflows/deploy.yml`                                                                                  | perbaikan hanya bisa dari host                                                                                                                                  |

Satu hal yang tidak ada di tabel itu karena memang tidak ada di repo: **tidak satu pun
dasbor Grafana yang di-provision.** `ops/grafana-datasource.yml` hanya menyambungkan
datasource Prometheus, dan `docker-compose.prod.yml` tidak me-mount direktori dashboard
apa pun. Jadi orang yang pertama kali membuka `127.0.0.1:3300` menemukan Grafana kosong,
dan satu-satunya cara membaca metrik malam itu adalah Explore + PromQL, atau langsung ke
Prometheus di `:9090`. Ditulis di sini supaya tidak ditemukan pukul dua pagi.

Satu fakta yang mengubah rencana pemulihan, dan sudah diukur: **VPS ini berjalan dengan
`IMAGE_PREFIX` kosong — mode build-locally.** Tidak ada registry untuk menarik image versi
sebelumnya, jadi `scripts/rollback.sh` **membangun ulang di kotak itu** (`git reset --hard`
ke `.deploy/prev-sha` lalu rebuild service yang berbeda). Konsekuensi untuk yang bangun jam
dua pagi: rollback berbiaya menit-menit build dan butuh ruang disk — itu sebabnya
`DiskSpaceLow` di §6 adalah `critical` dan bukan `warning`, dan sebabnya `docker-gc.sh`
disebut di deskripsi alert-nya. Rollback kode saja; migrasi yang harus dibatalkan butuh
`scripts/restore-db.sh` dari backup pra-deploy.

## 8. Pemeriksa rota

```sh
node scripts/check-oncall-rota.mjs            # gate: exit 1 selama rota belum berisi orang
node scripts/check-oncall-rota.mjs --self-test # bukti gate-nya bisa merah dan bisa hijau
```

Ada karena pola kegagalan repo ini yang paling mahal bukan alert yang salah, melainkan
pemeriksaan yang hijau padahal subjeknya tidak ada. Karena itu `--self-test` ikut
membuktikan pemeriksa ini **gagal ketika seksi rota dihapus**, bukan hanya ketika isinya
salah.

**Belum terpasang di CI.** `.github/workflows/ci.yml` tidak diubah dari sini (file itu milik
pekerjaan lain), jadi hari ini pemeriksa ini hanya berjalan kalau dijalankan tangan. Dua
baris yang membuatnya menjadi gerbang, letakkan di sebelah pemeriksa sejenis di job `guards`:

```yaml
- name: On-call rota has real people in it (L1.6)
  run: node scripts/check-oncall-rota.mjs
- name: ...and that gate can go red (self-test)
  run: node scripts/check-oncall-rota.mjs --self-test
```

Sampai itu terjadi, rota kosong ini masih hanya sebuah dokumen — persis keadaan yang §3 ada
untuk mengakhiri.
