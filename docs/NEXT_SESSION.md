# Prompt sesi berikutnya

Tempel bagian di dalam kotak ke sesi baru. Sisanya di bawah kotak adalah keadaan terukur
pada 2 September 2026 — dibaca oleh manusia, bukan bagian dari prompt.

---

```
Lanjutkan program audit konsol Hydromart sampai selesai.

Keadaan loop ada di `docs/CONSOLE_AUDIT_REGISTER.md`. Itu satu-satunya sumber
kebenaran: 248 baris TERBUKA, dan sembilan baris SAPUAN di dalamnya memayungi 115
item lagi plus 14 sweep — jadi pekerjaan sebenarnya lebih dekat ke 350, bukan 248.
Jangan percaya angka apa pun di dokumen lain sebelum kamu hitung ulang dari tabelnya.

MULAI DENGAN INI, sebelum menulis kode apa pun:

1. `gh pr list --state open`. PR #429 (FINANCE dapat pintu /hq, `hqConsole` dipecah
   jadi pintu + `hqBackOffice`) dan #431 (foto keranjang, lokasi native, panel yang
   membuka di luar layar) sedang berjalan saat sesi lalu berakhir. Kalau masih
   terbuka: pantau, perbaiki kalau merah, merge kalau hijau, dan tunggu deploy-nya
   sukses sebelum lanjut.
2. `git pull` lalu hitung ulang status register:
   `grep -c "| TERBUKA |" docs/CONSOLE_AUDIT_REGISTER.md`. Kalau tidak 248, PR di
   atas sudah masuk — sesuaikan rencanamu.
3. Baca ulang "Aturan yang mengikat" dan "Berhenti dan tanya" di register itu. Semua
   masih berlaku, termasuk yang ini: setiap PR meninggalkan minimal satu uji yang
   MERAH kalau perbaikannya dicabut, dan kamu buktikan itu dengan mencabutnya.

URUTAN KERJA, dari tabel "Urutan kerja" di register:

- Langkah 09 — 14 sweep terjadwal berjalan tanpa penonton (`CA-5-01`). Heartbeat-nya
  sudah ditulis `scripts/scheduler/sweep.sh` ke berkas yang tidak dibaca layar mana
  pun. Ini DUA PR: tabelnya satu rilis lebih dulu daripada kode yang membacanya.
- `CA-4-03`, satu-satunya Kritis yang tersisa: uang COD yang sudah dipungut hilang
  dari setoran begitu pengantaran ditandai Gagal atau Jadwal-ulang. Tertahan karena
  butuh STATUS pembayaran, sementara `OrderPaymentPort.forOrder()` hanya
  mengembalikan `{ method, amount }`. Perluas port-nya.
- Lalu 53 baris Tinggi, lalu sembilan SAPUAN, lalu Sedang/Rendah/Ringkas —
  dikelompokkan per kelas akar, satu PR per kelompok, seperti sembilan langkah
  sebelumnya.

Selesai = tidak ada lagi baris TERBUKA di register DAN semua PR-nya sudah terdeploy
ke produksi. Bukan "sudah di main".
```

---

## Keadaan terukur, 2 September 2026

### Yang sudah jalan di produksi

`main` = `ca938af0`. Produksi menjalankan `a20fbde5` — satu rilis di belakang, dan itu tidak
apa-apa: #430 hanya mengubah judul run deploy, tidak ada service yang dibangun ulang.

Sembilan langkah sapuan pertama sudah merged dan terdeploy:

| Langkah | Isi | PR |
| --- | --- | --- |
| 00 | Register + pass re-cek | #415 |
| 01 | Depot-scope pada route by-id | #416 |
| 02 | `PROCESSING` diberi jalan keluar | #417 |
| 03 | Klaim biaya, tutup shift, gerbang COD | #418 |
| 04 | Registry penghapusan PDP + teks /hapus-akun | #419 |
| 05 | Halaman HQ berhenti membaca proyeksi publik | #426 |
| 06 | ConfirmDialog ke aksi yang tidak bisa dibatalkan | #427 |
| 07 | Gerbang kapabilitas di rail dan halaman /hq | #428 |
| 08 | Skrip laporan baris rusak (BACA SAJA) | #423 |

