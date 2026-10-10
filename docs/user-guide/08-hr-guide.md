# Bab 8 — Panduan HR (Sumber Daya Manusia)

| Metadata | Nilai |
|---|---|
| Versi | 0.1 draf |
| Tanggal | 2026-10-10 |
| Klasifikasi | Internal — Terbatas |
| Peran utama | HR (kode: `HR`) |
| Peran terkait | Kantor pusat (`HEAD_OFFICE`), `DIREKTUR`, `FINANCE`, Manajer (`MANAGER`), Supervisor (`SUPERVISOR`), Asisten Supervisor (`ASSISTANT_SUPERVISOR`), Admin (`SUPER_ADMIN`) |

**Legenda tag bukti.** **[V]** terverifikasi di kode · **[D]** disimpulkan, perlu konfirmasi · **[K]** perlu konfirmasi bisnis (nilai berasal dari data/pengaturan) · **[B]** diketahui bermasalah/tidak konsisten. Fitur yang tidak ada ditulis "Tidak tersedia".

> **Penting.** Belum ada pengujian yang dijalankan oleh penulis dokumen ini. Isi bab ini berasal dari pembacaan kode dan temuan analisis. Hak akses yang disebut adalah nilai **bawaan** dari `packages/access/src/index.ts`. Admin (`SUPER_ADMIN`) dapat mengubahnya saat aplikasi berjalan (berlaku sekitar 30 detik). Aturan "siapa boleh memberikan peran apa" (`RESTRICTED_GRANTS`) dan daftar `HR_MANAGED_ROLES` adalah konstanta kode; keduanya **tidak** berubah lewat matriks hak akses. **[V]**

---

## 1. Gambaran peran

HR mengelola data karyawan, kehadiran, cuti, kasbon, penggajian, tunjangan, aset, pengumuman, dan laporan di **konsol HR** (`/hr`). HR juga menjadi pintu masuk untuk membuat akun login karyawan: setiap karyawan baru otomatis dibuatkan akun masuknya, dengan peran sesuai "Jabatan (peran login)". **[V]**

Konsol HR juga dilihat peran lain dengan batasan berbeda. Ringkasan tingkat akses:

| Peran | Tingkat akses di konsol HR (bawaan) |
|---|---|
| HR | Kelola karyawan, penggajian, cuti (tahap 1 dan 2, pada akun berbeda), kasbon, penugasan lintas depot. Paling lengkap. |
| Kantor pusat (`HEAD_OFFICE`), `DIREKTUR` | Kelola karyawan (`hrAdmin`) dan penugasan lintas depot; **tidak** menjalankan penggajian, tunjangan, keputusan cuti di layar, atau kasbon. |
| `FINANCE` | Lihat HR; menjalankan penggajian, tunjangan, laporan beban BPJS perusahaan; tidak mengubah data karyawan. |
| Manajer, Supervisor, Asisten Supervisor | Lihat sebatas depot cakupannya; Manajer juga memutuskan cuti tahap 1 dan kasbon; Asisten Supervisor memutuskan kasbon depotnya. |
| Admin (`SUPER_ADMIN`) | Semua; hanya Admin yang mengubah default GLOBAL konfigurasi gaji. |

## 2. Tujuan & tanggung jawab

1. Menjaga data karyawan lengkap dan benar (identitas, gaji, BPJS, NPWP, kontrak, dokumen).
2. Membuat dan mengubah akun login karyawan lewat jabatan, tanpa menyentuh peran yang bukan wewenang HR.
3. Memantau kehadiran, memutuskan absen yang tertahan, dan mengoreksi dengan alasan tercatat.
4. Menjalankan alur cuti dua tahap dan kasbon sesuai aturan.
5. Menghasilkan, menyetujui, dan menandai dibayar slip gaji tiap bulan, termasuk BPJS dan PPh 21.
6. Mengelola tunjangan, bonus, potongan, aset, pengumuman, kalender kerja, shift, dan kinerja.
7. Mengurus offboarding (karyawan keluar) dengan benar agar login dan penggajian ikut tertib.

## 3. Prasyarat akses

| Prasyarat | Penjelasan | Bukti |
|---|---|---|
| Akun berperan HR | Peran `HR` hanya bisa diberikan oleh Admin. | **[V]** |
| Kemampuan `hrView` | Syarat masuk `/hr/*`. Dimiliki HR, `HEAD_OFFICE`, `DIREKTUR`, `FINANCE`, `MANAGER`, `SUPERVISOR`, `ASSISTANT_SUPERVISOR`, `SUPER_ADMIN`. Tanpa ini tampil layar akses ditolak. | **[V]** |
| Kemampuan `hrAdmin` | Mengubah data karyawan, absensi, aset, shift, kalender, pengumuman, audit, konfigurasi gaji. HR, `HEAD_OFFICE`, `DIREKTUR`, `SUPER_ADMIN`. | **[V]** |
| Kemampuan `hrPayroll` | Menjalankan penggajian, tunjangan, laporan beban BPJS perusahaan. HR, `FINANCE`, `SUPER_ADMIN`. | **[V]** |
| Kemampuan `leaveApprove` | Keputusan cuti tahap 1: `MANAGER`, HR, `SUPER_ADMIN`. Tahap 2 memakai `hrAdmin`. | **[V]** |
| Kemampuan `kasbonApprove` | `ASSISTANT_SUPERVISOR`, `MANAGER`, HR, `SUPER_ADMIN`. | **[V]** |
| Kemampuan `employeeAssign` | Rencanakan/batalkan penugasan lintas depot, putuskan permintaan pinjam: HR, `HEAD_OFFICE`, `DIREKTUR`, `SUPER_ADMIN`. | **[V]** |
| Perangkat | Peramban web; di layar kurang dari 640 px tersedia navigasi bawah. | **[V]** |

> **Catatan hak akses.** Nilai bawaan dari `packages/access/src/index.ts`. Admin dapat mengubahnya saat berjalan (sekitar 30 detik). Menu yang tampil belum tentu berarti server mengizinkan; setiap halaman tetap diperiksa server. **[V]**

## 4. Masuk & pengaturan awal

1. Masuk dengan nomor telepon dan kode OTP.
2. Pilih konsol HR (`/hr`). Jika peran Anda juga peran konsol HQ (`HEAD_OFFICE`, `DIREKTUR`, `FINANCE`, `SUPER_ADMIN`), di rel HR ada pintu ke konsol HQ.
3. Periksa **Konfigurasi Gaji** (`/hr/settings`) sebelum penggajian pertama: jam masuk, toleransi, potongan, BPJS, PPh 21, THR. Banyak nilai bergantung pada pengaturan ini. **[V]**
4. **Tabel TER PPh 21 dikirim kosong.** Tabel hukum TER harus dimuat dengan sengaja; selama kosong, PPh 21 bulanan dihitung dengan metode progresif tahunan. Konfirmasi dengan bisnis/pajak. **[V][K]**
5. Pastikan **Kalender Kerja** (hari libur) dan **Shift** sudah terisi; keterlambatan dan potongan absen bergantung padanya.
6. Pastikan Departemen sudah dibuat bila dipakai.

**Satu hal yang berbeda:** garis atasan (siapa melapor ke siapa) **tidak** diatur di HR. Ia diatur di `/hq/hierarchy` dan hanya oleh Admin. Kolom "Atasan" sudah dihapus dari formulir karyawan. **[V]**

## 5. Menu & modul tersedia

Menu di rel HR (desktop). Di ponsel, 3 tab pertama tampil di bilah bawah; sisanya di "Lainnya" (judul laci "Semua layar HR", tombol "Tutup menu"). **[V]**

| No | Label menu | Rute | Syarat tampil | Bukti |
|---|---|---|---|---|
| 1 | Dashboard | `/hr` | `hrView` | **[V]** |
| 2 | Karyawan | `/hr/employees` | `hrView` (tombol tambah/impor butuh `hrAdmin`) | **[V]** |
| 3 | Departemen | `/hr/departments` | `hrView` | **[V]** |
| 4 | Pelanggan | `/hr/customers` | `hrView` + `depotCrm` (`FINANCE` tidak melihat) | **[V]** |
| 5 | Reseller / Agen | `/hr/resellers` | `hrView` + `resellerView` (`FINANCE`, `ASSISTANT_SUPERVISOR` tidak melihat) | **[V]** |
| 6 | Absensi | `/hr/attendance` | `hrView` | **[V]** |
| 7 | Pengajuan Cuti | `/hr/leave` | `hrView` | **[V]** |
| 8 | Payroll | `/hr/payroll` | `hrView` (aksi butuh `hrPayroll`) | **[V]** |
| 9 | Bonus & Potongan | `/hr/adjustments` | `hrView` | **[V]** |
| 10 | Tunjangan | `/hr/allowances` | `hrView` (tulis butuh `hrPayroll`) | **[V]** |
| 11 | Kasbon | `/hr/loans` (+ `/hr/loans/requests`, `/hr/loans/import`) | `hrView` | **[V]** |
| 12 | Permintaan pinjam karyawan | `/hr/depot-requests` | `employeeAssignRequest` (hanya `MANAGER`, `SUPERVISOR`; HR tidak melihat) | **[V]** |
| 13 | Aset | `/hr/assets` | `hrView` | **[V]** |
| 14 | Pengumuman | `/hr/announcements` | `hrView` | **[V]** |
| 15 | Rule Bonus | `/hr/rules` | `hrAdmin` | **[V]** |
| 16 | Kinerja | `/hr/performance` | `hrView` | **[V]** |
| 17 | Shift & Rotasi | `/hr/shift` | `hrView` | **[V]** |
| 18 | Kalender Kerja | `/hr/calendar` | `hrView` | **[V]** |
| 19 | Laporan | `/hr/reports` | `hrView` | **[V]** |
| 20 | Konfigurasi Gaji | `/hr/settings` | `hrAdmin` | **[V]** |
| 21 | Log Audit | `/hr/audit` | `hrAdmin` | **[V]** |
| 22 | Data saya | `/hr/me` | `hrView` (data diri sendiri; dibahas di panduan karyawan) | **[V]** |

> **[B]** Label string untuk pintu "Konsol HQ" di rel HR belum ditemukan di kamus; kemungkinan hilang. **[D]**

> **[SCREENSHOT REQUIRED: SS-hr-01 — Rel menu konsol HR lengkap (22 item) saat masuk sebagai HR, dengan "Dashboard" aktif]**
> *Gambar 8.1 — Menu konsol HR.*

**Dashboard HR** (`/hr`, "HR Dashboard", subjudul "Periode {YYYY-MM}"): kartu "Total Karyawan", "Payroll (net)", "Run Payroll" (jumlah slip), "Hadir Hari Ini"; "Komposisi Karyawan Aktif"; "Absensi Hari Ini ({tanggal})"; "Payroll {periode}" (Gross/Bonus/Potongan/Net); "Dokumen Kedaluwarsa & Akan Habis (30 hari)" ("Sudah lewat" / "{n} hari lagi"; kosong "Tidak ada dokumen yang perlu diperpanjang."); "Kontrak & Masa Percobaan yang Berakhir (30 hari)" ("Sudah berakhir"); tautan "Kelola Karyawan →", "Jalankan Payroll →", "Unduh Laporan →". Kosong: "Belum ada karyawan" / "Tambahkan karyawan pertama di menu Karyawan." **[V]**

> **[SCREENSHOT REQUIRED: SS-hr-02 — "HR Dashboard" dengan kartu angka, komposisi karyawan, dan daftar dokumen kedaluwarsa (data sintetis)]**
> *Gambar 8.2 — Dashboard HR.*

---

## 6. Prosedur langkah demi langkah

| No | Prosedur |
|---|---|
| 6.1 | Menambah karyawan baru (sekaligus membuat akun login) |
| 6.2 | Mengubah data karyawan, jabatan, depot |
| 6.3 | Membuatkan akun untuk karyawan yang belum punya |
| 6.4 | Mengimpor karyawan dari file |
| 6.5 | Daftarkan wajah karyawan dan unggah dokumen |
| 6.6 | Offboarding: karyawan resign atau dinonaktifkan |
| 6.7 | Mengelola departemen |
| 6.8 | Absensi: koreksi, entri manual, dan persetujuan absen tertahan |
| 6.9 | Shift & rotasi, kalender kerja |
| 6.10 | Cuti dua tahap |
| 6.11 | Kasbon dan pinjaman |
| 6.12 | Penggajian: Draft → Disetujui → Dibayar |
| 6.13 | Tunjangan, bonus, potongan, dan rule bonus |
| 6.14 | Aset karyawan |
| 6.15 | Pengumuman |
| 6.16 | Kinerja |
| 6.17 | Laporan |
| 6.18 | Konfigurasi gaji, aturan, dan audit |
| 6.19 | Penugasan lintas depot dan permintaan pinjam (fitur mati secara bawaan) |

---

### Prosedur 6.1: Menambah karyawan baru

