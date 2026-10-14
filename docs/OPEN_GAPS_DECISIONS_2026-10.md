# Celah terbuka — status verifikasi dan keputusan yang dibutuhkan (2026-10)

Sumber: dokumen celah 148 butir (16/17), semuanya dari pembacaan kode. Tiap butir diverifikasi ulang
terhadap `main` (8c541431) sebelum disentuh. Hasilnya: banyak premis sudah tidak benar.

## 1. Sudah dikerjakan

| Butir | Perbaikan |
|---|---|
| b1 label status Inggris | `lib/order-status.ts` diterjemahkan (dipakai 6 halaman + struk) |
| b2 teks batal vs kode | Pasal 8 kini "sebelum kurir ditugaskan" (aturan kode tidak berubah) |
| b3 tab/tombol Kepala depot | tab Pembayaran disembunyikan; tombol Promo hanya untuk yang punya `promotionWrite`; judul gate "Akses terbatas" |
| b4 approval HELD hilang, Rp0 | daftar memuat PENDING + HELD; detail GALLON_VARIANCE dan `depositRefunded` dibaca |
| b5 komentar RBAC SPV | komentar dikoreksi (matriks tidak diubah) |
| b6 menu ditolak server | Komisi kurir / Tinjauan bulanan / Performa tim kini memakai kapabilitas yang ditegakkan server |
| b8 sisa voucher request | kapabilitas ditandai RETIRED di komentar (nama dipertahankan agar baris matriks tersimpan tetap valid) |
| b9a/b teks payout | "diajukan ke …, menunggu transfer"; "Persentase komisi HQ per depot" |
| b9c riwayat penarikan | daftar `recentWithdrawals` ditampilkan di halaman payout (data sudah ada di summary) |
| b10 pesan auth ke HR | alasan 4xx dari auth-service diteruskan (401 tetap dianggap gangguan) |
| b11 undang staf 400 | `/dashboard/staff` memakai form undang HQ yang sudah membawa field karyawan |
| e2 setoran COD DISPUTED | tombol verifikasi muncul untuk DISPUTED, catatan wajib |
| e4 halaman via URL (Kepala depot) | tab Meteran, Prakiraan, Aturan promo, Sengketa, CRM, Peran, Akun, sesuai kapabilitas |
| f1 sesi setelah nonaktif | semua refresh token dicabut saat login dimatikan (staf, HR, pelanggan) |
| f2 nonaktifkan diri / Super Admin terakhir | ditolak, dengan kunci transaksi yang sama seperti hapus |
| Keputusan pemilik 2026-10-14 (dibangun) | payroll: approve oleh pembuat slip ditolak (SUPER_ADMIN dikecualikan) + batal approval khusus SUPER_ADMIN dengan alasan; Head office baru hanya dibuat SUPER_ADMIN; penarikan minimum Rp50.000 (gratis, `MIN_WITHDRAWAL_IDR`); kasbon maks 1x gaji pokok, kedaluwarsa 3 hari kerja; teks "sebelum 16.00" dihapus; sisa konfigurasi WhatsApp di env/compose dihapus |
| f8 filter audit | `/auth/audit` menerima `from`/`to`/`success`; halaman HQ punya filter aksi, tanggal, hasil, dan ekspor memakai filter yang sama |
| b7 "Semua depot" | layar per-depot kini menampilkan pemberitahuan depot mana yang sedang ditampilkan; layar yang memang gabungan (pesanan, churn, aturan promo, impor) dikecualikan |

Premis yang ternyata salah: menu ops sudah memuat meteran/forecast/promo/sengketa/CRM/peran/akun (e4, e5);
tautan lacak tidak membocorkan PII dan token-nya 128-bit (f6); filter audit sudah ada (f8, sebagian);
saluran OTP console dijaga saat boot di produksi (f9).

## 2. Butuh keputusan pemilik (tidak dibangun)

### Uang / kontrol internal
1. **Pemisahan pemohon-penyetuju payroll.** Menolak `approve` oleh pembuat slip aman secara kode, tetapi
   memblokir meja HR satu orang. Apakah SUPER_ADMIN boleh jadi pengecualian?
2. **Pemisahan refund.** Perlu kolom `refundRequestedBy` + migrasi. Toko tanpa FINANCE kedua akan terblokir.
3. **Opname, void konter, beban selisih COD hanya satu orang.** `COD_VARIANCE` sudah ada di enum tetapi
   tidak pernah dibuat. Ambang nominal mana yang mewajibkan persetujuan manajer?
4. **Hapus akun dengan pesanan terbuka.** Tolak (fail-closed, permintaan PDP bisa macet melewati tenggat)
   atau izinkan (fail-open)?
5. **Batal approval payroll (APPROVED→DRAFT).** Boleh sampai kapan? Setelah PAID tidak.

