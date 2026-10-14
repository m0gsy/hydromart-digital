# Panduan Pengguna Hydromart — Indeks Utama

**Versi:** 0.4 (draf) · **Tanggal pembaruan terakhir:** 2026-10-14 · **Bahasa:** Indonesia

Hydromart adalah platform operasional depot air minum isi ulang di Indonesia (depot milik perusahaan "HKP" dan depot waralaba). Paket dokumen ini menjelaskan cara tiap peran bekerja di aplikasi, dari awal sampai akhir.

## Status dokumen — baca ini dulu

| Hal | Status |
|---|---|
| Sumber isi | Pembacaan kode (`packages/access`, `apps/web`, `services/*`), kamus UI, dan dokumen proyek. Tiap klaim penting diberi tag bukti. |
| Pengujian di aplikasi | **Terbatas.** Dari 406 skenario di dokumen 15, **104 dijalankan** pada 2026-10-14 di stack uji lokal yang dibangun dari kode setelah PR #664: **102 Pass, 1 Fail, 1 Blocked**; **302 tetap Not Tested**. Sebagian besar Pass hanya diperiksa lewat API (UI hanya pada beberapa skenario), dan sebagian memakai simulasi (waktu dimundurkan di DB uji, layanan dihentikan sementara, data waralaba disuntik). Ini bukan UAT penuh dan bukan pengujian produksi. Hasil itu mendahului perbaikan G-149 s.d. G-152 yang baru ada di cabang `fix/uat-g128-g149-g152` (belum di `main`); skenario terkait perlu dijalankan ulang setelah cabang digabung (daftar di Bab 15, "Perlu uji ulang setelah perbaikan"). |
| Screenshot | **124 gambar asli** tersimpan di `assets/screenshots/` dan terpasang di bab 02–10 (dan 01): **74** diambil 2026-10-11 dari build SEBELUM PR #664 (bila keterangannya berbunyi "Diambil sebelum PR #664", sebagian tampilannya kini berbeda), ditambah **50 gambar berakhiran `-p664`** yang diambil 2026-10-14 dari stack uji lokal pasca-#664 (data sintetis; nomor telepon, nomor rekening, surel, alamat IP, dan token disamarkan; kotak OTP diburamkan; tiap gambar diperiksa visual). Gambar `-p664` dipasang di bawah gambar lama yang digantikannya (judul "Setelah PR #664") atau mengisi placeholder yang cocok (7 slot terisi, 1 di antaranya sebagian). Peran Finance, Marketing, Manajer, dan Direktur kini sudah difoto (termasuk layar galat izin Finance, dilabeli apa adanya). Sekitar 63 slot di bab 01–10 masih berupa placeholder `[SCREENSHOT REQUIRED: SS-…]` (dialog, status lain, item approval PENDING/HELD, kartu "Pencairan diproses" yang tidak tampil di UI). Banyak layar menunjukkan keadaan kosong karena data uji minim. Status tiap gambar ada di inventaris di akhir bab; daftar rinci tambahan di berkas temuan `N-screenshots-p664.md` (di luar repo). |
| Hak akses | Nilai **bawaan** dari kode. Super Admin dapat mengubahnya saat aplikasi berjalan (sekitar 30 detik), jadi lingkungan nyata bisa berbeda. |
| PDF/DOCX gabungan | Tersedia dua paket: `hydromart-panduan-pelanggan.pdf/.docx` (publik, hanya bab 02) dan `hydromart-panduan-internal.pdf/.docx` (bab 00–01 dan 03–17, rahasia). PDF punya daftar isi, header, nomor halaman, dan klasifikasi di footer. Pada DOCX, daftar isi diisi saat dibuka di Word (setujui pembaruan field). Diagram Mermaid di dokumen 11 tampil sebagai teks diagram, belum sebagai gambar. |

### Tag bukti di seluruh dokumen

| Tag | Arti |
|---|---|
| **[V]** | Terverifikasi di kode. |
| **[D]** | Disimpulkan; perlu uji di browser atau konfirmasi. |
| **[K]** | Perlu konfirmasi bisnis (nilai berasal dari data/pengaturan atau kebijakan). |
| **[B]** | Diketahui bermasalah atau tidak konsisten (teks UI vs kode, tombol tampil tetapi ditolak server, dsb.). |

## Pemetaan peran

Permintaan awal menyebut sembilan peran. Di kode ada 13 peran akun. Pemetaannya:

