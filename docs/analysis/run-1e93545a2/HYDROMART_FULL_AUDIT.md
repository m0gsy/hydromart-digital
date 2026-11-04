# Hydromart — Audit Repositori Penuh (1e93545a2)

Disusun 2026-11-04 10:13 WIB. **Cakupan file tracked: 100%** pada baseline `1e93545a23b3c66ab2a33da949a371406030ccd1`. Audit kode dan artefak lokal; tidak menyatakan kondisi produksi telah diuji.

**Status terbaru (2026-11-04):** Gate `npm run test` yang gagal pada pemeriksaan awal sudah diperbaiki dan lulus 12.840/12.840 tes. Gate lint, typecheck, build, audit dependensi, dan integrasi Docker terisolasi juga lulus. ORD-01, REF-01, serta IDO-12 sudah diperbaiki; temuan lain dalam laporan ini tetap merupakan backlog audit. Rincian perubahan, bukti, dan batas verifikasi ada di [tindak lanjut audit](09-remediation-and-verification.md).


## 1. Ringkasan eksekutif

Seluruh 4.062 file tracked dibaca sampai akhir untuk inventaris dan validasi format; 4.002 file teks diperiksa secara struktural dan 60 berkas biner diperiksa signature/ZIP/hash. Ada 70 rekomendasi yang telah diadjudikasi dari 236 kandidat historis, ditambah satu temuan baru pada gate audit dependensi; kandidat lama yang tidak lolos tidak dipromosikan menjadi temuan baru. Risiko paling penting menyangkut gate keamanan yang lulus palsu, efek lintas layanan yang dapat hilang, retry stok yang belum idempoten, pengantaran setelah proof, dan pembatasan ekspor PII.

| ID | Asal | Dampak | Status | Temuan |
|---|---|---|---|---|
| AUT-027 | IDO-12 | 4 | keep | Gate audit dependensi lulus saat endpoint advisory gagal |
| FLW-010 | ORD-01 | 5 | keep | Outbox selesai meski efek stok/poin/referral/pendapatan gagal |
| FLW-008 | DLV-07 | 4 | keep | Pulihkan efek samping setelah proof of delivery tersimpan |
| FLW-003 | DEP-01 | 4 | keep | Kunci gerakan GALON menyamakan issue dan return satu order |
| FLW-004 | DEP-02 | 4 | keep | Penerimaan PO belum atomik terhadap retry/crash/paralel |
| FLW-020 | WEB-01 | 4 | keep | Logout native kehilangan bearer sebelum revoke dan unsubscribe |
| AUT-012 | HR-21 | 4 | keep | Ekspor karyawan melewati redaksi depot peminjam |
| FLW-016 | PPA-01 | 4 | keep | Pertahankan pembayaran berbukti dalam antrean tinjau saat TTL lewat |
| FLW-005 | DLV-01 | 4 | keep | Replay reschedule selalu memulihkan handoff order |
| AUT-007 | AUT-01 | 4 | keep | Lindungi peran akun saat ini dan super admin terakhir pada perubahan peran |
| FLW-002 | CRM-01 | 4 | keep | Kampanye memakai lease tetapi belum meneruskan dedupeKey per penerima |


## 2. Metode dan cakupan

`full-file-scan.json` dan `01-full-coverage.csv` mencatat setiap path, byte, metode, format, dan SHA-256. Hash seluruh file sama dengan manifest baseline; tidak ada `UNREAD` dalam cakupan pemindaian penuh. `READ-STRUCTURAL` berarti isi penuh dibaca program dan format/AST diperiksa; ini tidak berarti setiap baris ditafsirkan manual. `BINARY-INSPECTED` berarti isi penuh di-hash dan signature atau integritas ZIP diperiksa. Seluruh 71 rekomendasi mempunyai path/baris bukti yang valid, tinjauan semantik terarah, kontrol yang ada, keputusan dan batas inferensi. Arsip klaim lama tetap terpisah.

| Owner | File | Teks struktural | Biner | Byte |
|---|---|---|---|---|
| .claude | 12 | 12 | 0 | 38223 |
| .github | 10 | 10 | 0 | 213177 |
| .uat | 25 | 25 | 0 | 396419 |
| apps/web | 950 | 944 | 6 | 7059909 |
| docs | 77 | 50 | 27 | 7381479 |
| infra | 2 | 2 | 0 | 4430 |
| mobile | 64 | 37 | 27 | 587969 |
| ops | 10 | 10 | 0 | 72944 |
| packages/access | 8 | 8 | 0 | 86124 |
| packages/platform | 101 | 101 | 0 | 400086 |
| root | 24 | 24 | 0 | 1056214 |
| scripts | 210 | 210 | 0 | 1668662 |
| services/admin-service | 238 | 238 | 0 | 763313 |
| services/auth-service | 196 | 196 | 0 | 982047 |
| services/crm-service | 129 | 129 | 0 | 483499 |
| services/customer-service | 143 | 143 | 0 | 558135 |
| services/dashboard-service | 26 | 26 | 0 | 162538 |
| services/delivery-service | 192 | 192 | 0 | 928816 |
| services/depot-service | 374 | 374 | 0 | 1798547 |
| services/forecast-service | 73 | 73 | 0 | 239160 |
| services/gateway-service | 27 | 27 | 0 | 139387 |
| services/hr-service | 341 | 341 | 0 | 2109845 |
| services/loyalty-service | 81 | 81 | 0 | 347637 |
| services/order-service | 242 | 242 | 0 | 1998497 |
| services/payment-service | 96 | 96 | 0 | 503477 |
| services/payout-service | 126 | 126 | 0 | 549286 |
| services/product-service | 70 | 70 | 0 | 159540 |
| services/promo-service | 110 | 110 | 0 | 570500 |
| services/recommendation-service | 44 | 44 | 0 | 103240 |
| services/referral-service | 58 | 58 | 0 | 166174 |
| test | 3 | 3 | 0 | 52223 |

Satu file sertifikat publik `ops/env-backup-public.pem` valid secara format dan metadata; isi kunci tidak dicetak. `.env` lokal yang tidak tracked bukan bagian repositori. `mobile-release-1.14.1/RELEASE_NOTES.md` adalah dokumen tambahan lokal, dibaca sebelumnya tetapi tidak dipakai sebagai bukti rilis produksi.


## 3. Arsitektur dan inventaris

Aplikasi memakai Next.js untuk customer dan konsol staf, gateway/BFF, 18 service NestJS dengan database Prisma per service, serta paket bersama `platform` dan `access`. Handoff antarservice melalui HTTP internal dan outbox/scheduler; tidak ada transaksi database lintas layanan. `02-inventory.json` mengindeks 853 deklarasi endpoint, 250 halaman unik, 168 model Prisma dan 498 migrasi. Deklarasi endpoint tidak otomatis berarti route publik atau guard resource-level benar. Alur dan titik kegagalan dirinci di [03-cross-service-flows.md](03-cross-service-flows.md). Keputusan bisnis dan konflik dokumen ada di [00-context.md](00-context.md).


## 4. Hasil quality gate lokal pada pemeriksaan awal

| Gate | Hasil | Bukti / batas |
|---|---|---|
| Tracked-file full scan | LULUS | 4.062/4.062 file dibaca penuh; 31.581.497 byte; hash cocok baseline; 0 masalah format/signature; full-scan-summary.json. |
| TypeScript/JS AST | LULUS | 0 parse diagnostic pada ekstraksi AST seluruh source JS/TS/TSX; 02-inventory.json. |
| Shell dan YAML | LULUS | 105 skrip shell bash -n dan 23 YAML parse; 0 gagal; shell-syntax.json dan yaml-syntax.json. |
| npm run typecheck | LULUS | Seluruh workspace exit 0 pada Node 25/npm 11 lokal. |
| npm run lint | LULUS | Seluruh workspace exit 0 pada Node 25/npm 11 lokal. |
| npm run db:validate | LULUS | 16 schema Prisma valid setelah DATABASE_URL dummy hanya untuk proses validasi; tanpa koneksi DB. |
| npm run test | GAGAL DEFAULT | Satu dari 40 suite auth gagal saat import AppModule meminta AUTH_DATABASE_URL; 767 assertion auth lain lulus. Seluruh 2.767 tes web lulus; log full-test.log dan web-vitest.json. |
| Auth E2E recheck | LULUS BERSYARAT | auth.e2e.spec.ts lulus 5/5 dengan variabel tes sementara; auth-e2e-recheck.log. Setup default tetap perlu diperbaiki. |
| npm run build | LULUS | Seluruh workspace exit 0; web Next.js compiled successfully; full-build.log. |
| node test/integration/run.mjs pada Docker terisolasi | LULUS | Project/volume/port terpisah dengan storage MinIO tes; 20/20 service sehat, semua skenario inti lulus, HRIS 30 lulus/0 gagal/0 skip, approvals 158/0, payroll manual lulus; isolated-integration-storage-retry.log. |
| npm run audit:ci | LULUS SETELAH PERBAIKAN | Baseline sebelumnya lulus palsu saat npm audit gagal (IDO-12). Gate kini menolak JSON error/laporan tidak valid; fixture error exit 1, bersih exit 0, high belum diizinkan exit 1. Run nyata exit 0: 0 critical, 1 high yang di-allowlist, 17 moderate; audit-gate-current.log. |
| Android native build/runtime | TERHALANG | JAVA_HOME/Android SDK tidak tersedia pada lingkungan ini; build dan perangkat fisik tidak diverifikasi. |

Lingkungan: Node v25.9.0, npm 11.12.1; versi repo mengharapkan Node 22/npm 10. Hasil lokal tidak menggantikan CI pada versi yang diwajibkan.


## 5. Prioritas dan roadmap

Urutan pertama: buat gate audit dependensi gagal bila sumber advisori gagal (IDO-12), pulihkan efek yang hilang setelah commit lokal (ORD-01, DLV-07, REF-01), buat posting stok/PO idempoten (DEP-01, DEP-02, APP-02), tutup jalur otorisasi/PII (AUT-01, HR-21, AAS-04), dan bedakan transaksi berbukti yang perlu tinjau dari TTL biasa (PPA-01). Dependency penerima dan kebijakan Finance/Ops harus disahkan sebelum backfill atau perubahan status uang. Fase berikutnya menyelaraskan KPI, SLA per attempt, pajak, refund dan forecast sesuai [katalog BI](07-bi-catalog.md) serta [otomasi](08-automation.md). Tidak ada ROI nominal, angka kerugian, atau deadline yang dibuat-buat.

| ID | Area | Dampak | Effort | Kelompok | Tindakan | Judul |
|---|---|---|---|---|---|---|
| AUT-007 | AUT | 4 | M | Quick Win | keep | Lindungi peran akun saat ini dan super admin terakhir pada perubahan peran |
| AUT-012 | AUT | 4 | M | Quick Win | keep | Ekspor karyawan melewati redaksi depot peminjam |
| AUT-027 | AUT | 4 | S | Quick Win | keep | Gate audit dependensi lulus saat endpoint advisory gagal |
| FLW-002 | FLW | 4 | M | Quick Win | keep | Kampanye memakai lease tetapi belum meneruskan dedupeKey per penerima |
| FLW-005 | FLW | 4 | S | Quick Win | keep | Replay reschedule selalu memulihkan handoff order |
| FLW-016 | FLW | 4 | M | Quick Win | keep | Pertahankan pembayaran berbukti dalam antrean tinjau saat TTL lewat |
| FLW-020 | FLW | 4 | S | Quick Win | keep | Logout native kehilangan bearer sebelum revoke dan unsubscribe |
| FLW-010 | FLW | 5 | L | Strategis | keep | Outbox selesai meski efek stok/poin/referral/pendapatan gagal |
| AUT-001 | AUT | 4 | M | Strategis | keep | Validasi penerima laporan dan putuskan akses per dataset |
| AUT-010 | AUT | 4 | M | Strategis | keep | Ikat key foto PoD ke objek yang sah sebelum sign/delete |
| AUT-015 | AUT | 4 | L | Strategis | keep | Dump database diunggah sebagai gzip tanpa enkripsi klien |
| AUT-022 | AUT | 4 | M | Strategis | keep | Simpan pelaku, waktu dan referensi hasil pencairan manual |
| FLW-003 | FLW | 4 | L | Strategis | keep | Kunci gerakan GALON menyamakan issue dan return satu order |
| FLW-004 | FLW | 4 | M | Strategis | keep | Penerimaan PO belum atomik terhadap retry/crash/paralel |
| FLW-007 | FLW | 4 | L | Strategis | keep | Tutup celah jendela pertanggungjawaban COD pada shift basi |
| FLW-008 | FLW | 4 | L | Strategis | keep | Pulihkan efek samping setelah proof of delivery tersimpan |
| FLW-011 | FLW | 4 | L | Strategis | reclassify | Penjualan konter dan pencatatan pembayaran masih dua langkah |
| FLW-019 | FLW | 4 | L | Strategis | keep | Pisahkan qualification referral dari penyelesaian reward durable |
| AUT-002 | AUT | 3 | S | Strategis | keep | Pisahkan hasil pembuatan file dan hasil pengiriman laporan |
| AUT-009 | AUT | 3 | M | Strategis | reclassify | Retur kurir belum mengikat order/customer ke delivery yang berwenang |
| AUT-011 | AUT | 3 | M | Strategis | reclassify | Rebuild forecast tidak membedakan feed gagal dari feed selesai |
| AUT-014 | AUT | 3 | S | Strategis | keep | Input dispatch disisipkan ke badan shell sebelum validasi |
| AUT-017 | AUT | 3 | M | Strategis | keep | Pemantauan belum membuktikan kesehatan ujung-ke-ujung jalur alert |
| AUT-023 | AUT | 3 | M | Strategis | reclassify | Nudge pesan ulang berulang dan penghitung sukses mengabaikan boolean |
| BI-003 | BI | 3 | M | Strategis | reclassify | Register keamanan perlu direkonsiliasi per bukti |
| FLW-001 | FLW | 3 | M | Strategis | keep | Retry penyesuaian stok delta dapat membuat movement kedua |
| FLW-006 | FLW | 3 | S | Strategis | keep | Teruskan customerId dan deliveryWindow pada dispatch staf |
| FLW-013 | FLW | 3 | L | Strategis | keep | Audit HTTP best-effort masih berpotensi kehilangan entri |
| FLW-021 | FLW | 3 | M | Strategis | keep | Retensi offline menghapus seluruh jenis job termasuk pencatatan uang |
| FTR-002 | FTR | 3 | M | Strategis | keep | Lengkapi jejak persetujuan untuk akun yang dibuat lewat login |
| FTR-003 | FTR | 3 | S | Strategis | keep | Pisahkan mutasi alamat biasa dari penggantian alamat utama |
| FLW-009 | FLW | 3 | S | Nice-to-have | keep | Installer belum menyiapkan log backup provider kedua |
| AUT-004 | AUT | 2 | S | Nice-to-have | keep | Allowlist auth test terlalu luas pada products namespace |
| AUT-016 | AUT | 2 | S | Nice-to-have | keep | Perjelas permissions workflow dan pin Buildx SHA |
| AUT-018 | AUT | 2 | S | Nice-to-have | keep | Raw URL pada alert memperlebar cardinality dan konteks sensitif |
| AUT-019 | AUT | 2 | S | Nice-to-have | keep | Regex audit terlalu luas untuk field shipping dan params mentah |
| AUT-020 | AUT | 2 | S | Nice-to-have | keep | Audit permission mobile memakai allowlist gabungan dua binary |
| AUT-021 | AUT | 2 | M | Nice-to-have | keep | Dependency mobile terpisah dari npm workspace vulnerability gate |
| BI-004 | BI | 2 | S | Nice-to-have | reclassify | Dokumen status PPN perlu diselaraskan dengan fitur tarif0 |
| BI-005 | BI | 2 | S | Nice-to-have | reclassify | Kumpulan komentar historis usang perlu adjudikasi per baris |
| BI-006 | BI | 2 | S | Nice-to-have | reclassify | readAllPages ceiling tidak ketat pada short final page |
| BI-007 | BI | 2 | S | Nice-to-have | reclassify | Netralisasi CSV mengubah angka negatif menjadi teks |
| FLW-014 | FLW | 2 | M | Nice-to-have | keep | Kursor invalid diam-diam memakai nomor halaman |
| FLW-023 | FLW | 2 | S | Nice-to-have | keep | needsPayment hanya mengecualikan CANCELLED |
| FTR-008 | FTR | 2 | S | Nice-to-have | keep | HTTP exception code generik untuk 409/422/503 |
| FTR-011 | FTR | 2 | S | Nice-to-have | keep | Gate editor earning rule belum mengikuti capability server |
| AUT-024 | AUT | 1 | M | Nice-to-have | keep | Upload PoD diulang pada tiap retry complete |
| AUT-025 | AUT | 1 | S | Nice-to-have | reclassify | Revalidasi profil memicu refresh data turunan |
| AUT-026 | AUT | 1 | M | Nice-to-have | keep | File transfer belum memakai telemetry dan retry rate-limit JSON |
| FLW-015 | FLW | 1 | S | Nice-to-have | keep | Callback geolocation native hanya satu slot pending |
| FLW-022 | FLW | 1 | S | Nice-to-have | reclassify | Kegagalan delete IndexedDB disembunyikan dari UI |
| FTR-007 | FTR | 1 | S | Nice-to-have | keep | Override depot adjustMaxPoints tidak dibaca pada adjustment |
| FTR-009 | FTR | 1 | M | Nice-to-have | reclassify | FileProvider path luas bersifat hardening kondisional |
| FTR-012 | FTR | 1 | S | Nice-to-have | keep | Sebagian teks utilitas belum memakai resolver locale |
| BI-001 | BI | 4 | M | Jangan dikerjakan dulu | defer-policy | Definisikan jam SLA tiap percobaan pengantaran ulang |
| BI-002 | BI | 4 | M | Jangan dikerjakan dulu | defer-policy | Definisi bruto pajak variabel perlu konfirmasi akuntan |
| FLW-017 | FLW | 4 | L | Jangan dikerjakan dulu | defer-policy | Bedakan persetujuan refund manual dari uang benar-benar diserahkan |
| FLW-018 | FLW | 4 | L | Jangan dikerjakan dulu | defer-policy | Tetapkan alokasi reversal franchise untuk refund setelah order selesai |
| FTR-005 | FTR | 4 | L | Jangan dikerjakan dulu | defer-policy | Anonimisasi employee menyisakan field identitas lain |
| AUT-003 | AUT | 3 | M | Jangan dikerjakan dulu | defer-policy | Tentukan retensi dataset lokal admin sebelum membuat purge |
| AUT-008 | AUT | 3 | M | Jangan dikerjakan dulu | defer-policy | Penyesuaian stok mentah dan opname perlu kebijakan kontrol kuantitas |
| FLW-012 | FLW | 3 | M | Jangan dikerjakan dulu | defer-policy | Kebijakan voucher online batal belum dipulihkan pada jalur cancel yang dibaca |
| FLW-025 | FLW | 3 | L | Jangan dikerjakan dulu | defer-evidence | Tidak adanya Idempotency-Key bukan bukti semua POST tidak idempoten |
| FTR-004 | FTR | 3 | M | Jangan dikerjakan dulu | reclassify | Lembur dihitung dari menit kehadiran tanpa approval lembur terpisah pada jalur yang dibaca |
| FTR-006 | FTR | 3 | M | Jangan dikerjakan dulu | defer-policy | Scrub subscription menyisakan alamat dan koordinat |
| AUT-005 | AUT | 2 | S | Jangan dikerjakan dulu | defer-evidence | Input placeholder perlu telaah label persisten dan AT |
| AUT-006 | AUT | 2 | S | Jangan dikerjakan dulu | defer-evidence | Gate dashboard per halaman merupakan perlindungan regresi |
| AUT-013 | AUT | 2 | S | Jangan dikerjakan dulu | reclassify | Baseline Load gagal dipush tetapi run tetap sukses |
| FTR-001 | FTR | 2 | M | Jangan dikerjakan dulu | defer-policy | Perjelas semantik BETA/ROLLOUT pada flag publik |
| FTR-010 | FTR | 2 | M | Jangan dikerjakan dulu | reclassify | Recommendation service memakai ProductRef lokal tanpa status aktif/depot |
| FLW-024 | FLW | 1 | M | Jangan dikerjakan dulu | defer-evidence | Sinkronisasi sesi lintas tab belum diperiksa memadai |