### Fitur baru
6. Batal pesanan oleh staf sebelum kurir ditugaskan (hari ini hanya batal pengiriman).
7. Kepala depot melihat status approval yang ia ajukan (perlu filter `mine` + tab).
8. Wizard offboarding; pendaftaran waralaba dengan unggah dokumen + halaman status pemohon;
   persetujuan otomatis membuat akun/depot atau tetap manual?
9. Ekspor manual masuk Log ekspor (ekspor CSV klien perlu panggilan log sebelum unduh).
10. Peringatan permintaan PDP lewat batas waktu (sweep admin-service + badge).
12. Satu-satunya Super Admin: prosedur pemulihan (runbook/CLI) selain penjaga yang kini ada.

### Konfigurasi / bisnis (kelompok c)
13. Nilai produksi: minimum pesanan, ongkir, ekspres, slot, radius per depot; ambang refund/approval/klaim
    (bawaan Rp100.000 dan Rp500.000); batas diam sesi; upah kurir.
14. Cara dan waktu refund; kapan deposit galon dibayar/diterima; aturan "pesan sebelum 16.00".
15. Kebijakan beban selisih COD, tenggat setoran, tenggat tutup buku.
16. Lama proses, minimum, dan biaya penarikan; batas nominal kasbon dan batas waktu keputusan.
17. `DEPOT_ASSIGNMENT_ENABLED` di produksi (memori: flag OFF; mengubahnya butuh ENV_SET_BLOCK).
18. Apakah SPV memang boleh menulis buku kas, target, insiden, sengketa (kini ya; hanya komentar yang diperbaiki).
19. Apakah Head office boleh membuat sesama Head office.
20. Arti "Staff Depot" di HR; kanal dukungan pusat dan jam layanan; daftar peramban resmi.
21. WhatsApp: masih dikirim (CRM) atau sisa? Konfigurasi `.env` masih ada. Jawaban menentukan penghapusan.
22. Reviewer OTP (Play Console) sengaja melayani akun staf demo untuk review aplikasi Ops. Batas masa
    berlaku maksimum yang diinginkan? (Kini hanya wajib diisi, tanpa batas atas.)
24. Sesi: access token tetap hidup hingga 15 menit setelah nonaktif (tidak ada pengecekan status per
    request). Menutupnya butuh `tokenVersion` di jalur panas; terima 15 menit atau bangun?
    Penangguhan depot juga belum mencabut sesi stafnya.

### Perlu uji peramban (belum bisa dibuktikan dari kode)
25. Error satu halaman penuh di payout/komisi/rekonsiliasi/waralaba untuk Finance; tampilan error SPV;
    isi `/hr/me`; rumus skor kinerja; apakah pemindaian fraud dan rilis payout otomatis berjalan.

## 3. Keputusan pemilik yang dibangun kemudian (2026-10-14)

| Keputusan | Status |
|---|---|
| Beban selisih COD ke kurir butuh manajer | **Dibangun**: hanya MANAJER/SUPER_ADMIN yang bisa membebankan; kasir tetap bisa verifikasi tanpa beban. Diterapkan sebagai pemeriksaan kapabilitas (`approvals`), bukan antrean persetujuan asinkron: kurir yang menyetor, manajer yang memverifikasi = orang kedua |
| Hapus akun ditolak bila pesanan terbuka, Super Admin bisa paksa | **Dibangun**: order-service `internal/customer-open-count`, port + adapter di auth-service (fail-closed), `force` hanya SUPER_ADMIN (403 untuk yang lain), dialog paksa di `/hq/pdp`, audit mencatat jumlah pesanan |
| Deposit galon tampil di checkout | **Ditampilkan, belum ditagih**: baris "Deposit galon" dengan keterangan jelas. Lihat catatan di bawah |
| Refund: status dan janji 1-3 hari ke pelanggan | **Dibangun**: halaman detail pesanan menampilkan status refund dan janji 1-3 hari kerja dari data pembayaran yang sudah ada |
| Refund: "diajukan oleh X" di antrean HQ | **Setengah**: kolom `refundRequestedBy` + migrasi ditambahkan (aturan skema: kolom dikirim satu rilis sebelum kode yang membacanya). Kode yang mengisi dan menampilkannya ada di PR berikutnya, setelah migrasi ini ter-deploy |

### Catatan: deposit galon belum pernah ditagih
Keputusan pemilik "dibayar saat pesan" mengasumsikan deposit sudah ada di total. Kenyataannya deposit hanya **dicatat** di buku depot saat galon diantar (`rate × galon`); tidak masuk `order.total`, tidak masuk jumlah pembayaran, tidak masuk ekspektasi setoran COD. Menagihnya sungguhan menyentuh order-service, payment-service, delivery-service (setoran COD), refund, laporan, plus migrasi dan snapshot deposit per pesanan. Itu proyek tersendiri dan belum dibangun. Checkout kini hanya menampilkan estimasinya dengan label "belum termasuk dalam total yang dibayar".

### Masih menunggu pemilik
Nomor telepon dan jam layanan dukungan pusat; catatan MX `privacy@hydromart-digital.com`.
