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
| **Gejala** | Pelanggan: "Akun ini tidak aktif. Hubungi dukungan Hydromart." Staf: pesan Inggris "This account has been suspended." Setelah dinonaktifkan, sesi lama bisa tetap aktif sampai 15 menit lalu mati. |
| **Kemungkinan penyebab** | Status akun SUSPENDED atau DELETED menolak masuk **[V]** (`customer.entity.ts:91-105`). Untuk staf, tombol **Nonaktifkan** di Direktori staf menjadikan akun SUSPENDED (tidak ada istilah terpisah "nonaktif" dan "suspend") **[V]** (`H-admin` P5). Penonaktifan tidak mencabut token yang sudah terbit: akses tetap berjalan sampai token akses habis (maksimal 15 menit), lalu pembaruan sesi gagal dengan "This account has been suspended." **[V]**. Akun DELETED tidak pernah dihidupkan lagi; pekerja yang dipekerjakan ulang mendapat akun baru **[V]**. |
| **Langkah diagnosis** | Admin atau Head office: buka **Direktori staf** (`/hq/staff`), cari nomor, lihat lencana Aktif/Nonaktif. HR: cek status karyawan (Aktif/Nonaktif/Resign) di `/hr/employees`. |
| **Prosedur perbaikan** | Staf: Head office atau Super admin menekan **Aktifkan** pada baris akun (tanpa dialog konfirmasi). Mengundang ulang nomor yang sama juga mengaktifkan kembali akun nonaktif **[V]**. Pelanggan SUSPENDED: layar untuk mengaktifkan kembali pelanggan tidak ditemukan di temuan **[D]**; eskalasi ke tingkat 3–4. |
| **Peran/izin** | Aktifkan/Nonaktifkan staf: kapabilitas `staffAdmin` (Head office, Super admin) **[V]**. HR tidak punya akses `/hq/staff` **[V]**. |
| **Eskalasi** | Tingkat 4 bila akun diduga dinonaktifkan keliru, atau bila Super admin tunggal yang terkunci (lihat G-xxx di Bab 17: penonaktifan diri sendiri/Super admin terakhir tidak dijaga **[B]**). |
| **Lapor dengan** | Nomor akun (disamarkan), peran, pesan persis, kapan terakhir berhasil masuk, siapa yang terakhir mengubah status (lihat Log audit). |

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

