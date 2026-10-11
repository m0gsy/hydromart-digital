# Matriks Keterlacakan Dokumentasi

**Versi:** 0.1 (draf) · **Tanggal:** 2026-10-11 · **Klasifikasi:** Internal — Terbatas

Matriks ini menghubungkan setiap modul/kebutuhan dengan bukti sumber, peran, bagian panduan, skenario uji, dan status cakupan dokumentasi.

## Cara membaca status

| Status | Arti |
|---|---|
| Complete | Didokumentasikan langkah demi langkah dengan bukti kode, dan tidak ada celah terbuka yang mengubah cara pengguna bekerja. |
| Partial | Didokumentasikan, tetapi ada butir terbuka bertanda [D] (perlu uji browser), [K] (perlu konfirmasi bisnis), atau [B] (cacat/inkonsistensi) yang memengaruhi prosedur. |
| Blocked | Tidak dapat didokumentasikan penuh tanpa lingkungan nyata atau data produksi. |
| Not Verified | Ada di kode/menu, tetapi isinya belum dibaca atau belum dapat dipastikan. |
| Not Applicable | Tidak berlaku untuk peran/modul tersebut. |

**Peringatan:** semua "Complete" di sini berarti *terdokumentasi dari pembacaan kode*. Belum ada alur yang dijalankan di aplikasi oleh tim dokumentasi, dan kolom "Skenario uji" merujuk ke skenario di dokumen 15 yang seluruhnya berstatus Not Tested. Rujukan Bab mengacu pada nomor file panduan (Bab 2 = `02-customer-guide.md`, dst.). ID celah (G-xxx) merujuk ke dokumen 17.

## Matriks

