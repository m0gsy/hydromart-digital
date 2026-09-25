# Brief untuk akuntan / konsultan pajak — dua hal yang menunggu tanda tangan

Dokumen ini untuk **orang di luar tim** yang akan menjawab dua pertanyaan yang belum dimiliki siapa pun
([LEGAL_OPEN_ITEMS.md](LEGAL_OPEN_ITEMS.md) §1–2). Semua angka di bawah dibaca dari kode dan konfigurasi
per 2026-09-25; tak satu pun adalah pendapat hukum. Bila jawaban Anda berbeda dari yang tertulis, **yang
kami butuhkan adalah angka atau kalimat pengganti dan tanggal berlakunya**.

## Sistemnya, dalam tiga kalimat

Hydromart menjalankan depot air isi ulang (galon) di Indonesia: pelanggan memesan lewat aplikasi, kurir
mengantar, depot menagih **tunai atau transfer langsung ke rekening/QRIS depot** (tidak ada gateway
pembayaran; uang tidak melewati rekening perusahaan). Depot ada dua jenis: **HKP** (dikelola sendiri) dan
**waralaba** (dimiliki pihak lain; HQ membukukan bagiannya sebagai persentase penjualan). Modul HR
menghitung gaji, BPJS, dan PPh 21 karyawan depot dan kantor pusat. Per hari ini produksi masih
pra-peluncuran: 3 depot aktif (satu fixture), 1 pesanan dalam 30 hari, nol omzet nyata.

## 1. PPN — apakah harus ada, dan di mana

**Yang dilakukan sistem hari ini:** semua harga diperlakukan **non-PPN**. Tidak ada baris pajak di quote,
struk konter, laporan, maupun ekspor; tidak ada nomor seri faktur, NPWP pembeli, atau e-Faktur. Ini
keputusan sadar (K3.4) yang **hanya benar bila depot memang bukan PKP**.

Pertanyaan:

1. Apakah **penyerahan air minum isi ulang** ke konsumen akhir termasuk Barang Kena Pajak, atau dikecualikan?
   Kalau kena, apakah ambang pengusaha kecil (omzet setahun) dihitung **per depot** atau **per badan usaha**?
2. Siapa PKP-nya untuk depot **waralaba**: depot (pemiliknya) atau HQ? Penjualan ke pelanggan dibukukan di
   depot; HQ hanya menerima bagian persentase.
3. **Bagian HQ dari penjualan waralaba** (`platformFeePct`) — apakah itu imbalan jasa/royalti yang kena PPN
   dan PPh 23? Kalau ya, kapan faktur dan bukti potongnya terbit, dan oleh siapa?
4. Kalau ada yang harus PKP: struk konter menjadi faktur pajak sederhana, dan itu mengubah struk, transaksi
   konter, dan setiap laporan penjualan. **Kami tidak akan menambah baris PPN sebelum pertanyaan 1–2
   dijawab** — harga yang menampilkan pajak yang tidak dipungut adalah masalah yang berbeda.

## 2. PPh 21 dan BPJS — angka yang dipakai payroll

Semua angka di bawah adalah **pengaturan yang bisa Anda koreksi tanpa deploy**
(`/dashboard/settings` di modul HR); sumber hukum tertulis di sebelah tiap angka di
`services/hr-service/src/config/setting-defs.ts`.

| Yang dihitung                      | Nilai sekarang                                                                              | Yang perlu dipastikan                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabel TER PPh 21 (PMK 168/2023)    | **Kosong secara default**; berlaku hanya bila seseorang menempelkannya di Pengaturan        | Tabel A/B/C (44/40/41 baris) sudah ditranskripsi di `hr-service/reference/pph21-ter-pmk-168-2023.json`. **Benarkah, baris demi baris?**       |
| Metode bulanan                     | TER bila tabelnya dimuat; bila kosong, estimasi progresif disetahunkan                      | Setelah tabel dimuat: bulan Januari–November TER, **Desember rekonsiliasi tahunan** (sudah dikodekan) — benarkah urutannya?                   |
| Kategori TER dari PTKP             | A: TK0/TK1/K0 · B: TK2/TK3/K1/K2 · C: K3                                                    | Sesuai lampiran PMK?                                                                                                                          |
| PTKP tahunan                       | TK0 54 jt · TK1 58,5 jt · TK2 63 jt · TK3 67,5 jt · K0…K3 +4,5 jt/tanggungan (PMK 101/2016) | Masih berlaku pada 2026?                                                                                                                      |
| Tarif progresif Pasal 17           | 5% ≤60 jt · 15% ≤250 jt · 25% ≤500 jt · 30% ≤5 M · 35% (UU HPP)                             | Masih berlaku?                                                                                                                                |
| Biaya jabatan                      | 5% dari bruto, maksimum Rp500.000/bulan                                                     | Masih berlaku?                                                                                                                                |
| Karyawan tanpa NPWP                | +20% dari PPh 21                                                                            | Masih berlaku, dan bagaimana bila NIK dipakai sebagai NPWP?                                                                                   |
| BPJS Kesehatan (potongan karyawan) | 1% dari upah, batas upah Rp12.000.000                                                       | Angka berlaku?                                                                                                                                |
| BPJS JHT (potongan karyawan)       | 2%, tanpa batas upah                                                                        | Angka berlaku?                                                                                                                                |
| BPJS JP (potongan karyawan)        | 1%, batas upah **Rp10.547.400**                                                             | Angka ini kami duga periode Maret 2025–Februari 2026; BPJS menerbitkan batas baru tiap Maret. **Berapa batas yang berlaku sejak Maret 2026?** |

Pertanyaan tambahan:

1. Sistem hanya menghitung **sisi karyawan** BPJS. Bagian **pemberi kerja** (JKK, JKM, dan porsi yang lebih
   besar dari Kesehatan, JHT, JP) **tidak dimodelkan**: itu biaya perusahaan yang tak menyentuh gaji bersih.
   Apakah itu cukup, atau laporan biaya SDM perlu memuatnya? Dan kelompok risiko JKK mana yang berlaku?
2. **THR** dan bonus penjualan harian ada sebagai komponen gaji tersendiri. Bagaimana keduanya harus masuk
   ke bruto pada perhitungan TER bulan pembayarannya?
3. Sistem menerbitkan **slip gaji** dan menyimpan total PPh 21 setahun per karyawan (untuk 1721-A1), tetapi
   **tidak menerbitkan bukti potong 1721-A1 / e-Bupot**. Siapa yang menerbitkan dan melaporkannya, dan data
   apa yang Anda perlukan dari sistem untuk itu? (Kami bisa membuat ekspornya.)
4. Siapa yang menandatangani angka-angka ini, dan kapan ditinjau ulang? (Kami menyarankan tiap Maret,
   bersamaan dengan batas upah JP baru.)

## Yang kami kirimkan bersama brief ini

- `services/hr-service/reference/pph21-ter-pmk-168-2023.json` (tabel yang perlu Anda periksa)
- `services/hr-service/src/domain/statutory.ts` (rumus; komentarnya menjelaskan tiap langkah dalam bahasa biasa)
