# Tindak lanjut audit Hydromart — 2026-11-04

Laporan audit baseline ada di [HYDROMART_FULL_AUDIT.md](HYDROMART_FULL_AUDIT.md) dan [versi HTML](HYDROMART_FULL_AUDIT.html). Baseline `1e93545a23b3c66ab2a33da949a371406030ccd1` mencakup 4.062/4.062 file tracked (31.581.497 byte): seluruh isi dibaca program dan hash cocok. Pemeriksaan struktural seluruh file tidak disamakan dengan interpretasi manual setiap baris. Ada 71 rekomendasi yang telah diadjudikasi, dengan bukti dan batas inferensi di laporan utama.

## Perubahan yang diselesaikan

| Area | Perubahan | Bukti |
|---|---|---|
| IDO-12 | Gate `audit:ci` menolak JSON error atau laporan advisory tidak valid, sehingga kegagalan npm audit tidak lagi terlihat hijau. | `audit-gate-after-outbox.log`; fixture error/bersih/high belum diizinkan menghasilkan exit 1/0/1. |
| Auth E2E | Env tes dipasang sebelum ConfigModule divalidasi; test tidak lagi mengimpor AppModule yang belum diperlukan. | `auth-e2e-default-after-fix.log`: 5/5. |
| HRIS | Fixture cuti memakai periode payroll tertutup. Stack integrasi memakai MinIO tes dengan bucket dokumen HR. | `isolated-integration-outbox-final-retry.log`: HRIS 30 lulus, 0 gagal, 0 skip. |
| Harness | Compose untuk PostgreSQL memakai overlay dan project yang sama dengan seluruh tes; query payroll menunjuk container PostgreSQL project tes. | Log migrasi menunjukkan `127.0.0.1:15432`; project utama tetap terpisah. |
| ORD-01 | Consume stok dan qualify referral melempar kegagalan; award loyalitas dan pendapatan waralaba menolak hasil tak terverifikasi. Outbox tetap `PENDING` sampai efek berhasil atau menjadi `DEAD` dengan alert. HKP tanpa owner tetap no-op yang sah. | `order-outbox-alert-focused.log`: 484/484; run integrasi Docker lulus. |
| REF-01 | Referral membekukan order dan jumlah hadiah saat `PENDING`, memberi masing-masing sisi kunci idempoten, lalu menjadi `QUALIFIED` setelah dua hadiah berhasil. Retry melengkapi hadiah kedua tanpa menggandakan yang pertama. | `referral-full-final.log`: 125/125; kontrak adapter dan race repository diuji. |
| Stabilitas gate | Perintah Jest HR, depot, dan order berjalan serial pada host ini setelah worker paralel dihentikan oleh tekanan memori. Tes race referral lama dan dua tes web yang ambigu/berbatas waktu diperbaiki. | `hr-serial-test.log`, `depot-serial-test.log`, `web-two-failures-focused.log`. |

## Verifikasi

| Gate | Hasil | Bukti |
|---|---|---|
| `npm run lint` | Lulus, exit 0 | `lint-after-outbox.log` |
| `npm run typecheck` | Lulus, exit 0 | `typecheck-after-outbox.log` |
| `npm run build` | Lulus, exit 0; web menghasilkan 254 halaman statis | `build-after-outbox.log` |
| `npm run audit:ci` | Lulus, exit 0; 0 critical, 1 high yang di-allowlist, 17 moderate | `audit-gate-after-outbox.log` |
| `npm run test` | Lulus, exit 0: 630 suite Jest + 328 file Vitest; 12.840 tes lulus | `full-test-web-fixed-final.log` |
| Integrasi Docker pada project `hydromart-audit-20261104-final` | Lulus, exit 0: 20/20 service sehat; alur order, stok, pembayaran, delivery, HRIS 30/30, approval 158/158, payroll manual lulus | `isolated-integration-outbox-final-retry.log` |
| `git diff --check` | Lulus | Pemeriksaan workspace lokal |

Integrasi memakai database dan volume baru pada port PostgreSQL 15432 dan gateway 18080. Harness melakukan migrasi dan seed hanya di project tes, lalu menurunkan stack tersebut otomatis. Setelah selesai, `docker compose ls` hanya menampilkan project utama `hydromart`.

Log mentah yang disebut di tabel tersedia di workspace lokal audit dan tidak disertakan dalam commit karena memuat detail fixture pengujian. Angka hasil dan batas verifikasi dicatat di laporan ini.

Pemeriksaan baca saja stack utama pukul 17:00 WIB menunjukkan scheduler `healthy`, 23/23 baris job terakhir `ok`, dan heartbeat terbaru `2026-11-04 10:00:02 UTC`. Sebelumnya, pemulihan scheduler memproses lima order lokal yang tertahan, termasuk dua `stalled`; kelima reservasi stok dilepas, dua pembayaran terkait sudah `REFUNDED` sebelum sweep, dan lima notifikasi pembatalan tercatat `SENT`. Rinciannya ada di [verifikasi Docker dan data lokal](HYDROMART_DOCKER_DATA_VERIFICATION.md). Ini adalah data lokal, bukan bukti settlement eksternal atau keadaan produksi.

## Batas dan tindak lanjut

- Image order/referral pada stack utama belum dideploy ulang; kode terbaru diuji pada project Docker terisolasi. Deploy ke stack utama perlu memperhitungkan backlog outbox lokal.
- Referral historis yang sudah `QUALIFIED` tetapi mungkin kehilangan hadiah tidak dibackfill otomatis. Ledger loyalty perlu direkonsiliasi sebelum kredit ulang.
- Baris outbox `DEAD` sekarang memberi alert dan terlihat pada hitungan ops, tetapi pemutaran ulang memerlukan tindakan operator yang terkontrol. Kebijakan replay dan kompensasi hadiah referral untuk order yang kemudian di-void masih perlu keputusan bisnis.
- Android native build dan perangkat fisik belum diverifikasi pada host ini karena SDK/JAVA_HOME tidak tersedia. Audit kode mobile tetap termasuk dalam cakupan file baseline.
