# Tracker: 11 Poin Evaluasi, Perbaikan & Pengembangan HYDROMART

Status per 2026-10-02. Update dokumen ini setiap ada perubahan status, jangan buat dokumen baru.

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

## 5. Pengembangan Sistem Promo dan Voucher — 🟡
Fase 1 dari 3: 3 plan ditulis (`docs/superpowers/plans/2026-10-02-promo-auto-apply-engine-plan{1,2,3}-*.md`), Plan 1 (promo-service backend: schema PromoRule/PromoApplication, algoritma matching/stacking SPECIAL_PRICE/BUY_X_GET_Y/SHIPPING_DISCOUNT, repo, service CRUD+quote+apply, endpoint admin + internal) **SELESAI dan merge-ready** di branch `feat/sales-import-report-parity` (26 commit, f40e9d69..ea4414d3) — 4 ronde whole-branch review, semua temuan Critical/Important sudah diverifikasi langsung dari kode (bukan cuma laporan subagent). Belum di-merge ke main (menunggu Plan 2+3 atau keputusan user). Plan 2 (integrasi order-service ke checkout()/walkInSale()) dan Plan 3 (admin UI `/hq/promo-rules` + `/dashboard/promo-rules`) **belum dimulai**.
**Catatan untuk Plan 2:** dokumen Plan 2 masih mereferensikan signature lama `apply(orderId, depotId, channel, items)` — sudah diganti jadi `apply(ApplyInput)` yang percaya hasil quote() milik caller (keputusan user), dan Plan 2 belum punya `Math.min()` clamp untuk shipping fee override yang menaikkan harga. Update dokumen Plan 2 dulu sebelum mulai eksekusi tasknya.
**Keputusan:** fase terbesar di daftar ini — dikerjakan di sesi terpisah (lihat Next Actions).

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
5. Item 5 (promo/voucher overhaul) — sesi terpisah, scope besar. **NEXT.**
6. ~~Item 7~~ — keputusan diambil 2026-10-02: ditunda (YAGNI), tidak perlu implementasi sekarang.

## Aksi Pemilik yang Masih Terbuka (bukan kode)
- Zenziva: perpanjang kredit SMS OTP.
- Isi data rekening/QRIS untuk 2 depot yang belum punya di PG produksi.
- `PROMO_STORAGE_S3_*`: putuskan reuse bucket AUTH atau bucket promo sendiri, isi env produksi.
- Item 7: putuskan perlu sub-role franchise baru atau tidak.
