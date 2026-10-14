# Bab 13 — Pemecahan Masalah dan FAQ

| | |
|---|---|
| **Dokumen** | 13 — Pemecahan Masalah dan FAQ per modul |
| **Versi** | 0.1 (draf) |
| **Tanggal** | 2026-10-10 |
| **Klasifikasi** | Internal — Terbatas (bagian pelanggan, T-01 s.d. T-10 dan FAQ pelanggan, boleh dibagikan sebagai "Publik/Pelanggan") |
| **Bahasa** | Indonesia |
| **Dokumen terkait** | `01` s.d. `10` (panduan peran), `17-open-questions-and-documentation-gaps.md` (daftar celah, ID G-xxx) |

> **Catatan status dokumen.** Bab ini disusun dari pembacaan kode dan temuan tim. **Belum ada pengujian yang dijalankan oleh penulis dokumen ini.** Setiap klaim penting diberi tag bukti:
> **[V]** terverifikasi di kode · **[D]** dugaan/disimpulkan, perlu konfirmasi · **[K]** perlu konfirmasi bisnis (nilai berasal dari data/pengaturan) · **[B]** diketahui bermasalah atau tidak konsisten.
> Fitur yang tidak ada ditulis "Tidak tersedia".

> **Pembaruan 2026-10-14 (sejak PR #664).** Bab ini dicocokkan ulang dengan kode setelah PR #664 digabung (daftar perbaikan dan keputusan pemilik: `docs/OPEN_GAPS_DECISIONS_2026-10.md`). Perubahan ditandai "(sejak PR #664, 2026-10-14)". Butir yang sudah diperbaiki tidak lagi bertag **[B]**; butir yang tetap terbuka tetap bertag **[B]**/**[K]**. Pencocokan dilakukan dengan membaca kode; belum ada pengujian peramban oleh penulis.

> **Catatan hak akses.** Semua nama peran dan izin di bab ini adalah nilai BAWAAN dari `packages/access/src/index.ts`. Super admin dapat mengubah hak akses saat sistem berjalan, dan perubahan berlaku kira-kira 30 detik kemudian. Jika layar Anda berbeda dari bab ini, tanyakan ke Admin. **[V]**

---

## 1. Cara Memakai Bab Ini

1. Cari gejala Anda di daftar isi (bagian 2) atau di tabel pesan error (bagian 17).
2. Baca baris **Penyebab**. Penyebab bertag **[V]** sudah ditelusuri di kode. Penyebab bertag **[D]** hanya dugaan: periksa dulu sebelum memutuskan.
3. Jalankan **Diagnosis** dari atas ke bawah. Berhenti di langkah pertama yang menjelaskan gejala.
4. Lakukan **Perbaikan** hanya jika peran Anda tercantum di baris **Peran/izin**. Jika tidak, lanjut ke **Eskalasi**.
5. Saat melapor, sertakan semua butir di bagian 3.

### 1.1 Daftar isi masalah

| Kelompok | ID masalah |
|---|---|
| Masuk dan sesi | T-01 s.d. T-10 |
| Akses menu dan cakupan depot | T-11 s.d. T-16 |
| Data wajib hilang dan validasi | T-17, T-18 |
| Transaksi tidak bisa dikirim | T-19 s.d. T-26 |
| Persetujuan tertunda | T-27 s.d. T-32 |
| Status tidak berubah | T-33 s.d. T-37 |
| Laporan tidak bisa dibuat | T-38 |
| Unggah dan unduh gagal | T-39 s.d. T-43 |
| Notifikasi tidak diterima | T-44 s.d. T-47 |
| Kurir: jarak, sesi shift, setoran | T-48 s.d. T-53 |
| Absensi wajah | T-54 |
| Payroll dan BPJS | T-55 s.d. T-58 |
| Payout waralaba | T-59 s.d. T-63 |
| Pesan error persis dan artinya | bagian 17 |
| FAQ per audiens | bagian 18 |

---

## 2. Tingkat Eskalasi

Hanya jalur yang terdokumentasi di repositori yang dicantumkan. Tidak ada nomor telepon pusat, jam layanan pusat, atau email dukungan umum yang terdokumentasi. **[K]**

| Tingkat | Siapa | Kapan | Catatan |
|---|---|---|---|
| 0 | Mandiri: halaman **Bantuan** (`/help`) | Pertanyaan umum pelanggan | Topik: "Lacak & masalah pengiriman", "Pembayaran & refund", "Galon, deposit & tukar", "Akun & keamanan" **[V]** |
| 1 | Atasan langsung: Kepala depot (untuk kurir dan staf depot) | Tugas, uang tunai, setoran, klaim | Lihat Bab 4 bagian 9.3 **[V]** |
| 2 | Manajer, SPV, atau HR | Persetujuan, cuti, kasbon, absensi, slip gaji | Lihat Bab 5 dan Bab 8 |
| 3 | Kantor pusat (peran Head office/HQ) atau Finance | Refund besar, payout, rekening, komisi, lamaran waralaba | Lihat Bab 9 |
| 4 | Admin (Super admin) | Hak akses, hierarki, akun staf, sesi, kebijakan keamanan | Lihat Bab 10 |
| 5 | Tim teknis | Layanan mati, galat yang berulang, data tidak masuk akal | Papan insiden di konsol HQ (status Berlangsung/Selesai). Kontak jaga ada di `docs/RUNBOOK_ONCALL.md` (tidak disalin ke sini). Tanpa eskalasi otomatis **[V]** |
| Pelanggan | **Chat dengan CS** di Bantuan | Masalah pesanan | Membuka WhatsApp ke nomor depot pelanggan, muncul bila depot punya nomor. Ini tautan chat ke depot, bukan saluran notifikasi **[V]** |
| Pelanggan | **Ajukan komplain** di `/help` | Keluhan formal | Status: Menunggu ditangani, Sedang ditangani, Selesai. Apakah balasan sampai ke pelanggan sebagai notifikasi: tidak ada notifikasi yang ditemukan **[B]** |
| Publik | `privacy@hydromart-digital.com` | Permintaan privasi | Domain tidak punya catatan MX per 2026-09-25, surat berisiko tidak sampai. Cek ulang sebelum mengutipnya **[B][K]** |

---

## 3. Informasi yang Harus Disertakan Saat Melapor

Laporan yang lengkap mempercepat penyelesaian. Salin tabel ini ke pesan Anda.

| Butir | Contoh isian (sintetis) |
|---|---|
| Nama dan peran di layar | "Budi (contoh), Kepala depot" |
| Modul dan alamat halaman (URL) | `/dashboard/walk-in` |
| Waktu kejadian (tanggal, jam, zona waktu) | 2026-10-10 14:32 WIB |
| Perangkat dan peramban | Android 12, Chrome; atau aplikasi kurir |
| Langkah yang dilakukan sebelum gagal | 1) Buka halaman 2) Tekan **Simpan** |
| Pesan error PERSIS (salin atau foto layar) | "You do not have permission to perform this action." |
| Nomor pesanan, nomor slip, atau kode referensi | ORD-0001 (contoh) |
| Depot yang dipilih di pemilih depot | "Semua depot" atau nama depot |
| Apakah terjadi berulang, dan sejak kapan | Selalu; sejak 10:00 |
| Yang sudah Anda coba | Muat ulang, keluar lalu masuk |

Jangan sertakan: kode OTP, isi SMS yang memuat kode, token, kata kunci, atau nomor rekening lengkap. Gunakan foto layar dengan data sensitif ditutup. Dalam contoh bab ini semua data bersifat sintetis. **[D]**

---

## 4. Masuk dan Sesi (T-01 s.d. T-10)

Dasar teknis: masuk memakai nomor telepon dan kode sekali pakai (OTP) lewat SMS. Tidak ada kata sandi. Panjang kode 6 digit, berlaku 5 menit, maksimal 5 kali salah, jeda kirim ulang 60 detik. Nilai ini adalah bawaan yang dapat disetel lewat konfigurasi **[V]** (`services/auth-service/src/config/env.validation.ts:32-35`). Layar verifikasi mengunci 6 kotak, sedangkan server bisa disetel 4–8 digit **[B]** (`apps/web/src/app/verify/page.tsx:27`).

### T-01 — Kode OTP (SMS) tidak datang

| Butir | Isi |
|---|---|
| **Gejala** | Setelah menekan **Kirim kode** atau **Kirim ulang kode**, tidak ada SMS. |
| **Kemungkinan penyebab** | (a) Gerbang SMS lambat. Layar menampilkan "Kodenya sedang dikirim dan bisa terlambat beberapa detik. Tunggu sebentar sebelum minta kode baru." **[V]** (b) Gerbang SMS menolak: server menjawab AUTH_OTP_UNDELIVERABLE, layar menampilkan "Kode belum bisa dikirim sekarang. Coba lagi." Pengguna boleh mencoba lagi langsung **[V]** (`otp.service.ts:86-132`). (c) Kredit SMS penyedia habis: catatan operasional menyebut ini penyebab terumum **[V]** (Bab 1 bagian 14). (d) Nomor salah ketik atau bukan nomor seluler Indonesia **[V]**. (e) Jeda 60 detik belum lewat (lihat T-03). (f) Batas 20 permintaan per menit per alamat IP (lihat T-04). (g) Saluran SMS produksi belum disetel: saluran `console` hanya menulis kode ke log dan hanya untuk pengembangan **[V]**; kondisi produksi nyata **[K]**. |
| **Langkah diagnosis** | 1) Periksa nomor di layar verifikasi ("Masukkan kode yang kami kirim ke {nomor}"). 2) Cek sinyal dan kotak SMS, termasuk folder spam/blokir. 3) Tunggu hitung mundur "Kirim ulang dalam {n}d" selesai. 4) Tekan **Kirim ulang kode** sekali. 5) Coba nomor lain/perangkat lain dengan jaringan berbeda untuk memisahkan masalah IP. |
| **Prosedur perbaikan** | Gunakan hanya SMS terbaru: kode baru membatalkan kode lama **[V]**. Bila setelah 2–3 percobaan tidak ada SMS, hubungi dukungan (pelanggan: **Bantuan**; staf: atasan). Admin/tim teknis memeriksa kredit SMS dan konfigurasi saluran. |
| **Peran/izin** | Semua pengguna (mengirim ulang). Pemeriksaan kredit dan saluran SMS: tim teknis, tidak ada layar di konsol **[D]**. |
| **Eskalasi** | Tingkat 4 lalu 5 bila lebih dari satu pengguna terdampak pada waktu yang sama, atau bila sudah menunggu lebih dari beberapa menit tanpa SMS. |
| **Lapor dengan** | Nomor (sebagian disamarkan), waktu minta kode, operator seluler, pesan di layar, apakah pengguna lain terdampak. |

### T-02 — Kode ditolak berulang / kode salah 5 kali

| Butir | Isi |
|---|---|
| **Gejala** | "Kode verifikasi salah." Setelah percobaan ke-5: "Terlalu banyak percobaan. Minta kode baru." dan kotak kode serta tombol **Verifikasi & lanjut** terkunci. Atau "Kode verifikasi sudah kedaluwarsa. Minta kode baru." |
| **Kemungkinan penyebab** | (a) Salah ketik. (b) Memakai kode dari SMS lama: setiap permintaan baru membatalkan kode sebelumnya **[V]** (`otp.service.ts:58-66`). (c) Lebih dari 5 menit sejak kode dikirim (hitung mundur "Kode berlaku {m:ss} lagi."; bila 0: "Kode kedaluwarsa. Minta kode baru.") **[V]**. (d) Percobaan salah maksimal 5 per kode; hitungan dicatat sebelum kode dibandingkan **[V]** (`otp.service.ts:157-184`). |
| **Langkah diagnosis** | Bandingkan jam SMS terbaru dengan kode yang diketik. Perhatikan apakah Anda menekan kirim ulang lebih dari sekali (kode lama sudah mati). |
| **Prosedur perbaikan** | Tunggu hitung mundur jeda, tekan **Kirim ulang kode**, lalu ketik kode dari SMS paling baru. Percobaan salah dihitung ulang untuk kode baru **[V]**. |
| **Peran/izin** | Semua pengguna. |
| **Eskalasi** | Bila kode benar-benar dari SMS terbaru dan tetap ditolak di perangkat dan jaringan berbeda: tingkat 5. |
| **Lapor dengan** | Waktu minta kode, berapa kali kirim ulang, pesan persis, apakah layar verifikasi dibuka di dua tab. |

### T-03 — Tombol kirim ulang tidak bisa ditekan / jeda 60 detik

| Butir | Isi |
|---|---|
| **Gejala** | Tombol bertuliskan "Kirim ulang dalam {n}d". Atau pesan "Kode baru bisa diminta sebentar lagi. Cek SMS yang sudah masuk dulu." |
| **Kemungkinan penyebab** | Jeda kirim ulang bawaan 60 detik **[V]** (`env.validation.ts:35`). Server menjawab AUTH_OTP_COOLDOWN dengan pesan Inggris "Please wait Ns before requesting another code." (arti: tunggu N detik sebelum meminta kode lagi) **[V]**. |
| **Langkah diagnosis** | Lihat hitung mundur di tombol. Setelah mencapai 0, label berubah menjadi **Kirim ulang kode**. |
| **Prosedur perbaikan** | Tunggu. Sambil menunggu, periksa kotak SMS: kode yang sudah masuk masih berlaku sampai 5 menit. |
| **Peran/izin** | Semua pengguna. |
| **Eskalasi** | Tidak perlu. Bila hitung mundur tidak pernah selesai (tombol tetap nonaktif setelah 60 detik): laporkan ke tingkat 5 sebagai galat tampilan **[D]**. |
| **Lapor dengan** | Perangkat, peramban, tangkapan layar hitung mundur. |

### T-04 — "Terlalu banyak permintaan kode" (batas 20 per menit per IP)

| Butir | Isi |
|---|---|
| **Gejala** | "Terlalu banyak permintaan kode. Tunggu sebentar, lalu minta kode lagi." (kode RATE_LIMITED_OTP). Untuk jalur lain: "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi." (RATE_LIMITED). |
| **Kemungkinan penyebab** | Gerbang membatasi jalur penerbit OTP (`/auth/register`, `/auth/login`, `/auth/otp/resend`) dengan ember token per alamat IP: kapasitas 20, isi ulang 20 per 60 detik **[V]** (`gateway.setup.ts:183,294-305`; `env.validation.ts:50`). Pembatas umum bawaan 600 permintaan **[V]**. Dugaan: banyak orang di satu jaringan (kantor, wifi bersama, jaringan seluler yang berbagi IP) menghabiskan jatah bersama **[D]**. |
| **Langkah diagnosis** | Tanyakan apakah orang lain di jaringan yang sama sedang masuk. Coba lagi setelah satu menit. Coba jaringan seluler pribadi. |
| **Prosedur perbaikan** | Tunggu 1 menit. Hindari menekan **Kirim kode** berulang-ulang. Nilai batas dapat diubah lewat konfigurasi (tim teknis) **[V]**. |
| **Peran/izin** | Semua pengguna. Mengubah batas: tim teknis. |
| **Eskalasi** | Tingkat 5 bila terjadi pada banyak orang di banyak jaringan, atau tetap terjadi lebih dari 5 menit. |
| **Lapor dengan** | Jaringan (kantor/seluler), jam kejadian, pesan persis, jumlah orang yang masuk bersamaan. |

### T-05 — Akun nonaktif / SUSPENDED / tidak bisa masuk