| Kebutuhan / Modul | Bukti sumber | Peran | Bagian panduan | Skenario uji | Status |
|---|---|---|---|---|---|
| Masuk/keluar, OTP, sesi | `services/auth-service`, `apps/web/src/app/login`, `verify`; env OTP | Semua | Bab 1; Bab 2 | TS-AUTH, TS-SEC | Partial (OTP reviewer tetap & kanal console: dok. 17) |
| Pendaftaran & profil pelanggan | `apps/web/src/app/register`, `account`, `customer-service` | Pelanggan | Bab 2 | TS-AUTH | Complete |
| Alamat pelanggan | `app/addresses`, `customer-service` | Pelanggan | Bab 2 | TS-ORD | Complete |
| Katalog, keranjang, checkout | `app/products`, `cart`, `checkout`, `order-service` | Pelanggan | Bab 2 | TS-ORD | Partial (minimum order per depot [K]; teks UI vs kode) |
| Pembayaran & status pembayaran | `payment-service`, `app/orders/detail` | Pelanggan, Kepala depot, Kurir, Finance | Bab 2; Bab 3; Bab 4 | TS-PAY, TS-COD | Partial (gateway produksi tidak diketahui [K]; status berbahasa Inggris [B]) |
| Pelacakan & riwayat pesanan | `app/track`, `app/orders` | Pelanggan | Bab 2 | TS-ORD, TS-DEL | Partial (tidak ada peta waktu nyata [B]) |
| Pembatalan & refund | `order-service`, `payment-service`, `app/orders/detail` | Pelanggan, Kepala depot, Manajer, Finance | Bab 2; Bab 3; Bab 11 F02 | TS-REF | Partial (tanpa notifikasi refund; pemohon=penyetuju tidak diperiksa) |
| Ulasan & rating | `app/orders/detail/review`, `dashboard/ratings` | Pelanggan, Manajer | Bab 2 | TS-ORD | Complete |
| Langganan | `app/subscriptions`, `dashboard/subscriptions` | Pelanggan, Manajer | Bab 2; Bab 11 F08 | TS-SUB | Partial (lewati satu siklus dijanjikan T&K, tidak ada di kode [B]) |
| Voucher, poin, referral, hadiah | `promo-service`, `loyalty-service`, `referral-service` | Pelanggan, Kepala depot, Marketing | Bab 2; Bab 11 F09 | TS-LOY | Partial (kedaluwarsa poin mati bawaan) |
| Hapus akun & permintaan data PDP | `app/hapus-akun`, `auth-service`, `hq/pdp` | Pelanggan, Kantor pusat | Bab 2; Bab 9; Bab 11 F19 | TS-PDP | Partial (SLA dihitung dari pembuatan; tanpa notifikasi keputusan) |
| Antrean pesanan depot | `dashboard/orders`, `order-detail.tsx` | Kepala depot, SPV, Asisten SPV, Manajer | Bab 3; Bab 5; Bab 6 | TS-ORD, TS-STF | Partial (pembatalan otomatis berkala; status Inggris) |
| Penjualan kasir & shift kasir | `dashboard/walk-in`, `cashier-shift-bar.tsx` | Kepala depot, Manajer | Bab 3; Bab 11 F04 | TS-POS, TS-KAS | Complete |
| Tutup buku harian & buka kembali | `depot-service` dailyClose, `dashboard/reports` | Kepala depot, Manajer, Kantor pusat | Bab 3; Bab 9 | TS-KAS | Partial (buka kembali bulan oleh HO tampak tak terjangkau [D]) |
| Inventori & opname | `dashboard/inventory`, `depot-service` | Kepala depot, Manajer | Bab 3; Bab 11 F05 | TS-OPN | Partial (Kepala depot tak melihat antrean approval) |
| Retur galon & deposit | `dashboard/returns`, kurir `deliveries/detail/returns` | Kurir, Kepala depot | Bab 3; Bab 4; Bab 11 F03 | TS-GAL | Complete |
| Meteran air | `dashboard/meter` | Kurir*, Kepala depot, Manajer | Bab 3 | TS-OPN | Partial (tidak ada di tab Kepala depot; akses kurir tidak lewat /driver) |
| Tracking & dispatch | `dashboard/tracking`, `delivery-service` | Kepala depot, SPV, Asisten SPV, Manajer | Bab 3; Bab 5; Bab 6 | TS-DEL | Complete |
| Aplikasi kurir (shift, antar, bukti antar) | `app/driver/*`, `components/driver` | Staff depot (kurir) | Bab 4 | TS-STF, TS-DEL | Partial (antrean luring tak mencakup pickup/setoran/klaim/insiden) |
| Setoran COD | `dashboard/settlements`, `driver/settlement` | Kurir, Kepala depot, Manajer, Finance | Bab 3; Bab 4 | TS-COD | Partial (sengketa tak bisa diselesaikan dari UI) |
| Penghasilan, penarikan & klaim kurir | `driver/earnings`, `expenses`, `payout-service` | Kurir, Manajer, Finance | Bab 4; Bab 11 F20–F21 | TS-CLM, TS-WDR | Partial (nilai aturan penghasilan = data [K]) |
| Antrean approval Manajer | `dashboard/approvals` | Manajer | Bab 5 Lamp. A | TS-APR | Partial (nominal Rp0 untuk tipe tertentu [D]) |
| Pengadaan (PO, pemasok) | `dashboard/purchase-orders`, `suppliers` | Manajer | Bab 5 Lamp. A; Bab 11 F06 | TS-PO | Complete |
| Insiden & sengketa | `dashboard/incidents`, `disputes` | Kepala depot, SPV, Manajer, Kantor pusat | Bab 3; Bab 5; Bab 11 F07 | TS-INC | Partial (SPV bisa menulis, bertentangan dengan komentar RBAC [B]) |
| Pengawasan multi-depot & hierarki | `packages/platform` depot-scope, `hq/hierarchy` | SPV, Asisten SPV, Manajer, Admin | Bab 5; Bab 6; Bab 10 | TS-SEC | Partial ("Semua depot" jatuh ke depot pertama di sebagian halaman [B]) |
| Kasbon | `hr-service`, `hr/loans`, `hr/me/kasbon` | Karyawan, Asisten SPV, Manajer, HR | Bab 4; Bab 6; Bab 8; Bab 11 F16 | TS-ASG, TS-LEV | Partial (batas nominal & SLA tidak ada [K]; tanpa tautan menu) |
| Cuti dua tahap | `hr/leave`, `hr/me/leave` | Karyawan, Manajer, HR | Bab 4; Bab 8; Bab 11 F15 | TS-LEV | Partial (HO/Direktur tak bisa memutuskan di UI) |
| Absensi wajah | `hr/me/check-in`, `enroll`, `hr/attendance` | Karyawan, HR | Bab 4; Bab 8; Bab 11 F14 | TS-ATT | Partial (geofence mati bawaan; liveness sisi klien) |
| Karyawan & offboarding | `hr/employees`, `hr-service`, `auth-service` | HR, Admin | Bab 8; Bab 11 F13 | TS-HRM | Partial (token lama berlaku s.d. 15 mnt) |
| Penggajian | `hr/payroll`, `hr-service` | HR, Finance | Bab 8; Bab 11 F17 | TS-PRL | Partial (tanpa maker-checker; tabel TER PPh 21 kosong) |
| Penugasan/pinjam karyawan lintas depot | `hr/depot-requests`, flag `DEPOT_ASSIGNMENT_ENABLED` | Manajer, SPV, HR | Bab 5; Bab 8; Bab 11 F18 | TS-ASG | Blocked (status flag produksi tidak diketahui) |
| Pendaftaran & onboarding waralaba | `app/waralaba`, `hq/applications`, `Depot.ownerId` | Calon waralaba, Kantor pusat, Admin | Bab 7; Bab 9; Bab 11 F10 | TS-FRA | Partial (tanpa unggah dokumen/halaman status; akun & depot manual) |
| Payout & komisi waralaba | `dashboard/payout`, `payout-service`, `hq/payments` | Waralaba, Finance, Direktur | Bab 7; Bab 9 | TS-FRA, TS-WDR | Partial (tanpa riwayat penarikan di UI; label komisi ambigu [B]) |
| Keputusan harga depot | `hq/pricing`, `depot-service` | Manajer, Kantor pusat | Bab 9; Bab 11 F11 | TS-APR | Complete |
| Antrean refund HQ & rekonsiliasi | `hq/refunds`, `hq/reconciliation` | Finance, Kantor pusat | Bab 9 | TS-REF | Blocked (halaman Finance diduga error: perlu lingkungan nyata) |
| Laporan, ekspor & laporan terjadwal | `hq/reports/export`, `hq/exports`, `hq/scheduled-reports` | Kantor pusat, Direktur, Manajer | Bab 9 | TS-RPT | Partial (format ekspor sebagian tak dibaca) |
| Audit log | `hq/audit`, `dashboard/audit`, `hr/audit` | Kantor pusat, Admin, HR | Bab 9; Bab 10 | TS-SEC | Partial (tanpa filter; "append-only" vs retensi) |
| Undang/nonaktifkan/hapus staf & peran | `hq/staff`, `auth-service`, `RESTRICTED_GRANTS` | Admin, Kantor pusat | Bab 10; Bab 11 F12 | TS-SEC | Partial (`/dashboard/staff` kemungkinan gagal 400 [D]) |
| Matriks hak akses | `hq/access`, `packages/access` | Admin | Bab 10; dok. 12 | TS-SEC | Complete |
| Platform: flag, API key, webhook, retensi, keamanan | `hq/flags`, `api-keys`, `webhooks`, `retention`, `security` | Admin | Bab 10 | TS-SEC | Partial (tanpa 2FA; flag "Belum ditegakkan" tak ditelusuri) |
| Notifikasi (inbox, push, SMS OTP) | `crm-service`, `admin-service`, adapter | Semua | Bab 1; dok. 13 | TS-JOB | Partial (WhatsApp sudah dihapus tetapi sisa teks UI [B]) |
| Pekerjaan terjadwal | `scripts/scheduler/crontab` | Sistem | Bab 11 F22 | TS-JOB | Complete |
| Kampanye, promo & aturan promo | `dashboard/campaigns`, `promotions`, `promo-rules` | Marketing, Kepala depot, Manajer | Bab 3; Bab 9 | TS-LOY | Partial (tab Promo hanya baca) |
| Peran Marketing (MARKETING) | `packages/access` | Marketing | Bab 1; dok. 12 | — | Partial (dicakup di matriks; tanpa bab sendiri; layar /hq tak terjangkau) |
| Peran Finance (FINANCE) | `packages/access`, `hq-nav.ts` | Finance | Bab 9; dok. 12 | TS-REF, TS-WDR | Blocked (perlu verifikasi di lingkungan nyata) |
| Peran Direktur & Manajer | `packages/access` | Direktur, Manajer | Bab 5 Lamp. A; Bab 9 | TS-APR | Partial |
| Aplikasi mobile Manajer `/m/manager` | `app/m/manager/*` | Manajer | Bab 5 Lamp. A | — | Not Verified (rilis aplikasi Ops tidak pasti) |
| Pencarian depot `/dashboard/search` | `app/dashboard/search` | Beberapa peran | — | — | Not Verified (isi belum dibaca) |
| Responsif desktop/tablet/mobile | `apps/web` (uji 320 px di CI) | Semua | Bab 1 | — | Blocked (belum diperiksa visual) |
| Screenshot semua prosedur | `assets/screenshots/` (74 gambar); inventaris SS di tiap bab | Semua | tiap bab | — | Partial (74 gambar terpasang; ± 70 slot masih placeholder; Finance/Marketing/Manajer/Direktur belum difoto) |
| Dukungan & eskalasi | `docs/GO_LIVE.md`, `docs/RUNBOOK_ONCALL.md` | Semua | Bab 1; dok. 14 | — | Partial (tidak ada kanal dukungan staf/pelanggan terdokumentasi [K]) |

## Ringkasan

Dari 55 baris modul/kebutuhan: **Complete 11 · Partial 36 · Blocked 5 · Not Verified 3**. Tidak ada baris Not Applicable. Baris Partial dan Blocked menjadi daftar kerja verifikasi berikutnya; rincian tiap celah ada di dokumen 17.
