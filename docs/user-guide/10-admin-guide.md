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


### 6.8 Hierarki pembinaan (/hq/hierarchy)

**Tujuan:** Menentukan rantai Depot → Asisten SPV → SPV → Manajer, yang menentukan **depot mana terlihat oleh siapa**. **Peran:** Admin saja (`hierarchyAdmin`). **Titik awal:** Rail "Jaringan depot" > "Hierarki pembinaan". Subjudul: "Depot → Asisten SPV → SPV → Manager. Peta ini yang menentukan depot mana terlihat oleh siapa." **[V]**

**Cara kerja cakupan depot [V]:**

| Peran | Depot yang terlihat |
|---|---|
| Asisten SPV | Depot yang ditugaskan kepadanya |
| SPV | Depot milik para Asisten SPV bawahannya |
| Manajer | Depot milik Asisten di bawah SPV bawahannya (tiga tingkat) |
| Peran lain | Tidak diturunkan dari hierarki (kosong) |
| Semua peran | Hasil turunan **ditambah** depot titipan langsung |

Catatan layar: "Depot tanpa asisten hanya terlihat oleh HQ ke atas. Ini anak tangga paling bawah — tanpa ini, rantai di atasnya tidak menghasilkan depot apa pun." Pengaturan asisten depot hanya bisa dilakukan di sini (ubah depot biasa tidak bisa), agar Manajer tidak menggambar ulang cakupannya sendiri.

### Prosedur: Menugaskan Asisten SPV ke depot

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Di bagian "Asisten SPV tiap depot" pilih akun pada pemilih "Asisten supervisor untuk {depot}". | Tersimpan. Toast: "Tersimpan. Berlaku di seluruh service dalam 60 detik." |
| 2 | Untuk melepas, pilih "Belum ditugaskan". | Depot kembali hanya terlihat oleh HQ ke atas. Gagal: "Gagal menyimpan. Coba lagi." |

### Prosedur: Mengatur atasan dan depot titipan satu akun

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Di bagian "Posisi satu akun di rantai" gunakan "Cari staf" (petunjuk "Ketik nama atau nomor HP") atau "Pilih akun". Bila banyak cocok: "{n} staf lain cocok — persempit pencarian." | Muncul "Atasan langsung", "Bawahan langsung", "Depot binaan (dari hierarki)", "Depot titipan langsung". Sebelum memilih: "Pilih akun untuk melihat atasan, bawahan, dan depot binaannya." |
| 2 | Tetapkan atasan. | Layar menerangkan dampak: "Tautan ini juga memberi akses depot (rantai Asisten SPV → SPV → Manager)." atau "Tautan ini hanya garis pelaporan — tidak menambah depot yang bisa dilihat." (untuk peran di luar rantai, termasuk kurir). Belum punya atasan: "Belum punya atasan. Semua staf boleh punya atasan, termasuk kurir." |
| 3 | Untuk depot di luar hierarki: "+ Tambah depot langsung" ("Di luar penurunan hierarki — untuk depot yang belum punya asisten, atau titipan sementara."). Untuk mencabut gunakan tombol hapus pada baris. | Berlaku dalam 60 detik. |

**Penolakan server [V]:** "Seseorang tidak bisa menjadi atasan dirinya sendiri." dan "Penugasan ini membentuk lingkaran atasan-bawahan." (rantai melingkar). Bila data akun gagal dibaca: "Data orang ini gagal dibaca — belum ketahuan apakah tautan ini menambah akses depot."

**Propagasi:** cache cakupan depot di semua layanan 60 detik. **[V]** Atasan di kartu karyawan HR sudah dihapus; garis pelaporan hanya dicatat di sini.

> **[SCREENSHOT REQUIRED: SS-admin-06 — /hq/hierarchy bagian "Asisten SPV tiap depot" dan panel "Posisi satu akun di rantai" dengan atasan, bawahan, depot binaan]**
> *Gambar 10.6 — Hierarki pembinaan.*

### 6.9 Kunci API (/hq/api-keys)

**Tujuan:** Memberi mitra kredensial untuk memanggil API mitra. **Peran:** Admin (`platformAdmin`). **Titik awal:** Rail "Sistem" > "Kunci API". **[V]**

Cara kerja (kutipan layar): "Kunci dipakai mitra untuk memanggil /api/v1/partner/* lewat header x-api-key. Cakupan ditegakkan per rute (webhooks:read, webhooks:write) dan pencabutan berlaku pada permintaan berikutnya. Kolom terakhir dipakai menunjukkan apakah kunci benar-benar dipanggil."

### Prosedur: Membuat kunci API

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Tekan "＋ Buat kunci". | Dialog "Buat kunci API". |
| 2 | Isi "Nama" (contoh "Gateway pembayaran"), "Cakupan" (pisah koma, contoh `payments:read, payments:write`), "Lingkungan" (Produksi atau Staging). | — |
| 3 | Simpan. | Dialog "Secret kunci API" menampilkan secret sekali: "Salin sekarang — secret ini hanya ditampilkan sekali dan tidak bisa dilihat lagi." |
| 4 | Salin ke penyimpan rahasia (pengelola kata sandi atau brankas perusahaan). Serahkan ke mitra lewat saluran aman. | Sistem hanya menyimpan awalan dan hash; secret tidak dapat dilihat lagi. |

**Masa berlaku:** bawaan 365 hari saat membuat dan saat memutar. **[V]** Hanya cakupan `webhooks:read` dan `webhooks:write` yang ditegakkan per rute saat ini. **[D]** Beri cakupan sesempit mungkin.

**Memutar dan mencabut:**
- "Rotasi": dialog "Rotasi kunci?" — "Secret lama kunci "{name}" akan berhenti berlaku dan secret baru ditampilkan sekali." ID kunci tetap. Tidak bisa untuk kunci yang dicabut. Koordinasikan waktu dengan mitra karena kunci lama langsung mati.
- "Cabut": dialog "Cabut kunci?" — "Kunci "{name}" tidak bisa dipakai lagi setelah dicabut." Berlaku pada permintaan berikutnya. Baris berlabel "Dicabut".
- Kolom "Terakhir dipakai" / "Belum pernah": kunci yang tak pernah dipakai layak dicabut.