| Butir | Isi |
|---|---|
| **Gejala** | Pelanggan yang ditangguhkan: "Akun ini tidak aktif. Hubungi dukungan Hydromart." (pelanggan yang akunnya sudah DIHAPUS tidak mendapat pesan ini: login dengan nomor itu dijawab sebagai nomor belum terdaftar, uji 2026-10-14, G-153 **[B]**; diklaim selesai oleh pemilik produk, tetapi tidak ditemukan perubahan kode; kemungkinan perilaku sengaja karena nomor dibebaskan saat penghapusan akun, perlu konfirmasi). Staf: pesan Inggris "This account has been suspended." Setelah dinonaktifkan, akses yang sedang berjalan bisa bertahan sampai 15 menit lalu mati. |
| **Kemungkinan penyebab** | Status akun SUSPENDED atau DELETED menolak masuk **[V]** (`customer.entity.ts:91-105`). Untuk staf, tombol **Nonaktifkan** di Direktori staf menjadikan akun SUSPENDED (tidak ada istilah terpisah "nonaktif" dan "suspend") **[V]** (`H-admin` P5). Sejak PR #664 (2026-10-14), saat login dimatikan (staf lewat **Nonaktifkan**, HR lewat status karyawan, dan pelanggan) server mencabut SEMUA token penyegar akun itu, sehingga sesi tidak bisa diperpanjang **[V]** (`account.service.ts applyActive`). Token akses yang sudah terbit tetap berlaku sampai habis (maksimal 15 menit) karena tidak ada pengecekan status per permintaan; setelah itu pembaruan sesi gagal dengan "This account has been suspended." **[V][K]** (keputusan pemilik: terima 15 menit atau bangun pengecekan, masih menunggu). Penangguhan DEPOT belum mencabut sesi staf depotnya **[K]**. Akun DELETED tidak pernah dihidupkan lagi; pekerja yang dipekerjakan ulang mendapat akun baru **[V]**. |
| **Langkah diagnosis** | Admin atau Head office: buka **Direktori staf** (`/hq/staff`), cari nomor, lihat lencana Aktif/Nonaktif. HR: cek status karyawan (Aktif/Nonaktif/Resign) di `/hr/employees`. |
| **Prosedur perbaikan** | Staf: Head office atau Super admin menekan **Aktifkan** pada baris akun (tanpa dialog konfirmasi). Mengundang ulang nomor yang sama juga mengaktifkan kembali akun nonaktif **[V]**. Pelanggan SUSPENDED: layar untuk mengaktifkan kembali pelanggan tidak ditemukan di temuan **[D]**; eskalasi ke tingkat 3–4. |
| **Peran/izin** | Aktifkan/Nonaktifkan staf: kapabilitas `staffAdmin` (Head office, Super admin) **[V]**. HR tidak punya akses `/hq/staff` **[V]**. |
| **Eskalasi** | Tingkat 4 bila akun diduga dinonaktifkan keliru. Sejak PR #664 server menolak menonaktifkan akun sendiri ("Akun sendiri tidak bisa dinonaktifkan.") dan menonaktifkan Super admin terakhir ("Ini super admin terakhir. Angkat super admin lain dulu sebelum menonaktifkan.") **[V]**; prosedur pemulihan bila satu-satunya Super admin tetap kehilangan akses (nomor hilang) belum ada **[K]**. |
| **Lapor dengan** | Nomor akun (disamarkan), peran, pesan persis, kapan terakhir berhasil masuk, siapa yang terakhir mengubah status (lihat Log audit). |

**Sub-masalah: permintaan hapus akun pelanggan ditolak karena pesanan terbuka (sejak PR #664, 2026-10-14).** Saat Head office/Super admin menyetujui permintaan hapus akun di `/hq/pdp`, server menolak (409, kode PDP_OPEN_ORDERS) bila pelanggan masih punya pesanan yang belum selesai (selain Selesai, Dibatalkan, Dibatalkan di kasir): "Akun ini masih punya {n} pesanan yang belum selesai. Tunggu pesanan selesai atau dibatalkan, atau minta Super Admin memaksa penghapusan." **[V]**. Pemeriksaan bersifat fail-closed: bila order-service tak terjangkau, penghapusan juga ditolak dengan pesan layanan tak tersedia (mis. "order-service tidak terjangkau: …") **[V]**. Perbaikan: tunggu pesanan selesai/dibatalkan lalu setujui lagi. **[B]** Bila SETIAP persetujuan hapus akun dijawab 503 ("ORDER_SERVICE_URL/INTERNAL_SERVICE_KEY belum diset…" atau "CUSTOMER_SERVICE_URL/INTERNAL_SERVICE_KEY not configured…"), layanan auth belum diberi alamat layanan lain: berkas compose di repo belum memuatnya (G-149, uji 2026-10-14); minta Operasi melengkapi konfigurasi. **Status G-149 (2026-10-14):** diperbaiki di cabang `fix/uat-g128-g149-g152` (5a8ae4a) (compose test dan prod kini memberi `auth` alamat layanan order, delivery, loyalty, admin, dan customer di berkas test), belum di `main` per 2026-10-14; terverifikasi dari kode, belum diuji ulang di stack; sampai cabang digabung, konfigurasi compose di `main` masih memicu 503. **Status G-150:** tiga eksekutor PDP yang salah alamat/ditolak (pengantaran, tiket bantuan, poin) juga diperbaiki di cabang yang sama, belum di `main`, belum diuji ulang; sampai itu, data penerima pengantaran, tiket bantuan, dan catatan poin bisa tetap berisi identitas walau permintaan berstatus COMPLETED. Hanya Super admin yang boleh memaksa: pada penolakan itu muncul dialog "Paksa hapus akun?" (tombol "Ya, paksa hapus"); peran lain yang mengirim paksa mendapat 403 "Hanya Super Admin yang boleh memaksa penghapusan." Audit mencatat penghapusan paksa beserta jumlah pesanan **[V]**. Karena fail-closed, permintaan PDP bisa menunggu lebih lama dari tenggat hukum; peringatan lewat batas waktu belum ada **[K]**.

### T-06 — "Nomor HP Indonesia tidak valid"

| Butir | Isi |
|---|---|
| **Gejala** | "Nomor HP Indonesia tidak valid. Contoh: 081234567890." atau (undangan staf) `"X" is not a valid Indonesian mobile number.` |
| **Kemungkinan penyebab** | Nomor harus seluler Indonesia. Format diterima: 08…, 62…, +62…, 8…; spasi, tanda hubung, kurung, titik dibuang; hasil akhir harus cocok `^\+628\d{7,11}$` **[V]** (`phone-number.ts:17-47`). Di impor Excel, nomor/NIK tertulis notasi ilmiah (mis. 8,12E+11) ditolak **[V]**. |
| **Langkah diagnosis** | Hitung digit setelah 8. Periksa awalan dan karakter tersembunyi. |
| **Prosedur perbaikan** | Ketik ulang nomor. Di Excel, format kolom telepon sebagai Teks sebelum mengisi. |
| **Peran/izin** | Semua pengguna. |
| **Eskalasi** | Tidak perlu, kecuali nomor sah ditolak: tingkat 5. |
| **Lapor dengan** | Nomor dengan sebagian digit disamarkan, format yang diketik. |

### T-07 — Nomor baru langsung diminta mendaftar / "belum diverifikasi"

| Butir | Isi |
|---|---|
| **Gejala** | Mengetik nomor yang belum pernah dipakai di layar masuk, lalu layar verifikasi bertuliskan "Selesaikan pendaftaran." Atau "Nomor ini sudah terdaftar tapi belum diverifikasi. Kami kirim ulang kodenya." Atau AUTH_PHONE_TAKEN saat mendaftar. |
| **Kemungkinan penyebab** | Server tidak menolak nomor tak dikenal saat masuk: nomor didaftarkan awal (PENDING_VERIFICATION) dan diberi kode pendaftaran, untuk mencegah penebakan nomor **[V]** (`login.service.ts:52-75`). Pesan "Nomor ini belum terdaftar." hanya muncul lewat jalur kirim ulang untuk nomor tak dikenal **[V]**. Mendaftar dengan nomor yang sudah ACTIVE menghasilkan AUTH_PHONE_TAKEN dan layar mengarahkan ke halaman masuk **[V]**. Email yang dipakai nomor lain: AUTH_EMAIL_TAKEN **[V]**. |
| **Langkah diagnosis** | Pastikan nomor yang diketik adalah nomor yang pernah dipakai mendaftar. Salah satu digit akan membuat akun baru. |
| **Prosedur perbaikan** | Kembali ke **Kembali ke masuk**, periksa nomor, ulangi. Jika sengaja baru, lanjutkan pendaftaran. |
| **Peran/izin** | Pelanggan. |
| **Eskalasi** | Tidak perlu. |
| **Lapor dengan** | Nomor (disamarkan), layar yang tampil, pesan persis. |

### T-08 — Sesi berakhir sendiri / diminta masuk ulang (idle 15 menit)

| Butir | Isi |
|---|---|
| **Gejala** | Tiba-tiba kembali ke layar masuk. Pesan Inggris dari server: "The session was idle for too long.", "The session has expired.", atau "This session was terminated for security reasons." |
| **Kemungkinan penyebab** | Token akses berlaku 15 menit, token penyegar 30 hari dan diputar setiap penyegaran **[V]** (`env.validation.ts:29-30`; `session.service.ts:172-199`). Batas diam ("idleTimeoutMinutes") diatur Kantor pusat di `/hq/security`; komentar kode menyebut bawaan 15 menit, tetapi nilai produksi **[K]**. Batas diam dicek saat penyegaran dan, bila terlewati, seluruh keluarga sesi dicabut; nilai kosong atau 0 berarti tanpa batas, dan bila kebijakan tak terbaca maka tanpa batas **[V]** (`session.service.ts:102-115`). Memakai ulang token yang sudah diputar (mis. dua tab/perangkat berbagi sesi yang sama) mencabut seluruh keluarga sesi **[V]** (`:74-78`); kaitan dengan perilaku pengguna adalah dugaan **[D]**. Penggantian nomor telepon mencabut semua sesi, termasuk sesi yang sedang dipakai **[V]**. |
| **Langkah diagnosis** | Tanyakan: apakah layar didiamkan lebih dari batas diam? Apakah baru ganti nomor? Apakah masuk di beberapa perangkat? Admin: lihat `/hq/security` untuk nilai "Sesi berakhir otomatis (menit idle)". |
| **Prosedur perbaikan** | Masuk lagi dengan OTP. Untuk pelanggan yang hilang/dipinjam perangkatnya: masuk dari perangkat lain lalu **Keluar dari semua perangkat** (Akun). Bila "Gagal memuat daftar perangkat.", muat ulang halaman. |
| **Peran/izin** | Semua pengguna untuk keluar/masuk. Ubah batas diam: Admin (`/hq/security`). Admin tidak dapat memaksa keluar perangkat pengguna lain (Tidak tersedia) **[V]**. |
| **Eskalasi** | Tingkat 4–5 bila sesi putus jauh lebih cepat dari batas yang disetel, atau terjadi berulang saat aktif memakai layar. |
| **Lapor dengan** | Berapa lama layar didiamkan, jumlah perangkat, pesan persis, nilai batas diam di `/hq/security`. |

### T-09 — Staf: akun tidak sesuai pintu atau belum tertaut data karyawan

| Butir | Isi |
|---|---|
| **Gejala** | "Akun ini bukan kurir" (aplikasi kurir). "Akun ini belum tertaut ke data karyawan" atau "Karyawan tidak aktif" (halaman `/hr/me`). "Belum ada depot yang ditugaskan padamu." (pemilik waralaba). "Peran staf depot wajib terikat ke satu depot." (undangan staf). |
| **Kemungkinan penyebab** | Aplikasi kurir `/driver` hanya untuk Staf depot (kode STAFF_DEPOT) dan Super admin **[V]**. Halaman absensi/slip memerlukan akun yang tertaut ke catatan karyawan; HR yang membuat login dan karyawan **[V]** (`attendance.service.ts resolveSelf`). Pemilik waralaba tanpa depot: HQ belum mengisi "Pemilik waralaba" pada depot **[V]**. Peran Staf depot/Kepala depot wajib punya satu depot **[V]**. |
| **Langkah diagnosis** | Cek peran di profil. HR: cari nomor di `/hr/employees` dan pastikan Status = Aktif. HQ: cek kolom pemilik pada depot. |
| **Prosedur perbaikan** | Masuk dengan akun yang benar. HR menautkan atau mengaktifkan karyawan; Head office/Super admin memilih depot pada undangan. |
| **Peran/izin** | HR: kapabilitas `hrAdmin`. Undangan: Head office/Super admin (`staffAdmin`). Depot pemilik waralaba: HQ. |
| **Eskalasi** | Tingkat 2 (HR) lalu 4. |
| **Lapor dengan** | Peran yang diharapkan, pesan persis, nomor (disamarkan). |

### T-10 — Ganti nomor telepon gagal

| Butir | Isi |
|---|---|
| **Gejala** | "Nomor itu sudah menjadi nomor akun ini." (AUTH_PHONE_UNCHANGED) · AUTH_PHONE_TAKEN (nomor dipakai akun lain) · "Tidak ada permintaan ganti nomor yang menunggu. Mulai lagi dari awal." (AUTH_NO_PENDING_PHONE_CHANGE). |
| **Kemungkinan penyebab** | Kode dikirim ke nomor BARU, bukan nomor lama **[V]** (`phone-change.service.ts:60-190`). Setelah sukses semua sesi dicabut dan SMS pemberitahuan dikirim ke nomor LAMA ("Bukan kamu yang melakukannya? Segera hubungi depot.") **[V]**. |
| **Langkah diagnosis** | Pastikan nomor baru belum dipakai akun lain dan SMS masuk di nomor baru. |
| **Prosedur perbaikan** | Mulai ulang dari awal, masukkan kode ke-nomor baru, lalu masuk ulang dengan nomor baru. |
| **Peran/izin** | Pelanggan. Penggantian nomor milik orang lain: tidak ada jalur layar (Tidak tersedia) **[K]**. |
| **Eskalasi** | Tingkat 4–5 bila nomor lama sudah tidak dipegang dan akun harus dipindahkan. |
| **Lapor dengan** | Nomor lama dan baru (disamarkan), langkah yang gagal. |

---

## 5. Akses Menu dan Cakupan Depot (T-11 s.d. T-16)

### T-11 — Layar "Khusus HQ" / akses ditolak

| Butir | Isi |
|---|---|
| **Gejala** | Layar penolak berjudul "Khusus HQ" (juga dipakai konsol lain), atau judul lain seperti "Akses manajer depot", "Khusus Manajer depot", "Akses terbatas", "Khusus admin", "Khusus staf". Tombol **Kembali ke halaman saya**. |
| **Kemungkinan penyebab** | Peran tidak memegang kapabilitas halaman itu **[V]**. Sejak PR #664 (2026-10-14) judul penolak di halaman yang sebelumnya bertuliskan "Khusus Manajer depot" / "Khusus manajer depot" (Huddle, Serah terima, Perawatan, Sengketa, Buku kas, Target, dan sejenisnya) diganti "Akses terbatas", sehingga tidak lagi menyesatkan Kepala depot atau SPV yang lolos gerbang halaman lain **[V]** (`dictionaries/id`, kunci `gateTitle`/`managerOnly`/`gate`). Judul lain (mis. "Khusus HQ") tidak berubah. Hak akses diubah Super admin (berlaku ±30 detik) **[V]**. |
| **Diagnosis** | 1) Cek peran Anda. 2) Buka Indeks layar HQ (`/hq/sitemap`) untuk melihat apa yang diizinkan. 3) Tanyakan apakah hak baru saja diubah. |
| **Perbaikan** | Tekan **Kembali ke halaman saya**. Bila Anda memang perlu akses, atasan meminta Super admin menyesuaikan matriks di `/hq/access`. Jangan memakai akun Admin orang lain. |
| **Peran/izin** | Mengubah hak: Super admin (`accessMatrixWrite`). |
| **Eskalasi** | Tingkat 4. Bila layar yang biasa Anda pakai tiba-tiba menolak, laporkan: bisa jadi matriks diubah atau teks gerbang keliru. |
| **Lapor dengan** | Peran, URL, judul layar persis, kapan terakhir berhasil. |

