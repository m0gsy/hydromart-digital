# Bab 14 — Panduan Cepat

| | |
|---|---|
| **Versi** | 0.1 draf |
| **Tanggal** | 2026-10-10 |
| **Klasifikasi** | Internal — Terbatas (bagian Pelanggan boleh dibagikan) |
| **Status pengujian** | Belum ada pengujian di aplikasi yang dijalankan oleh penulis dokumen ini. Semua isi berasal dari pembacaan kode dan temuan. |

Bab ini ringkasan satu-dua halaman per peran. Rincian dan langkah lengkap ada di Bab 02–10. Hak akses adalah **nilai bawaan**; **SUPER_ADMIN dapat mengubahnya saat runtime** (± 30 detik). Rinciannya di Bab 12.

Tag bukti: **[V]** terverifikasi di kode · **[D]** disimpulkan, perlu konfirmasi · **[K]** perlu konfirmasi bisnis · **[B]** diketahui bermasalah/tidak konsisten. Label berupa kode huruf besar Inggris (mis. `PENDING`) ditandai **(label ID belum ada)**: layar menampilkan kode itu apa adanya atau tidak ada kamus bahasa Indonesia.

## 1. Masuk ke aplikasi (semua peran)

| Langkah | Keterangan |
|---|---|
| 1 | Buka pintu masuk: pelanggan di `/login`; staf di `/hq/login` (pintu staf) atau `/login` (aplikasi Ops memakai `/login`). **[V]** |
| 2 | Masukkan nomor HP (08…, 62…, atau +62… diterima). Tidak ada kata sandi. |
| 3 | Masukkan kode SMS 6 digit. Berlaku 5 menit, maksimal 5 kali salah, kirim ulang setelah 60 detik. **[V]** |
| 4 | Staf dibawa ke konsol sesuai peran (tabel 2). Akun staf dibuat oleh Head office/Super admin, bukan mendaftar sendiri. |

Tidak ada 2FA tambahan untuk staf selain OTP login. **[V]** Menonaktifkan akun tidak memutus token yang sudah terbit (hingga ± 15 menit). **[V]**

## 2. Quick-start per peran

### 2.1 Customer (Pelanggan) — Publik/Pelanggan

| Item | Isi |
|---|---|
| Mendarat di | Beranda `/`; bilah bawah: Beranda, Belanja, Pesanan, Akun **[V]** |
| 3 hal pertama | 1) Daftar/masuk dengan nomor HP, 2) pilih lokasi antar (Gunakan lokasi saya), 3) tambah galon ke keranjang lalu Checkout |
| Bayar | Tunai (COD), transfer, atau QRIS ke rekening/QRIS depot (unggah bukti, tunggu staf konfirmasi). E-wallet/VA belum tentu aktif **[D]** |
| Lacak | Pesanan → detail (segarkan otomatis 15 detik), atau bagikan link lacak |
| Batalkan | Hanya saat Dipesan/Dikonfirmasi/Disiapkan dan kurir belum pernah ditugaskan |
| Bantuan | `/help` → Chat dengan CS atau Komplain saya |
| Jangan | Berharap checkout tanpa login (tidak ada) atau ubah alamat setelah pesan (tidak ada fitur) **[V]** |

### 2.2 Kepala depot — Internal — Terbatas

| Item | Isi |
|---|---|
| Mendarat di | Ringkasan hari ini (`/dashboard`), tab atas **[V]** |
| Tab utama | Ringkasan · Antrean · Penjualan · Kurir · Inventory · Retur · Setoran; lanjutan: Pelanggan, Insiden, Promo, Hadiah, Broadcast, Absen saya, Shift, Huddle, Serah terima, Perawatan, Kelola depot, Notifikasi, Laporan, Audit **[V]** |
| 3 hal pertama | Absen saya (check-in wajah) → Penjualan → Buka shift (modal laci) → cek Antrean |
| Cakupan | Satu depot saja (terkunci) |
| Bukan wewenang | Approval, refund, pengadaan, pengaturan depot/QRIS, promo banner, buka kembali buku, kasbon. Minta ke Manajer/HQ |
| Hati-hati | Opname langsung mengubah stok; selisih > Rp 100.000 (bawaan) jadi approval Manajer setelahnya |

### 2.3 Staf depot (kurir)

