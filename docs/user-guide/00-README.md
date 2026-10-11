# Panduan Pengguna Hydromart — Indeks Utama

**Versi:** 0.1 (draf) · **Tanggal pembaruan terakhir:** 2026-10-11 · **Bahasa:** Indonesia

Hydromart adalah platform operasional depot air minum isi ulang di Indonesia (depot milik perusahaan "HKP" dan depot waralaba). Paket dokumen ini menjelaskan cara tiap peran bekerja di aplikasi, dari awal sampai akhir.

## Status dokumen — baca ini dulu

| Hal | Status |
|---|---|
| Sumber isi | Pembacaan kode (`packages/access`, `apps/web`, `services/*`), kamus UI, dan dokumen proyek. Tiap klaim penting diberi tag bukti. |
| Pengujian di aplikasi | **Belum ada pengujian terstruktur.** Semua skenario di dokumen 15 berstatus *Not Tested*. Satu alur pesanan (pelanggan → depot → kurir → COD → selesai) memang dijalankan sekali di lingkungan uji lokal pada 2026-10-11 untuk mengambil screenshot; itu dicatat sebagai *pengamatan* di dokumen 15 bagian 'Pengamatan lingkungan uji lokal', bukan hasil Pass. |
| Screenshot | **74 gambar asli** dari lingkungan uji lokal (data sintetis, nomor telepon tersamar, 2026-10-11) sudah dipasang di bab 01–10 dan tersimpan di `assets/screenshots/`. Sekitar 70 slot masih berupa placeholder `[SCREENSHOT REQUIRED: SS-…]` (dialog, status lain, dan peran Finance/Marketing/Manajer/Direktur belum difoto). Banyak layar menunjukkan keadaan kosong karena data uji minim. Status tiap gambar ada di inventaris di akhir bab. |
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