Kosong: "Belum ada kunci API." **Jangan menuliskan secret di tiket, chat, atau dokumen apa pun.**

### 6.10 Webhook (/hq/webhooks)

**Tujuan:** Mengirim event ke sistem mitra. **Peran:** Admin. **Titik awal:** "Sistem" > "Webhooks". **[V]**

Kutipan layar: "Endpoint yang berlangganan menerima POST bertanda tangan per event (X-Hydromart-Signature atas timestamp dan body). Kegagalan diulang dengan jeda menaik dan dihentikan setelah enam percobaan; angka keberhasilan di bawah dihitung dari percobaan nyata."

### Prosedur: Menambah endpoint webhook

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Tekan "＋ Endpoint". | Dialog "Tambah webhook". |
| 2 | Isi "URL endpoint" (contoh `https://example.com/hooks/hydromart`) dan "Event" (pisah koma, contoh `order.created, payment.settled`). | Alamat diperiksa keamanannya (alamat internal atau tidak aman ditolak) **[D]**; pemeriksaan diulang pada tiap percobaan kirim. |
| 3 | Simpan. | "Kunci tanda tangan — salin sekarang": "Hanya ditampilkan sekali. Mitra memakainya untuk memverifikasi header X-Hydromart-Signature di setiap kiriman; tanpa itu, siapa pun yang tahu URL-nya bisa memalsukan kiriman." |
| 4 | Serahkan kunci ke mitra lewat saluran aman. | — |

**Perilaku [V]:** tanda tangan `sha256=<hmac>` atas `"<timestamp>.<body>"`. Batas waktu kirim 10 detik. Maksimal 6 percobaan; jeda 1 menit, 5 menit, 25 menit, 2 jam 5 menit, 10 jam 25 menit, lalu status DEAD. Pemrosesan tiap 5 menit.

**Aksi lain:** "Riwayat pengiriman" (alasan gagal pada "Alasan gagal:"), "Kirim ulang" ("Pengiriman diantrekan ulang"), "Hapus" (dialog "Hapus webhook?" — "Endpoint {url} akan berhenti menerima event."). Kosong: "Belum ada webhook."

### 6.11 Feature flag dan pengaturan platform (/hq/flags)

**Tujuan:** Mengatur rollout fitur dan pengaturan platform. **Peran:** Admin untuk mengubah (Head office dan Direktur dapat membaca daftar flag lewat API, tetapi layar ini tidak tampil di rail mereka). **Titik awal:** "Sistem" > "Feature flags" ("Rollout fitur jaringan & pengaturan platform"). **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Pilih status flag: ROLLOUT, AKTIF, BETA, MATI. | Toast: `Status "{name}" diubah ke {state}`. |
| 2 | Perhatikan banner "Belum ditegakkan" pada flag tertentu. | "Tidak ada layanan yang membaca flag ini. Mengubahnya menyimpan status di sini, tapi tidak menyalakan atau mematikan apa pun di aplikasi — sampai layanan yang bersangkutan dibuat membacanya." |

**Penting:** sebagian flag belum dibaca layanan mana pun; mengubahnya hanya menyimpan status. Daftar flag yang belum ditegakkan belum ditentukan **[K]**. Jangan menjanjikan efek bisnis dari flag bertanda "Belum ditegakkan".

**Kartu "Pengaturan platform":** "Zona waktu" (zona IANA, ≤64 karakter), "Mata uang" (hanya IDR; pesan server "currency hanya mendukung IDR"), "Radius layanan default" (bilangan bulat 1–100 km). **[V]**

### 6.12 Retensi dan backup (/hq/retention)

**Tujuan:** Mengatur berapa lama data disimpan dan membuang data yang melewati masa simpan. **Peran:** Admin. **Titik awal:** "Sistem" > "Retensi & backup" ("Masa simpan per dataset & status backup terakhir"). **[V]**

Dataset yang tampil: Embedding wajah (absen), Log audit, Bukti pengantaran (PoD), Notifikasi & pesan, Data karyawan (HR), Pesanan & transaksi. Kolom: Dataset, Masa simpan, Hari, Aksi.

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Tekan "Ubah" pada dataset. Isi label ("Label yang ditampilkan, mis. "7 tahun (UU PDP)"") dan jumlah hari. Tekan "Simpan". | Toast "Masa simpan diperbarui". Orang lain yang mengubah lebih dulu: "Orang lain sudah mengubah data ini sejak Anda membukanya…" |
| 2 | Tekan "Pratinjau (tanpa menghapus)". | "Pratinjau: {n} baris memenuhi syarat, {gaps} dataset belum ditegakkan. Belum ada yang dihapus." |
| 3 | Bila hasil pratinjau sesuai, tekan "Jalankan sapuan retensi". | Konfirmasi: "Hapus permanen {n} baris sesuai pratinjau barusan? Data pelanggan yang terhapus tidak bisa dikembalikan dari layar ini." |
| 4 | Konfirmasi. | "Sapuan selesai: {n} baris dihapus, {gaps} dataset belum ditegakkan." |

**Aturan [V]:**
- Data keuangan (kelas FINANCIAL, mis. Pesanan & transaksi) **tidak pernah dihapus**; batas bawah 3650 hari (10 tahun); layar menulis "Tidak dihapus".
- Dataset audit memiliki batas bawah 365 hari; mengubah di bawah batas ditolak dengan alasan.
- Masa simpan 0 atau kurang berarti menyimpan semuanya.
- Sapuan hanya menghapus dataset yang memiliki pelaksana; lainnya dilaporkan "belum ditegakkan". Pemicu otomatis berjalan harian pukul 03:30 WIB setelah cadangan pukul 03:00. **[V]**
- **Jangan menjalankan sapuan tanpa pratinjau.** Konfirmasi tanpa pratinjau memperingatkan: "Jalankan sapuan tanpa pratinjau? Baris yang lewat masa simpan akan dihapus permanen, dan jumlahnya belum pernah kamu lihat. Pratinjau dulu lebih aman."
- Kartu "Status backup": "Backup terakhir", "Uji restore" (kosong "Belum ada backup", "Belum pernah diuji"). Dilaporkan oleh dump harian dan uji restore mingguan di server.