| Item | Isi |
|---|---|
| Mendarat di | `/driver`, tab: Tugas, Riwayat, Profil **[V]** |
| 3 hal pertama | Mulai shift · check-in (harus ≤ radius depot, bawaan 200 m) → atur status Online → ambil tugas |
| Alur antar | Konfirmasi barang diambil → Mulai antar → (COD: Terima uang dulu) → Sampai tujuan · ambil bukti → Selesaikan pengantaran |
| Bukti wajib | Foto, kondisi segel, nama penerima; tanda tangan opsional |
| Akhir shift | Akhiri shift · check-out (tidak bisa bila masih ada pengantaran berjalan) → Setor ke kasir |
| Bukan wewenang | Kasir, stok, verifikasi setoran, menugaskan diri tanpa fitur ambil-sendiri (bawaan mati) |
| Offline | Beberapa aksi diantre di HP; banner "{n} data belum terkirim" |

### 2.4 Supervisor (SPV)

| Item | Isi |
|---|---|
| Mendarat di | `/dashboard` tampilan eksekutif (Pendapatan, SLA, Rata-rata antar, Terlewat) **[V]** |
| Menu | Operasi, Antrean pesanan, Live tracking, Inventori (baca), Retur galon (baca), Meteran air (baca), Perkiraan, Notifikasi, Reseller, Insiden, Sengketa order, Target, Buku kas, Rekonsiliasi bayar, Audit, Absen saya |
| Cakupan | Himpunan depot dari hierarki |
| Bisa menulis | Ubah status pesanan, tugaskan/tarik/batalkan pengiriman, insiden, sengketa, target, buku kas |
| Bukan wewenang | Konfirmasi pembayaran, refund, kasbon, cuti, stok, approval |
| Hati-hati | Menu Performa tim, Komisi kurir, Tinjauan bulanan tampil tetapi ditolak server **[B]** |

### 2.5 Asisten Supervisor (ASPV)

| Item | Isi |
|---|---|
| Mendarat di | `/dashboard` tampilan eksekutif |
| Menu | Seperti SPV tetapi tanpa Notifikasi ops, Insiden, Sengketa, Target, Buku kas, Reseller |
| Tugas khas | **Memutus kasbon** staf depot yang ia asuh (Antrean Kasbon di `/hr/loans/requests`) — tidak ada tautan menu, buka lewat notifikasi atau alamat **[D]** |
| Aturan kasbon | Isi Cicilan per bulan (Rp) dan Mulai potong (YYYY-MM); tolak wajib alasan; tidak boleh memutus kasbon sendiri |

### 2.6 Waralaba (pemilik)

| Item | Isi |
|---|---|
| Mendarat di | Waralabaku (`/dashboard/franchise`), 30 hari terakhir **[V]** |
| Menu | Waralabaku, Pencarian, Retur galon (baca), Perkiraan, Jadwal shift, Payout & komisi, Peran & akses, Akun saya |
| Pertama kali | Daftarkan rekening di Payout & komisi → tunggu "Terverifikasi" (oleh kantor pusat) → baru bisa Cairkan saldo |
| Catatan | Penarikan langsung Diproses (saldo dipotong); layar tidak menampilkan status Lunas/Gagal penarikan **[B]** |
| Bukan wewenang | Pesanan, stok, harga, staf, approval |

### 2.7 HR

| Item | Isi |
|---|---|
| Mendarat di | HR Dashboard (`/hr`) |
| Menu utama | Karyawan, Absensi, Pengajuan Cuti, Payroll, Bonus & Potongan, Tunjangan, Kasbon, Aset, Pengumuman, Shift & Rotasi, Kalender Kerja, Laporan, Konfigurasi Gaji, Log Audit **[V]** |
| Bulanan | Payroll hanya bisa dibuat setelah bulan berakhir; urutan: Generate/Buat sedepot → Setujui → Tandai Dibayar |
| Cuti | HR memegang tahap 1 dan 2 tetapi akun yang sama tidak boleh memutus keduanya |
| Bukan wewenang | Mengundang staf di Direktori staf, mengubah hierarki, setelan global gaji |

### 2.8 HQ (Head office)

| Item | Isi |
|---|---|
| Mendarat di | Ringkasan jaringan (`/hq`) |
| Menu utama | Ringkasan jaringan, Direktori depot, Direktori staf, Lamaran waralaba, Waralaba, Pembayaran, Harga jaringan, Voucher, Refund, Rekonsiliasi, Laba rugi jaringan, Ekspor laporan, Log audit, Permintaan data (UU PDP) |
| Tugas khas | Putuskan usulan harga, lamaran waralaba, permintaan PDP (batas 3x24 jam), buka kembali buku harian |
| Hati-hati | Banyak tombol tulis tampil tetapi ditolak server (depot, kampanye, payout, refund) **[B]** |

