# Bab 10 — Panduan Admin (Super admin)

| Metadata | Nilai |
|---|---|
| Versi | 0.1 draf |
| Tanggal | 2026-10-10 |
| Klasifikasi | Internal — Rahasia |
| Peran | Super admin (kode: SUPER_ADMIN; dalam panduan ini disebut "Admin") |
| Dasar | Pembacaan kode (packages/access/src/index.ts, services/auth-service, services/admin-service, services/depot-service, apps/web/src). Belum ada pengujian di browser yang dijalankan oleh penulis dokumen ini. |

**Tag bukti.** **[V]** terverifikasi di kode · **[D]** disimpulkan, perlu konfirmasi · **[K]** perlu konfirmasi bisnis · **[B]** diketahui bermasalah atau tidak konsisten. "Tidak tersedia" berarti fitur memang tidak ada.

**Catatan penting.** Hak akses di bab ini adalah nilai BAWAAN dari `packages/access/src/index.ts`. Admin dapat mengubahnya saat aplikasi berjalan (berlaku sekitar 30 detik), dan bab ini menjelaskan caranya. Label di layar menulis peran ini sebagai "Super admin"; istilah "Admin" dipakai di panduan sebagai singkatan.

**Peringatan keras: jangan berbagi akun Admin.** Setiap Admin harus orang tersendiri dengan nomor telepon sendiri. Akun Admin memegang semua hak dan tidak terhalang matriks. Berbagi akun menghilangkan jejak siapa melakukan apa di log audit, dan karena tidak ada 2FA (OTP telepon adalah satu-satunya faktor), siapa pun yang menguasai ponsel itu menguasai seluruh sistem. Bila butuh cadangan, angkat Admin kedua yang berbeda orang (bagian 6.18).

---

## 1. Gambaran peran

Admin adalah pemilik tertinggi sistem. Admin dapat:

- membuka semua layar konsol HQ, termasuk **layar khusus Admin** yang tidak tersedia bagi Head office, Direktur, dan Finance;
- mengubah siapa boleh melakukan apa (matriks hak akses), tanpa penerapan ulang aplikasi;
- mengangkat, menonaktifkan, dan menghapus akun staf, termasuk peran yang tidak boleh diberikan peran lain;
- mengatur hierarki pembinaan yang menentukan depot mana terlihat oleh siapa;
- mengelola kunci API, webhook, feature flag, retensi data, dan kebijakan keamanan;
- mengubah pengaturan global jaringan.

Secara kode, sistem selalu menjawab "boleh" untuk Admin pada setiap kapabilitas, di atas tabel override, sehingga baris matriks yang rusak pun tidak dapat mengunci Admin keluar. **[V]** Konsekuensinya: **mencabut Super admin dari sebuah baris matriks hanya mengubah tampilan, tidak mengubah apa yang dapat dilakukan Admin**. Satu-satunya pengecualian yang dijaga: server menolak bila Super admin dilepas dari `accessMatrixWrite` ("SUPER_ADMIN tidak boleh dilepas dari accessMatrixWrite.").

Peran lain yang berkaitan: Head office, Direktur, dan Finance dijelaskan di Bab 9. Manajer, HR, dan Marketing dijelaskan di bab masing-masing atau lampiran.

---

## 2. Tujuan dan tanggung jawab

| Tanggung jawab | Hasil yang diharapkan |
|---|---|
| Menjaga prinsip hak akses minimum | Setiap peran hanya memegang kapabilitas yang dibutuhkan. |
| Mengelola daur hidup akun staf | Akun dibuat, dipindah, dinonaktifkan, dan dihapus dengan jejak audit. |
| Menjaga peran bernilai tinggi tetap sedikit | Super admin, Direktur, Finance, HR, Marketing, Manajer hanya diberikan oleh pihak berwenang. |
| Menjaga integrasi mitra | Kunci API dan webhook dibuat, diputar, dan dicabut dengan tertib. |
| Mengatur retensi dan privasi | Data dibuang sesuai masa simpan; permintaan UU PDP diselesaikan. |
| Menjadi tujuan eskalasi | Menerima laporan layar yang gagal, hak yang salah, dan akun terkunci. |

---

## 3. Prasyarat akses