> **[SCREENSHOT REQUIRED: SS-admin-07 — /hq/retention tabel dataset, tombol "Pratinjau (tanpa menghapus)", hasil pratinjau, dan kartu "Status backup"]**
> *Gambar 10.7 — Retensi dan pratinjau sapuan.*

### 6.13 Kebijakan keamanan dan sesi (/hq/security)

**Tujuan:** Mengatur batas menganggur sesi dan melihat sesi aktif. **Peran:** Admin. **Titik awal:** "Sistem" > "Keamanan & 2FA" ("Kebijakan sesi, 2FA, dan sesi aktif"). **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Isi "Sesi berakhir otomatis" dalam "menit idle" (1–1440; bawaan 15). | Teks: "Ditegakkan: sesi yang menganggur lebih lama dari ini harus masuk ulang." |
| 2 | (Opsional) Isi "IP allowlist" (satu CIDR per baris, maksimal 100; kosong = akses dari mana saja). | Lihat peringatan di bawah. |
| 3 | Tekan "Simpan pengaturan". | Toast "Pengaturan keamanan disimpan". |

**Fakta [V]:**
- **Tidak ada saklar 2FA.** Komentar kode menyatakan saklar "Wajib 2FA" sudah dihapus karena platform tidak punya faktor kedua. Kunci kamus "Wajib 2FA" masih ada tetapi tidak ditampilkan. Jangan menjanjikan 2FA.
- **Batas menganggur** dibaca layanan akun dengan cache 60 detik dan **hanya diperiksa saat token disegarkan** (token akses hidup 15 menit). Jadi batas ini lantai, bukan stopwatch. Bila kebijakan tidak terbaca, tidak ada batas (gagal terbuka). Sesi yang melampaui batas dicabut seluruh keluarganya dan pengguna harus masuk lagi ("The session was idle for too long.").
- **IP allowlist** hanya menolak permintaan API mitra (header x-api-key) dari alamat di luar daftar. **Tidak berlaku untuk konsol HQ**: peringatan layar "DITEGAKKAN SEBAGIAN. … Konsol HQ ini TIDAK ditegakkan: permintaannya masuk lewat gateway, dan admin-service tidak bisa melihat menembusnya." **[B]**
- Komentar di awal berkas halaman (yang menyebut idle dan allowlist tidak dibaca apa pun) sudah usang; kode layanan akun kini menegakkan batas menganggur. **[B]**

**Sesi aktif:** daftar perangkat Anda sendiri yang sedang masuk ("Sesi ini", "Perangkat", "Lokasi", IP; "Perangkat tak dikenal"). Tekan "Akhiri" pada sesi yang tidak Anda kenal; toast "Sesi diakhiri". Kosong: "Tidak ada sesi aktif lain." Layar ini hanya mencantumkan sesi **milik Anda**, tidak sesi staf lain. **[V]**

Token: akses 900 detik (15 menit), penyegar 30 hari; setiap penyegaran memutar token, dan pemakaian ulang token lama mencabut seluruh keluarga ("This session was terminated for security reasons."). Mengganti nomor telepon mencabut semua sesi. **[V]**

### 6.14 Wizard HQ (/hq/wizard)

Daftar periksa awal untuk akun Admin ("Selamat datang di HQ" — "Selesaikan langkah ini untuk menyiapkan jaringan"; "{done} dari {total} selesai"). Lima langkah: "Verifikasi 2FA akun kamu" (Amankan akun HQ dengan OTP), "Tambah depot pertama", "Undang head office", "Atur harga & PPN", "Aktifkan kanal pembayaran". Tombol: "Mulai", "Tandai selesai" ("Langkah ditandai selesai"), "Batalkan" ("Langkah dibuka kembali"), "Selesai". Selesai semua: "Semua langkah selesai. Konsol siap dipakai!" Status disimpan per akun; langkah bersifat penasihat dan **tidak diturunkan dari kondisi sebenarnya** (hanya dicentang manual). **[V]** Langkah "Verifikasi 2FA" menyesatkan karena 2FA tidak ada **[B]**. Jangan menganggap centang wizard sebagai bukti konfigurasi.

### 6.15 Konten dwibahasa (/hq/content)

Editor kamus ID/EN ("Editor kamus ID/EN dengan status terjemahan"): "Cari kunci atau teks…", filter "Hanya belum diterjemahkan", kolom Kunci / Indonesia / English, penanda "belum diterjemahkan". **Penyuntingan hanya lokal**: layar tidak menulis ke berkas atau server. Tombol "Lihat diff / Salin" menghasilkan "Usulan perubahan en/*.ts" untuk ditempel pengembang ke berkas kamus EN ("Tempel baris ini ke berkas kamus EN terkait, lalu simpan."). Perubahan tidak berlaku sebelum pengembang memasukkannya. **[V]**

### 6.16 Pengaturan global versus pengaturan depot

**Tujuan:** Memahami di mana tiap pengaturan diubah dan siapa yang boleh. **[V]**

| Layar | Rute | Cakupan | Siapa |
|---|---|---|---|
| Pengaturan (editor generik) | /dashboard/settings | Beralih "Default jaringan" atau "Depot tertentu"; layanan: Pengiriman & Kurir, Order & Ongkir, Payout & Komisi, Loyalty / Poin, Referral, Depot & Galon | Gerbang: Manajer dan Admin ("Khusus manajer depot — Editor pengaturan hanya untuk manajer depot dan super admin.") |
| Pengaturan depot | /dashboard/depot-settings | Satu depot: Radius layanan, Jam operasi, Deposit galon, Order aktif per kurir | Pengelola depot; catatan layar: "Perubahan pengaturan berlaku untuk depot ini saja & tercatat di audit log. Nonaktifkan depot lewat head office." |
| Konfigurasi Gaji | /hr/settings | "Cakupan": Default jaringan atau Depot tertentu | Global hanya Admin: "Hanya SUPER_ADMIN yang dapat mengubah default GLOBAL." |
| Pengaturan platform | /hq/flags | Seluruh platform | Admin |