### 2.9 Admin (Super admin)

| Item | Isi |
|---|---|
| Mendarat di | `/hq` dan semua konsol |
| Khusus Admin | Peran & hak akses, Hierarki pembinaan, Hapus staf, Feature flags, Kunci API, Webhooks, Retensi & backup, Keamanan, Pengaturan global |
| Aturan emas | Perubahan matriks berlaku ± 30 detik di seluruh layanan; tinjau dengan "Lihat diff / Salin" sebelum Simpan |
| Hati-hati | Hapus staf permanen dan tak dapat dibatalkan; "Nonaktifkan" tidak memutus token (≤ 15 menit) **[V]** |

### 2.10 Peran tambahan

| Peran | Mendarat di | Inti tugas | Perhatian |
|---|---|---|---|
| **Manajer** | `/dashboard` (web), `/m/manager` (ponsel) | Antrean approval (Setujui/Tahan/Tolak), pengadaan, pengaturan depot, klaim kurir ≤ Rp 500.000, cuti tahap 1, refund (mulai) | Tidak boleh memutus approval yang ia ajukan; tidak punya pintu `/hq` |
| **Direktur** | `/hq` | Baca jaringan, setujui rilis payout (bukan pengaju), putuskan harga/lamaran/fraud | Tidak mengundang staf atau memutus PDP |
| **Finance** | Layar `/hq` pertama yang diizinkan | Refund (putus), payout (Lunas/Gagal), komisi, pajak, payroll | Beberapa layar kemungkinan error penuh **[D]** |
| **Marketing** | `/dashboard/campaigns` | Kampanye, promo, voucher, hadiah, churn | Tanpa pintu `/hq` |

## 3. Tugas yang sering dilakukan

| Tugas | Peran | Di mana | Ringkas | Catatan |
|---|---|---|---|---|
| Proses pesanan | KD, SPV, ASPV, MGR | Antrean → Proses | Lanjut ke Confirmed → Lanjut ke Preparing | Pembayaran online otomatis Dikonfirmasi; COD tetap Dipesan sampai staf konfirmasi |
| Konfirmasi bayar | KD, MGR (staf kurir untuk COD) | Detail pesanan → Konfirmasi lunas | Isi "Uang tunai diterima" bila tunai | Hanya status PENDING |
| Tugaskan kurir | KD, SPV, ASPV, MGR | Antrean → Tugaskan | Pilih kurir Tersedia | Kurir harus punya shift terbuka; bawaan 1 tugas aktif |
| Penjualan konter | KD, MGR | Penjualan | Buka shift → pilih produk → metode → Simpan & cetak struk | Wajib shift terbuka |
| Batalkan penjualan konter | KD, MGR | Penjualan terakhir → Batalkan penjualan | Alasan wajib | Hanya pada shift terbuka milik sendiri |
| Opname stok | KD, MGR | Inventory → Opname / Opname massal | Isi jumlah fisik | Langsung mengubah stok |
| Verifikasi setoran | KD, MGR, FIN | Setoran → Hitung & verifikasi | Cek tunai, centang bebankan selisih, Verifikasi | Surplus > Rp 5.000 wajib catatan |
| Tutup shift kasir | KD, MGR | Penjualan → Tutup shift | Hitung laci → Tutup & hitung selisih | Selisih hanya dicatat |
| Tutup buku harian | KD, MGR, HO, DIR | Laporan → harian → Tutup buku | Pilih tanggal | Ditolak bila ada shift kasir terbuka |
| Putuskan approval | MGR | Antrean approval → detail | Setujui / Tahan / Tolak (catatan wajib) | Bukan item buatan sendiri |
| Ajukan refund | MGR, FIN | Detail pesanan lunas → Ajukan refund | Isi Alasan refund | > Rp 100.000 menunggu FINANCE |
| Putuskan kasbon | ASPV (utama), MGR/HR (eskalasi) | `/hr/loans/requests` | Isi cicilan dan bulan mulai → Setujui | Tolak wajib alasan |
| Putuskan cuti | MGR/HR (1), HR (2) | Pengajuan Cuti | Setujui / Tolak | Tolak wajib catatan |
| Buat payroll | HR, FIN | Payroll | Generate atau Buat sedepot → Setujui → Tandai Dibayar | Setelah bulan berakhir |
| Undang staf | HO, SA | Direktori staf → Undang staf | Nomor, peran, depot, posisi, gaji → Kirim undangan | Pembatasan peran (Bab 12 §5.3) |
| Ubah hak akses | SA | Peran & hak akses | Klik sel → Simpan | ± 30 detik |
| Putuskan permintaan PDP | HO, SA | Permintaan data (UU PDP) | Setujui/Tolak (alasan wajib bila tolak) | Batas 3x24 jam |
| Cairkan saldo | FRA | Payout & komisi → Cairkan saldo | Jumlah atau "Semua" | Butuh rekening Terverifikasi |
| Setor COD | STF | Pendapatan → Setor uang tunai | Isi jumlah disetor | Setelah check-out |

