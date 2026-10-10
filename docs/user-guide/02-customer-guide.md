# Bab 2 — Panduan Pelanggan

| | |
|---|---|
| **Versi** | 0.1 (draf) |
| **Tanggal** | 2026-10-10 |
| **Klasifikasi** | Publik/Pelanggan |
| **Peran** | Pelanggan (kode: CUSTOMER) |
| **Bahasa** | Indonesia |

> **Catatan status.** Panduan ini disusun dari pembacaan kode dan dokumen. Belum ada pengujian yang dijalankan oleh penulis. Tag bukti: **[V]** terverifikasi di kode · **[D]** disimpulkan · **[K]** perlu konfirmasi bisnis (nilai berbeda per depot atau berasal dari pengaturan) · **[B]** diketahui bermasalah atau tidak konsisten.
> Fitur yang tidak ada ditulis "Tidak tersedia".

---

## 1. Gambaran Peran

Anda adalah pelanggan Hydromart. Lewat aplikasi atau situs, Anda bisa memesan galon dan air minum dari depot terdekat, membayar, melacak pesanan sampai tiba, dan mengumpulkan poin. Anda juga bisa membuat langganan isi ulang rutin.

Yang bisa dilakukan **tanpa masuk**: melihat beranda, menelusuri produk, membuka halaman promo dan bantuan, melacak pesanan lewat tautan khusus, dan membaca kebijakan. Yang **harus masuk**: keranjang, checkout, pesanan, poin, langganan, dan akun. Pembelian tanpa akun (tamu) Tidak tersedia. **[V]**

## 2. Tujuan dan Tanggung Jawab

| Anda dapat | Anda bertanggung jawab untuk |
|---|---|
| Memesan dan membayar | Mengisi alamat dan titik lokasi dengan benar |
| Membatalkan pesanan sebelum kurir ditugaskan | Menyiapkan galon kosong bila ada penukaran |
| Menilai pesanan | Menjaga kerahasiaan kode OTP |
| Mengelola alamat, langganan, dan data pribadi | Memastikan nomor telepon di akun masih aktif |

## 3. Prasyarat Akses

- Nomor seluler Indonesia yang aktif dan bisa menerima SMS. Contoh format: `081234567890`. **[V]**
- Browser modern atau aplikasi Android "Hydromart". Tidak ada daftar browser resmi (lihat Panduan Umum, bagian 5). **[K]**
- Tidak perlu kata sandi. **[V]**
- Untuk memesan: alamat yang berada di area layanan depot. Bila alamat di luar jangkauan semua depot, pesanan tidak bisa dibuat. **[V]**

## 4. Masuk dan Pengaturan Awal

### Prosedur: Mendaftar akun baru

**Tujuan:** Membuat akun Hydromart. **Peran:** Pelanggan (calon). **Prasyarat:** Nomor seluler aktif. **Titik awal:** Halaman `/register` (tautan "Daftar sekarang" di halaman masuk).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Isi **Nomor telepon** (wajib). Awalan +62 sudah ada; ketik misalnya `81234567890`. | Kolom menerima nomor Indonesia. Format `08…`, `62…`, `+62…` juga diterima. |
| 2 | Isi **Nama lengkap** (opsional, maksimal 120 huruf). | — |
| 3 | Isi **Email** (opsional, harus berformat email, maksimal 160 huruf, belum dipakai akun lain). | — |
| 4 | Isi **Kode referral** (opsional; tertulis "Punya kode teman?"). | — |
| 5 | Centang **"Saya menyetujui Kebijakan Privasi dan Ketentuan Layanan Hydromart."** (wajib). Tautan membuka kebijakan di lembar yang tampil di tempat. | Tombol **Kirim kode verifikasi** aktif hanya setelah dicentang. |
| 6 | Centang **"Saya bersedia menerima info promo dan penawaran (opsional)."** bila mau. Kotak ini tidak pernah tercentang otomatis. | — |
| 7 | Tekan **Kirim kode verifikasi**. | SMS berisi 6 digit kode dikirim. Layar pindah ke halaman verifikasi. |
| 8 | Ketik 6 digit kode. | Setelah digit ke-6, layar memverifikasi otomatis. Anda masuk dan akun aktif. |

Tautan **Lewati** di pojok kanan atas membawa Anda ke halaman berikutnya tanpa mendaftar (bawaan: daftar produk). **[V]**

**Cara mengenali sukses:** Anda diarahkan ke halaman tujuan atau toko, dan menerima pemberitahuan "Selamat datang di Hydromart". Kode referral yang diisi ditebus otomatis setelah verifikasi; bila gagal, tidak ada pesan. **[V]**

**Masalah umum:**

| Pesan di layar | Arti | Solusi |
|---|---|---|
| Nomor HP Indonesia tidak valid. Contoh: 081234567890. | Nomor bukan seluler Indonesia atau salah ketik | Perbaiki nomor |
| Email ini sudah dipakai akun lain. | Email terpakai nomor lain | Pakai email lain atau kosongkan |
| Kamu harus menyetujui Kebijakan Privasi untuk mendaftar. | Persetujuan belum dicentang | Centang kotak persetujuan |
| Tidak bisa memulai pendaftaran. | Gagal umum | Coba lagi nanti |
| Terlalu banyak permintaan kode. Tunggu sebentar, lalu minta kode lagi. | Terlalu sering meminta kode | Tunggu satu menit |
| Kode belum bisa dikirim sekarang. Coba lagi. | SMS gagal dikirim | Coba lagi sebentar |

Bila nomor sudah punya akun aktif, Anda dialihkan ke halaman masuk dengan nomor terisi. **[V]**

**Izin dan batasan:** Satu nomor satu akun. Persetujuan privasi wajib agar akun bisa dibuat. **[V]**

**Daftar periksa:**
- [ ] Nomor aktif dan bisa menerima SMS
- [ ] Persetujuan privasi dan ketentuan dicentang
- [ ] Kode dimasukkan dalam 5 menit