## 6. Rekomendasi teradjudikasi

Semua bukti di bawah adalah path/baris source pada baseline. Status `keep` adalah pekerjaan yang disarankan, `reclassify` memperbaiki cakupan atau dampak klaim, dan `defer` menunggu kebijakan/bukti. Temuan IDO-12 juga didukung reproduksi gate lokal; tidak ada klaim kejadian produksi tanpa data.


### AUT-007 — Lindungi peran akun saat ini dan super admin terakhir pada perubahan peran

Asal `AUT-01` · AUT · dampak 4/5 · effort M · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** canGrantRole mengevaluasi peran baru; invite akun yang sudah ada mengubah role lalu save by id. Guard super admin terakhir tersedia untuk delete/suspend, bukan save role. Risiko penurunan peran disimpulkan dari interleaving source, bukan insiden produksi.

**Kontrol yang ada:** RESTRICTED_GRANTS membatasi pemberian peran baru; suspend/delete melindungi super admin terakhir dengan lock.

**Usulan:** Gunakan otorisasi terhadap peran lama dan baru; lindungi keluar dari SUPER_ADMIN dalam transaksi dengan pola lock yang sudah tersedia, termasuk invite ulang dan jalur internal HR.

**Acceptance:** HEAD_OFFICE tidak dapat mengganti SUPER_ADMIN menjadi STAFF_DEPOT melalui invite; dua penurunan paralel tidak menghapus super admin aktif terakhir; perpindahan depot tanpa perubahan peran tetap bekerja.

**Verifikasi:** Unit policy actor/old/new role, controller wiring, dan race Postgres pada demotion. Belum dijalankan.

**Owner dan dependensi:** Backend Auth dan Security; Kontrak grantedBy HR yang sudah ada; perlu review kompatibilitas peran custom.

**Bukti:**
- `services/auth-service/src/application/services/account.service.ts:359` — Pemeriksaan grant memakai role tujuan sebelum membaca akun existing.
- `services/auth-service/src/application/services/account.service.ts:375` — Existing dipromosikan/diganti peran dan disimpan.
- `services/auth-service/src/infrastructure/prisma/repositories/customer.prisma.repository.ts:201` — save mengubah role by id tanpa guard last-admin.
- `packages/access/src/index.ts:842` — canGrantRole bergantung targetRole.


### AUT-012 — Ekspor karyawan melewati redaksi depot peminjam

Asal `HR-21` · AUT · dampak 4/5 · effort M · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** [INFERRED] employeeReport memakai depotScopeIds lalu mencetak NIK/NPWP/rekening/gaji dari Employee penuh; tidak memakai homeDepot redaction seperti list. Dampak borrower memerlukan penugasan lintas depot aktif.

**Kontrol yang ada:** Scope depot ada; list/get employee dan payroll menerapkan redaksi; ekspor sengaja lengkap untuk round-trip HQ.

**Usulan:** Gunakan kebijakan home/current-depot yang sama untuk ekspor, pertahankan field lengkap bagi pihak berwenang; tambahkan jejak download metadata tanpa payload PII.

**Acceptance:** Borrowed employee tetap terlihat operasional tetapi NIK/rekening/gaji kosong di CSV dan XLSX; home/HQ tetap dapat round-trip yang diizinkan; download tercatat tanpa menyalin PII.

**Verifikasi:** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner dan dependensi:** Backend HR + pemilik akses HR; Reuse employee redaction/home-depot reach; fixture penugasan lintas depot. Effort M karena ekspor dua format dan kontrol akses.

**Bukti:**
- `services/hr-service/src/modules/reports.controller.ts:81` — GET export memakai hrView
- `services/hr-service/src/application/services/analytics.service.ts:218` — employeeReport memakai current depot scope
- `services/hr-service/src/application/services/analytics.service.ts:293` — Kolom identitas dan rekening diekspor
- `services/hr-service/src/infrastructure/prisma/analytics.prisma.repository.ts:266` — Query Employee lengkap dengan live depotId
- `services/hr-service/src/application/services/employee.service.ts:294` — List menerapkan redaksi bila home depot tidak terjangkau
- `services/hr-service/src/domain/employee-redaction.ts:11` — Daftar field yang wajib disamarkan bagi peminjam
- `services/hr-service/src/infrastructure/http/audit.interceptor.ts:31` — GET dilewati audit mutasi


### AUT-027 — Gate audit dependensi lulus saat endpoint advisory gagal

Asal `IDO-12` · AUT · dampak 4/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** Pada 2026-11-03, npm audit --omit=dev --json keluar 1 dan mengembalikan objek error tanpa vulnerabilities/metadata. scripts/audit-gate.mjs menangkap stdout itu, mem-parse JSON, memperlakukan field yang hilang sebagai objek kosong lalu keluar 0 sambil mencetak 0 critical/0 high. Jalur yang sama berlaku di CI ketika registry audit gagal; hasil aman tidak terbukti.

**Kontrol yang ada:** Workflow Security terpisah menjalankan pemindaian lain; gate ini tetap dipanggil oleh CI dan seharusnya memblokir advisori high/critical yang belum ditinjau.

**Usulan:** Validasi bentuk respons npm audit sebelum membaca vulnerabilities; objek error atau metadata hilang harus membuat gate gagal dengan pesan koneksi/format. Pertahankan perlakuan exit nonzero yang memang berisi laporan advisori valid.

**Acceptance:** JSON error dari npm audit menyebabkan audit:ci exit nonzero; laporan advisori valid dengan vulnerability high yang tidak di-allowlist tetap gagal; laporan valid tanpa blocker lulus.

**Verifikasi:** Tes unit/CLI terisolasi untuk tiga bentuk stdout tersebut; ulangi audit terhadap registry yang tersedia sebelum mengklaim tidak ada advisori baru.

**Owner dan dependensi:** Platform dan Security; Tidak ada perubahan schema/API; CI perlu membedakan kegagalan jaringan dari hasil advisori.

**Bukti:**
- `scripts/audit-gate.mjs:108` — stdout dari exit nonzero diterima tanpa membedakan error audit.
- `scripts/audit-gate.mjs:114` — JSON apa pun di-parse sebagai report.
- `scripts/audit-gate.mjs:115` — vulnerabilities yang hilang menjadi objek kosong.
- `scripts/audit-gate.mjs:136` — metadata yang hilang menjadi objek kosong dan angka 0.
- `.github/workflows/ci.yml:136` — CI memanggil gate tersebut.


### FLW-002 — Kampanye memakai lease tetapi belum meneruskan dedupeKey per penerima

Asal `CRM-01` · FLW · dampak 4/5 · effort M · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** [INFERRED] Notification ditulis sebelum recordRecipientResult. Lease recipient dapat kedaluwarsa; replay memanggil notify tanpa dedupeKey dan membuat row/push baru.

**Kontrol yang ada:** Lease claimToken dan reclaim basi tersedia; dedupe notification dan migrasi unik sudah tersedia; marketing opt-out fail-closed.

**Usulan:** Bawa identitas recipient ke delivery port lalu gunakan key deterministik campaign-recipient; tetap bedakan percobaan kampanye baru. Review hasil lease agar stale worker tidak menimpa hasil baru.

**Acceptance:** Crash setelah row notification sebelum result, lalu reclaim recipient: satu inbox row dan paling banyak satu push attempt untuk recipient kampanye itu; kampanye berbeda tetap boleh mengirim.

**Verifikasi:** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner dan dependensi:** Backend CRM + marketing; Kontrak internal dalam crm; verifikasi migrasi dedupe pada deployment terpisah. Effort M karena port/fake/controller/service tests.

**Bukti:**
- `services/crm-service/src/application/services/campaign.service.ts:306` — Deliver sebelum simpan hasil
- `services/crm-service/src/infrastructure/prisma/campaign.prisma.repository.ts:175` — SENDING lease basi dapat diklaim ulang
- `services/crm-service/src/infrastructure/notification/inbox-broadcast.delivery.ts:38` — notify tanpa dedupeKey
- `services/crm-service/src/application/services/notification.service.ts:244` — Dedupe hanya jika key terisi; existing row tidak push ulang
- `services/crm-service/src/infrastructure/prisma/notification.prisma.repository.ts:100` — recordOnce menangani unique violation
- `services/crm-service/prisma/migrations/20261030140000_notification_dedupe_key/migration.sql:11` — Unique index dedupeKey tersedia sebagai migrasi source
- `services/crm-service/src/modules/campaign.module.ts:48` — InboxBroadcastDelivery terdaftar
- `scripts/scheduler/crontab:83` — Kampanye diproses setiap dua menit


### FLW-005 — Replay reschedule selalu memulihkan handoff order

Asal `DLV-01` · FLW · dampak 4/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** Status RESCHEDULED disimpan sebelum advanceOrder(PREPARING). Replay tanggal sama memanggil finishRescheduleReplay, tetapi segera return jika cashReturned tidak true.

**Kontrol yang ada:** CAS status dan replay payload tanggal sama; kegagalan reversal tunai mencoba rollback; handoff mengenali OrderAlreadyClaimedError.

**Usulan:** Pisahkan pemulihan handoff order dari syarat reversal kas; tangani replay order yang sudah mencapai tujuan secara idempoten. Notifikasi harus memakai identitas percobaan agar reassign sah tidak teredam.

**Acceptance:** Advance pertama gagal setelah status tersimpan, retry payload sama tanpa cashReturned menyelesaikan handoff; reversal tunai tidak berulang; order yang sudah direassign tidak dimundurkan.

**Verifikasi:** Unit fault injection dan contract replay dengan order-service, termasuk status sudah lanjut. Belum dijalankan.

**Owner dan dependensi:** Backend Delivery; Semantik konflik/transisi order yang sudah ada; jangan menelan seluruh 409 sebagai sukses.

**Bukti:**
- `services/delivery-service/src/application/services/delivery.service.ts:845` — Replay return awal bila cashReturned false.
- `services/delivery-service/src/application/services/delivery.service.ts:874` — Replay tanggal sama menuju helper.
- `services/delivery-service/src/application/services/delivery.service.ts:940` — Advance order dilakukan setelah status lokal tersimpan.


### FLW-016 — Pertahankan pembayaran berbukti dalam antrean tinjau saat TTL lewat

Asal `PPA-01` · FLW · dampak 4/5 · effort M · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** findStalePending menyaring status/metode/createdAt tanpa proofUrl; sweep CAS PENDING menjadi FAILED. Bukti unggah bukan bukti uang sudah masuk, tetapi membutuhkan tinjau sebelum status terminal.

**Kontrol yang ada:** CASH dikecualikan; CAS mencegah menimpa PAID; TTL mempunyai kill switch; notifikasi bukti tersedia.

**Usulan:** Pisahkan expiry belum-ada-bukti dari review bukti. Cek proof dalam predicate atomik agar unggah serentak tidak ditimpa. Pertahankan notifikasi dan antrean manual yang sudah ada.

**Acceptance:** PENDING dengan proofUrl tidak menjadi FAILED pada expiry; proof yang masuk serentak dengan sweep mendapat hasil konsisten; PENDING tanpa bukti tetap dapat kedaluwarsa; CASH dan PAID tidak berubah.

**Verifikasi:** Unit sweep dan race upload-vs-expire; verifikasi antrean staf. Tidak menjalankan pembayaran nyata.

**Owner dan dependensi:** Backend Payment dan Finance Ops; Kontrak review bukti yang sudah ada; Finance menyepakati penanganan bukti invalid melalui jalur fail manual.

**Bukti:**
- `services/payment-service/src/infrastructure/prisma/payment.prisma.repository.ts:122` — Query stale tanpa pengecualian proof.
- `services/payment-service/src/application/services/payment.service.ts:703` — Sweep memindah PENDING ke FAILED.
- `services/payment-service/src/domain/payment.ts:98` — FAILED terminal pada domain transition.


### FLW-020 — Logout native kehilangan bearer sebelum revoke dan unsubscribe

Asal `WEB-01` · FLW · dampak 4/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** signOut memulai request auth lalu clearTokens pada tick sama. request menunggu waitForSession sebelum rawRequest membaca bearer. await atas promise yang sudah resolved pun menunda kelanjutan; token sudah null. nativeUnsubscribe juga menunggu readEndpoint. Gateway native meneruskan bearer yang diterima ke auth/logout SelfScoped.