1. Akun dengan peran Super admin. Hanya Super admin yang boleh memberikan peran Super admin. **[V]**
2. Nomor telepon pribadi yang selalu dikuasai pemegang akun. Tidak ada jalur pemulihan melalui layar bila nomor hilang (bagian 6.18).
3. Pengetahuan dasar peran dan kapabilitas (Bab 9, bagian 1).
4. Disarankan minimal dua Admin berbeda orang. Server menolak menghapus Super admin aktif terakhir. **[V]**

---

## 4. Masuk dan pengaturan awal

### 4.1 Masuk

Masuk lewat `/hq/login` (judul "Masuk konsol staf") dengan nomor telepon lalu kode OTP 6 digit; prosedur dan pesan galat sama seperti Bab 9 bagian 4. Setelah masuk, Admin mendarat di /hq. Catatan: **[V]**

- Tidak ada kata sandi dan tidak ada 2FA tambahan. OTP telepon adalah satu-satunya faktor. Label rail "Keamanan & 2FA" dan langkah wizard "Verifikasi 2FA akun kamu" **tidak** menambah faktor kedua. **[B]**
- Pembatasan laju (gateway): kode OTP maksimal 20 permintaan per 60 detik per alamat IP untuk masuk, daftar, dan kirim ulang (kode galat `RATE_LIMITED_OTP`). Batas umum: 600 permintaan per 60 detik per pemanggil, dengan kapasitas lonjakan 300. **[V]**
- Kode OTP: 6 digit (4–8 dapat dikonfigurasi), berlaku 300 detik (maksimal 600), maksimal 5 percobaan, jeda kirim ulang 60 detik. **[V]**
- Akun nonaktif ditolak: "This account has been suspended." (akun ditangguhkan).

### 4.2 Pengaturan awal yang disarankan

Urutan kerja untuk instalasi baru atau setelah serah terima:

1. Buka Wizard HQ (`/hq/wizard`, bagian 6.14) dan kerjakan lima langkahnya sebagai daftar periksa.
2. Buka Keamanan (`/hq/security`) dan tetapkan batas menganggur sesi (bagian 6.13).
3. Buka Peran & hak akses dan tinjau matriks (bagian 6.1).
4. Angkat Admin kedua dan peran kantor pusat yang dibutuhkan (bagian 6.2).
5. Susun hierarki (bagian 6.8) agar Asisten SPV, SPV, dan Manajer melihat depotnya.
6. Periksa pengaturan global: pengaturan jaringan (bagian 6.16), termasuk nilai yang diputuskan pemilik saat go-live (keanggotaan, kedaluwarsa poin) **[K]**.
7. Periksa Retensi & backup dan Kesehatan sistem (bagian 6.12, Bab 9 bagian 6.28).

> **[SCREENSHOT REQUIRED: SS-admin-01 — rail /hq pada akun Super admin memperlihatkan seluruh grup, termasuk "Sistem" dan "Admin & polish"]**
> *Gambar 10.1 — Rail konsol HQ untuk Admin.*

---

## 5. Menu dan modul tersedia

Admin melihat semua entri rail. Tabel berikut memuat layar **khusus Admin** (kapabilitas bawaan hanya Super admin) dan layar terkait. Untuk daftar penuh rail dan peran lain, lihat Bab 9 bagian 5.1.

| Label | Rute | Kapabilitas | Fungsi | Bukti |
|---|---|---|---|---|
| Peran & hak akses | /hq/access (+ /hq/access/landing, /hq/access/detail) | accessMatrixWrite | Editor matriks RBAC | [V] |
| Hierarki pembinaan | /hq/hierarchy | hierarchyAdmin | Atasan–bawahan dan depot binaan | [V] |
| Direktori staf | /hq/staff | staffAdmin / staffDelete | Undang, pindah, nonaktifkan, hapus | [V] |
| Impor staf | /hq/staff/import | staffAdmin | Impor massal akun | [V] |
| Feature flags | /hq/flags | platformAdmin (ubah) | Flag dan pengaturan platform | [V] |
| Kunci API | /hq/api-keys | platformAdmin | Kredensial mitra | [V] |
| Webhooks | /hq/webhooks | platformAdmin | Langganan event | [V] |
| Retensi & backup | /hq/retention | platformAdmin | Masa simpan data, sapuan | [V] |
| Keamanan & 2FA | /hq/security | platformAdmin | Kebijakan sesi, sesi aktif | [V] |
| Wizard HQ | /hq/wizard | platformAdmin | Daftar periksa awal | [V] |
| Konten dwibahasa | /hq/content | platformAdmin | Editor kamus ID/EN (lokal) | [V] |
| Log audit | /hq/audit | hqBackOffice | Jejak tak terubah | [V] |
| Kesehatan sistem | /hq/health | hqBackOffice | Status layanan; kartu khusus Admin | [V] |
| Permintaan data (UU PDP) | /hq/pdp | pdpRequests | Salinan data, hapus akun pelanggan | [V] |
| Pengaturan | /dashboard/settings | depotAdmin, settingsGlobal | Pengaturan jaringan dan depot | [V] |
| Pengaturan depot | /dashboard/depot-settings | — | Pengaturan satu depot | [V] |
| Konfigurasi Gaji | /hr/settings | hrAdmin | Pengaturan gaji (global hanya Admin) | [V] |

