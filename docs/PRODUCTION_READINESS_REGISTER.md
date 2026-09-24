# Audit kesiapan produksi non-keamanan — register (2026-09-25)

Audit ini sengaja **tidak** mengulang audit keamanan pra-peluncuran
([SECURITY_AUDIT_REGISTER.md](SECURITY_AUDIT_REGISTER.md)). Pertanyaannya: apakah sistem ini benar-benar siap
**dioperasikan sehari-hari**, bukan hanya aman.

**Aturan bukti:** setiap temuan diperiksa ulang di kode, DB, atau konfigurasi sungguhan sebelum ditulis.
Produksi ditanya lewat `scripts/ask-the-box.sh` (baca-saja, workflow `Registry pull check` mode `diagnose`,
run 36046811314, 2026-09-24 19:14Z), lewat GET anonim ke API publik, dan lewat DNS publik. Template dan basis
data laptop **bukan** produksi. Sekitar 12 dari ~44 hipotesis gugur atau turun kelas (di bawah).

Status: **SELESAI** = diperbaiki dan terdeploy (PR disebut) · **PEMILIK** = butuh keputusan/tindakan Anda,
tak bisa dijawab kode · **DITERIMA** = risiko yang diketahui dan ditulis · **TERBUKA** = belum dikerjakan.

## Keadaan produksi saat diukur

3 depot aktif (BKS-GALAXY-01, BKS-Pekayon-1, dan DEMO-01 yang fixture Play-review), semuanya HKP; **0 rekening,
0 QRIS**; 0 skema komisi; diskon membership tersimpan 0; **1 pesanan dalam 30 hari** (dibatalkan) — praktis pra-peluncuran;
drill restore hijau (21 Sep, 14 detik); mode registry; disk 21%; host Node v20.20.2.

## Menghentikan peluncuran, atau rusak sekarang

| #   | Temuan (bukti)                                                                                                                                                                                                                                                                                                                                  | Status                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A1  | **Kasbon mati sejak #523.** `SelfLoanRequestController` dan `LoanRequestController` tak pernah masuk `controllers: []` di `HrModule`; layar `/hr/me/kasbon` menjawab `Cannot GET /api/v1/loan-requests/me`. 2 dari 162 controller; 473 URL web di-probe di produksi, tak ada 404-routing lain. Tes lulus karena membuat kelasnya dengan tangan. | **SELESAI** #561 (+ gerbang `check-controllers-registered`)                                                       |
| A2  | **`NoOrdersCreated` menyala tiap hari kerja dan `CheckoutFailing` tak pernah bisa menyala:** selector `route=~".*/orders"` POST, padahal pesanan dibuat di `/orders/checkout` dan `/orders/walk-in`. Dibuktikan dengan promtool + label nyata. Fixture lama lulus karena menulis label karangan yang sama.                                      | **SELESAI** #561 (+ gerbang `check-alert-routes`)                                                                 |
| A3  | **Tak ada pemantau dari luar kotak**: semua alarm hidup di VPS yang sama; VPS/penyedia mati = nol notifikasi. `web` dan Caddy tak dipantau; watchdog hanya melihat state ≠ running.                                                                                                                                                             | **SELESAI** #563 (workflow Uptime, watchdog, healthcheck Caddy). Opsional: secret `ALERT_WEBHOOK_URL`             |
| A4  | **privacy@hydromart-digital.com tak bisa menerima surat**: domain tanpa MX dan tanpa TXT (DoH dns.google). Alamat itu kontak hak UU PDP dan jalur hapus-akun tanpa aplikasi untuk Play.                                                                                                                                                         | **PEMILIK** — Cloudflare Email Routing ([GO_LIVE.md §4](GO_LIVE.md))                                              |
| A5  | **Pembayaran non-tunai hanya di atas kertas**: 0 rekening, 0 QRIS; web menyembunyikan tombolnya sehingga pelanggan hanya melihat Tunai. Nilai depot asli tampak placeholder: `deliveryFee` Rp1.000, `minOrderAmount` Rp5.000.                                                                                                                   | **PEMILIK** — isi data ([GO_LIVE.md §1](GO_LIVE.md)); `go-live-report` menandainya                                |
| A6  | **Janji ke pelanggan ≠ perilaku**: diskon silver/gold/platinum tersimpan 0% (default kode 2/5/8); teks "poin hangus setelah 12 bulan" padahal sapuannya dikirim mati. Keputusan 2026-09-25: berlaku sesuai desain.                                                                                                                              | **PEMILIK** menyetel ([GO_LIVE.md §2](GO_LIVE.md)); `check-launch-blockers` L2.4 kini menghitung sapuan poin      |
| A7  | **Data uji di DB produksi** (11 payments, 214 points_transactions, 332 notifications, 20 produk / 3 aktif) dan kelas FINANCIAL tak pernah dipurge; tak ada runbook peluncuran.                                                                                                                                                                  | Alat **SELESAI** #564 (`go-live-report`, `reset-test-data`, [GO_LIVE.md](GO_LIVE.md)); menjalankannya **PEMILIK** |

## Menyusul