**Kontrol yang ada:** Pembersihan profil/lokasi/depot/familyId sudah ada; gateway selalu membersihkan cookie web dan mengembalikan revoked; subscribe berikutnya mengganti pemilik endpoint.

**Usulan:** Tangkap token pada request revoke/unsubscribe sebelum clear, atau tunggu revoke dengan deadline lalu selalu bersihkan lokal. Jangan biarkan jaringan macet menahan logout.

**Acceptance:** Pada native sesi terbuka, signOut membuat POST logout dan DELETE push memakai bearer sebelum pembersihan; server revoke mengembalikan revoked=true. Saat layanan gagal, pembersihan lokal tetap selesai dengan deadline dan UI membedakan revoke belum terbukti.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Frontend/mobile engineer; Pertahankan token di snapshot request atau selesaikan revoke/unsubscribe secara terbatas sebelum clear. Jangan mengandalkan urutan pemanggilan promise.

**Bukti:**
- `apps/web/src/lib/auth-context.tsx:151` — logout fire-and-forget dan unsubscribe diikuti clearTokens tanpa await
- `apps/web/src/lib/api.ts:383` — request menunggu sebelum rawRequest
- `apps/web/src/lib/api.ts:265` — rawRequest membaca bearer dari token store saat dijalankan
- `apps/web/src/lib/token-store.ts:163` — setTokens(null) menghapus token memori secara sinkron
- `apps/web/src/lib/push.ts:212` — unsubscribe membaca endpoint asinkron sebelum DELETE
- `services/gateway-service/src/routing/session-bff.ts:253` — native logout membaca Authorization request dan meneruskannya ke auth-service
- `services/auth-service/src/modules/auth/account.controller.ts:388` — logout SelfScoped memakai CurrentUser untuk actorCustomerId


### FLW-010 — Outbox selesai meski efek stok/poin/referral/pendapatan gagal

Asal `ORD-01` · FLW · dampak 5/5 · effort L · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** [INFERRED] Handler memenuhi Promise tanpa throw ketika adapter gagal; run menandai DONE. Kegagalan lookup pemilik juga mengembalikan null sehingga memperbaiki adapter payout saja tidak cukup.

**Kontrol yang ada:** Outbox ditulis bersama status; backoff 6 percobaan dan 10 untuk PAYMENT_REVERSAL; pembatalan order mencegah side effect baru; reversal pembayaran/pendapatan sudah dapat throw.

**Usulan:** Bedakan integrasi nonaktif yang sah dari dependency unavailable; failure efek wajib harus mempertahankan PENDING. Audit idempotensi penerima dan kompensasi lebih dahulu, khususnya referral reward; tambahkan alert/replay dengan batas kewenangan.

**Acceptance:** Untuk setiap topik, 500/timeout tidak menghasilkan DONE; pemulihan dependency menghasilkan satu efek bisnis; pengulangan/referral tidak memberi reward ganda; HKP tanpa pemilik tetap no-op yang sah.

**Verifikasi:** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner dan dependensi:** Backend order + pemilik depot/loyalty/referral/payout + SRE; Validasi idempotensi penerima per orderId, REF-01, strict lookup ownership, rollout lintas service. Effort L karena kontrak failure dan efek uang lintas database.

**Bukti:**
- `services/order-service/src/application/services/order.service.ts:337` — Registrasi handler empat topik pada constructor
- `services/order-service/src/application/services/outbox.service.ts:125` — deliver diikuti markDone; retry hanya di catch
- `services/order-service/src/infrastructure/http/inventory.http.adapter.ts:67` — consume menelan error
- `services/order-service/src/infrastructure/http/loyalty-coordination.http.adapter.ts:59` — awardPoints gagal mengembalikan null
- `services/order-service/src/infrastructure/http/referral-coordination.http.adapter.ts:39` — qualify menelan error
- `services/order-service/src/infrastructure/http/franchise-revenue.http.adapter.ts:70` — orderCompleted gagal mengembalikan null
- `services/order-service/src/infrastructure/http/depot-directory.http.adapter.ts:202` — lookup pemilik gagal mengembalikan null
- `services/order-service/src/application/services/order.service.ts:2319` — null ownership menyebabkan handler return
- `services/order-service/src/modules/order.module.ts:88` — Provider adapter nyata didaftarkan
- `scripts/scheduler/crontab:37` — Outbox dipicu setiap 10 menit


### AUT-001 — Validasi penerima laporan dan putuskan akses per dataset

Asal `AAS-04` · AUT · dampak 4/5 · effort M · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** Recipients hanya string/array; kelas controller memakai hqBackOffice sementara dataset termasuk KASBON_BALANCE/ORDERS_DETAIL. Domain allowlist dan pemisahan capability belum merupakan keputusan tertulis dalam source yang dibaca.

**Kontrol yang ada:** JWT/capability HQ, internal-key pada sweep, audit mutasi dan lease runner tersedia.

**Usulan:** Terapkan validasi email dan batas array yang disetujui; Produk/Security menetapkan capability tiap dataset dan kebijakan domain eksternal sebelum pembatasan rollout.

**Acceptance:** Email malformed ditolak; role tanpa izin dataset ditolak menurut matriks yang disahkan; tujuan sah tetap menerima laporan.

**Verifikasi:** DTO + policy/controller specs, sandbox mail; tidak mengirim email dalam audit.

**Owner dan dependensi:** Security, Produk dan Backend Admin; Keputusan Security/Produk per dataset dan daftar tujuan bisnis; jangan menutup domain eksternal secara sewenang-wenang.

**Bukti:**
- `services/admin-service/src/modules/dto/scheduled-report.dto.ts:31` — Recipients hanya string, bukan IsEmail.
- `services/admin-service/src/modules/scheduled-reports.controller.ts:33` — Kelas memakai hqBackOffice.
- `services/admin-service/src/domain/report-dataset.ts:19` — Dataset termasuk saldo kasbon.


### AUT-010 — Ikat key foto PoD ke objek yang sah sebelum sign/delete

Asal `DLV-08` · AUT · dampak 4/5 · effort M · keputusan `keep` · confidence Sedang.

**Masalah dan batas:** storageKeyFromUrl menerima substring mulai pod/ tanpa verifikasi origin/ownership. Key kemudian ditandatangani dan dihapus. Dampak lintas objek adalah inferensi yang memerlukan model permission bucket dan pengetahuan key; tidak ada klaim eksploitasi produksi.

**Kontrol yang ada:** Bucket private dan signed link TTL; upload memeriksa berkas; endpoint proof dibatasi aktor.

**Usulan:** Simpan key hasil upload yang tervalidasi dan terikat ke delivery/aktor; larang key lintas prefix/ownership saat sign/delete. Periksa kompatibilitas URL historis sebelum memperketat validasi.

**Acceptance:** Proof URL/key asing ditolak; sign/delete hanya menyentuh objek yang terikat; PoD historis sah tetap dapat dibaca atau masuk daftar migrasi.

**Verifikasi:** Unit URL/key boundary serta fake storage assert object key; review prefix bersama expense receipt.

**Owner dan dependensi:** Backend Delivery dan Security; Kontrak storage dan upload; bukti ownership historis.

**Bukti:**
- `services/delivery-service/src/application/services/delivery.service.ts:64` — Key berasal dari pencarian substring pod/.
- `services/delivery-service/src/application/services/delivery.service.ts:1117` — Key dipakai signedUrl.
- `services/delivery-service/src/application/services/delivery.service.ts:1139` — Key dipakai remove pada purge.


### AUT-015 — Dump database diunggah sebagai gzip tanpa enkripsi klien

Asal `IDO-04` · AUT · dampak 4/5 · effort L · keputusan `keep` · confidence Tinggi untuk bytes source; enkripsi provider tidak diketahui.

**Masalah dan batas:** Temuan baru spesifik proteksi material backup; bukan klaim backup/offsite/verification tidak tersedia. Tidak menyimpulkan SSE provider tidak aktif dan tidak menyimpulkan pelanggaran hukum.

**Kontrol yang ada:** Offsite read-back checksum; backup env asimetris; provider kedua dapat dikonfigurasi; restore/drill sudah ada.

**Usulan:** Pastikan jaminan provider terlebih dulu; jika threat model mencakup bocor credential bucket, enkripsi dump asimetris sebelum upload, batasi permission lokal, versikan format; sesuaikan restore-db, drill, deploy backup dan kedua provider sebelum rollout.

**Acceptance:** Restore dari format baru membutuhkan kunci di luar VPS; tanpa kunci gagal jelas; format lama tetap dapat dipulihkan selama retensi; offsite read-back, kedua provider dan drill dapat memverifikasi artefak baru tanpa mengekspos data.

**Verifikasi:** Drill terisolasi dengan dataset sintetis dan kunci latihan saat implementasi; tidak dijalankan dalam audit.

**Owner dan dependensi:** DevOps/security dan pemilik backup; Kunci privat/custody teruji, keputusan kebijakan enkripsi, perbarui runbook restore/drill dan inventory format. Effort L karena pipeline lintas skrip, format, compatibility serta latihan; bukan Quick Win.

**Bukti:**
- `scripts/backup-db.sh:47` — pg_dumpall dialirkan hanya melalui gzip
- `scripts/upload-to-s3.mjs:44` — PutObject meneruskan file
- `scripts/upload-to-s3.mjs:47` — Body readFileSync; tidak ada transform enkripsi
- `scripts/backup-env.sh:106` — Enkripsi SMIME AES256 sudah tersedia khusus env
- `scripts/backup-second-provider.sh:48` — Provider kedua memakai ulang backup-offsite dump


### AUT-022 — Simpan pelaku, waktu dan referensi hasil pencairan manual

Asal `PPA-02` · AUT · dampak 4/5 · effort M · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** Controller membawa user.sub ke service, tetapi repository settle hanya menulis status; model withdrawal tidak menyimpan settledBy/transferRef. Aksi bank tetap manual. Ketiadaan audit payout end-to-end belum diklaim mutlak.

**Kontrol yang ada:** CAS PROCESSING dan reversal saldo dalam transaksi; idempotency withdrawal dan maker-checker request tersedia.

**Usulan:** Catat settledBy/At, reason dan bank reference untuk hasil transfer; audit append-only. Bedakan maker-checker request dari bukti settlement bank; kebijakan orang kedua opsional menunggu Finance.

**Acceptance:** PAID baru memiliki aktor/waktu/ref; FAILED memiliki alasan dan reversal tepat sekali; data lama ditandai unknown tanpa fabricated actor.

**Verifikasi:** Migration compatibility, unit/DB race settle dan audit failure; tidak mengirim transfer.

**Owner dan dependensi:** Backend Payout dan Finance; Finance menentukan bukti referensi yang diterima dan retensinya.

**Bukti:**
- `services/payout-service/src/modules/hq-payout.controller.ts:203` — Aktor tersedia di controller.
- `services/payout-service/src/infrastructure/prisma/withdrawal.prisma.repository.ts:147` — Settle hanya menulis status.
- `services/payout-service/prisma/schema.prisma:269` — Model courier withdrawal tanpa settlement evidence.
- `services/payout-service/prisma/schema.prisma:290` — Model owner withdrawal tanpa settlement evidence.


### FLW-003 — Kunci gerakan GALON menyamakan issue dan return satu order

Asal `DEP-01` · FLW · dampak 4/5 · effort L · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** [INFERRED] Kedua arah membawa orderId yang sama pada item GALON yang sama; setelah movement pertama, moveRawLine mengembalikan shortfall 0 tanpa gerakan kedua.

**Kontrol yang ada:** Ledger issue/return dan idempotensi per order sudah ada; refund dibatasi outstanding deposit.

**Usulan:** Pisahkan identitas kejadian issue vs return pada movement dan desain migrasi/backfill terukur; pertahankan replay masing-masing arah.

**Acceptance:** Issue 2 dan return GOOD 2 pada order sama menghasilkan dua movement dengan net 0, di kedua urutan; replay setiap arah tidak menggandakan movement.

**Verifikasi:** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner dan dependensi:** Backend depot + operasi stok; Schema key movement, pra-cek histori dan saldo; effort L karena data lama dan migrasi identitas event

**Bukti:**
- `services/depot-service/src/application/services/gallon-issue.service.ts:231` — Issue meneruskan orderId
- `services/depot-service/src/application/services/gallon-return.service.ts:108` — Return meneruskan orderId pada moveRawLine
- `services/depot-service/src/application/services/gallon-return.service.ts:414` — Courier return meneruskan input.orderId
- `services/depot-service/src/application/services/inventory.service.ts:875` — Movement yang sudah ada membuat no-op
- `services/depot-service/prisma/schema.prisma:303` — Unique itemId,orderId


### FLW-004 — Penerimaan PO belum atomik terhadap retry/crash/paralel

Asal `DEP-02` · FLW · dampak 4/5 · effort M · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** [INFERRED] PO dibaca SENT, seluruh receiveStock dilakukan, lalu lines/status ditulis satu kali; repository update hanya where id. Dua penerimaan atau retry setelah crash dapat menggandakan stok.

**Kontrol yang ada:** Kuantitas outstanding dibatasi; kegagalan booking baris tetap outstanding dan unbooked dilaporkan.

**Usulan:** Unit transaksi receipt lokal atau receipt line beridentitas idempoten; CAS saja sebelum posting perlu jalur crash recovery. Pertahankan partial receipt.

**Acceptance:** Dua receive paralel tidak menaikkan stok dua kali; crash setelah line pertama lalu retry tidak menggandakan line itu; baris gagal tetap outstanding.

**Verifikasi:** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner dan dependensi:** Backend depot + procurement; Repository PO + inventory dalam database depot; effort M karena unit transaksi domain tunggal

**Bukti:**
- `services/depot-service/src/application/services/purchase-order.service.ts:159` — Pre-check SENT
- `services/depot-service/src/application/services/purchase-order.service.ts:227` — Loop posting receiveStock
- `services/depot-service/src/application/services/purchase-order.service.ts:270` — Satu update PO setelah loop
- `services/depot-service/src/infrastructure/prisma/purchase-order.prisma.repository.ts:75` — Update berdasarkan id tanpa expected version


### FLW-007 — Tutup celah jendela pertanggungjawaban COD pada shift basi

Asal `DLV-05` · FLW · dampak 4/5 · effort L · keputusan `keep` · confidence Sedang.

**Masalah dan batas:** Auto-close memakai expectedEndAt sementara assignableShift tidak memeriksa waktu; settlement memilih deliveredAt dalam jendela shift. Delivery selesai setelah expectedEndAt sebelum check-in baru dapat berada di luar dua jendela (inferensi).

**Kontrol yang ada:** Failed dan rescheduled cash sudah termasuk codBearingInWindow; setoran fail-closed; daftar unsettled tersedia.

**Usulan:** Hubungkan pertanggungjawaban delivery ke shift atau buat recovery eksplisit bagi interval yang tidak tercakup; jangan mengubah attendance checkout untuk menyamarkan waktu kerja.

**Acceptance:** Delivery selesai di celah expectedEndAt/check-in baru tetap dapat disetor dan tidak dihitung dua kali pada shift mana pun.

**Verifikasi:** Spec jendela shift stale dan end-to-end settlement dengan ledger kas fake; race nyata sebelum rollout.

**Owner dan dependensi:** Backend Delivery dan Finance Ops; Aturan Ops/Finance untuk shift penanggung jawab dan join payment tunai.

**Bukti:**
- `services/delivery-service/src/application/services/shift.service.ts:232` — Shift stale berakhir pada expectedEndAt.
- `services/delivery-service/src/application/services/shift.service.ts:200` — Assignable hanya mengecek adanya shift dan status.
- `services/delivery-service/src/infrastructure/prisma/delivery.prisma.repository.ts:444` — Kas dipilih dengan timestamp dalam jendela.


### FLW-008 — Pulihkan efek samping setelah proof of delivery tersimpan

Asal `DLV-07` · FLW · dampak 4/5 · effort L · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** complete DELIVERED replay langsung return; advance order error hanya log; push earning dan webhook dijalankan void. Adapter payout menjawab false saat error, yang tidak direkonsiliasi pada jalur ini.

**Kontrol yang ada:** PoD disimpan dahulu dengan CAS; earning mempunyai sourceRef per delivery; HTTP timeout dan log tersedia. Pemulihan manual mungkin dilakukan, bukan dibuktikan otomatis.