**Aturan:**
- Mengubah **default jaringan (global)** butuh kapabilitas `settingsGlobal` (hanya Admin): "Hanya SUPER_ADMIN yang dapat mengubah default global."
- Mengubah **satu depot** (override) butuh `depotAdmin` (Manajer, Admin). Membaca butuh `settingsRead`.
- Tombol "Ikut default" menghapus override depot dan kembali ke default jaringan. Sebagian nilai hanya global: "Nilai ini diatur secara global untuk seluruh jaringan, tidak bisa di-override per depot."
- "Batas auto-pass approval" (`approvalAutoPassIdr`): kapabilitas `approvalThresholdWrite` dipegang Head office dan Admin, tetapi karena kelas pengendali butuh `depotAdmin` juga, **hanya Admin yang efektif** (Bab 9 bagian 6.30). Rentang 0–100.000.000; bawaan Rp100.000 **[K]**.
- **Nilai go-live yang diputuskan pemilik (2026-09-25)** adalah DATA yang harus Admin isi di /dashboard/settings: diskon keanggotaan (kode bawaan 2/5/8% Silver/Gold/Platinum) dan kedaluwarsa poin (`pointExpirySweepEnabled`=1, `pointExpiryMonths`=12). Sebelum diisi, poin tidak pernah kedaluwarsa. **[K]**

### 6.17 Audit log (/hq/audit)

**Tujuan:** Menelusuri siapa melakukan apa. **Peran:** Admin (juga Head office, Direktur). **Titik awal:** "Sistem" > "Log audit" ("Jejak tak terubah lintas layanan"). **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka halaman. | Tabel Pelaku, Peran, Objek, Aksi, Waktu; 100 baris per halaman + muat lagi; "Sistem" untuk aksi otomatis. |
| 2 | Tekan "Ekspor". | `audit-{YYYY-MM-DD}.xlsx` (sheet "Audit"; kolom Pelaku, Peran, Objek, Aksi, Waktu) berisi seluruh jejak. Bila terlalu besar: "Jejak audit terlalu besar untuk diekspor utuh. Persempit dulu rentang atau saringannya — berkas sepotong lebih berbahaya daripada tidak ada berkas." Kosong: "Belum ada aktivitas." |

**Yang dicatat [V]:** (1) kejadian masuk: permintaan daftar, OTP terverifikasi atau gagal, kirim ulang, token disegarkan atau dipakai ulang, keluar, keluar dari semua perangkat, penggantian nomor (nomor disamarkan); (2) mutasi berhak istimewa lewat pencatat di tiap layanan (aksi diturunkan dari rute dan kata kerja "created", "changed", "deleted"; target dari ID di jalur; isi permintaan disamarkan untuk kunci yang cocok secret, token, password, apikey, signature, otp, pin); (3) UU PDP: permintaan dibuat, diekspor, dianonimkan, ditolak, dan `staff.account.deleted`; (4) kejadian lintas layanan seperti `depot.suspend`.

**Keterbatasan [B]:**
- **Tidak ada saringan atau pencarian** di layar (API mendukung aksi dan pelaku tetapi halaman tidak memakainya). Untuk menemukan satu kejadian, ekspor lalu saring di Excel. Pesan ekspor "Persempit dulu rentang atau saringannya" tidak dapat dituruti di layar ini.
- Catatan "append-only — tidak bisa diubah atau dihapus" berlaku untuk pengguna. Baris dapat dibuang oleh sapuan retensi setelah masa simpan (batas bawah 365 hari).
- Kegagalan menulis audit tidak menghalangi aksi; hanya dicatat di log server.
- Layar lain: "Jejak audit" di konsol depot (/dashboard/audit; chip Semua / Harga / Pengembalian dana / Staf; per depot; tanpa ekspor) dan "Log Audit" di HR (/hr/audit; filter entity; menampilkan 8 karakter awal ID pelaku, bukan nama).

### 6.18 Penanganan akun dan pemulihan akses

Bagian ini menjelaskan apa yang bisa dan tidak bisa dilakukan. Jangan mengatasi masalah akses dengan meminjam akun orang lain atau berbagi akun Admin.

| Situasi | Yang dapat dilakukan | Catatan |
|---|---|---|
| Staf lupa atau tidak menerima OTP | Periksa nomor di Direktori staf; minta ia mencoba lagi setelah jeda 60 detik. Penyebab umum di dokumen operasi: saldo pengirim SMS habis (tindakan pemilik sistem) **[D]**. | Batas laju OTP 20 per 60 detik per IP. |
| Staf berganti nomor | Pengguna mengganti nomor sendiri (OTP ke nomor baru); semua sesi dicabut. | Tidak ada fitur Admin untuk mengganti nomor orang lain **[D]**. |
| Staf kehilangan ponsel | Nonaktifkan akun (bagian 6.5). Mengundang nomor baru membuat akun baru, bukan memindahkan akun lama **[D]**; konsultasikan dengan HR agar kartu karyawan tidak ganda. | Token lama hidup hingga 15 menit. |
| Staf keluar dari perusahaan | Nonaktifkan; bila diminta hapus data, Hapus (bagian 6.6). Kartu HR diperbarui oleh HR. | Hapus tidak dapat dibatalkan. |
| Akun salah peran | Undang ulang dengan peran benar (bagian 6.3). | Mengaktifkan kembali akun nonaktif. |
| Akun tidak menemukan depot | Periksa hierarki (bagian 6.8) dan depot penempatan (bagian 6.4). | Cache 60 detik. |
| Hak yang diharapkan tidak ada | Periksa Tampilan per peran dan matriks (bagian 6.1). | Perubahan butuh 30–45 detik. |
| Admin tunggal kehilangan ponsel | **Tidak ada jalur pemulihan lewat layar.** Eskalasi ke pemilik sistem/pengembang untuk pemulihan di tingkat basis data **[K]**. | Karena itu angkat Admin kedua sekarang. |
| Admin terakhir dinonaktifkan | Tidak dijaga kode; tidak ada jalur layar untuk mengaktifkan kembali. | Eskalasi seperti di atas **[B]**. |
| Akun terindikasi disalahgunakan | Nonaktifkan; tinjau Log audit; periksa "Sesi aktif" milik Anda; putar kunci API bila relevan. | Tidak bisa memaksa keluar perangkat orang lain. |
| Akun pelanggan (bukan staf) | Gunakan Permintaan data (UU PDP) atau Fraud & risiko ("Blokir" menonaktifkan login). | Penghapusan staf menolak akun pelanggan. |

