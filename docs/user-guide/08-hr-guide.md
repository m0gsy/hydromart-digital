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