**Tujuan:** Membuat kartu karyawan sekaligus akun login dengan peran yang sesuai.
**Peran:** HR (juga `HEAD_OFFICE`, `DIREKTUR`, `SUPER_ADMIN` yang memegang `hrAdmin`).
**Prasyarat:** Nomor HP karyawan, jabatan, depot penempatan (kecuali Asisten Supervisor/Supervisor/Manager), tanggal masuk, tipe dan nominal gaji.
**Titik awal:** "Karyawan" > tombol "+ Tambah" (`/hr/employees/new`, judul "Tambah Karyawan", subjudul "Kode HR-#### dibuat otomatis"). Tombol hanya tampil bagi pemegang `hrAdmin`. **[V]**

**Kolom formulir** (tanda * = wajib):

| Label di layar | Wajib | Catatan |
|---|---|---|
| Nama lengkap | * | maks 120 |
| Posisi | * | maks 80 |
| No. HP | * | maks 32; dinormalkan ke +628… |
| Email (opsional) | | |
| Depot penempatan | * (kecuali jabatan Asisten Supervisor, Supervisor, Manager) | Placeholder "Pilih depot…". Staf Depot dan Kepala Depot wajib terikat satu depot. |
| Tanggal masuk | * | |
| Jabatan (peran login) | * | Placeholder "Pilih jabatan…". Pilihan: Staf Depot / Kurir, Kepala Depot, Asisten Supervisor, Supervisor, Manager. |
| Status kepegawaian | | Training / Percobaan / Tetap |
| Tipe gaji | | Harian / Bulanan |
| Gaji harian (Rp) atau Gaji bulanan (Rp) | * sesuai tipe | harus lebih dari 0 |
| Nama bank (opsional), No. rekening (opsional) | | |
| Kontak darurat (opsional), No. kontak darurat (opsional) | | |
| Departemen (opsional) | | Tidak aktif sampai depot dipilih; hanya departemen depot itu dan departemen lintas depot. |
| NPWP (opsional), BPJS Kesehatan (opsional), BPJS Ketenagakerjaan (opsional) | | maks 40 |
| NIK KTP (opsional) | | tepat 16 angka |
| Tanggal lahir (opsional), Jenis kelamin (opsional: Laki-laki/Perempuan), Status PTKP (opsional) | | PTKP: TK0…K3 |
| Akhir kontrak (opsional) | | tidak boleh sebelum tanggal masuk |
| Alamat (opsional) | | maks 300 |

Kolom "Tanggal keluar (kosongkan bila masih bekerja)" dan "Status" (Aktif/Nonaktif/Resign) hanya ada di formulir **ubah**. **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka "Karyawan", tekan "+ Tambah". | Formulir "Tambah Karyawan". |
| 2 | Isi "Nama lengkap", "Posisi", "No. HP". | |
| 3 | Pilih "Jabatan (peran login)". | Peran login ini yang menentukan menu yang dilihat karyawan. |
| 4 | Pilih "Depot penempatan" bila wajib. | Daftar "Departemen (opsional)" aktif. |
| 5 | Isi "Tanggal masuk", "Tipe gaji", lalu nominal. | |
| 6 | Isi data opsional (NIK, NPWP, BPJS, bank). | |
| 7 | Tekan "Tambah Karyawan". | **Bila nomor sudah dipakai akun lain**, tampil kartu kuning "Nomor {nomor} sudah dipakai akun atas nama {nama} ({peran}). Menyimpan akan mengubah akun itu menjadi {jabatan} — bukan membuat akun baru. Kalau nomornya salah ketik, betulkan dulu." Tombol berubah menjadi "Ya, gunakan akun itu". |
| 8 | Bila nomor benar dan memang akun itu, tekan "Ya, gunakan akun itu". Bila salah ketik, betulkan nomor. | Mengubah nomor atau jabatan mengulang konfirmasi. Pemeriksaan ini memerlukan hak `customerPhoneLookup` (HR, `HEAD_OFFICE`, `DIREKTUR`, `MANAGER`, `MARKETING`, `SUPER_ADMIN`). |
| 9 | Tunggu hasil. | Toast "Karyawan ditambahkan". Kembali ke daftar. Kode otomatis `HR-0001` dst. |
| 10 | Verifikasi di daftar. | Baris muncul dengan lencana "Aktif". |

**Yang dilakukan server saat menyimpan [V]:**

1. Memeriksa duplikat **sebelum** akun dibuat: "Kode karyawan sudah dipakai", "NIK sudah dipakai karyawan lain", "Nomor telepon ini sudah dipakai karyawan lain", "Akun ini sudah tertaut ke karyawan lain".
2. Membuat akun login di layanan autentikasi dengan peran yang dipilih (nomor yang sudah ada akan **dipromosikan** menjadi staf; bukan akun ganda).
3. Mencatat riwayat kepegawaian "Direkrut".
4. Bila layanan autentikasi tidak tersedia, penyimpanan gagal total.

**Peran yang boleh diberikan HR (`HR_MANAGED_ROLES`):** Staf Depot / Kurir (`STAFF_DEPOT`), Kepala Depot (`KEPALA_DEPOT`), Asisten Supervisor (`ASSISTANT_SUPERVISOR`), Supervisor (`SUPERVISOR`), Manager (`MANAGER`). Peran lain (`HEAD_OFFICE`, `FINANCE`, `HR`, `MARKETING`, `DIREKTUR`, `SUPER_ADMIN`, `FRANCHISE_OWNER`) **tidak bisa** diberikan lewat formulir ini; diberikan di konsol HQ "Direktori staf" oleh yang berwenang. **[V]**

**Aturan pemberian `MANAGER`:** hanya Admin dan HR yang boleh. `HEAD_OFFICE` dan `DIREKTUR` memegang `hrAdmin` tetapi **ditolak** saat mencoba memberikan Manager (keputusan pemilik produk 2026-09-11). Dropdown tetap menampilkan Manager kepada semua pemegang `hrAdmin`, jadi penolakan baru muncul dari server. **[V][B]**

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Jabatan (peran login) wajib diisi." | Jabatan belum dipilih. | Pilih jabatan. |
| "{field} wajib diisi." (dengan nama teknis seperti `fullName`, `phone`, `position`, `joinDate`, `depotId`) | Kolom wajib kosong; nama kolom tampil mentah. | Isi kolom yang disebut. **[B]** |
| "Gaji harian (dailyRate) wajib > 0." / "Gaji bulanan (monthlyRate) wajib > 0." | Nominal gaji kosong atau 0. | Isi nominal sesuai tipe. |
| "NIK harus 16 digit angka." | NIK salah panjang/bukan angka. | Perbaiki. |
| "Akhir kontrak tidak boleh sebelum tanggal masuk." / "Tanggal keluar tidak boleh sebelum tanggal masuk." | Urutan tanggal salah. | Perbaiki tanggal. |
| "Gagal menyimpan." | Kegagalan umum; pesan server tampil bila ada. | Baca pesan; coba lagi. |
| "auth-service menolak permintaan (403)" atau "Gagal menghubungi auth-service: …" | Layanan autentikasi menolak (mis. peran tidak boleh Anda berikan, depot wajib). Pesan jelas dari autentikasi **tidak** diteruskan ke HR. | Periksa peran yang dipilih (Manager hanya HR/Admin) dan depot; bila tetap gagal, minta Admin. **[V][B]** |
| "Departemen {kode} milik depot lain" / "Departemen tidak ditemukan" | Departemen tidak cocok depot. | Pilih departemen depot yang sama atau lintas depot. |

**Hasil akhir:** Kartu karyawan dan akun login ada. Karyawan masuk lewat OTP ke nomor yang didaftarkan.
**Izin & batasan:** Pembuat yang terkunci ke satu depot hanya boleh menambah staf di depotnya. **[V]**

**Daftar periksa:**
- [ ] Nomor HP benar (kartu peringatan tidak menunjukkan akun orang lain).
- [ ] Jabatan sesuai wewenang Anda.
- [ ] Depot terisi untuk Staf Depot dan Kepala Depot.
- [ ] Gaji sesuai tipe.
- [ ] NIK 16 angka bila diisi.

> **[SCREENSHOT REQUIRED: SS-hr-03 — Formulir "Tambah Karyawan" terisi (data sintetis), dropdown "Jabatan (peran login)" terbuka menampilkan lima pilihan]**
> *Gambar 8.3 — Formulir karyawan baru.*

> **[SCREENSHOT REQUIRED: SS-hr-04 — Kartu kuning peringatan "Nomor … sudah dipakai akun atas nama …" dan tombol "Ya, gunakan akun itu"]**
> *Gambar 8.4 — Peringatan nomor sudah dipakai akun lain.*

---

### Prosedur 6.2: Mengubah data karyawan, jabatan, depot

**Tujuan:** Memperbarui data, mengganti jabatan (peran login), atau memindahkan depot permanen.
**Peran:** HR dan pemegang `hrAdmin`. Hanya HR depot asal yang boleh mengubah; depot peminjam melihat data tanpa gaji dan dokumen. **[V]**
**Titik awal:** "Karyawan" > pilih karyawan > "Edit" (`/hr/employees/detail/edit?id=`, judul "Edit Karyawan").

Halaman detail karyawan (dapat dibaca `hrView`) menampilkan: No. HP, Email, Departemen, Jabatan (login), Depot, Tanggal masuk, Tanggal keluar (bila ada), Masa kerja, Tipe gaji, Nominal gaji, Bank, Kontak darurat, NPWP, BPJS Kesehatan, BPJS Ketenagakerjaan, NIK KTP, Tanggal lahir, Jenis kelamin, Alamat, Status PTKP, Akhir kontrak. Bagian: Tunjangan, Dokumen, Aset, Pinjaman / Kasbon, "Penugasan lintas depot" (hanya pemegang `employeeAssign`), tautan "Lihat Payroll →", "Riwayat Absensi →", "Kinerja →", kartu "Enroll Wajah" (`hrAdmin`), dan "Riwayat Kepegawaian". **[V]**

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Buka daftar "Karyawan"; cari dengan "Cari nama / kode / posisi…" dan filter "Semua status", "Semua departemen". | Daftar 100 per halaman; filter tersimpan di alamat. Kosong: "Tidak ada karyawan." |
| 2 | Pilih karyawan, tekan "Edit". | Formulir terisi. |
| 3 | Ubah kolom yang perlu. | |
| 4 | Tekan "Simpan Perubahan". | Toast "Karyawan diperbarui". Gagal: "Gagal menyimpan." |

**Efek penting saat mengubah [V]:**

- **Jabatan (peran login) atau depot berubah:** perubahan didorong ke akun login **sebelum** data karyawan disimpan. Jika autentikasi menolak, perubahan gagal.
- Karyawan punya akun tetapi belum ada jabatan: "Karyawan ini punya akun login tapi belum punya jabatan. Isi jabatannya dulu."
- Mengganti jabatan tapi belum ada akun: "Karyawan ini belum punya akun login, jabatannya belum bisa diubah. Buatkan akun dulu."
- **Nama atau telepon berubah:** ikut diperbarui di akun login; ditolak bila nomor milik akun lain.
- **Telepon/NIK/kode berubah:** diperiksa duplikat lagi.
- **Depot berubah:** dicatat sebagai mutasi permanen berlaku hari ini, dan `depotId` serta `homeDepotId` ikut berubah. Ditolak bila karyawan punya penugasan lintas depot yang terjadwal atau berjalan: 409 "Karyawan ini punya penugasan depot yang terjadwal atau berjalan. Batalkan penugasannya dulu."
- **Gaji:** menyentuh tipe atau nominal menata ulang kedua nominal (bulanan tidak menyimpan harian lama).
- **Riwayat:** Status kepegawaian, Jabatan, Peran login, Status, Tanggal keluar, Jenis gaji, Upah harian, Gaji bulanan, Depot dicatat di "Riwayat Kepegawaian" (kosong: "Belum ada riwayat.").
- Mengubah peran/depot karyawan **yang sudah Resign** tidak membuka kembali loginnya. **[V]**

**Masalah umum:** sama seperti Prosedur 6.1, ditambah pesan di atas.

**Daftar periksa:**
- [ ] Perubahan jabatan hanya ke lima peran HR.
- [ ] Tidak ada penugasan lintas depot terbuka sebelum memindahkan depot.
- [ ] Riwayat kepegawaian menunjukkan perubahan.

---

### Prosedur 6.3: Membuatkan akun untuk karyawan yang belum punya

**Tujuan:** Membuat akun login untuk karyawan hasil impor atau data lama.
**Peran:** HR dan `hrAdmin`.
**Titik awal:** "Karyawan" > tombol kuning "Belum punya akun · buatkan" pada baris karyawan. Tombol tampil bila belum ada akun dan status bukan Resign.

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Pastikan karyawan punya jabatan (peran login). Bila belum, ubah dulu (Prosedur 6.2). | Tanpa jabatan: "Karyawan ini belum punya jabatan. Isi jabatannya dulu, baru akunnya bisa dibuat." |
| 2 | Tekan "Belum punya akun · buatkan". | Toast "Akun untuk {nama} dibuat". Gagal: "Gagal membuat akun." |

Aksi ini aman diulang (idempotent). **[V]**

---

### Prosedur 6.4: Mengimpor karyawan dari file