**Usulan:** Persist intent handoff/earning/event bersama PoD atau antrean recovery durable. Reuse sourceRef penerima; identitas webhook perlu dedup tersendiri sebelum retry. Bedakan configuration disabled dari transient failure.

**Acceptance:** Dependency gagal setelah PoD, pulih lalu handoff order dan earning tercatat sekali; retry tidak menggandakan insentif; poison item terlihat dan bisa direplay; crash setelah commit tidak kehilangan intent.

**Verifikasi:** Fault injection tiap boundary dan real-Postgres concurrency pada journal; staging tanpa transaksi nyata.

**Owner dan dependensi:** Backend Delivery, Order, Payout dan SRE; Order transition replay; payout idempotency termasuk insentif; admin webhook eventId. Gabungkan AAS-11 untuk sisi publisher, bukan membuat outbox kedua.

**Bukti:**
- `services/delivery-service/src/application/services/delivery.service.ts:436` — Replay DELIVERED tidak melanjutkan side effect.
- `services/delivery-service/src/application/services/delivery.service.ts:493` — Handoff failure hanya log dan break.
- `services/delivery-service/src/application/services/delivery.service.ts:505` — Earning/event asynchronous void.
- `services/delivery-service/src/infrastructure/http/courier-payout.http.adapter.ts:102` — Error push menghasilkan false.
- `services/payout-service/src/application/services/courier-payout.service.ts:82` — Earning sourceRef deterministic sudah tersedia.


### FLW-011 — Penjualan konter dan pencatatan pembayaran masih dua langkah

Asal `ORD-06` · FLW · dampak 4/5 · effort L · keputusan `reclassify` · confidence Tinggi.

**Masalah dan batas:** [INFERRED] Penjualan pickup dibuat COMPLETED dan completion outbox ditulis sebelum browser mencatat pembayaran. Klaim lama tidak ada tampilan rekonsiliasi salah: payment-recon sudah menampilkan order tanpa payment dan jalur remediasi.

**Kontrol yang ada:** Idempotency-Key penjualan; pembayaran aktif tidak digandakan; UI retry pembayaran; layar rekonsiliasi manual tersedia.

**Usulan:** Putuskan apakah completed berarti barang diserahkan atau pembayaran diterima; tambahkan recovery durable/exception aging pada alur existing jika diperlukan, bukan layar recon baru.

**Acceptance:** Tutup browser setelah order create sebelum payment; operator tetap menemukan dan menyelesaikan kewajiban tersebut sekali. Outbox earning/revenue mengikuti definisi bisnis final.

**Verifikasi:** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner dan dependensi:** PO + operasi kasir + backend order/payment; Definisi bisnis completed/counter + kontrak order/payment + frontend

**Bukti:**
- `services/order-service/src/application/services/order.service.ts:1247` — Pickup konter lahir COMPLETED
- `services/order-service/src/application/services/order.service.ts:1261` — Completion outbox ditulis saat create
- `apps/web/src/app/dashboard/payment-recon/page.tsx:55` — Join order dan payment
- `apps/web/src/app/dashboard/payment-recon/page.tsx:123` — Null payment ditampilkan sebagai noPayment
- `services/payment-service/src/modules/payment.controller.ts:332` — Endpoint for-orders
- `services/payment-service/src/application/services/payment.service.ts:516` — Batch payment dibatasi scope order


### FLW-019 — Pisahkan qualification referral dari penyelesaian reward durable

Asal `REF-01` · FLW · dampak 4/5 · effort L · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** Referral berubah QUALIFIED sebelum dua reward; safeReward dan adapter menelan error. Request reward tidak membawa idempotencyKey; replay QUALIFIED return tanpa memulihkan hadiah. Masalah utamanya kehilangan/recovery, bukan klaim double-award pada replay biasa.

**Kontrol yang ada:** Transisi qualification CAS dan uniqueness referee; loyalty mendukung reward key; timeout HTTP.

**Usulan:** Persist dua reward intent dengan key referralId+sisi, dedup di loyalty, rekonsiliasi status dan ledger. Jangan backfill QUALIFIED lama tanpa memeriksa apakah hadiah pernah tercatat.

**Acceptance:** Reward sisi pertama berhasil, sisi kedua timeout: retry melengkapi sisi kedua tepat sekali; crash setelah qualification dapat dipulihkan; ledger membedakan pending/credited.

**Verifikasi:** Receiver-before-sender contract tests dan fault injection dua sisi, race Postgres untuk dedup.

**Owner dan dependensi:** Backend Referral dan Loyalty; Loyalty contract idempotency, migrasi reward status, dan ORD-01 producer recovery.

**Bukti:**
- `services/referral-service/src/application/services/referral.service.ts:217` — Qualification commit mendahului reward.
- `services/referral-service/src/application/services/referral.service.ts:211` — QUALIFIED replay return tanpa reward.
- `services/referral-service/src/infrastructure/http/loyalty-reward.http.adapter.ts:36` — Payload tanpa idempotencyKey.
- `services/referral-service/src/infrastructure/http/loyalty-reward.http.adapter.ts:42` — Error hanya log.


### AUT-002 — Pisahkan hasil pembuatan file dan hasil pengiriman laporan

Asal `AAS-05` · AUT · dampak 3/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** File DONE disimpan, mailer.send di-await tetapi hasilnya diabaikan, kemudian run mengembalikan ok:true. File tersimpan adalah kontrol yang sah; gap berada pada visibilitas pengiriman.

**Kontrol yang ada:** File tetap dapat diunduh dari hq/exports; error sumber menghasilkan FAILED; runner punya lease.

**Usulan:** Catat produced/deliverySent/deliverySkipped/deliveryFailed terpisah; jangan menyebut file gagal ketika hanya email yang gagal.

**Acceptance:** Mailer false menghasilkan indikator kirim gagal/dilewati, file tetap tersedia, retry kirim tidak membuat dua file atau dua email setelah sukses.

**Verifikasi:** Unit runner dengan mailer true/false dan konfigurasi SMTP kosong; manual lihat status UI.

**Owner dan dependensi:** Backend Admin dan Operasional HQ; Kontrak mailer boolean tersedia; UI ekspor perlu label terpisah.

**Bukti:**
- `services/admin-service/src/application/services/scheduled-report-runner.service.ts:111` — File disimpan DONE.
- `services/admin-service/src/application/services/scheduled-report-runner.service.ts:123` — Hasil mailer tidak dipakai.
- `services/admin-service/src/application/services/scheduled-report-runner.service.ts:125` — Hasil run tetap ok true.


### AUT-009 — Retur kurir belum mengikat order/customer ke delivery yang berwenang

Asal `DEP-06` · AUT · dampak 3/5 · effort M · keputusan `reclassify` · confidence Tinggi.

**Masalah dan batas:** [INFERRED] Body depotId/orderId/customerId diteruskan ke recordFromCourier; method yang dibaca mengukur saldo pelanggan itu dan mencatat return tanpa lookup order/delivery. Guard depot tetap ada, jadi klaim kurir bebas lintas depot tidak didukung.

**Kontrol yang ada:** STAFF_DEPOT terkunci depot; refund min(rate*qty,depositLeft); unknown customer refund 0; serialized balance; idempoten per order.

**Usulan:** Validasi bahwa order/customer/depot/courier cocok dengan delivery miliknya melalui kontrak service-auth; jangan gandakan depot guard.

**Acceptance:** Kurir tidak dapat mengatasnamakan customer/order lain dalam depotnya; retry handover sah tetap idempoten; depot lain ditolak existing guard.

**Verifikasi:** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner dan dependensi:** Backend depot/delivery + operasi kurir; Kontrak delivery/order lookup + aturan handover non-order

**Bukti:**
- `services/depot-service/src/modules/driver-gallon-return.controller.ts:30` — Identifier body diteruskan
- `services/depot-service/src/application/services/gallon-return.service.ts:342` — Hanya requireDepot pada awal recordFromCourier
- `services/depot-service/src/application/services/gallon-return.service.ts:375` — Outstanding dihitung terhadap customerId body
- `services/depot-service/src/application/services/gallon-return.service.ts:384` — createFromOrder memakai identifier body
- `packages/access/src/index.ts:324` — courierReturn STAFF_DEPOT
- `packages/platform/src/nest/depot-scope.ts:15` — STAFF_DEPOT locked
- `packages/platform/src/nest/depot-scope.guard.ts:79` — depotId request harus di set caller


### AUT-011 — Rebuild forecast tidak membedakan feed gagal dari feed selesai

Asal `FCS-04` · AUT · dampak 3/5 · effort M · keputusan `reclassify` · confidence Tinggi.

**Masalah dan batas:** [INFERRED] Ingest real-time best-effort disengaja. Adapter feed mengembalikan empty/null pada 500/timeout; rebuild berhenti dan return ingested/pages seperti EOF normal. Dampak diturunkan 4 ke 3 karena read model BI, bukan efek stok/uang.

**Kontrol yang ada:** Ingest idempoten dan rebuild manual tersedia. Tidak perlu memblokir checkout atas outage forecast.

**Usulan:** Return status failed/incomplete beserta cursor durable dan lag read-model; baru jadwalkan backfill setelah failure contract benar. Jangan menjanjikan semua order pulih dengan rebuild fail-open saat ini.

**Acceptance:** Feed 500 di halaman kedua menandai incomplete dan menyimpan titik lanjut; retry memulihkan order sekali; EOF kosong yang sah tetap success.

**Verifikasi:** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner dan dependensi:** Backend forecast/order + pemilik BI; Order feed + read model; kebijakan freshness PO, bukan SLA 24 jam karangan

**Bukti:**
- `services/order-service/src/application/services/order.service.ts:2412` — Recommendation/forecast di luar outbox, best-effort
- `services/order-service/src/infrastructure/http/forecast-coordination.http.adapter.ts:52` — Ingest gagal hanya warn
- `services/forecast-service/src/infrastructure/http/order-feed.http.adapter.ts:49` — Non-2xx menjadi halaman kosong EOF
- `services/forecast-service/src/infrastructure/http/order-feed.http.adapter.ts:63` — Catch menjadi halaman kosong EOF
- `services/forecast-service/src/application/services/rebuild.service.ts:31` — Loop berhenti nextCursor null dan return hitungan
- `services/forecast-service/src/modules/forecast.controller.ts:206` — Rebuild tersedia untuk SUPER_ADMIN


### AUT-014 — Input dispatch disisipkan ke badan shell sebelum validasi

Asal `IDO-03` · AUT · dampak 3/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** Source menunjukkan injection boundary di runner pembentuk command dan remote script. Hak dispatch membatasi exposure; tidak ada bukti exploit atau akses anonim.

**Kontrol yang ada:** Dispatch berwenang; envs dipakai untuk secret lain; command mode pilihan tetap.

**Usulan:** Gunakan environment variabel dan quote setiap argumen, validasi sha/nama service/phone sebelum command; hindari command string dinamis. Periksa mobile version_name521 dengan pola sama.

**Acceptance:** Nilai mengandung quote, substitusi shell atau newline ditolak/sebagai literal, tidak menciptakan command tambahan di runner maupun SSH; mode sah tetap bekerja.

**Verifikasi:** Uji command assembly dengan shell fixture lokal tanpa SSH/secret dalam implementasi nanti.

**Owner dan dependensi:** DevOps/security; Owner CI/DevOps; regression fixture resolusi command.

**Bukti:**
- `.github/workflows/deploy.yml:235` — sha diinterpolasi ke perintah echo shell
- `.github/workflows/deploy.yml:282` — services diinterpolasi ke perintah echo shell
- `.github/workflows/deploy.yml:295` — demo_phone diinterpolasi ke shell pembentuk command
- `.github/workflows/deploy.yml:435` — Command output dijalankan di SSH
- `.github/workflows/deploy.yml:375` — Nilai lain sudah memakai envs


### AUT-017 — Pemantauan belum membuktikan kesehatan ujung-ke-ujung jalur alert

Asal `IDO-09` · AUT · dampak 3/5 · effort M · keputusan `keep` · confidence Tinggi dalam cakupan source.

**Masalah dan batas:** Spot-check deterministik primary: KEEP dengan batas. Source mendukung blind spot running-but-hung alert pipeline; jangan menyebut tidak ada monitoring sama sekali atau menyatakan alert produksi hilang. `vector(0)` alert bisnis bukan dead-man.

**Kontrol yang ada:** Restart policy, watchdog stopped/running-unhealthy untuk container ber-healthcheck, scrape/exporter alerts, Uptime GitHub independen, webhook aplikasi langsung.

**Usulan:** Tambahkan probe kesehatan dua container dan heartbeat end-to-end dengan penerima independen jika pemilik memilih cakupan itu. Heartbeat dari dalam VPS harus diperiksa dari luar agar tidak mati bersama sistem.

**Acceptance:** Pada latihan terisolasi, hang Alertmanager/Prometheus saat API/web sehat terdeteksi oleh jalur independen; respons pemulihan teramati; kehilangan webhook receiver juga terlihat. Ambang/cadence ditetapkan DevOps.

**Verifikasi:** Latihan gangguan terisolasi setelah implementasi, tidak pada produksi/audit.

**Owner dan dependensi:** DevOps/on-call; Penerima heartbeat di luar VPS dan keputusan operasional biaya; healthchecks saja belum membuktikan delivery webhook.

**Bukti:**
- `docker-compose.prod.yml:896` — Prometheus896–910 tanpa healthcheck
- `docker-compose.prod.yml:975` — Alertmanager975–999 tanpa healthcheck
- `ops/prometheus.yml:23` — Scrape aplikasi dan infra, bukan heartbeat pipeline
- `scripts/watchdog.sh:41` — Watchdog mengambil daftar container unhealthy
- `scripts/lib/deploy-common.sh:191` — Container tanpa healthcheck dinilai running saja
- `scripts/uptime-probe.sh:48` — External uptime memeriksa gateway/depot/web saja


### AUT-023 — Nudge pesan ulang berulang dan penghitung sukses mengabaikan boolean

Asal `RET-01` · AUT · dampak 3/5 · effort M · keputusan `reclassify` · confidence Tinggi.

**Masalah dan batas:** [INFERRED] Query mengambil pelanggan tertua berdasarkan semua orders; notify tanpa key dan .then(()=>true) membuang false dari adapter. Jadwal nyata harian ditemukan. Klasifikasi marketing reminder perlu PO; jangan langsung klaim pelanggaran consent.

**Kontrol yang ada:** Limit query dan scheduler tersedia; notification delivery fail-open; push-mute preference tersedia. Opt-out marketing bukan bagian jalur notify langsung yang dibaca.

**Usulan:** Pertama gunakan boolean hasil notify untuk counter; PO menentukan nudge cadence, eligible status dan marketing/transaksional; lalu key per customer/periode dan eligibility paging yang tidak menahan 500 tertua selamanya.

**Acceptance:** Adapter false menaikkan failed; dua sweep satu periode tidak menggandakan nudge; eligible batch setelah 500 pelanggan tetap tercapai; opt-out mengikuti klasifikasi PO.

**Verifikasi:** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner dan dependensi:** PO/marketing + backend order/CRM; Gabungkan ORD-03; keputusan cadence/status/consent PO

**Bukti:**
- `services/order-service/src/infrastructure/prisma/order.prisma.repository.ts:323` — Query latest-order cutoff tanpa status dan penanda sudah dinudge
- `services/order-service/src/application/services/order.service.ts:1619` — notify lalu then true
- `services/order-service/src/infrastructure/http/notification.http.adapter.ts:16` — ONCE_PER_ORDER tidak memuat REORDER_REMINDER
- `services/order-service/src/infrastructure/http/notification.http.adapter.ts:100` — Adapter error menghasilkan false
- `services/crm-service/src/application/services/notification.service.ts:244` — Dedupe opsional
- `services/crm-service/src/infrastructure/notification/inbox-broadcast.delivery.ts:37` — Marketing gate ada pada campaign path
- `scripts/scheduler/crontab:30` — Nudge dijadwalkan 08:00 timezone container


### BI-003 — Register keamanan perlu direkonsiliasi per bukti

Asal `IDO-05` · BI · dampak 3/5 · effort M · keputusan `reclassify` · confidence Sedang.

**Masalah dan batas:** Tidak membuktikan97 selesai hanya dari git log; ubah narasi menjadi register historis perlu source-level revalidation. Setiap owner mengisi delta source/test, bukan menutup otomatis.