Layar Marketing dan Manajer yang juga hanya terbuka bagi Admin dari kelompok HQ: Program loyalti (/hq/loyalty), Segment (/hq/forms/segment), Broadcast notifikasi (/hq/broadcast), Aturan harga (/hq/forms/pricing-rule), Voucher formulir (/hq/forms/voucher), Kebijakan SLA (/hq/sla-policy). **[V]**

---

## 6. Prosedur langkah demi langkah

### 6.1 Editor matriks hak akses (/hq/access)

### Prosedur: Mengubah hak akses suatu peran

**Tujuan:** Memberi atau mencabut kapabilitas untuk peran tertentu. **Peran:** Admin saja (`accessMatrixWrite`). Layar ini tidak tampil di rail Head office (rail memakai `accessMatrixWrite`); di server, pembacaan matriks terbuka bagi pemegang `staffAdmin`, tetapi menyimpan hanya `accessMatrixWrite`. **Prasyarat:** Anda tahu kapabilitas apa yang dimaksud dan peran mana yang terdampak. Catat alasan perubahan di luar sistem. **Titik awal:** Rail "Ringkasan & tata kelola" > "Peran & hak akses". Subjudul layar: "Sumber kebenaran tunggal untuk RBAC — modul yang sama yang ditegakkan guard server. Klik sel untuk memberi/mencabut hak."

**Tata letak:** baris = kapabilitas, dikelompokkan: Operasi, Kurir & COD, Tim & shift depot, Jaringan & admin, Keputusan head office, Pemasaran, Keuangan, HR (SDM), Lainnya. Kolom = 13 peran, disingkat Cus, Stf, Kep, Asv, Spv, Mgr, Dir, Fr, HO, Fin, Mkt, HR, SA. **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Klik sel pada baris kapabilitas dan kolom peran. | Sel berpindah antara beri dan cabut (kontrol bertanda `aria-pressed`). |
| 2 | (Opsional) Klik judul kolom ("Beri/cabut semua kapabilitas untuk peran ini") atau label baris ("Beri/cabut kapabilitas ini untuk semua peran"). | Kolom: bila peran memegang semua, semua dicabut; selain itu semua diberikan. Baris: semua peran atau tidak ada. **Hati-hati: ini mengubah banyak sel sekaligus.** |
| 3 | Baca banner "{n} kapabilitas diubah" — "Belum disimpan. Klik Simpan untuk memberlakukannya di seluruh layanan." | Perubahan masih lokal. |
| 4 | (Opsional) Tekan "Lihat diff / Salin" ("Ringkasan perubahan"; format `capName: ['ROLE', ...],`; tombol "Salin" lalu "Tersalin"). | Ringkasan teks untuk dicatat dan ditinjau orang kedua. |
| 5 | Tekan "Simpan" ("Menyimpan…"). | Satu permintaan atomik hanya berisi kapabilitas yang berubah. Kapabilitas yang kembali ke nilai bawaan dikirim sebagai "reset". |
| 6 | Tunggu. Teks layar: "Setelah disimpan, seluruh layanan mengikuti dalam waktu 30 detik." | Setiap layanan memeriksa ulang tiap 30 detik, dan layanan akun menyimpan jawabannya hingga 15 detik, jadi perubahan dapat memerlukan sekitar 30–45 detik. **[V]** |
| Batal | Tekan "Batalkan". | Grid kembali ke kondisi terakhir yang dimuat (hanya lokal). |