**Tujuan:** Menambah atau memperbarui banyak karyawan.
**Peran:** `hrAdmin`.
**Titik awal:** "Karyawan" > "Import Excel" (`/hr/employees/import`).

Aturan umum semua impor HR: berkas `.xlsx` atau `.csv`, **maksimal 500 baris**; ada "Unduh template Excel"; tampil pratinjau, lalu tombol "Import N baris"; hasil: "N dibuat", "N diperbarui", "N dilewati", "N gagal"; tombol "Unduh baris bermasalah" atau "Unduh baris gagal". **[V]**

**Format kolom impor karyawan** (tanda * wajib):

| Kolom | Wajib | Nilai |
|---|---|---|
| employeeCode | | kosong = otomatis |
| fullName | * | |
| phone | * | nomor HP Indonesia sah |
| depotCode | * | kode depot yang dikenal |
| position | * | |
| departmentCode | | kode departemen dikenal |
| role | * | **hanya `STAFF_DEPOT` atau `KEPALA_DEPOT`** |
| employmentStatus | * | `TRAINING`, `PROBATION`, `PERMANENT` |
| joinDate | * | YYYY-MM-DD |
| contractEndDate, exitDate | | YYYY-MM-DD |
| salaryType | * | `DAILY` atau `MONTHLY` |
| dailyRate, monthlyRate | | sesuai tipe |
| supervisorCode | | kode atasan |
| shiftName | | nama shift dikenal |
| email, nik (16 angka), birthDate, gender (`MALE`/`FEMALE`), address, ptkpStatus, npwp, bpjsKes, bpjsTk, bankName, bankAccount, emergencyName, emergencyPhone | | opsional |

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Unduh template, isi data. Tulis nomor HP dan NIK sebagai **teks** agar tidak menjadi notasi ilmiah. | Notasi ilmiah ditolak. |
| 2 | Unggah file. | Pratinjau baris dan galat per baris. |
| 3 | (Opsional) Centang "Perbarui karyawan yang sudah ada". | Mode perbarui (upsert): pencocokan berdasar employeeCode, lalu NIK, lalu telepon. "Role login tidak pernah ikut berubah." Tanpa centang, orang yang sudah ada **dilewati**. |
| 4 | Tekan "Import N baris". | Setiap baris baru juga membuat/mempromosikan akun login. |
| 5 | Unduh baris bermasalah dan perbaiki. | |

Catatan impor:

- Atasan dirujuk setelah semua baris diproses: "Atasan "X" tidak ditemukan, kolom atasan dikosongkan" atau "Atasan "X" ditolak: …".
- Mode perbarui pada baris tanpa akun: akun dibuat ("Akun login dibuat").
- Jabatan di atas peran impor: "Jabatan X tidak bisa dibuatkan akun lewat impor — buat akun lewat form HR".
- Duplikat ("sudah dipakai"/"tertaut") dihitung dilewati.
- Pesan klien umum: "File kosong atau tidak punya baris data.", "Maksimal 500 baris per file (file ini N).", "Kolom wajib hilang: …", "kolom "k" wajib diisi", ""v" harus format YYYY-MM-DD", ""v" bukan tanggal yang sah", ""v" bukan nomor HP Indonesia yang sah", "kode depot "v" tidak dikenal", "kode departemen "v" tidak dikenal", "shift "v" tidak dikenal", ""v" harus 16 digit angka", "Format lama (.xls / .ods) tidak bisa dibaca…".
- Bila peran Anda tidak boleh: "Impor massal tidak tersedia untuk peran ini" / "Impor massal mengubah data banyak baris sekaligus, jadi izinnya sama dengan mengubahnya satu per satu. Minta ke atasan Anda kalau memang perlu."

> **[SCREENSHOT REQUIRED: SS-hr-05 — Halaman impor karyawan setelah unggah: pratinjau baris, centang "Perbarui karyawan yang sudah ada", tombol "Import N baris"]**
> *Gambar 8.5 — Impor karyawan.*

Format impor modul lain dirangkum di Bagian 7.2.

---

### Prosedur 6.5: Daftarkan wajah karyawan dan unggah dokumen

**Tujuan:** Menyiapkan verifikasi wajah untuk absensi dan menyimpan dokumen karyawan.
**Peran:** `hrAdmin`.
**Titik awal:** Detail karyawan.

**Enroll wajah** (kartu "Enroll Wajah"): petunjuk "Ambil 1–3 foto wajah yang jelas untuk verifikasi absensi."

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Minta karyawan berada di depan kamera. Tekan "Ambil Foto" (maks 3 foto). | Petunjuk: "Gerakkan kepala sedikit / kedipkan mata saat mengambil foto." |
| 2 | Centang persetujuan "Karyawan ini menyetujui data wajahnya dipakai untuk absensi (direkam sekarang)". | Tombol "Simpan Enroll" aktif hanya setelah dicentang. |
| 3 | Tekan "Simpan Enroll" (atau "Reset" untuk mengulang). | Toast "Wajah berhasil di-enroll" atau "Gagal enroll wajah". |
| 4 | Untuk menghapus: tekan "Hapus data wajah". | Konfirmasi "Hapus data wajah karyawan ini dan tarik persetujuannya?" lalu toast "Data wajah dihapus". |

**Dokumen** (kartu "Dokumen"): "Jenis dokumen" (KTP, Kartu Keluarga, Kontrak Kerja, NPWP, Sertifikat, SIM, Lainnya), file jpeg/png/webp/pdf **maks 5 MB**, tanggal berlaku opsional. Versi tampil "v{n}" dan "v{n} (diganti)"; tombol "Lihat". Tanggal berlaku memberi makan daftar 30 hari di dashboard. Pesan: "Tipe file tidak didukung (jpeg, png, webp, pdf)", "Ukuran file melebihi 5MB", "File dokumen wajib diunggah". Membaca dokumen cukup `hrView`; mengunggah butuh `hrAdmin`. **[V]**

> **[SCREENSHOT REQUIRED: SS-hr-06 — Kartu "Enroll Wajah" dengan tiga bingkai foto, kotak persetujuan dicentang, dan tombol "Simpan Enroll"]**
> *Gambar 8.6 — Enroll wajah karyawan.*

---

### Prosedur 6.6: Offboarding — karyawan resign atau dinonaktifkan

**Tujuan:** Menutup hubungan kerja dengan benar: login ikut mati, gaji berhenti pada tanggal yang tepat.
**Peran:** `hrAdmin` (HR, `HEAD_OFFICE`, `DIREKTUR`, `SUPER_ADMIN`).
**Titik awal:** "Karyawan" > karyawan > "Edit".

> **Tidak ada tombol "terminate" atau wizard offboarding.** Offboarding dilakukan dengan mengubah **Status** menjadi "Resign" (`RESIGNED`) atau "Nonaktif" (`INACTIVE`) **dan** mengisi **Tanggal keluar**. **[V]**

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Pastikan tidak ada penugasan lintas depot yang terbuka untuk karyawan (batalkan bila ada). | Untuk mengubah depot diperlukan; untuk resign sebaiknya bersih **[D]**. |
| 2 | Buka "Edit". Isi "Tanggal keluar (kosongkan bila masih bekerja)" dengan hari terakhir bekerja. | |
| 3 | Ubah "Status" menjadi "Resign" (untuk keluar permanen) atau "Nonaktif" (sementara). | Petunjuk di layar: "Status RESIGNED tidak menghentikan gaji — isi tanggal keluar, itu yang dibaca payroll." |
| 4 | Tekan "Simpan Perubahan". | Akun login dinonaktifkan sebelum data disimpan. Bila panggilan ke autentikasi gagal, penyimpanan gagal. |
| 5 | Siapkan slip gaji bulan terakhir dengan tombol "Generate" per karyawan (Prosedur 6.12). | Batch "Buat sedepot" hanya mencakup karyawan berstatus Aktif. |
| 6 | Kembalikan aset yang dipegang (Prosedur 6.14). | |
| 7 | Hentikan tunjangan dan pinjaman bila perlu. | |

**Efek terhadap login [V]:**

| Status | Akun login | Gaji |
|---|---|---|
| Aktif | Aktif. | Normal. |
| Nonaktif | **Ditangguhkan** (SUSPENDED). Ditolak saat masuk dengan OTP dan saat pembaruan sesi: "This account has been suspended." (artinya "Akun ini ditangguhkan."). | Dibaca dari Tanggal keluar. |
| Resign | **Ditangguhkan**, sama seperti Nonaktif. | Dibaca dari Tanggal keluar; **penggajian menolak** baris Resign tanpa Tanggal keluar. |
| Kembali Aktif | Akun diaktifkan kembali. | Normal. |

- Token akses yang sudah terbit **tidak dicabut seketika**; tetap berlaku sampai habis masa berlakunya (15 menit), dan token pembaruan tidak dicabut eksplisit sehingga pemblokiran terjadi pada pembaruan/masuk berikutnya. **[V][D]**
- Mengaktifkan ulang akun dari konsol HQ ("Direktori staf") hanya menyalakan Nonaktif; karyawan berstatus Resign **tidak** ditimpa oleh penyalaan balik. **[V]**
- Penghapusan akun staf (hanya Admin) menganonimkan data karyawan. Sapuan retensi menganonimkan karyawan yang sudah keluar: biometrik, absensi, dan kinerja dihapus; payroll, bonus, potongan, dan kasbon disimpan tanpa pemilik (catatan keuangan 10 tahun). **[V]**
- Mengisi Tanggal keluar lalu mengosongkannya (rehire) pada baris Resign membuat penggajian menolak lagi; ubah juga statusnya. **[V]**

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Karyawan berstatus RESIGNED tanpa tanggal keluar. Isi tanggal keluar (exitDate) dulu sebelum membuat payroll {periode}." | Resign tanpa tanggal. | Isi Tanggal keluar. |
| "Karyawan tidak bekerja pada periode {p} (masuk {tanggal}, keluar {tanggal})" | Periode di luar masa kerja. | Cek tanggal masuk/keluar. |

**Daftar periksa offboarding:**
- [ ] Tanggal keluar terisi.
- [ ] Status Resign/Nonaktif disimpan.
- [ ] Slip gaji terakhir dihasilkan per karyawan.
- [ ] Aset dikembalikan.
- [ ] Pinjaman/tunjangan ditinjau.
- [ ] Penugasan lintas depot terbuka dibatalkan.

---

### Prosedur 6.7: Mengelola departemen

**Tujuan:** Mengatur unit kerja karyawan.
**Peran:** Lihat: `hrView`. Tambah/ubah/hapus: `hrAdmin`.
**Titik awal:** "Departemen" (`/hr/departments`; subjudul "Unit kerja karyawan. Tanpa depot = berlaku lintas depot (Keuangan, HR).").

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Isi "Kode" (huruf, angka, tanda hubung; maks 20), "Nama" (maks 80), "Depot" ("Semua depot" = lintas depot). | Kode salah: "code hanya boleh huruf, angka, dan tanda hubung". Kosong: "Isi kode & nama". |
| 2 | Tekan "Tambah". | "Departemen ditambahkan". Kode sama: 409 "Kode departemen sudah dipakai". |
| 3 | Gunakan "Nonaktifkan"/"Aktifkan" atau "Hapus". | Hapus: konfirmasi "Hapus departemen {nama}? …". Masih dipakai: "Departemen masih dipakai {n} karyawan. Pindahkan mereka dulu, atau nonaktifkan departemennya." |

---

### Prosedur 6.8: Absensi — koreksi, entri manual, persetujuan absen tertahan

**Tujuan:** Menjaga catatan kehadiran sebagai dasar penggajian.
**Peran:** Lihat: `hrView`. Koreksi, entri manual, impor, keputusan absen tertahan: `hrAdmin`.
**Titik awal:** "Absensi" (`/hr/attendance`, subjudul "{n} catatan").

Filter: "Dari"/"Sampai" (tanggal), dan `?employeeId=` dari tautan di detail karyawan. Baris: nama (atau "Karyawan dianonimkan"), tanggal, jam masuk–pulang, "+Nm" terlambat, status. **[V]**

Status: Hadir, Terlambat, Absen, Cuti, Libur, dan "Menunggu persetujuan" (khusus sistem).

**A. Koreksi status**

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Pada baris, ubah dropdown status (Hadir/Terlambat/Absen/Cuti/Libur). | Dialog "Koreksi absensi": "Ubah status dari {dari} menjadi {ke}. Alasannya tercatat di baris absensi dan dibaca ulang saat penggajian dipertanyakan." |
| 2 | Isi alasan (**wajib**, maks 200). | |
| 3 | Tekan "Koreksi". | Toast "Dikoreksi". |
| 4 | (Opsional) buka "Lihat riwayat koreksi". | Kosong: "Belum pernah dikoreksi." |

**B. Entri / koreksi manual** (kartu "Entri / koreksi manual"): pilih karyawan, "Tanggal", Status (bawaan Cuti), "Alasan" (kosong → "Entri manual"), tekan "Simpan". Kosong: "Isi employeeId & tanggal". Sukses: "Absensi manual disimpan". **Hanya untuk hari tanpa catatan**; bila sudah ada: 409 "Hari itu sudah punya catatan kehadiran — ubah lewat koreksi pada baris tersebut, bukan absen manual". **[V]**