> **[SCREENSHOT REQUIRED: SS-customer-01 — Halaman `/register` lengkap: Nomor telepon, Nama lengkap, Email, Kode referral, dua kotak centang, tombol "Kirim kode verifikasi".]**
> *Gambar 4.1 — Formulir pendaftaran.*

### Prosedur: Masuk dengan kode OTP

**Tujuan:** Masuk ke akun yang sudah ada. **Peran:** Pelanggan. **Prasyarat:** Akun aktif. **Titik awal:** `/login`.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Isi **Nomor telepon** ("Nomor yang kamu daftarkan"). | — |
| 2 | Tekan **Kirim kode**. | Layar verifikasi muncul: "Verifikasi nomormu", "Masukkan kode yang kami kirim ke {nomor}." |
| 3 | Ketik 6 digit kode dari SMS. | Verifikasi otomatis. Tombol **Verifikasi & lanjut** juga tersedia. |
| 4 | Tunggu. | Anda masuk dan diarahkan ke halaman tujuan atau toko. |

Hitung mundur "Kode berlaku {m:ss} lagi." menunjukkan sisa waktu (awal 5:00). Setelah habis: "Kode kedaluwarsa. Minta kode baru." **[V]**

**Masalah umum:**

| Pesan di layar | Arti | Solusi |
|---|---|---|
| Kode verifikasi salah. | Kode keliru | Ketik ulang (maksimal 5 kali per kode) |
| Terlalu banyak percobaan. Minta kode baru. | 5 kali salah. Kotak terkunci | Tekan **Kirim ulang kode** |
| Kode verifikasi sudah kedaluwarsa. Minta kode baru. | Lewat 5 menit | Tekan **Kirim ulang kode** |
| Kode baru bisa diminta sebentar lagi. Cek SMS yang sudah masuk dulu. | Belum 60 detik sejak kode terakhir | Tunggu; tombol menampilkan "Kirim ulang dalam {n}d" |
| Akun ini tidak aktif. Hubungi dukungan Hydromart. | Akun ditangguhkan atau dihapus | Lihat bagian 8 (Bantuan) |

Bila Anda memasukkan nomor yang belum terdaftar di halaman masuk, sistem menjalankan pendaftaran dan menampilkan "Selesaikan pendaftaran." **[V]** Jika ingin mengisi nama dan email, mulai dari halaman daftar.

**Hasil akhir:** Anda masuk. **Catatan:** Tidak ada "lupa kata sandi" karena tidak ada kata sandi. **[V]**

> **[SCREENSHOT REQUIRED: SS-customer-02 — Halaman `/verify` dengan kotak kode dan hitung mundur.]**
> *Gambar 4.2 — Verifikasi kode.*

### Prosedur: Mengelola profil