**Pelindung Admin yang ada [V]:** tidak bisa menghapus diri sendiri; tidak bisa menghapus Super admin aktif terakhir; Super admin tidak dapat dilepas dari `accessMatrixWrite`; Admin selalu lolos pemeriksaan hak. **Tidak ada pelindung** untuk menonaktifkan diri sendiri atau Admin terakhir.

**Praktik yang disarankan:** (1) minimal dua Admin berbeda orang dengan ponsel masing-masing; (2) tinjau daftar Admin berkala; (3) setiap perubahan peran bernilai tinggi dicatat dengan alasan dan persetujuan tertulis; (4) tidak ada akun bersama; (5) kunci API dan kunci tanda tangan hanya disimpan di penyimpan rahasia perusahaan.

### 6.19 Privasi dan penonaktifan

**Penonaktifan versus penghapusan:**

| | Nonaktifkan | Hapus |
|---|---|---|
| Dapat dibatalkan | Ya ("Aktifkan"; atau undang ulang) | Tidak |
| Data | Tetap utuh | Identitas dianonimkan; kartu karyawan dianonimkan; token penyegar dihapus |
| Sesi | Gagal saat disegarkan; token akses hidup ≤15 menit | Berakhir saat penyegaran berikutnya |
| Data keuangan | Utuh | Tetap disimpan tanpa pemilik (10 tahun) |

**Permintaan data pelanggan (UU PDP):** Head office dan Admin mengerjakan /hq/pdp (Bab 9 bagian 6.29). Batas jawab 72 jam sejak permintaan dibuat (bukan sejak verifikasi, berbeda dengan halaman publik **[B]**). Menyetujui salinan: berkas JSON; pelanggan hanya dapat mengunduh 7 hari ("Persetujuan ekspor sudah lewat 7 hari. Kirim permintaan baru untuk data terkini."). Ekspor tidak memuat riwayat pesanan/pembayaran (retensi keuangan 10 tahun) dan saldo loyalti. Menyetujui hapus: pelanggan dianonimkan di semua layanan, token dihapus. Menolak butuh alasan. Cakupan penghapusan (ERASED / EXEMPT / UNENFORCED / FAILED) dicatat di metadata audit; bila ada UNENFORCED atau FAILED, tindak lanjuti dengan pengembang. **[V]**

**Penghapusan akun staf:** halaman publik `/hapus-akun` menyebut permintaan akun staf ditangani melalui HRD atau kantor pusat; eksekusinya oleh Admin (bagian 6.6). Alamat email privasi di halaman publik perlu diverifikasi sebelum dikutip (dokumen go-live mencatat tidak ada MX pada 2026-09-25). **[K]**

**Retensi:** bagian 6.12. Bukti pengantaran 12 bulan; data keuangan 10 tahun. **[V]**

**Hukum:** Tinjauan pihak ketiga atas bukti persetujuan UU PDP belum ada (dokumen hukum internal). **[K]**

### 6.20 Layar HQ lain yang memiliki kemampuan khusus Admin

- **Kesehatan sistem:** kartu "Antrean efek pesanan" (tombol "Tiriskan sekarang"; Menunggu / Selesai / Menyerah) dan "Bangun ulang read model" (Ramalan, Rekomendasi; tombol "Bangun ulang") hanya tampil bagi Admin. **[V]** Gunakan hanya atas arahan pengembang.
- **Model prakiraan:** cakupan GLOBAL hanya Admin ("Hanya SUPER_ADMIN yang boleh menulis cakupan GLOBAL."). **[V]**
- **Kebijakan SLA** (/hq/sla-policy), **Program loyalti**, **Segment**, **Broadcast**, **Aturan harga**, **Voucher formulir**: terbuka bagi Admin. **[V]**
- **Direktori depot:** Admin dapat membuat, mengubah, dan menangguhkan depot (Bab 9 bagian 6.3).
- **Tutup buku:** Admin dapat membuka kembali hari yang ditutup (Bab 9 bagian 6.30).

---

## 7. Kolom wajib dan aturan validasi (ringkasan)

| Layar | Kolom wajib | Aturan penting |
|---|---|---|
| Undang staf | Nomor telepon, Peran; Posisi, Tanggal masuk, Status kepegawaian, Gaji (selain Pemilik waralaba); Depot untuk Staf depot dan Kepala depot | Nomor Indonesia sah; gaji > 0; nama ≤120; posisi ≤80. **[V]** |
| Impor staf | phone, role, position, joinDate, employmentStatus, salaryType | Maksimal 500 baris; kegagalan per baris tidak menghentikan baris lain. **[V]** |
| Hapus staf | Ketik ulang nama | Tidak boleh diri sendiri atau Super admin aktif terakhir. **[V]** |
| Matriks hak akses | — | Maksimal 256 perubahan; 32 peran per kapabilitas; Super admin tetap pada `accessMatrixWrite`. **[V]** |
| Hierarki | Pilih akun / depot | Tidak boleh atasan diri sendiri; tidak boleh melingkar. **[V]** |
| Kunci API | Nama, Cakupan, Lingkungan | Secret sekali tampil; bawaan 365 hari. **[V]** |
| Webhook | URL endpoint, Event | Maksimal 6 percobaan; kunci tanda tangan sekali tampil. **[V]** |
| Retensi | Label, hari | Keuangan ≥3650 hari dan tidak dibuang; audit ≥365 hari. **[V]** |
| Keamanan | Menit idle | 1–1440; IP allowlist ≤100 baris, ≤64 karakter per baris. **[V]** |
| Pengaturan platform | Zona waktu, Mata uang, Radius | Mata uang hanya IDR; radius 1–100 km. **[V]** |
| Penolakan UU PDP | Alasan | Wajib. **[V]** |

Aksi Admin yang berjalan **tanpa konfirmasi**: Nonaktifkan atau Aktifkan staf, mengubah flag, mengubah depot penempatan (ada konfirmasi), Akhiri sesi. Periksa dua kali.