**C. Absen menunggu persetujuan** (kartu "Absen menunggu persetujuan ({jumlah})"): "Terkirim jauh setelah waktu absen sehingga jamnya berasal dari perangkat, atau diambil di luar area semua depot yang jadi tanggung jawabnya. Belum dihitung hadir."

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Periksa skor kecocokan wajah (persen; merah bila di bawah 75%). Unduh foto lewat tombol "Foto masuk · cocok N%" atau "Foto pulang · …". | Gagal: "Foto absensi tidak tersedia." |
| 2 | Tekan "Setujui" (catatan opsional "Catatan persetujuan (opsional)") atau "Tolak" (opsional "Alasan penolakan (opsional)"). | Setuju → Terlambat bila ada menit terlambat, selain itu Hadir. Tolak → **Absen** (potongan absen berlaku). Toast "Absen disetujui"/"Absen ditolak". |

Pesan terkait: "Absen ini sudah diputuskan"; "Absen offline sudah terlalu lama. Minta entri manual ke HR."; "Di luar area absen depot ({n} m dari titik). Absen harus di lokasi." Supervisor tanpa depot induk di luar semua area absen ditahan sebagai menunggu HR. **[V]**

**D. Impor riwayat absensi** (tombol "Import Riwayat Absensi", `hrAdmin`): kolom employeeCode*, workDate*, status*, lateMinutes. Hanya hari lampau yang belum punya catatan; lateMinutes hanya untuk status Terlambat.

> **[SCREENSHOT REQUIRED: SS-hr-07 — Halaman "Absensi" dengan kartu "Absen menunggu persetujuan" dan dialog "Koreksi absensi" terbuka (data sintetis)]**
> *Gambar 8.7 — Koreksi dan persetujuan absensi.*

---

### Prosedur 6.9: Shift & rotasi, kalender kerja

**Tujuan:** Mengatur jadwal kerja yang dipakai menilai keterlambatan.
**Peran:** Lihat: `hrView`. Tulis: `hrAdmin`.

**Shift & Rotasi** (`/hr/shift`; "Jadwal kerja per karyawan. Absensi menilai terlambat terhadap shift karyawan, bukan shift depot."):

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | "Pola Rotasi Mingguan": tekan "Buat Rotasi", isi "Nama rotasi". | Dapat diaktifkan/dinonaktifkan. |
| 2 | "Penugasan Karyawan": pilih "Karyawan", "Jenis" (Shift tetap / Rotasi mingguan), "Berlaku mulai", "Catatan (opsional)". Tekan "Tugaskan". | Toast "Penugasan shift dicatat". Kosong: "Pilih karyawan dan shift/rotasi". Server: "Isi salah satu: shiftId atau rotationId". |
| 3 | Catatan: "Penugasan bersifat tambah — penugasan lama tetap tersimpan sebagai riwayat. Karyawan tanpa penugasan tetap dinilai terhadap shift depot seperti sebelumnya." | |

Impor riwayat shift: employeeCode*, shiftName* (harus sama dengan nama di Shift), effectiveFrom* (YYYY-MM-DD), note. Menghapus shift yang dipakai ditolak: "Shift ini masih dipakai {n} data (jadwal, rotasi, atau karyawan). Nonaktifkan shift ini daripada menghapusnya."

**Kalender Kerja** (`/hr/calendar`; "Hari libur & shift — dipakai kalkulasi keterlambatan + potongan absen"):

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | "Hari Libur": isi Tanggal, Nama, "Berlaku untuk" (Semua depot atau satu depot). Tambah. | "Hari libur ditambahkan". Kosong: "Isi tanggal & nama". Ganda: 409 "Tanggal ini sudah terdaftar sebagai hari libur". |
| 2 | "Shift": isi Nama, Mulai, Selesai. Tambah. | "Shift ditambahkan"; kosong "Isi nama shift". "Nonaktifkan"/"Aktifkan" → "Shift dinonaktifkan"/"Shift diaktifkan". |

Hari libur dan libur mingguan dikeluarkan dari hari kerja cuti dan hitungan absen. **[V]**

---

### Prosedur 6.10: Cuti dua tahap

**Tujuan:** Memproses pengajuan cuti lewat atasan (tahap 1) lalu HR (tahap 2).
**Peran:** Tahap 1: pemegang `leaveApprove` (Manager, HR, Admin). Tahap 2: HR/pemegang `hrAdmin` pada layar yang melayani tahap itu. **[V]**
**Titik awal:** "Pengajuan Cuti" (`/hr/leave`, subjudul "Tahap 1 atasan, tahap 2 HR. Persetujuan HR menulis absensi berstatus Cuti."). Penyaring bawaan: "Menunggu atasan". 20 per halaman.

**Alur status:**

| Status (label) | Arti | Pindah ke |
|---|---|---|
| Menunggu atasan (`PENDING_MANAGER`) | Menunggu keputusan tahap 1. | Menunggu HR (setujui), Ditolak, Dibatalkan |
| Menunggu HR (`PENDING_HR`) | Menunggu keputusan tahap 2. | Disetujui, Ditolak, Dibatalkan |
| Disetujui | Final. Absensi berstatus Cuti ditulis untuk tiap hari kerja; kuota terpakai bertambah; karyawan diberi notifikasi. | – |
| Ditolak | Final. Catatan wajib. | – |
| Dibatalkan | Dibatalkan oleh karyawan dari tahap 1 atau 2. | – |

**Aturan pemisahan tugas [V]:**

- Pemohon tidak boleh memutuskan cuti sendiri: 403 "Tidak bisa memutuskan pengajuan cuti Anda sendiri".
- Pemutus tahap 2 harus orang lain dari pemutus tahap 1: 403 "Tahap kedua harus diputuskan orang lain, bukan pemutus tahap pertama".
- Akibatnya HR sendirian tidak dapat menyelesaikan kedua tahap; perlu akun lain (Manager atau HR/Admin lain) di tahap 1.
- `HEAD_OFFICE` dan `DIREKTUR` memegang `hrAdmin` tetapi bukan `leaveApprove`, sehingga **tidak dapat memutuskan cuti di layar**; mereka melihat "Menunggu keputusan HR." Server hanya memeriksa `hrAdmin` untuk tahap 2, jadi perbedaan ini ada di antarmuka. **[V][B]**

**Prosedur memutuskan:**

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Buka "Pengajuan Cuti". Pilih penyaring status bila perlu ("Semua status" + 5 status). | Baris: nama, lencana status, jenis, "dd – dd · N hari kerja", alasan, "Catatan: …". |
| 2 | Pada baris yang dapat Anda putuskan, isi kolom catatan ("Catatan (wajib bila menolak)"). | |
| 3 | Tekan "Setujui" atau "Tolak". | Toast "Pengajuan disetujui" / "Pengajuan ditolak". Gagal: "Gagal memproses". |

**HR mengajukan cuti atas nama karyawan** (tombol "Ajukan cuti untuk karyawan", `hrAdmin`):

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Pilih "Karyawan". Isi "Jenis cuti" (bawaan Sakit; pilihan Cuti tahunan, Sakit, Izin, Darurat), "Mulai", "Selesai", "Alasan" (semua wajib). | Kurang: "Lengkapi karyawan, tanggal, dan alasan." |
| 2 | Tekan "Ajukan". | "Pengajuan cuti tercatat dan masuk antrean." Gagal: "Pengajuan cuti gagal." Pengajuan masuk antrean normal (menunggu atasan); mengajukan bukan berarti menyetujui. |

**Aturan pengajuan [V]:**

| Pesan | Arti |
|---|---|
| "Tanggal selesai sebelum tanggal mulai" | Rentang terbalik. |
| "Rentang tanggal tidak memuat hari kerja" | Seluruhnya libur/akhir pekan. |
| "Sudah ada pengajuan cuti pada rentang tanggal tersebut" (409) | Tumpang tindih dengan pengajuan menunggu/disetujui. |
| "Sisa kuota cuti {n} hari, pengajuan {m} hari" (409) | Kuota tidak cukup. |
| "Alasan penolakan wajib diisi" (400) | Menolak tanpa catatan. |
| "Pengajuan berstatus {S} tidak bisa {aksi}" (409) | Status tidak mengizinkan. |

**Kuota:** Cuti tahunan dan Izin mengurangi kuota; Sakit dan Darurat tidak. Kuota bawaan 12 hari (dapat diubah di Konfigurasi Gaji, kunci `annualLeaveQuotaDays`), dihitung proporsional pada tahun pertama bekerja. **[V]**

**Impor saldo cuti** (tombol "Import Saldo Cuti" → `/hr/leave/balances-import`, "Import Saldo Cuti Awal"): kolom employeeCode*, year* (2000–2100), quotaDays* (0–365), usedDays (0–365, tidak boleh melebihi quotaDays: "usedDays tidak boleh melebihi quotaDays"). Tahun yang sudah ada ditimpa dan dilaporkan "diperbarui". Maks 500 baris.

> **[SCREENSHOT REQUIRED: SS-hr-08 — Halaman "Pengajuan Cuti" penyaring "Menunggu atasan" dengan baris pengajuan dan tombol "Setujui"/"Tolak"]**
> *Gambar 8.8 — Antrean cuti.*

---

### Prosedur 6.11: Kasbon dan pinjaman

**Tujuan:** Memutuskan kasbon yang diajukan karyawan dan mencatat pinjaman berjalan.
**Peran:** Lihat: `hrView`. Putuskan pengajuan: `kasbonApprove` (Asisten Supervisor, Manager, HR, Admin). Catat/hentikan pinjaman: `hrAdmin`.
**Titik awal:** "Kasbon" (`/hr/loans`, judul "Pinjaman / Kasbon", subjudul "{n} kasbon").

**A. Daftar pinjaman.** Penanda "Hanya yang masih berjalan" (aktif bawaan). Tautan "Antrean pengajuan kasbon" dan "Import kasbon berjalan →". Baris: nama · kode, "Mulai {periode} · cicilan {Rp}", catatan, "Sisa {Rp}", lencana Lunas / Berjalan / Dihentikan. Kosong: "Belum ada pinjaman." **[V]**

**B. Memutuskan pengajuan** (`/hr/loans/requests`, "Antrean Kasbon", "{n} pengajuan menunggu keputusan"):

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Buka antrean; penyaring bawaan Menunggu keputusan. | Kosong: "Tidak ada pengajuan kasbon di depot Anda." |
| 2 | Untuk menyetujui isi "Cicilan per bulan (Rp)" dan "Mulai potong (YYYY-MM)", opsional "Catatan". Tekan "Setujui". | "Kasbon disetujui." Dibuat pinjaman; potongan muncul di daftar kasbon dan di slip gaji. Kurang: "Cicilan dan bulan mulai wajib diisi untuk menyetujui." |
| 3 | Untuk menolak isi alasan, tekan "Tolak". | "Kasbon ditolak." Tanpa alasan: "Alasan penolakan wajib diisi." |

**Aturan server [V]:**

| Pesan | Arti |
|---|---|
| "Kasbon sendiri tidak bisa Anda setujui." | Pemohon tidak bisa memutuskan kasbonnya. |
| "Kasbon ini diputuskan oleh asisten supervisor depotnya." (403) | **Bila depot punya Asisten Supervisor tercatat, hanya dia yang boleh memutuskan; HR dan Manager ditolak.** Bila tidak ada asisten, naik ke pihak yang cakupannya mencakup depot. |
| "Pengajuan ini sudah diputuskan." / "Pengajuan ini sudah dijawab orang lain. Muat ulang daftarnya." (409) | Keputusan ganda. |
| "Cicilan per bulan harus bilangan bulat lebih dari 0" / "Bulan mulai potong harus format YYYY-MM" | Input salah. |
| "Keputusan gagal disimpan." | Kegagalan umum. |

Status: Menunggu keputusan, Disetujui, Ditolak, Dibatalkan (oleh karyawan).

**C. Mencatat pinjaman langsung** (kartu "Pinjaman / Kasbon" di detail karyawan; `hrAdmin`; tanpa persetujuan): isi "Pokok pinjaman (Rp)", "Cicilan / bulan (Rp)", "Mulai periode" (bulan), "Catatan (opsional)"; "Tambah Pinjaman". Pesan: "Pokok pinjaman harus > 0.", "Cicilan per bulan harus > 0.", toast "Pinjaman ditambahkan". "Hentikan" (gagal: "Gagal menghentikan pinjaman").

**D. Impor kasbon berjalan** (`/hr/loans/import`): employeeCode*, principal* (**sisa** pinjaman per startPeriod, bukan pinjaman awal), installmentAmount*, startPeriod* (YYYY-MM), note. Halaman tidak dibatasi layar, tetapi server menolak non-`hrAdmin`.

**Di penggajian:** cicilan dipotong sebagai "Cicilan pinjaman"/"Cicilan: {catatan}". Bila gaji bersih menjadi negatif, cicilan dikecilkan atau ditunda lebih dulu. **[V]**

---

### Prosedur 6.12: Penggajian — Draft → Disetujui → Dibayar

