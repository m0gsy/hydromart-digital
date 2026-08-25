# Siapa yang dibangunkan, dan oleh apa (N12)

Sebelum dokumen ini: alert menyala ke satu webhook tanpa nama orang di belakangnya,
tautannya kosong, ada 12 alert infrastruktur dan **nol** alert bisnis, dan satu-satunya
runbook di repo cakupannya satu deploy HR. Tidak ada rotasi, tidak ada eskalasi, tidak ada
halaman status pelanggan.

Yang berubah di kode ada di bawah. Yang **tidak bisa** diselesaikan dari repo — nama orang,
nomor telepon, dan siapa yang menjawab pukul dua pagi — ditandai **PEMILIK: Anda**.

---

## 1. Apa yang sekarang bisa membangunkan orang

| Alert | Kelas | Arti |
| --- | --- | --- |
| `ServiceDown`, `ServiceCrashLooping` | infra · critical | prosesnya mati atau berputar-putar |
| `HighErrorRate`, `HighLatencyP95` | infra · critical/warning | prosesnya hidup tapi menjawab salah atau lambat |
| `ExporterDown`, host & datastore | infra | yang mengukur ikut mati, disk, memori, Postgres/Redis |
| **`NoOrdersCreated`** | **bisnis · critical** | dua jam tanpa satu pun pesanan dibuat, di jam buka |
| **`CheckoutFailing`** | **bisnis · critical** | >5% percobaan checkout menjawab 5xx |
| **`PaymentConfirmFailing`** | **bisnis · critical** | kaki uang gagal — penjualan tercatat, pembayaran tidak |
| **`SchedulerSweepsSilent`** | **bisnis · warning** | scheduler hidup tapi tidak menyapu apa pun |

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

| Peran | Nama | Kontak | Jam |
| --- | --- | --- | --- |
| Primer | _(isi)_ | _(isi)_ | 24/7 |
| Sekunder | _(isi)_ | _(isi)_ | eskalasi setelah 15 menit tanpa respons |
| Bisnis (depot/keuangan) | _(isi)_ | _(isi)_ | jam kerja |

Aturan eskalasi yang disarankan, sampai Anda menggantinya:

1. `critical` → primer, langsung. Tidak dijawab dalam 15 menit → sekunder.
2. `warning` → tidak membangunkan siapa pun; dibaca pada jam kerja berikutnya.
3. Alert bisnis (`NoOrdersCreated`, `PaymentConfirmFailing`) → primer **dan** pemilik
   bisnis: keduanya kehilangan uang, dan yang kedua tahu apakah depot memang tutup.

## 4. Halaman status pelanggan

**Tidak ada, dan sengaja belum dibuat.** Halaman status yang di-host di infrastruktur yang
sama dengan yang sedang mati adalah halaman status yang ikut mati. Membuatnya benar berarti
host di luar VPS ini — keputusan biaya, bukan keputusan kode. **PEMILIK: Anda.**

Sementara itu, jalur yang sudah ada dan berfungsi: WhatsApp depot di `/help` (K1.5 menambah
jalur komplain yang tidak bergantung pada nomor depot terisi).

## 5. Dua pemeriksaan mingguan yang sekarang berjalan sendiri

| Skrip | Kapan | Apa yang ditangkapnya |
| --- | --- | --- |
| `scripts/check-tls-expiry.sh` | Senin 05:15 | sertifikat < 21 hari. Perpanjangan otomatis, dan itu justru sebabnya tidak ada yang menontonnya — kegagalannya bukan galat perpanjangan yang berisik, melainkan perpanjangan yang diam-diam berhenti (N13) |
| `scripts/check-log-retention.sh` | Senin 05:45 | `ops/docker-daemon.json` tidak pernah disalin ke host, atau Docker tidak pernah di-restart sesudahnya. Default Docker tak terbatas, dan itu mengisi disk (N14) |

Keduanya dipasang oleh `scripts/install-host-cron.sh` dan melapor ke webhook yang sama.
Keduanya juga bisa dijalankan tangan kapan saja.

**Pengiriman log ke luar kotak: tidak ada.** Forensik pasca-insiden terbatas pada 50 MB × 3
per kontainer, dan kalau kotaknya hilang, lognya ikut hilang — sama seperti backup sebelum
disalin keluar (L2.7). Ini keputusan biaya yang belum diambil, bukan cacat yang terlewat.
