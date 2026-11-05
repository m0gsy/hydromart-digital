# Verifikasi Docker dan data tersimpan lokal

Waktu pemeriksaan: 2026-11-03 sekitar 15:05–15:20 WIB. Semua query data memakai transaksi PostgreSQL `READ ONLY`; hanya agregat, status, dan rentang waktu yang dicatat. Tidak ada record identitas, token, atau nilai kunci yang disalin ke laporan.

## Asal dan batas data

Docker Desktop 29.7.2 menjalankan project Compose `hydromart`. Label container menunjuk `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.local-storage.yml`, serta overlay `prodlike-sinks.yml` dari direktori sementara Claude. Database memakai volume persisten `hydromart_hydromart_pgdata`. Data yang diperiksa adalah **data lokal tersimpan**, bukan data produksi yang asal-usulnya terverifikasi. Container yang dibuat pada 22–25 Oktober juga belum dibuktikan memakai source commit audit `1e93545a2`.

## Pemeriksaan runtime

| Pemeriksaan | Hasil | Bukti |
|---|---|---|
| Health aplikasi | 19/19 container aplikasi (18 backend/gateway dan web) `healthy` | `docker ps` pada project `hydromart` |
| Health scheduler | `unhealthy` | `docker inspect hydromart-scheduler-1`: healthcheck menyatakan tidak ada sweep sukses selama lebih dari 45 menit |
| Gateway dan web | HTTP 200 | `GET http://127.0.0.1:8080/health` dan `GET http://127.0.0.1:3000/` |
| Katalog dengan data DB | HTTP berhasil; total 20 produk aktif | `GET /products/api/v1/products?limit=1` melaporkan `total=20`; `SELECT count(*) FILTER (WHERE active) FROM products` juga 20 |
| Guard auth | HTTP 401 tanpa token | `GET /auth/api/v1/auth/me` |

Scheduler benar-benar mencoba menjalankan job, tetapi log terbatas sejak startup mencatat HTTP 401 untuk `campaigns/internal/process-sending`, `orders/outbox/internal/process`, `deliveries/internal/sla-sweep`, `webhooks/deliveries/process`, dan `orders/reminders/review`. Perbandingan nilai `INTERNAL_SERVICE_KEY` **hanya dalam memori** menunjukkan satu kelompok kunci pada scheduler, kelompok lain yang sama pada seluruh 18 backend/gateway, dan web tidak memiliki variabel itu. Nilai kunci tidak ditampilkan. Keempat layanan penerima yang diperiksa juga tidak menerima kunci scheduler sebagai `INTERNAL_SERVICE_KEY_PREVIOUS`. Ini menjelaskan 401 pada stack lokal; penyebab perubahan konfigurasi sebelumnya belum dibuktikan.

Database admin memiliki 12 baris `sweep_runs`, semuanya mencatat sukses terakhir pada 2026-10-22; waktu terbaru `2026-10-22 13:04:00.366`. Ini konsisten dengan healthcheck dan log setelah stack hidup kembali. Status ini **temuan runtime operasional lokal**, bukan bukti scheduler produksi mengalami kegagalan yang sama.

## Agregat data tersimpan

| Database / tabel | Jumlah aktual | Rincian yang aman |
|---|---:|---|
| auth / `customers` | 60 | hitungan saja |
| customer / `customer_profiles` | 69 | hitungan saja |
| order / `orders` | 73 | 66 CANCELLED, 2 COMPLETED, 2 CONFIRMED, 3 CREATED; dibuat 2026-10-22 06:36–07:09 |
| depot / `stock_movements` | 131 | 116 RECEIPT, 9 ADJUSTMENT, 4 OPNAME, 2 SALE |
| payment / `payments` | 4 | 2 PAID, 2 REFUNDED |
| delivery / `deliveries` | 2 | keduanya DELIVERED |
| loyalty / `loyalty_accounts` | 260 | hitungan saja |
| hr / `employees` | 32 | hitungan saja |
| order / `outbox_messages` | 10 | semuanya DONE, tidak ada `attempts > 1` |

Data ini membuktikan ada record persisten dan jalur katalog HTTP membaca database. Distribusi 66 order CANCELLED dari 73 dan tanggal yang terkonsentrasi pada 22 Oktober menunjukkan sampel lokal tidak layak dianggap representatif untuk metrik bisnis. Sepuluh outbox DONE tidak cukup membuktikan seluruh efek hilirnya berhasil; skenario kehilangan efek pada temuan `ORD-01` tidak direproduksi dari agregat ini.