## 4. Definisi status penting

Label dikutip dari kamus bahasa Indonesia bila ada. **(label ID belum ada)** = tidak ditemukan kamus; arti ditulis penulis, bukan teks layar.

### 4.1 Pesanan (`OrderStatus`)

| Nilai | Label di layar | Arti |
|---|---|---|
| CREATED | Dipesan | Checkout selesai, menunggu pembayaran/konfirmasi |
| CONFIRMED | Dikonfirmasi | Lunas atau dikonfirmasi staf |
| PREPARING | Disiapkan | Depot menyiapkan / kembali ke antrean penugasan |
| DRIVER_ASSIGNED | Kurir ditugaskan | Pelanggan tidak bisa membatalkan lagi |
| PICKED_UP | Diambil kurir | Pesanan tidak bisa diedit |
| ON_DELIVERY | Dalam perjalanan | Di jalan |
| DELIVERED | Tiba | Bukti antar tercatat |
| COMPLETED | Selesai | Poin, stok, kredit pemilik diproses |
| CANCELLED | Dibatalkan | Pembayaran dibalik, stok dilepas |
| VOIDED | Dibatalkan di kasir | Penjualan konter dibatalkan |

Catatan: layar staf dan `/track` menampilkan label **Inggris** (Order placed, Confirmed, Preparing, Driver assigned, Picked up, On the way, Delivered, Completed, Cancelled, Voided at the counter) **[B]**.

### 4.2 Pembayaran dan refund

| Nilai | Label | Arti |
|---|---|---|
| PENDING | Menunggu pembayaran | Dibuat, belum diterima (COD tunai menunggu kurir) |
| PAID | Lunas | Uang diterima |
| FAILED | Gagal | Gagal/kedaluwarsa (non-tunai > 24 jam) |
| REFUNDED | Dikembalikan | Refund dieksekusi |
| CANCELLED | (label ID belum ada) | Dibatalkan bersama pesanan saat PENDING |
| Refund NONE/PENDING/APPROVED/REJECTED | (label ID belum ada) | PENDING = menunggu FINANCE; pembayaran tetap PAID |

Layar detail pesanan staf dan pelanggan menampilkan PENDING/PAID/CASH/QRIS mentah **[B]**.

### 4.3 Pengiriman, shift kurir, setoran

| Objek | Nilai | Label | Arti |
|---|---|---|---|
| Pengiriman | ASSIGNED / PICKED_UP / ON_DELIVERY | Ditugaskan / Diambil / Diantar | Aktif |
| | DELIVERED | Selesai (Tiba di langkah) | Bukti tercatat |
| | FAILED | Gagal | Pesanan ikut dibatalkan |
| | RESCHEDULED | Dijadwalkan ulang | Kurir dilepas; pesanan kembali Disiapkan |
| Shift kurir | ONLINE / BREAK / OFFLINE / ENDED | Online / Istirahat / Offline / (ENDED: label ID belum ada) | Hanya Online menerima tugas |
| Setoran | SUBMITTED | Menunggu verifikasi | Menunggu kasir |
| | VERIFIED | Terverifikasi | Selesai |
| | DISPUTED | Sengketa | Dibahas luar sistem; di UI belum bisa diselesaikan **[B]** |
| Shift kasir | OPEN / CLOSED | (label ID belum ada); teks "Shift terbuka", "Shift ditutup" | Laci |

### 4.4 Approval, insiden, sengketa, pengadaan

| Objek | Nilai | Label | Arti |
|---|---|---|---|
| Approval depot | PENDING / APPROVED / REJECTED / HELD | (label ID belum ada) | HELD = ditahan, tidak muncul di daftar **[B]** |
| Jenis approval | OPNAME_VARIANCE / DEPOSIT_REFUND / COD_VARIANCE / GALLON_VARIANCE | Selisih opname / Refund deposit / Kurang setoran / Selisih retur galon | COD_VARIANCE tidak pernah dibuat sistem **[V]** |
| Insiden depot | OPEN / IN_PROGRESS / RESOLVED | Baru / Ditangani / Selesai (chip) | |
| Sengketa order | OPEN / RESOLVED / REJECTED | Terbuka / Selesai / Ditolak | Resolusi: Refund / Kirim ulang / Tolak |
| Pesanan pembelian | DRAFT / SENT / RECEIVED | Draft / (label ID belum ada) / (label ID belum ada) | |
| Transfer stok | SENT / RECEIVED / CANCELLED | Di jalan / Diterima / Ditarik kembali | |
| Usulan harga | PENDING / APPROVED / REJECTED | (label ID belum ada); antrean "Override menunggu" | |