**Tujuan:** Menghasilkan, menyetujui, dan menandai dibayar slip gaji bulanan.
**Peran:** Lihat: `hrView` (termasuk Manager, Supervisor, Asisten Supervisor menurut cakupan, `FINANCE`, `HEAD_OFFICE`, `DIREKTUR`). Tindakan: `hrPayroll` (HR, `FINANCE`, `SUPER_ADMIN`). Tombol disembunyikan bagi yang lain. **[V]**
**Titik awal:** "Payroll" (`/hr/payroll`, subjudul "Periode {YYYY-MM}"; bawaan bulan berjalan).

**Siklus status:**

| Status | Label | Tindakan yang tersedia | Berikutnya |
|---|---|---|---|
| `DRAFT` | Draft | "Hitung ulang", "Setujui" | Disetujui |
| `APPROVED` | Disetujui | "Tandai Dibayar" | Dibayar |
| `PAID` | Dibayar | Tidak ada | – |

Tidak ada langkah mundur (batal setuju) di layar maupun layanan. **[V][D]**

> **Tidak ada maker-checker.** Akun yang sama boleh menghasilkan, menyetujui, dan menandai dibayar. Tidak ada pemeriksaan pemisahan tugas pada langkah-langkah ini. Kebijakan perlu ditetapkan oleh manajemen. **[V][K]**
>
> **"Tandai Dibayar" hanya mencatat status.** Ia **tidak** memindahkan uang. Teks konfirmasi: "Tandai penggajian {net} ini sudah dibayar? Ini pernyataan bahwa transfernya sudah keluar dari bank, dan tidak bisa dibatalkan di sini." **[V]**

**Aturan waktu:** Payroll hanya bisa dibuat untuk **bulan yang sudah berakhir**: "Periode {YYYY-MM} belum selesai. Payroll baru bisa dibuat setelah bulan itu berakhir." Slip bulan M baru dapat dibuat mulai tanggal 1 bulan M+1 (zona waktu bisnis, bawaan Asia/Jakarta). **[V]**

#### A. Menghasilkan slip

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Pilih "Periode" (bulan). Opsional "Karyawan (opsional)" dan "Status". | Daftar slip: nama, "{periode} · {n} hari hadir · dibuat {tanggal}", net Rp, lencana status. Kosong: "Belum ada payroll periode ini." |
| 2a | **Satu karyawan:** pilih karyawan, tekan "Generate". | "Payroll digenerate". Tanpa karyawan: "Isi employeeId untuk generate". Gagal: "Gagal generate". |
| 2b | **Satu depot:** di kartu batch pilih "Depot" ("Pilih depot"), tekan "Buat sedepot". | "{n} draf ditulis"; kegagalan "{n} karyawan tidak mendapat draf" beserta nama dan alasan; atau "Semua karyawan sudah punya draf." Tanpa depot: "Pilih depot dulu". |
| 3 | Periksa tiap draf. | |

Petunjuk batch: "Menulis DRAFT untuk setiap karyawan aktif di depot itu. Menyetujui dan membayar tetap manual, satu per satu." Batch hanya mencakup karyawan berstatus **Aktif**, hingga 500 per depot. Karyawan yang sudah keluar harus dihasilkan per karyawan lewat "Generate". **[V]**

Aturan generate: slip DRAFT yang sudah ada dihitung ulang (satu slip per karyawan per periode). Slip yang bukan DRAFT: 409 "Payroll {periode} sudah {STATUS}, tidak bisa dibuat ulang". Slip karyawan pinjaman milik depot **asal**: "Slip ini milik depot asal karyawan; hanya depot asal atau pusat yang bisa memprosesnya." Pembagian gaji dibatasi ke rentang tanggal masuk–keluar. **[V]**

#### B. Komposisi slip (urutan baris)

| Komponen | Cara hitung |
|---|---|
| Gaji pokok | Harian: tarif harian × hari hadir ("Gaji pokok ({n} hari)"). Bulanan: tarif bulanan × pecahan masa kerja. |
| "Kenaikan masa kerja ({n} th, +{pct}%)" | Hanya Kepala Depot; tangga ada di pengaturan. |
| Tunjangan | Tunjangan aktif periode itu, proporsional. |
| "THR (masa kerja {n} bulan)" | Hanya bila periode = pengaturan bulan pembayaran THR. |
| Bonus manual | Dari "Bonus & Potongan". |
| Bonus otomatis | Dari "Rule Bonus"; metrik: tingkat kehadiran, jumlah hari hadir, tanpa terlambat, Kepala Depot, total penjualan depot. |
| "Bonus target harian ({n} hari)" | Bila tingkat galon harian dikonfigurasi. |
| Lembur | Bonus lembur. |
| Potongan terlambat/absen | Bertingkat ("Denda telat 1/2 (N hari)", "Denda tidak absen (N hari)") bila diatur; jika tidak, "Potongan terlambat (N hari)" (bawaan Rp10.000 per hari) dan untuk gaji bulanan "Potongan absen (N hari)" (bawaan 0). |
| Potongan manual | Termasuk jenis Kasbon. |
| "Cicilan pinjaman" / "Cicilan: {catatan}" | Dari pinjaman berjalan. |
| BPJS (karyawan) | "BPJS Kesehatan (karyawan)" hanya bila karyawan punya nomor BPJS Kesehatan; "BPJS JHT (karyawan)" dan "BPJS Jaminan Pensiun (karyawan)" hanya bila punya nomor BPJS Ketenagakerjaan. |
| "PPh 21" | Bulanan: tabel TER bila dimuat, jika tidak progresif tahunan; Desember: penyesuaian terhadap total setahun; tambahan 20% bila tanpa NPWP. |

Bruto = gaji pokok + tunjangan. Bersih = bruto + bonus − potongan, **minimum 0**. **[V]**

**Tarif bawaan** (dari pengaturan; dapat diubah di Konfigurasi Gaji) **[K]**:

| Komponen | Tarif / batas bawaan |
|---|---|
| BPJS Kesehatan karyawan | 1% (batas upah Rp12.000.000) |
| BPJS JHT karyawan | 2% |
| BPJS Jaminan Pensiun karyawan | 1% (dengan batas pada pengaturan) |
| Beban perusahaan | Kesehatan 4%, JHT 3,7%, JP 2%, JKK 0,24%, JKM 0,30% |
| Biaya jabatan | 5%, maksimum Rp500.000 |
| Tambahan PPh 21 tanpa NPWP | 20% |
| Tabel PTKP | PMK 101/2016 |
| Tabel TER | **Kosong** sampai dimuat |

#### C. Meninjau, menyetujui, dan membayar

Halaman detail (`/hr/payroll/detail?id=`): judul nama karyawan; "Slip Gaji {periode} · {n} hari hadir"; tombol "Unduh PDF"; tabel baris (potongan merah dengan minus); "Gaji Bersih (Net)"; kartu Gross / Bonus / Potongan; tanggal "Disetujui" / "Dibayar".

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Buka slip DRAFT. Baca peringatan bila ada. | Peringatan hari kehadiran belum diputuskan: "Masih ada {n} hari kehadiran yang belum diputuskan di periode ini. Gaji tetap bisa disetujui — putuskan hari-hari itu, lalu catat selisihnya sebagai penyesuaian di periode berikutnya (dipotong kalau ditolak, dibayar susulan kalau disetujui)." Tidak memblokir. |
| 2 | Bila data berubah (absensi, penugasan, aturan), tekan "Hitung ulang". | Konfirmasi "Hitung ulang slip ini dari data terbaru (absensi, penugasan, aturan)? Baris dan pembagian depotnya ditulis ulang." Toast "Slip dihitung ulang". |
| 3 | Tekan "Setujui". | Konfirmasi "Setujui penggajian ini senilai {net}? Sesudah disetujui, angkanya tidak bisa lagi diubah dari layar ini." Toast "Payroll disetujui". Status Disetujui. |
| 4 | **Lakukan transfer gaji di bank di luar aplikasi.** | Tidak ada pembayaran dari sistem. |
| 5 | Tekan "Tandai Dibayar". | Konfirmasi seperti di atas. Toast "Ditandai dibayar". Status Dibayar. |

**Pesan server bila status tidak cocok [V]:** "Hanya payroll DRAFT yang bisa dihitung ulang (saat ini {S})", "Hanya payroll DRAFT yang bisa disetujui (saat ini {S})", "Hanya payroll APPROVED yang bisa dibayar (saat ini {S})", dan bila penugasan depot bergeser setelah slip dihitung: "Penugasan depot karyawan ini berubah setelah slip dihitung. Hitung ulang slip dulu, lalu setujui."

**Pembagian per depot** ("Alokasi per depot" / "Koreksi pembagian depot") hanya muncul bila slip terbagi lebih dari satu depot (fitur penugasan lintas depot aktif). Editor memiliki "Alasan koreksi", "+ Tambah depot", "Simpan pembagian". Pesan: "Pembagian per depot belum diaktifkan.", "Payroll yang sudah dibayar tidak bisa dialokasikan ulang.", "Alasan wajib diisi."

#### D. Impor riwayat slip gaji (`/hr/payroll/import`; `hrPayroll`)

Kolom: employeeCode*, periodMonth* (YYYY-MM), gross* (bulat), totalBonus, totalDeduction, net (harus sama dengan gross + bonus − potongan, jika tidak: "net {x} tidak sama dengan gross + bonus - potongan ({y})"), presentDays. Hanya bulan lampau ("Hanya bulan yang sudah lewat yang bisa diimpor sebagai riwayat"); slip yang sudah ada dilewati ("Slip bulan itu sudah ada"). Baris disimpan **langsung sebagai Dibayar**. **[V]**

**Masalah umum:** lihat tabel pesan di atas dan Prosedur 6.6.

**Daftar periksa penggajian bulanan:**
- [ ] Bulan sudah berakhir.
- [ ] Absensi bulan itu sudah diputuskan (tidak ada yang tertahan).
- [ ] Cuti, kasbon, bonus, potongan, tunjangan sudah masuk.
- [ ] Draf dihasilkan untuk semua karyawan, termasuk yang sudah keluar (per karyawan).
- [ ] Draf ditinjau; "Hitung ulang" bila ada perubahan.
- [ ] "Setujui" per slip.
- [ ] Transfer bank selesai, baru "Tandai Dibayar".
- [ ] Cek laporan beban BPJS perusahaan (Prosedur 6.17).

> **[SCREENSHOT REQUIRED: SS-hr-09 — Daftar "Payroll" dengan penyaring periode dan kartu batch "Buat sedepot" (data sintetis)]**
> *Gambar 8.9 — Daftar dan pembuatan payroll.*

> **[SCREENSHOT REQUIRED: SS-hr-10 — Detail slip gaji berstatus Draft: baris komponen, "Gaji Bersih (Net)", tombol "Hitung ulang" dan "Setujui"]**
> *Gambar 8.10 — Slip gaji Draft.*

> **[SCREENSHOT REQUIRED: SS-hr-11 — Dialog konfirmasi "Tandai penggajian … sudah dibayar?" pada slip Disetujui]**
> *Gambar 8.11 — Konfirmasi tandai dibayar.*

---

### Prosedur 6.13: Tunjangan, bonus, potongan, dan rule bonus

**Tunjangan** (`/hr/allowances`, subjudul "Komponen gaji tetap berulang — terpisah dari bonus di slip gaji"). Lihat: `hrView`. Tambah/hentikan/impor: **`hrPayroll`** (HR, `FINANCE`, `SUPER_ADMIN`; bukan `HEAD_OFFICE`/`DIREKTUR`, yang melihat panel tetapi ditolak server). **[V]**

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Pilih karyawan. | Panel tunjangan. |
| 2 | Isi "Jenis" (Transport, Makan, Jabatan, Perumahan, Lainnya), "Nominal / bulan (Rp)" (> 0), "Mulai" (wajib), "Sampai (kosong = tanpa batas)", "Catatan (opsional)". | Pesan: "Nominal tunjangan harus > 0.", "Tanggal mulai wajib diisi.", server "effectiveTo tidak boleh sebelum effectiveFrom". |
| 3 | Tekan "Tambah Tunjangan". | Daftar menampilkan Berjalan/Dihentikan; ada tombol hentikan. |

Petunjuk: "Komponen tetap yang terbayar setiap periode. Tidak masuk basis upah lembur." Impor tunjangan: employeeCode*, type*, amount*, effectiveFrom*, effectiveTo, note. **Mengunggah file yang sama dua kali menggandakan data.**

**Bonus & Potongan** (`/hr/adjustments`, "Per karyawan per periode"). Lihat: `hrView`; tambah/hapus: `hrAdmin`.

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Pilih karyawan dan "Periode", tekan "Muat". | Dua daftar: Bonus dan Potongan. |
| 2 | Isi "Jenis" (bonus/potongan), "Tipe", "Nominal" (> 0), "Catatan". Tipe bonus: Kehadiran, Kinerja, Penjualan, Depot, Manual. Tipe potongan: Terlambat, Mangkir, Manual, Kasbon, Lainnya. | "Nominal harus > 0". |
| 3 | Tekan "Simpan". | "Bonus ditambahkan" / "Potongan ditambahkan". Catatan: "Masuk ke payroll saat digenerate." |
| 4 | Untuk menghapus, tekan "Hapus" dan sebutkan alasan. | Prompt "Hapus penyesuaian ini? Sebutkan alasannya." |

