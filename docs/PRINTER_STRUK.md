# Printer struk (termal)

Untuk kasir dan admin depot. Dibuat untuk printer termal 58 mm seperti **VSC TM-58V**
(tipe RPP02N, Bluetooth); printer ESC/POS lain dengan Bluetooth, USB, atau LAN juga bisa.

## Di HP/tablet Android (aplikasi Hydromart Ops)

1. **Pasangkan dulu** printer di _Setelan HP → Bluetooth_ (nyalakan printer, pilih namanya,
   kode biasanya `0000` atau `1234`). Aplikasi tidak bisa memasangkan untuk Anda.
2. Buka **Kasir (walk-in) → Printer struk**.
3. Pilih lebar kertas **58 mm**.
4. Tekan **Cari printer**, izinkan Bluetooth, lalu **Pakai** pada printer Anda.
5. Tekan **Uji cetak**. Kalau keluar tulisan "Uji cetak berhasil", selesai. Pengaturan
   tersimpan di HP itu; tidak perlu diulang setiap hari.

Setelah itu tombol **Simpan & cetak struk** dan **Cetak ulang** langsung mencetak ke printer.

### Kalau struk tidak tercetak

Struk **tidak hilang**: aplikasi membagikannya sebagai file (WhatsApp, Drive, aplikasi
printer) dan menampilkan alasannya.

| Pesan                          | Yang dilakukan                                                   |
| ------------------------------ | ---------------------------------------------------------------- |
| Bluetooth mati                 | Nyalakan Bluetooth HP                                            |
| Printer belum dipasangkan      | Ulangi langkah 1                                                 |
| Izin Bluetooth belum diberikan | _Setelan HP → Aplikasi → Hydromart Ops → Izin_                   |
| Printer tidak terjangkau       | Nyalakan printer, dekatkan, pastikan tidak tersambung ke HP lain |
| Kertas habis / penutup terbuka | Ganti kertas / tutup penutup lalu cetak ulang                    |

Printer Bluetooth hanya melayani **satu HP** pada satu waktu.

## Di komputer (browser)

Struk dicetak lewat dialog cetak browser ke printer yang terpasang di komputer.

1. Pasang driver printer di Windows seperti biasa.
2. Buka **Kasir (walk-in) → Printer struk** dan pilih **58 mm**. Tanpa ini struk dicetak
   selebar halaman A4 dan terpotong di kertas 58 mm.
3. Saat dialog cetak muncul, pilih printer termal dan matikan _Headers and footers_.

## Isi struk

Nama depot dan kota, **nomor telepon depot** (jika sudah diisi di data depot), kasir dan
shift (dari kasir), nomor pesanan, tanggal, penerima, daftar barang, subtotal, ongkir,
diskon, total, metode bayar, tunai dan kembalian, serta ucapan terima kasih. Tidak ada
baris pajak (struk non-PPN).

Nomor telepon depot diisi di **Dashboard → Depot** (kolom nomor WhatsApp depot). Kalau kosong, baris
telepon tidak dicetak.