## Keputusan verifikasi dan tindak lanjut

`npm run test:integration` tidak dijalankan pada project Compose utama yang sedang hidup. Orkestratornya menjalankan migrasi, membangun/menyalakan ulang service, membuat seed, menjalankan alur yang menulis order/pembayaran, lalu `compose down`. Menjalankannya dengan nama project utama akan mengubah database persisten dan mengganggu stack lokal. Karena itu uji mutatif dijalankan kemudian pada project, volume, dan port terisolasi seperti dicatat di bawah.

Prioritas operasional: selaraskan kunci internal scheduler dengan backend melalui deploy terkontrol, kemudian pastikan health scheduler kembali `healthy` dan `sweep_runs.lastOkAt` bergerak maju. Jangan menyimpulkan pemulihan hanya dari restart container: variabel lingkungan tersimpan saat container dibuat, dan job yang kembali aktif dapat memproses backlog.

## Pemulihan 2026-11-03

Kunci pada `.env` lokal telah dibandingkan dengan kunci 18 backend tanpa menampilkan nilainya dan cocok. Container scheduler direkreasikan **sendiri** dengan `docker-compose.yml`, `docker-compose.prod.yml`, dan `docker-compose.local-storage.yml`, menggunakan `.env` yang sama; container aplikasi dan volume PostgreSQL tidak direkreasi. Kunci scheduler baru cocok dengan backend, healthcheck menjadi `healthy`, sweep `campaigns/internal/process-sending` menjawab `ok: true`, dan `sweep_runs.lastOkAt` bergerak lagi (nilai DB teramati `2026-11-03 15:46:00.339`). Langkah ini mengganti konfigurasi container, sehingga tidak bergantung pada edit sementara `/tmp/sweep.env` yang akan hilang saat restart.

Pemanggilan pertama harness integrasi terisolasi gagal sebelum menyentuh database karena `test/integration/run.mjs` tidak meneruskan file Compose tambahan pada langkah `postgres up`. Orkestrator diperbaiki agar langkah itu memakai `COMPOSE` yang sama dengan build, healthcheck, dan teardown. Run ulang memakai project `hydromart-audit-20261103`, volume baru, PostgreSQL host port 15432, dan gateway host port 18080.

Run berikutnya membuktikan 20/20 service sehat dan semua skenario inti lulus, tetapi harness payroll memakai default container `hydromart-postgres` untuk SQL langsung. Query tulis itu ditolak oleh foreign key pada stack lokal utama. Orkestrator sekarang meneruskan nama container PostgreSQL dari konfigurasi Compose ke `PSQL_CONTAINER`, sehingga payroll membaca/menulis hanya database tes pada project isolasi.

Run ini keluar **0** dan mencetak `INTEGRATION TEST PASSED`: 20/20 healthcheck, core loop, depot-routed, online webhook, empat failure path, QRIS, dan delivery COD/PoD/settlement semuanya lulus. Harness HRIS: **23 lulus, 0 gagal, 3 dilewati**. Satu skip karena penyimpanan dokumen tidak dikonfigurasi, dua skip karena fixture payroll menggunakan bulan yang belum ditutup. Approvals: **158 lulus, 0 gagal**. Payroll manual: **semua lulus**. Container dan network project tes diturunkan otomatis; volume tes terpisah tetap tersedia untuk inspeksi ulang. Log lengkap: `isolated-integration.log`; run gagal sebelumnya: `isolated-integration-attempt1.log` dan `isolated-integration-attempt2.log`.

## Uji ulang HRIS dan dampak backlog 2026-11-04

Fixture cuti HRIS sekarang memilih minggu pada bulan yang sudah ditutup; Compose tes terisolasi menjalankan MinIO dan membuat bucket `hr-docs` sebelum HR service menyala. Percobaan pertama berhenti pada `storage-init` karena Compose memecah command shell; setelah command dibuat satu argumen, bucket berhasil dibuat dan harness penuh diulang. Run ulang keluar **0**, mencetak `INTEGRATION TEST PASSED`, dan mencapai **20/20 healthcheck**. HRIS: **30 lulus, 0 gagal, 0 skip**. Ini termasuk payroll yang mengkredit empat hari cuti, dokumen versi 1→2 dengan versi lama tetap terbaca, dan slip allowance yang terpisah dari bonus. Approvals: **158 lulus, 0 gagal**; payroll manual seluruhnya lulus. Bukti: `isolated-integration-storage-retry.log`. Project tes diturunkan otomatis; volume PostgreSQL tes tetap terpisah.

