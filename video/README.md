# Video tutorial Hydromart Ops

Tiga video motion graphic vertikal (1080×1920, 30 fps) yang dibuat dengan
[Remotion](https://www.remotion.dev): dua untuk karyawan pengguna **Hydromart Ops**, satu untuk
pelanggan pengguna aplikasi **Hydromart**.

| Video        | Role           | Isi                                                                              | Berkas                          |
| ------------ | -------------- | -------------------------------------------------------------------------------- | ------------------------------- |
| Staff Depot  | `STAFF_DEPOT`  | masuk, daftar & absen wajah, shift, antar + COD + bukti, retur, gagal antar, setor, absen pulang | `out/tutorial-staff-depot.mp4`  |
| Kepala Depot | `KEPALA_DEPOT` | masuk & absen, Ringkasan, proses & tugaskan pesanan, live tracking, kasir, stok, meteran, verifikasi setoran, tutup buku | `out/tutorial-kepala-depot.mp4` |
| Pelanggan    | `CUSTOMER`     | daftar & OTP, Beranda, pilih produk, keranjang, checkout (alamat + titik lokasi, waktu antar, cara bayar, voucher), lacak, terima, nilai, pesan lagi, batal, langganan, poin, ajak teman, bantuan | `out/tutorial-pelanggan.mp4`    |

Layar aplikasi digambar ulang (bukan rekaman layar) dengan warna dan font aplikasi
(`apps/web/src/app/globals.css`, Plus Jakarta Sans). Setiap label tombol, status, dan toast diambil
dari kamus bahasa Indonesia aplikasi (`apps/web/src/lib/dictionaries/id/*`). Nama, nomor pesanan,
dan nominal adalah **data contoh**.

## Menjalankan

```bash
npm ci
npm run studio     # pratinjau & edit di browser
npm run render     # menulis kedua MP4 ke out/
```

Kalau Remotion tidak bisa mengunduh Chrome sendiri, arahkan ke Chrome/Chromium yang ada:
`REMOTION_BROWSER=/path/ke/chrome npm run render`.

`npm run stills -- <StaffDepot|KepalaDepot> <folder> <frame>...` merender frame tertentu sebagai PNG
untuk mengecek tata letak tanpa render penuh.

## Mengubah isi

- **Teks & durasi adegan:** `src/script.ts`, satu-satunya sumber. Video mengambil durasinya dari
  sini.
- **Naskah voice-over:** `NASKAH_VO.md` dibuat dari `script.ts` dengan `npm run naskah`. Perintah
  ini menolak adegan yang narasinya lebih cepat dari 2,4 kata/detik.
- **Layar:** `src/StaffDepot.tsx`, `src/KepalaDepot.tsx`, `src/Pelanggan.tsx`, dan layar bersama
  (masuk, absen wajah) di `src/shared.tsx`. Waktu animasi ditulis dalam frame relatif terhadap awal adegan (30 = 1 detik).

## Suara (voice-over)

Narasi dibuat dengan text-to-speech ElevenLabs, memakai suara **Arunika** ("National TV Voice Over",
logat Indonesia standar) dari Voice Library dan model `eleven_multilingual_v2`. Berkasnya ada di
`public/vo/staff-NN.mp3`, `public/vo/kepala-NN.mp3`, dan `public/vo/pelanggan-NN.mp3`, satu per adegan, dan sudah di-commit
supaya render tidak butuh API key. Tiap suara mulai 12 frame (0,4 detik) setelah adegannya
dimulai.

Setelah mengubah `vo` di `src/script.ts`, buat ulang suaranya:

```bash
XI_API_KEY=<key ElevenLabs> NODE_USE_ENV_PROXY=1 npm run vo
```

Hanya baris yang teksnya berubah yang dibuat ulang (`public/vo/manifest.json`), jadi kuota tidak
terpakai dua kali. Perintah ini gagal kalau ada suara yang lebih panjang dari adegannya, dan
menyebutkan `sec` minimal yang dibutuhkan. Untuk suara lain, isi `VO_VOICE=<voice_id>`.
`NODE_USE_ENV_PROXY=1` hanya diperlukan di balik proxy HTTPS.

Kalau ingin memakai rekaman sendiri, timpa berkas mp3 dengan nama yang sama, lalu render ulang.

## Yang sengaja tidak ada di video

- **QRIS di tempat pelanggan.** Kurir hanya menerima COD tunai. QRIS/transfer hanya ada di kasir
  depot.
- **Persetujuan cuti & kasbon oleh Kepala Depot.** Dengan matriks hak akses bawaan, `leaveApprove`
  dan `kasbonApprove` tidak dimiliki `KEPALA_DEPOT` (`packages/access/src/index.ts`). Kalau HQ
  mengubahnya di `/hq/access`, adegannya perlu ditambah.
- **Peta di aplikasi pelanggan.** Aplikasi pelanggan tidak punya peta: titik lokasi diambil lewat
  "Gunakan lokasi saya", dan pelacakan menampilkan nama kurir serta estimasi tiba, bukan peta live.
- **E-wallet & virtual account.** Kodenya ada, tapi tersembunyi selama payment gateway belum diatur.
  Video menampilkan COD, Transfer bank, dan QRIS (dua yang terakhir hanya bila depot mengaturnya).
- **Absen satu-foto untuk kurir** (flag `attendance.courier_one_tap`). Video menampilkan alur
  standar: absen HR dulu, lalu mulai shift.

## Lisensi Remotion

Remotion gratis untuk perorangan, organisasi nirlaba, dan perusahaan dengan maksimal 3 karyawan.
Perusahaan yang lebih besar memerlukan Company License. Ketentuan lengkapnya ada di
`node_modules/remotion/LICENSE.md` dan https://www.remotion.dev/docs/license.