**Tampilan per peran:** tautan "Tampilan per peran" (`/hq/access/landing`): pilih peran ("Pilih peran") untuk melihat "Mendarat di" dan "Menu yang terlihat" ("{n} kapabilitas"); tautan rincian (`/hq/access/detail`) memuat "{n} dari {total} kapabilitas" untuk peran itu. Gunakan untuk memeriksa dampak sebelum menyimpan. Catatan: tampilan ini dibangun dari modul kode yang sama, bukan dari kondisi berjalan **[D]**.

**Hasil akhir:** Matriks berlaku di semua layanan. Setiap perubahan dicatat oleh pencatat audit pada pengendali akses (mekanisme **[V]**, bentuk persis nama aksi **[D]**).

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Capability tidak dikenal: X" | Nama kapabilitas tidak ada di kode. | Muat ulang halaman; jangan menyunting manual. |
| "Peran tidak dikenal: X" | Nilai peran tidak sah. | Muat ulang. |
| "Capability disebut dua kali: X" | Duplikat dalam satu kiriman. | Muat ulang dan ulangi. |
| "SUPER_ADMIN tidak boleh dilepas dari accessMatrixWrite." | Pelindung agar Admin tidak terkunci. | Pertahankan Super admin pada baris itu. |
| Banner galat dari server / 403 | Anda bukan Admin atau layanan gagal. | Masuk sebagai Admin; coba lagi. |

Seluruh kiriman diperiksa dulu dan ditulis dalam satu transaksi; bila satu perubahan salah, tidak ada yang diterapkan. Batas: 256 perubahan per kiriman, 32 peran per kapabilitas. **[V]**

**Hal yang wajib diketahui (jebakan):**

1. **Muat gagal tampil seolah bawaan [B][V].** Bila matriks gagal dimuat, grid diam-diam menampilkan nilai bawaan kode, bukan kondisi sebenarnya. Menyimpan dari kondisi itu dapat mengirim perubahan yang tidak Anda maksudkan. Bila ada keraguan, muat ulang halaman dan bandingkan dengan Tampilan per peran sebelum menyimpan.
2. **Mencabut Super admin tidak berefek.** Sistem selalu mengizinkan Admin (bagian 1).
3. **Hak yang sangat kuat dapat diberikan.** Mengaktifkan `accessMatrixWrite` untuk peran lain menjadikan peran itu editor matriks; tidak ada pelindung selain kebijakan Anda. **[D]** Jangan lakukan tanpa persetujuan tertulis pemilik.
4. **Matriks tidak mengubah aturan pemberian peran.** Siapa boleh memberi peran apa (bagian 6.7) dan peran yang boleh diatur HR adalah konstanta di kode. **[V]**
5. **Sumber tidak terjangkau.** Bila layanan kehilangan kontak dengan sumber matriks, ia memakai matriks terakhir yang diketahui; setelah 5 menit gagal berturut-turut ia membuang snapshot dan kembali ke **nilai bawaan kode**. Ini dapat menarik hak yang Anda berikan. **[V]**
6. **Perubahan mempengaruhi Bab lain.** Panduan peran lain menyebut nilai bawaan; setelah Anda mengubah matriks, beri tahu pemilik proses.

> **[SCREENSHOT REQUIRED: SS-admin-02 — /hq/access dengan grid kapabilitas × 13 peran, satu sel diubah, banner "{n} kapabilitas diubah", tombol Batalkan, Lihat diff / Salin, Simpan]**
> *Gambar 10.2 — Editor matriks hak akses.*

> **[SCREENSHOT REQUIRED: SS-admin-03 — panel "Ringkasan perubahan" dari Lihat diff / Salin]**
> *Gambar 10.3 — Ringkasan perubahan sebelum disimpan.*

### 6.2 Mengundang staf

### Prosedur: Mengundang atau menetapkan peran staf (layar HQ)

