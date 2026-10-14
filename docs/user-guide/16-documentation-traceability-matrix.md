# Matriks Keterlacakan Dokumentasi

**Versi:** 0.1 (draf) · **Tanggal:** 2026-10-11 (dicocokkan ulang dengan kode pasca PR #664 pada 2026-10-14) · **Klasifikasi:** Internal — Terbatas

Matriks ini menghubungkan setiap modul/kebutuhan dengan bukti sumber, peran, bagian panduan, skenario uji, dan status cakupan dokumentasi.

## Cara membaca status

| Status | Arti |
|---|---|
| Complete | Didokumentasikan langkah demi langkah dengan bukti kode, dan tidak ada celah terbuka yang mengubah cara pengguna bekerja. |
| Partial | Didokumentasikan, tetapi ada butir terbuka bertanda [D] (perlu uji browser), [K] (perlu konfirmasi bisnis), atau [B] (cacat/inkonsistensi) yang memengaruhi prosedur. |
| Blocked | Tidak dapat didokumentasikan penuh tanpa lingkungan nyata atau data produksi. |
| Not Verified | Ada di kode/menu, tetapi isinya belum dibaca atau belum dapat dipastikan. |
| Not Applicable | Tidak berlaku untuk peran/modul tersebut. |

**Peringatan:** semua "Complete" di sini berarti *terdokumentasi dari pembacaan kode*. Belum ada alur yang dijalankan di aplikasi oleh tim dokumentasi, dan kolom "Skenario uji" merujuk ke skenario di dokumen 15 yang seluruhnya berstatus Not Tested. Kolom Status dicocokkan ulang 2026-10-14 terhadap `docs/OPEN_GAPS_DECISIONS_2026-10.md` dan kode setelah PR #664 (pembacaan kode, bukan uji peramban); perubahan ditandai "sejak PR #664". Rujukan Bab mengacu pada nomor file panduan (Bab 2 = `02-customer-guide.md`, dst.). ID celah (G-xxx) merujuk ke dokumen 17.

## Matriks

| Kebutuhan / Modul | Bukti sumber | Peran | Bagian panduan | Skenario uji | Status |
|---|---|---|---|---|---|
| Masuk/keluar, OTP, sesi | `services/auth-service`, `apps/web/src/app/login`, `verify`; env OTP | Semua | Bab 1; Bab 2 | TS-AUTH, TS-SEC | Partial (OTP reviewer tetap & kanal console: dok. 17; sejak PR #664 refresh token dicabut saat login dimatikan, token akses tetap ≤ 15 mnt [K]) |
| Pendaftaran & profil pelanggan | `apps/web/src/app/register`, `account`, `customer-service` | Pelanggan | Bab 2 | TS-AUTH | Complete |
| Alamat pelanggan | `app/addresses`, `customer-service` | Pelanggan | Bab 2 | TS-ORD | Complete |
| Katalog, keranjang, checkout | `app/products`, `cart`, `checkout`, `order-service` | Pelanggan | Bab 2 | TS-ORD | Partial (minimum order per depot [K]; sejak PR #664 Pasal 8 "sebelum kurir ditugaskan" selaras kode dan checkout menampilkan estimasi Deposit galon yang belum ditagih [K]) |
| Pembayaran & status pembayaran | `payment-service`, `app/orders/detail` | Pelanggan, Kepala depot, Kurir, Finance | Bab 2; Bab 3; Bab 4 | TS-PAY, TS-COD | Partial (gateway produksi tidak diketahui [K]; kode status pembayaran masih Inggris [B]; label status PESANAN sudah Indonesia sejak PR #664) |
| Pelacakan & riwayat pesanan | `app/track`, `app/orders` | Pelanggan | Bab 2 | TS-ORD, TS-DEL | Partial (tidak ada peta waktu nyata [B]) |
| Pembatalan & refund | `order-service`, `payment-service`, `app/orders/detail` | Pelanggan, Kepala depot, Manajer, Finance | Bab 2; Bab 3; Bab 11 F02 | TS-REF | Partial (sejak PR #664 status refund dan janji 1–3 hari kerja tampil di rincian pesanan; tanpa notifikasi refund; pemohon=penyetuju belum diperiksa: kolom `refundRequestedBy` ada, kodenya menyusul; cara/waktu refund [K]) |
| Ulasan & rating | `app/orders/detail/review`, `dashboard/ratings` | Pelanggan, Manajer | Bab 2 | TS-ORD | Complete |
| Langganan | `app/subscriptions`, `dashboard/subscriptions` | Pelanggan, Manajer | Bab 2; Bab 11 F08 | TS-SUB | Partial (lewati satu siklus dijanjikan T&K, tidak ada di kode [B]) |
| Voucher, poin, referral, hadiah | `promo-service`, `loyalty-service`, `referral-service` | Pelanggan, Kepala depot, Marketing | Bab 2; Bab 11 F09 | TS-LOY | Partial (kedaluwarsa poin mati bawaan) |
| Hapus akun & permintaan data PDP | `app/hapus-akun`, `auth-service`, `hq/pdp` | Pelanggan, Kantor pusat | Bab 2; Bab 9; Bab 11 F19 | TS-PDP | Partial (SLA dihitung dari pembuatan; tanpa notifikasi keputusan; sejak PR #664 hapus akun ditolak bila ada pesanan terbuka, fail-closed, paksa hanya Super admin; peringatan lewat batas belum ada [K]) |
| Antrean pesanan depot | `dashboard/orders`, `order-detail.tsx` | Kepala depot, SPV, Asisten SPV, Manajer | Bab 3; Bab 5; Bab 6 | TS-ORD, TS-STF | Partial (pembatalan otomatis berkala; label status Indonesia sejak PR #664; staf belum bisa membatalkan pesanan sebelum kurir ditugaskan [K]) |
| Penjualan kasir & shift kasir | `dashboard/walk-in`, `cashier-shift-bar.tsx` | Kepala depot, Manajer | Bab 3; Bab 11 F04 | TS-POS, TS-KAS | Complete |
| Tutup buku harian & buka kembali | `depot-service` dailyClose, `dashboard/reports` | Kepala depot, Manajer, Kantor pusat | Bab 3; Bab 9 | TS-KAS | Partial (buka kembali bulan oleh HO tampak tak terjangkau [D]) |
| Inventori & opname | `dashboard/inventory`, `depot-service` | Kepala depot, Manajer | Bab 3; Bab 11 F05 | TS-OPN | Partial (Kepala depot tak melihat antrean approval) |
| Retur galon & deposit | `dashboard/returns`, kurir `deliveries/detail/returns` | Kurir, Kepala depot | Bab 3; Bab 4; Bab 11 F03 | TS-GAL | Complete |
| Meteran air | `dashboard/meter` | Kurir*, Kepala depot, Manajer | Bab 3 | TS-OPN | Partial (sejak PR #664 tab Meteran tampil di rel Kepala depot sesuai kapabilitas; akses kurir tidak lewat /driver) |
| Tracking & dispatch | `dashboard/tracking`, `delivery-service` | Kepala depot, SPV, Asisten SPV, Manajer | Bab 3; Bab 5; Bab 6 | TS-DEL | Complete |
| Aplikasi kurir (shift, antar, bukti antar) | `app/driver/*`, `components/driver` | Staff depot (kurir) | Bab 4 | TS-STF, TS-DEL | Partial (antrean luring tak mencakup pickup/setoran/klaim/insiden) |
| Setoran COD | `dashboard/settlements`, `driver/settlement` | Kurir, Kepala depot, Manajer, Finance | Bab 3; Bab 4 | TS-COD | Partial (sejak PR #664 setoran Sengketa bisa diverifikasi dengan catatan wajib dan beban selisih ke kurir hanya oleh Manajer/Super admin; kebijakan beban/tenggat setoran [K]; kurir tak dapat membantah [B]) |
| Penghasilan, penarikan & klaim kurir | `driver/earnings`, `expenses`, `payout-service` | Kurir, Manajer, Finance | Bab 4; Bab 11 F20–F21 | TS-CLM, TS-WDR | Partial (nilai aturan penghasilan = data [K]) |
| Antrean approval Manajer | `dashboard/approvals` | Manajer | Bab 5 Lamp. A | TS-APR | Partial (sejak PR #664 item Ditahan tampil dan nominal/galon detail dibaca, tidak lagi Rp0 menurut kode; Kepala depot belum melihat status approval yang ia ajukan [K]) |
| Pengadaan (PO, pemasok) | `dashboard/purchase-orders`, `suppliers` | Manajer | Bab 5 Lamp. A; Bab 11 F06 | TS-PO | Complete |
| Insiden & sengketa | `dashboard/incidents`, `disputes` | Kepala depot, SPV, Manajer, Kantor pusat | Bab 3; Bab 5; Bab 11 F07 | TS-INC | Partial (komentar RBAC SPV dikoreksi sejak PR #664, matriks tidak diubah; apakah SPV memang boleh menulis buku kas, target, insiden, sengketa [K]) |
| Pengawasan multi-depot & hierarki | `packages/platform` depot-scope, `hq/hierarchy` | SPV, Asisten SPV, Manajer, Admin | Bab 5; Bab 6; Bab 10 | TS-SEC | Partial ("Semua depot" tetap memakai depot pertama di layar per-depot, kini dengan pemberitahuan sejak PR #664; layar gabungan dikecualikan) |
| Kasbon | `hr-service`, `hr/loans`, `hr/me/kasbon` | Karyawan, Asisten SPV, Manajer, HR | Bab 4; Bab 6; Bab 8; Bab 11 F16 | TS-ASG, TS-LEV | Partial (sejak PR #664: maks. 1x gaji pokok dan kedaluwarsa 3 hari kerja; alasan 4xx auth diteruskan ke HR; tanpa tautan menu [D]) |
| Cuti dua tahap | `hr/leave`, `hr/me/leave` | Karyawan, Manajer, HR | Bab 4; Bab 8; Bab 11 F15 | TS-LEV | Partial (HO/Direktur tak bisa memutuskan di UI) |
| Absensi wajah | `hr/me/check-in`, `enroll`, `hr/attendance` | Karyawan, HR | Bab 4; Bab 8; Bab 11 F14 | TS-ATT | Partial (geofence mati bawaan; liveness sisi klien) |
| Karyawan & offboarding | `hr/employees`, `hr-service`, `auth-service` | HR, Admin | Bab 8; Bab 11 F13 | TS-HRM | Partial (sejak PR #664 refresh token dicabut saat nonaktif, token akses ≤ 15 mnt [K]; tanpa wizard offboarding [K]; penangguhan depot belum mencabut sesi) |
| Penggajian | `hr/payroll`, `hr-service` | HR, Finance | Bab 8; Bab 11 F17 | TS-PRL | Partial (sejak PR #664 pembuat slip tidak boleh menyetujui, Super admin dikecualikan, dan Super admin bisa membatalkan persetujuan sebelum Dibayar dengan alasan; Tandai Dibayar tidak dibatasi; tabel TER PPh 21 kosong) |
| Penugasan/pinjam karyawan lintas depot | `hr/depot-requests`, flag `DEPOT_ASSIGNMENT_ENABLED` | Manajer, SPV, HR | Bab 5; Bab 8; Bab 11 F18 | TS-ASG | Blocked (status flag produksi tidak diketahui) |
| Pendaftaran & onboarding waralaba | `app/waralaba`, `hq/applications`, `Depot.ownerId` | Calon waralaba, Kantor pusat, Admin | Bab 7; Bab 9; Bab 11 F10 | TS-FRA | Partial (tanpa unggah dokumen/halaman status; akun & depot manual) |
| Payout & komisi waralaba | `dashboard/payout`, `payout-service`, `hq/payments` | Waralaba, Finance, Direktur | Bab 7; Bab 9 | TS-FRA, TS-WDR | Partial (sejak PR #664 riwayat penarikan tampil, label komisi dan teks "diajukan ke …, menunggu transfer" diperbaiki, minimum penarikan Rp50.000; kartu "Pencairan diproses" tidak tampil di `main` (terbukti 2026-10-14), diperbaiki di cabang 609a497, belum di `main`, belum diuji ulang; "Payout berikutnya" hanya tampilan, lama proses [K]) |
| Keputusan harga depot | `hq/pricing`, `depot-service` | Manajer, Kantor pusat | Bab 9; Bab 11 F11 | TS-APR | Complete |
| Antrean refund HQ & rekonsiliasi | `hq/refunds`, `hq/reconciliation` | Finance, Kantor pusat | Bab 9 | TS-REF | Blocked (halaman Finance galat izin pada `main`, terbukti 2026-10-14; diperbaiki di cabang `fix/uat-g128-g149-g152` (609a497), belum di `main`, belum diuji ulang, jadi tetap Blocked sampai diuji ulang; G-086) |
| Laporan, ekspor & laporan terjadwal | `hq/reports/export`, `hq/exports`, `hq/scheduled-reports` | Kantor pusat, Direktur, Manajer | Bab 9 | TS-RPT | Partial (format ekspor sebagian tak dibaca) |
| Audit log | `hq/audit`, `dashboard/audit`, `hr/audit` | Kantor pusat, Admin, HR | Bab 9; Bab 10 | TS-SEC | Partial (sejak PR #664 filter aksi/tanggal/hasil dan ekspor mengikuti filter; "append-only" vs retensi) |
| Undang/nonaktifkan/hapus staf & peran | `hq/staff`, `auth-service`, `RESTRICTED_GRANTS` | Admin, Kantor pusat | Bab 10; Bab 11 F12 | TS-SEC | Partial (sejak PR #664 `/dashboard/staff` memakai form undang HQ; Head office hanya 5 peran dan tak bisa membuat Head office; tolak nonaktifkan diri/Super admin terakhir; ubah peran lewat undang ulang [B]; pemulihan Super admin tunggal [K]) |
| Matriks hak akses | `hq/access`, `packages/access` | Admin | Bab 10; dok. 12 | TS-SEC | Complete |
| Platform: flag, API key, webhook, retensi, keamanan | `hq/flags`, `api-keys`, `webhooks`, `retention`, `security` | Admin | Bab 10 | TS-SEC | Partial (tanpa 2FA; flag "Belum ditegakkan" tak ditelusuri) |
| Notifikasi (inbox, push, SMS OTP) | `crm-service`, `admin-service`, adapter | Semua | Bab 1; dok. 13 | TS-JOB | Partial (WhatsApp sudah dihapus; sejak PR #664 sisa env dan teks "pesan sebelum 16.00" dihapus; sisa teks UI lain [B]) |
| Pekerjaan terjadwal | `scripts/scheduler/crontab` | Sistem | Bab 11 F22 | TS-JOB | Complete |
| Kampanye, promo & aturan promo | `dashboard/campaigns`, `promotions`, `promo-rules` | Marketing, Kepala depot, Manajer | Bab 3; Bab 9 | TS-LOY | Partial (sejak PR #664 tombol tulis tab Promo hanya untuk pemegang `promotionWrite`) |
| Peran Marketing (MARKETING) | `packages/access` | Marketing | Bab 1; dok. 12 | — | Partial (dicakup di matriks; tanpa bab sendiri; layar /hq tak terjangkau) |
| Peran Finance (FINANCE) | `packages/access`, `hq-nav.ts` | Finance | Bab 9; dok. 12 | TS-REF, TS-WDR | Blocked (perlu verifikasi di lingkungan nyata; galat izin Finance terbukti 2026-10-14 pada `main`; empat kapabilitas baca baru di cabang `fix/uat-g128-g149-g152` (609a497, 110 kapabilitas), belum di `main`, belum diuji ulang, jadi tetap Blocked sampai diuji ulang; G-086) |
| Peran Direktur & Manajer | `packages/access` | Direktur, Manajer | Bab 5 Lamp. A; Bab 9 | TS-APR | Partial |
| Aplikasi mobile Manajer `/m/manager` | `app/m/manager/*` | Manajer | Bab 5 Lamp. A | — | Not Verified (rilis aplikasi Ops tidak pasti) |
| Pencarian depot `/dashboard/search` | `app/dashboard/search` | Beberapa peran | — | — | Not Verified (isi belum dibaca) |
| Responsif desktop/tablet/mobile | `apps/web` (uji 320 px di CI) | Semua | Bab 1 | — | Blocked (belum diperiksa visual) |
| Screenshot semua prosedur | `assets/screenshots/` (124 gambar: 74 lama + 50 `-p664`); inventaris SS di tiap bab | Semua | tiap bab | — | Partial (74 gambar diambil sebelum PR #664 sehingga sebagian kini berbeda: label status, tab Pembayaran, checkout, payout; 50 gambar baru diambil 2026-10-14 dari stack uji lokal pasca-#664 dan dipasang di bawah gambar lama atau pada slot placeholder; Finance/Marketing/Manajer/Direktur sudah difoto, termasuk galat izin Finance; ± 63 slot masih placeholder: dialog, item approval PENDING/HELD, kartu "Pencairan diproses", dan lainnya) |
| Dukungan & eskalasi | `docs/GO_LIVE.md`, `docs/RUNBOOK_ONCALL.md` | Semua | Bab 1; dok. 14 | — | Partial (tidak ada kanal dukungan staf/pelanggan terdokumentasi [K]) |

## Ringkasan

Dari 51 baris modul/kebutuhan: **Complete 10 · Partial 35 · Blocked 4 · Not Verified 2**. Tidak ada baris Not Applicable. Baris Partial dan Blocked menjadi daftar kerja verifikasi berikutnya; rincian tiap celah ada di dokumen 17.

*Hitung ulang 2026-10-14 (pasca PR #664):* dihitung dengan skrip dari baris data tabel Matriks saja (legenda dan tabel lain dikecualikan): 51 baris, **Complete 10 · Partial 35 · Blocked 4 · Not Verified 2** (tanpa Not Applicable). Angka sama dengan sebelumnya karena perbaikan PR #664 menghapus sebagian butir [B]/[D] tetapi tiap baris Partial masih punya butir terbuka lain ([K] keputusan bisnis atau [D]/[B] yang tersisa), dan tidak ada baris Blocked/Not Verified yang berubah. Dasar: pembacaan kode, bukan uji peramban.

*Hitung ulang v0.3 (2026-10-14):* dihitung dengan skrip dari baris data tabel Matriks: 51 baris, **Complete 10 · Partial 35 · Blocked 4 · Not Verified 2**, tidak berubah. Baris "Hapus akun & permintaan data PDP" dan "Pembatalan & refund" hanya diperbarui teks catatannya (perbaikan G-149..G-152 ada di cabang `fix/uat-g128-g149-g152`, belum di `main`, belum diuji ulang; G-153 perlu konfirmasi; refund: pemohon dicatat, penegakan belum); keduanya tetap Partial.

*Hitung ulang v0.4 (2026-10-14):* dihitung dengan skrip dari baris data tabel Matriks: 51 baris, **Complete 10 · Partial 35 · Blocked 4 · Not Verified 2**, tidak berubah. Baris "Peran Finance (FINANCE)", "Antrean refund HQ & rekonsiliasi", dan "Payout & komisi waralaba" hanya diperbarui teks catatannya sehubungan commit 609a497 pada cabang `fix/uat-g128-g149-g152` (empat kapabilitas baca untuk Finance; kartu "Pencairan diproses" tidak lagi terbuang); cabang itu belum di `main` dan belum diuji ulang, sehingga dua baris Blocked tetap Blocked dan baris Partial tetap Partial.

*Koreksi 2026-10-11:* versi awal ringkasan ini menyebut 55 baris (11/36/5/3) karena ikut menghitung baris legenda status di bagian atas dokumen. Angka di atas dihitung ulang dari tabel itu sendiri.
