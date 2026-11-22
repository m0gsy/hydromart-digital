# Video tutorial Hydromart Ops

Dua video motion graphic vertikal (1080×1920, 30 fps) yang dibuat dengan
[Remotion](https://www.remotion.dev) untuk karyawan pengguna aplikasi **Hydromart Ops**:

| Video        | Role           | Isi                                                                              | Berkas                          |
| ------------ | -------------- | -------------------------------------------------------------------------------- | ------------------------------- |
| Staff Depot  | `STAFF_DEPOT`  | masuk, daftar & absen wajah, shift, antar + COD + bukti, retur, gagal antar, setor, absen pulang | `out/tutorial-staff-depot.mp4`  |
| Kepala Depot | `KEPALA_DEPOT` | masuk & absen, Ringkasan, proses & tugaskan pesanan, live tracking, kasir, stok, meteran, verifikasi setoran, tutup buku | `out/tutorial-kepala-depot.mp4` |

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
- **Layar:** `src/StaffDepot.tsx`, `src/KepalaDepot.tsx`, dan layar bersama (masuk, absen wajah)
  di `src/shared.tsx`. Waktu animasi ditulis dalam frame relatif terhadap awal adegan (30 = 1 detik).

## Menambahkan suara

Rekam satu berkas per adegan sesuai `NASKAH_VO.md`, simpan sebagai `public/vo/staff-01.mp3`,
`public/vo/staff-02.mp3`, … dan `public/vo/kepala-01.mp3`, …, lalu render ulang. Adegan yang
berkasnya belum ada tetap diputar tanpa suara.

## Yang sengaja tidak ada di video

- **QRIS di tempat pelanggan.** Kurir hanya menerima COD tunai. QRIS/transfer hanya ada di kasir
  depot.
- **Persetujuan cuti & kasbon oleh Kepala Depot.** Dengan matriks hak akses bawaan, `leaveApprove`
  dan `kasbonApprove` tidak dimiliki `KEPALA_DEPOT` (`packages/access/src/index.ts`). Kalau HQ
  mengubahnya di `/hq/access`, adegannya perlu ditambah.
- **Absen satu-foto untuk kurir** (flag `attendance.courier_one_tap`). Video menampilkan alur
  standar: absen HR dulu, lalu mulai shift.

## Lisensi Remotion

Remotion gratis untuk perorangan, organisasi nirlaba, dan perusahaan dengan maksimal 3 karyawan.
Perusahaan yang lebih besar memerlukan Company License. Ketentuan lengkapnya ada di
`node_modules/remotion/LICENSE.md` dan https://www.remotion.dev/docs/license.
