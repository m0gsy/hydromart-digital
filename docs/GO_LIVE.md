# Hari peluncuran — dari "kode jalan" ke "pelanggan asli boleh masuk"

Kode yang benar belum berarti bisnis yang siap: depot tanpa rekening menjual tunai-saja tanpa
memberi tahu siapa pun, depot waralaba tanpa skema komisi membukukan bagian HQ 0% dan bukunya
tetap seimbang, dan data uji di tabel pesanan tinggal sepuluh tahun (kelas FINANCIAL tidak pernah
dipurge). Dokumen ini urutan kerjanya. Baca sekali sekarang; jalankan pada hari yang sepi.

---

## 1. Tanya datanya, bukan kodenya

Tanpa SSH: GitHub → **Actions → Registry pull check → Run workflow**, `mode = golive`.
(Atau di kotak: `bash scripts/go-live-report.sh`.) Baca-saja, tak menulis apa pun.

Baris `!!` menghentikan peluncuran atau menghilangkan uang tanpa suara. Baris `..` hanya informasi.
Ulangi sampai tak ada `!!` — atau sampai setiap yang tersisa adalah keputusan yang sengaja Anda terima.

| Baris `!!`                                                                      | Di mana memperbaikinya                                                                                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| depot **tanpa tujuan pembayaran**                                               | `/dashboard/payments` (sebagai MANAGER atau SUPER_ADMIN): unggah QRIS dan isi bank + nomor rekening + **nama pemilik** (ketiganya untuk transfer) |
| depot **tanpa jam buka**                                                        | `/hq/depots` → depot → jam operasional. Tanpa itu "antar sekarang" hilang diam-diam                                                               |
| waralaba **tanpa pemilik** / **tanpa skema komisi**                             | `/hq/franchise` (pemilik) dan `/dashboard/commission` (skema komisi depot itu) — tanpa skema, bagian HQ dibukukan 0%                              |
| depot **tanpa orang di HR** / tanpa KEPALA_DEPOT atau STAFF_DEPOT               | `/hq/staff` atau `/hr/employees`; pastikan tiap orang punya akun login                                                                            |
| **tak ada** yang memegang HEAD_OFFICE / FINANCE / HR, atau **satu** SUPER_ADMIN | buat akun kedua di `/hq/staff`; satu SUPER_ADMIN berarti kehilangan satu telepon = tak ada yang bisa mereset apa pun                              |
| produk **tanpa stok** di depot                                                  | opname di `/dashboard/inventory`                                                                                                                  |
| diskon membership **tersimpan 0**                                               | bagian 2                                                                                                                                          |
| `pointExpirySweepEnabled` bukan 1                                               | bagian 2                                                                                                                                          |

## 2. Dua keputusan yang sudah diambil (2026-09-25)

Diskon membership dan poin hangus **berlaku sesuai desain**. Nilainya ada di data, bukan di kode,
jadi Anda yang menyetelnya — sebagai SUPER_ADMIN di **`/dashboard/settings`**, ruang lingkup **GLOBAL**:

1. `silverDiscountPct`, `goldDiscountPct`, `platinumDiscountPct` — tekan **Reset** pada masing-masing
   (baris yang tersimpan 0 dihapus dan default kode 2 / 5 / 8% berlaku), atau ketik angkanya.
2. **Periksa juga ruang lingkup DEPOT**: produksi menyimpan 0 di GLOBAL _dan_ di sebuah depot, dan
   angka depot mengalahkan yang global. Pilih tiap depot nyata di pengalih depot dan Reset di sana.
3. `pointExpirySweepEnabled = 1` dan `pointExpiryMonths = 12`. Sapuan dikirim mati agar tidak
   menghanguskan seluruh lot lama pada hari deploy; produksi baru berumur beberapa bulan, jadi
   menyalakannya sekarang tidak menghanguskan apa pun yang nyata.

Setelah itu `go-live-report` tak lagi menandai keduanya, dan `check-launch-blockers` (L2.4) berhenti BLOCKED.

## 3. Data uji: simpan atau bersihkan — putuskan sekali, sebelum pesanan asli pertama

`go-live-report` menampilkan jumlah baris yang sudah ada. Kalau semuanya uji, bersihkan:

Tanpa SSH: **Actions → Deploy → Run workflow → mode `reset-test-data`**. Kolom `confirm` kosong = dry run
(menghitung, menyebut berapa pelanggan berbeda yang memesan, tak menulis apa pun); isi `RESET-TEST-DATA`
= sungguhan. Di kotak, hasilnya sama:

```bash
bash scripts/reset-test-data.sh                                     # dry run: hanya menghitung
CONFIRM=RESET-TEST-DATA bash scripts/reset-test-data.sh --execute   # sungguhan
```

Yang dibersihkan: siklus pesanan (pesanan, item, riwayat, ulasan, outbox, keranjang, langganan),
pembayaran, pengiriman dan bukti-nya, poin + saldo poin, notifikasi, reservasi stok, dan tabel
turunan forecast/rekomendasi. `--with-ledgers` menambah ledger payout/kurir. **Tidak disentuh:**
akun, depot, katalog, karyawan/payroll, voucher, setelan, jejak audit, **jumlah stok**, dan berkas
di object storage (foto bukti kedaluwarsa sendiri lewat lifecycle).