### T-12 — Menu/tombol tampil tetapi hasilnya 403

| Butir | Isi |
|---|---|
| **Gejala** | Tombol ditekan lalu muncul "Gagal …" atau pesan Inggris "You do not have permission to perform this action." (arti: Anda tidak punya izin melakukan tindakan ini). |
| **Penyebab** | Tombol tidak disaring per peran, server menolak **[B][V]**. Diperbaiki sejak PR #664 (2026-10-14): tab **Pembayaran** di rel Kepala depot disembunyikan bagi peran tanpa `depotAdmin`, dan tombol tulis di tab **Promo** hanya muncul bagi yang punya `promotionWrite` **[V]**. Contoh yang masih terbuka **[B][D]**: Head office/Direktur melihat tombol Onboard/Edit/Tangguhkan depot, Ajukan rilis, Lunas/Gagal, Setujui/Tolak refund, Terapkan skema baru, Re-engage, Buat kampanye, Beri poin; "Aktifkan depot" ditolak tanpa pesan. Kasbon: Manajer ditolak "Kasbon ini diputuskan oleh asisten supervisor depotnya." bila depot punya Asisten SPV **[V]**. |
| **Diagnosis** | Cocokkan tombol dengan tabel batasan peran di bab peran Anda (bagian 9 tiap bab; Bab 9 bagian 9.2 untuk HQ). |
| **Perbaikan** | Serahkan ke peran yang berwenang (tabel di bagian 17.3). Jangan ulangi tindakan berkali-kali. |
| **Peran/izin** | Tergantung tindakan. |
| **Eskalasi** | Tingkat 4 hanya bila peran Anda seharusnya berwenang. |
| **Lapor dengan** | Tombol (label persis), URL, peran, waktu, pesan. |

### T-13 — Perubahan hak akses belum berlaku (±30 detik)

| Butir | Isi |
|---|---|
| **Gejala** | Super admin mengubah matriks, tetapi pengguna masih melihat menu lama atau masih ditolak. |
| **Penyebab** | Perubahan matriks berlaku sekitar 30 detik setelah disimpan **[V]** (`packages/access/src/index.ts loadOverrides`). Tampilan web memakai potret hak dari `/auth/me` milik pengguna yang sedang masuk **[V]** (`roles.ts`), sehingga menu bisa baru berubah setelah muat ulang atau masuk ulang **[D]**. |
| **Diagnosis** | Tunggu 30–60 detik, muat ulang. Lalu keluar dan masuk lagi. |
| **Perbaikan** | Bila grid matriks tampak semua bawaan, JANGAN simpan: grid menampilkan bawaan saat gagal memuat **[B]**. Muat ulang dahulu. |
| **Peran/izin** | Super admin. |
| **Eskalasi** | Tingkat 5 bila lebih dari 5 menit tidak berlaku. |
| **Lapor dengan** | Waktu simpan, kapabilitas dan peran yang diubah, waktu pengguna mencoba. |

### T-14 — Daftar depot kosong / depot tidak terlihat (cakupan ±60 detik)

| Butir | Isi |
|---|---|
| **Gejala** | "Gagal memuat daftar depot." · "Akun ini belum diberi tanggung jawab depot manapun." · "Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya." · depot baru tidak terlihat. |
| **Penyebab** | Asisten SPV, SPV, Manajer melihat himpunan depot dari hierarki (Depot → Asisten SPV → SPV → Manajer) ditambah hak langsung; Staf depot dan Kepala depot terkunci satu depot **[V]** (`hierarchy.service.ts:24-52`). Penugasan baru berlaku dalam ±60 detik (cache) **[V]**. Depot tanpa Asisten SPV hanya terlihat HQ ke atas dan yang diberi hak langsung **[V]**. Himpunan kosong menghasilkan 403 dan pemilih depot gagal dimuat **[D]**. Hierarki hanya diubah Super admin di `/hq/hierarchy` ("Tersimpan. Berlaku di seluruh service dalam 60 detik.") **[V]**. |
| **Diagnosis** | Tunggu 1–2 menit, muat ulang. Super admin: periksa "Asisten SPV tiap depot" dan "Posisi satu akun di rantai" (Depot binaan, Depot titipan langsung). |
| **Perbaikan** | Super admin menugaskan Asisten SPV atau menambah "Depot titipan langsung". Manajer tidak dapat mengubah cakupannya sendiri. |
| **Peran/izin** | Super admin (`hierarchyAdmin`). |
| **Eskalasi** | Tingkat 4. |
| **Lapor dengan** | Akun, peran, depot yang diharapkan, pesan, waktu penugasan terakhir. |

### T-15 — Angka berbeda antara "Semua depot" dan satu depot

| Butir | Isi |
|---|---|
| **Gejala** | Angka landing tidak sama dengan halaman rinci; halaman berlabel "Menampilkan depot pertama — pilih depot di switcher"; impor menolak "Pilih satu depot dulu di pemilih depot". |
| **Penyebab** | Landing KPI menjumlah SEMUA depot dalam cakupan, sedangkan halaman satu-depot (persetujuan, setoran, klaim, inventori, PO, pemasok, borongan, langganan, pembayaran, susut, rating, loyalty, referral) diam-diam memakai depot PERTAMA **[V]**. Aplikasi ponsel Manajer tidak punya "Semua depot" **[V]**. Kartu "Pesanan masuk" memakai 100 pesanan terbaru, bukan hari ini **[B]**; "Order hari ini" di landing Manajer berisi data 30 hari **[B]**. |
| **Diagnosis** | Pilih depot secara eksplisit di pemilih depot. Sejak PR #664 (2026-10-14), bila pemilih berada di "Semua depot" (dan Anda punya 2 depot atau lebih), layar yang bekerja per depot menampilkan pemberitahuan "Menampilkan {nama depot}. Layar ini bekerja per depot, bukan gabungan. Pilih depot di pojok kiri untuk beralih." Layar yang memang gabungan (pesanan, churn, aturan promo, dan impor) tidak menampilkannya **[V]** (`all-depots-notice.tsx`). Pemberitahuan menyebut depot pertama dalam daftar. |
| **Perbaikan** | Gunakan **Laporan** harian untuk angka resmi. |
| **Peran/izin** | Semua peran konsol depot. |
| **Eskalasi** | Tingkat 2 bila angka laporan resmi juga tidak masuk akal. |
| **Lapor dengan** | Depot, tanggal, dua angka yang dibandingkan, tangkapan layar. |

### T-16 — Layar galat penuh untuk Finance / "—" di kartu