| Peran di permintaan | Peran di kode | Catatan |
|---|---|---|
| Customer | `CUSTOMER` | |
| Kepala Depot | `KEPALA_DEPOT` | Terkunci pada satu depot. |
| Staff Depot | `STAFF_DEPOT` | **Di kode, peran ini adalah kurir** dan masuk ke aplikasi `/driver`. Tidak ada peran petugas konter terpisah (lihat G-celah di dokumen 17). |
| Supervisor | `SUPERVISOR` ("SPV") | |
| Asisten Supervisor | `ASSISTANT_SUPERVISOR` ("Asisten SPV") | Hak berbeda dari SPV. |
| Franchise / Waralaba | `FRANCHISE_OWNER` | |
| HR | `HR` | |
| HQ | `HEAD_OFFICE` ("Kantor pusat") | `DIREKTUR` dan `FINANCE` juga masuk konsol `/hq`; dibahas di bab 9. |
| Admin | `SUPER_ADMIN` | |
| *(tambahan)* | `MANAGER`, `DIREKTUR`, `FINANCE`, `MARKETING` | Dicakup di matriks (dok. 12) dan bab terkait. |

## Daftar dokumen

| No | Berkas | Isi | Audiens | Klasifikasi |
|---|---|---|---|---|
| 01 | [01-general-user-guide.md](01-general-user-guide.md) | Panduan umum: masuk, navigasi, istilah, dukungan | Semua | Internal — Terbatas |
| 02 | [02-customer-guide.md](02-customer-guide.md) | Panduan pelanggan | Pelanggan | Publik/Pelanggan |
| 03 | [03-kepala-depot-guide.md](03-kepala-depot-guide.md) | Kepala Depot | Internal | Internal — Terbatas |
| 04 | [04-staff-depot-guide.md](04-staff-depot-guide.md) | Staff Depot (kurir) dan HRIS mandiri | Internal | Internal — Terbatas |
| 05 | [05-supervisor-guide.md](05-supervisor-guide.md) | Supervisor (+ lampiran Manajer) | Internal | Internal — Terbatas |
| 06 | [06-assistant-supervisor-guide.md](06-assistant-supervisor-guide.md) | Asisten Supervisor | Internal | Internal — Terbatas |
| 07 | [07-franchise-guide.md](07-franchise-guide.md) | Waralaba | Pemilik waralaba | Internal — Terbatas |
| 08 | [08-hr-guide.md](08-hr-guide.md) | HR | HR | Internal — Terbatas |
| 09 | [09-hq-guide.md](09-hq-guide.md) | HQ (Kantor pusat, Direktur, Finance) | HQ | Internal — Rahasia |
| 10 | [10-admin-guide.md](10-admin-guide.md) | Admin (Super Admin) | Admin | Internal — Rahasia |
| 11 | [11-end-to-end-business-process.md](11-end-to-end-business-process.md) | 23 alur bisnis end-to-end | Semua internal | Internal — Terbatas |
| 12 | [12-role-permission-matrix.md](12-role-permission-matrix.md) | Matriks peran & izin (106 kapabilitas) | Semua internal | Internal — Rahasia |
| 13 | [13-troubleshooting-and-faq.md](13-troubleshooting-and-faq.md) | Pemecahan masalah (63 kasus) dan FAQ | Semua | Internal — Terbatas |
| 14 | [14-quick-reference-guide.md](14-quick-reference-guide.md) | Panduan cepat per peran | Semua internal | Internal — Terbatas |
| 15 | [15-test-and-validation-matrix.md](15-test-and-validation-matrix.md) | Skenario uji (~330, belum diuji) | QA | Internal — Terbatas |
| 16 | [16-documentation-traceability-matrix.md](16-documentation-traceability-matrix.md) | Keterlacakan modul → bukti → bab → uji | QA, pemilik produk | Internal — Terbatas |
| 17 | [17-open-questions-and-documentation-gaps.md](17-open-questions-and-documentation-gaps.md) | 148 celah dan pertanyaan bisnis | Pemilik produk | Internal — Rahasia |

Panduan pelanggan (02) sengaja dipisah dari dokumen internal dan tidak memuat prosedur internal atau admin.

## Mulai dari mana?

| Anda adalah… | Mulai dari | Lalu |
|---|---|---|
| Pelanggan | 02 | 13 (FAQ pelanggan) |
| Kurir (Staff Depot) | 04 | 14, 13 |
| Kepala Depot | 03 | 14, 11 (F01–F07) |
| SPV / Asisten SPV / Manajer | 05 atau 06 | 12, 14 |
| Pemilik waralaba | 07 | 13 |
| HR | 08 | 11 (F13–F18) |
| HQ / Finance / Direktur | 09 | 12, 11 (F02, F10, F11) |
| Admin | 10 | 12, 17 |
| Pemilik produk / QA | 17, 16, 15 | 12 |

## Titik masuk per peran (dari kode)