Pengamannya, berurutan: dry run adalah default; `--execute` butuh `CONFIRM`; menolak bila ada pesanan
dalam 15 menit terakhir; **semua database dilatih (TRUNCATE lalu rollback) dulu — satu saja yang
gagal, tak ada yang berubah**; lalu dump database sendiri (gagal = berhenti); tiap database dibersihkan
dalam satu transaksi. Jalan mundurnya hanya satu: `scripts/restore-db.sh` dari dump itu.

**Sesudahnya, sebelum membuka:** hitung rak dan catat **opname** di tiap depot — jumlah stok sengaja
tidak dipulihkan, padahal penjualan uji sudah mengurangi unit yang nyata. Lalu jalankan `go-live-report`
lagi, dan buat **satu pesanan sungguhan dari ujung ke ujung** (pilih depot, bayar, antar, selesai).

## 4. Kontak hukum harus bisa menerima surat

Kebijakan privasi dan halaman hapus-akun mencantumkan **privacy@hydromart-digital.com**. Domain itu
tidak punya record MX (dicek 2026-09-25), jadi surat ke sana tidak sampai; Google Play juga meminta
jalur penghapusan tanpa aplikasi yang berfungsi. Perbaikan gratis: Cloudflare → domain →
**Email → Email Routing** → buat `privacy@` yang meneruskan ke kotak masuk Anda (Cloudflare menambahkan
MX dan SPF sendiri). Uji: kirim satu surat dari alamat lain, lalu balas.

## 5. Hari pertama — apa yang dilihat

- **Actions → Uptime**: hijau tiap 10 menit. Merah = produksi tak terjangkau dari luar; GitHub mengirim
  email. Tambahkan secret `ALERT_WEBHOOK_URL` bila ingin Discord ikut menerima.
- Discord (alert dari kotak): `NoOrdersCreated` menyala bila tak ada pesanan dua jam antara 11:00–20:00 WIB
  — pada hari pertama yang sepi itu wajar, jadi pastikan Anda tahu kapan depot memang tutup.
- `/hq/health`: setiap sapuan terjadwal harus bertanggal baru, tak ada `NEVER RUN`.
- Sesudah pesanan pertama selesai: buka `/hq/orders`, `/hq/payments`, dan rekonsiliasi depot; angkanya
  harus sama dengan yang dipegang kasir.

## 5b. DEMO-01 sesudah tinjauan Play lolos

Keputusan pemilik 2026-09-25: **nonaktifkan, jangan hapus**, begitu tinjauan Play selesai. Depot fixture ini
(Malang, jam buka 08:00–20:00 tiap hari, aktif dan publik) dipakai reviewer Play dan `seed-demo`.

1. Di `/hq/depots` → **DEMO-01** → tangguhkan depot (kebalikannya: aktifkan kembali). Itu hanya mengubah
   `active`; tak ada baris yang dihapus dan `seed-demo` tak perlu dijalankan ulang.
2. **Nyalakan lagi sebelum setiap rilis yang akan ditinjau ulang oleh Play.** Reviewer masuk dengan
   `REVIEWER_PHONE` dan kode tetap; tanpa depot aktif mereka melihat aplikasi kosong dan itu penolakan.
3. Smoke deploy (`scripts/smoke.sh`) memakai depot pertama di `/depots` sebagai titik ambil untuk uji
   redeem yang dibatalkan lagi. Selama DEMO-01 nonaktif, itu jatuh pada depot asli pertama — transien,
   tak meninggalkan apa pun, tetapi bisa tampil sebentar di antrean depot itu.
4. Jangan menonaktifkannya **sekarang**: aplikasi Play masih di pengujian internal, dan tinjauan
   berikutnya akan gagal.

## 6. Yang hanya bisa dijawab pemilik (tulis jawabannya di tempat yang aman, bukan di repo)

Siapa selain `VPS_SSH_KEY` milik CI yang punya SSH ke VPS · pemilik, 2FA, dan email pemulihan akun
penyedia VPS dan object storage (dan apakah NEO tetap dipakai setelah pindah VPS) · pemilik Play Console
dan cadangan keystore upload (`ANDROID_KEYSTORE_*` hanya ada di GitHub secrets) · pemilik akun
Cloudflare dan registrar domain · siapa di kanal Discord dan siapa yang menerima email Sentry · siapa
yang mengisi ulang saldo Zenziva (saldo habis = tak ada yang bisa login; `scripts/check-zenziva-balance.sh` memantaunya tiap 6 jam dan memberi tahu Discord di bawah `ZENZIVA_MIN_BALANCE`, default Rp250.000) ·
lokasi kunci privat `hydromart-env-private.pem` dan salinan keduanya · SOP depot dan staf baru tertulis
di luar repo · nasib DEMO-01 setelah tinjauan Play selesai · apakah repo memang sengaja publik.