---

## 8. Kesalahan umum dan solusi

| Pesan atau gejala | Arti | Solusi |
|---|---|---|
| "Peran {ROLE} hanya boleh diberikan oleh {…}." | Peran terbatas, pemberi tidak berwenang. | Admin memberi sendiri; Manajer: Admin atau HR. |
| "Peran staf depot wajib terikat ke satu depot." | Staf depot atau Kepala depot tanpa depot. | Pilih depot. |
| "hr-service belum dikonfigurasi; undangan staf tidak bisa diproses." | Layanan HR tidak tersambung. | Eskalasi ke pengembang; akun belum dibuat atau tanpa kartu. |
| `"X" is not a valid Indonesian mobile number.` | Nomor tidak sah. | Periksa nomor. |
| "dailyRate wajib diisi untuk tipe gaji DAILY" / "monthlyRate wajib diisi untuk tipe gaji MONTHLY" | Gaji tidak lengkap (pesan server). | Isi nilai gaji sesuai tipe. |
| "Akun sendiri tidak bisa dihapus." | Pelindung hapus. | Minta Admin lain. |
| "Ini super admin terakhir. Angkat super admin lain dulu sebelum menghapus." | Pelindung hapus. | Angkat Admin lain dulu. |
| "Capability tidak dikenal: X" | Versi layar dan server tidak sinkron. | Muat ulang. |
| "SUPER_ADMIN tidak boleh dilepas dari accessMatrixWrite." | Pelindung. | Pertahankan. |
| "Seseorang tidak bisa menjadi atasan dirinya sendiri." / "Penugasan ini membentuk lingkaran atasan-bawahan." | Hierarki tidak sah. | Pilih atasan lain. |
| "currency hanya mendukung IDR" | Mata uang lain tidak didukung. | Gunakan IDR. |
| "Orang lain sudah mengubah data ini sejak Anda membukanya…" | Konflik penyimpanan bersamaan. | Periksa data terbaru lalu simpan lagi. |
| Layar "Khusus HQ" pada layar Admin | Akun bukan Super admin, atau matriks diubah. | Pastikan akun; periksa Tampilan per peran. |
| Grid matriks tampak bawaan semua | Muat gagal tertutup bawaan **[B]**. | Jangan menyimpan; muat ulang. |
| Undangan dari /dashboard/staff ditolak | Kolom wajib tidak terkirim **[B]**. | Gunakan /hq/staff. |
| 403 setelah aksi | Hak peran pengguna kurang. | Periksa matriks. |

---

## 9. Batasan peran

Admin sangat berkuasa, tetapi tidak berarti tanpa batas:

| Batas | Penjelasan |
|---|---|
| Tidak bisa menghapus akun sendiri atau Admin aktif terakhir | Dijaga server. |
| Tidak bisa melepas diri dari `accessMatrixWrite` | Dijaga server. |
| Tidak bisa memaksa keluar perangkat pengguna lain | Fitur tidak tersedia. |
| Tidak bisa melihat atau memulihkan secret kunci API/webhook | Hanya tampil sekali. |
| Tidak bisa mengubah aturan pemberian peran lewat layar | Konstanta kode (bagian 6.7). |
| Tidak bisa memulihkan akun terhapus | Anonim dan permanen. |
| Tidak bisa menghapus data keuangan lewat retensi | Dilindungi; 10 tahun. |
| Tidak bisa menyimpan edit "Konten dwibahasa" | Hanya diff untuk pengembang. |
| Pengaju tidak boleh menyetujui pengajuan payout sendiri | Server tetap memaksa, termasuk untuk Admin. |
| Tidak dapat mengubah label status/pesan Inggris | Perlu pengembang. |
| Perubahan hak peran lain memengaruhi orang nyata | Butuh persetujuan pemilik proses. |

Ada hal yang butuh pihak lain: peran Manajer boleh diberikan HR juga; keputusan hukum (PPN, PPh 21, bukti persetujuan UU PDP) butuh akuntan atau penasihat hukum; pemulihan Admin tunggal butuh pengembang/pemilik sistem.

---

## 10. Pertimbangan keamanan

1. **Jangan berbagi akun Admin.** Setiap Admin pribadi, ponsel pribadi. Alasan: akuntabilitas audit, dan kontrol hanya satu faktor (OTP telepon).
2. **Prinsip hak minimum.** Hindari memberi kapabilitas yang kuat (`accessMatrixWrite`, `staffAdmin`, `platformAdmin`, `hqPayout`) kepada peran luas. Tinjau tiap kuartal.
3. **Pemisahan tugas.** Jangan menjadi satu-satunya pengaju dan penyetuju payout atau refund. Server menolak menyetujui pengajuan payout sendiri; untuk refund tidak ada pengecekan serupa. **[B]**
4. **Secret.** Secret kunci API dan kunci tanda tangan webhook hanya tampil sekali; simpan di penyimpan rahasia perusahaan. Jangan menuliskannya di dokumen, tiket, chat, atau layar bersama. Putar kunci bila orang yang pernah memegangnya pergi.
5. **IP allowlist tidak melindungi konsol.** Jangan mengandalkannya untuk membatasi akses HQ. **[B]**
6. **Tidak ada 2FA.** Lindungi ponsel Admin (kunci layar, SIM tidak dipinjamkan). Bila nomor diambil alih, penyerang menjadi Admin.
7. **Penonaktifan tidak instan.** Token akses lama hidup hingga 15 menit.
8. **Perubahan matriks langsung berlaku dalam menit.** Uji pada peran yang tidak kritis dahulu; siapkan cara membatalkan (catat diff).
9. **Retensi permanen.** Selalu pratinjau sebelum sapuan.
10. **Data pribadi.** Akses Customer 360, Direktori staf, dan ekspor audit seperlunya.
11. **Jejak audit.** Aksi tulis penting tercatat atas nama Anda; kegagalan menulis audit tidak menghalangi aksi, sehingga jangan mengandalkan log sebagai satu-satunya kontrol.
12. **Pemeriksaan sesi.** Periksa "Sesi aktif" milik Anda secara berkala dan "Akhiri" yang tak dikenal.