Tempat tiap peran mendarat setelah masuk ditentukan fungsi `consoleHome` (`apps/web/src/lib/roles.ts`). Ringkasnya: kurir ke `/driver`; Kantor pusat, Direktur, dan Super Admin ke `/hq`; Finance ke layar `/hq` pertama yang boleh dibuka; Kepala Depot, Manajer, SPV, Asisten SPV, dan Waralaba ke `/dashboard` (Waralaba diarahkan ke `/dashboard/franchise`); HR ke `/hr`; Marketing ke `/dashboard/campaigns`; pelanggan ke `/products`. Rincian dan pengecualian ada di dokumen 01.

## Screenshot

Gambar disimpan di `assets/screenshots/` dengan penamaan `<peran>-<nn>-<slug>.png`. Selama gambar belum tersedia, bab memakai placeholder berlabel. Inventaris per bab (ID SS, layar, kondisi, status) ada di akhir tiap bab. Data pada gambar harus sintetis; nomor telepon, kode OTP, dan token wajib disamarkan.

## Membuat PDF/DOCX

Dari folder ini, dengan `pandoc` terpasang:

```bash
pandoc 00-README.md 01-general-user-guide.md 02-customer-guide.md 03-kepala-depot-guide.md \
  04-staff-depot-guide.md 05-supervisor-guide.md 06-assistant-supervisor-guide.md \
  07-franchise-guide.md 08-hr-guide.md 09-hq-guide.md 10-admin-guide.md \
  11-end-to-end-business-process.md 12-role-permission-matrix.md 13-troubleshooting-and-faq.md \
  14-quick-reference-guide.md 15-test-and-validation-matrix.md \
  16-documentation-traceability-matrix.md 17-open-questions-and-documentation-gaps.md \
  --toc --number-sections -o hydromart-user-guide.docx
```

Dokumen untuk pelanggan (02) sebaiknya didistribusikan sendiri. Jangan menyertakan dokumen internal (09, 10, 12, 17) bila hasil gabungan akan dibagikan di luar organisasi.

## Kontrol dokumen

| Versi | Tanggal | Perubahan |
|---|---|---|
| 0.1 | 2026-10-11 | Draf pertama dari audit kode. Belum diuji di aplikasi; screenshot menyusul. |
| 0.2 | 2026-10-14 | Dicocokkan ulang dengan kode setelah PR #664 (perbaikan celah); audit sampel klaim [V] pada bab HR, Admin, HQ (227 klaim: 205 benar, 14 sebagian, 8 salah, semuanya sudah dikoreksi); 104 skenario dijalankan; 50 screenshot pasca-#664 ditambahkan (total 124); 148 celah berstatus 2026-10-14 + G-149..G-155 baru. |
| 0.3 | 2026-10-14 | Status G-149..G-153 dicocokkan dengan cabang `fix/uat-g128-g149-g152` (5a8ae4a; `main` = 9ba67b7 setelah #665 dan #666). G-149, G-150, G-151 diperbaiki di cabang dan sebagian G-152 (catatan sengketa kosong); belum di `main`, terverifikasi dari kode, belum diuji ulang. G-153: diklaim selesai pemilik, perbaikan kodenya tidak ditemukan (kemungkinan sengaja; perlu konfirmasi). G-128: pemohon refund dicatat dan ditampilkan (#665), penegakan pemohon≠penyetuju belum ada. Catatan gambar beranda pelanggan yang mendahului #666. Hasil Pass/Fail Bab 15 tidak diubah. |
| 0.4 | 2026-10-14 | Dicocokkan dengan commit 609a497 pada cabang `fix/uat-g128-g149-g152` (di atas 5a8ae4a; belum di `main` = 9ba67b7, belum diuji ulang). (1) Layar Finance: empat kapabilitas baca baru (`dashboardFinance`, `orderReportsFinance`, `depotDirectoryFinance`, `returnsReadFinance`); 110 kapabilitas di cabang, 106 di `main`; FINANCE 21 menjadi 25; kapabilitas dasar dan sembilan pintu `/hq` tidak berubah. Pengamatan galat Finance 2026-10-14 (Bab 9) dipertahankan sebagai kondisi pra-perbaikan. (2) `/dashboard/payout`: `if (loading && !data)` sehingga kartu "Pencairan diproses" tidak lagi terbuang saat muat ulang (Bab 7). G-086 menjadi "Diperbaiki di cabang, belum di `main`"; ringkasan Bab 17 dan Bab 16 dihitung ulang dengan skrip; Bab 15 menambah daftar uji ulang. Tabel nilai `main` di Bab 12 tidak diubah (empat kapabilitas dipisah di bagian 6.1). Hasil Pass/Fail Bab 15 tidak diubah. |