**Terkunci setelah disetujui:** bila slip periode itu sudah Disetujui/Dibayar, tambah dan hapus ditolak: "Payroll {periode} sudah {STATUS}, jadi bonus/potongan periode itu tidak bisa diubah lagi. Catat di periode berikutnya." Pada slip Draft, tekan "Hitung ulang" setelah mengubah penyesuaian. **[V][D]** Impor potongan (tombol "Import Potongan"): employeeCode*, type* (`LATE`/`ABSENCE`/`MANUAL`/`CASH_ADVANCE`/`OTHER`), amount*, periodMonth*, note; baris ditambahkan apa adanya tanpa pemeriksaan duplikat.

**Rule Bonus** (`/hr/rules`, "Rule Bonus Otomatis", "Bonus dihitung otomatis saat payroll dibuat"; `hrAdmin`): isi "Nama rule" (wajib: "Nama rule wajib diisi."), "Jenis bonus", "Metrik" (Tingkat kehadiran (%), Jumlah hari hadir, Tanpa terlambat (1=ya), Kepala Depot (1=ya), Total penjualan depot (Rp)), "Operator", "Ambang" ("Ambang (threshold) tidak valid."), "Jenis reward" (Nominal (Rp) atau % dari gaji pokok), nilai reward ("Nilai reward tidak valid."; tidak negatif), "Berlaku untuk" (satu depot atau "Semua depot (global)"). Toast "Rule bonus ditambahkan". Per rule: "Ubah", "Nonaktifkan"/"Aktifkan".

---

### Prosedur 6.14: Aset karyawan

**Tujuan:** Mencatat barang perusahaan dan serah terimanya.
**Peran:** Lihat: `hrView`. Daftar, ubah, pindah, impor: `hrAdmin`.
**Titik awal:** "Aset" (`/hr/assets`; "Barang perusahaan yang dipegang karyawan. Riwayat serah terima tidak pernah dihapus."). Filter menurut status, jenis, depot.

**Mendaftarkan** ("Daftarkan Aset"): "Kode aset" (huruf/angka/tanda hubung, maks 30), "Nama" (maks 120), "Jenis" (Motor, Ponsel, Seragam, Laptop, Printer, Scanner, Lainnya), "Depot pemilik", "Merek (opsional)", "Nomor seri (opsional)", "Nilai perolehan (Rp, opsional)"; tekan "Daftarkan". Toast "Aset didaftarkan"; kosong "Isi kode, nama, dan depot"; kode ganda 409 "Kode aset sudah dipakai".

**Mencatat pergerakan** ("Catat Pergerakan", opsional "Kondisi barang (opsional)"):

| Pergerakan | Label | Dari status | Ke status | Catatan |
|---|---|---|---|---|
| ASSIGN | Serah terima | Tersedia / Dikembalikan | Dipegang | Perlu penerima |
| TRANSFER | Pindah tangan | Dipegang | Dipegang | Perlu penerima |
| RETURN | Pengembalian | Dipegang / Perbaikan | Dikembalikan | |
| MAINTENANCE | Masuk perbaikan | Tersedia / Dikembalikan / Dipegang | Perbaikan | |
| LOST | Dinyatakan hilang | – | Hilang | Final: "Aset sudah dihapusbukukan. Jika barang ditemukan, daftarkan sebagai aset baru." |

Pesan: "Aset berstatus {S} tidak bisa {JENIS}", "Pergerakan {JENIS} membutuhkan karyawan penerima" ("Pilih karyawan penerima"), "Karyawan penerima berada di depot lain". Impor aset: code*, type*, name*, depotCode*, brand, serialNo, value, holderEmployeeCode (pemegang harus di depot yang sama), note. **[V]**

---

### Prosedur 6.15: Pengumuman

**Tujuan:** Mengirim satu pesan ke kelompok karyawan tanpa dobel.
**Peran:** Lihat: `hrView`. Tulis: `hrAdmin`.
**Titik awal:** "Pengumuman" (`/hr/announcements`; "Satu pesan, satu kali sampai. Target yang beririsan tidak mengirim dobel.").

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Di "Tulis Pengumuman" pilih "Target audiens": Seluruh perusahaan, Depot, Departemen, Jabatan, atau Karyawan tertentu. Tekan "Tambah target" untuk beberapa target (maks 20, digabung tanpa duplikat). | Setiap target selain "seluruh perusahaan" harus dipilih nilainya; server: "Pilih minimal satu target audiens". |
| 2 | Isi "Judul" (maks 160) dan "Isi" (maks 4000). | Kosong: "Judul dan isi wajib diisi". |
| 3 | Pilih "Tingkat": Informasi / Perhatian / Mendesak. | |
| 4 | Kosongkan "Jadwalkan (kosong = kirim sekarang)" lalu tekan "Kirim Sekarang"; atau isi waktu lalu tekan "Jadwalkan". | "Pengumuman terkirim" / "Pengumuman dijadwalkan". Waktu salah: "scheduledAt bukan tanggal yang sah". |
| 5 | Pantau di "Riwayat". | "Terkirim {waktu} ke {n} orang", "Dijadwalkan {waktu} — belum terkirim", "Statistik" (tingkat baca). |

---

### Prosedur 6.16: Kinerja

**Peran:** Lihat: `hrView`. Hitung dan simpan manual: `hrAdmin`.
**Titik awal:** "Kinerja" (`/hr/performance`; "Skor bulanan dari kehadiran, kedisiplinan & penjualan").

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Pilih periode, tekan "Hitung skor". | Skor per karyawan. |
| 2 | (Opsional) isi skor manual 0–100 ("Skor 0–100"), tekan "Simpan manual". | |

Tanda "—" berarti komponen itu tidak dapat diukur, **bukan** nilai nol. Bobot bawaan: kehadiran 40, kedisiplinan 30, penjualan 30 (di Konfigurasi Gaji). Rumus rinci skor belum diperiksa. **[V][K]**

---

### Prosedur 6.17: Laporan

**Peran:** Lihat: `hrView`. Laporan "Beban BPJS perusahaan": `hrPayroll`.
**Titik awal:** "Laporan" (`/hr/reports`; "Ekspor CSV, Excel, atau PDF").

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Pilih "Periode" (bulan), atau "Dari"/"Sampai" untuk laporan rentang, dan "Depot" (Semua depot). | Rentang kosong: "Isi rentang tanggal". |
| 2 | Pada kartu laporan, tekan CSV, Excel, atau PDF. | Berkas terunduh. Gagal: "Gagal mengunduh". PDF memotong laporan panjang dan memberi tahu di halaman. |

Kartu laporan: Direktori Karyawan, Payroll (per periode, dengan bonus dan potongan), **Beban BPJS perusahaan**, Kinerja, Aset ("Daftar aset beserta pemegangnya saat ini."), Absensi, Keterlambatan ("Hanya hari yang benar-benar terlambat, terbesar dulu."), Cuti ("Termasuk cuti yang melewati batas rentang."), Pengumuman ("Jangkauan dan tingkat baca tiap pengumuman."). **[V]**

**Beban BPJS perusahaan** ("Porsi BPJS yang dibayar perusahaan di atas gaji (Kesehatan, JHT, JP, JKK, JKM), per karyawan dan per depot. Biaya perusahaan saja: tidak masuk slip dan tidak mengurangi gaji siapa pun. Hanya karyawan yang punya nomor BPJS yang dihitung."). Kartu hanya terlihat bagi pemegang `hrPayroll`; server juga memeriksanya. Baris: "BPJS Kesehatan (perusahaan)", "BPJS JHT (perusahaan)", "BPJS Jaminan Pensiun (perusahaan)", JKK, JKM. **[V]**

Halaman lain berbasis data baca saja:

- **Pelanggan** (`/hr/customers`): "Hanya lihat. Data dibaca langsung dari direktori depot." Pilih "Depot:", "Cari nama atau nomor", kolom Nama / Nomor / Tier / Order / Order terakhir. Kosong "Belum ada pelanggan". `FINANCE` tidak melihat menu ini.
- **Reseller / Agen** (`/hr/resellers`): hanya daftar; HR tidak dapat mengubah diskon (itu `resellerAdmin`: Manager, `HEAD_OFFICE`, `DIREKTUR`, Admin).

> **[SCREENSHOT REQUIRED: SS-hr-12 — Halaman "Laporan" dengan kartu laporan, pilihan periode, dan tombol CSV/Excel/PDF]**
> *Gambar 8.12 — Laporan HR.*

---

### Prosedur 6.18: Konfigurasi gaji, aturan, dan audit

**Konfigurasi Gaji** (`/hr/settings`; "Default GLOBAL (SUPER_ADMIN) atau override per depot"). Terlihat bagi `hrAdmin`. **[V]**

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Pilih "Cakupan": "Default jaringan" (GLOBAL) atau "Depot tertentu" (pilih depot, "Pilih depot…"). | Non-Admin melihat: "Hanya SUPER_ADMIN yang dapat mengubah default GLOBAL." |
| 2 | Ubah nilai pada pengaturan; baca "format: {satuan}" dan "efektif: {nilai}" (atau "(belum diisi)"). | |
| 3 | Tekan "Simpan". | "Tersimpan"; bila sama: "Belum ada perubahan pada nilai itu." |
| 4 | Untuk membatalkan override, tekan "Reset". | Konfirmasi "Hapus override ini untuk {cakupan}? Nilainya kembali ke aturan yang lebih luas — angka lain, langsung berlaku ke gaji semua orang, tanpa undo di layar ini." Toast "Override dihapus". |

Urutan penentuan: override depot > GLOBAL > bawaan lingkungan. Pengaturan persen disimpan dikali 100 (100 = 1%). Menyimpan override depot tanpa memilih depot: "Isi depotId untuk override DEPOT".

**Nilai bawaan** (**[K]**, dapat diubah): jam masuk 08:00; toleransi keterlambatan 15 menit; potongan terlambat Rp10.000; upah harian training Rp30.000; potongan absen 0; jam kerja standar 480 menit; istirahat 60 (Jumat 90); kuota cuti tahunan 12; hari libur mingguan kosong; pengali lembur hari kerja 150% dan hari libur 200%; tarif BPJS dan PPh 21 seperti Prosedur 6.12; absen offline lolos otomatis 10 menit; batas usia absen offline 24 jam; radius absen 0 (nonaktif); bobot kinerja 40/30/30; bulan THR, kenaikan masa kerja Kepala Depot, denda telat bertingkat, tabel TER, bonus target harian: kosong.

**Log Audit** (`/hr/audit`; `hrAdmin`): kolom penyaring "Filter entity (employees, payroll, …)"; "{n} entri"; "Oleh" (delapan karakter pertama pelaku atau "sistem"); kosong "Belum ada log." Log ini terpisah dari audit HQ. Isi entri belum diperiksa menyeluruh. **[V][K]**

---

### Prosedur 6.19: Penugasan lintas depot dan permintaan pinjam

> **Fitur mati secara bawaan.** Seluruh fitur dikendalikan variabel `DEPOT_ASSIGNMENT_ENABLED` yang bawaannya **false**. Saat mati, API menjawab 404 "Penugasan lintas depot belum diaktifkan" dan kartu "Penugasan lintas depot" tidak tampil; permintaan pinjam dan pembagian gaji per depot juga tidak berfungsi. Apakah fitur dinyalakan di produksi **belum diketahui**. **[V][K]**

**Tujuan:** Meminjamkan karyawan ke depot lain untuk hari tertentu, atau menjadwalkan mutasi permanen.
**Peran:** Rencanakan/batalkan/putuskan permintaan: `employeeAssign` (HR, `HEAD_OFFICE`, `DIREKTUR`, `SUPER_ADMIN`). Mengajukan permintaan pinjam: `employeeAssignRequest` (**hanya Manager dan Supervisor**).
**Titik awal (HR):** Detail karyawan > kartu "Penugasan lintas depot". Teks: "Pinjamkan karyawan ke depot lain untuk hari-hari tertentu, atau jadwalkan mutasi permanen. Sistem memindahkannya sendiri pada hari yang ditentukan." Kosong: "Belum ada penugasan."

#### A. HR merencanakan penugasan

| Langkah | Tindakan pengguna | Respons sistem |
|---|---|---|
| 1 | Isi "Jenis": "Dipinjamkan" (`LOAN`) atau "Mutasi permanen" (`PERMANENT`). | |
| 2 | Pilih "Depot tujuan" ("Pilih depot tujuan"). | |
| 3 | Isi "Mulai" (tidak boleh di masa lalu bagi yang bukan HR/Admin; maks 366 hari ke depan). | |
| 4 | Untuk Dipinjamkan, isi "Sampai (hari terakhir)". | Mutasi permanen tidak punya tanggal akhir. |
| 5 | (Opsional) "Catatan (opsional)", maks 300. | |
| 6 | Tekan "Rencanakan". | Toast "Penugasan direncanakan". Semua masalah ditampilkan sebagai daftar. |