**Kontrol yang ada:** Register mengandung keputusan dan daftar PR historis; audit lanjutan owner memeriksa source.

**Usulan:** Tambahkan source/PR/test/provenance untuk setiap status dan pertahankan keputusan accepted.

**Acceptance:** Setiap baris yang dipindah selesai punya source saat ini, test yang relevan dan status bukti; accepted tidak diubah menjadi bug; count dihitung programatik.

**Verifikasi:** Baca source dan review per baris, bandingkan tally.

**Owner dan dependensi:** QA/security; Owner service; jangan pakai runtime claims tanpa akses terpisah.

**Bukti:**
- `docs/SECURITY_AUDIT_REGISTER.md:13` — Dokumen masih melaporkan Selesai5
- `docs/SECURITY_AUDIT_REGISTER.md:22` — Dua kontrol sengaja diterima bukan terbuka
- `docs/SECURITY_AUDIT_REGISTER.md:46` — PRM1/PRM5 tercantum diterima pemilik


### FLW-001 — Retry penyesuaian stok delta dapat membuat movement kedua

Asal `APP-02` · FLW · dampak 3/5 · effort M · keputusan `keep` · confidence Sedang.

**Masalah dan batas:** Frontend mengirim delta tanpa attempt key. Controller meneruskan delta tanpa key, service selalu memanggil applyMovement, dan repository menambah quantity serta movement baru per request. Unique itemId/orderId hanya berlaku untuk SALE; ADJUSTMENT memakai orderId null. Dua request yang sama setelah jawaban hilang dapat menjadi dua koreksi; kejadian produksi belum diukur.

**Kontrol yang ada:** UI menahan tombol selama request berjalan; backend menolak stok negatif dan mencatat movement atomik. Kontrol ini tidak membedakan retry dari dua koreksi yang disengaja.

**Usulan:** Beri tiap upaya koreksi satu key yang stabil sampai hasilnya diketahui dan deduplikasi key di transaksi movement server. Buat key baru untuk koreksi berikutnya yang disengaja.

**Acceptance:** Retry dengan key sama mengubah stok sekali dan mengembalikan hasil yang konsisten; dua key berbeda masing-masing membuat movement; request lama tanpa key ditangani menurut kontrak kompatibilitas yang disepakati.

**Verifikasi:** Contract test controller, transaksi repository dan retry lost-response; belum dijalankan dalam audit baca-saja.

**Owner dan dependensi:** Frontend dan Backend Depot; Perubahan kontrak web, DTO/controller, dan penyimpanan key di depot-service; periksa klien mobile lama sebelum mewajibkan header.

**Bukti:**
- `apps/web/src/app/dashboard/inventory/page.tsx:171` — Web mengirim delta tanpa attempt key.
- `services/depot-service/src/modules/inventory.controller.ts:365` — Controller tidak menerima attempt key.
- `services/depot-service/src/application/services/inventory.service.ts:335` — Setiap panggilan adjust meneruskan movement baru.
- `services/depot-service/src/infrastructure/prisma/inventory.prisma.repository.ts:218` — applyMovement menaikkan quantity dan menambah ledger dalam transaksi.
- `services/depot-service/prisma/schema.prisma:303` — Unique itemId/orderId tidak menduplikasi adjustment dengan orderId null.


### FLW-006 — Teruskan customerId dan deliveryWindow pada dispatch staf

Asal `DLV-03` · FLW · dampak 3/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** Controller membuat AssignInput eksplisit dan tidak memasukkan dua field yang tersedia pada DTO/use-case. Hasil historis aktual perlu pemeriksaan data terpisah.

**Kontrol yang ada:** Dispatch dibatasi capability dan akses depot; DTO dan service sudah menyediakan field.

**Usulan:** Lengkapi pemetaan DTO-ke-input; jangan mengarang backfill customerId baris lama.

**Acceptance:** Controller meneruskan dua field persis; service menyimpan customer dan jendela antar dari dispatch; input lama tanpa field tetap sah.

**Verifikasi:** Spec pass-through controller dan use-case; tidak perlu menyentuh data produksi.

**Owner dan dependensi:** Backend Delivery; Validasi konsumen UI dan DTO; tidak ada migrasi baru.

**Bukti:**
- `services/delivery-service/src/modules/delivery.controller.ts:53` — AssignInput eksplisit melewatkan kedua field.


### FLW-013 — Audit HTTP best-effort masih berpotensi kehilangan entri

Asal `PLT-01` · FLW · dampak 3/5 · effort L · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** recordAuditEvent satu kali fetch ber-deadline, catch hanya logger.error. Fail-open ini keputusan teknis eksplisit yang harus dipertahankan untuk tidak membatalkan uang yang sudah settled; peningkatan durability adalah strategi baru, bukan kontrol yang diklaim belum pernah ada.

**Kontrol yang ada:** Audit sink, deadline lima detik, error logging dan static audit coverage sudah ada.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. PO/security menentukan tingkat evidensial yang dibutuhkan; desain outbox lokal dan ingest dedup lintas service.

**Acceptance:** Keputusan finansial yang disepakati menulis audit lokal atomik; auth-service padam tidak membatalkan transaksi, dan setelah pulih audit dikirim sekali dengan key idempoten.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Backend/platform lead; PO/security menentukan tingkat evidensial yang dibutuhkan; desain outbox lokal dan ingest dedup lintas service.

**Bukti:**
- `packages/platform/src/nest/audit-trail.ts:15` — sumber menyatakan fail-open sebagai batas desain
- `packages/platform/src/nest/audit-trail.ts:50` — fetch satu kali; kegagalan dicatat error
- `packages/platform/src/nest/audit-mutations.interceptor.ts:145` — interceptor memakai sink secara fire-and-forget


### FLW-021 — Retensi offline menghapus seluruh jenis job termasuk pencatatan uang

Asal `WEB-03` · FLW · dampak 3/5 · effort M · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** flush memeriksa expired sebelum error dan menghapus semua kind setelah tujuh hari. Kebijakan melindungi payload foto, tetapi codConfirm dan gallonReturn juga hilang. Peristiwa lewat tujuh hari perlu rekonsiliasi, bukan replay tanpa batas.

**Kontrol yang ada:** Owner isolation, Web Lock, retry/backoff, MAX_ATTEMPTS dan tampilan error sudah ada.

**Usulan:** Arsipkan job uang yang kedaluwarsa menjadi needs-review yang terlihat, dengan metadata aman dan instruksi rekonsiliasi; jangan replay otomatis transaksi tua tanpa cek status server.

**Acceptance:** Job COD/galon kedaluwarsa menghasilkan status rekonsiliasi minimum yang terlihat dan tidak otomatis mengubah saldo; payload foto tetap terhapus sesuai retensi yang disepakati.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Frontend + finance ops; PO/finance menentukan umur rekonsiliasi dan minimisasi metadata; jangan meniadakan retensi biometrik.

**Bukti:**
- `apps/web/src/lib/offline-queue.ts:188` — batas retensi global tujuh hari
- `apps/web/src/lib/offline-queue.ts:475` — semua job milik pengguna dibuang bila kedaluwarsa
- `apps/web/src/lib/offline-queue.ts:312` — job COD mengandung paymentId, cashReceived dan capturedAt
- `apps/web/src/components/offline-queue-banner.tsx:50` — pembuangan manual punya konfirmasi, sedangkan expired otomatis tidak


### FTR-002 — Lengkapi jejak persetujuan untuk akun yang dibuat lewat login

Asal `AUT-02` · FTR · dampak 3/5 · effort M · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** Login nomor baru membuat CUSTOMER PENDING, lalu verify dapat mengaktifkan akun; recordRegistrationConsent hanya pada register akun baru. Bukan kesimpulan kepatuhan atau dasar hukum.

**Kontrol yang ada:** ConsentService dan pending consent API tersedia; register baru mencatat consent; OTP dan audit auth tersedia.

**Usulan:** Pilih satu titik UX persetujuan yang dapat diaudit bagi semua jalur aktivasi. Jangan mengisi backdated consent untuk akun lama tanpa tindakan pengguna.

**Acceptance:** Aktivasi lewat login nomor baru menghasilkan event penerimaan yang eksplisit atau alur pending consent yang disetujui; marketing tidak di-opt-in otomatis.

**Verifikasi:** Spec login->verify->consent dan review Legal/Produk; audit ini tidak menjalankan flow.

**Owner dan dependensi:** Produk, Legal dan Backend Auth; Pilihan Legal/Produk tentang waktu persetujuan dan dokumen versinya.

**Bukti:**
- `services/auth-service/src/application/services/login.service.ts:52` — Akun baru dibuat lewat login.
- `services/auth-service/src/application/services/otp-verification.service.ts:67` — Verify REGISTRATION mengaktifkan dan menerbitkan sesi.
- `services/auth-service/src/application/services/registration.service.ts:90` — Consent hanya ketika akun belum existing.


### FTR-003 — Pisahkan mutasi alamat biasa dari penggantian alamat utama

Asal `CUS-01` · FTR · dampak 3/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** UpdateAddressDto mewarisi isPrimary dari create; service/repository meneruskan patch. Tipe TS tidak menghapus field runtime. Efek 500/primary kosong adalah inferensi constraint/selector, bukan hasil eksekusi.

**Kontrol yang ada:** Update memagari customerId; setPrimaryExclusive tersedia untuk jalur khusus; create/delete memakai lock.

**Usulan:** Hilangkan isPrimary dari DTO patch atau tolak eksplisit; selalu gunakan jalur set-primary yang sudah atomik.

**Acceptance:** PATCH isPrimary ditolak 400 tanpa mengubah alamat; set-primary resmi bekerja dan tetap satu primary saat paralel.

**Verifikasi:** DTO/controller contract spec dan regresi address race.

**Owner dan dependensi:** Backend Customer; Tidak ada schema baru; periksa klien lama yang mengirim isPrimary lewat PATCH.

**Bukti:**
- `services/customer-service/src/modules/dto/address.dto.ts:87` — PartialType mewarisi isPrimary.
- `services/customer-service/src/modules/address.controller.ts:89` — DTO diteruskan tanpa projection.
- `services/customer-service/src/infrastructure/prisma/address.prisma.repository.ts:135` — Patch disimpan langsung.


### FLW-009 — Installer belum menyiapkan log backup provider kedua

Asal `IDO-01` · FLW · dampak 3/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** Kegagalan bersyarat: bila file log belum ada dan user tidak dapat menulis /var/log, shell gagal sebelum skrip. Bukan bukti backup produksi gagal.

**Kontrol yang ada:** Freshness checker dan mode inert bila provider kedua belum dikonfigurasi.

**Usulan:** Tambahkan file log provider kedua ke installer dan pemeriksaan idempotensi installer.

**Acceptance:** Pada filesystem fixture non-root dengan /var/log tidak writable, installer menyiapkan log backup2; dua instalasi tidak menggandakan cron.

**Verifikasi:** Uji installer dengan permission realistis secara terpisah dari audit; cek --show tanpa menjalankan backup.

**Owner dan dependensi:** DevOps; Owner DevOps; test installer, tidak perlu migrasi aplikasi.

**Bukti:**
- `scripts/install-host-cron.sh:92` — Cron redirect menuju hydromart-backup2.log
- `scripts/install-host-cron.sh:163` — Loop persiapan lima log tidak mencakup backup2
- `scripts/backup-second-provider.sh:30` — Provider kedua inert bila destination kosong


### AUT-004 — Allowlist auth test terlalu luas pada products namespace

Asal `APP-01` · AUT · dampak 2/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** PUBLIC_PREFIXES mencakup seluruh products, termasuk mutation/admin paths. Koreksi narasi lama: api.ts saat ini melampirkan bearer bila token tersedia meskipun auth=false; flag menentukan wait/unlock dan refresh. Gap adalah regresi saat boot/session expiry, bukan pasti tanpa bearer setiap saat.

**Kontrol yang ada:** Seluruh call site aktif yang dipindai awal sudah menggunakan flag yang sesuai.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Jangan menyebut broken production mutation tanpa bukti call site.

**Acceptance:** Mutation products tanpa auth flag ditolak guard test; browse/get/batch/categories publik tetap diterima.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Frontend engineer; Jangan menyebut broken production mutation tanpa bukti call site.

**Bukti:**
- `apps/web/test/unauthenticated-calls.test.ts:44` — allowlist menerima semua members products
- `apps/web/src/lib/endpoints/shop.ts:41` — namespace juga memiliki mutation admin
- `apps/web/src/lib/api.ts:139` — authHeader mengirim bearer bila tersedia tanpa memeriksa options.auth


### AUT-016 — Perjelas permissions workflow dan pin Buildx SHA

Asal `IDO-08` · AUT · dampak 2/5 · effort S · keputusan `keep` · confidence Tinggi untuk deklarasi source.

**Masalah dan batas:** Hardening source; tidak ada bukti default token broad atau aksi supply-chain terjadi. Permissions org/repo belum dibaca.

**Kontrol yang ada:** Action lain dipin; permission default disebut read-only dalam dokumen lama, tidak diverifikasi live.

**Usulan:** Deklarasikan permissions minimum top-level/job yang membutuhkan write; pin dua action Buildx ke SHA kompatibel.

**Acceptance:** Semua job tetap mendapat hak minimum yang diperlukan dan seluruh third-party action mengikuti pinning policy; update dependency tetap memiliki jalur terkelola.

**Verifikasi:** Review YAML dan job requirements; CI nanti, audit tidak menjalankannya.

**Owner dan dependensi:** DevOps/security; Owner CI; ketahui job publish/comment yang perlu hak lebih.

**Bukti:**
- `.github/workflows/ci.yml:1108` — Setup Buildx memakai tagv3
- `.github/workflows/ci.yml:1240` — Pemanggilan kedua memakai tagv3


### AUT-018 — Raw URL pada alert memperlebar cardinality dan konteks sensitif

Asal `PLT-02` · AUT · dampak 2/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** AllExceptionsFilter meneruskan request.url; webhook dedup dan teks memakai path mentah, Sentry transaction name juga. Stack/message disamarkan tetapi path tidak. Pengiriman PII aktual belum dibuktikan; risiko kondisional pada URL yang mengandung input pribadi.

**Kontrol yang ada:** Redaksi stack, DSN/webhook opt-in, bounded map 500 dan dedupe 60 detik sudah ada.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Normalisasi route harus mempertahankan diagnosis tanpa mengekspor query.

**Acceptance:** Alert banyak id pada template sama dibatasi sesuai kebijakan; query/credential tidak tampil pada transaction name atau webhook.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Platform engineer; Normalisasi route harus mempertahankan diagnosis tanpa mengekspor query.

**Bukti:**
- `packages/platform/src/nest/all-exceptions.filter.ts:45` — filter memasukkan URL mentah
- `packages/platform/src/nest/error-alerter.ts:79` — dedup berbeda untuk setiap id/query
- `packages/platform/src/nest/error-alerter.ts:91` — label webhook memuat path tanpa redactAlertText
- `packages/platform/src/nest/sentry.ts:61` — Sentry transaction memakai path mentah
- `apps/web/src/lib/endpoints/identity.ts:32` — builder identitas menaruh phone dalam query; error 5xx pada jalur ini belum dibuktikan


### AUT-019 — Regex audit terlalu luas untuk field shipping dan params mentah

Asal `PLT-07` · AUT · dampak 2/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** SECRET_KEY memuat pin tanpa anchor, sehingga shippingFee cocok dan teredaksi. params dimasukkan tanpa redaksi. Kebocoran token aktual pada param belum dibuktikan; kehilangan field shipping adalah konsekuensi deterministik regex.

**Kontrol yang ada:** Shallow redaction, payload array/object minimization dan coverage interceptor sudah ada.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Nilai params mana yang boleh disimpan perlu data classification, jangan mencetak token uji nyata.

**Acceptance:** shippingFee terlihat sebagai data non-secret, pin/token/password tetap disamarkan, params sensitif juga disamarkan.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Platform engineer; Nilai params mana yang boleh disimpan perlu data classification, jangan mencetak token uji nyata.

**Bukti:**
- `packages/platform/src/nest/audit-mutations.interceptor.ts:28` — alternatif pin cocok sebagai substring
- `packages/platform/src/nest/audit-mutations.interceptor.ts:141` — params ditulis mentah ke metadata


### AUT-020 — Audit permission mobile memakai allowlist gabungan dua binary