**Tujuan:** Mengubah nama, email, foto, tanggal lahir. **Titik awal:** Akun (`/account`) → ubah profil (`/account/edit`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka **Akun** lalu ubah profil. | Formulir profil muncul. |
| 2 | Ubah **Nama** (maks. 120), **Email** (valid, maks. 160; dapat dikosongkan), **Foto** (maks. 5 MB), **Tanggal lahir** (opsional). | Teks bantu: "Opsional. Dipakai untuk hadiah ulang tahun; bisa dikosongkan kapan saja." |
| 3 | Simpan. | "Profil diperbarui." |

Kesalahan: "Gagal menyimpan profil." atau "Foto melebihi 5MB." **[V]** Hadiah ulang tahun dijanjikan teks di layar; belum ada kode yang diverifikasi untuk itu. **[D]**

### Prosedur: Mengganti nomor telepon

**Tujuan:** Memakai nomor baru untuk masuk. **Titik awal:** `/account/edit` → **Ganti nomor**.

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Baca peringatan: "Nomor ini yang dipakai untuk masuk. Menggantinya mengeluarkanmu dari semua perangkat." | — |
| 2 | Isi **Nomor HP baru**, tekan **Kirim kode**. | Kode dikirim ke nomor **baru**. |
| 3 | Isi **Kode verifikasi**, tekan **Konfirmasi ganti nomor**. | "Nomor berhasil diganti. Masuk lagi dengan nomor barumu." Semua perangkat keluar. |

Nomor lama menerima SMS pemberitahuan bahwa nomor akun berubah. **[V]**

| Pesan | Arti | Solusi |
|---|---|---|
| Isi nomor HP barunya dulu. | Kolom kosong | Isi nomor |
| Isi kode yang dikirim ke nomor barumu. | Kode kosong | Isi kode |
| Nomor itu sudah menjadi nomor akun ini. | Sama dengan nomor sekarang | Pakai nomor lain |
| Nomor ini sudah terdaftar. Silakan masuk. | Nomor dipakai akun lain | Pakai nomor lain |
| Tidak ada permintaan ganti nomor yang menunggu. Mulai lagi dari awal. | Permintaan tidak ada atau kedaluwarsa | Ulangi dari langkah 2 |
| Gagal mengirim kode ke nomor itu. / Gagal mengganti nomor. | Gagal umum | Coba lagi |

### Prosedur: Mengelola alamat

**Tujuan:** Menyimpan alamat antar. **Titik awal:** `/addresses` ("Tambah alamat").

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Tekan **Tambah alamat**. | Formulir muncul. |
| 2 | Isi **Label** (wajib, maks. 50), **Nama penerima** (wajib, maks. 120), **Nomor telepon** (wajib, maks. 20), **Alamat** (wajib, maks. 255), **Kota** (wajib, maks. 100). Opsional: Patokan/catatan (maks. 255), Provinsi, Kode pos (maks. 10). | — |
| 3 | Tekan **Gunakan lokasi saya** untuk mengisi titik peta (wajib). | Titik terisi. Tanpa titik: "Titik peta wajib diisi — tekan "Gunakan lokasi saya"." |
| 4 | Simpan. | Alamat tersimpan. Alamat pertama otomatis menjadi utama. |

Tindakan lain: **Ubah**, **Jadikan utama**, **Hapus** ("Hapus alamat?" / "Alamat "{label}" akan dihapus permanen."). Maksimal 20 alamat; lebih dari itu ditolak dengan pesan Inggris "You can save at most 20 addresses." (artinya: maksimal 20 alamat). **[V][B]** Bila alamat utama dihapus, alamat terbaru menjadi utama.

Kesalahan lain: "Gagal menyimpan alamat.", "Gagal memperbarui alamat. Coba lagi.", "Lengkapi semua kolom yang wajib diisi.", "Titik peta tidak valid: lintang harus antara -90 dan 90.", "… bujur harus antara -180 dan 180."

> **[SCREENSHOT REQUIRED: SS-customer-03 — Halaman `/addresses` dengan formulir alamat dan tombol "Gunakan lokasi saya".]**
> *Gambar 4.3 — Buku alamat.*

### Pengaturan awal lain

- **Lokasi pengiriman:** di header, buka pemilih lokasi ("Pilih lokasi pengiriman"). Pilih **Gunakan lokasi saya** atau **Atau pilih kota depot**. Ini menentukan depot yang ditampilkan. **[V]**
- **Notifikasi:** di Akun, atur **Notifikasi pesanan** ("Update status antar & kurir.") dan **Info promo & penawaran** ("Kabar diskon dari depotmu. Matikan kapan saja."). **[V]**
- **Bahasa dan tema:** pilih **Bahasa** (Indonesia atau Inggris) dan **Tema** (Terang, Gelap, Sistem). **[V]**
- **Tur perkenalan:** tiga slide tampil sekali ("Atur lokasi antar", "Pesan galon & air", "Lacak sampai depan pintu"); tekan **Lewati** atau **Lanjut** lalu **Mulai**. **[V]**

## 5. Menu dan Modul Tersedia

| Label | Rute | Bukti |
|---|---|---|
| Beranda | `/` | [V] |
| Belanja / Produk | `/products` | [V] |
| Detail produk | `/products/detail?id=…` | [V] |
| Keranjang | `/cart` | [V] |
| Checkout | `/checkout` | [V] |
| Pesanan | `/orders` | [V] |
| Detail pesanan | `/orders/detail?id=…` | [V] |
| Nilai pesanan | `/orders/detail/review?id=…` | [V] |
| Lacak Pesanan (publik) | `/track?token=…` | [V] |
| Notifikasi | `/notifications` | [V] |
| Favorit | `/favorites` | [V] |
| Promo | `/promo` | [V] |
| Voucher kamu | `/vouchers` | [V] |
| Ajak teman | `/referral` | [V] |
| Rewards (Tukar poin, Voucher, Riwayat) | `/rewards` | [V] |
| Langganan | `/subscriptions` | [V] |
| Akun | `/account` | [V] |
| Ubah profil | `/account/edit` | [V] |
| Alamat | `/addresses` | [V] |
| Bantuan | `/help` | [V] |
| Ajukan waralaba (publik) | `/waralaba` | [V] |
| Hapus akun (informasi publik) | `/hapus-akun` | [V] |
| Kebijakan privasi, Syarat & ketentuan | `/kebijakan-privasi`, `/syarat-ketentuan` | [V] |
| Status agen (hanya pelanggan agen) | `/agen` | [V] |

Bilah bawah ponsel: Beranda, Belanja, Pesanan, Akun. Bilah atas web: Belanja, Pesanan, keranjang, lonceng notifikasi, Akun. **[V]** Halaman `/resellers` adalah halaman petugas internal dan tidak untuk pelanggan.

## 6. Prosedur Langkah demi Langkah

### Prosedur: Menjelajah dan mencari produk

**Tujuan:** Menemukan galon atau air kemasan. **Prasyarat:** Tidak perlu masuk. **Titik awal:** **Belanja** (`/products`, judul "Pesan air").

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | (Disarankan) Atur lokasi lewat pemilih lokasi di header. | Subjudul menampilkan depot dan jaraknya: "diantar dari {depot} — {km} km". |
| 2 | Ketik di kolom **Cari produk…** atau pilih chip kategori ("Semua" atau kategori lain). | Daftar produk menyesuaikan. Tanpa hasil: "Tidak ada hasil untuk “{kata}”" dengan tombol **Bersihkan pencarian**. |
| 3 | Tekan **Muat lebih banyak** untuk produk berikutnya (12 per halaman). | Produk bertambah. |
| 4 | Tekan sebuah produk. | Halaman detail: harga, satuan, "Dikirim dari {depot}", status depot (Buka / Istirahat / Tutup), foto, dan "Sering dibeli bersama". |

Bila depot tutup: "Depot sedang tutup. Pesanan diproses saat depot buka lagi." Bila alamat di luar jangkauan: "Depot terdekat, {depot}, belum mengantar ke alamat ini ({km} km)." **[V]**

Harga di daftar bisa berupa perkiraan: "Harga perkiraan — harga depot dipakai saat pesanan dibuat". **[V]**

> **[SCREENSHOT REQUIRED: SS-customer-04 — Halaman `/products` dengan kolom pencarian, chip kategori, dan daftar produk.]**
> *Gambar 6.1 — Katalog produk.*

### Prosedur: Memasukkan ke keranjang

**Tujuan:** Mengumpulkan barang. **Prasyarat:** Sudah masuk. **Titik awal:** Detail produk.

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Pilih jumlah, lalu tekan **Tambah ke keranjang —**. | Bila belum masuk, Anda diminta masuk dulu; setelah masuk, barang ditambahkan otomatis. Tombol berubah menjadi "Ditambahkan" dan tersedia **Ke keranjang →**. |
| 2 | Buka **Keranjang**. | Daftar barang, ringkasan, Subtotal, dan "Estimasi total". |
| 3 | Ubah jumlah (1 sampai 999 per barang) atau hapus barang. | Total diperbarui. |
| 4 | (Opsional) Tambah barang dari "Sekalian, biar sekali antar". | Barang masuk keranjang. |
| 5 | Tekan **Checkout**. | Pindah ke `/checkout`. |

Hal yang perlu dipahami di keranjang:
- Promo otomatis tampil sebagai "Promo", "Diskon belanja", atau "Gratis {jumlah}× {nama}" (hadiah dikirim bersama pesanan jika stok tersedia). **[V]**
- "Diskon member ({persen}%)" otomatis sesuai tier. **[V]**
- "Ongkir dihitung saat checkout, setelah depot ditentukan." **[V]**
- Barang yang sudah tidak dijual dikeluarkan otomatis: "{nama} tidak lagi dijual dan sudah dikeluarkan dari keranjang." **[V]**
- **Kosongkan keranjang** meminta konfirmasi dan tidak bisa dibatalkan. **[V]**
- Keranjang kosong: "Keranjang masih kosong" dengan tombol **Mulai belanja**.

Kesalahan: "Gagal menambah ke keranjang." **[V]**

### Prosedur: Checkout (membuat pesanan)

**Tujuan:** Mengubah keranjang menjadi pesanan. **Peran:** Pelanggan. **Prasyarat:** Sudah masuk; keranjang berisi; alamat dengan titik lokasi atau depot yang dipilih. **Titik awal:** **Checkout** di keranjang (`/checkout`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Di **Alamat pengiriman**, pilih alamat tersimpan atau **+ Alamat baru**. Alamat baru: **Nama penerima**, **Telepon**, **Alamat** ("Jalan, nomor, RT/RW"), **Kota** (semuanya wajib), titik lokasi lewat **Gunakan lokasi saya**, dan opsional **Catatan untuk kurir**. Centang **Simpan alamat ini ke buku alamat** dan isi **Label alamat** bila mau. | Bila ada yang kurang: "Lengkapi alamat pengiriman dulu." |
| 2 | Bila alamat tidak punya titik peta, pilih **Pilih depot pengantar**. | Wajib bila tanpa titik: "Pilih depot dulu untuk melanjutkan." |
| 3 | Pilih **Waktu pengiriman**: **Antar sekarang** atau **Atau jadwalkan**. Antar sekarang menampilkan "Estimasi {min}–{maks} menit" dan biaya tambahan (bawaan Rp5.000, bisa berbeda per depot **[K]**). Jadwal: pilih tanggal (Hari ini, Besok, dan dua hari berikutnya) lalu jam; bawaan 09.00-11.00, 11.00-13.00, 13.00-15.00, 15.00-17.00, 17.00-19.00 (bisa berbeda per depot **[K]**). | Antar sekarang tidak tersedia saat depot tutup atau istirahat: "Depot sedang tutup — antar sekarang tidak tersedia. Pesanan terjadwal tetap bisa." |
| 4 | Pilih **Metode pembayaran** (lihat prosedur Pembayaran). | Metode yang tidak tersedia di depot diganti otomatis dengan pesan "Metode bayar diganti — periksa sebelum memesan." |
| 5 | (Opsional) Isi **Voucher** lalu **Terapkan**, atau pilih dari "Bisa dipakai sekarang". | Potongan harga tampil di ringkasan. |
| 6 | Periksa ringkasan: subtotal, diskon, ongkir, total. | "Harga diverifikasi ulang oleh depot saat pesanan dibuat — kamu tidak akan ditagih lebih." |
| 7 | Tekan **Buat pesanan — Rp…**. | Pesanan dibuat dan Anda dibawa ke rincian pesanan. |

**Cara mengenali sukses:** banner "Pesanan berhasil dibuat!" dan "Depot sedang menyiapkan pesananmu. Kami kabari saat kurir berangkat." Halaman juga menampilkan "Estimasi tiba ±30–45 menit". Itu teks tetap, bukan hitungan sistem. **[B]** Aplikasi bisa meminta izin notifikasi setelah pesanan pertama.

**Yang diperiksa sistem sebelum pesanan dibuat** **[V]**:
- Keranjang tidak kosong.
- Alamat berada dalam jangkauan depot (bawaan radius 5 km **[K]**).
- Harga dihitung ulang dari harga depot, bukan dari layar.
- Minimum pesanan depot dipenuhi (dihitung dari subtotal sebelum promo).
- Stok dicadangkan.
- Voucher sah, dan tidak dipakai bersama harga agen.

Ongkir = biaya antar depot × jumlah **galon**; barang selain galon tidak menambah ongkir. Biaya antar sekarang sudah masuk total saat pesanan dibuat, walaupun teks "Biaya antar sekarang ditambahkan saat depot mengonfirmasi." **[B]**

Tombol **Buat pesanan** nonaktif bila: depot harus dipilih, alamat di luar area, antar sekarang dipilih saat depot tutup/istirahat, atau di bawah minimum ("Minimum pesanan di depot ini Rp {min}. Kurang Rp {kurang} lagi."). Nilai minimum berbeda per depot. **[K]**

**Bila gagal:**

| Pesan di layar | Arti | Solusi |
|---|---|---|
| Titik alamat ini di luar radius antar semua depot kami. Pilih alamat lain, atau ubah titik petanya ke lokasi yang kami layani. | Di luar area layanan | Pilih alamat lain atau geser titik peta |
| Pilih depot dulu untuk melanjutkan. | Alamat tanpa titik peta | Pilih depot pengantar |
| Minimum pesanan di depot ini Rp {min}. Tambah barang lagi ya. | Di bawah minimum | Tambah barang |
| Keranjangmu kosong. Tambahkan produk sebelum checkout. | Keranjang kosong | Tambah produk |
| Katalog produk sedang sibuk. Tunggu sebentar, lalu coba lagi. | Katalog sibuk | Coba lagi |
| Depot pengantar belum bisa ditentukan, jadi harga dan ongkir di layar ini masih harga katalog. Coba muat ulang sebelum memesan. | Depot belum ditentukan | Tekan **Coba lagi** / muat ulang |
| Pesanan sudah dibuat, tapi pembayarannya belum bisa dimulai. Tekan lagi untuk mencoba — pesanan yang sama yang dipakai, bukan pesanan baru. | Pembayaran gagal dimulai | Tekan tombol lagi; tidak akan membuat pesanan ganda |
| Pesanan berhasil dibuat, tapi alamatnya tidak tersimpan ke buku alamat. | Alamat gagal disimpan | Tambahkan alamat dari menu Alamat |
| Tidak bisa membuat pesanan. | Gagal umum | Coba lagi |
| Diskon reseller berlaku otomatis. Voucher tidak bisa dipakai bersama harga reseller. | Pelanggan agen memakai voucher | Hapus voucher |
| Some items are out of stock at the fulfilling depot. (arti: sebagian barang habis di depot) | Stok kurang | Kurangi jumlah atau pilih barang lain |
| Insufficient stock at the fulfilling depot: {kode produk} (need {n}, have {m}). (arti: stok kurang; butuh n, tersedia m) | Stok kurang untuk produk itu | Kurangi jumlah ke angka "have" |
| This depot is not taking express deliveries right now. Please pick a time slot. (arti: depot tidak menerima antar sekarang; pilih jadwal) | Express tidak tersedia | Pilih **Atau jadwalkan** |
| That depot is not available right now. Please pick another one. (arti: depot tidak tersedia; pilih depot lain) | Depot nonaktif | Pilih depot lain |
| Could not confirm stock right now. Please try again. (arti: stok belum bisa dipastikan; coba lagi) | Pengecekan stok terganggu | Coba lagi |
| Product {id} is no longer available. (arti: produk tidak lagi tersedia) | Produk ditarik | Hapus dari keranjang |

Pesan Inggris di atas ditampilkan apa adanya dari server. **[B]** Tombol checkout mengirim satu kunci unik sehingga menekan dua kali tidak membuat dua pesanan. **[V]**

**Hasil akhir:** Pesanan berstatus "Dipesan"; keranjang kosong; pembayaran dimulai otomatis sesuai metode yang dipilih; depot menerima pesanan baru. **[V]**

**Izin dan batasan:** Harus masuk. Satu voucher per pesanan. Keterangan waktu jadwal tersimpan sebagai teks dan tanggalnya tidak disimpan oleh sistem; sebutkan kebutuhan penting lewat **Catatan untuk kurir** atau hubungi depot. **[B]**

**Daftar periksa:**
- [ ] Alamat dan titik lokasi benar
- [ ] Nama dan nomor penerima benar
- [ ] Waktu pengiriman dipilih
- [ ] Metode bayar sesuai
- [ ] Total diperiksa

> **[SCREENSHOT REQUIRED: SS-customer-05 — Halaman `/checkout` lengkap: Alamat pengiriman, Waktu pengiriman, Metode pembayaran, Voucher, tombol "Buat pesanan".]**
> *Gambar 6.2 — Checkout.*

> **[SCREENSHOT REQUIRED: SS-customer-06 — Banner "Pesanan berhasil dibuat!" di rincian pesanan.]**
> *Gambar 6.3 — Pesanan berhasil dibuat.*

### Prosedur: Memakai voucher dan poin

**Tujuan:** Mendapat potongan. **Titik awal:** **Voucher kamu** (`/vouchers`) atau kolom Voucher di checkout.

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Buka `/vouchers`. | Daftar voucher dengan status: Bisa dipakai, Sudah dipakai, Kedaluwarsa, Belum berlaku, Kuota habis. |
| 2 | Tekan **Salin** untuk menyalin kode, atau **Pakai**. | **Pakai** membuka checkout dengan kode terisi. |
| 3 | Di checkout tekan **Terapkan**. | Potongan tampil. |

Aturan voucher **[V]**: satu kode per pesanan; kode tidak peka huruf besar/kecil; dihitung dari subtotal setelah promo otomatis; bisa terbatas pada depot tertentu, produk tertentu, minimal belanja, masa berlaku, dan kuota. Jenis potongan: persen (dengan batas maksimum), nominal tetap, atau gratis ongkir (maksimum sebesar ongkir). Voucher yang khusus untuk penerima tertentu tidak bisa dipakai orang lain. Pelanggan agen tidak boleh memakai voucher.

| Pesan | Arti | Solusi |
|---|---|---|
| Voucher itu tidak bisa dipakai. | Gagal umum | Periksa kode |
| Voucher not found. (arti: voucher tidak ditemukan) | Kode salah | Periksa ketikan |
| This voucher has expired. (arti: voucher kedaluwarsa) | Lewat masa berlaku | Pakai voucher lain |
| This voucher is not valid yet. (arti: belum berlaku) | Belum mulai | Tunggu tanggal mulai |
| This voucher is no longer active. (arti: voucher sudah tidak aktif) | Dinonaktifkan | Pakai voucher lain |
| Your order must be at least {angka} to use this voucher. (arti: pesanan minimal sebesar angka itu) | Belum mencapai minimal belanja | Tambah barang |
| This voucher has reached its usage limit. (arti: kuota habis) | Kuota terpakai | Pakai voucher lain |
| You have already used this voucher the maximum number of times. (arti: sudah dipakai sebanyak batas) | Batas per pelanggan | Pakai voucher lain |
| This voucher has spent its full discount budget. (arti: anggaran diskon habis) | Anggaran habis | Pakai voucher lain |
| Voucher ini hanya berlaku di depot tertentu. | Depot tidak cocok | Pilih depot yang berlaku |
| Voucher ini hanya berlaku untuk produk tertentu yang tidak ada di keranjang. | Produk tidak cocok | Tambah produk yang berlaku |
| Voucher ini khusus untuk pelanggan yang menerimanya. | Bukan milik Anda | Pakai voucher sendiri |

**Poin dan tier** **[V]**: poin = subtotal pesanan ÷ Rp1.000, dibulatkan ke bawah (bawaan, bisa berbeda per depot **[K]**), masuk setelah pesanan berstatus Selesai. Subtotal yang dipakai adalah sebelum diskon dan ongkir. Tier berdasarkan total poin sepanjang waktu: REGULAR 0 poin (diskon 0%), SILVER 1.000 poin (2%), GOLD 5.000 poin (5%), PLATINUM 15.000 poin (8%). Angka ini bawaan kode dan bisa disetel **[K]**. Menukar poin mengurangi saldo, bukan tier. Poin dapat habis masa berlaku 12 bulan sejak diperoleh, tetapi penyapuan otomatis mati secara bawaan **[K]**; teks di layar "Poin hangus setelah 12 bulan tanpa aktivitas" tidak sama persis dengan kode **[B]**.

### Prosedur: Membayar pesanan

**Tujuan:** Melunasi pesanan. **Titik awal:** Rincian pesanan (`/orders/detail?id=…`), panel pembayaran.

Pembayaran dimulai otomatis dengan metode yang dipilih saat checkout. **[V]**

| Metode | Keterangan di layar | Cara kerja |
|---|---|---|
| **Bayar di tempat (COD)** | "Bayar ke kurir saat pesanan tiba." | Siapkan uang tunai. Status Menunggu sampai kurir mengonfirmasi |
| **Transfer bank** | "Transfer manual, dikonfirmasi oleh depot." | Rekening depot, nomor (dengan **Salin**), nama pemilik, dan **Nominal** tampil. Transfer, lalu unggah bukti |
| **QRIS** | "Pindai untuk bayar lewat aplikasi QRIS mana pun." | Gambar QRIS milik depot tampil. Bayar langsung ke depot, lalu unggah bukti |
| **E-wallet** | "GoPay, OVO, DANA, dan lainnya." | Hanya bila penyedia pembayaran diaktifkan. Kemungkinan belum tersedia di produksi **[D][K]** |
| **Virtual account** | "Bayar ke nomor rekening sekali pakai." | Sama seperti e-wallet **[D][K]** |

Metode yang benar-benar muncul di checkout bergantung pada depot. Dua depot disebut belum mengatur rekening/QRIS sehingga pelanggan hanya ditawari tunai **[K]**.

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Buka rincian pesanan. | Panel pembayaran: "Bayar via transfer" atau "Bayar via QRIS", dengan "Pembayaran masuk langsung ke {depot}." |
| 2 | Lakukan pembayaran dengan nominal **persis sama** dengan pesanan. | — |
| 3 | Di bagian **Bukti bayar**, tekan **Pilih foto bukti**. Format jpeg, png, atau webp, maksimal 5 MB. Gambar dikompres otomatis. | "Mengunggah…". Sukses bila foto tampil. Tombol berubah menjadi **Ganti foto bukti**. |
| 4 | Tunggu staf depot mengonfirmasi. | "Sudah transfer? Status berubah menjadi lunas setelah staf depot mengonfirmasi." Status menjadi PAID. |

Bila belum ada pembayaran aktif atau pembayaran gagal, panel menampilkan **Bayar pesanan ini** atau **Coba bayar lagi**, lalu **Bayar sekarang**. Hanya satu pembayaran aktif per pesanan. Pembayaran non-tunai yang belum dikonfirmasi gagal otomatis setelah 24 jam. **[V]**

| Pesan | Arti | Solusi |
|---|---|---|
| Depot belum mengatur rekening. Hubungi depot. | Depot belum punya data rekening | Hubungi depot (WhatsApp di Bantuan) |
| Depot belum mengatur QRIS. Hubungi depot. | Depot belum punya QRIS | Hubungi depot |
| Bukti bayar gagal diunggah. Coba lagi. | Unggahan gagal | Coba lagi, cek ukuran dan format |
| Penyimpanan bukti bayar sedang tidak tersedia. Coba lagi sebentar lagi. | Penyimpanan terganggu | Coba lagi nanti |
| unsupported file type (allowed: jpeg, png, webp) (arti: jenis berkas tidak didukung) | Format salah | Pakai jpeg, png, atau webp |
| Jumlah pembayaran tidak cocok dengan pesanan ini. | Nominal berbeda | Hubungi depot |
| This order already has an active payment. (arti: pesanan sudah punya pembayaran aktif) | Pembayaran ganda | Lanjutkan pembayaran yang ada |
| Could not reach the payment provider. Please try again. (arti: penyedia pembayaran tak terjangkau) | Gangguan penyedia | Coba lagi, atau pilih metode lain |

**Tampilan status pembayaran.** Di rincian pesanan, status dan metode tampil sebagai kode Inggris. **[B]** Artinya: PENDING = menunggu pembayaran atau konfirmasi; PAID = lunas; FAILED = gagal; CANCELLED = dibatalkan; REFUNDED = dikembalikan. Metode: CASH = tunai, TRANSFER = transfer, QRIS = QRIS, EWALLET = e-wallet, VA = virtual account. Petunjuk pembayaran juga bisa berbahasa Inggris, misalnya "Pay with cash to the driver on delivery." (bayar tunai ke kurir saat antar), "Transfer to the depot bank account and keep your receipt." (transfer ke rekening depot dan simpan bukti), "Scan the depot QRIS and show the payment proof to staff." (pindai QRIS depot dan tunjukkan bukti ke staf). **[B]**

Metode bayar tersimpan di Akun ("Metode pembayaran") hanya berupa label dan nomor akhir. Tampaknya tidak dipakai saat checkout. **[D]**

**Hasil akhir:** Pembayaran berstatus PAID; pesanan berstatus "Dikonfirmasi". **Daftar periksa:**
- [ ] Nominal sama persis
- [ ] Bukti bayar diunggah jelas (nominal, tanggal terbaca)
- [ ] Status diperiksa setelah staf mengonfirmasi

> **[SCREENSHOT REQUIRED: SS-customer-07 — Panel pembayaran transfer/QRIS di rincian pesanan, dengan rekening, tombol Salin, dan "Pilih foto bukti".]**
> *Gambar 6.4 — Pembayaran dan bukti bayar.*

### Prosedur: Melacak pesanan

**Tujuan:** Mengetahui posisi pesanan. **Titik awal:** **Pesanan** → pilih pesanan, atau tombol **Lacak kurir** di beranda.

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Buka **Pesanan** lalu pilih pesanan. | Bilah kemajuan: Dipesan, Disiapkan, Diambil, Diantar, Tiba. Banner status. |
| 2 | Lihat nama dan nomor kurir setelah ditugaskan. | Kartu kurir dengan tautan telepon. |
| 3 | Tunggu. Halaman menyegarkan diri tiap 15 detik selama pesanan aktif. | Status dan perkiraan tiba tampil saat dalam perjalanan. |

Arti status dan banner:

| Status | Banner untuk Anda |
|---|---|
| Dipesan, Dikonfirmasi | Pesananmu sedang diproses |
| Disiapkan | Pesananmu sedang disiapkan di depot |
| Kurir ditugaskan | Kurir sedang menuju depot |
| Diambil kurir | Pesananmu sudah diambil kurir |
| Dalam perjalanan | Pesananmu sedang dalam perjalanan |
| Tiba | Pesananmu sudah tiba |
| Selesai | Pesanan selesai — terima kasih! |
| Dibatalkan | Pesanan dibatalkan |

Pengantaran bisa dijadwalkan ulang oleh depot; status kembali ke Disiapkan dan Anda menerima notifikasi "Pengiriman dijadwalkan ulang". **[V]**

**Membagikan tautan lacak:** tekan **Bagikan link lacak** (tersedia bila pesanan punya tautan). Siapa pun yang memegang tautan `/track?token=…` dapat melihat nomor pesanan, status, kota, perkiraan tiba, nama depan kurir, dan riwayat status. Nama, nomor telepon, dan alamat Anda tidak ikut tampil. **[V]** Halaman itu berlabel Inggris (Order placed, Confirmed, Preparing, Driver assigned, Picked up, On the way, Delivered, Completed, Cancelled). **[B]** Tautan tidak lengkap: "Tidak ada nomor lacak"; tautan salah: "Link tidak ditemukan" (minta tautan baru dari depot).

Kartu "sedang diantar" di beranda tampil untuk semua pesanan terbuka, termasuk yang baru dibuat. **[B]** Peta kurir langsung: Tidak tersedia (lihat bagian 15).

> **[SCREENSHOT REQUIRED: SS-customer-08 — Rincian pesanan dengan bilah kemajuan dan kartu kurir.]**
> *Gambar 6.5 — Pelacakan pesanan.*

### Prosedur: Melihat riwayat dan memesan lagi

**Titik awal:** **Pesanan** (`/orders`, 20 per halaman).

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Buka **Pesanan**; geser untuk halaman berikutnya. | Daftar pesanan dan rel "Beli lagi". |
| 2 | Buka pesanan, tekan **Pesan lagi**. | Barang yang masih dijual masuk ke keranjang. |

Pesan: "Tidak ada barang pesanan ini yang masih dijual." atau "{n} barang tidak lagi dijual dan tidak ikut ditambahkan." Bonus gratis dari promo tidak ikut ditambahkan. **[V]**

### Prosedur: Menilai pesanan

**Tujuan:** Memberi ulasan. **Prasyarat:** Status Tiba atau Selesai, belum dinilai. **Titik awal:** Rincian pesanan → **Nilai pesanan**.

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Tekan **Nilai pesanan**. | Judul "Bagaimana pesananmu?" |
| 2 | Pilih bintang 1 sampai 5 (wajib). Keterangan: 1 Buruk, 2 Kurang, 3 Cukup, 4 Bagus!, 5 Luar biasa! | Tanpa bintang: "Pilih rating bintang dulu." |
| 3 | (Opsional) Pilih "Apa yang bagus?": Kecepatan antar, Kondisi galon, Keramahan kurir, Akurasi pesanan. | — |
| 4 | (Opsional) Tulis komentar, maksimal 500 huruf. | — |
| 5 | Tekan **Kirim ulasan**. | "Terima kasih atas ulasanmu!" |

Satu ulasan per pesanan. Pesan: "Pesanan ini sudah dinilai.", "Pesanan bisa dinilai setelah selesai.", "Gagal mengirim ulasan." Fitur tip untuk kurir: Tidak tersedia. **[V]** Sekitar 30 menit setelah pesanan tiba Anda bisa menerima notifikasi "Beri penilaian" (hanya sekali). **[V]**

### Prosedur: Membuat dan mengelola langganan

**Tujuan:** Pesanan galon rutin otomatis. **Titik awal:** **Langganan** (`/subscriptions`, "Galon rutin, tanpa perlu ingat").

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Pilih **Produk**. | — |
| 2 | Isi **Jumlah** (bawaan 2, minimal 1). | — |
| 3 | Pilih **Frekuensi**: Mingguan (tiap 7 hari), 2 minggu (tiap 14 hari), Bulanan (tiap 30 hari). | — |
| 4 | Pilih **Pengiriman pertama** (bawaan besok; tidak boleh tanggal lampau). | — |
| 5 | Pilih **Antar ke** (alamat tersimpan). | Alamat harus punya titik peta, kalau tidak: "Alamat ini belum punya titik peta, jadi langganan tidak bisa dijadwalkan. Buka alamat itu dan tekan "Gunakan lokasi saya" dulu." |
| 6 | Tekan **Mulai langganan**. | "Langganan dibuat." |

Diskon langganan: "Hemat {persen}% tiap pengiriman langganan." (bawaan 5%, berbeda per depot, maksimal 50%). **[K]** Tiap jadwal, sistem membuat pesanan otomatis dengan harga depot dan ongkir per galon, dan Anda menerima notifikasi "Pesanan diterima". Pembayaran pesanan langganan tidak dimulai otomatis; bayar dari rincian pesanan atau lewat tunai. **[D]**

Tindakan: **Jeda**, **Lanjutkan**, **Batalkan** ("Batalkan langganan ini?"; tidak bisa dibuka kembali), **Ganti alamat**. Setelah dibatalkan, langganan tidak bisa diubah: "A cancelled subscription can no longer be changed." (arti: langganan yang dibatalkan tidak bisa diubah lagi). **[V]** Bila tiga pembuatan pesanan berturut-turut gagal, langganan dijeda otomatis dan Anda diberi tahu; tidak ada tagihan saat dijeda. **[V]**

Status: Aktif, Dijeda, Dibatalkan. Melewati satu jadwal saja: Tidak tersedia (lihat bagian 15).

### Prosedur: Favorit

Tekan ikon hati pada produk untuk menyimpan; lihat daftar di **Favorit** (`/favorites`). **[V]** Bila produk tidak ada lagi: "Produk tidak ditemukan." **[V]**

### Prosedur: Mengajak teman (referral)

**Titik awal:** **Ajak teman** (`/referral`) atau kotak referral di `/rewards`.

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Buka `/referral`. | **Kode referral kamu** (8 karakter huruf besar dan angka) dan statistik: Diundang, Berhasil, Poin. |
| 2 | Bagikan kode ke teman. | — |
| 3 | Teman memasukkan kode saat daftar, atau di `/rewards` ("Punya kode teman?" lalu **Pakai**). | Hanya untuk pelanggan baru yang belum pernah menyelesaikan pesanan. |

Poin diberikan setelah pesanan pertama teman selesai: pengundang 500 poin dan teman 250 poin (bawaan, bisa disetel **[K]**). Ini bukan potongan harga. Lencana "+50 poin" di formulir pendaftaran tidak sesuai dengan angka tersebut. **[B]** Kegagalan memakai kode ditampilkan umum: "Kode tidak dapat digunakan." Alasan sebenarnya bisa berupa: kode tidak ditemukan, kode sendiri, sudah pernah memakai kode, atau sudah pernah menyelesaikan pesanan ("Kode rujukan hanya untuk pelanggan baru — kamu sudah pernah menyelesaikan pesanan."). **[V]**

### Prosedur: Menukar poin dengan hadiah

**Tujuan:** Menukar poin. **Titik awal:** **Rewards** (`/rewards`) → tab **Tukar poin**.

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Lihat saldo dan kemajuan tier. | Tab: Tukar poin, Voucher, Riwayat. |
| 2 | Tekan **Tukar** pada hadiah. | Tombol berubah **Kurang** bila poin tak cukup, **Habis** bila stok nol. |
| 3 | Pilih depot di "Ambil hadiah di mana?". | "{nama} berhasil ditukar!" Penukaran muncul di "Penukaran saya" berstatus "Menunggu diambil" dengan kode. |
| 4 | Datang ke depot dan tunjukkan kode: "Tunjukkan kode ini ke petugas depot saat mengambil hadiah." | Petugas menyerahkan hadiah; status menjadi "Sudah diambil". |
| 5 | (Bila batal) Tekan **Batalkan** sebelum diambil. | "Penukaran dibatalkan, poin sudah dikembalikan." |

Pembatalan hanya bisa selama belum diserahkan. Setelah diambil: "Hadiah ini sudah diambil, jadi penukaran-nya tidak bisa dibatalkan." (teks persis: "Hadiah ini sudah diambil, jadi penukarannya tidak bisa dibatalkan."). Tidak ada batas waktu lain. **[V]**

Pesan Inggris: "This reward is out of stock." (hadiah habis), "You do not have enough points to redeem this reward." (poin tidak cukup), "This reward is not available." (hadiah tidak tersedia). Layar menampilkan "Gagal menukar poin. Coba lagi." untuk kegagalan lain. **[V]**

### Prosedur: Notifikasi

**Titik awal:** Ikon lonceng / `/notifications`. Judul "Notifikasi". Tekan **Tandai dibaca** untuk menandai. Tanpa notifikasi: "Tidak ada notifikasi". **[V]**

Jenis pesan yang Anda terima:

| Judul | Kapan |
|---|---|
| Selamat datang di Hydromart | Setelah akun aktif |
| Pesanan diterima | Setelah checkout |
| Pesanan dikonfirmasi | Setelah dikonfirmasi |
| Kurir ditugaskan | Kurir ditugaskan. Isi pesan: setelah ini pesanan tidak bisa dibatalkan sendiri lewat aplikasi |
| Pesanan dalam perjalanan | Kurir berangkat. Siapkan galon kosong bila ada penukaran |
| Pesanan terkirim | Pesanan sampai |
| Pesanan selesai | Selesai, bila tidak lewat status Tiba |
| Pesanan dibatalkan | Dibatalkan oleh depot atau sistem (bukan bila Anda sendiri yang membatalkan) |
| Pengiriman dijadwalkan ulang | Jadwal diubah depot |
| Beri penilaian | ±30 menit setelah tiba, sekali saja |
| Saatnya isi ulang? | Bila 14 hari tanpa pesanan |
| Galon belum dikembalikan | Pengingat galon yang masih Anda pegang |
| Poin bertambah / Naik tier membership | Setelah pesanan selesai |
| Voucher baru | Voucher diberikan kepada Anda |
| Kabar dari Hydromart | Siaran umum atau promo |

Beberapa kejadian **tidak** memicu notifikasi: pembayaran dikonfirmasi, pembayaran gagal, refund selesai, keputusan permintaan data pribadi, dan balasan komplain. Periksa layar sendiri. **[B]** Isi pesan "Kurir ditugaskan" berbunyi "sudah diambil kurir", padahal status itu baru berarti kurir ditugaskan. **[B]**

Push bisa dimatikan di Akun. Kesalahan terkait: "Perangkat ini tidak mendukung notifikasi.", "Notifikasi diblokir. Izinkan Hydromart di setelan perangkat, lalu coba lagi.", "Gagal mendaftarkan perangkat untuk notifikasi. Coba lagi.", "Gagal menyimpan preferensi." **[V]**

> **[SCREENSHOT REQUIRED: SS-customer-09 — Halaman `/notifications` berisi beberapa notifikasi, sebagian belum dibaca.]**
> *Gambar 6.6 — Kotak masuk notifikasi.*
