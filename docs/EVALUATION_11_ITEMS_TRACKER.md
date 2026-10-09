# Tracker: 11 Poin Evaluasi, Perbaikan & Pengembangan HYDROMART

Status per 2026-10-09. Update dokumen ini setiap ada perubahan status, jangan buat dokumen baru.

Legenda: ✅ Selesai (kode live di `main`) · 🟡 Sebagian · ⛔ Belum dimulai · 🧑‍💼 Blocked di aksi pemilik (bukan bug)

---

## 1. Perbaikan OTP dan Proses Verifikasi — 🧑‍💼
Didiagnosis: bukan bug kode. Keterlambatan OTP = kredit SMS Zenziva.
**Aksi pemilik:** perpanjang kredit SMS OTP di console Zenziva.
Ref: adapter OTP Zenziva sudah live (PR #21).

## 2. Perbaikan Upload Bukti Pembayaran QRIS — 🧑‍💼
Didiagnosis: bukan bug kode. 2 depot belum punya data rekening/QRIS di PG produksi, jadi tombol pembayaran non-tunai nunggu data.
**Aksi pemilik:** isi data rekening/QRIS 2 depot tersebut di database produksi.

## 3. Fitur Upload Riwayat Transaksi Penjualan — ✅
PR #608 (merged `067bc9a7`, squash ke main 2026-10-02). Wizard di `/dashboard/sales-import`, tabel baru `ImportedSalesTransaction` di order-service, dedup via `(depotId, externalRef)`, gated capability `salesImportAdmin`.
Migration `20261002100000_imported_sales_transactions` sudah live di PG produksi — ter-apply otomatis oleh deploy #608 (2026-10-02 10:02 UTC), index concurrent dibangun duluan tanpa lock.
Browser-verify selesai 2026-10-02: upload CSV di `/dashboard/sales-import` (depot Galaxy Bekasi) → `POST .../sales-import` 201, `{"created":1,"failed":0}`. Baris test sudah dihapus lagi dari prod.

## 4. Monitoring Progres Implementasi — ✅ (dokumen ini)
Dokumen ini adalah deliverable item 4. Jangan buat file tracker lain — update yang ini.

## 5. Pengembangan Sistem Promo dan Voucher — 🟡 (semua kode selesai dan ter-deploy; menunggu verifikasi browser pemilik)
Fase 1 (mesin promo auto-apply) selesai di kode: ketiga plan sudah merge ke main. 3 plan ditulis (`docs/superpowers/plans/2026-10-02-promo-auto-apply-engine-plan{1,2,3}-*.md`).
- **Plan 1** (promo-service backend: schema PromoRule/PromoApplication, algoritma matching/stacking SPECIAL_PRICE/BUY_X_GET_Y/SHIPPING_DISCOUNT, repo, service CRUD+quote+apply, endpoint admin + internal) — **MERGED** ke main (PR #610, `2fd7a250`). 4 ronde whole-branch review.
- **Plan 2** (integrasi order-service ke `checkout()`/`walkInSale()` — stok BOGO disumkan di 6 titik inventory, replay guard counter diperbaiki, shipping override di-cap ke tarif depot, voucher quote/redeem simetris pakai subtotal post-promo, minimum-order pakai subtotal pre-promo) — **MERGED** ke main (PR #611, `ce6197dc`). 3 ronde whole-branch review — ini kali pertama mesin promo menyentuh uang/stok sungguhan, dan terbukti: setiap task lolos review-nya sendiri, tapi baca keseluruhan branch menemukan bug Critical nyata di 2 ronde pertama (stok BOGO tidak pernah dikonsumsi di 5 titik, replay guard menolak retry sah, shipping override tanpa batas atas, lalu fix voucher-subtotal yang pertama justru salah hitung diskon). Ronde ke-3 tidak menemukan apa-apa lagi.
- **Plan 3** (admin UI `/hq/promo-rules` + `/dashboard/promo-rules`) — **MERGED** ke main (PR #613, `e0ded7fb`). Bug nyata yang tertangkap CI sebelum merge: label hari disimpan sebagai array padahal `t()` hanya mengembalikan string (editor akan crash begitu dibuka), dan PATCH tanpa `seenUpdatedAt` akan selalu ditolak. Sisa PR: #614 (test regresi + `specialPrice >= 1`), #615 (patch advisory proxy-addr CRITICAL / source-map-js).
**Lanjutan 2026-10-08/09 (semua merged + ter-deploy; tiap PR lolos CI, tes, lint, tsc dan semua `scripts/check-*`):**
- Bug/UX lama ditutup: forecast tidak lagi menghitung ganda baris gratis BOGO (#617); tombol tulis disembunyikan untuk role read-only dan rule network-wide di konsol depot (#618); promo per kategori kini berlaku saat checkout (#619, `categoryId` sebelumnya selalu `null`).
- **C. Stacking** promo + member + voucher dikunci dengan tes, tanpa ubah perilaku (#620).
- **E. Audit diskon** — `docs/DISCOUNT_AUDIT_2026-10.md` (#621). E-2: keranjang kini menampilkan promo yang sama dengan checkout (#623). E-3: promo melewati baris harga grosir sehingga basis diskon reseller benar (#622). E-4: langganan sengaja tanpa promo otomatis.
- **B. Voucher per produk/kategori** (satu produk ATAU satu kategori, tidak untuk gratis ongkir; voucher lama tetap whole-order; min. belanja tetap dinilai dari seluruh keranjang): promo-service + migration `voucher_item_scope` (#624), order-service mengirim baris keranjang pasca-promo di quote/redeem (#625), form HQ + checkout (#626), form voucher depot (#634), label "Khusus …" di dompet (#633 + #636).
- **D. Admin UI promo**: picker produk/kategori/depot (#627), backend simulate + pemakaian (#628), pencarian/filter, duplikat, kolom pemakaian dan simulator "Coba rule" (#632). Editor form bersama HQ dan konsol depot.
- **11. Jenis promo baru** (migration `promo_rule_kinds`): `PERCENTAGE_OFF`, `ORDER_DISCOUNT` (min. belanja → potongan nominal atau persen, dinilai dari subtotal pasca-promo barang, menumpuk dengan member + voucher dan di-cap ke subtotal), `BUNDLE_GIFT` (hadiah produk lain; kalau stok hadiah kurang, hadiah dilewati dan order tetap jalan), dan syarat `firstOrderOnly` untuk semua jenis (belum punya order aktif/selesai di mana pun; tidak diketahui = bukan baru). Harga bertingkat tidak butuh jenis baru — cukup beberapa rule `SPECIAL_PRICE` dengan `minQty`/`maxQty` (dikunci tes). promo-service #629, order-service #630, web #631.
- Perbaikan tes: e2e order-service kini punya `CUSTOMER_SERVICE_URL` (#635); timeout `findBy`/`waitFor` web 5 dtk karena tes tak terkait gagal acak saat beban tinggi.
- **Disengaja tidak dilakukan:** ongkir galon hadiah `BUNDLE_GIFT` tidak dihitung (ongkir diputuskan sebelum hadiah diketahui). Pengajuan voucher depot → persetujuan HQ tidak ada (rutenya dihapus CA-2-42); depot membuat voucher langsung di `/dashboard/vouchers`.
- **Uji browser nyata di stack lokal (2026-10-09, bukan produksi):** seluruh stack dibangun dari `main`, lalu Playwright login lewat UI per role (SUPER_ADMIN, MANAGER, KEPALA_DEPOT, HEAD_OFFICE, DIREKTUR, pelanggan). 55 pemeriksaan: satu rule tiap jenis baru dibuat lewat form dan tersimpan benar; simulator (harga 6.000→4.800, diskon belanja 5.000, 4 hadiah, flag pelanggan baru); filter, duplikat, kolom pemakaian; keranjang dan checkout (subtotal, diskon, ongkir per galon tanpa hadiah, total, hadiah sebagai baris Rp0, audit pemakaian); hadiah saat stok habis (order tetap jalan tanpa hadiah; barang berbayar habis tetap 422); voucher berscope (diskon hanya di baris galon, 422 tanpa baris keranjang atau tanpa produk yang cocok, label "Khusus …" di dompet, form depot); role read-only dan konsol depot. Semua lolos.
- **Dua bug nyata yang hanya tertangkap browser nyata (tes komponen me-mock API):** (1) membuat rule dari form SELALU gagal 400 `property active should not exist` sejak editor dirilis — `active` hanya boleh di PATCH (#638); (2) konsol depot membuat rule network-wide saat pilihan depot "Semua depot" sehingga ditolak API untuk akun depot — kini memakai `scopedId` (#638). Juga satu cacat responsif dari pass per role: filter di `/hq/promo-rules` dan `/dashboard/promo-rules` melebarkan halaman 52px di layar 320px (#638, diukur ulang 0 temuan). Tes kontrak baru (`services/promo-service/test/unit/web-editor-payload-contract.spec.ts`) menjalankan payload create/edit setiap jenis melalui DTO API asli.
- **`scripts/screen-services.json`** sudah di-record ulang untuk delapan role dengan `--update-services` (#639).
- **Yang hanya bisa pemilik:** verifikasi browser di PRODUKSI dengan akun dan data nyata (OTP SMS dikirim ke nomor pemilik; rule dan voucher uji langsung memengaruhi harga pelanggan — pakai satu depot uji, nama berawalan `UJI`, nonaktifkan setelahnya).
**Catatan deploy:** `GlobalValidationPipe` menolak field tak dikenal, jadi perubahan kontrak selalu dipecah: promo-service dulu → tunggu deploy → order-service → web. Deploy "gagal" yang bertanda `not-shipped` berarti CI `main`-nya dibatalkan oleh merge berikutnya (tip terakhir yang di-deploy membawa semuanya), bukan error.


## 6. Pembatasan Akses Franchise Berdasarkan Depot — ✅
`packages/platform/src/nest/depot-scope.ts:106` — `assertDepotOwnership()`: FRANCHISE_OWNER dicocokkan ke `Depot.ownerId` milik baris itu sendiri (bukan resolved-set, lebih kuat), fail-closed kalau `ownerId` null/unknown.

## 7. Evaluasi dan Penyempurnaan Role serta RBAC Berdasarkan Depot — ✅ (ditunda, keputusan diambil)
- Single source of truth RBAC sudah ada: `packages/access/src/index.ts` (`CAPABILITIES` map, dipakai Nest guards + web console, tidak bisa drift).
- Audit role franchise sudah dilakukan (lihat rencana "7A" di plan franchise): sistem masih hanya punya **satu** role franchise (`FRANCHISE_OWNER`), tidak ada sub-role (Admin Franchise / Keuangan Franchise / Manajer Area Franchise), dan staf depot WARALABA masih memakai role yang sama dengan depot pusat.
- **Keputusan pemilik (2026-10-02): ditunda (YAGNI).** Belum ada bukti mitra franchise beneran butuh delegasi akses tanpa share password. Dikerjakan nanti kalau ada mitra yang minta/komplain, bukan sekarang.

## 8. Standarisasi Upload Gambar dan Media — ✅
PR #609 (merged `71f3210e`, squash ke main 2026-10-02) — upload gambar promo (hq + dashboard). Avatar, bukti bayar, KTP agen, foto HR sudah upload langsung sebelumnya (`fa0a7318e`).
Browser-verify selesai 2026-10-02: tombol "Unggah" muncul di `/hq/promotions` dan `/dashboard/promotions`, `POST .../promotions/upload-image` 201 di keduanya, field URL auto-terisi hasil upload (fallback ke bucket AUTH/products karena `PROMO_STORAGE_S3_*` belum diisi — sesuai keputusan "reuse bucket AUTH" yang masih default).
**Catatan penting — deploy serial trap:** verifikasi pertama (sesaat setelah deploy #608) GAGAL — tombol upload belum muncul sama sekali. Root cause: `scripts/deploy.sh` sengaja deploy satu commit per jalan ("the green commit", bukan langsung tip `main`) dan `concurrency: group: deploy-prod` mengantre deploy #609 di belakang #608 + migrate manual, baru jalan ~25 menit kemudian. Kalau browser-verify dilakukan segera setelah merge tanpa cek riwayat Deploy workflow, hasilnya false negative — kelihatan seperti PR tidak ter-deploy padahal cuma kena antrean.

## 9. Perbaikan Menu Reseller dan Agen — ✅ (mayoritas)
Serangkaian fix sudah live: K4.1 (agen bisa lihat status), K4.2 (harga agen tidak lagi bisa diubah diam-diam), A5 (bug harga penuh agen), reseller registry + per-depot achievement (PR #30+#31), reseller pricing (flat per-reseller %). Tidak ada bug terbuka yang diketahui.
**Kalau mau audit ulang:** perlu sesi khusus untuk cek alur bisnis + tampilan end-to-end, belum ada audit menyeluruh terbaru.

## 10. Pengembangan Fitur Laporan Berdasarkan Periode — ✅
`/hq/reports/export`: preset 7 hari/30 hari/kuartal + custom date range. PDF export parity selesai di PR #608 (xlsx/csv/pdf render baris yang sama, tidak mungkin beda).
Browser-verify selesai 2026-10-02: `/hq/reports/export` → pilih PDF → `POST .../revenue-export/pdf` 201, `content-type: application/pdf`. `/hq/scheduled-reports` → buat jadwal format PDF → tersimpan dengan badge "PDF" (lalu dihapus lagi, test data).

## 11. Impor Riwayat Transaksi Masuk ke Laporan Revenue — ✅
Bagian dari PR #608 — keputusan pemilik: merge penuh (bukan referensi saja) ke laporan revenue live. Depot match exact `depotId`, produk match case-insensitive label (produk tak-cocok tetap muncul, `productId: ''`, display-only), metode bayar dinormalisasi lalu digabung ke `revenueByMethod` (fail-soft kalau order-service unreachable). `commissionBase` depot yang di-merge tetap pakai angka live saja — tidak ada komisi franchise dihitung dari data historis ini.
**Sisa kerja:** migration sudah live (lihat item 3), browser-verify belum dilakukan.

---

## Next Actions (urutan)
1. ~~Cek status final CI PR #608/#609~~ — done, keduanya hijau.
2. ~~Merge PR #608 dan #609~~ — done 2026-10-02.
3. ~~Terapkan migration `imported_sales_transactions` ke PG produksi~~ — done, ter-apply otomatis oleh deploy #608 2026-10-02 10:02 UTC.
4. ~~Browser-verify manual~~ — done 2026-10-02, semua 4 titik PASS (lihat item 3/8/10/11).
5. ~~Item 5 (promo/voucher overhaul)~~ — kode selesai dan ter-deploy 2026-10-09 (lihat item 5). Sisa: verifikasi browser pemilik.
6. ~~Item 7~~ — keputusan diambil 2026-10-02: ditunda (YAGNI), tidak perlu implementasi sekarang.

## Aksi Pemilik yang Masih Terbuka (bukan kode)
- Item 5: verifikasi browser di produksi (akun SUPER_ADMIN/MARKETING, MANAGER/KEPALA_DEPOT, HEAD_OFFICE/DIREKTUR dan pelanggan; depot uji). Lihat catatan keamanan di item 5.
- Depot BKS-GALAXY dan BKS-Pekayon belum punya tujuan pembayaran (pelanggan hanya ditawari tunai); depot waralaba BKS-JATIWARINGIN belum punya `commission_schemes` (komisi jatuh ke 0%) — peringatan dari probe deploy.
- Zenziva: perpanjang kredit SMS OTP.
- Isi data rekening/QRIS untuk 2 depot yang belum punya di PG produksi.
- `PROMO_STORAGE_S3_*`: putuskan reuse bucket AUTH atau bucket promo sendiri, isi env produksi.
- Item 7: putuskan perlu sub-role franchise baru atau tidak.