| Butir | Isi |
|---|---|
| **Gejala** | Finance membuka Pembayaran, Waralaba, Rekonsiliasi, atau Skema komisi lalu melihat layar galat penuh. "—" di kartu. "Net payout ke pemilik" selalu "—". SPV melihat Komisi kurir/Tinjauan bulanan/Performa tim kosong atau galat (bagian SPV diperbaiki sejak PR #664, lihat Penyebab). |
| **Penyebab** | Halaman memuat data dari layanan yang menolak peran itu (Pembayaran memuat `dashboard`; Waralaba dan Skema komisi memuat `depotDirectory`; Rekonsiliasi memuat `dashboard`) **[B][V]**. Dari pembacaan kode, bukan uji peramban **[D]**. "—" artinya data tidak terbaca, BUKAN nol **[V]**. Biaya platform hanya terbaca dengan `depotAdmin` **[V]**. Sejak PR #664 (2026-10-14), menu **Komisi kurir**, **Tinjauan bulanan**, dan **Performa tim** di konsol depot memakai kapabilitas yang ditegakkan server (`courierSettle`, `dailyClose`, `deliveryReports`), sehingga peran tanpa kapabilitas itu (mis. SPV) tidak lagi melihat menu yang berujung 403 **[V]** (`roles.ts`, `ops-rail.tsx`). Layar galat penuh untuk Finance di Pembayaran/Waralaba/Skema komisi/Rekonsiliasi **terbukti pada uji layar 2026-10-14 di `main`** ("You do not have permission to perform this action.", tombol "Coba lagi") **[B][V]**. **Status perbaikan:** commit 609a497 pada cabang `fix/uat-g128-g149-g152` menambah empat kapabilitas baca untuk Finance (`dashboardFinance`, `orderReportsFinance`, `depotDirectoryFinance`, `returnsReadFinance`), tetapi cabang itu BELUM di `main` dan BELUM diuji ulang; selama belum digabung, galat ini masih terjadi dan jawaban "Perbaikan" di bawah tetap berlaku **[V code]**. |
| **Diagnosis** | Catat halaman dan peran. Tes: apakah akun HQ lain dapat membuka halaman itu? |
| **Perbaikan** | Mintalah Manajer atau Admin membaca angka itu. Jangan berbagi akun Admin. |
| **Peran/izin** | Admin. |
| **Eskalasi** | Tingkat 4–5; alur Finance (Lunas/Gagal, Skema komisi) wajib diverifikasi di lingkungan nyata. |
| **Lapor dengan** | Peran, URL, tangkapan layar, waktu. |

---

## 6. Data Wajib Hilang dan Validasi (T-17, T-18)

### T-17 — Formulir tidak bisa disimpan / "data wajib" kosong

| Butir | Isi |
|---|---|
| **Gejala** | Tombol nonaktif, atau pesan merah di bawah kolom. |
| **Penyebab** | Kolom wajib kosong atau format salah. Pesan-pesan dikutip di tabel di bawah (arti dan solusi). Beberapa pesan klien menampilkan nama kolom teknis mentah ("depotId", "fullName") **[B]**. |
| **Diagnosis** | Periksa kolom bertanda wajib (*). Lihat tabel. |
| **Perbaikan** | Lengkapi kolom. Untuk Excel, gunakan template. |
| **Peran/izin** | Peran yang membuka formulir itu. |
| **Eskalasi** | Tingkat 2 bila kolom sudah benar tetapi tetap ditolak. |
| **Lapor dengan** | Formulir, nilai (disamarkan) yang diisi, pesan. |

| Pesan di layar | Modul | Arti dan solusi |
|---|---|---|
| "Lengkapi alamat pengiriman dulu." | Checkout | Isi penerima, telepon, alamat, kota **[V]** |
| "Titik peta wajib diisi — tekan "Gunakan lokasi saya"." | Alamat | Titik peta wajib; izinkan lokasi atau isi koordinat **[V]** |
| "Titik peta tidak valid: lintang harus antara -90 dan 90." / "... bujur harus antara -180 dan 180." | Alamat | Koordinat di luar rentang **[V]** |
| "Pilih depot dulu untuk melanjutkan." | Checkout | Alamat tanpa pin peta: pilih depot **[V]** |
| "Keranjangmu kosong. Tambahkan produk sebelum checkout." | Checkout | Tambah produk **[V]** |
| "Ambil foto bukti pengantaran dulu." / "Pilih dulu kondisi segel galonnya." / "Isi nama penerima." | Kurir, bukti antar | Foto, kondisi segel, nama penerima wajib; tanda tangan opsional **[V]** |
| "Kurang dari total tagihan." | Kurir, COD | Uang diterima kurang dari tagihan **[V]** |
| "Isi kategori, keterangan, dan nominal (> 0)." | Buku kas | Tiga kolom wajib **[V]** |
| "Isi angka bulat (boleh negatif)." · "Isi jumlah 0 atau lebih." · "Isi angka 0 atau lebih." | Inventory | Angka bulat; opname minimal 0 **[V]** |
| "Masukkan jumlah galon (lebih dari 0)." · "Deposit harus 0 atau lebih." | Retur galon | Isi jumlah > 0 **[V]** |
| "Cicilan dan bulan mulai wajib diisi untuk menyetujui." · "Alasan penolakan wajib diisi." | Kasbon (HR/Asisten SPV) | Cicilan bulat > 0 dan YYYY-MM; tolak butuh alasan (maks. 300 karakter) **[V]** |
| "Lengkapi karyawan, tanggal, dan alasan." | Cuti atas nama karyawan | Semua wajib **[V]** |
| "Isi tanggal & nama" · "Isi nama shift" | Kalender kerja | Wajib **[V]** |
| "Isi employeeId & tanggal" · "Isi employeeId untuk generate" · "Pilih depot dulu" | HR | Pilih karyawan/depot **[V]** |
| "nik harus 16 digit angka" | Karyawan | NIK tepat 16 digit **[V]** |
| "Masukkan nomor telepon." | Undangan staf | Wajib **[V]** |
| "dailyRate wajib diisi untuk tipe gaji DAILY" / "monthlyRate wajib diisi untuk tipe gaji MONTHLY" | Undangan staf | Isi gaji sesuai tipe **[V]** |
| "Isi alasan penolakan." | Antrean approval | Alasan wajib untuk Tolak **[V]** |
| "Isi nomor HP pembeli dulu — voucher menempel pada akun." | Penjualan konter | Voucher butuh nomor **[V]** |

### T-18 — Impor Excel/CSV gagal

| Butir | Isi |
|---|---|
| **Gejala** | Pratinjau menampilkan "{n} baris bermasalah" atau pesan di atas pratinjau. |
| **Penyebab** | Maksimal 500 baris per berkas; hanya .xlsx dan .csv; kolom wajib hilang; tanggal bukan YYYY-MM-DD; angka bukan bulat; nomor bukan nomor HP Indonesia; kode depot/departemen/shift tak dikenal **[V]** (`opsFix.import.*`). Pemilih depot harus satu depot untuk impor pelanggan/inventori **[V]**. |
| **Diagnosis** | Baca status per baris ("Baris {r} — status"), unduh "Unduh baris bermasalah" atau "Unduh baris gagal". |
| **Perbaikan** | Perbaiki baris, unggah ulang (aman diulang: nomor yang sudah ada diperbarui) **[V]**. |
| **Peran/izin** | Impor staf: Head office/Super admin; karyawan dan riwayat HR: `hrAdmin`/`hrPayroll`; katalog: `catalogWrite`; pelanggan/inventori: Kepala depot (`depotCrmWrite`/`inventoryWrite`). Tanpa izin: "Impor massal tidak tersedia untuk peran ini". |
| **Eskalasi** | Tingkat 2–3; tingkat 5 bila berkas sah ditolak. |
| **Lapor dengan** | Nama impor, jumlah baris, pesan persis, berkas "baris bermasalah" (data sintetis/disamarkan). |

Pesan impor persis: "File kosong atau tidak punya baris data." (berkas kosong) · "Maksimal 500 baris per file (file ini N)." (kurangi baris) · "Kolom wajib hilang: …" (pakai template) · `"x" bukan file Excel atau CSV. Pilih file .xlsx atau .csv.` · "Format lama (.xls / .ods) tidak bisa dibaca…" (simpan sebagai .xlsx) · "File tidak bisa dibaca…" · `kolom "k" wajib diisi` · `"v" harus format YYYY-MM-DD` · `"v" bukan tanggal yang sah` · `"v" harus format YYYY-MM` · `"v" bukan angka bulat` · `"v" bukan nomor HP Indonesia yang sah` · `kode depot "v" tidak dikenal` · `"v" harus 16 digit angka` · "Hanya bulan yang sudah lewat yang bisa diimpor sebagai riwayat" · "Slip bulan itu sudah ada" (dilewati) · "net {x} tidak sama dengan gross + bonus - potongan ({y})". **[V]**

---

## 7. Transaksi Tidak Bisa Dikirim (T-19 s.d. T-26)

### T-19 — Stok habis saat checkout atau penjualan

| Butir | Isi |
|---|---|
| **Gejala** | Pelanggan: pesan Inggris "Some items are out of stock at the fulfilling depot." atau "Insufficient stock at the fulfilling depot: {productId} (need {n}, have {m})." (memuat ID internal) **[B]**. Konter: "Stok tidak cukup untuk sebagian barang. Jumlahnya sudah diperbarui — sesuaikan lalu coba lagi." |
| **Penyebab** | Stok dicadangkan saat checkout; tersedia = jumlah dikurangi yang ditahan pesanan lain **[V]**. Lainnya: "Could not confirm stock right now. Please try again." (cek stok tak terjangkau); "Product {id} is no longer available." (produk ditarik); "Katalog produk sedang sibuk. Tunggu sebentar, lalu coba lagi." **[V]**. Transfer antar depot hanya dari stok tersedia, dan "Adjustment would drive stock below zero." untuk penyesuaian ke bawah nol **[V]**. |
| **Diagnosis** | Kepala depot: tab **Stok** di Inventory, kolom Stok, Dipesan, Tersedia; buka "Ditahan oleh order". |
| **Perbaikan** | Pelanggan: kurangi jumlah atau pilih produk lain, coba lagi. Depot: **Terima** stok atau **Sesuaikan**; hitung fisik dengan **Opname**. |
| **Peran/izin** | Inventory: `inventoryWrite` (Kepala depot, Manajer, Super admin). |
| **Eskalasi** | Tingkat 1–2 bila stok sistem tidak cocok fisik berulang. Selisih opname > Rp100.000 (bawaan) masuk antrean Manajer **[V]**. |
| **Lapor dengan** | Produk, jumlah diminta/tersedia, depot, waktu, nomor pesanan bila ada. |

### T-20 — Penjualan konter ditolak: shift kasir belum dibuka

| Butir | Isi |
|---|---|
| **Gejala** | Kartu "Belum ada shift terbuka"; tombol "Buka shift dulu" nonaktif; atau 422 "Buka shift kasir dulu sebelum mencatat penjualan di konter." |
| **Penyebab** | Penjualan konter wajib punya shift kasir terbuka (penanggung jawab laci) **[V]**. Shift milik orang yang membukanya; "You already have an open shift at this depot. Close it before opening another." bila sudah terbuka **[V]**. Menutup: "This shift belongs to another cashier." (Kepala depot hanya menutup shiftnya sendiri; menutup milik orang lain butuh Manajer/SPV/Finance/Direktur/Super admin); "This shift is already closed."; "Cash taken this shift cannot be read right now, so the shift cannot be closed. Try again shortly." (layanan pembayaran tak menjawab; shift tetap terbuka) **[V]**. |
| **Diagnosis** | Lihat bilah shift di atas halaman **Penjualan**. |
| **Perbaikan** | Isi "Uang kembalian awal di laci" (kosong = 0), tekan **Buka shift** ("Shift dibuka."). Tutup: hitung dulu, isi "Uang tunai dihitung di laci", **Tutup & hitung selisih**. |
| **Peran/izin** | Buka/tutup shift: `cashierShift` (Kepala depot, Manajer, Super admin). |
| **Eskalasi** | Tingkat 2 bila shift orang lain tak kunjung ditutup dan menghalangi tutup buku ("Masih ada {n} shift kasir terbuka. Tutup shift dulu, baru buku harian."). |
| **Lapor dengan** | Depot, siapa membuka shift, jam, pesan. |

### T-21 — Deposit galon: tidak tampil / refund melebihi / selisih

| Butir | Isi |
|---|---|
| **Gejala** | (Sebelum PR #664) pelanggan tidak melihat baris deposit di checkout. Sejak PR #664 (2026-10-14) checkout menampilkan baris "Deposit galon ({n} galon)" dengan keterangan "Titipan yang dicatat depot saat galon diantar, dikembalikan saat galon kembali. Belum termasuk dalam total yang dibayar." Depot: "Deposit refund exceeds the deposit this depot still holds (refunding X, Y held)." Retur melebihi saldo memicu persetujuan. |
| **Penyebab** | Sejak PR #664 checkout menampilkan ESTIMASI deposit (tarif depot x jumlah galon di keranjang); baris ini tidak masuk total pesanan dan tidak ditagih lewat aplikasi, dan baris disembunyikan bila tarif depot tidak terbaca atau 0 **[V]** (`checkout/page.tsx`, endpoint `GET /depots/:id/gallon-deposit`). Syarat dan Ketentuan Pasal 6 (berlaku 14 Oktober 2026) kini menyatakan depot mencatat deposit saat galon diantar dan mengembalikannya saat galon kembali utuh **[V]**. Deposit adalah buku besar sisi depot (bawaan Rp20.000 per galon, `GALLON_DEPOSIT_IDR`), dicatat saat antar dan dikembalikan saat retur **[V]**; deposit BELUM PERNAH ditagih sebagai bagian dari total pesanan, pembayaran, atau ekspektasi setoran COD; cara dan waktu pelanggan menyerahkan deposit ke depot tetap **[K]** (menagihnya adalah proyek tersendiri yang belum dibangun). Retur lebih banyak dari saldo beredar tetap dicatat dan membuat persetujuan Selisih retur galon; retur rusak tidak mengembalikan deposit **[V]**. Layar sukses kurir "deposit dikembalikan" juga muncul untuk galon rusak **[B]**. |
| **Diagnosis** | Kepala depot: halaman **Retur galon** (kartu "Galon di pelanggan", "Deposit tertahan"); Antrean approval Manajer. |
| **Perbaikan** | Koreksi jumlah refund ≤ deposit tertahan; Manajer memutuskan persetujuan. |
| **Peran/izin** | Mencatat retur: Kepala depot; memutuskan: Manajer. |
| **Eskalasi** | Tingkat 2; pertanyaan kebijakan deposit: lihat Bab 17 (pertanyaan bisnis). |
| **Lapor dengan** | Depot, jumlah galon, nominal deposit, pesanan, pesan persis. |

### T-22 — Checkout ditolak: radius, minimum, depot, ekspres

| Pesan | Arti dan solusi |
|---|---|
| "Titik alamat ini di luar radius antar semua depot kami. Pilih alamat lain, atau ubah titik petanya ke lokasi yang kami layani." (server: "This delivery address is outside our service area. No depot can deliver here.") | Alamat di luar jangkauan (bawaan 5 km **[K]**). Geser titik peta/pilih alamat lain |
| "Pick a depot: this address has no map pin, so we cannot route it automatically." | Alamat tanpa titik: pilih depot |
| "That depot is not available right now. Please pick another one." | Depot nonaktif: pilih depot lain |
| "Minimum pesanan di depot ini Rp {min}. Tambah barang lagi ya." / "Kurang Rp {short} lagi." | Nilai minimum per depot **[K]**; tambah barang |
| "This depot is not taking express deliveries right now. Please pick a time slot." | Ekspres mati atau depot tutup/istirahat; pilih jadwal |
| "Katalog produk sedang sibuk. Tunggu sebentar, lalu coba lagi." | Coba lagi |
| "You can save at most 20 addresses." | Hapus alamat lama (maks. 20) **[V]** |
| Hanya "Bayar di tempat" tersedia | Depot belum mengatur rekening/QRIS **[K]**. E-wallet dan virtual account hanya aktif bila gateway disetel, dan tampaknya belum di produksi **[D][K]**. "Could not reach the payment provider. Please try again." bila gateway tak terjangkau |

Peran: pelanggan. Eskalasi: tingkat 1 (depot) bila alamat sah ditolak. Lapor dengan: alamat (kecamatan saja), depot, pesan.

### T-23 — Voucher ditolak

| Pesan | Arti dan solusi |
|---|---|
| "This voucher is no longer active." | Voucher nonaktif |
| "This voucher is not valid yet." | Belum mulai berlaku |
| "This voucher has expired." | Kedaluwarsa |
| "Your order must be at least {minSpend} to use this voucher." | Belanja minimum (angka mentah) |
| "This voucher has reached its usage limit." | Kuota habis |
| "You have already used this voucher the maximum number of times." | Batas per pelanggan |
| "This voucher has spent its full discount budget." | Anggaran habis |
| "Voucher not found." | Kode salah |
| "Voucher ini hanya berlaku di depot tertentu." / "…produk tertentu yang tidak ada di keranjang." / "Voucher ini khusus untuk pelanggan yang menerimanya." | Syarat depot/produk/penerima |
| "Reseller pricing already applies — vouchers cannot be used on this order." | Harga agen tidak boleh digabung voucher |
| "This voucher only waives delivery, and a counter sale has none. Keep it for a delivery order." | Voucher ongkir tak berlaku di konter |
| "Voucher itu tidak bisa dipakai." | Cadangan umum |

Semua **[V]**. Satu voucher per pesanan. Eskalasi: Marketing/Manajer (pemilik voucher).

### T-24 — Pembayaran: transfer masih PENDING, unggah bukti gagal

| Butir | Isi |
|---|---|
| **Gejala** | Status tampil "PENDING" (kode Inggris mentah **[B]**) setelah transfer; "Bukti bayar gagal diunggah. Coba lagi."; "Penyimpanan bukti bayar sedang tidak tersedia. Coba lagi sebentar lagi."; "Jumlah pembayaran tidak cocok dengan pesanan ini."; "This order already has an active payment." |
| **Penyebab** | Transfer dan QRIS dibayar langsung ke depot dan dikonfirmasi staf (butuh `paymentSettle`) **[V]**. Unggah bukti: maks. 5 MB, hanya jpeg/png/webp (dideteksi dari isi berkas), pesan Inggris "unsupported file type (allowed: jpeg, png, webp)" **[V]**. Hanya satu pembayaran aktif per pesanan **[V]**. |
| **Diagnosis** | Pelanggan: cek rincian pesanan, apakah bukti terunggah. Depot: cek kolom Pembayaran. |
| **Perbaikan** | Unggah foto ≤ 5 MB. Tunggu staf mengonfirmasi; hubungi depot via **Chat dengan CS**. Staf: **Konfirmasi lunas** atau tandai gagal. Tombol **Konfirmasi lunas** tidak ada untuk peran tanpa `paymentSettle` (tunggu Kepala depot/Manajer/Finance). |
| **Eskalasi** | Tingkat 1; tingkat 5 bila penyimpanan bukti mati lama. |
| **Lapor dengan** | Nomor pesanan, metode, ukuran/tipe berkas, pesan. |

### T-25 — Setoran COD/penjualan: "Tombol nonaktif"

| Butir | Isi |
|---|---|
| **Gejala** | Kurir: "Sampai tujuan · ambil bukti" nonaktif; tidak bisa check-out; tidak bisa setor. |
| **Penyebab** | COD harus dicatat dahulu ("Terima uang Rp…", aturan "uang dulu baru selesai" hanya di UI, server tidak mengecek **[B]**); check-out ditolak selama ada pengantaran aktif; setoran hanya setelah shift berakhir, satu per shift **[V]**. |
| **Perbaikan** | Terima uang → Konfirmasi pembayaran; selesaikan/gagalkan/jadwalkan ulang semua pengantaran; check-out; baru **Setor ke kasir**. |
| **Peran/izin** | Staf depot (kurir). Eskalasi: Kepala depot. |

### T-26 — Tutup buku harian ditolak

| Pesan | Arti |
|---|---|
| "Masih ada {n} shift kasir terbuka. Tutup shift dulu, baru buku harian." | Tutup semua shift kasir |
| "Hari ini sudah ditutup." | Hanya Kantor pusat/Super admin yang dapat membuka kembali |
| "Bulan {YYYY-MM} sudah ditutup. Buka bulan itu dulu untuk mengubah hari {date}." | "Buka bulan" hanya HQ |
| "Tanggal tidak valid (pakai YYYY-MM-DD)." | Format |

Tutup buku tidak mensyaratkan setoran COD terverifikasi **[B]**; pastikan kartu "Setoran menunggu" = 0 secara manual.

---

## 8. Persetujuan Tertunda (T-27 s.d. T-32)

### T-27 — Antrean approval Manajer tidak bergerak

| Butir | Isi |
|---|---|
| **Gejala** | Kepala depot menyimpan opname/retur galon, lalu tidak tahu statusnya. (Sebelum PR #664: item "Tahan" hilang dan item Selisih retur galon/Deposit dikembalikan tampil Rp0; sudah diperbaiki.) |
| **Penyebab** | Antrean (`/dashboard/approvals`) hanya untuk Manajer dan Super admin; Kepala depot tidak punya halaman statusnya **[V][B]**. Jenis: Selisih opname, Refund deposit, Kurang setoran (tidak dipakai), Selisih retur galon. Item ≤ batas auto-pass (bawaan Rp100.000, hanya diubah HQ/Super admin) disetujui otomatis dan tidak masuk antrean **[V][K]**. Sejak PR #664 (2026-10-14) daftar memuat item Menunggu (PENDING) DAN Ditahan (HELD), sehingga item yang ditahan tidak lagi hilang; halaman detail membaca nominal Deposit dikembalikan dari kunci `deposit` maupun `depositRefunded` dan menampilkan jumlah galon selisih untuk Selisih retur galon, sehingga tidak lagi Rp0 **[V]** (`approvals/page.tsx`, `approvals/detail/page.tsx`). Kepala depot melihat status approval yang ia ajukan: belum tersedia (perlu keputusan pemilik) **[K]**. Pengaju tidak boleh memutuskan sendiri: "Pengaju tidak boleh memutuskan pengajuannya sendiri — teruskan ke atasan." **[V]** |
| **Diagnosis** | Manajer: pilih depot yang benar (halaman memakai satu depot, lihat T-15). |
| **Perbaikan** | Manajer memutuskan: **Setujui**, **Tahan**, **Tolak** (alasan wajib). Kepala depot bertanya ke Manajer. |
| **Peran/izin** | `approvals` (Manajer, Super admin). |
| **Eskalasi** | Tingkat 2 → 3. Bila tidak ada Manajer yang cakupannya meliputi depot (T-14): tingkat 4. |
| **Lapor dengan** | Depot, jenis, judul item, waktu, nominal. |

### T-28 — Kasbon tidak diputuskan

| Butir | Isi |
|---|---|
| **Gejala** | Karyawan mengajukan kasbon, tidak ada kabar. Asisten SPV tidak menemukan antrean. Ditolak: "Kasbon ini diputuskan oleh asisten supervisor depotnya." atau "Kasbon sendiri tidak bisa Anda setujui." HR: 403. |
| **Penyebab** | Pemutus utama adalah Asisten SPV depot itu; bila depot TIDAK punya Asisten SPV tercatat, Manajer atau HR **[V]**. Rel menu tidak punya tautan ke antrean kasbon: lewat notifikasi atau alamat `/hr/loans/requests` **[D]**. Depot tanpa Asisten SPV tidak terlihat oleh siapa pun di bawah HQ **[V]**. Sejak PR #664 (keputusan pemilik 2026-10-14): nominal kasbon maksimal 1x gaji pokok (gaji bulanan; karyawan harian dihitung 26 hari), dan pengajuan yang tidak diputuskan dalam 3 hari kerja kedaluwarsa (status Dibatalkan, catatan "Kedaluwarsa: tidak diputuskan dalam 3 hari kerja."). Pesan: "Kasbon melebihi batas 1x gaji pokok (Rp{batas})." (400) · "Gaji pokok Anda belum diisi sehingga batas kasbon tidak bisa dihitung. Hubungi HR." (400) · "Pengajuan ini kedaluwarsa (lewat 3 hari kerja); pemohon perlu mengajukan lagi." (409, saat pemutus mencoba memutuskan pengajuan yang sudah lewat). Kedaluwarsa dieksekusi saat pengajuan diputuskan atau saat pemohon membuka/mengajukan kasbon lagi, bukan oleh penyapu terjadwal **[V]** (`loan-request.service.ts`). Penyesuaian batas nominal/waktu di luar angka ini tetap **[K]**. SPV dan Asisten SPV mengajukan kasbon pribadi hanya lewat HR (tidak terikat satu depot) **[V]**. Setelah disetujui, cicilan muncul di slip gaji **[V]**. Pesan lain: "Pengajuan ini sudah dijawab orang lain. Muat ulang daftarnya." (409) · "Masih ada pengajuan kasbon yang belum diputuskan." (409) |
| **Diagnosis** | Super admin: periksa `/hq/hierarchy` apakah depot punya Asisten SPV. |
| **Perbaikan** | Teruskan ke Asisten SPV yang tepat; atau Super admin menugaskan Asisten SPV; sementara Manajer/HR memutuskan. |
| **Peran/izin** | `kasbonApprove`: Asisten SPV (depotnya), Manajer, HR. |
| **Eskalasi** | Tingkat 2 (HR) → 4. |
| **Lapor dengan** | Depot, kode karyawan, tanggal ajukan, pesan. |

### T-29 — Cuti menggantung atau tidak bisa disetujui

| Butir | Isi |
|---|---|
| **Gejala** | Status "Menunggu atasan" atau "Menunggu HR" lama; "Menunggu keputusan HR." terlihat oleh Head office/Direktur; ditolak 403. |
| **Penyebab** | Dua tahap: tahap 1 atasan (Manajer atau HR), tahap 2 HR; akun tahap 2 tidak boleh sama dengan tahap 1 dan pemohon tidak boleh memutuskan cutinya sendiri **[V]**. Pesan: "Tahap kedua harus diputuskan orang lain, bukan pemutus tahap pertama", "Tidak bisa memutuskan pengajuan cuti Anda sendiri", "Alasan penolakan wajib diisi", "Pengajuan berstatus {S} tidak bisa {action}" (409). Head office dan Direktur tidak punya `leaveApprove` sehingga tidak bisa memutuskan di layar **[B]**. Pengajuan: "Tanggal selesai sebelum tanggal mulai", "Rentang tanggal tidak memuat hari kerja", "Sudah ada pengajuan cuti pada rentang tanggal tersebut", "Sisa kuota cuti {n} hari, pengajuan {m} hari" (cuti tahunan dan izin mengurangi kuota; kuota bawaan 12 hari) **[V]**. Layar cuti tidak ada tautan dari rel SPV **[D]**. |
| **Perbaikan** | Gunakan dua akun berbeda. Buka `/hr/leave`. Pemohon dapat membatalkan selama belum final; cuti DISETUJUI tidak bisa dibatalkan karyawan **[V]**. |
| **Peran/izin** | Tahap 1: `leaveApprove`; tahap 2: `hrAdmin`/HR. |
| **Eskalasi** | Tingkat 2 → 3. |
| **Lapor dengan** | Kode karyawan, tanggal cuti, status, pesan. |

### T-30 — Refund tertunda atau tidak terlihat

| Butir | Isi |
|---|---|
| **Gejala** | Pelanggan menunggu uang kembali (sejak PR #664 status refund tampil di rincian pesanan, lihat Penyebab). Finance: refund tampak menggantung. |
| **Penyebab** | Pelanggan tidak bisa meminta refund sendiri dan tidak ada notifikasi refund **[B]**. Sejak PR #664 (2026-10-14) rincian pesanan pelanggan menampilkan status refund dari data pembayaran: "Refund {nominal} sudah diproses. Sampai ke sumber dana dalam 1–3 hari kerja." (pembayaran berstatus REFUNDED) · "Refund diajukan dan menunggu persetujuan pusat. Setelah disetujui, diproses 1–3 hari kerja." · "Pengajuan refund tidak disetujui. Hubungi depot bila ada pertanyaan." **[V]** (`orders/detail/page.tsx`); janji 1–3 hari kerja adalah teks tampilan, bukan jaminan yang diperiksa sistem **[K]**. Refund ≤ Rp100.000 (bawaan `REFUND_HQ_THRESHOLD`) langsung; di atasnya menunggu persetujuan Finance/Super admin di `/hq/refunds` **[V][K]**. Pengaju refund (Manajer, Finance) berbeda peran dari pemutus, tetapi belum ada pemeriksaan "orang berbeda": Finance memegang dua sisi **[B]**. Kolom `refundRequestedBy` sudah ditambahkan di basis data pembayaran (migrasi, sejak PR #664), tetapi kode yang mengisi dan menampilkannya baru menyusul di rilis berikutnya; hari ini tidak ada "diajukan oleh X" di antrean HQ **[V]**. Transfer/QRIS/tunai dikembalikan manual oleh depot; cara dan waktu nyata tidak diketahui **[K]**. Tolak refund butuh alasan. |
| **Perbaikan** | Depot/Manajer memeriksa kolom pembayaran dan mengajukan **Ajukan refund** di rincian pesanan. Finance: **Setujui/Tolak**. |
| **Peran/izin** | Ajukan: `refundIssue` (Finance, Manajer, Super admin); putuskan: `refundQueue` (Finance, Super admin). |
| **Eskalasi** | Tingkat 3. |
| **Lapor dengan** | Nomor pesanan, nominal, metode, tanggal bayar. |

### T-31 — Klaim pengeluaran kurir menunggu

Penyebab **[V]**: klaim ≤ Rp50.000 (bawaan) dengan foto struk sah disetujui otomatis; tanpa struk atau di atas ambang menunggu Manajer (sampai Rp500.000 bawaan), di atasnya Finance: "Klaim di atas Rp{limit} harus disetujui FINANCE." (Manajer tetap boleh menolak). Kepala depot tidak berwenang (`expenseApprove`). Struk yang sudah dipakai di klaim lain tidak dianggap sah. **[B]** Struk hanya dianggap sah bila alamat penyimpanan struk dikonfigurasi di payout-service; bila kosong, semua klaim menunggu persetujuan manual (stack uji lokal 2026-10-14: klaim Rp30.000 dengan struk tetap Menunggu; G-154). Perbaikan: kurir melampirkan struk; Manajer/Finance memutuskan di klaim pengeluaran. Kurir tidak dapat membatalkan atau mengubah klaim. Eskalasi: tingkat 2 → 3. Lapor dengan: jenis, jumlah, tanggal, ada tidaknya struk. Nilai ambang produksi **[K]**.

### T-32 — Lamaran waralaba, payout, dan keputusan HQ

| Situasi | Fakta | Tindakan |
|---|---|---|
| Lamaran disetujui tetapi pemohon tak bisa masuk | Persetujuan tidak membuat akun maupun depot; HQ harus mengundang akun "Pemilik waralaba" dan onboard depot **[V]** | Head office/Super admin mengundang di `/hq/staff` |
| "This application has already been approved or rejected." | Keputusan lamaran final | Tidak ada tindakan |
| "Pengaju pencairan tidak boleh menyetujui pengajuannya sendiri." | Maker-checker rilis payout | Direktur atau Super admin lain menyetujui |
| Pengajuan depot (approval depot) | Pengaju tidak boleh memutuskan sendiri **[V]** | Minta penyetuju lain |

---

## 9. Status Tidak Berubah (T-33 s.d. T-37)

### T-33 — Pesanan dibatalkan sendiri

| Butir | Isi |
|---|---|
| **Gejala** | Pesanan tiba-tiba berstatus "Dibatalkan" tanpa tindakan pelanggan. |
| **Penyebab** | Penyapu terjadwal per jam (menit :05) membatalkan otomatis dan melepas stok: (a) status "Dipesan" (CREATED) lebih dari 60 menit (`ORDER_ABANDON_MINUTES`) dengan alasan "Auto-cancelled: order abandoned before confirmation."; (b) "Dikonfirmasi"/"Disiapkan" lebih dari 24 jam (`ORDER_STALLED_HOURS`) dengan alasan "stalled at the depot". Pembayaran dibalik lebih dulu **[V]** (`order.service.ts:1867-1935`; `crontab:46-50`). Penyebab lain: dibatalkan staf, kegagalan pengantaran (no-show, gagal) **[V]**. Pelanggan yang membatalkan sendiri tidak menerima notifikasi (hanya melihat layar) **[V]**. Sejak PR #664 (2026-10-14) Syarat dan Ketentuan Pasal 8 berbunyi pelanggan dapat membatalkan "sebelum kurir ditugaskan" (selaras dengan aturan kode, yang tidak berubah); sebelumnya teks menyebut "sebelum depot mulai menyiapkan" **[V]**. Label status pesanan di layar kini berbahasa Indonesia: Dipesan, Dikonfirmasi, Disiapkan, Kurir ditugaskan, Diambil kurir, Dalam perjalanan, Tiba, Selesai, Dibatalkan, Dibatalkan di kasir **[V]** (`order.status.*`). |
| **Diagnosis** | Rincian pesanan: riwayat status dan alasan. Depot: apakah pesanan lama tidak dikonfirmasi/disiapkan? |
| **Perbaikan** | Pesan ulang (**Pesan lagi**). Depot: konfirmasi pembayaran dan siapkan pesanan sebelum batas waktu. Bila sudah dibayar, tanyakan refund. |
| **Peran/izin** | Pelanggan: pesan ulang. Depot: konfirmasi. |
| **Eskalasi** | Tingkat 1–2 bila pesanan dibatalkan padahal sudah dibayar dan uang belum kembali. |
| **Lapor dengan** | Nomor pesanan, waktu pesan, status terakhir, alasan pembatalan. |

### T-34 — Pembayaran otomatis berstatus "Gagal" setelah 24 jam

| Butir | Isi |
|---|---|
| **Gejala** | Transfer/QRIS/e-wallet/VA berstatus FAILED padahal pelanggan merasa sudah bayar. |
| **Penyebab** | Pembayaran non-tunai yang tetap PENDING lebih dari `PAYMENT_PENDING_TTL_HOURS` (bawaan 24 jam; 0 mematikan) otomatis FAILED oleh penyapu per jam (menit :25); pembayaran tunai tidak pernah kedaluwarsa **[V]** (`payment.service.ts:566-606`). Jadi waktu gagal bisa sedikit lebih lama dari 24 jam **[D]**. |
| **Diagnosis** | Rincian pesanan: apakah bukti sudah diunggah dan kapan? Depot: apakah dana benar masuk? |
| **Perbaikan** | Pelanggan menekan **Coba bayar lagi**. Bila dana sudah masuk, depot menghubungi Manajer/Finance untuk rekonsiliasi. |
| **Peran/izin** | Konfirmasi lunas: `paymentSettle`. |
| **Eskalasi** | Tingkat 2–3 bila dana dobel/hilang. |
| **Lapor dengan** | Nomor pesanan, waktu transfer, nominal, bukti. |

### T-35 — Pesanan tidak maju (tidak ada kurir, tidak berangkat)

| Butir | Isi |
|---|---|
| **Gejala** | Pesanan menetap di "Dikonfirmasi"/"Disiapkan"; kurir tidak mendapat tugas. |
| **Penyebab** | Penugasan dilakukan staf (`tracking`: Kepala depot, Manajer, SPV, Asisten SPV); kurir hanya menerima tugas bila shift ONLINE (sudah check-in dan bukan Istirahat); bawaan satu pengantaran aktif per kurir; ambil-sendiri hanya bila depot mengaktifkan (bawaan mati, kartu "Pesanan belum diambil") **[V]**. Pesan Inggris untuk dispatcher: "This courier is not checked in and available.", "This driver already has the maximum number of active deliveries." Setelah ditugaskan, pelanggan tak bisa membatalkan **[V]**. Pesanan DISPUTED tidak ada; cek Sengketa. |
| **Diagnosis** | Kepala depot: Antrean pesanan, Live tracking; pil status kurir. |
| **Perbaikan** | Minta kurir check-in dan ONLINE; Tugaskan; atau **Tarik ke antrean** dengan alasan. Tidak ada tombol batal pesanan untuk staf pada pesanan yang belum dikirim **[B]**; minta Manajer. |
| **Eskalasi** | Tingkat 1–2. Peringatan SLA terlambat dikirim sekali per pengantaran, tidak otomatis menugaskan ulang **[V]**. |
| **Lapor dengan** | Nomor pesanan, status, kurir, jam. |

### T-36 — Perubahan status pengantaran ditolak (pesan Inggris)

| Pesan | Arti |
|---|---|
| "Cannot move a delivery from X to Y." | Perpindahan status tidak sah |
| "This delivery was already updated. Reload and try again." | Data basi: muat ulang |
| "Could not update the order for this delivery. Please try again." | Sinkron ke pesanan gagal: coba lagi |
| "You already have an open shift. Check out before starting a new one." | Shift lama masih terbuka |
| "A no-show needs at least N contact attempts and Ns of waiting." | Belum cukup upaya hubungi/waktu tunggu (bawaan 2 kali dan 300 detik; teks layar "minimal 2 kali" dan "5 menit" tetap, bisa berbeda dari pengaturan depot **[B]**) |
| "Waktu antar ulang tidak boleh sudah lewat" | Waktu jadwal ulang masa lalu |
| "Bukti antar diambil {m} m dari alamat tujuan (batas {r} m). Pastikan Anda di alamat pelanggan." | Hanya bila depot mengaktifkan batas jarak bukti (bawaan mati, 500 m) |
| "Ambil pesanan sendiri belum diaktifkan di depot ini." / "Pesanan ini baru masuk. Tunggu sebentar sebelum bisa diambil sendiri." | Ambil-sendiri belum aktif / belum lewat 10 menit **[K]** |

Semua **[V]**. Eskalasi: Kepala depot.

### T-37 — Status refund/poin/ulasan tidak terlihat

Tampilan status refund kini ada di rincian pesanan pelanggan (sejak PR #664, 2026-10-14; lihat T-30). Tidak tersedia: notifikasi pembayaran dikonfirmasi/gagal, refund selesai, balasan komplain, keputusan PDP **[B]**. Poin: bonus referral baru masuk setelah pesanan pertama teman selesai (bukan "+50 poin" saat daftar) **[B]**. Pelanggan memeriksa layar **Pesanan**, **Poin**, **Bantuan**.

---

## 10. Laporan Tidak Bisa Dibuat (T-38)

### T-38 — Laporan/ekspor kosong atau ditolak

| Butir | Isi |
|---|---|
| **Gejala** | "Tidak ada data pada rentang ini." · "Laporan pendapatan per depot belum lengkap: sebagian depot tidak masuk laporan sumbernya, jadi angkanya akan salah. Ekspor ditahan sampai sumbernya utuh." · "Gagal membuat berkas." · "Gagal mengekspor laporan." · "Gagal membuat file Excel. Coba ekspor CSV." · "Jejak audit terlalu besar untuk diekspor utuh. Persempit dulu rentang atau saringannya …" · "Isi rentang tanggal". |
| **Penyebab** | Ekspor ditolak, tidak dipotong, bila sumber data tak lengkap **[V]**. Sejak PR #664 (2026-10-14) halaman `/hq/audit` punya saringan "Aksi (persis, mis. depot.suspend)", "Dari tanggal", "Sampai tanggal" (hari yang dipilih ikut), dan "Hasil" (Semua / Berhasil / Ditolak / gagal) dengan tombol "Reset filter"; ekspor audit memakai saringan yang sama, dan bila tidak ada hasil tampil "Tidak ada entri yang cocok dengan filter ini." **[V]** (`hq/audit/page.tsx`; `/auth/audit` menerima `from`, `to`, `success`). Tanpa saringan, ekspor tetap seluruh jejak dan bisa ditolak "Jejak audit terlalu besar untuk diekspor utuh …": persempit saringan. Laporan HR rentang butuh Dari/Sampai. Laporan terjadwal memakai periode lengkap sebelumnya (harian = kemarin, mingguan = Senin–Minggu lalu, bulanan = bulan lalu), diproses per jam; hasil diunduh di `/hq/exports`, TIDAK dikirim email **[V]**. Ekspor manual `/hq/reports/export` tidak masuk Log ekspor **[D]**. Kelompok Produk maks. 50 teratas; daftar jaringan terbatas 50/100 baris tanpa penanda **[B]**. P&L tanpa ekspor. `orderReports` tidak dimiliki Finance **[V]**. |
| **Diagnosis** | Ubah rentang; coba format lain (XLSX/CSV/PDF); cek `/hq/health`. Log ekspor: status Selesai/Proses/Gagal; "Berkas ekspor tidak tersedia." |
| **Perbaikan** | Perkecil rentang; muat ulang; ulangi. Bila sumber data tak lengkap, tunggu layanan pulih. |
| **Peran/izin** | Ekspor laporan: Head office, Direktur (`orderReports`); log ekspor/jadwal: `hqBackOffice`; laporan HR: `hrView`; laporan depot harian: peran konsol depot. |
| **Eskalasi** | Tingkat 5 bila "Gagal" berulang dengan rentang kecil. |
| **Lapor dengan** | Jenis laporan, rentang, format, pesan, waktu, depot. |

---

## 11. Unggah dan Unduh Gagal (T-39 s.d. T-43)

### T-39 — Foto bukti pengantaran (POD) gagal

| Butir | Isi |
|---|---|
| **Gejala** | "Gagal menyelesaikan pengantaran."; GPS gagal ("Perangkat tidak mendukung GPS" / "Izinkan akses lokasi (GPS) untuk absen" untuk absensi); spanduk "Tersimpan di HP dan akan dikirim otomatis begitu ada sinyal." |
| **Penyebab** | Server mewajibkan foto, nama penerima, dan koordinat; tanda tangan opsional (teks perkenalan yang menyebut tanda tangan "wajib" tidak akurat) **[V][B]**. Tanpa sinyal, bukti masuk antrean perangkat dan dikirim otomatis; waktu offline dibatasi maksimal 12 jam (`offlineMaxAgeHours`) **[V]**. Bukti disimpan 12 bulan lalu dihapus sesuai retensi **[V]**. |
| **Diagnosis** | Cek izin kamera dan lokasi, sinyal, banner "{count} data belum terkirim". |
| **Perbaikan** | Izinkan kamera/GPS; pindah ke area bersinyal; tekan **Kirim sekarang**. JANGAN **Buang** kecuali yakin: antrean adalah satu-satunya salinan. Serah-terima sudah selesai, jangan diulang. |
| **Peran/izin** | Staf depot (kurir). |
| **Eskalasi** | Kepala depot; tingkat 5 bila item bertahan di antrean dengan pesan penolakan server (kesalahan bisnis 4xx tetap di antrean). |
| **Lapor dengan** | Nomor pesanan, jenis antrean ("Bukti pengantaran"), pesan server, jam. |

### T-40 — Unggah bukti bayar pelanggan

Lihat T-24: maks. 5 MB; jpeg/png/webp; "Mengunggah…" lalu "Bukti bayar gagal diunggah. Coba lagi." Tutup informasi sensitif (saldo) sebelum difoto. **[V]**

### T-41 — Impor CSV/Excel

Lihat T-18 (maks. 500 baris, .xlsx/.csv, template dari "Unduh template Excel").

### T-42 — Unduh/ekspor gagal

| Pesan | Arti dan solusi |
|---|---|
| "Gagal mengunduh berkas." / "Berkas ekspor tidak tersedia." | Berkas belum ada atau gagal dibuat; lihat status di `/hq/exports` |
| "Gagal mengekspor laporan." | Ulangi; coba format lain |
| "Gagal membuat file Excel. Coba ekspor CSV." | Pakai CSV |
| Tombol "Unduh PDF" slip | Slip hanya dibuat setelah payroll ada; HR/Finance |
| "Unduh salinan data" (pelanggan) | Tersedia setelah permintaan disetujui; unduh dalam 7 hari **[V]** |
| Struk tidak muncul: "Struk tidak bisa dibuka — izinkan popup, lalu tekan "Cetak ulang struk"." | Pelanggan peramban memblokir popup |

### T-43 — "{n} data belum terkirim" (antrean luring)

Penyebab: perangkat luring saat mencatat. Jenis yang diantre: Absen wajah, Mulai shift, Bukti pengantaran, Uang tunai diterima, Retur galon kosong, Pengantaran gagal, Jadwal ulang. TIDAK diantre: ambil pesanan, mulai antar, no-show, setoran, klaim, penarikan, laporan insiden **[V]**. Perbaikan: hubungkan internet, **Kirim sekarang**; percobaan ulang maksimal 6 kali; kesalahan bisnis tetap di antrean untuk dibuang pengguna. Peran: kurir. Eskalasi: Kepala depot.

---

## 12. Notifikasi Tidak Diterima (T-44 s.d. T-47)

### T-44 — Push atau kotak masuk tidak muncul

| Butir | Isi |
|---|---|
| **Gejala** | Tidak ada notifikasi walau ada perubahan status. Pesan: "Notifikasi diblokir. Izinkan Hydromart di setelan perangkat, lalu coba lagi." |
| **Penyebab** | Pengiriman = baris kotak masuk (selalu) + push (web push VAPID atau Android FCM) yang bersifat "fail-open": bila kunci kosong, push mati dan hanya kotak masuk yang berlaku **[V]**. Izin notifikasi dimatikan di perangkat. Preferensi notifikasi pengguna. Notifikasi layanan (mis. pengingat galon) tidak dipengaruhi opt-out pemasaran **[V]**. Staf: kotak "Riwayat notifikasi" per depot; kapabilitas `opsNotif`; Asisten SPV tidak punya, jadi stok menipis tak diberitahukan **[V][K]**. Peristiwa SPV di ponsel hanya STOCK_LOW dan COURIER_INCIDENT **[D]**. |
| **Diagnosis** | Buka layar **Notifikasi** (kotak masuk): bila baris ada, pengiriman berhasil dan hanya push yang bermasalah. Cek izin di setelan perangkat dan preferensi. |
| **Perbaikan** | Izinkan notifikasi; periksa preferensi; muat ulang. |
| **Eskalasi** | Tingkat 5 bila kotak masuk juga kosong untuk peristiwa yang seharusnya ada. |
| **Lapor dengan** | Peristiwa, nomor pesanan, waktu, perangkat, status izin. |

### T-45 — WhatsApp sudah tidak ada

WhatsApp sudah dihapus sebagai transport notifikasi; tidak ada notifikasi atau OTP lewat WhatsApp **[V]**. Saluran yang ada: SMS (hanya OTP), notifikasi push, dan kotak masuk di aplikasi. Email: Tidak tersedia **[V]**. Beberapa teks lama masih menyebut WhatsApp dan PRD menyebut WhatsApp/email **[B]**. Tombol **Chat dengan CS** hanyalah tautan yang membuka WhatsApp ke nomor depot, bukan notifikasi. Sejak PR #664 (2026-10-14) sisa konfigurasi WhatsApp di berkas contoh `.env` auth-service dan crm-service sudah dihapus **[V]**; teks tampilan lama yang menyebut WhatsApp, bila masih ada, tetap **[B]**. Kalimat "Pesan sebelum 16.00 — tiba hari ini" di halaman pelanggan juga sudah diganti ("Depot buka dan mengantar ke alamatmu — tiba hari ini, ±30 menit") **[V]**.

### T-46 — SMS OTP

Lihat T-01 sampai T-04. SMS OTP berbunyi "Kode Login HYDROMART …" atau "Kode Verifikasi HYDROMART …" dan berlaku 5 menit **[V]**. Hydromart tidak meminta kode lewat telepon/chat **[D]**.

### T-47 — Notifikasi yang memang TIDAK dikirim

| Peristiwa | Fakta |
|---|---|
| Pelanggan membatalkan sendiri | Tidak ada notifikasi (layar saja) |
| Pembayaran dikonfirmasi/gagal, refund selesai | Tidak ada peristiwa notifikasi |
| Balasan komplain, keputusan PDP | Tidak ditemukan |
| "Pesanan selesai" setelah "Pesanan terkirim" | Ditekan agar tidak ganda |
| Wording "sudah diambil kurir" pada status "Kurir ditugaskan" | Teks tidak sama dengan status **[B]** |

---

## 13. Kurir: Jarak, Sesi Shift, Setoran (T-48 s.d. T-53)

### T-48 — Check-in gagal: jarak 200 m dari depot

| Butir | Isi |
|---|---|
| **Gejala** | Pesan Inggris "You are {n} m from the depot. Check in within {r} m." (arti: Anda {n} m dari depot; check-in harus dalam {r} m). |
| **Penyebab** | Check-in shift memeriksa jarak ke depot di server; radius bawaan 200 m **[V][K]**. Daftar centang di layar ("Lokasi terverifikasi", "Kondisi baik · siap jalan") adalah tampilan statis, bukan hasil pemeriksaan **[B]**. Dugaan penyebab lain: sinyal GPS buruk di dalam bangunan **[D]**. |
| **Diagnosis** | Pastikan berada di depot, izinkan lokasi akurat, tunggu GPS stabil. |
| **Perbaikan** | Datang ke depot dan ulangi **Mulai shift · check-in**. Luring: "Mulai shift" masuk antrean. |
| **Peran/izin** | Staf depot (kurir). Radius diubah di pengaturan depot (Manajer) **[D]**. |
| **Eskalasi** | Kepala depot bila sudah di depot tetapi tetap ditolak. |
| **Lapor dengan** | Depot, jarak yang disebut pesan, jam, model ponsel, izin lokasi. |

### T-49 — Sesi shift: tidak ada tugas, tidak bisa check-out, shift terbuka

| Gejala atau pesan | Penyebab | Perbaikan |
|---|---|---|
| Tidak mendapat tugas | Status bukan Online (Istirahat/Offline), atau belum ditugaskan; ambil-sendiri mati | Cek pil status; hubungi Kepala depot **[V]** |
| Tidak bisa check-out | Masih ada pengantaran aktif | Selesaikan, gagalkan, atau jadwalkan ulang **[V]** |
| "You already have an open shift. Check out before starting a new one." | Shift sebelumnya belum ditutup | Check-out dahulu |
| Shift lama berakhir sendiri | Shift basi diakhiri otomatis pada `expectedEndAt` tanpa koordinat check-out, saat check-in berikutnya (bukan oleh cron) **[V]** | Tidak ada; informasikan HR bila memengaruhi hitungan |
| Pengantaran "Dijadwalkan ulang" tidak terlihat di Riwayat | Tidak ditampilkan **[B]** | Tanya Kepala depot |
| Tab "Dompet" tak terlihat | Navigasi disembunyikan di halaman dompet **[B]** | Buka dari Profil |

Dua "check-in" berbeda: check-in shift (layanan pengantaran, radius depot) dan absen wajah (layanan HR). Keduanya tidak terhubung **[V]**; mana yang dipakai gaji **[K]**.

### T-50 — COD dan bukti: uang dulu, gagal antar, tunai ditahan

Perbaikan: terima uang di layar "Pembayaran tunai (COD)" ("Konfirmasi pembayaran" aktif bila uang ≥ tagihan; "Uang pas" dan pecahan tersedia). Saat menandai gagal atau jadwal ulang sambil memegang tunai, jawab wajib "Sudah saya kembalikan" atau "Masih saya pegang"; jawaban menentukan setoran. Gagal: alasan wajib. No-show butuh minimal 2 kali hubungi dan 300 detik tunggu (bawaan) **[V]**. Kerusakan galon: pilih "Segel rusak". Eskalasi: Kepala depot. Insiden darurat: **Lapor insiden** lalu hubungi Kepala depot; teks "lokasi terkirim" tidak benar karena laporan tidak membawa koordinat **[B]**.

### T-51 — Setoran COD

| Butir | Isi |
|---|---|
| **Gejala** | Tidak bisa setor; status "Menunggu verifikasi" lama; "Sengketa"; selisih dibebankan. |
| **Penyebab** | Setoran hanya setelah shift berakhir, satu per shift. Kasir (Kepala depot/Manajer/Finance/Super admin) memverifikasi atau menyengketakan; surplus > Rp5.000 butuh catatan: "Explain the surplus in the note before verifying this deposit." (arti: jelaskan kelebihan di catatan sebelum verifikasi). Selisih kurang dicatat ke upah kurir: "Pembebanan selisih ke kurir belum tercatat di buku upahnya, jadi setoran ini belum diverifikasi. Coba lagi." (aman ditekan lagi). Sejak PR #664 (keputusan pemilik 2026-10-14): (1) membebankan selisih ke kurir hanya boleh oleh peran dengan kapabilitas `approvals` (Manajer, Super admin); bagi kasir lain (mis. Kepala depot) pilihan membebankan tidak tampil dan layar menyatakan "Membebankan selisih ke kurir hanya bisa oleh manajer. Anda bisa memverifikasi tanpa membebankan."; bila tetap dikirim, server menjawab 403 "Membebankan selisih ke kurir harus disetujui manajer. Verifikasi tanpa membebankan, atau minta manajer yang memverifikasi." (kode SETTLEMENT_CHARGE_NEEDS_MANAGER); (2) setoran berstatus Sengketa kini punya tombol verifikasi di layar setoran, wajib dengan catatan ("Isi catatan penyelesaian sengketa."), dan tombol Sengketa disembunyikan bila sudah Sengketa **[V]** (`settlements/page.tsx`, `settlement.service.ts`). Ini pemeriksaan kapabilitas langsung, bukan antrean persetujuan asinkron **[V]**. Kurir tidak dapat membantah **[B]**. Kepala depot tidak bisa menyetor atas nama kurir **[V]**. Kebijakan kapan selisih dibebankan **[K]**. |
| **Perbaikan** | Check-out, hitung, **Setor ke kasir**; serahkan uang. Sengketa: Manajer/Kantor pusat. |
| **Eskalasi** | Kepala depot → Manajer/Finance. |
| **Lapor dengan** | Tanggal shift, total tagihan, jumlah setor, catatan kasir. |

### T-52 — Penarikan saldo kurir

| Pesan | Arti dan solusi |
|---|---|
| "Belum ada rekening tujuan yang terverifikasi. Daftarkan rekening dan tunggu verifikasi kantor pusat sebelum menarik saldo." | Daftarkan rekening; Kantor pusat memverifikasi |
| "Withdrawal of {x} exceeds available balance {y}." | Jumlah melebihi saldo |
| "Withdrawal amount must be greater than zero." | Jumlah harus > 0 |
| "Minimum penarikan Rp50.000." (400, kode PAYOUT_BELOW_MINIMUM) | Sejak PR #664 (2026-10-14): penarikan di bawah minimum ditolak. Angka bawaan Rp50.000 dari `MIN_WITHDRAWAL_IDR` (dapat disetel tim teknis; tanpa biaya penarikan). Berlaku untuk kurir dan pemilik waralaba **[V]** |
| Status "Diproses" lama | Menunggu staf menandai "Terkirim"/"Gagal" (gagal: saldo dikembalikan). Lama proses **[K]** |

Eskalasi: Kepala depot → Kantor pusat/Finance. Teks "payout mingguan" tidak akurat karena penarikan kapan saja **[B]**.

### T-53 — Klaim pengeluaran kurir

Lihat T-31. Pesan Inggris: "Only a pending expense claim..." (arti: hanya klaim berstatus menunggu yang dapat diputuskan). Struk wajib untuk persetujuan otomatis: "Wajib untuk persetujuan otomatis. Tanpa struk, klaim menunggu persetujuan depot."

---

## 14. Absensi Wajah (T-54)

### T-54 — Absen wajah gagal

| Butir | Isi |
|---|---|
| **Gejala** | "Wajah belum di-enroll" · "Wajah tidak cocok" · "Deteksi wajah kurang meyakinkan. Gerakkan kepala/kedip lalu coba lagi." · "Di luar area absen depot ({m} m dari titik). Absen harus di lokasi." · "Sudah check-in hari ini" · "Belum check-in hari ini" · "Sudah check-out hari ini" · "Akun ini belum tertaut ke data karyawan" · "Karyawan tidak aktif" · "Absen disimpan di perangkat" · item "Menunggu persetujuan". |
| **Penyebab** | Daftar wajah (1–3 foto + persetujuan data wajah) wajib sebelum absen pertama **[V]**. Kecocokan wajah ke vektor terdaftar, ambang bawaan `HR_FACE_MATCH_THRESHOLD` 0,62 (hasil di bawah ditolak 401); karyawan tidak bisa melihat skornya **[V]**. Cek hidup di perangkat hanya proksi gerak; foto cetak yang bergerak mungkin lolos **[V]** (risiko, lihat Bab 17). Geofence aktif hanya bila depot mengisi titik dan radius (bawaan mati) **[V]**. Absen terkirim jauh setelah waktu absen, atau di luar area, masuk "Absen menunggu persetujuan" (belum dihitung hadir) dan diputuskan HR: Setujui → Hadir/Terlambat, Tolak → Absen (potongan berlaku) **[V]**. Tidak ada deteksi absen otomatis; status Absen diisi manual atau impor **[V]**. Karyawan tidak dapat membantah absensi **[B]**. |
| **Diagnosis** | Buka **Absensi Saya**: status, jam, "+{n}m". HR: lihat skor kecocokan (merah bila < 75%). |
| **Perbaikan** | Daftar/perbarui wajah di **Daftar / Perbarui Wajah** di tempat terang; absen di lokasi depot dengan GPS menyala. Luring: tersimpan lalu terkirim. Menarik persetujuan menghapus data wajah ("Hapus data wajah Anda? Absensi wajah berhenti bekerja sampai Anda mendaftar lagi."). |
| **Peran/izin** | Absen sendiri: Staf depot, Kepala depot, Asisten SPV, SPV, Super admin (gerbang) dan harus tertaut karyawan. Koreksi, enroll untuk orang lain, persetujuan: HR (`hrAdmin`). Entri manual hanya untuk hari tanpa catatan: "Hari itu sudah punya catatan kehadiran — ubah lewat koreksi pada baris tersebut, bukan absen manual". |
| **Eskalasi** | HR → tingkat 3 untuk kebijakan; tingkat 5 bila pencocokan gagal berulang pada wajah yang baru didaftarkan. |
| **Lapor dengan** | Kode karyawan, tanggal/jam, pesan persis, apakah dalam depot, terang/redup. Jangan lampirkan foto wajah. |

---

## 15. Payroll dan BPJS (T-55 s.d. T-58)

### T-55 — Payroll tidak bisa dibuat

| Pesan | Arti dan solusi |
|---|---|
| "Periode {YYYY-MM} belum selesai. Payroll baru bisa dibuat setelah bulan itu berakhir." | Tunggu tanggal 1 bulan berikutnya (zona waktu bisnis, bawaan Asia/Jakarta) **[V]** |
| "Karyawan berstatus RESIGNED tanpa tanggal keluar. Isi tanggal keluar (exitDate) dulu sebelum membuat payroll {period}." | Isi Tanggal keluar; status Resign saja tidak menghentikan gaji |
| "Payroll {period} sudah {STATUS}, tidak bisa dibuat ulang" (409) | Hanya Draft yang bisa dibuat ulang |
| "Slip ini milik depot asal karyawan; hanya depot asal atau pusat yang bisa memprosesnya." | Karyawan dipinjamkan: proses di depot asal |
| Karyawan keluar tidak ikut batch | Batch hanya karyawan Aktif (maks. 500/depot); gunakan **Generate** per karyawan **[V][D]** |
| "{n} karyawan tidak mendapat draf" | Lihat daftar alasan per nama |

Peran: `hrPayroll` (HR, Finance, Super admin). Head office/Direktur hanya melihat. Eskalasi: tingkat 2 (HR) → 3.

### T-56 — Setujui/bayar/koreksi slip

| Pesan atau gejala | Arti dan solusi |
|---|---|
| "Hanya payroll DRAFT yang bisa dihitung ulang (saat ini {S})" · "Hanya payroll DRAFT yang bisa disetujui (saat ini {S})" · "Hanya payroll APPROVED yang bisa dibayar (saat ini {S})" | Urutan Draft → Disetujui → Dibayar. Sejak PR #664 (2026-10-14) hanya Super admin yang bisa menarik Disetujui kembali ke Draft (lihat baris di bawah); setelah Dibayar tidak ada langkah mundur **[V]** |
| 403 "Slip ini dibuat oleh akun Anda sendiri; persetujuan harus dari orang lain (atau Super Admin)." | Sejak PR #664 (keputusan pemilik): pembuat slip tidak boleh menyetujui slipnya sendiri; minta HR/Finance lain menyetujui. Super admin dikecualikan **[V]** (`payroll.service.ts`). Meja HR satu orang akan terblokir kecuali Super admin yang menyetujui |
| **Batalkan persetujuan** (halaman rincian payroll, hanya tampil untuk Super admin saat status Disetujui). Isian "Alasan membatalkan persetujuan (wajib):" min. 3 karakter. Berhasil: "Persetujuan dibatalkan; slip kembali ke DRAFT." | Sejak PR #664: Super admin membatalkan persetujuan sebelum Dibayar dengan alasan tertulis; dicatat di audit (PAYROLL_UNAPPROVE). Pesan server: 403 "Hanya Super Admin yang bisa membatalkan persetujuan payroll." · 400 "Alasan wajib diisi." · 409 "Hanya payroll APPROVED yang bisa dibatalkan persetujuannya (saat ini {S})" **[V]** |
| "Penugasan depot karyawan ini berubah setelah slip dihitung. Hitung ulang slip dulu, lalu setujui." | Tekan **Hitung ulang** lalu **Setujui** |
| Bonus/potongan tak bisa diubah | Slip sudah Disetujui/Dibayar; catat di periode berikutnya |
| "Payroll yang sudah dibayar tidak bisa dialokasikan ulang." · "Pembagian per depot belum diaktifkan." · "Alasan wajib diisi." | Pembagian per depot bergantung `DEPOT_ASSIGNMENT_ENABLED` (bawaan mati) **[K]** |
| **Tandai Dibayar** | Hanya status, bukan transfer uang **[V]** |

Risiko yang tersisa: sejak PR #664 pembuat slip tidak dapat menyetujuinya (kecuali Super admin), tetapi langkah **Tandai Dibayar** tidak dibatasi oleh pembuat/penyetuju yang sama **[V][K]**. Karyawan melihat slip Draft **[B]**.

### T-57 — BPJS dan PPh 21 tampak salah

Fakta **[V]**: baris "BPJS Kesehatan (karyawan)" hanya muncul bila karyawan punya nomor BPJS Kesehatan; bawaan karyawan Kes 1% (batas upah Rp12 juta), JHT 2%, JP 1%; beban perusahaan Kes 4%, JHT 3,7%, JP 2%, JKK 0,24%, JKM 0,30% — ini biaya perusahaan, tidak mengurangi gaji; laporan "Beban BPJS perusahaan" hanya `hrPayroll` dan hanya menghitung karyawan yang punya nomor BPJS. Tabel TER PPh 21 kosong sampai dimuat; tarif bawaan perlu konfirmasi pajak/bisnis **[K]**. Tambahan PPh 21 tanpa NPWP 20%. Diagnosis: periksa NPWP, nomor BPJS, status PTKP di rincian karyawan; periksa Pengaturan gaji. Perbaikan: HR mengisi data lalu **Hitung ulang** slip Draft. Eskalasi: Finance/pajak. Lapor dengan: kode karyawan, periode, baris slip.

### T-58 — Karyawan keluar / gaji tidak berhenti

Offboarding = **Edit** → Status Resign/Nonaktif + Tanggal keluar; tidak ada wizard khusus **[V]**. Saat status login dimatikan, token penyegar dicabut sejak PR #664 (2026-10-14); token akses yang sudah terbit masih bisa sampai 15 menit (lihat T-05). Wizard offboarding: Tidak tersedia (keputusan pemilik menunggu) **[K]**. Peran: `hrAdmin`. Perbaikan akun login: Head office/Super admin (**Nonaktifkan**). Penghapusan akun (Super admin saja, `staffDelete`) menganonimkan data biometrik, absensi, kinerja; payroll, bonus, potongan, pinjaman disimpan tanpa pemilik (keuangan 10 tahun) **[V]**.

---

## 16. Payout Waralaba (T-59 s.d. T-63)

### T-59 — Pemilik waralaba: pendapatan 0, komisi 0, tidak ada depot

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| "Belum ada depot yang ditugaskan padamu." | Depot belum didaftarkan atas akun | HQ mengisi "Pemilik waralaba" pada depot |
| "Pendapatan" 0 padahal ada penjualan | Depot tanpa pemilik ("Belum ada pemilik — pendapatan depot ini tidak terbukukan") atau pesanan belum selesai; kredit pemilik masuk lewat antrean "outbox" tiap 10 menit **[V]** | HQ cek pemilik depot di "Jaringan waralaba" |
| Komisi 0 | "komisi belum diatur" | Finance mengatur "Skema komisi" (label kini "Persentase komisi HQ per depot", yaitu persentase yang dipotong HQ; diperbaiki sejak PR #664, 2026-10-14 **[V]**) |
| 403 "This depot belongs to another owner." | Membuka depot milik orang lain | Pilih depot milik sendiri |
| Halaman Antrean/Jadwal shift/Pencarian kosong atau menolak | Menu tampil tanpa hak | Abaikan **[D]** |

### T-60 — Tombol "Cairkan saldo" abu-abu / gagal

Penyebab **[V]**: saldo 0 atau rekening belum "Terverifikasi". Aturan: jumlah bilangan bulat, ≤ saldo, dan sejak PR #664 (2026-10-14) minimal Rp50.000 ("Minimum penarikan Rp50.000."; bawaan `MIN_WITHDRAWAL_IDR`, tanpa biaya); batas harian tidak ditemukan; lama proses tetap **[K]**. Pesan Inggris: "Withdrawal of {x} exceeds available balance {y}." · "Withdrawal amount must be greater than zero." Perbaikan: daftarkan rekening; Finance **Verifikasi**. Penolakan rekening menampilkan "Ditolak: tanpa alasan" bila HQ tidak mengisi alasan. Peran: pemilik waralaba (tarik), Finance/Super admin (verifikasi, `hqPayout`).

### T-61 — Pencairan lama berstatus "Diproses"

Pencairan pemilik langsung berstatus PROCESSING dan saldo langsung berkurang; Finance menandai **Lunas** atau **Gagal** (gagal: saldo kembali) **[V]**. Sejak PR #664 (2026-10-14) teks sukses berbunyi "… diajukan ke {ref}, menunggu transfer." (tidak lagi "dikirim ke"), dan halaman payout menampilkan kartu "Riwayat penarikan" (nominal, ref, tanggal) dengan status "Menunggu transfer", "Sudah ditransfer", atau "Gagal (saldo dikembalikan)" **[V]** (`dashB.payout.*`, `recentWithdrawals`); buku kas tetap hanya 8 catatan terakhir **[B]**. Perbaikan: pemilik menghubungi HQ dengan nomor "Ref". Jadwal "Payout berikutnya" tanggal 15 hanya tampilan, tidak ditemukan penjadwal **[B][K]**. Peran: Finance/Super admin. Lapor dengan: Ref, nominal, waktu tarik.

### T-62 — Rilis payout oleh HQ ("Ajukan rilis")

Alur terpisah: Finance/Super admin **mengajukan** rilis seluruh saldo; Direktur/Super admin **menyetujui**; pengaju tidak boleh menyetujui sendiri: "Pengaju pencairan tidak boleh menyetujui pengajuannya sendiri." **[V]**. Head office tidak memegang keduanya. Super admin memegang keduanya, tetapi server tetap mewajibkan dua akun berbeda. Penangguhan depot tidak membekukan payout **[K]**.

### T-63 — Pemilik tidak bisa masuk setelah disetujui

Lihat T-32 dan T-09.

---

## 17. Pesan Error Persis dan Artinya

### 17.1 Pesan berbahasa Inggris dari server (tampil apa adanya) **[B]**

| Pesan persis | Arti | Lihat |
|---|---|---|
| Your cart is empty. | Keranjang kosong | T-22 |
| This delivery address is outside our service area. No depot can deliver here. | Alamat di luar jangkauan | T-22 |
| Pick a depot: this address has no map pin, so we cannot route it automatically. | Pilih depot (alamat tanpa titik peta) | T-22 |
| That depot is not available right now. Please pick another one. | Depot tidak tersedia | T-22 |
| This depot is not taking express deliveries right now. Please pick a time slot. | Ekspres tidak tersedia | T-22 |
| Some items are out of stock at the fulfilling depot. | Sebagian barang habis | T-19 |
| Insufficient stock at the fulfilling depot: {productId} (need {n}, have {m}). | Stok kurang (memuat ID internal) | T-19 |
| Could not confirm stock right now. Please try again. | Cek stok gagal, coba lagi | T-19 |
| Product {id} is no longer available. | Produk sudah tidak dijual | T-19 |
| An order in status {status} can no longer be cancelled. | Pesanan pada status itu tak bisa dibatalkan | T-33 |
| This order already has an active payment. | Sudah ada pembayaran aktif | T-24 |
| Could not reach the payment provider. Please try again. | Penyedia pembayaran tak terjangkau | T-22 |
| unsupported file type (allowed: jpeg, png, webp) | Jenis berkas bukti bayar tak didukung | T-24 |
| You can save at most 20 addresses. | Maksimal 20 alamat | T-22 |
| This voucher has expired. (dan 7 pesan voucher lain) | Lihat tabel voucher | T-23 |
| Please wait Ns before requesting another code. | Tunggu N detik | T-03 |
| This account has been suspended. | Akun dinonaktifkan | T-05 |
| The session was idle for too long. | Sesi diam terlalu lama | T-08 |
| The session has expired. | Sesi kedaluwarsa | T-08 |
| This session was terminated for security reasons. | Sesi dihentikan demi keamanan | T-08 |
| Session not found. | Sesi tidak ditemukan | T-08 |
| You do not have permission to perform this action. | Tidak punya izin | T-12 |
| You are {n} m from the depot. Check in within {r} m. | Di luar radius check-in | T-48 |
| You already have an open shift. Check out before starting a new one. | Shift masih terbuka | T-49 |
| You already have an open shift at this depot. Close it before opening another. | Shift kasir masih terbuka | T-20 |
| This shift is already closed. / This shift belongs to another cashier. | Shift sudah ditutup / milik kasir lain | T-20 |
| Cash taken this shift cannot be read right now, so the shift cannot be closed. Try again shortly. | Tunai shift tak terbaca | T-20 |
| Cannot move a delivery from X to Y. | Perpindahan status tak sah | T-36 |
| This delivery was already updated. Reload and try again. | Muat ulang | T-36 |
| Could not update the order for this delivery. Please try again. | Coba lagi | T-36 |
| A no-show needs at least N contact attempts and Ns of waiting. | Belum cukup upaya | T-36 |
| This courier is not checked in and available. | Kurir belum check-in | T-35 |
| This driver already has the maximum number of active deliveries. | Kurir penuh | T-35 |
| Explain the surplus in the note before verifying this deposit. | Jelaskan surplus | T-51 |
| Withdrawal of X exceeds available balance Y. | Melebihi saldo | T-52 |
| Withdrawal amount must be greater than zero. | Jumlah harus > 0 | T-52 |
| Membebankan selisih ke kurir harus disetujui manajer. Verifikasi tanpa membebankan, atau minta manajer yang memverifikasi. (Indonesia; baru sejak PR #664) | Beban selisih COD hanya oleh Manajer/Super admin | T-51 |
| Adjustment would drive stock below zero. | Stok jadi negatif | T-19 |
| Deposit refund exceeds the deposit this depot still holds (refunding X, Y held). | Refund deposit berlebih | T-21 |
| Only a SENT purchase order can be received. | Hanya PO berstatus Dikirim yang bisa diterima | Bab 5 |
| This application has already been approved or rejected. | Lamaran sudah final | T-32 |
| A depot with this code already exists. | Kode depot sudah ada | Bab 9 |
| A franchise (WARALABA) depot must have an owner. | Depot waralaba wajib punya pemilik | T-59 |
| This depot belongs to another owner. | Depot milik pemilik lain | T-59 |
| "X" is not a valid Indonesian mobile number. | Nomor tidak sah | T-06 |
| Capability tidak dikenal: X (campuran) | Layar dan server tak sinkron: muat ulang | Bab 10 |
| auth-service menolak permintaan (403) / Gagal menghubungi auth-service: … | Sejak PR #664 (2026-10-14) alasan penolakan 4xx dari auth-service (kecuali 401, yang tetap dianggap gangguan layanan) diteruskan ke layar HR apa adanya; pesan generik ini kini hanya muncul untuk gangguan/401/respons tanpa alasan **[V]** (`identity.http.adapter.ts`) | T-17 |
| hr-service belum dikonfigurasi; undangan staf tidak bisa diproses. | Layanan HR tak tersambung: eskalasi tingkat 5 | Bab 10 |

### 17.2 Pesan berbahasa Indonesia (ringkas)

| Pesan | Arti singkat |
|---|---|
| Kode verifikasi salah. · sudah kedaluwarsa. Minta kode baru. · Terlalu banyak percobaan. Minta kode baru. | T-02 |
| Kode baru bisa diminta sebentar lagi. Cek SMS yang sudah masuk dulu. | T-03 |
| Terlalu banyak permintaan kode. Tunggu sebentar, lalu minta kode lagi. | T-04 |
| Akun ini tidak aktif. Hubungi dukungan Hydromart. | T-05 |
| Nomor telepon tidak ditemukan. Silakan mulai lagi dari halaman masuk. | Buka dari halaman masuk |
| Gagal memuat daftar perangkat. | T-08 |
| Akun ini bukan kurir / Akun ini belum tertaut ke data karyawan | T-09 |
| Akun ini belum diberi tanggung jawab depot manapun. / Akun ini hanya boleh mengakses depot yang menjadi tanggung jawabnya. / Gagal memuat daftar depot. | T-14 |
| Orang lain sudah mengubah data ini sejak Anda membukanya… | Konflik simpan bersamaan: periksa data baru lalu simpan ulang |
| Sebagian data gagal dimuat · Gagal memuat … | Satu layanan sumber gagal: muat ulang, cek `/hq/health` |
| Pengaju tidak boleh memutuskan pengajuannya sendiri — teruskan ke atasan. | T-27 |
| Kasbon ini diputuskan oleh asisten supervisor depotnya. · Kasbon sendiri tidak bisa Anda setujui. | T-28 |
| Peran {ROLE} hanya boleh diberikan oleh … · Peran staf depot wajib terikat ke satu depot. | Pembatasan pemberian peran; HR mungkin hanya melihat pesan 403 umum |
| Akun sendiri tidak bisa dihapus. · Ini super admin terakhir. Angkat super admin lain dulu sebelum menghapus. · SUPER_ADMIN tidak boleh dilepas dari accessMatrixWrite. | Pelindung Admin |
| Akun sendiri tidak bisa dinonaktifkan. · Ini super admin terakhir. Angkat super admin lain dulu sebelum menonaktifkan. | Pelindung penonaktifan (baru sejak PR #664, 2026-10-14) · T-05 |
| Akun ini masih punya {n} pesanan yang belum selesai. Tunggu pesanan selesai atau dibatalkan, atau minta Super Admin memaksa penghapusan. · Hanya Super Admin yang boleh memaksa penghapusan. | Hapus akun/PDP ditolak karena pesanan terbuka; paksa hanya Super admin (baru sejak PR #664) · T-05 |
| Minimum penarikan Rp50.000. | Penarikan di bawah minimum (kurir dan waralaba; baru sejak PR #664) · T-52, T-60 |
| Slip ini dibuat oleh akun Anda sendiri; persetujuan harus dari orang lain (atau Super Admin). · Hanya Super Admin yang bisa membatalkan persetujuan payroll. · Alasan wajib diisi. · Hanya payroll APPROVED yang bisa dibatalkan persetujuannya (saat ini {S}) | Payroll: persetujuan sendiri ditolak dan pembatalan persetujuan (baru sejak PR #664) · T-56 |
| Kasbon melebihi batas 1x gaji pokok (Rp{batas}). · Gaji pokok Anda belum diisi sehingga batas kasbon tidak bisa dihitung. Hubungi HR. · Pengajuan ini kedaluwarsa (lewat 3 hari kerja); pemohon perlu mengajukan lagi. | Batas dan kedaluwarsa kasbon (baru sejak PR #664) · T-28 |
| Isi catatan penyelesaian sengketa. · Membebankan selisih ke kurir hanya bisa oleh manajer. Anda bisa memverifikasi tanpa membebankan. | Setoran COD Sengketa dan beban selisih (baru sejak PR #664) · T-51 |
| Tidak ada entri yang cocok dengan filter ini. | Audit: saringan tidak menemukan entri (baru sejak PR #664) · T-38 |
| Seseorang tidak bisa menjadi atasan dirinya sendiri. · Penugasan ini membentuk lingkaran atasan-bawahan. | Hierarki tak sah |
| Masih ada {n} shift kasir terbuka… · Hari ini sudah ditutup. | T-26 |
| Pembayaran belum bisa dikembalikan, jadi penjualan tidak dibatalkan. Coba lagi sebentar. · Penjualan ini bukan hari ini, jadi tidak bisa dibatalkan di kasir. Ajukan refund. | Void konter: syarat shift dan hari yang sama |
| Pembayaran belum tercatat … Coba lagi catat pembayaran | Penjualan tersimpan tetapi pembayaran belum tercatat: catat segera |
| Keranjang berubah sejak percobaan sebelumnya. Ulangi penjualan ini. | 409 idempotensi |
| Jejak audit terlalu besar … | T-38 |
| Notifikasi diblokir. Izinkan Hydromart di setelan perangkat, lalu coba lagi. | T-44 |

### 17.3 Siapa yang berwenang (rujukan cepat)

| Tindakan | Peran bawaan |
|---|---|
| Konfirmasi lunas / tandai gagal | Kepala depot, Manajer, Finance (`paymentSettle`) |
| Ajukan refund / putuskan refund | Finance, Manajer, Super admin / Finance, Super admin |
| Putuskan antrean approval | Manajer, Super admin |
| Verifikasi setoran COD (termasuk yang Sengketa, catatan wajib) | Kepala depot, Manajer, Finance, Super admin |
| Bebankan selisih setoran ke kurir (sejak PR #664) | Manajer, Super admin (`approvals`) |
| Kasbon | Asisten SPV depot; tanpa Asisten SPV: Manajer atau HR |
| Cuti | Tahap 1 Manajer/HR; tahap 2 HR |
| Generate/setujui/bayar payroll (pembuat slip tidak boleh menyetujui sendiri, Super admin dikecualikan; sejak PR #664) | HR, Finance, Super admin |
| Batalkan persetujuan payroll sebelum Dibayar, alasan wajib (sejak PR #664) | Super admin saja |
| Undang/nonaktifkan staf | Head office, Super admin |
| Beri peran HR, Finance, Direktur, Marketing, Super admin, dan (sejak PR #664) Head office | Super admin saja |
| Beri peran Manager | Super admin, HR |
| Peran yang boleh diberikan Head office | Staf depot, Kepala depot, Asisten SPV, SPV, Pemilik waralaba (5 peran) |
| Paksa hapus akun pelanggan yang punya pesanan terbuka (sejak PR #664) | Super admin saja |
| Ubah hak akses, hierarki, retensi, kunci API | Super admin |
| Onboard/tangguhkan depot | Manajer, Super admin (bukan Head office/Direktur) |

Sumber: bagian 9 tiap bab peran. **[V]**

---

## 18. FAQ per Audiens

### 18.1 Pelanggan (boleh dibagikan)

| Pertanyaan | Jawaban |
|---|---|
| Saya lupa kata sandi. | Tidak ada kata sandi. Masuk dengan kode SMS **[V]**. |
| Kode SMS tidak datang. | Tunggu 60 detik, **Kirim ulang kode**. Kode berlaku 5 menit, maksimal 5 kali salah (T-01, T-02). |
| Bisakah belanja tanpa akun? | Tidak. Keranjang dan checkout wajib masuk **[V]**. |
| Bisakah mengubah alamat setelah memesan? | Tidak. Batalkan (selama kurir belum ditugaskan) lalu pesan ulang **[B]**. |
| Mengapa tombol **Batalkan pesanan** hilang? | Kurir sudah ditugaskan; hubungi depot. |
| Kapan saya mendapat refund? | Sejak PR #664 (2026-10-14) rincian pesanan menampilkan status refund dan janji "1–3 hari kerja" (T-30); notifikasi refund tidak ada **[B]**; kebijakan waktu nyata **[K]**. Tanyakan ke depot bila ragu. |
| Mengapa pembayaran saya "FAILED"? | Tidak dikonfirmasi dalam 24 jam; tekan **Coba bayar lagi** (T-34). |
| Apakah ada WhatsApp atau email dari Hydromart? | Tidak. Hanya SMS kode, notifikasi aplikasi, dan kotak masuk. |
| Di mana deposit galon? | Deposit dicatat depot saat galon diantar dan kembali saat galon dikembalikan utuh. Sejak PR #664 checkout menampilkan estimasi "Deposit galon" yang BELUM termasuk total yang dibayar **[V][K]** (T-21). |
| Bisakah melewati satu jadwal langganan? | Tidak; gunakan **Jeda** dan **Lanjutkan** **[B]**. |
| Berapa poin saat mendaftar dengan referral? | Poin masuk setelah pesanan pertama teman selesai; jumlah bawaan 250 untuk yang diajak **[B][K]**. |
| Cara menutup akun? | Akun → Data pribadi saya → **Minta hapus akun**; keputusan di kantor pusat. Sejak PR #664 permintaan ditolak selama masih ada pesanan yang belum selesai; selesaikan atau batalkan pesanan dulu (T-05). |

### 18.2 Staf depot dan kurir

| Pertanyaan | Jawaban |
|---|---|
| Mengapa saya tidak mendapat tugas? | Status harus Online dan Kepala depot menugaskan (T-49). |
| Berapa jarak check-in? | Bawaan 200 m dari depot **[K]** (T-48). |
| Mengapa tombol selesai nonaktif? | Terima uang COD dulu (T-25). |
| Kapan setor? | Setelah check-out; satu kali per shift (T-51). |
| Apakah absen wajah sama dengan check-in shift? | Tidak; dua sistem terpisah (T-49). |
| Bisakah membantah selisih setoran atau absensi? | Tidak ada di aplikasi **[B]**; bicara ke Kepala depot/HR. |
| Data belum terkirim, boleh dibuang? | Jangan, kecuali yakin (T-43). |

### 18.3 Manajemen (Kepala depot, Asisten SPV, SPV, Manajer)

| Pertanyaan | Jawaban |
|---|---|
| Kenapa menu Meteran, Sengketa, Aturan promo tidak ada? | Sejak PR #664 (2026-10-14) tab Meteran, Prakiraan, Aturan promo, Sengketa, CRM, Peran, dan Akun tampil di rel Kepala depot sesuai kapabilitas peran; bila tetap tidak ada, peran Anda tidak memegang kapabilitasnya **[V]**. |
| Kenapa angka "Pesanan masuk" berbeda? | Memakai 100 pesanan terbaru (T-15). |
| Siapa memutuskan kasbon di depot saya? | Asisten SPV depot; kalau tidak ada, Manajer atau HR (T-28). |
| Kenapa depot baru tidak terlihat? | Tunggu ±60 detik dan pastikan ada Asisten SPV (T-14). |
| Bisakah Kepala depot membatalkan pesanan yang belum dikirim? | Tidak ada tombolnya; minta Manajer **[B]**. |

### 18.4 HR

| Pertanyaan | Jawaban |
|---|---|
| Kenapa payroll tidak bisa dibuat? | Bulan belum berakhir atau Resign tanpa Tanggal keluar (T-55). |
| Bisakah membatalkan persetujuan payroll? | Sejak PR #664 (2026-10-14) hanya Super admin, sebelum Dibayar, dengan alasan wajib (T-56). HR tidak bisa **[V]**. |
| Kenapa saya tidak bisa menyetujui payroll yang saya buat? | Pembuat slip tidak boleh menyetujui sendiri (kecuali Super admin) (T-56). |
| Kenapa tidak bisa memberi peran Manager/Finance? | Manager boleh oleh HR; Finance, Direktur, Marketing, HR, Super admin, dan (sejak PR #664) Head office hanya Super admin. |
| Kenapa kasbon ditolak 403? | Depot punya Asisten SPV yang berwenang (T-28). |
| Siapa menyetujui cuti dua tahap? | Dua akun berbeda (T-29). |

### 18.5 HQ (Head office, Direktur, Finance)

| Pertanyaan | Jawaban |
|---|---|
| Kenapa tombol depot/payout/refund menolak? | Tampil tetapi tak dibatasi peran (T-12, bagian 17.3). |
| Siapa menyetujui rilis payout? | Direktur/Super admin; pengaju Finance (T-62). |
| Kenapa Finance melihat galat penuh? | Halaman memuat data yang ditolak peran itu (T-16). Diperbaiki di cabang `fix/uat-g128-g149-g152` (609a497), belum di `main`, belum diuji ulang. |
| Apakah keputusan lamaran waralaba bisa dibatalkan? | Tidak; final **[V]**. |

### 18.6 Admin (Super admin)

| Pertanyaan | Jawaban |
|---|---|
| Bisakah memaksa keluar pengguna lain? | Tombol paksa keluar: Tidak tersedia. Menonaktifkan akun mencabut semua token penyegar sejak PR #664; token akses yang sudah terbit bertahan sampai 15 menit (T-05). |
| Ada 2FA? | Tidak; OTP satu-satunya faktor. Label "Keamanan & 2FA" menyesatkan **[B]**. |
| Mengubah peran akun? | Tidak ada tombol; undang ulang nomor yang sama — hati-hati salah ketik **[B]**. |
| Menonaktifkan diri sendiri? | Ditolak sejak PR #664 ("Akun sendiri tidak bisa dinonaktifkan."), begitu pula menonaktifkan Super admin terakhir (T-05) **[V]**. |
| IP allowlist melindungi konsol HQ? | Tidak; hanya kunci API mitra **[B]**. |
| Kenapa undangan dari `/dashboard/staff` gagal? | Diperbaiki sejak PR #664: halaman itu kini memakai form undang HQ yang sudah membawa kolom karyawan **[V]**. Bila tetap gagal, baca pesan alasan (kini diteruskan dari auth-service, lihat 17.1) dan coba `/hq/staff`. |
| Bisakah Head office membuat sesama Head office? | Tidak sejak PR #664 (keputusan pemilik 2026-10-14); hanya Super admin **[V]**. |
| Bisakah menyaring Log audit? | Ya, sejak PR #664: aksi, tanggal, hasil; ekspor mengikuti saringan (T-38). |
| Grid matriks tampak bawaan semua? | Jangan simpan; muat ulang (T-13). |

---

## 19. Inventaris Screenshot Bab Ini

| ID | Layar | Kondisi | Status |
|---|---|---|---|
| SS-umum-20 | Layar verifikasi OTP | Hitung mundur "Kirim ulang dalam {n}d" | Belum diambil |
| SS-umum-21 | Layar verifikasi OTP terkunci | "Terlalu banyak percobaan. Minta kode baru." | Belum diambil |
| SS-umum-22 | Layar "Khusus HQ" | Tombol Kembali ke halaman saya | Belum diambil |
| SS-umum-23 | Bilah shift kasir | "Belum ada shift terbuka" | Belum diambil |
| SS-umum-24 | Spanduk antrean luring | "{count} data belum terkirim" | Belum diambil |

## 20. Catatan Celah

Daftar terpadu dan ID celah (G-xxx) ada di `17-open-questions-and-documentation-gaps.md`. Gunakan data sintetis pada semua tangkapan layar.