| #   | Temuan                                                                                                                                                                                                                                                                      | Status                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| B1  | Janji retensi di kebijakan privasi tak punya eksekutor: bukti transfer 12 bulan dan pengajuan waralaba ditolak 24 bulan (baris kebijakan ada, registri eksekutor hanya 7 dataset).                                                                                          | **SELESAI** #562                                                                        |
| B2  | Foto PoD: lifecycle hanya `pod/`, bucket ber-versioning (Expiration cuma menambah delete marker), salinan backup tak pernah dihapus; `s3-prune` mengganti seluruh aturan lifecycle tiap malam. Keputusan: salinan backup dihapus di 13 bulan.                               | **SELESAI** #562 (helper `s3-lifecycle` merge-per-ID, aturan `pod/` + `payment-proof/`) |
| B3  | Checklist onboarding HQ: 3 dari 6 langkah = `!!d`; tak cek jam buka, komisi, harga, staf. Depot tanpa jam kehilangan "antar sekarang" diam-diam.                                                                                                                            | Sebagian: `go-live-report` memeriksa semuanya; layar checklist **TERBUKA**              |
| B4  | Alert kondisi-tetap diulang tiap deploy ("depot tanpa tujuan pembayaran", beberapa kali sehari sejak 29 Agu).                                                                                                                                                               | **SELESAI** #563 (`alert_once`)                                                         |
| B5  | Grafana tanpa dasbor yang di-provision.                                                                                                                                                                                                                                     | **TERBUKA**                                                                             |
| B6  | Kapasitas: load test 10 VU × 60 detik di runner 4c/16g (checkout p95 451 ms @84 rps, run 35538586254); tak pernah di ukuran VPS target; stack uji tanpa `connection_limit=5`, `mem_limit`, dan dengan rate limit 1e6; skenario franchise mengukur halaman kosong (0 depot). | **TERBUKA**; run VPS-class **PEMILIK**                                                  |
| B7  | Provider tunggal: semua salinan (kotak, DB, objek, backup) di penyedia yang sama; drill "kotak hilang seluruhnya" belum pernah dilatih. Pindah VPS = kesempatan melatihnya.                                                                                                 | **PEMILIK** ([DISASTER_RECOVERY.md](DISASTER_RECOVERY.md))                              |
| B8  | Tak ada playbook per alert.                                                                                                                                                                                                                                                 | **SELESAI** — [RUNBOOK_INCIDENTS.md](RUNBOOK_INCIDENTS.md)                              |
| B9  | Node host v20 (EOL 30 Apr 2026; AWS SDK v3 menjatuhkannya Jan 2027); cron backup jalan di sana.                                                                                                                                                                             | Dilaporkan deploy (#563); memasang Node 22: **PEMILIK**                                 |
| B10 | Dokumentasi vs kenyataan: DEPLOY, ARCHITECTURE, DATABASE, RUNBOOK_ONCALL, RUNBOOK_SECRET_ROTATION (nama variabel salah), RUNBOOK_HR_DEPLOY, NEXT_SESSION, LEGAL_OPEN_ITEMS, MOBILE_PLAY_STORE, SECURITY, README.                                                            | **SELESAI** (PR dokumen ini)                                                            |
| B11 | Repo **publik**; proteksi `main` = 7 cek wajib, tanpa review wajib, `enforce_admins` mati; berkas bukan-kode terlacak (`tmp-hr.json`, `.audit_tmp/`, `.audit-endpoints.json`, `.cov-full/`).                                                                                | Berkas: lihat PR kebersihan. Publik/proteksi: **PEMILIK**                               |
| B12 | Tak ada pemantauan saldo Zenziva (saldo habis = tak ada yang bisa login).                                                                                                                                                                                                   | **PEMILIK** / **TERBUKA**                                                               |
| B13 | Rota on-call satu orang, satu kanal Discord, `repeat_interval` 4 jam, tanpa sekunder.                                                                                                                                                                                       | **DITERIMA** (tertulis di [RUNBOOK_ONCALL.md §3](RUNBOOK_ONCALL.md))                    |
| B14 | PPN/PKP tanpa pemilik; tabel TER PPh 21 menunggu akuntan.                                                                                                                                                                                                                   | **PEMILIK** ([LEGAL_OPEN_ITEMS.md](LEGAL_OPEN_ITEMS.md))                                |

## Hipotesis yang gugur atau turun kelas setelah diverifikasi

- Migrasi yang "menunggu kode pembacanya": **0 tersisa** (10 diperiksa; semuanya sudah punya pembaca). Deploy
  menerapkan migrasi sebelum kode, dengan dump dulu.
- "Backup tak pernah di-restore": **salah** — drill mingguan berjalan (21 Sep, 14 detik, 16 database cocok).
- "Tak ada rollback/CD": **salah** — `deploy.sh` + `rollback.sh` + mode registry (19 image ~59 detik).
- "Jam kosong = selalu buka": **salah** — `opening-hours.ts` menutupnya; yang hilang hanya "antar sekarang".
- "IMAGE_PREFIX kosong": **salah** — produksi mode registry sejak 2026-09-17 (dokumen yang usang).
- "Rota tak di CI": **salah** — `ci.yml` menjalankannya (dokumen yang usang).
- Kebocoran komisi waralaba: 0 depot WARALABA di produksi dan probe deploy ada — turun jadi celah gerbang.
- "Threshold load asal lewat": sebagian salah — dikalibrasi ≈4× dari pengukuran; hanya skenario franchise yang hampa.
- Deploy merah 23–24 Sep: bug CI yang sudah diperbaiki (bukan temuan).
- Probe 473 URL: 244 respons 404, hanya **satu kelompok** defek (kasbon); sisanya GET ke rute tulis, artefak
  ekstraksi URL, atau 404 aplikasi; satu alarm palsu dibuang.
- Port 25: tak terukur dari sini (ISP memblokir).

## Yang tidak terukur tanpa akses ke kotak

Peran tanpa pemegang dan stok/harga per depot (kini dijawab `go-live-report`), label rute di Prometheus hidup
(bagian PROMETHEUS di `diagnose` pasca-deploy), nilai `BACKUP_S3_ENDPOINT`, aturan lifecycle bucket yang benar-
benar aktif (`backup-objects.mjs --dry-run` di `diagnose` melaporkan `already set` / `NOT set yet`), dan status
tiga skrip backfill manual (data hampir kosong, dampak kecil).