### 4.5 HR

| Objek | Nilai | Label | Arti |
|---|---|---|---|
| Absensi | PRESENT / LATE / ABSENT / LEAVE / HOLIDAY / PENDING | Hadir / Terlambat / Absen / Cuti / Libur / Menunggu persetujuan | PENDING belum dihitung hadir |
| Cuti | PENDING_MANAGER / PENDING_HR / APPROVED / REJECTED / CANCELLED | Menunggu atasan / Menunggu HR / Disetujui / Ditolak / Dibatalkan | Disetujui tidak bisa dibatalkan karyawan |
| Kasbon | PENDING / APPROVED / REJECTED / CANCELLED | Menunggu keputusan / Disetujui / Ditolak / Dibatalkan | Satu pengajuan terbuka per karyawan |
| Payroll | DRAFT / APPROVED / PAID | Draft / Disetujui / Dibayar | "Dibayar" hanya mencatat, tidak memindahkan uang |
| Karyawan | ACTIVE / INACTIVE / RESIGNED | Aktif / Nonaktif / Resign | Resign wajib tanggal keluar |
| Penugasan lintas depot | REQUESTED / PLANNED / ACTIVE / DONE / CANCELLED / FAILED | Diajukan / Terjadwal / Berjalan / Selesai / Dibatalkan / Gagal | Fitur bawaan mati **[K]** |
| Aset | AVAILABLE / ASSIGNED / RETURNED / MAINTENANCE / LOST | Tersedia / Dipegang / Dikembalikan / Perbaikan / Hilang | Hilang final |

### 4.6 Uang, waralaba, platform

| Objek | Nilai | Label | Arti |
|---|---|---|---|
| Penarikan | PROCESSING / PAID / FAILED | Diproses / Lunas (Terkirim di app kurir) / Gagal | Diproses = saldo sudah dipotong |
| Rilis HQ | PENDING / APPROVED / REJECTED | (label ID belum ada) | |
| Rekening payout | PENDING / VERIFIED / REJECTED | Menunggu verifikasi kantor pusat / Terverifikasi / Ditolak | Alasan tolak kosong dari UI ("tanpa alasan") **[B]** |
| Klaim pengeluaran | PENDING / APPROVED / REJECTED | Menunggu / Disetujui / Ditolak | Otomatis ≤ Rp 50.000 dengan struk |
| Lamaran waralaba | PENDING / DOC_VERIFICATION / SURVEY / APPROVED / REJECTED | Baru / Verifikasi dokumen / Survei / Disetujui / Ditolak | Final bila Disetujui/Ditolak |
| Penukaran hadiah | ACTIVE / USED / CANCELLED | Menunggu diambil / Sudah diambil / Dibatalkan | |
| Langganan | ACTIVE / PAUSED / CANCELLED | Aktif / Dijeda / Dibatalkan | Dijeda otomatis setelah 3 gagal |
| Tiket | OPEN / ASSIGNED / RESOLVED | Terbuka / Ditugaskan / Selesai (pelanggan: Menunggu ditangani / Sedang ditangani / Selesai) | |
| Fraud | OPEN / REVIEWED / BLOCKED / CLEARED | Terbuka / Ditinjau / Diblokir / Aman | Blokir menonaktifkan login |
| Permintaan PDP | PENDING / COMPLETED / REJECTED | Menunggu / Selesai / Ditolak | Batas 3x24 jam |
| Insiden platform | ONGOING / RESOLVED | Berlangsung / Selesai | |
| Akun pelanggan | PENDING_VERIFICATION / ACTIVE / SUSPENDED / DELETED | (label ID belum ada) | Staf di direktori: Aktif/Nonaktif |

## 5. Tanggung jawab persetujuan (siapa memutus apa)