### Yang masih terbuka

248 baris. Sembilan SAPUAN memayungi 115 item + 14 sweep di baliknya:

| Baris | Item | Isi |
| --- | --- | --- |
| `CA-2-69` | 28 | kartu menampilkan 0 selagi memuat; pencarian gagal melapor "tidak ada" |
| `CA-2-68` | 21 | teks Indonesia keras di 14+ berkas; 8 kontrol form tanpa nama |
| `CA-2-63` | 18 | rilis payout mencatat tujuan salah; faktur; periode |
| `CA-2-66` | 16 | pelanggan teratas hanya potongan UUID |
| `CA-2-65` | 14 | voucher HQ lahir tanpa kedaluwarsa, kuota, plafon |
| `CA-2-64` | 9 | opname bisa menurunkan stok di bawah yang sudah dipesan |
| `CA-2-61` | 6 | HQ di ponsel cuma 4 tab; 56 dari 60 rute tak terjangkau |
| `CA-2-67` | 3 | jejak audit untuk setelan uang, peran, kunci API |
| `CA-5-01` | 14 sweep | langkah 09 |

Per bagian: HR/payroll 80 · Pelanggan/PDP 66 · Konsol HQ+depot 59 · Kurir/manajer mobile 39.
Per tingkat: 1 Kritis · 53 Tinggi · 101 Sedang · 41 Rendah · 43 Ringkas · 9 SAPUAN.

### Yang hanya bisa pemilik kerjakan

1. **APK baru.** #431 mengganti sumber lokasi di dalam shell ke `@capacitor/geolocation`,
   karena `navigator.geolocation` di WebView Android memakai penyedia jaringan Chromium
   yang kerap tidak bisa menjawab sama sekali — dan binary pelanggan sengaja hanya
   mendeklarasikan `ACCESS_COARSE_LOCATION`. Verifikasinya di perangkat, bukan di CI.
2. **`scripts/report-damaged-rows.sh` belum pernah dijalankan.** Baris yang sudah terlanjur
   rusak di produksi belum pernah dihitung: penarikan saldo PROCESSING tanpa pembayar,
   depot tanpa tujuan pembayaran, klaim yang menyetujui dirinya sendiri, stok hadiah di
   bawah nol, langganan milik akun yang sudah dihapus. Skripnya BACA SAJA dan tidak punya
   mode tulis — itu keputusan pemilik, 1 September 2026.
3. **`DELIVERY_STORAGE_PUBLIC_BASE_URL`** di `.env` produksi. Tanpa itu auto-approve klaim
   biaya kurir mati — gagal-tertutup, dan itu disengaja: deployment yang belum menyebutkan
   di mana struk disimpan tidak bisa membedakan struk asli dari yang diketik.

### Gerbang yang dipasang program ini, dan apa yang dijaganya

| Skrip | Menjaga |
| --- | --- |
| `check-depot-scope.mjs` | route by-id tanpa penjaga depot tidak boleh bertambah |
| `check-console-gates.mjs` | tiap `cap` di rail /hq menyebut kapabilitas yang benar-benar diperiksa server |
| `check-report-damaged-rows.test.sh` | skrip laporan tidak bisa menulis |
| `deploy.yml` job `not-shipped` | CI merah di main tidak lagi meninggalkan commit yang diam-diam tak terkapal |
| `no-native-dialogs.test.ts` | `window.confirm/prompt/alert` tidak bisa kembali |
| `hq-page-gate.test.tsx` | mengetik URL layar yang tidak ditawarkan tetap ditolak |