Asal `PLT-08` · AUT · dampak 2/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** ALLOWED menerima Bluetooth/Wi-Fi dengan justifikasi Ops; CLI hanya mengenal path manifest, tidak binary. customer includePlugins sudah mengecualikan printer, sehingga ini guard regresi terhadap kebocoran dependency, bukan bukti permission customer aktif bocor.

**Kontrol yang ada:** Merged-manifest audit dan customer plugin allowlist sudah WIRED.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Manifest output aktual tidak dibangun atau diperiksa pada audit ini.

**Acceptance:** Manifest customer dengan permission Ops-only gagal, Ops tetap diterima dengan alasan; strip camera/fine customer tetap divalidasi.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Mobile/DevOps engineer; Manifest output aktual tidak dibangun atau diperiksa pada audit ini.

**Bukti:**
- `mobile/scripts/audit-manifest.mjs:36` — daftar izin gabungan dua binary
- `mobile/scripts/audit-manifest.mjs:176` — argument hanya path manifest
- `mobile/capacitor.config.ts:44` — customer plugin list sudah mengecualikan printer
- `.github/workflows/mobile.yml:605` — workflow customer menjalankan auditor manifest yang sama


### AUT-021 — Dependency mobile terpisah dari npm workspace vulnerability gate

Asal `PLT-09` · AUT · dampak 2/5 · effort M · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** mobile sengaja di luar root workspaces; workflow menginstal dependency mobile sendiri. Gate audit root menjalankan npm audit di cwd root, sehingga lock mobile tidak termasuk. Belum ditemukan step audit mobile dalam scope workflow yang dipindai (SEARCH-FE-04). Tidak menyatakan ada CVE aktual.

**Kontrol yang ada:** Exact plugin pins dan root npm audit/security workflows sudah ada.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Perlu reuse policy allowlist dan jadwal audit mobile; audit ini tidak mengakses registry.

**Acceptance:** Advisory high/critical yang tidak ditriase pada lock mobile menggagalkan gate dengan basis advisory yang tercatat, tanpa mengubah scope deploy VPS.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** DevOps/mobile engineer; Perlu reuse policy allowlist dan jadwal audit mobile; audit ini tidak mengakses registry.

**Bukti:**
- `mobile/README.md:19` — mobile memiliki lock/dependency sendiri
- `scripts/audit-gate.mjs:103` — gate audit menjalankan npm audit pada cwd pemanggil
- `.github/workflows/mobile.yml:130` — workflow memiliki instalasi dependency mobile


### BI-004 — Dokumen status PPN perlu diselaraskan dengan fitur tarif0

Asal `IDO-06` · BI · dampak 2/5 · effort S · keputusan `reclassify` · confidence Tinggi.

**Masalah dan batas:** Keberadaan field tidak membuktikan pengenaan PPN/konflik keputusan; default nonaktif sesuai keputusan lama. Konflik aktual adalah teks dokumen dan status keputusan terbaru.

**Kontrol yang ada:** Default0, tarif null bila amount0, total inclusive tidak ditambah, cache/timeout adapter.

**Usulan:** Rekonsiliasi dokumen dan minta konfirmasi pemilik/akuntan tentang kebijakan sebelum aktivasi; jangan ubah nominal transaksi.

**Acceptance:** Dokumen membedakan fitur tersedia dari aktif produksi; keputusan PKP/tarif punya pemilik/tanggal; tidak ada klaim salah pungut tanpa data.

**Verifikasi:** Review dokumentasi terhadap source dan keputusan, bukan kesimpulan kepatuhan.

**Owner dan dependensi:** Pemilik produk/akuntan; Pemilik dan akuntan untuk status legal/bisnis; bukan blok audit.

**Bukti:**
- `docs/LEGAL_OPEN_ITEMS.md:21` — Dokumen mengatakan tidak ada baris pajak di mana pun
- `docs/AUDIT_FR_MATRIX_2026-10.md:60` — FR034 menyebut pencatatan dan preview pajak
- `services/payment-service/src/application/services/tax-settings.service.ts:27` — Default ppnPercent0
- `services/order-service/src/application/services/order.service.ts:2051` — Tax amount hanya bila tarif>0; total tidak ditambah
- `docs/CONSOLE_AUDIT_REGISTER.md:350` — Keputusan lama mempertahankan form/layar aktif bila rate diisi sengaja


### BI-005 — Kumpulan komentar historis usang perlu adjudikasi per baris

Asal `IDO-07` · BI · dampak 2/5 · effort S · keputusan `reclassify` · confidence Sedang.

**Masalah dan batas:** Delapan subklaim awal tidak seluruhnya dibaca ulang; jangan memperlakukan bundle sebagai satu temuan prioritas tinggi. Konflik keputusan substansial dicatat konteks, sisanya editorial.

**Kontrol yang ada:** Tracker bertanggal dan source aktual tersedia.

**Usulan:** Perbarui komentar setelah owner memvalidasi state yang dimaksud; jangan menghapus sejarah keputusan.

**Acceptance:** Tiap koreksi menyebut perilaku source yang berlaku dan tanggal, tanpa mengklaim state produksi dari template.

**Verifikasi:** Diff docs terhadap source yang relevan.

**Owner dan dependensi:** Dokumentasi/DevOps; Owner dokumen terkait.

**Bukti:**
- `docs/EVALUATION_11_ITEMS_TRACKER.md:34` — E2/E3/E4 punya keputusan sesudah dokumen diskon
- `docs/AUDIT_FR_MATRIX_2026-10.md:144` — Royalti ditunda eksplisit


### BI-006 — readAllPages ceiling tidak ketat pada short final page

Asal `PLT-04` · BI · dampak 2/5 · effort S · keputusan `reclassify` · confidence Sedang.

**Masalah dan batas:** rows.length < pageSize mengembalikan sebelum ceiling. Namun pemanggil report yang diperiksa memakai max kelipatan pageSize; eksposur production overflow pada konfigurasi tersebut belum terbukti. Ini kontrak helper dan memori yang perlu diperbaiki, bukan laporan aktual salah.

**Kontrol yang ada:** Ceiling full page dan deterministic cursor sudah ada.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Tinjau seluruh konfigurasi caller; jangan mengklaim saat ini unbounded.

**Acceptance:** max=100/pageSize=500/400 rows memicu overflow; definisikan apakah tepat max diterima; semua caller dipastikan mengikuti kontrak.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Platform engineer; Tinjau seluruh konfigurasi caller; jangan mengklaim saat ini unbounded.

**Bukti:**
- `packages/platform/src/domain/read-all.ts:27` — short page mendahului pemeriksaan max
- `services/depot-service/src/infrastructure/prisma/operational-report.prisma.repository.ts:18` — pemanggil depot memakai max 20000 dan pageSize 500
- `packages/platform/src/domain/read-all.spec.ts:43` — test default pageSize tidak menguji result melebihi max pada short page


### BI-007 — Netralisasi CSV mengubah angka negatif menjadi teks

Asal `WEB-07` · BI · dampak 2/5 · effort S · keputusan `reclassify` · confidence Sedang.

**Masalah dan batas:** escapeCell mengonversi semua tipe ke string lalu menambah apostrof untuk minus. Kontrak helper terbukti, tetapi ekspor cashbook memakai kolom Masuk/Keluar positif sehingga dampak negatif aktif belum terbukti dalam call site yang diperiksa.

**Kontrol yang ada:** Anti formula-injection sudah ada dan harus dipertahankan.

**Usulan:** Bedakan nilai number dari teks sebelum netralisasi formula; pertahankan perlindungan teks berbahaya. Jangan mengubah semua ekspor menjadi numeric coercion.

**Acceptance:** Angka bertipe number tetap numerik di CSV, string berbahaya tetap dinetralisasi; tunjukkan call site dengan nilai negatif sebelum menaikkan prioritas.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Frontend engineer; Korelasikan AAS-07; satu akar helper berbeda, hindari hitungan ganda dampak BI.

**Bukti:**
- `apps/web/src/lib/csv.ts:123` — minus di awal termasuk number menerima apostrof
- `apps/web/src/app/dashboard/cashbook/page.tsx:217` — cashbook memisahkan uang masuk/keluar menjadi kolom terpisah


### FLW-014 — Kursor invalid diam-diam memakai nomor halaman

Asal `PLT-05` · FLW · dampak 2/5 · effort M · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** pageArgs mengabaikan cursor yang tidak dapat didecode. Ini kebijakan fallback terdokumentasi untuk menghindari Prisma P2025, tetapi mengaburkan error input dan bisa mengulang halaman dalam infinite-scroll.

**Kontrol yang ada:** Version/checksum dan WHERE tenant tetap mencegah query cursor mentah lintas scope.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Kontrak backward compatibility browser/APK; perlu keputusan API sebelum mengganti fallback.

**Acceptance:** Kontrak invalid cursor eksplisit; jika beralih 400 INVALID_CURSOR, klien mereset feed dengan pesan/retry yang sesuai dan cursor versi lama terdukung.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Platform + frontend engineer; Kontrak backward compatibility browser/APK; perlu keputusan API sebelum mengganti fallback.

**Bukti:**
- `packages/platform/src/domain/keyset.ts:79` — decode gagal memakai page-based skip
- `packages/platform/src/domain/keyset.ts:75` — fallback adalah keputusan teknis eksplisit, bukan crash tersembunyi


### FLW-023 — needsPayment hanya mengecualikan CANCELLED

Asal `WEB-08` · FLW · dampak 2/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** VOIDED/COMPLETED dengan payment REFUNDED/FAILED diperlakukan membutuhkan pembayaran baru oleh helper. Ini bug affordance UI bersyarat; tidak membuktikan charge server berhasil pada status terminal.

**Kontrol yang ada:** Satu active payment per order dipagari backend; gateway methods/depot methods difilter.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. PO menentukan apakah terminal unpaid historis boleh dibayar. Verifikasi domain payment sebelum mengubah helper.

**Acceptance:** Tabel status terminal dan status payment diuji; VOIDED/COMPLETED tidak menawarkan initiate payment kecuali aturan bisnis eksplisit membolehkannya.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Frontend engineer; PO menentukan apakah terminal unpaid historis boleh dibayar. Verifikasi domain payment sebelum mengubah helper.

**Bukti:**
- `apps/web/src/lib/payments.ts:83` — hanya CANCELLED yang ditolak berdasarkan status order
- `apps/web/src/app/orders/detail/page.tsx:671` — halaman detail memakai helper untuk panel payment


### FTR-008 — HTTP exception code generik untuk 409/422/503

Asal `PLT-03` · FTR · dampak 2/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** Pemetaan HttpException hanya memberi code khusus lima status; konflik dan unprocessable menerima HTTP_ERROR. Status HTTP tetap benar dan DomainError tetap punya machine code.

**Kontrol yang ada:** DomainError memberikan code stabil; frontend selalu membawa status juga.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Audit caller yang bergantung HTTP_ERROR sebelum kontrak diperluas.

**Acceptance:** ConflictException/Unprocessable/ServiceUnavailable punya code terdokumentasi, status tidak berubah, DomainError code tetap.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Platform engineer; Audit caller yang bergantung HTTP_ERROR sebelum kontrak diperluas.

**Bukti:**
- `packages/platform/src/nest/all-exceptions.filter.ts:83` — switch default menghasilkan HTTP_ERROR untuk 409/422/503
- `apps/web/src/lib/api.ts:49` — ApiError sudah membawa code server


### FTR-011 — Gate editor earning rule belum mengikuti capability server

Asal `WEB-02` · FTR · dampak 2/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** UI memakai dua nama role langsung, sedangkan controller memakai Can(earningRules). Kondisi default sama; divergensi terjadi saat capability diubah.

**Kontrol yang ada:** can() sudah membaca capabilities server untuk role sesi.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Konfirmasi keputusan desain 6b terhadap kebijakan override; jangan membuka gate hanya karena role staf.

**Acceptance:** Perubahan earningRules pada snapshot sesi juga mengubah gate dan navigasi editor; default tetap sama.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Frontend engineer; Konfirmasi keputusan desain 6b terhadap kebijakan override; jangan membuka gate hanya karena role staf.

**Bukti:**
- `apps/web/src/lib/roles.ts:153` — UI literal FINANCE/SUPER_ADMIN
- `services/payout-service/src/modules/earning-rule.controller.ts:34` — server membaca capability dinamis
- `packages/access/src/index.ts:502` — default capability sama dengan UI saat ini


### AUT-024 — Upload PoD diulang pada tiap retry complete

Asal `WEB-05` · AUT · dampak 1/5 · effort M · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** run(pod) meng-upload photo/signature sebelum complete pada setiap eksekusi. URL tidak disimpan pada QueuedJob. Jika complete gagal sesudah upload, percobaan berikut meng-upload lagi.

**Kontrol yang ada:** Retry terbatas enam kali, privasi retensi tujuh hari.

**Usulan:** Persist key/URL upload yang sukses pada job sehingga retry complete memakai objek yang sama; hapus orphan hanya dengan bukti kepemilikan.

**Acceptance:** Complete gagal setelah upload lalu diulang memakai objek yang sama bila masih valid; penghapusan payload dan objek yatim mengikuti retensi.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Frontend engineer; Kontrak URL/signing/storage ownership delivery-service.

**Bukti:**
- `apps/web/src/lib/offline-queue.ts:351` — upload dilakukan sebelum complete pada tiap run
- `apps/web/src/lib/offline-queue.ts:148` — job menyimpan payload data URL dan metadata retry tanpa hasil URL


### AUT-025 — Revalidasi profil memicu refresh data turunan

Asal `WEB-06` · AUT · dampak 1/5 · effort S · keputusan `reclassify` · confidence Sedang.

**Masalah dan batas:** Objek session baru memang ditulis pada fokus, tetapi manfaat performa belum diukur. Klaim familyId hilang dari indikator perangkat tidak tepat: familyId disimpan terpisah di session-device dan hanya dihapus saat signOut.

**Kontrol yang ada:** Batas revalidasi satu menit dan single-flight GET sudah ada.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Tidak ada runtime profiling dalam audit ini.

**Acceptance:** Ukur request tambahan dahulu; optimasi tidak boleh menunda pembaruan role/depot/capability.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Frontend engineer; Tidak ada runtime profiling dalam audit ini.

**Bukti:**
- `apps/web/src/lib/auth-context.tsx:90` — profil ditulis ulang sesudah revalidate
- `apps/web/src/lib/session-device.ts:18` — familyId indikator perangkat punya penyimpanan sendiri


### AUT-026 — File transfer belum memakai telemetry dan retry rate-limit JSON

Asal `WEB-10` · AUT · dampak 1/5 · effort M · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** uploadFile/getBlob/postBlob membangun authHeader sendiri, tanpa appHeaders dan pemrosesan x-hm-depot-changed yang ada pada rawRequest. Ini perbedaan observability/recovery, bukan hilangnya auth: ketiganya menunggu waitForSession dan menangani 401.

**Kontrol yang ada:** Timeout 60 detik, wait unlock, parse error dan refresh 401 sudah ada.

**Usulan:** Satukan header telemetry dan kebijakan rate-limit untuk upload/blob bila kontraknya aman; retry mutasi upload wajib mempertimbangkan dedup.

**Acceptance:** Transfer file membawa identitas build dan merespons depot-change sama dengan JSON; retry hanya bila aman untuk operasi/stream.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Frontend engineer; Jangan menerapkan replay upload otomatis tanpa kajian objek duplikat WEB-05.

**Bukti:**
- `apps/web/src/lib/api.ts:452` — multipart punya timeout dan refresh retry sendiri
- `apps/web/src/lib/api.ts:504` — file GET memakai authHeader tanpa appHeaders
- `apps/web/src/lib/api.ts:297` — JSON request mengolah depot change header


### FLW-015 — Callback geolocation native hanya satu slot pending

Asal `PLT-11` · FLW · dampak 1/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** Prompt geolokasi kedua menimpa pendingOrigin/pending sebelum answer. Ini skenario konkuren kondisional; tidak menyatakan kejadian perangkat aktual.

**Kontrol yang ada:** Daftar permission sesuai manifest dan coarse-only fallback sudah ada.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Verifikasi native/device terisolasi, tidak dijalankan.

**Acceptance:** Dua prompt beruntun menerima penyelesaian masing-masing; coarse-only customer tetap berfungsi pada Android lama.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Mobile engineer; Verifikasi native/device terisolasi, tidak dijalankan.