| Keputusan | Pengaju | Pemutus (bawaan) | Syarat |
|---|---|---|---|
| Selisih opname, retur galon, refund deposit | Kepala depot / sistem | Manajer, Super admin | Pengaju ≠ pemutus; ambang bawaan Rp 100.000 (ubah hanya HO/SA) |
| Refund | Manajer, Finance, SA | Finance, SA | Di atas Rp 100.000 antre; tidak ada cek pemohon ≠ penyetuju |
| Usulan harga depot | Manajer, SA | HO, DIR, SA | Pengusul tak boleh memutus bila dampak besar |
| Lamaran waralaba | Calon mitra (form publik) | HO, DIR, SA | Final; depot dan akun dibuat manual setelahnya |
| Rilis saldo waralaba | Finance, SA | Direktur, SA | Bukan akun yang sama |
| Penarikan saldo (pemilik) | Pemilik | Tanpa persetujuan; Finance/SA tandai Lunas/Gagal | Rekening terverifikasi |
| Klaim pengeluaran kurir | Kurir | Manajer ≤ Rp 500.000; Finance/SA di atasnya | Otomatis ≤ Rp 50.000 dengan struk |
| Cuti | Karyawan | Tahap 1 Manajer/HR; tahap 2 HR/HO/DIR/SA | Tahap 2 ≠ tahap 1 |
| Kasbon | Karyawan | Asisten SPV (bila ada); selain itu Manajer/HR/SA | Tidak boleh memutus sendiri |
| Peminjaman karyawan lintas depot | Manajer, SPV | HR, HO, DIR, SA | Fitur bawaan mati |
| Permintaan UU PDP | Pelanggan | HO, SA | 3x24 jam; Direktur tidak |
| Buka kembali buku harian | — | HO, SA | |
| Payroll | HR/Finance | HR/Finance/SA | Tanpa maker-checker |
| Setoran COD | Kurir | Kepala depot, Manajer, Finance, SA | Keputusan beban selisih tanpa persetujuan lain |

## 6. Kanal eskalasi (hanya yang terdokumentasi)

| Pihak | Kanal terdokumentasi | Catatan |
|---|---|---|
| Pelanggan | `/help` → **Chat dengan CS** / Hubungi CS (WhatsApp/telepon depot pelanggan); **Komplain saya** (tiket ke kantor pusat, status Menunggu ditangani/Sedang ditangani/Selesai, jawaban "Balasan Hydromart") | Tombol chat hanya ada bila depot punya nomor **[V]** |
| Pelanggan (data pribadi) | Menu Akun & pengaturan → Data pribadi saya → Minta hapus akun; atau surel `privacy@hydromart-digital.com` | Pada 2026-09-25 domain itu belum punya MX (surel bisa terpental); **verifikasi sebelum dicantumkan** **[B]** |
| Kurir | Bantuan & FAQ → "Kontak darurat depot" (Telepon, Chat admin); pesan "Hubungi admin depot" bila belum ditempatkan | Nomor adalah data depot **[K]** |
| Karyawan (absen offline kedaluwarsa) | "Minta entri manual ke HR" | Dalam aplikasi |
| Karyawan/Atasan | Alur persetujuan dalam aplikasi (cuti, kasbon) | |
| Operasi teknis (tim ops) | Peringatan otomatis ke webhook obrolan (Discord) dan jadwal jaga dalam `RUNBOOK_ONCALL.md` | Internal tim ops, bukan pengguna akhir |
| **Staf umum** | **Tidak ada kanal eskalasi/helpdesk, nomor telepon, atau surel dukungan staf yang terdokumentasi di repositori.** Eskalasi hanya lewat atasan langsung, Manajer, HR, atau Head office sesuai tabel persetujuan. | Perlu ditentukan pemilik **[K]** |
| Kerentanan keamanan | GitHub Security Advisories | Bukan untuk pengguna harian |

## 7. Resolusi error umum