**Tujuan:** Membuat akun staf baru atau mengubah peran atau depot akun yang ada. **Peran:** Admin (semua 12 peran staf) dan Head office (sebagian, Bab 9 bagian 6.4). **Prasyarat:** Nomor telepon aktif; depot bila peran Staf depot atau Kepala depot. **Titik awal:** Rail "Staf & peran" > "Direktori staf" (`/hq/staff`) > tombol "＋ Undang staf". **Gunakan layar ini, bukan /dashboard/staff** (lihat catatan di bawah). **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Tekan "＋ Undang staf". | Kartu "Undang / tetapkan peran staf". |
| 2 | Isi "Nomor telepon" (wajib). Bentuk 0812…, +62…, atau 62… diterima. | Kosong: "Masukkan nomor telepon." Tidak sah: `"X" is not a valid Indonesian mobile number.` (bukan nomor HP Indonesia yang sah). |
| 3 | Isi "Nama (untuk akun baru)". | — |
| 4 | Pilih "Peran". Admin melihat ke-12 peran (Staf depot, Kepala depot, Asisten SPV, SPV, Manajer, Direktur, Marketing, Finance, HR, Pemilik waralaba, Head office, Super admin). | Bawaan pilihan awal: Kepala depot. |
| 5 | Pilih "Depot penempatan (opsional)". | **Wajib dari sisi server** untuk Staf depot dan Kepala depot: "Peran staf depot wajib terikat ke satu depot." |
| 6 | Untuk selain Pemilik waralaba isi "Posisi" (wajib), "Tanggal masuk" (bawaan hari ini), "Status kepegawaian" (Training / Percobaan / Tetap; bawaan Percobaan), "Gaji" (Bulanan atau Harian + angka > 0). | Bila kosong: "Posisi dan gaji wajib diisi — datanya dipakai membuat kartu karyawan." Pemilik waralaba: tidak ada kartu karyawan (posisi "Pemilik waralaba", gaji 0 dikirim otomatis). |
| 7 | Tekan "Kirim undangan" ("Batal" menutup). | Form menutup dan daftar dimuat ulang. Gagal: pesan server atau "Gagal mengundang staf." |

**Hasil akhir [V]:**
- Nomor baru: akun dibuat langsung berstatus AKTIF (staf dianggap sudah dipercaya; tanpa verifikasi diri). Orang itu masuk dengan OTP telepon.
- Nomor yang sudah punya akun: akun DIPROMOSIKAN (peran, depot, nama diperbarui). **Akun yang dinonaktifkan ikut diaktifkan kembali.** Akun yang sudah DIHAPUS tidak pernah dihidupkan lagi; mengangkat ulang membuat akun baru.
- Kartu karyawan dibuat di layanan HR. Bila layanan HR tidak terkonfigurasi: "hr-service belum dikonfigurasi; undangan staf tidak bisa diproses." Bila kegagalan terjadi di antara pembuatan akun dan kartu karyawan, akun ada tanpa kartu (terlihat sebagai tautan "Belum ada data karyawan — buatkan").
- **Tidak ada SMS atau pesan undangan** dikirim oleh langkah ini **[D]**. Beri tahu orangnya lewat saluran lain, tanpa menuliskan kode apa pun.
- Mengundang ulang nomor yang sama bersifat idempoten.

**Daftar periksa:**
- [ ] Nomor benar dan milik orang yang dimaksud (kesalahan ketik dapat mengubah akun orang lain; lihat peringatan di Skenario 3).
- [ ] Peran sesuai kebutuhan minimum.
- [ ] Depot terisi untuk Staf depot dan Kepala depot.
- [ ] Peran bernilai tinggi (Super admin, Direktur, Finance, HR) disetujui pemilik secara tertulis.

> **[SCREENSHOT REQUIRED: SS-admin-04 — kartu "Undang / tetapkan peran staf" pada akun Super admin dengan 12 tombol peran dan kolom Posisi, Tanggal masuk, Status kepegawaian, Gaji]**
> *Gambar 10.4 — Formulir undang staf.*

**Celah penting: /dashboard/staff [B][V code, D runtime].** Layar Konsol depot > Staf (`/dashboard/staff`, gerbang "Khusus admin": "Manajemen staf & peran tersedia untuk head office dan super admin.") memuat formulir undangan yang **tidak mengirim kolom wajib** pada DTO server (position, joinDate, employmentStatus, salaryType). Kodenya tidak menandai kolom-kolom itu opsional, sehingga undangan dari layar itu hampir pasti ditolak dengan galat validasi 400. Hasil di browser belum diuji. **Gunakan /hq/staff untuk mengundang.** Formulir /dashboard/staff memiliki kolom kendaraan (jenis dan plat), sedangkan formulir HQ tidak; kolom itu hanya disimpan untuk Staf depot.

### 6.3 Mengubah peran akun

