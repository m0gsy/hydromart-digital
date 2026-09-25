# Lubang legal yang diketahui — tanpa pemilik sampai ada namanya (N15 · L3)

Dokumen ini tidak menyelesaikan apa pun. Ia menuliskan pertanyaan yang selama ini tidak
dimiliki siapa pun, supaya diamnya berhenti terbaca sebagai "sudah beres". Tiga dari empat
di bawah butuh tanda tangan manusia yang berkualifikasi, bukan commit.

---

> Untuk diserahkan ke akuntan: [BRIEF_AKUNTAN.md](BRIEF_AKUNTAN.md) menuliskan pertanyaan §1 dan §2 beserta
> angka yang dipakai sistem hari ini, satu halaman, tanpa perlu membaca kode.

## 1. PPN dan faktur atas penjualan ritel — **PEMILIK: belum ada** (N15)

**Statusnya:** tidak dimiliki siapa pun. L3 hanya menyebut TER (PPh 21, payroll). K3.4
menutup struk tanpa identitas depot sebagai cacat UX — dan itu memang cacat UX — tapi
pertanyaan legalnya tidak tersentuh.

**Yang berlaku di kode hari ini** (fakta, bukan pendapat):

- Struk konter memuat nama depot, alamat, nama kasir, dan 8 karakter id shift (K3.4).
- Harga diperlakukan **non-PPN**: tidak ada baris pajak di mana pun, tidak di quote, tidak
  di struk, tidak di laporan. Ini keputusan yang diambil sadar-sadar pada K3.4, bukan
  kelalaian — dan keputusan itu **hanya benar selama depot memang bukan PKP**.
- Tidak ada nomor seri faktur, tidak ada NPWP pembeli, tidak ada e-Faktur.

**Yang harus dijawab seseorang:**

1. Apakah ada depot yang omzetnya melewati ambang wajib PKP? Kalau ya, sejak kapan?
2. Kalau ya: struk konter harus menjadi faktur pajak sederhana, dan itu mengubah
   `receipt.ts`, `walk-in`, dan setiap laporan penjualan sekaligus.
3. Siapa yang menandatangani jawabannya, dan kapan ia ditinjau ulang?

**Jangan** menambahkan baris PPN ke kode sebelum pertanyaan 1 dijawab: harga yang
menampilkan pajak yang tidak dipungut adalah masalah yang berbeda, bukan masalah yang lebih
kecil.

## 2. Tabel TER (PPh 21) — menunggu akuntan

Tabel PMK 168/2023 sudah ditranskripsi ke `hr-service/reference/` dan dipakai sebagai
**rujukan**, bukan default. Belum ada akuntan yang menandatanganinya. Sampai itu terjadi,
angka payroll yang keluar dari sini adalah hitungan yang masuk akal, bukan hitungan yang
dipertanggungjawabkan.

## 3. Bukti persetujuan UU PDP — belum pernah diuji pihak ketiga

Ledger consent, ekspor data, dan penghapusan sudah hidup (PDP tahap 1 dan 2), termasuk
aturan "belum pernah ditanya ≠ menolak". Yang belum pernah terjadi: seseorang di luar tim
ini memeriksa apakah bentuk buktinya cukup bila diminta.

## 4. Pemulihan bencana, kapasitas, dan uji keamanan yang dijalankan — L3

Bukan legal, tapi berdiri di rak yang sama: ditulis sebagai lubang yang diketahui, tanpa
item untuk direproduksi.

- **RPO/RTO**: RPO 24 jam dinyatakan di [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) (dump nightly, tanpa
  WAL). Drill restore mingguan berjalan dan terukur di produksi (21 Sep 2026: restore 14 detik, 16 database
  cocok dengan yang hidup). Salinan luar kotak sudah jalan (`BACKUP_OFFSITE_DEST`), tapi di **penyedia yang
  sama** dengan mesinnya (NEO); rebuild kotak baru penuh (env, image, objek) belum pernah diulang.
- **Kapasitas** — berapa depot, kurir, dan pesanan per jam sebelum sesuatu patah, dan yang
  mana patah duluan. Gerbang beban di CI mengukur regresi terhadap dirinya sendiri, bukan
  atap.
- **Uji keamanan yang dijalankan**, bukan pembacaan kode — termasuk rate limit di tepi pada
  beban nyata, bukan hitungan per-instance di memori.
- **Retensi dan penghapusan data di luar jalur bukti pengiriman.**

---

Setiap baris di atas yang mendapat pemilik dan tanggal harus keluar dari dokumen ini dan
masuk ke tempat yang mengikat — kontrak, kebijakan, atau kode. Dokumen yang isinya tetap
lengkap setelah setahun adalah dokumen yang tidak dibaca siapa pun.