Pemeriksaan baca-saja pada stack utama setelah scheduler pulih menunjukkan scheduler `healthy`. Dari 22 job di `sweep_runs`, 21 terakhir berhasil dan satu (`shifts/internal/remind-starting`) gagal berulang dengan HTTP 404; kegagalan ini tidak membuat health container merah karena job lain masih berhasil. Pada 2026-11-03 pukul 16:05 UTC, log scheduler mencatat `orders/internal/expire-abandoned` dengan `cancelled:5, stalled:2, failed:0`. Hitungan order lokal tetap 73, tetapi distribusinya berubah dari 66 CANCELLED/2 COMPLETED/2 CONFIRMED/3 CREATED sebelum pemulihan menjadi 71 CANCELLED/2 COMPLETED; lima baris CANCELLED memiliki `updatedAt` tanggal 3 November. Perubahan status ini cocok dengan hasil sweep, tanpa klaim bahwa semua dampak hilirnya sudah terbukti. Outbox tetap 10 `DONE`. Tidak ada migrasi atau mutasi tes yang dijalankan pada project utama selama uji ulang ini.

## Pemulihan job shift dan rekonsiliasi order 2026-11-04

HTTP 404 berasal dari image HR lokal yang dibuat 22 Oktober dan belum memuat `ShiftReminderController`; image HR hasil integrasi terisolasi memuat route tersebut. Database HR lokal kekurangan satu migrasi aditif `20261023120000_shift_reminders_sent`. Setelah dump HR dibuat di direktori sementara host dan image lama diberi tag rollback, migrasi diterapkan hanya ke database HR. Container HR saja direkreasikan dengan empat file Compose yang dipakai stack, termasuk overlay sink lokal. Percobaan pertama gagal autentikasi karena `POSTGRES_PASSWORD` dalam `.env` tidak cocok dengan database persisten. Container direkreasikan lagi memakai kredensial stack yang sedang berjalan, lalu `.env` lokal diselaraskan tanpa mencetak nilainya. Konfigurasi Compose kini cocok dengan environment container HR untuk URL database, kunci internal, dan URL CRM; HR `healthy`.

Pemanggilan `shifts/internal/remind-starting` melalui `sweep.sh` scheduler menjawab `{reminded:0,skipped:0,failed:0,ok:true}`; baris `sweep_runs` untuk job itu menjadi sukses pada 2026-11-04 03:08:23 UTC dengan `consecutiveFailures=0`. Saat diperiksa, **22/22 job** berstatus sukses terakhir. Tabel `shift_reminders_sent` masih kosong; verifikasi ini membuktikan route, otorisasi internal, dan heartbeat bekerja, tetapi belum menguji pengiriman ke penerima saat ada shift yang jatuh dalam jendela 15–45 menit.

Tick cron berikutnya pada 2026-11-04 03:15:00 UTC juga menjalankan job shift secara otomatis dan mencatat `ok:true`, `reminded:0`, `failed:0`, `consecutiveFailures=0`; HR tetap `healthy`.

Lima order yang dibatalkan sweep memiliki riwayat `CANCELLED` oleh `system:scheduler` pada 3 November. Dua di antaranya sebelumnya `CONFIRMED` dan merupakan bagian dari hitungan `stalled:2`; tiga lainnya sebelumnya `CREATED`. Semua lima reservasi stok berstatus `RELEASED` pada 3 November. Dua pembayaran terkait sudah `REFUNDED` sejak 22 Oktober, sebelum sweep; tidak ditemukan delivery untuk kelima order itu. CRM mencatat lima notifikasi `ORDER_CANCELLED` berstatus `SENT` pada 3 November, dan tidak ada subscription web push pada database lokal. Angka ini mendukung rekonsiliasi status lokal; efek uang di luar database, penerimaan notifikasi perangkat, dan seluruh efek outbox lintas layanan tidak dapat disimpulkan darinya.