**Tidak ada tombol "ubah peran".** **[V]** Dua jalur:

1. **Undang ulang nomor yang sama** dengan peran baru (bagian 6.2). Efek samping: akun nonaktif menjadi aktif.
2. **Perubahan jabatan di HR** (HR mengubah "Jabatan (peran login)" pada karyawan): terbatas pada Staf depot, Kepala depot, Asisten SPV, SPV, Manajer. HR boleh memberi Manajer; Head office tidak.

Setelah peran berubah, token akses lama masih membawa peran lama sampai sekitar 15 menit (bagian 6.5). Pemberian peran selalu diperiksa terhadap aturan di bagian 6.7. Pemeriksaan hanya dilakukan bila peran benar-benar berubah (memindahkan depot tidak memicunya). **[V]**

### 6.4 Memindahkan depot staf

**Tujuan:** Memindahkan penempatan depot. **Peran:** Admin dan Head office. **Titik awal:** `/hq/staff`, baris staf, pemilih "Depot penempatan" (hanya untuk Staf depot, Kepala depot, Asisten SPV, SPV, Manajer).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Pilih depot baru. | Konfirmasi "Pindahkan {name} ke {depot}?" |
| 2 | Setujui. | Depot berubah dan kartu karyawan di HR ikut berubah. Gagal: "Gagal memindahkan depot." |

Peran dengan kunci depot (Staf depot, Kepala depot) tidak boleh dikosongkan. Bila HR menolak pemindahan, seluruh pemindahan gagal. Pemindahan tidak mengaktifkan akun yang dinonaktifkan. Depot yang terlihat oleh Asisten SPV, SPV, dan Manajer ditentukan **hierarki** (bagian 6.8), bukan kolom ini. **[V]**

### 6.5 Menonaktifkan dan mengaktifkan akun staf

### Prosedur: Menonaktifkan akun staf

**Tujuan:** Menghentikan akses seorang staf (misalnya berhenti bekerja). **Peran:** Admin dan Head office. **Prasyarat:** Pastikan akun yang benar. **Titik awal:** `/hq/staff`, baris staf, tombol "Nonaktifkan" (atau "Aktifkan").

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Tekan "Nonaktifkan". | **Tanpa dialog konfirmasi.** Lencana berubah dari "Aktif" ke "Nonaktif". Kartu karyawan di HR menjadi nonaktif (status Resign yang lebih kuat tetap dipertahankan). |
| 2 | Pulihkan dengan "Aktifkan" bila keliru. | Lencana kembali "Aktif". Gagal: "Gagal mengubah status akun." |

**Efek pada sesi (jangan dijanjikan terlalu cepat) [V]:**

| Hal | Perilaku |
|---|---|
| Masuk OTP baru | Ditolak: "This account has been suspended." |
| Token akses yang sudah terbit (berlaku 900 detik = 15 menit) | **Tetap berlaku sampai kedaluwarsa.** Penjaga hanya memeriksa tanda tangan token, tidak memeriksa status akun. |
| Token penyegar (30 hari) | Tidak dicabut, tetapi gagal saat disegarkan karena akun nonaktif. |
| Memaksa keluar semua perangkat orang lain | **Tidak tersedia.** Hanya pemilik akun yang dapat "keluar dari semua perangkat". |

Jadi akses residual bisa bertahan sekitar 15 menit setelah dinonaktifkan. Untuk kasus darurat, nonaktifkan lalu beri tahu atasan bahwa akses akan berakhir paling lama sekitar 15 menit; atur peran/akses terkait lewat matriks bila perlu.

**Pelindung yang TIDAK ada [B][V]:** menonaktifkan akun sendiri atau Super admin terakhir **tidak dijaga** oleh kode. Jangan menonaktifkan akun Admin Anda sendiri dan jangan menonaktifkan Admin terakhir; tidak ada jalur pulih lewat layar (bagian 6.18). Penghapusan dijaga, penonaktifan tidak.

> **[SCREENSHOT REQUIRED: SS-admin-05 — /hq/staff daftar akun dengan lencana Aktif/Nonaktif, tombol Nonaktifkan, Hapus (hanya Super admin), dan pemilih Depot penempatan]**
> *Gambar 10.5 — Daftar staf dengan aksi baris.*

### 6.6 Menghapus akun staf

### Prosedur: Menghapus (menganonimkan) akun staf