---

## 11. Kegiatan akhir hari dan berkala

| Frekuensi | Kegiatan | Bagian |
|---|---|---|
| Harian | Kesehatan sistem: layanan "Mati", sapuan "Gagal"/"Terlambat". | Bab 9, 6.28 |
| Harian | Permintaan UU PDP: tidak ada yang "LEWAT BATAS 3x24 jam". | Bab 9, 6.29 |
| Harian | Pengajuan akses dari staf (layar salah, akun terkunci). | 6.18 |
| Mingguan | Status backup dan uji restore di Retensi & backup. | 6.12 |
| Mingguan | Webhook: riwayat pengiriman gagal atau DEAD. | 6.10 |
| Bulanan | Tinjau daftar Direktori staf: akun nonaktif, peran bernilai tinggi, Admin. | 6.2, 6.5 |
| Bulanan | Tinjau Log audit untuk perubahan matriks, peran, kunci API. | 6.17 |
| Kuartal | Tinjau matriks hak akses; bandingkan dengan nilai bawaan. | 6.1 |
| Kuartal | Tinjau kunci API: "Terakhir dipakai", masa berlaku (bawaan 365 hari), putar atau cabut. | 6.9 |
| Kuartal | Tinjau hierarki: depot tanpa asisten. | 6.8 |
| Kuartal | Tinjau kebijakan retensi dan pratinjau sapuan. | 6.12 |
| Tahunan | Putar semua kunci API dan kunci tanda tangan. | 6.9, 6.10 |
| Saat terjadi | Staf keluar: nonaktifkan, hapus bila diminta. | 6.5, 6.6 |

---

## 12. Skenario praktis

**Skenario 1 — Mengangkat Direktur baru.** Pemilik menyetujui secara tertulis. Admin membuka /hq/staff > "＋ Undang staf", mengisi nomor dan nama, memilih peran "Direktur", mengisi Posisi, Tanggal masuk, Status kepegawaian, dan Gaji, lalu "Kirim undangan". Admin memberi tahu orangnya lewat saluran lain. Head office tidak dapat melakukan ini.

**Skenario 2 — Menyiapkan Manajer dan cakupan depotnya.** HR atau Admin memberi peran Manajer. Admin membuka /hq/hierarchy: tugaskan Asisten SPV pada tiap depot, atur SPV sebagai atasan para Asisten, lalu Manajer sebagai atasan para SPV. Tunggu 60 detik lalu minta Manajer memeriksa daftar depotnya.

**Skenario 3 — Nomor salah ketik pada undangan.** Admin mengundang nomor yang ternyata milik akun lain. Karena nomor yang sudah ada **dipromosikan** (peran dan nama berubah), akun orang lain bisa berubah peran. Segera undang ulang nomor itu dengan peran semula, lalu periksa Log audit. Hindari dengan memeriksa nomor dua kali sebelum "Kirim undangan". Perhatikan: undang ulang juga mengaktifkan akun yang nonaktif.

**Skenario 4 — Staf berhenti mendadak.** Admin menekan "Nonaktifkan" pada /hq/staff. Beri tahu bahwa akses bisa tersisa hingga sekitar 15 menit. Cabut kunci API yang dipegangnya bila ada. Minta HR memperbarui kartu karyawan. Bila ia meminta data dihapus, gunakan "Hapus" setelah memastikan ia bukan Admin terakhir.

**Skenario 5 — Memberi Finance hak tambahan sementara.** Admin menambah kapabilitas ke kolom Finance di matriks, mencatat diff, menyimpan, memberi tahu pemilik proses, lalu mengembalikan ("Batalkan" tidak cukup setelah tersimpan: buka matriks, cabut, simpan lagi atau reset ke bawaan). Catat kapan hak dicabut.

**Skenario 6 — Mitra butuh integrasi.** Admin membuat kunci API (cakupan sempit, Staging dulu), menyalin secret ke penyimpan rahasia, menyerahkan ke mitra lewat saluran aman. Admin menambah webhook, menyerahkan kunci tanda tangan, mengirim satu event uji, memeriksa "Riwayat pengiriman". Setelah siap, buat kunci Produksi dan cabut kunci Staging.

**Skenario 7 — Permintaan hapus akun staf.** Admin memastikan identitas peminta lewat HR, memeriksa bahwa tidak ada tanggungan (payout, kasbon) di HR dan keuangan, menonaktifkan, lalu "Hapus" dengan mengetik ulang nama. Pastikan `employeeAnonymised` sukses; periksa HR.

---

## 13. Daftar periksa penyelesaian

- [ ] Saya masuk dengan akun Admin pribadi dan tidak pernah berbagi akun.
- [ ] Ada minimal dua Admin berbeda orang.
- [ ] Saya paham matriks berlaku 30–45 detik dan hierarki 60 detik.
- [ ] Saya paham mencabut Super admin dari baris matriks tidak berefek.
- [ ] Saya tahu siapa boleh memberi peran apa (tabel bagian 6.7).
- [ ] Saya tahu menonaktifkan akun tidak langsung mematikan token (hingga 15 menit).
- [ ] Saya tahu Hapus akun tidak dapat dibatalkan dan penjaga yang ada.
- [ ] Saya tahu tidak ada 2FA dan IP allowlist tidak berlaku untuk konsol.
- [ ] Saya menyimpan secret hanya di penyimpan rahasia perusahaan.
- [ ] Saya selalu melakukan Pratinjau sebelum sapuan retensi.
- [ ] Saya tahu mengundang staf dilakukan di /hq/staff, bukan /dashboard/staff.
- [ ] Saya tahu pemulihan Admin tunggal memerlukan pengembang.

---

## 14. Inventaris screenshot bab ini