**Pesan validasi [V]:**

- "Jabatan karyawan ini tidak bisa ditugaskan lintas depot (hanya staf depot sampai manajer)."
- "Karyawan ini belum punya akun login; buatkan akunnya dulu."
- "Hanya karyawan aktif yang bisa ditugaskan."
- "Karyawan ini belum punya depot asal."
- "Depot tujuan sama dengan depot asal karyawan."
- "Tanggal akhir peminjaman wajib diisi dan tidak boleh sebelum tanggal mulai."
- "Mutasi permanen tidak punya tanggal akhir."
- "Penugasan tidak bisa dimulai di masa lampau; atur tanggal mulai hari ini atau sesudahnya."
- "Tanggal mulai terlalu jauh (maksimal 366 hari ke depan)."
- "Tanggal mulai sebelum karyawan masuk kerja."
- "Penugasan melewati tanggal keluar karyawan."
- "Penugasan bertabrakan dengan penugasan lain yang masih berjalan atau terjadwal."
- "Depot tujuan tidak aktif (sedang ditutup)."

**Mundur tanggal:** hanya peran HR atau Admin (bukan `HEAD_OFFICE`/`DIREKTUR`), maksimal 92 hari ke belakang, dan ditolak bila slip bulan itu sudah Disetujui/Dibayar ("Payroll {bulan} sudah disetujui atau dibayar; koreksi pembagian depotnya lewat pusat, bukan dengan menggeser tanggal.") atau absensi sudah tercatat di depot lain. **[V]**

#### B. Status penugasan

| Status | Label | Arti |
|---|---|---|
| `REQUESTED` | Diajukan | Permintaan pinjam dari Manager/Supervisor, belum diputuskan. Belum mengambil hari apa pun. |
| `PLANNED` | Terjadwal | Disetujui/direncanakan HR; menunggu tanggal mulai. |
| `ACTIVE` | Berjalan | Sudah berlaku (otomatis pada tanggal mulai, atau tombol "Terapkan sekarang"). |
| `DONE` | Selesai | Pinjaman berakhir, karyawan kembali ke depot asal. |
| `CANCELLED` | Dibatalkan | HR membatalkan (Terjadwal), menolak (Diajukan, dengan alasan), atau "Akhiri hari ini" memotong pinjaman berjalan. |
| `FAILED` | Gagal | Gagal diterapkan 5 kali atau menyerah (mis. "Karyawan tidak aktif lagi", "Depot tujuan tidak aktif lagi"). |

Efek saat diterapkan: akun login dipindah dulu. Kepala Depot yang dipinjamkan masuk sebagai Staf Depot di depot tujuan (satu kepala per depot) dan kembali bila selesai. Pada pinjaman, `depotId` berubah tetapi depot induk tetap; pada mutasi permanen keduanya berubah dan departemen depot lama dikosongkan. Depot peminjam melihat karyawan tanpa gaji dan dokumen. **[V]**

Pembatalan hanya untuk Terjadwal atau pinjaman Berjalan: lainnya 409 "Penugasan sudah {STATUS} dan tidak bisa dibatalkan." "Terapkan sekarang" hanya bila sudah jatuh tempo: 409 "Penugasan ini belum jatuh tempo, atau sudah selesai."

#### C. Permintaan pinjam oleh Manager/Supervisor dan keputusan HR

**Manager atau Supervisor** membuka "Permintaan pinjam karyawan" (`/hr/depot-requests`; "Ajukan peminjaman karyawan dari depot lain untuk depot Anda. HR yang memutuskan; karyawan baru berpindah setelah disetujui."):

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Isi "Kode karyawan", "Depot tujuan", "Mulai", "Sampai (hari terakhir)" (semua wajib), "Catatan (opsional)". | Hanya jenis pinjaman; tujuan harus depot Anda sendiri. Petunjuk kolom "mis. EMP-0012" menyesatkan: kode asli berformat `HR-####`. **[B]** |
| 2 | Tekan "Ajukan". | "Permintaan terkirim ke HR". Daftar "Permintaan Anda" (kosong "Belum ada permintaan."). Kode salah: "Karyawan tidak ditemukan". |

Peran lain melihat penjelasan: "Hanya manajer depot yang bisa mengajukan peminjaman karyawan. HR merencanakannya langsung dari kartu karyawan." (judulnya memakai kalimat "Impor massal tidak tersedia untuk peran ini" yang dipakai ulang — **[B]**).

**HR memutuskan** pada kartu "Penugasan lintas depot" karyawan terkait, baris berstatus Diajukan:

| Langkah | Tindakan | Respons |
|---|---|---|
| 1 | Tekan "Setujui". | Divalidasi ulang; toast "Permintaan disetujui"; status Terjadwal. |
| 2 | Atau tekan "Tolak", isi "Alasan penolakan?" (min 3, maks 300 karakter). | Toast "Permintaan ditolak". Alasan tampil ke pemohon. Galat: "Alasan penolakan wajib diisi.", "Permintaan tidak ditemukan atau sudah diputuskan", "Permintaan sudah diputuskan; muat ulang." |

> **[B] Tidak ada kotak masuk permintaan untuk HR.** Satu-satunya tempat melihat permintaan adalah kartu per karyawan; tidak ada halaman daftar permintaan menunggu (API-nya ada, tetapi tidak dipakai layar). Cara HR diberi tahu belum diketahui. **[V][K]**

> **[SCREENSHOT REQUIRED: SS-hr-13 — Kartu "Penugasan lintas depot" pada detail karyawan dengan formulir "Rencanakan" dan satu baris berstatus Diajukan beserta tombol "Setujui"/"Tolak" (hanya bila fitur aktif)]**
> *Gambar 8.13 — Penugasan lintas depot.*

---

## 7. Kolom wajib & aturan validasi (ringkasan)

### 7.1 Ringkasan validasi

| Area | Aturan inti | Bukti |
|---|---|---|
| Karyawan baru | Nama, Posisi, No. HP, Tanggal masuk, Jabatan (peran login), tipe gaji + nominal > 0; depot wajib kecuali Asisten Supervisor/Supervisor/Manager | [V] |
| Peran yang boleh diberikan HR | `STAFF_DEPOT`, `KEPALA_DEPOT`, `ASSISTANT_SUPERVISOR`, `SUPERVISOR`, `MANAGER` | [V] |
| `MANAGER` | Hanya HR dan Admin | [V] |
| NIK | Tepat 16 angka | [V] |
| Tanggal | Akhir kontrak dan keluar tidak boleh sebelum masuk | [V] |
| Resign | Wajib Tanggal keluar agar payroll mau dibuat | [V] |
| Absensi manual | Hanya hari tanpa catatan | [V] |
| Koreksi absensi | Alasan wajib, maks 200 | [V] |
| Cuti | Tidak boleh tumpang tindih; kuota; penolakan wajib catatan; pemutus tahap 2 ≠ pemutus tahap 1 | [V] |
| Kasbon | Cicilan bulat > 0; bulan mulai YYYY-MM; satu pengajuan terbuka per karyawan | [V] |
| Payroll | Hanya bulan berakhir; hanya Draft yang dihitung ulang/disetujui; hanya Disetujui yang dibayar | [V] |
| Impor | Maks 500 baris; .xlsx/.csv | [V] |
| Dokumen | jpeg/png/webp/pdf, maks 5 MB | [V] |
| Penugasan lintas depot | Fitur mati secara bawaan; maks 366 hari ke depan; mundur maks 92 hari (HR/Admin) | [V] |

### 7.2 Format impor CSV/Excel (semua modul)

Semua impor: `.xlsx` atau `.csv`, maksimal 500 baris, tanggal YYYY-MM-DD, bulan YYYY-MM, bilangan bulat tanpa titik/koma. Nomor HP dan NIK sebagai teks. Tanda * = wajib. **[V]**

| Modul (halaman) | Kolom | Izin |
|---|---|---|
| Karyawan (`/hr/employees/import`) | employeeCode, fullName*, phone*, depotCode*, position*, departmentCode, role* (`STAFF_DEPOT`/`KEPALA_DEPOT`), employmentStatus* (`TRAINING`/`PROBATION`/`PERMANENT`), joinDate*, contractEndDate, exitDate, salaryType* (`DAILY`/`MONTHLY`), dailyRate, monthlyRate, supervisorCode, shiftName, email, nik, birthDate, gender (`MALE`/`FEMALE`), address, ptkpStatus, npwp, bpjsKes, bpjsTk, bankName, bankAccount, emergencyName, emergencyPhone | `hrAdmin` |
| Riwayat absensi | employeeCode*, workDate*, status*, lateMinutes | `hrAdmin` |
| Riwayat shift | employeeCode*, shiftName*, effectiveFrom*, note | `hrAdmin` |
| Kasbon berjalan | employeeCode*, principal* (sisa), installmentAmount*, startPeriod*, note | `hrAdmin` |
| Riwayat slip gaji | employeeCode*, periodMonth*, gross*, totalBonus, totalDeduction, net, presentDays | `hrPayroll` |
| Potongan | employeeCode*, type*, amount*, periodMonth*, note | `hrAdmin` |
| Tunjangan | employeeCode*, type*, amount*, effectiveFrom*, effectiveTo, note | `hrPayroll` |
| Aset | code*, type*, name*, depotCode*, brand, serialNo, value, holderEmployeeCode, note | `hrAdmin` |
| Saldo cuti | employeeCode*, year*, quotaDays*, usedDays | `hrAdmin` |

Hasil impor: "N dibuat", "N diperbarui", "N dilewati", "N gagal". Tidak semua halaman impor dibatasi di layar (kasbon, potongan, tunjangan, aset, saldo cuti); server tetap menolak yang tidak berwenang.

## 8. Kesalahan umum & solusi

| Gejala | Penyebab | Solusi |
|---|---|---|
| Tombol "+ Tambah"/"Import Excel" tidak ada | Tanpa `hrAdmin`. | Minta Admin meninjau hak akses. |
| Tidak bisa memilih peran selain lima | Hak HR terbatas (`HR_MANAGED_ROLES`). | Minta Kantor pusat/Admin di "Direktori staf". |
| Memilih Manager ditolak | Pembuat bukan HR/Admin. | Minta HR atau Admin. |
| "auth-service menolak permintaan (403)" | Pesan sebenarnya dari layanan autentikasi tidak diteruskan. | Cek peran dan depot; hubungi Admin. |
| Payroll tidak bisa dibuat | Bulan belum berakhir / Resign tanpa Tanggal keluar. | Tunggu tanggal 1 bulan berikut / isi Tanggal keluar. |
| Karyawan keluar tidak ikut batch | Batch hanya karyawan Aktif. | Pakai "Generate" per karyawan. |
| Cuti tidak bisa dilanjutkan | Pemutus tahap 2 sama dengan tahap 1, atau memutuskan cuti sendiri. | Pakai akun lain. |
| Kasbon ditolak 403 | Depot punya Asisten Supervisor yang berhak memutuskan. | Minta asisten supervisor depot itu. |
| Bonus/potongan tak bisa diubah | Slip sudah Disetujui/Dibayar. | Catat di periode berikutnya. |
| Kartu "Penugasan lintas depot" tidak ada | Fitur mati. | Minta Admin memeriksa `DEPOT_ASSIGNMENT_ENABLED`. |
| Tunjangan gagal disimpan oleh `HEAD_OFFICE`/`DIREKTUR` | Butuh `hrPayroll`. | Minta HR/`FINANCE`. |
| "Pelanggan"/"Reseller" tidak muncul | Menu dibatasi hak CRM/reseller. | Normal bagi `FINANCE`/Asisten Supervisor. |

## 9. Batasan peran (apa yang TIDAK bisa; butuh persetujuan siapa)

| Tidak bisa dilakukan HR | Alasan | Siapa yang bisa |
|---|---|---|
| Mengundang, memindahkan, menonaktifkan, menghapus staf di "Direktori staf" | Butuh `staffAdmin` (`HEAD_OFFICE`, `SUPER_ADMIN`) atau `staffDelete` (Admin saja). HR tidak punya akses ke `/hq/staff`. | Kantor pusat / Admin |
| Memberikan peran selain lima peran HR | Konstanta kode. | Kantor pusat (peran tak terbatas), Admin (semua) |
| Memberikan peran `HR`, `FINANCE`, `DIREKTUR`, `MARKETING`, `SUPER_ADMIN` | `RESTRICTED_GRANTS`. | Admin saja |
| Mengatur atasan/garis pelaporan | `hierarchyAdmin`. | Admin (`/hq/hierarchy`) |
| Mengubah matriks hak akses | `accessMatrixWrite`. | Admin |
| Mengubah default GLOBAL konfigurasi gaji | `settingsGlobal`. | Admin |
| Mengubah diskon reseller | Bukan `resellerAdmin`. | Manager, Kantor pusat, `DIREKTUR`, Admin |
| Mengajukan permintaan pinjam karyawan | `employeeAssignRequest` hanya Manager dan Supervisor. | Manager / Supervisor |
| Memutuskan kasbon bila depot punya Asisten Supervisor | Aturan server. | Asisten Supervisor depot itu |
| Menyelesaikan kedua tahap cuti sendirian | Pemisahan tugas. | Dua akun berbeda |
| Membatalkan persetujuan payroll | Tidak ada langkah mundur. | Tidak tersedia |
| Menggerakkan uang gaji | "Tandai Dibayar" hanya status. | Transfer bank oleh keuangan |