**Tujuan:** Menghapus akun secara permanen (misalnya permintaan penghapusan data staf). **Peran:** Admin saja (`staffDelete`). **Tidak dapat dibatalkan.** **Prasyarat:** Pastikan akun salah-nama tidak sedang dipakai; pastikan ada Admin lain. **Titik awal:** `/hq/staff`, baris staf, tombol "Hapus" (hanya tampil bagi pemegang `staffDelete`).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Tekan "Hapus". | Kolom konfirmasi: `Ketik ulang "{name}" untuk menghapus permanen.` |
| 2 | Ketik ulang nama persis (atau nomor telepon bila tidak ada nama). | Tombol hapus aktif hanya bila teks sama. |
| 3 | Tekan konfirmasi. | Akun berstatus DELETED, identitas dianonimkan, semua token penyegar dihapus (sesi berakhir pada penyegaran berikutnya), kartu karyawan di HR dianonimkan. |

**Penjaga server [V]:**

| Pesan | Arti |
|---|---|
| "Akun sendiri tidak bisa dihapus." | Anda tidak boleh menghapus akun sendiri. |
| "Ini akun pelanggan, bukan staf. Penghapusan pelanggan lewat antrean permintaan PDP." | Gunakan Permintaan data (UU PDP). |
| "Ini super admin terakhir. Angkat super admin lain dulu sebelum menghapus." | Harus ada minimal satu Super admin aktif. |
| "Gagal menghapus akun." | Gagal umum; ulangi atau eskalasi. |

**Hasil akhir:** respons menyebut `deleted: true` dan `employeeAnonymised` (benar/salah). Bila panggilan ke HR gagal, penghapusan tetap berlaku tetapi kartu karyawan belum dianonimkan; periksa di HR. Data keuangan tidak dihapus tetapi tidak lagi berpemilik (retensi 10 tahun). Aksi dicatat sebagai `staff.account.deleted` dengan identitas pelaku. Akun yang dihapus tidak dapat dipulihkan; mempekerjakan ulang berarti akun baru. Pemilik waralaba tidak punya kartu karyawan. **[V]**

### 6.7 Aturan pemberian peran (RESTRICTED_GRANTS)

Aturan siapa boleh memberi peran apa adalah **konstanta di kode** dan tidak berubah lewat matriks. **[V]**

| Peran sasaran | Siapa boleh memberi (konsol undang/impor) | Head office? | HR (lewat jabatan karyawan)? | Catatan |
|---|---|:-:|:-:|---|
| Staf depot | Pemegang `staffAdmin` (Head office, Admin) | Ya | Ya | Wajib depot |
| Kepala depot | idem | Ya | Ya | Wajib depot |
| Asisten SPV | idem | Ya | Ya | — |
| SPV | idem | Ya | Ya | — |
| Manajer | Super admin atau HR | Tidak | Ya | Keputusan pemilik 2026-09-11; Manajer memegang hak refund |
| Direktur | Super admin | Tidak | Tidak | — |
| Finance | Super admin | Tidak | Tidak | — |
| HR | Super admin | Tidak | Tidak | — |
| Marketing | Super admin | Tidak | Tidak | — |
| Super admin | Super admin | Tidak | Tidak | — |
| Pemilik waralaba | Pemegang `staffAdmin` | Ya | Tidak | Tanpa kartu karyawan |
| Head office | Pemegang `staffAdmin` | Ya | Tidak | Head office dapat menciptakan sesama Head office; konfirmasi dengan pemilik apakah dikehendaki **[K]** |
| Pelanggan | Tidak seorang pun | Tidak | Tidak | Ditolak sebagai peran staf |

- Penolakan server: "Peran {ROLE} hanya boleh diberikan oleh {A atau B}." Contoh: "Peran MANAGER hanya boleh diberikan oleh SUPER_ADMIN atau HR."
- Formulir web hanya menawarkan peran yang boleh diberikan pengguna itu (Admin melihat 12; Head office 6).
- Impor massal: dropdown peran di template memuat semua 12 peran, tetapi server memeriksa tiap baris dengan peran pengunggah.
- Panggilan sistem tanpa pelaku manusia hanya boleh memberi peran tidak terbatas.
- Hak untuk MENGUBAH peran Manajer adalah milik HR; keputusan ini disengaja karena Manajer memegang kapabilitas refund.