| Pesan (persis) | Arti | Solusi |
|---|---|---|
| Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya. | Anda membuka depot di luar cakupan | Pilih depot yang benar di pemilih depot; minta SUPER_ADMIN cek hierarki |
| Akun ini belum diberi tanggung jawab depot manapun. | Akun tidak punya depot | Minta HQ/Admin memberi penempatan atau hibah depot |
| You do not have permission to perform this action. | Anda tidak punya izin (403) | Tombol tampil tetapi peran tidak boleh; lihat Bab 12 **[B]** |
| This courier is not checked in and available. | Kurir belum check-in/Online | Minta kurir Mulai shift dan Online |
| This driver already has the maximum number of active deliveries. | Kurir sudah penuh (bawaan 1 tugas) | Pilih kurir lain atau tunggu selesai |
| Buka shift kasir dulu sebelum mencatat penjualan di konter. | Penjualan butuh shift | Penjualan → Buka shift |
| Masih ada {n} shift kasir terbuka. Tutup shift dulu, baru buku harian. | Tutup buku diblokir | Tutup semua shift kasir lalu coba lagi |
| Explain the surplus in the note before verifying this deposit. | Surplus setoran > Rp 5.000 tanpa catatan | Isi Catatan lalu Verifikasi |
| Pembebanan selisih ke kurir belum tercatat di buku upahnya, jadi setoran ini belum diverifikasi. Coba lagi. | Beban selisih gagal dicatat | Tekan lagi (aman diulang) |
| Pengaju tidak boleh memutuskan pengajuannya sendiri — teruskan ke atasan. | Larangan putus sendiri | Minta pemegang approval lain |
| This approval item has already been approved or rejected. | Sudah diputuskan | Muat ulang |
| Kasbon ini diputuskan oleh asisten supervisor depotnya. | Depot punya ASPV; Anda bukan dia | Teruskan ke ASPV depot |
| Tahap kedua harus diputuskan orang lain, bukan pemutus tahap pertama | Cuti tahap 2 oleh orang yang sama | Gunakan akun HR lain |
| Periode {YYYY-MM} belum selesai. Payroll baru bisa dibuat setelah bulan itu berakhir. | Payroll dibuat terlalu cepat | Tunggu bulan berakhir |
| Withdrawal of {x} exceeds available balance {y}. | Jumlah melebihi saldo | Kurangi jumlah (artinya: penarikan melebihi saldo tersedia) |
| Belum ada rekening tujuan yang terverifikasi. Daftarkan rekening dan tunggu verifikasi kantor pusat sebelum menarik saldo. | Rekening belum terverifikasi | Daftarkan rekening; minta FINANCE verifikasi |
| Peran {ROLE} hanya boleh diberikan oleh {A atau B}. | Pembatasan pemberian peran | Minta SUPER_ADMIN (atau HR untuk MANAGER) |
| This account has been suspended. | Akun dinonaktifkan | Hubungi atasan/HR/HQ untuk diaktifkan |
| Kode verifikasi salah. / Kode verifikasi sudah kedaluwarsa. Minta kode baru. | OTP salah/lewat 5 menit | Minta kode baru setelah 60 detik |
| Akun ini tidak aktif. Hubungi dukungan Hydromart. | Pelanggan ditangguhkan/dihapus | Gunakan kanal pada bagian 6 |
| Di luar area absen depot ({n} m dari titik). Absen harus di lokasi. | Geofence absen aktif | Absen di depot |
| Absen offline sudah terlalu lama. Minta entri manual ke HR. | Punch tertunda terlalu lama | Hubungi HR |
| Cannot move an order from X to Y. | Transisi status tidak sah | Muat ulang; status sudah berubah |
| Nomor HP Indonesia tidak valid. Contoh: 081234567890. | Format nomor | Perbaiki nomor |

## 8. Daftar periksa operasional

### 8.1 Harian dan akhir hari per peran