### 9.1 HR vs Admin

**Tabel: HR vs Admin** — pembagian wewenang antara HR dan Admin (`SUPER_ADMIN`). Nilai bawaan; Admin dapat mengubah matriks hak akses saat berjalan (sekitar 30 detik).

| Fungsi | HR | Admin (`SUPER_ADMIN`) |
|---|---|---|
| Menambah/mengubah/mengimpor karyawan (`hrAdmin`) | Ya | Ya |
| Memberi peran login: Staf Depot, Kepala Depot, Asisten Supervisor, Supervisor | Ya (lewat jabatan) | Ya |
| Memberi peran `MANAGER` | Ya | Ya |
| Memberi peran `HR`, `DIREKTUR`, `FINANCE`, `MARKETING`, `SUPER_ADMIN` | **Tidak** | Ya (satu-satunya) |
| Memberi peran `HEAD_OFFICE`, `FRANCHISE_OWNER` | Tidak (di luar lima peran HR) | Ya, juga Kantor pusat |
| Mengundang staf lewat "Direktori staf" (`/hq/staff`) | **Tidak ada akses** | Ya (juga Kantor pusat) |
| Menonaktifkan/mengaktifkan akun di "Direktori staf" | Tidak (tetapi Status karyawan di HR menyalakan/mematikan login) | Ya |
| Menghapus akun staf permanen (`staffDelete`) | Tidak | Ya |
| Mengatur atasan/hierarki (`/hq/hierarchy`) | Tidak | Ya |
| Mengubah matriks "Peran & hak akses" (`/hq/access`) | Tidak | Ya |
| Menjalankan payroll (hasilkan, setujui, bayar) | Ya (`hrPayroll`) | Ya |
| Tunjangan | Ya | Ya |
| Keputusan cuti tahap 1 / tahap 2 | Ya (akun berbeda per tahap) | Ya |
| Keputusan kasbon | Ya (kecuali depot punya Asisten Supervisor) | Ya |
| Penugasan lintas depot; mundur tanggal | Ya; mundur tanggal ya | Ya; mundur tanggal ya |
| Konfigurasi gaji: override depot | Ya (`hrAdmin`) | Ya |
| Konfigurasi gaji: default GLOBAL | **Tidak** | Ya (satu-satunya) |
| Log audit HR (`/hr/audit`) | Ya | Ya |
| Log audit sistem (`/hq/audit`) | Tidak (tidak punya akses HQ) | Ya |
| Hak akses dapat diubah saat berjalan | Tidak | Ya |

Kantor pusat (`HEAD_OFFICE`) berada di antara keduanya: memegang `hrAdmin` dan `staffAdmin`, tetapi tidak menjalankan payroll dan tidak memberi `MANAGER`. **[V]**

> **Catatan hak akses.** Nilai bawaan dari `packages/access/src/index.ts`. Admin dapat mengubahnya saat berjalan (sekitar 30 detik). Aturan pemberian peran (`RESTRICTED_GRANTS`, `HR_MANAGED_ROLES`) adalah kode tetap dan tidak ikut berubah.

## 10. Pertimbangan keamanan

- Data karyawan sensitif: NIK, NPWP, BPJS, rekening bank, foto wajah, dokumen. Akses hanya bila perlu; jangan mengirim data lewat chat atau email pribadi.
- Data wajah memerlukan persetujuan tertulis karyawan (kotak persetujuan wajib) dan dapat dihapus ("Hapus data wajah" menarik persetujuan).
- Setiap koreksi absensi wajib beralasan dan tercatat; alasan dibaca ulang saat penggajian dipertanyakan.
- Tidak ada pemisahan tugas pada payroll. Terapkan kontrol manual: orang berbeda meninjau draf sebelum disetujui, dan transfer bank dilakukan pihak keuangan. **[K]**
- Menonaktifkan karyawan tidak mencabut token yang sudah terbit seketika (hingga sekitar 15 menit). Untuk kasus mendesak, hubungi Admin. **[V][D]**
- Memakai nomor HP yang sudah terdaftar akan **mengubah akun orang itu** menjadi staf. Baca kartu peringatan sebelum menekan "Ya, gunakan akun itu".
- Impor massal mengubah banyak baris sekaligus; periksa pratinjau, simpan berkas sumber, dan hindari unggah ganda (tunjangan dan potongan tidak ber-deduplikasi).
- Slip gaji, laporan, dan berkas unduhan berisi data pribadi; simpan dan hapus sesuai kebijakan.
- Contoh data di dokumen ini sintetis; jangan menaruh data nyata pada tangkapan layar tanpa penyamaran.

## 11. Kegiatan akhir hari/berkala

| Frekuensi | Kegiatan |
|---|---|
| Harian | Putuskan "Absen menunggu persetujuan"; cek "Pengajuan Cuti" dan "Antrean Kasbon"; baca "Dokumen Kedaluwarsa" di dashboard. |
| Mingguan | Tinjau keterlambatan dan absen; cek penugasan lintas depot (bila aktif); rapikan pengumuman terjadwal. |
| Akhir bulan | Pastikan semua hari kehadiran diputuskan; masukkan bonus, potongan, tunjangan; siapkan kasbon. |
| Awal bulan (tanggal 1 dst.) | Hasilkan draf payroll bulan lalu; tinjau, setujui, bayar; unduh "Beban BPJS perusahaan". |
| Triwulan/tahunan | Tinjau kuota cuti, hari libur, tarif BPJS/PPh 21, tabel TER, bulan THR; perbarui kalender kerja. |
| Berkala | Periksa kontrak dan masa percobaan yang berakhir 30 hari; tinjau Log Audit. |
| Saat karyawan keluar | Ikuti Prosedur 6.6. |

## 12. Skenario praktis

**Skenario A — Karyawan baru.** Sinta (sintetis) diterima sebagai Staf Depot di depot BDG-01. HR membuka "+ Tambah", mengisi data, memilih jabatan "Staf Depot / Kurir", depot BDG-01, gaji harian. Kartu peringatan tidak muncul (nomor baru). "Tambah Karyawan" → akun dibuat. Sinta masuk dengan OTP.

**Skenario B — Nomor sudah jadi pelanggan.** Nomor karyawan baru sudah dipakai akun pelanggan. Kartu kuning muncul. HR memeriksa nomor; benar, jadi menekan "Ya, gunakan akun itu". Akun pelanggan menjadi akun staf.

**Skenario C — Karyawan resign.** Hari terakhir 31 Oktober. HR membuka Edit, mengisi Tanggal keluar 31 Oktober, Status "Resign", simpan. Login ditangguhkan. Pada 1 November, HR menghasilkan slip Oktober dengan "Generate" per karyawan (bukan batch), lalu setujui dan bayar.

**Skenario D — Cuti dua tahap.** Dani mengajukan Cuti tahunan 3 hari. Manager depot menyetujui tahap 1 (status Menunggu HR). HR menyetujui tahap 2 → absensi berstatus Cuti ditulis, kuota berkurang 3.

**Skenario E — Absen tertahan.** Kurir absen di luar radius; baris "Menunggu persetujuan". HR memeriksa skor wajah 92% dan foto, menekan "Setujui" → status Hadir/Terlambat sesuai jam.

**Skenario F — Kesalahan input absen.** Status keliru "Absen" padahal hadir. HR mengubah dropdown ke Hadir, mengisi alasan "Koreksi mesin", menekan "Koreksi".

**Skenario G — Bonus terlambat dicatat.** Slip Oktober sudah Disetujui. HR hendak menambah bonus. Ditolak: "Payroll … sudah Disetujui…". HR mencatatnya pada November.

**Skenario H — Pinjam karyawan antar-depot.** Manager depot B meminta pinjam karyawan depot A 3 hari lewat "Permintaan pinjam karyawan". HR membuka kartu karyawan tersebut, menekan "Setujui" → Terjadwal → Berjalan pada tanggal mulai (fitur harus aktif).

## 13. Daftar periksa penyelesaian

- [ ] Konfigurasi Gaji, Kalender Kerja, Shift terisi sebelum payroll pertama.
- [ ] Karyawan baru: akun login dan jabatan benar.
- [ ] Offboarding: Status + Tanggal keluar + slip terakhir + aset.
- [ ] Absen tertahan bulan itu seluruhnya diputuskan.
- [ ] Cuti dan kasbon diproses oleh orang berbeda sesuai aturan.
- [ ] Payroll: Draft → Disetujui → transfer bank → Dibayar.
- [ ] Beban BPJS perusahaan diunduh.
- [ ] Impor: pratinjau diperiksa, baris gagal diperbaiki.
- [ ] Pengumuman target benar.

## 14. Inventaris screenshot bab ini

| ID | Layar | Kondisi | Status |
|---|---|---|---|
| SS-hr-01 | Rel menu konsol HR | 22 item, masuk sebagai HR | Belum diambil |
| SS-hr-02 | HR Dashboard | Kartu angka + dokumen kedaluwarsa | Belum diambil |
| SS-hr-03 | Formulir "Tambah Karyawan" | Dropdown jabatan terbuka | Belum diambil |
| SS-hr-04 | Peringatan nomor sudah dipakai | Kartu kuning + "Ya, gunakan akun itu" | Belum diambil |
| SS-hr-05 | Impor karyawan | Pratinjau + tombol impor | Belum diambil |
| SS-hr-06 | Kartu "Enroll Wajah" | Tiga foto + persetujuan | Belum diambil |
| SS-hr-07 | Absensi | Absen menunggu persetujuan + dialog koreksi | Belum diambil |
| SS-hr-08 | Pengajuan Cuti | Filter "Menunggu atasan" | Belum diambil |
| SS-hr-09 | Daftar Payroll | Filter periode + "Buat sedepot" | Belum diambil |
| SS-hr-10 | Slip gaji Draft | "Hitung ulang" dan "Setujui" | Belum diambil |
| SS-hr-11 | Konfirmasi "Tandai Dibayar" | Slip Disetujui | Belum diambil |
| SS-hr-12 | Laporan | Kartu laporan + CSV/Excel/PDF | Belum diambil |
| SS-hr-13 | Penugasan lintas depot | Baris Diajukan (fitur aktif) | Belum diambil |

## 15. Catatan celah & hal yang perlu dikonfirmasi

Rujukan: lihat `17-open-questions`.

| No | Celah | Tag |
|---|---|---|
| 1 | `DEPOT_ASSIGNMENT_ENABLED` bawaan false; belum diketahui apakah aktif di produksi. Bila mati, kartu penugasan, permintaan pinjam, dan pembagian gaji per depot tidak berfungsi. | [V][K] |
| 2 | Tidak ada wizard offboarding; sesi/token yang sudah terbit tidak dicabut seketika. | [V][D] |
| 3 | Pesan penolakan peran dari layanan autentikasi tidak diteruskan ke HR (hanya "auth-service menolak permintaan (403)"). | [V][B] |
| 4 | Dropdown jabatan menawarkan Manager kepada `HEAD_OFFICE`/`DIREKTUR` walau server menolak. | [V][B] |
| 5 | Tidak ada kotak masuk global permintaan pinjam untuk HR; cara notifikasi ke HR belum diketahui. | [V][K] |
| 6 | Tidak ada maker-checker payroll; tidak ada pembatalan persetujuan; "Tandai Dibayar" hanya status. | [V][K] |
| 7 | Payroll hanya bisa dibuat setelah bulan berakhir; batch melewati karyawan non-Aktif. | [V] |
| 8 | Tabel TER PPh 21 kosong sampai dimuat; tarif bawaan perlu dikonfirmasi pajak/bisnis. | [V][K] |
| 9 | Placeholder "mis. EMP-0012" berbeda dari format kode asli `HR-####`; pesan klien menampilkan nama kolom teknis mentah ("depotId", "fullName"). | [V][B] |
| 10 | Judul layar peran-tidak-sah di Permintaan pinjam memakai teks impor yang dipakai ulang. | [V][B] |
| 11 | `HEAD_OFFICE`/`DIREKTUR` memegang `hrAdmin` tetapi tidak dapat memutuskan cuti di layar (bukan `leaveApprove`), tidak mengelola tunjangan, payroll, atau kasbon. | [V][B] |
| 12 | Label pintu "Konsol HQ" di rel HR belum ditemukan di kamus. | [D] |
| 13 | Belum diperiksa: `/hr/me`, notifikasi ke HR, jendela maksimum filter absensi (@IsWithinDays), rumus skor kinerja, ambang kecocokan wajah selain 75% penanda merah, nilai target audiens pengumuman, isi entri Log Audit. | [K] |
| 14 | Hak akses di bab ini adalah nilai bawaan; Admin dapat mengubahnya saat berjalan. | [V] |
| 15 | Belum ada pengujian yang dijalankan oleh penulis dokumen ini. | – |