**Bukti:**
- `mobile/android/app/src/main/java/id/hydromart/app/MainActivity.java:97` — slot callback baru menimpa pending tanpa menolak callback lama
- `mobile/android/app/src/main/java/id/hydromart/app/MainActivity.java:102` — hasil permission menjawab hanya callback terakhir


### FLW-022 — Kegagalan delete IndexedDB disembunyikan dari UI

Asal `WEB-04` · FLW · dampak 1/5 · effort S · keputusan `reclassify` · confidence Sedang.

**Masalah dan batas:** discard menangkap kegagalan delete lalu menghapus cache. Replay setelah reload mungkin, tetapi tidak cukup untuk menyimpulkan uang terdebit ganda karena server memiliki dedup/status guards. Hardening UX, bukan temuan integritas uang tersendiri.

**Kontrol yang ada:** Backend replay-safe disebut dalam laporan awal; validasi per-domain diperlukan.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Gabungkan dengan WEB-03 bila menyusun perbaikan lifecycle queue.

**Acceptance:** Jika delete storage gagal, operator menerima status belum terhapus; replay-safe server tetap dipertahankan.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Frontend engineer; Gabungkan dengan WEB-03 bila menyusun perbaikan lifecycle queue.

**Bukti:**
- `apps/web/src/lib/offline-queue.ts:288` — delete failure ditelan dan cache tetap dihapus


### FTR-007 — Override depot adjustMaxPoints tidak dibaca pada adjustment

Asal `PLP-10` · FTR · dampak 1/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** [VERIFIED] adjust memanggil config.adjustMaxPoints(null); config menerima depotId dan mendukung override. HQ-only penulisan key tetap kontrol yang benar, jangan dicabut.

**Kontrol yang ada:** Global cap aktif, scope customer/depot dan aktor tersedia; depot manager tidak boleh menaikkan cap sendiri.

**Usulan:** Putuskan apakah cap memang global; jika per-depot, resolve depot yang sah untuk customer dan baca override; jika global, hapus janji konfigurasi depot.

**Acceptance:** Override yang diatur HQ terbaca sesuai scope yang diputuskan, sementara manager tetap tidak dapat menaikkan sendiri.

**Verifikasi:** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner dan dependensi:** PO loyalty + backend; Definisi depot penanggung jawab adjustment

**Bukti:**
- `services/loyalty-service/src/application/services/loyalty.service.ts:303` — Getter dipanggil null
- `services/loyalty-service/src/config/loyalty-config.service.ts:71` — Getter menerima depotId
- `services/loyalty-service/src/modules/settings.controller.ts:26` — adjustMaxPoints HQ-only termasuk depot override


### FTR-009 — FileProvider path luas bersifat hardening kondisional

Asal `PLT-10` · FTR · dampak 1/5 · effort M · keputusan `reclassify` · confidence Sedang.

**Masalah dan batas:** Template path titik saja tidak membuktikan eksfiltrasi karena provider exported=false dan akses URI memerlukan grant. Perlu caller sharing path untuk menentukan risiko nyata.

**Kontrol yang ada:** Provider tidak diekspor menurut audit awal.

**Usulan:** Persempit path FileProvider hanya setelah memetakan URI yang benar-benar dibagi; jangan merusak export/share yang sah.

**Acceptance:** File share hanya memberi URI subfolder yang dibutuhkan; external/cache path diuji dengan caller sah.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Mobile engineer; Belum ditelusuri semua caller native share/plugin.

**Bukti:**
- `mobile/android/app/src/main/res/xml/file_paths.xml:3` — external-path dan cache-path sama-sama path titik
- `mobile/android/app/src/main/AndroidManifest.xml:210` — FileProvider tidak diekspor, tetapi mengizinkan URI grant


### FTR-012 — Sebagian teks utilitas belum memakai resolver locale

Asal `WEB-11` · FTR · dampak 1/5 · effort S · keputusan `keep` · confidence Tinggi.

**Masalah dan batas:** STALE_DEPOT_MESSAGE dan fallback gagal kirim berupa literal Indonesia. Dampak lokalisasi terbatas; tidak menghambat fungsi.

**Kontrol yang ada:** Banner memakai keys locale dan error server tetap tersedia.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Gabungkan dengan maintenance locale, tidak mendahului integritas transaksi.

**Acceptance:** Locale alternatif menghasilkan pesan terjemahan tanpa mengubah code/status error.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Frontend engineer; Gabungkan dengan maintenance locale, tidak mendahului integritas transaksi.

**Bukti:**
- `apps/web/src/lib/offline-queue.ts:185` — teks literal depot berubah
- `apps/web/src/lib/offline-queue.ts:498` — fallback literal pada retry


### BI-001 — Definisikan jam SLA tiap percobaan pengantaran ulang

Asal `DLV-02` · BI · dampak 4/5 · effort M · keputusan `defer-policy` · confidence Tinggi.

**Masalah dan batas:** Reassign mereset pickup/start/ETA tetapi assignedAt dan slaAlertedAt tetap; earning menghitung selisih deliveredAt-assignedAt. Kode terbukti; definisi SLA order vs percobaan perlu PO.

**Kontrol yang ada:** Riwayat status dan cap kurir atomik tetap ada.

**Usulan:** PO memilih SLA order utuh atau per-attempt. Jika per-attempt, simpan attempt dan jamnya tanpa merusak jejak percobaan lama.

**Acceptance:** KPI dan bonus menggunakan jam yang disetujui; histori attempt pertama dapat diaudit.

**Verifikasi:** Unit reassign, SLA, earning dan review kebijakan ops.

**Owner dan dependensi:** Product Owner dan Operasional; Keputusan PO/operasional tentang denominator SLA dan bonus.

**Bukti:**
- `services/delivery-service/src/infrastructure/prisma/delivery.prisma.repository.ts:214` — Reassign tidak mengganti assignedAt/slaAlertedAt.
- `services/delivery-service/src/application/services/delivery.service.ts:543` — Earning memakai assignedAt.


### BI-002 — Definisi bruto pajak variabel perlu konfirmasi akuntan

Asal `HR-04` · BI · dampak 4/5 · effort M · keputusan `defer-policy` · confidence Tinggi.

**Masalah dan batas:** Source memverifikasi gross=BASE+ALLOWANCE, terpisah dari totalBonus; PPh Desember memakai YTD gross yang sama. Ini tidak membuktikan pelanggaran pajak, dan dasar BPJS tidak boleh otomatis disamakan dengan dasar PPh.

**Kontrol yang ada:** Tabel TER configurable dan rekonsiliasi Desember tersedia; brief akuntan sudah mendokumentasikan pertanyaan.

**Usulan:** Akuntan memutuskan komponen penghasilan/pemotongan per basis dan proses di luar aplikasi; setelah itu selaraskan input serta ekspor rekonsiliasi.

**Acceptance:** Kasus bonus/THR/Desember yang disetujui akuntan menjadi fixture; output aplikasi cocok dengan kasus tersebut dan menjelaskan komponen yang diproses di luar aplikasi.

**Verifikasi:** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner dan dependensi:** Akuntan + HR + backend HR; Jawaban akuntan; perbedaan basis PPh/BPJS; bukan audit hukum

**Bukti:**
- `services/hr-service/src/application/services/payroll.service.ts:523` — gross tidak memuat BONUS
- `services/hr-service/src/application/services/payroll.service.ts:531` — statutoryInput memakai gross
- `services/hr-service/src/application/services/payroll.service.ts:551` — Desember memakai decemberPph21
- `services/hr-service/src/infrastructure/prisma/payroll.prisma.repository.ts:179` — YTD menjumlah payroll.gross
- `services/hr-service/src/domain/statutory.ts:418` — AnnualGross YTD+Desember
- `docs/BRIEF_AKUNTAN.md:59` — Pertanyaan THR/bonus masuk bruto TER masih diajukan


### FLW-017 — Bedakan persetujuan refund manual dari uang benar-benar diserahkan

Asal `PPA-03` · FLW · dampak 4/5 · effort L · keputusan `defer-policy` · confidence Tinggi.

**Masalah dan batas:** executeRefund memindahkan REFUNDED; transfer gateway hanya untuk EWALLET/VA dengan reference. CASH/TRANSFER/QRIS tidak memanggil bank. Ini membuktikan pencatatan status, bukan bahwa pelanggan sudah menerima dana.

**Kontrol yang ada:** Claim CAS sebelum refund; approval ambang; audit refund; order refund coordination.

**Usulan:** Finance menetapkan SOP/kanal dan definisi REFUNDED. Tambah tahap approved-awaiting-disbursement atau evidence money-out, tanpa mengubah histori menjadi klaim settlement palsu.

**Acceptance:** Refund manual mencatat penerima/kanal/ref/aktor/waktu atau tetap pending money-out; retry tidak membayar dua kali.

**Verifikasi:** Review SOP, model status, fault injection; gateway tests hanya sandbox bila nanti diotorisasi.

**Owner dan dependensi:** Finance dan Product Owner; Keputusan Finance: siapa membayar dan bukti apa yang wajib; tanpa itu jangan mengotomasi uang keluar.

**Bukti:**
- `services/payment-service/src/application/services/payment.service.ts:1286` — Patch REFUNDED disiapkan sebelum bank effect.
- `services/payment-service/src/application/services/payment.service.ts:1308` — Gateway hanya dipanggil untuk metode online dengan reference.
- `services/payment-service/src/domain/payment.ts:75` — Online hanya EWALLET dan VA.


### FLW-018 — Tetapkan alokasi reversal franchise untuk refund setelah order selesai

Asal `PPA-05` · FLW · dampak 4/5 · effort L · keputusan `defer-policy` · confidence Sedang.

**Masalah dan batas:** recordRefund hanya menulis refundedAmount dan mengirim notifikasi; jalur ini tidak membalik franchise ledger. Refund terhadap penjualan selesai dan aturan pembebanan biaya perlu dikonfirmasi.

**Kontrol yang ada:** Void revenue outbox tersedia pada pembatalan konter; sourceRef ledger mencegah duplikasi.

**Usulan:** Finance menentukan pihak penanggung dan apakah clawback owner/komisi berlaku; kemudian intent reversal idempoten, bukan reuse pembatalan penuh untuk refund parsial.

**Acceptance:** Skenario refund yang disepakati menghasilkan ledger reversal proporsional sekali; withdrawal yang sudah dibayar tidak diubah diam-diam.

**Verifikasi:** Contoh pembukuan disetujui Finance dan contract/race tests; tidak mengoreksi data produksi otomatis.

**Owner dan dependensi:** Finance Franchise dan Backend Order/Payout; SOP refund dan model franchise direct-to-depot; keputusan Finance.

**Bukti:**
- `services/order-service/src/application/services/order.service.ts:3139` — recordRefund hanya repository dan notifikasi.
- `services/order-service/src/infrastructure/prisma/order.prisma.repository.ts:1124` — Repository hanya set refundedAmount.


### FTR-005 — Anonimisasi employee menyisakan field identitas lain

Asal `HR-23` · FTR · dampak 4/5 · effort L · keputusan `defer-policy` · confidence Tinggi.

**Masalah dan batas:** [VERIFIED] Patch anonimisasi hanya menimpa nama/telepon/email/photo/authSubjectId (jalur account juga role/status), sedangkan sumber schema memiliki pengenal lain. Penghapusan seluruh field finansial tidak boleh disarankan otomatis tanpa kebijakan retensi.

**Kontrol yang ada:** Biometrik/attendance/reviews dihapus, payload audit dibersihkan, payroll sengaja dipertahankan sesuai komentar aturan finansial.

**Usulan:** Tentukan matriks retensi per field/tujuan dan bedakan pseudonimisasi dari anonimisasi; batasi akses data yang wajib disimpan, hapus yang tidak lagi perlu setelah keputusan sah.

**Acceptance:** Fixture export/scrub menunjukkan kebijakan setiap field; legal/finance menyetujui pengecualian dan akses retained data; tidak ada klaim kepatuhan UU dari tes kode saja.

**Verifikasi:** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner dan dependensi:** Legal/finance + backend HR; Legal/finance retention field matrix + HR

**Bukti:**
- `services/hr-service/src/infrastructure/prisma/employee.prisma.repository.ts:56` — Patch retensi terbatas
- `services/hr-service/src/infrastructure/prisma/employee.prisma.repository.ts:94` — Patch hapus akun terbatas
- `services/hr-service/src/application/services/employee.service.ts:250` — Jalur hapus akun memanggil anonymise dan hapus photos


### AUT-003 — Tentukan retensi dataset lokal admin sebelum membuat purge

Asal `AAS-08` · AUT · dampak 3/5 · effort M · keputusan `defer-policy` · confidence Sedang.

**Masalah dan batas:** Registry executor yang dibaca berisi dataset remote, bukan export_logs/webhook/tickets/fraud. Pencarian absence harus dibatasi source/registry yang diaudit; belum membuktikan konfigurasi retensi produksi.

**Kontrol yang ada:** Engine retensi dan daftar UNENFORCED untuk policy yang terdaftar; erasure tiket per orang terpisah.

**Usulan:** Inventaris dan klasifikasi data lokal admin; putuskan window/hold lalu tambahkan executor. Jangan menghapus catatan sengketa/keuangan dengan cutoff arbitrer.

**Acceptance:** Setiap dataset punya kebijakan atau exemption bernama; dry-run menampilkan calon purge/hold dan audit trail; legal hold mencegah hapus.

**Verifikasi:** Review policy dan fake executor cutoff/hold; tidak menjalankan purge saat audit.

**Owner dan dependensi:** Data Governance dan Backend Admin; Legal/Finance/Security menetapkan klasifikasi/window; baseline data aktual belum diperiksa.

**Bukti:**
- `services/admin-service/src/infrastructure/http/purge-executor.registry.ts:21` — Daftar executor remote; tidak menunjukkan executor lokal dataset ini.


### AUT-008 — Penyesuaian stok mentah dan opname perlu kebijakan kontrol kuantitas

Asal `DEP-04` · AUT · dampak 3/5 · effort M · keputusan `defer-policy` · confidence Tinggi untuk alur kode; keputusan kebijakan terbuka.

**Masalah dan batas:** [VERIFIED] adjust dan opname menulis gerakan stok langsung. Opname mengirim approval hanya setelah penulisan dan hanya jika nilai selisih melewati ambang; nilai bahan mentah tanpa sellPrice menjadi 0. Apakah bahan mentah perlu ambang nilai atau approval pra-aksi adalah keputusan proses, sehingga rekomendasi tetap ditunda sampai kebijakan ditetapkan.

**Kontrol yang ada:** Ledger gerakan append-only, larangan stok negatif pada adjust, dan approval selisih opname di atas ambang untuk item bernilai.

**Usulan:** Pertahankan kandidat legacy dengan label belum diverifikasi ulang dan pertanyaan PO tentang approval sebelum/sesudah fakta.

**Acceptance:** Bukti source lengkap dan keputusan proses tersedia sebelum implementasi.

**Verifikasi:** Tinjau aturan raw material bersama Ops/Finance; uji ambang dan timing approval setelah kebijakan disahkan.

**Owner dan dependensi:** Backend; Operasi stok + finance

**Bukti:**
- `services/depot-service/src/application/services/inventory.service.ts:348` — Adjust langsung memanggil applyMovement untuk koreksi stok.
- `services/depot-service/src/application/services/inventory.service.ts:386` — Opname menulis selisih lalu memanggil emitVarianceApproval setelahnya.
- `services/depot-service/src/application/services/inventory.service.ts:473` — Nilai selisih memakai sellPrice ?? 0 sehingga item tanpa harga jual tidak mencapai ambang approval.


### FLW-012 — Kebijakan voucher online batal belum dipulihkan pada jalur cancel yang dibaca

Asal `PLP-01` · FLW · dampak 3/5 · effort M · keputusan `defer-policy` · confidence Tinggi.

**Masalah dan batas:** [INFERRED] Jalur cancel tidak memanggil release yang sudah tersedia; apakah voucher harus kembali adalah keputusan bisnis. Bukan Quick Win siap implementasi tanpa keputusan tersebut.

**Kontrol yang ada:** Release idempoten tersedia dan counter void/checkout failure memakainya.

**Usulan:** PO menentukan hangus/kembali dan alasan cancellation yang berlaku; bila kembali, gunakan delivery yang dapat dipulihkan, bukan fail-open yang dapat hilang permanen.