| Peran | Awal hari | Akhir hari |
|---|---|---|
| **Customer** | — | Cek pesanan aktif; beri nilai pesanan yang tiba |
| **Kepala depot** | [ ] Absen saya (check-in) · [ ] Meteran pagi (`/dashboard/meter`, alamat manual) · [ ] Buka shift kasir · [ ] Cek jadwal shift/kurir · [ ] Serah terima shift lama · [ ] Filter Stok menipis | [ ] Semua setoran COD terverifikasi (Ringkasan: 0) · [ ] Opname bila perlu · [ ] Meteran sore · [ ] Tutup shift kasir · [ ] Serah terima · [ ] Laporan → Tutup buku · [ ] Absen check-out |
| **Staf depot (kurir)** | [ ] Check-in depot · [ ] Status Online · [ ] Baca pengumuman | [ ] Selesaikan/gagalkan/jadwal ulang semua tugas · [ ] Check-out · [ ] Setor ke kasir · [ ] Pastikan banner antrean offline kosong |
| **Supervisor** | [ ] Operasi: SLA dan terlewat · [ ] Insiden terbuka · [ ] Notifikasi ops | [ ] Tinjau depot bermasalah · [ ] Tindak lanjut sengketa/insiden · [ ] Absen check-out |
| **Asisten SPV** | [ ] Antrean Kasbon (lewat notifikasi/alamat) · [ ] Operasi | [ ] Pengajuan kasbon tuntas · [ ] Absen check-out |
| **Waralaba** | [ ] Waralabaku: stok kritis, SLA | [ ] Cek saldo dan status rekening (mingguan/bulanan) |
| **HR** | [ ] Absen Menunggu persetujuan · [ ] Pengajuan Cuti (tahap 2) · [ ] Antrean kasbon bila eskalasi | [ ] Dokumen/kontrak segera habis (30 hari) · [ ] Bulanan: Payroll setelah bulan berakhir |
| **HQ** | [ ] Lamaran waralaba baru · [ ] Permintaan PDP (batas 3x24 jam) · [ ] Tiket dan insiden | [ ] Refund menunggu (lihat; putus oleh Finance) · [ ] Log audit bila perlu |
| **Admin** | [ ] Kesehatan sistem (sapuan tak pernah jalan) · [ ] Insiden platform | [ ] Tinjau perubahan matriks · [ ] Backup terakhir dan uji restore |
| **Manajer** | [ ] Antrean approval · [ ] Notifikasi ops · [ ] Klaim kurir | [ ] Stok kritis · [ ] Approval kosong · [ ] Tinjauan bulanan (akhir bulan) |
| **Direktur** | [ ] Ringkasan jaringan | [ ] Rilis payout menunggu persetujuan |
| **Finance** | [ ] Refund menunggu · [ ] Penarikan menunggu jawaban bank | [ ] Rekening menunggu verifikasi · [ ] Payroll bila jadwal |
| **Marketing** | [ ] Kampanye berjalan · [ ] Penukaran hadiah | [ ] Churn dan audiens |

Sumber tugas berurutan untuk Kepala depot: temuan B §4 (urutan **[D]**: sistem tidak memaksa). Meteran tidak ada di tab operator **[V]**.

## 9. FAQ singkat

| Pertanyaan | Jawaban |
|---|---|
| Apakah ada kata sandi? | Tidak. Masuk dengan nomor HP dan kode SMS. **[V]** |
| Kenapa SMS tidak datang? | Penyebab umum: saldo SMS habis; tunggu 60 detik lalu kirim ulang. Hubungi atasan/Admin bila terus gagal. **[K]** |
| Apakah notifikasi lewat WhatsApp/surel? | Tidak. Hanya kotak masuk aplikasi dan push. WhatsApp dan surel tidak dipakai sebagai kanal sistem. **[V]** |
| Kenapa tombol ada tapi ditolak? | Layar tidak menyaring semua tombol per peran. Server menentukan (Bab 12 §5.1). **[B]** |
| Kenapa menu hilang? | Menu menyesuaikan kapabilitas; Super admin bisa mengubahnya. |
| Berapa lama perubahan hak akses berlaku? | Sekitar 30 detik (hierarki depot ± 60 detik). |
| Pelanggan membatalkan setelah kurir ditugaskan? | Tidak bisa; hubungi depot, depot dapat membatalkan pengiriman. |
| Siapa memutus kasbon? | Asisten SPV depotnya; bila tak ada, Manajer/HR. |
| Kenapa "Dibayar" payroll tidak mengirim uang? | Itu hanya penanda; transfer dilakukan di luar sistem. **[V]** |
| Berapa lama bukti antar disimpan? | 12 bulan lalu dihapus otomatis. **[V]** |
| Apakah QRIS otomatis? | Tidak, QRIS depot manual dan dikonfirmasi staf. **[V]** |
| Apakah saldo waralaba cair tanggal 15? | "Payout berikutnya" hanya tampilan tanggal; tidak ada otomatisasi yang ditemukan. **[D]** |
| Browser yang didukung? | Peramban modern setara Chrome 111+ (kesimpulan, bukan pernyataan resmi). **[D]** |

## 10. Celah baru yang ditemukan saat menulis bab ini

| # | Celah | Tag |
|---|---|---|
| 1 | Tidak ada kanal eskalasi/helpdesk staf yang terdokumentasi. | **[K]** |
| 2 | Surel privasi tanpa MX pada 2026-09-25; verifikasi sebelum publikasi. | **[B]** |
| 3 | Layar persetujuan cuti, kasbon, pinjam karyawan tanpa tautan menu dari rel `/dashboard`. | **[D]** |
| 4 | Meteran air tidak ada di tab operator Kepala depot padahal bagian dari rutinitas pagi/sore. | **[V]** |
| 5 | FINANCE: layar payout/komisi kemungkinan error; alur harus diuji. | **[D]** |
| 6 | Penjelasan peran: Bab 12 menghitung MANAGER 68 kapabilitas (temuan D: 70). | **[B]** |