| ID | Layar | Kondisi | Status |
|---|---|---|---|
| SS-admin-01 | Rail /hq akun Super admin | Semua grup terlihat | Belum diambil |
| SS-admin-02 | /hq/access grid | Satu sel diubah; banner dan tombol terlihat | Belum diambil |
| SS-admin-03 | Panel "Ringkasan perubahan" | Contoh satu kapabilitas | Belum diambil |
| SS-admin-04 | Formulir undang staf | 12 peran terlihat; data sintetis | Belum diambil |
| SS-admin-05 | /hq/staff daftar akun | Tombol Nonaktifkan dan Hapus; nomor disamarkan | Belum diambil |
| SS-admin-06 | /hq/hierarchy | Asisten SPV tiap depot dan posisi akun | Belum diambil |
| SS-admin-07 | /hq/retention | Pratinjau dan Status backup | Belum diambil |
| SS-admin-08 | /hq/api-keys | Dialog secret (isi disamarkan) | Belum diambil |
| SS-admin-09 | /hq/webhooks | Riwayat pengiriman dengan satu gagal | Belum diambil |
| SS-admin-10 | /hq/security | Kebijakan sesi dan Sesi aktif | Belum diambil |
| SS-admin-11 | /hq/flags | Banner "Belum ditegakkan" dan Pengaturan platform | Belum diambil |
| SS-admin-12 | /hq/audit | Tabel dan tombol Ekspor | Belum diambil |

Samarkan secret, nomor telepon, dan alamat IP. Tempatkan SS-admin-08 sampai SS-admin-12 di prosedur terkait (6.9–6.13, 6.17) saat gambar diambil; placeholder tambahan berikut mewakili layar tersebut:

> **[SCREENSHOT REQUIRED: SS-admin-08 — /hq/api-keys dialog "Secret kunci API" dengan peringatan "Salin sekarang"; nilai secret disamarkan]**
> *Gambar 10.8 — Secret kunci API ditampilkan sekali.*

> **[SCREENSHOT REQUIRED: SS-admin-09 — /hq/webhooks daftar endpoint dan "Riwayat pengiriman" dengan satu pengiriman gagal dan tombol Kirim ulang]**
> *Gambar 10.9 — Riwayat pengiriman webhook.*

> **[SCREENSHOT REQUIRED: SS-admin-10 — /hq/security kolom "Sesi berakhir otomatis", IP allowlist dengan peringatan "DITEGAKKAN SEBAGIAN", dan daftar Sesi aktif]**
> *Gambar 10.10 — Kebijakan keamanan dan sesi aktif.*

> **[SCREENSHOT REQUIRED: SS-admin-11 — /hq/flags daftar flag dengan banner "Belum ditegakkan" dan kartu "Pengaturan platform"]**
> *Gambar 10.11 — Feature flag dan pengaturan platform.*

> **[SCREENSHOT REQUIRED: SS-admin-12 — /hq/audit tabel Pelaku, Peran, Objek, Aksi, Waktu dan tombol Ekspor]**
> *Gambar 10.12 — Log audit.*

---

## 15. Catatan celah dan hal yang perlu dikonfirmasi

Rujuk juga ke `17-open-questions`.

| No | Celah | Dampak | Tag |
|---|---|---|---|
| 1 | Undangan di /dashboard/staff tidak mengirim kolom wajib (position, joinDate, employmentStatus, salaryType); kemungkinan ditolak 400. Hasil runtime belum diuji. | Gunakan /hq/staff; perbaikan perlu pengembang. | [B][D] |
| 2 | Tidak ada 2FA. Kunci kamus "Wajib 2FA", rail "Keamanan & 2FA", dan langkah wizard "Verifikasi 2FA akun kamu" menyesatkan. | Risiko pemahaman keliru; OTP satu-satunya faktor. | [B] |
| 3 | /hq/audit tidak punya saringan atau pencarian; pesan ekspor menyarankan menyaring. | Cari lewat ekspor. | [B] |
| 4 | Menonaktifkan akun tidak mencabut token; akses sisa hingga 15 menit; tidak ada paksa-keluar untuk akun lain. | Tidak ada pemutusan instan. | [B] |
| 5 | Menonaktifkan diri sendiri atau Admin terakhir tidak dijaga. | Risiko terkunci; pemulihan butuh pengembang. | [B] |
| 6 | Tidak ada tombol "ubah peran"; undang ulang juga mengaktifkan akun nonaktif. | Salah ketik nomor dapat mengubah akun lain. | [B] |
| 7 | Grid matriks diam-diam menampilkan nilai bawaan bila muat gagal. | Menyimpan dari kondisi ini berbahaya. | [B] |
| 8 | Mencabut Super admin dari baris matriks tidak berefek; peran lain dapat diberi `accessMatrixWrite` tanpa pelindung. | Perlu kebijakan tertulis. | [B][D] |
| 9 | IP allowlist hanya untuk API mitra; komentar kode halaman keamanan usang. | Jangan mengandalkannya untuk HQ. | [B] |
| 10 | Wizard HQ dicentang manual, tidak diturunkan dari kondisi nyata. | Centang bukan bukti. | [B] |
| 11 | Konten dwibahasa hanya menghasilkan diff, tidak menyimpan. | Butuh pengembang. | [V] |
| 12 | Beberapa flag "Belum ditegakkan"; daftarnya belum ditentukan. | Jangan menjanjikan efek. | [K] |
| 13 | Head office dapat menciptakan sesama Head office dan Pemilik waralaba (tak dibatasi). | Konfirmasi kebijakan. | [K] |
| 14 | Batas jawab UU PDP dihitung dari saat permintaan dibuat; halaman publik menyebut "sejak diverifikasi"; tidak ada peringatan otomatis. | Selaraskan teks. | [B] |
| 15 | Alamat email privasi pada halaman publik belum punya MX pada 2026-09-25. | Verifikasi sebelum dikutip. | [K] |
| 16 | Aksi sistem yang menulis audit memakai nama aksi turunan dari rute; bentuk persis (mis. untuk perubahan matriks) belum dipastikan. | Konfirmasi dengan contoh nyata. | [D] |
| 17 | Apakah penangguhan depot mencabut akses sesi staf depot (teks dialog "kehilangan akses") belum ditelusuri. | Jangan menjanjikan pemutusan instan. | [D] |
| 18 | Tidak ada jalur layar untuk pemulihan Admin tunggal atau mengganti nomor orang lain. | Eskalasi ke pengembang. | [K] |
| 19 | Pengujian di browser nyata belum dilakukan oleh penulis; semua temuan berasal dari pembacaan kode. | Verifikasi sebelum pelatihan. | [D] |