**Acceptance:** Tes customer/staff/sweep cancel sesuai kebijakan; retry tidak menurunkan usedCount dua kali; budget dan perCustomerLimit konsisten.

**Verifikasi:** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner dan dependensi:** PO + backend order/promo; PO kebijakan cancellation + order/promo; gabungan ORD-02

**Bukti:**
- `services/order-service/src/application/services/order.service.ts:2016` — Pembatalan mengantre reversal pembayaran
- `services/order-service/src/application/services/order.service.ts:3116` — Release stock tanpa release voucher
- `services/promo-service/src/application/services/voucher.service.ts:367` — release tersedia
- `services/promo-service/src/infrastructure/prisma/voucher.prisma.repository.ts:396` — Claim release releasedAt null atomik dan usedCount turun


### FLW-025 — Tidak adanya Idempotency-Key bukan bukti semua POST tidak idempoten

Asal `WEB-12` · FLW · dampak 3/5 · effort L · keputusan `defer-evidence` · confidence Sedang.

**Masalah dan batas:** Ditemukan empat header call site dan satu body idempotencyKey, tetapi status/CAS/unique constraints server dapat menyediakan semantik replay tanpa header. Timeout 15 detik menghasilkan hasil tidak pasti, bukan bukti duplikasi. Pecah hanya setelah service owner membuktikan satu operasi non-idempoten.

**Kontrol yang ada:** Web Lock offline, checkout/walk-in/withdraw attempt key, unique/status guards server.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Gabungkan APP-05; APP-02 delta stok diserahkan ke depot owner.

**Acceptance:** Setiap mutasi dinilai terhadap duplicate/lost-response pada state server; jangan menambah header yang tidak dikonsumsi.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Frontend engineer; Gabungkan APP-05; APP-02 delta stok diserahkan ke depot owner.

**Bukti:**
- `apps/web/src/lib/api.ts:29` — JSON deadline lima belas detik
- `apps/web/src/app/checkout/page.tsx:689` — checkout mempertahankan attempt key
- `apps/web/src/app/dashboard/payout/page.tsx:142` — payout mempertahankan attempt key


### FTR-004 — Lembur dihitung dari menit kehadiran tanpa approval lembur terpisah pada jalur yang dibaca

Asal `HR-01` · FTR · dampak 3/5 · effort M · keputusan `reclassify` · confidence Tinggi.

**Masalah dan batas:** [INFERRED] splitOvertime tidak menerapkan plafon; payroll menambahkan BONUS. Ini bukan auto-paid: slip masih melalui approve/pay dan guard pemisahan pembuat/penyetuju.

**Kontrol yang ada:** PENDING dikecualikan; istirahat dipotong; slip butuh approval; owner decision basis lembur gaji pokok tidak diubah.

**Usulan:** HR menentukan kebutuhan approval/exception atas jam tidak wajar dan plafon bila sah; tampilkan sumber menit agar approver menilai. Jangan menebak batas jam hukum.

**Acceptance:** HR menandatangani kebijakan; contoh shift panjang dan koreksi checkout mengikuti kebijakan tanpa memotong jam sah secara diam-diam.

**Verifikasi:** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner dan dependensi:** HR lead + backend HR; HR lead dan kebijakan jam/approval

**Bukti:**
- `services/hr-service/src/application/services/payroll.service.ts:1192` — Menghitung splitOvertime dari workedDays
- `services/hr-service/src/application/services/payroll.service.ts:1223` — Hasil berupa BONUS pada slip
- `services/hr-service/src/domain/overtime.ts:75` — Semua menit relevan dihitung tanpa plafon
- `services/hr-service/src/application/services/payroll.service.ts:749` — Payroll memiliki langkah approve
- `services/hr-service/src/application/services/payroll.service.ts:761` — Pembuat tidak approve kecuali SUPER_ADMIN
- `services/hr-service/src/infrastructure/prisma/attendance.prisma.repository.ts:176` — Hanya PRESENT/LATE masuk worked minutes


### FTR-006 — Scrub subscription menyisakan alamat dan koordinat

Asal `ORD-13` · FTR · dampak 3/5 · effort M · keputusan `defer-policy` · confidence Tinggi.

**Masalah dan batas:** [VERIFIED] erasePerson membatalkan ACTIVE/PAUSED dan mengosongkan recipientName/phone/notes, tidak menyentuh alamat. Kebutuhan menghapus alamat harus dipetakan pada retensi yang disepakati.

**Kontrol yang ada:** Subscription dihentikan sebelum scrub; transaksi mencegah pengiriman plan tanpa identitas.

**Usulan:** Masukkan snapshot alamat/koordinat pada matriks retensi per field dan dokumentasikan status pseudonimisasi/anonymisasi.

**Acceptance:** Alamat retained/deleted mengikuti keputusan PDP dan alur cancel tetap atomik.

**Verifikasi:** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner dan dependensi:** Legal/PO + backend order; Keputusan retensi PDP per field

**Bukti:**
- `services/order-service/src/infrastructure/prisma/subscription.prisma.repository.ts:197` — Cancel dan scrub dalam transaksi
- `services/order-service/src/infrastructure/prisma/subscription.prisma.repository.ts:207` — Patch hanya name/phone/notes


### AUT-005 — Input placeholder perlu telaah label persisten dan AT

Asal `APP-03` · AUT · dampak 2/5 · effort S · keputusan `defer-evidence` · confidence Sedang.

**Masalah dan batas:** Source tanpa aria-label/id-label tidak otomatis membuktikan accessible name kosong: placeholder bisa menjadi fallback accessible name. Reframe sebagai dugaan label tidak persisten; uji DOM/AT diperlukan sebelum klaim pelanggaran.

**Kontrol yang ada:** Banyak form sudah memakai Field/aria-label.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Tidak menjalankan browser/axe dalam audit statis ini.

**Acceptance:** Input punya label persisten atau aria yang sesuai konteks, diperiksa DOM/axe dan keyboard pada halaman terpilih.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Frontend engineer; Tidak menjalankan browser/axe dalam audit statis ini.

**Bukti:**
- `apps/web/src/components/ui.tsx:174` — Input adalah wrapper passthrough; nama aksesibel ditentukan pemanggil


### AUT-006 — Gate dashboard per halaman merupakan perlindungan regresi

Asal `APP-04` · AUT · dampak 2/5 · effort S · keputusan `defer-evidence` · confidence Tinggi.

**Masalah dan batas:** Dashboard layout menjamin auth tetapi tidak membatasi semua capability. Halaman insight mendelegasikan gate ke InsightDashboard. Tidak ada halaman bocor data yang dibuktikan; usulan penjaga regresi lebih tepat daripada menambah gate role kasar yang dapat memblokir custom role sah.

**Kontrol yang ada:** Backend RBAC tetap menolak akses yang tidak sah; gate halaman sudah banyak tersedia.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Metode static guard harus mengerti komponen yang mendelegasikan gate.

**Acceptance:** Halaman dashboard baru tanpa policy eksplisit gagal pemeriksaan; gate delegasi terdokumentasi dan custom role tetap mengikuti capability.

**Verifikasi:** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner dan dependensi:** Frontend engineer; Metode static guard harus mengerti komponen yang mendelegasikan gate.

**Bukti:**
- `apps/web/src/app/dashboard/layout.tsx:45` — layout membatasi autentikasi saja
- `apps/web/src/app/dashboard/insight/page.tsx:9` — insight mendelegasikan gate
- `apps/web/src/app/hq/layout.tsx:37` — HQ menerapkan capability gate terpusat per pathname


### AUT-013 — Baseline Load gagal dipush tetapi run tetap sukses

Asal `IDO-02` · AUT · dampak 2/5 · effort S · keputusan `reclassify` · confidence Tinggi untuk fallback warning, rendah untuk penyebabnya.

**Masalah dan batas:** DROP klaim tidak pernah mendarat/karena branch protection: tidak ada provenance runtime. KEEP pilihan warning yang memang sengaja dinyatakan source, sebagai tradeoff bukan bug pasti.

**Kontrol yang ada:** Retry3x; hasil job summary; gate beban sendiri tidak hilang.

**Usulan:** Jika pemilik membutuhkan histori committed, gunakan artifact/PR baseline dengan indikator freshness; jangan mengubah run sehat merah tanpa kebutuhan itu.

**Acceptance:** Satu run simulasi push ditolak tetap meninggalkan data teridentifikasi commit dan dapat dicari; kebijakan stale disepakati DevOps.

**Verifikasi:** Inspeksi artifact/run terpisah; audit ini tidak mengakses GitHub.

**Owner dan dependensi:** DevOps; Keputusan kebutuhan histori dan akses repo Actions saat implementasi.

**Bukti:**
- `.github/workflows/load.yml:255` — Rebase/push dicoba tiga kali
- `.github/workflows/load.yml:264` — Kegagalan akhir menjadi warning; hasil tetap ada di job summary


### FTR-001 — Perjelas semantik BETA/ROLLOUT pada flag publik

Asal `AAS-10` · FTR · dampak 2/5 · effort M · keputusan `defer-policy` · confidence Tinggi.

**Masalah dan batas:** publicFlags memetakan semua state kecuali OFF menjadi enabled; enum menjelaskan BETA/ROLLOUT. Belum diketahui apakah owner memerlukan audience gating, jadi tidak menyebut bug rollout produksi.

**Kontrol yang ada:** Hanya tiga enforced key yang dipublikasikan; mutasi platformAdmin.

**Usulan:** PO memilih boolean-only untuk key enforced atau kontrak audience yang eksplisit; jangan membangun eksperimen/AI tanpa demand.

**Acceptance:** State yang diperbolehkan dan arti enabled sama pada UI/backend serta diuji; jika boolean-only, BETA/ROLLOUT ditolak untuk enforced key.

**Verifikasi:** Unit flag per state dan penelusuran consumer; tidak menyalakan flag.

**Owner dan dependensi:** Produk dan Platform; Keputusan Produk atas lifecycle; konfigurasi produksi tidak dibaca.

**Bukti:**
- `services/admin-service/src/modules/feature-flags.controller.ts:43` — State selain OFF dipublikasikan enabled.
- `services/admin-service/src/domain/flag-state.ts:18` — Enum punya ROLLOUT/ACTIVE/BETA/OFF.


### FTR-010 — Recommendation service memakai ProductRef lokal tanpa status aktif/depot

Asal `REC-03` · FTR · dampak 2/5 · effort M · keputusan `reclassify` · confidence Sedang.

**Masalah dan batas:** Service sepenuhnya dibaca: enrich hanya membuang productRef yang hilang. Dampak end-to-end belum dapat dipastikan sebelum frontend consumer/hydration ditelusuri; bukan bukti produk tidak tersedia tampil pada pelanggan.

**Kontrol yang ada:** Limit ranking dan defensive missing-ref filter; catalog/checkout tetap dapat menolak produk unavailable di jalur lain, belum dibuktikan dalam scope ini.

**Usulan:** Periksa consumer web sebelum keputusan; jika consumer sudah memfilter katalog aktif, tutup klaim tampilan invalid dan nilai hanya kesegaran ProductRef.

**Acceptance:** Trace consumer menunjukkan apakah item inactive/unavailable dapat tampil; rekomendasi baru hanya bila fixture sumber membuktikan gap.

**Verifikasi:** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner dan dependensi:** Backend recommendation + frontend; Frontend consumer verification

**Bukti:**
- `services/recommendation-service/src/application/services/recommendation.service.ts:42` — Reorder tanpa selector depot
- `services/recommendation-service/src/application/services/recommendation.service.ts:77` — Enrich hanya memakai productRefs


### FLW-024 — Sinkronisasi sesi lintas tab belum diperiksa memadai

Asal `WEB-09` · FLW · dampak 1/5 · effort M · keputusan `defer-evidence` · confidence Sedang.

**Masalah dan batas:** [VERIFIED] session-store menyimpan profil dalam cache modul dan mengabari listener tab itu saat setSession. AuthProvider juga revalidasi saat focus/visibility dengan batas satu menit. Tidak ditemukan listener storage/BroadcastChannel untuk perubahan sesi lintas tab di kedua modul. Dampak nyata pada logout/ganti depot masih butuh skenario browser dan kontrak cookie, jadi tetap defer-evidence.

**Kontrol yang ada:** Token web ada di cookie httpOnly; polling profil/fokus sudah ada.

**Usulan:** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Perlu full search lintas session-store/depot-store/app lifecycle.

**Acceptance:** Tetapkan skenario logout/ganti depot antar tab dan kontrak sinkronisasi sebelum implementasi.

**Verifikasi:** Uji dua tab pada browser nyata untuk logout, perubahan peran, dan pemindahan depot sebelum memutuskan implementasi.

**Owner dan dependensi:** Frontend engineer; Kontrak cookie/logout gateway dan skenario dua tab.

**Bukti:**
- `apps/web/src/lib/session-store.ts:55` — setSession mengubah cache modul dan localStorage tab ini.
- `apps/web/src/lib/session-store.ts:66` — subscribe hanya mendaftarkan listener di Set modul.
- `apps/web/src/lib/auth-context.tsx:100` — Revalidasi dipicu focus, bukan event storage.
- `apps/web/src/lib/auth-context.tsx:80` — Revalidasi focus dibatasi satu menit.


## 7. Keterbatasan dan keputusan terbuka

Cakupan **file repositori** penuh, tetapi akses produksi, data aktual, perangkat Android fisik, dan semua perilaku integrasi lintas layanan tidak dapat dibuktikan dari source saja. Status gate yang gagal/terhalang tercatat apa adanya pada bagian 4. Untuk pajak, refund manual, royalti, SLA dan retensi, implementasi memerlukan keputusan owner sesuai [00-context.md](00-context.md); audit tidak menetapkan kebijakan hukum/keuangan. Daftar kandidat historis lengkap ada di [laporan audit sebelumnya](HYDROMART_DEVELOPMENT_OPPORTUNITIES.md), dengan label klaim lama, bukan tambahan 236 rekomendasi aktif.


## 8. Lampiran dan reproduksi

- [Ledger setiap file](01-full-coverage.csv) dan [hasil pemindaian penuh](full-file-scan.json)
- [Ringkasan scan](full-scan-summary.json), [AST](02-inventory.json), [hasil shell](shell-syntax.json), [hasil YAML](yaml-syntax.json)
- [Rekomendasi terstruktur](recommendations.json), [sampel 15](05-spot-check.json), [rekonsiliasi duplikasi](06-duplicate-check.md)
- [Alur lintas layanan](03-cross-service-flows.md), [katalog KPI](07-bi-catalog.md), [otomasi](08-automation.md)

Perintah reproduksi: `python docs/analysis/run-1e93545a2/scripts/full_scan.py`, `node docs/analysis/run-1e93545a2/scripts/extract.mjs`, dan quality gates pada bagian 4.


## 9. Verifikasi Docker dan data lokal tersimpan

[Hasil verifikasi runtime dan data lokal](HYDROMART_DOCKER_DATA_VERIFICATION.md) mencatat pemeriksaan atas stack Compose lokal. Sembilan belas container aplikasi sehat; scheduler semula `unhealthy` karena kuncinya berbeda dari 18 backend/gateway dan job internal mendapat HTTP 401. Scheduler telah direkreasikan dengan konfigurasi yang cocok dan heartbeat bergerak lagi. Setelah aktif, sweep expiry membatalkan lima order lokal, termasuk dua yang stalled; seluruh lima reservasi stok dilepas, dua pembayaran terkait sudah refunded sebelumnya, dan lima notifikasi pembatalan tercatat. Image HR lama belum memuat route pengingat shift; setelah migrasi aditif dan penggantian hanya container HR, job itu menjawab `ok: true`, HR sehat, dan 22/22 job terakhir sukses. Gateway/web menjawab HTTP 200, katalog mengembalikan 20 produk aktif yang cocok dengan hitungan database, dan `/auth/me` tanpa token menjawab 401. Database memuat record lokal persisten; asal produksi dan kesesuaian image dengan commit audit belum dibuktikan. Harness integrasi mutatif **lulus pada project Docker terisolasi** dengan storage MinIO tes: 20/20 service sehat, semua skenario inti lulus, HRIS 30 lulus/0 gagal/0 skip, approvals 158 lulus, dan payroll manual lulus. Gate `audit:ci` yang sebelumnya lulus palsu saat sumber advisori gagal telah diperbaiki dan diverifikasi pada working tree; temuan IDO-12 tetap mencatat keadaan baseline audit.
