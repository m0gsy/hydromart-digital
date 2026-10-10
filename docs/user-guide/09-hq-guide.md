# Bab 9 — Panduan Kantor Pusat (HQ): Head office, Direktur, dan Finance

| Metadata | Nilai |
|---|---|
| Versi | 0.1 draf |
| Tanggal | 2026-10-10 |
| Klasifikasi | Internal — Rahasia |
| Peran utama | Kantor pusat (kode: HEAD_OFFICE) |
| Peran lain yang juga masuk /hq | Direktur (DIREKTUR), Finance (FINANCE) |
| Dasar | Pembacaan kode (apps/web/src, services/*, packages/access/src/index.ts). Belum ada pengujian di browser yang dijalankan oleh penulis dokumen ini. |

**Cara membaca tag bukti.** **[V]** terverifikasi di kode · **[D]** disimpulkan, perlu konfirmasi · **[K]** perlu konfirmasi bisnis (nilai berasal dari data atau pengaturan) · **[B]** diketahui bermasalah atau tidak konsisten. "Tidak tersedia" berarti fitur memang tidak ada.

**Catatan penting tentang hak akses.** Semua tabel hak akses di bab ini memakai nilai BAWAAN dari `packages/access/src/index.ts`. Super admin dapat mengubah matriks hak akses saat aplikasi berjalan, dan perubahan berlaku dalam sekitar 30 detik. Hak yang Anda miliki di lapangan bisa berbeda dari tabel ini. Untuk mengetahui kondisi sebenarnya, minta Admin membuka layar "Peran & hak akses" (lihat Bab 10).

---

## 1. Gambaran peran

Konsol HQ (alamat dasar `/hq`) adalah pintu kerja kantor pusat untuk memantau dan mengatur seluruh jaringan depot. Pintu ini terbuka bagi empat peran: Kantor pusat (HEAD_OFFICE), Direktur, Finance, dan Super admin. Marketing dan HR tidak punya akses ke /hq. **[V]**

| Peran di UI | Kode | Fungsi utama di HQ | Pendaratan setelah masuk |
|---|---|---|---|
| Head office | HEAD_OFFICE | Peran utama bab ini. Memantau jaringan, mengelola staf, memutuskan harga dan lamaran waralaba, menangani permintaan data pribadi (UU PDP). | /hq (Ringkasan jaringan) |
| Direktur | DIREKTUR | Memantau dan memutuskan. Satu-satunya peran bawaan (selain Super admin) yang boleh menyetujui rilis payout waralaba. | /hq (Ringkasan jaringan) |
| Finance | FINANCE | Menjalankan kas: mengajukan rilis payout, memverifikasi rekening, menandai penarikan lunas atau gagal, memutuskan refund, menerapkan skema komisi, mengatur pajak. | /hq/franchise **[V]** (karena /hq ditolak untuk Finance, lihat bagian 4) |
| Super admin | SUPER_ADMIN | Dibahas di Bab 10. Memegang semua hak dan layar khusus admin. | /hq |

### 1.1 Aksi global dan aksi terbatas

Banyak layar HQ hanya untuk membaca. Aksi tulis dibagi dua jenis:

- **Aksi global** memengaruhi seluruh jaringan dan tidak bisa dibatasi pada satu depot. Contohnya: keputusan harga jaringan, lamaran waralaba, permintaan UU PDP, pajak, katalog, skema komisi. HQ memegang aksi ini.
- **Aksi terbatas** memengaruhi satu depot atau satu objek. Contohnya: menugaskan atau memindahkan depot sebuah pesanan, mengunggah balasan tiket, menyetujui satu refund. Beberapa aksi terbatas hanya boleh dipegang peran tertentu (misalnya hanya Finance).
- Sebagian aksi depot (membuat atau mengubah depot, menangguhkan depot, mengubah ambang persetujuan) bawaannya TIDAK dimiliki Head office, Direktur, maupun Finance. Lihat bagian 9.

### 1.2 Tombol yang tampil tetapi ditolak server **[B]**

Banyak halaman HQ menampilkan tombol tulis kepada semua peran yang boleh membuka halaman, tanpa menyaring per peran. Jika peran Anda tidak memegang hak tulisnya, server menjawab penolakan (403) setelah Anda menekan tombol. Tidak ada data yang berubah. Daftar lengkap ada di bagian 9.2. Aturan praktis: **keberadaan tombol di layar bukan bukti bahwa Anda berwenang**.

### 1.3 Finance: "perlu verifikasi di lingkungan nyata"

Finance lolos pintu /hq, tetapi beberapa halaman Finance memuat data dari layanan yang menolak Finance. Dari pembacaan kode, halaman Pembayaran, Waralaba, Rekonsiliasi, dan Skema komisi kemungkinan tampil sebagai layar galat penuh untuk Finance **[B][D]**. Alur Finance yang bergantung pada halaman-halaman itu (payout Lunas/Gagal, skema komisi) ditandai **"perlu verifikasi di lingkungan nyata"** di seluruh bab ini. Rincian ada di bagian 15.1.

---

## 2. Tujuan dan tanggung jawab

| Peran | Tanggung jawab bawaan |
|---|---|
| Head office | Memantau kesehatan jaringan; mengundang dan menonaktifkan staf (kecuali peran terbatas); memproses lamaran waralaba; memutuskan usulan override harga; memproses permintaan data pribadi UU PDP; mengelola katalog produk; mengatur pajak dan faktur; membuka kembali buku harian depot. |
| Direktur | Memantau jaringan; memutuskan override harga dan lamaran waralaba; menyetujui atau menolak pengajuan rilis payout (bukan pengaju); mengelola insiden, tiket, dan fraud; membaca laporan. Tidak memegang pengelolaan staf, katalog, pajak, maupun permintaan UU PDP. |
| Finance | Mengajukan rilis payout; memverifikasi rekening tujuan; menandai penarikan Lunas atau Gagal; memutuskan refund; menerapkan skema komisi; mengatur pajak dan faktur. |

Prinsip kerja: satu orang tidak boleh menyelesaikan satu alur uang dari awal sampai akhir (maker-checker). Prinsip ini dijelaskan di bagian 6.6 dan 6.7.

---

## 3. Prasyarat akses

1. Akun staf aktif dengan peran Head office, Direktur, atau Finance. Akun dibuat oleh Head office (untuk peran tertentu) atau oleh Super admin. Peran Direktur dan Finance HANYA dapat diberikan oleh Super admin. **[V]**
2. Nomor telepon yang bisa menerima kode OTP (6 digit).
3. Browser modern (setara Chrome 111 atau lebih baru). **[D]** Tidak ada matriks browser resmi di repositori.
4. Rail menu kiri hanya tampil di layar lebar (lebar lg ke atas). Di ponsel, gunakan tombol "Lainnya". **[V]**
5. Jangan memakai akun orang lain. Setiap tindakan keuangan dicatat atas nama pemegang akun (lihat bagian 10).

---

## 4. Masuk dan pengaturan awal

### Prosedur: Masuk ke konsol HQ

**Tujuan:** Masuk ke /hq dengan akun sendiri. **Peran:** Head office, Direktur, Finance. **Prasyarat:** Akun staf aktif; nomor telepon terdaftar. **Titik awal:** `/hq/login` (judul "Masuk konsol staf"). Pintu ini dipakai semua konsol staf, bukan hanya HQ. **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka `/hq/login`. Isi kolom "Nomor telepon" (wajib). Tekan "Kirim kode". | Layar langkah 2 muncul: "Kode OTP" 6 digit, dengan teks "Masukkan 6 digit kode yang dikirim ke …". |
| 2 | Masukkan 6 digit kode. Tekan "Verifikasi & masuk". | Anda masuk dan diarahkan ke halaman pendaratan peran (lihat tabel bagian 1). Bila Anda datang dari tautan halaman lain, parameter `next` membawa Anda kembali ke halaman itu. |
| 3 | Kode tidak datang? Tunggu hitung mundur, lalu tekan "Kirim ulang kode". Salah nomor? Tekan "Ganti nomor". | Tombol berubah menjadi "Kirim ulang dalam {n}s" selama jeda (60 detik secara bawaan; server dapat mengirim nilai lain). |

**Hasil akhir:** Rail HQ tampil di kiri dengan header "HYDROMART · HQ" dan "Konsol pusat · seluruh depot". Peran Anda tertulis di kaki rail ("Peran: …"). **[V]**

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Gagal masuk. Coba lagi." | Verifikasi gagal (kode salah, kedaluwarsa, atau gangguan). | Minta kode baru; periksa nomor. |
| "The verification code is invalid or has expired." | Kode salah atau sudah kedaluwarsa (berlaku 300 detik secara bawaan). | Minta kode baru. |
| "Too many incorrect attempts. Please request a new code." | Terlalu banyak salah memasukkan kode (batas bawaan 5). | Minta kode baru. |
| "Please wait {n}s before requesting another code." | Jeda kirim ulang belum habis. | Tunggu. |
| "This account has been suspended." | Akun dinonaktifkan. | Hubungi Admin (Bab 10). |
| "Kode OTP tidak bisa dikirim sekarang. Coba lagi sebentar lagi." | Pengiriman SMS gagal. Penyebab paling sering di dokumen operasi: saldo penyedia SMS habis. **[D]** | Coba lagi; bila berlanjut, eskalasi ke pemilik sistem. |

**Izin & batasan:** Sesi berakhir otomatis (catatan di layar: "Sesi berakhir otomatis 15 menit · dicatat di log audit"). Angka 15 menit adalah batas menganggur bawaan yang dapat diubah Admin. Tidak ada 2FA tambahan; OTP telepon adalah satu-satunya faktor. **[V]**

**Daftar periksa:**
- [ ] Saya masuk dengan nomor saya sendiri.
- [ ] Peran yang tertulis di kaki rail benar.
- [ ] Saya keluar (tombol "Keluar") bila meninggalkan perangkat bersama.

> **[SCREENSHOT REQUIRED: SS-hq-01 — layar /hq/login langkah 1 (kolom Nomor telepon dan tombol Kirim kode) dan langkah 2 (Kode OTP, Verifikasi & masuk, Kirim ulang kode)]**
> *Gambar 9.1 — Pintu masuk konsol staf.*

### 4.1 Mengenal layar

- **Rail kiri** (layar lebar): grup menu, pengalih tema ("Ganti tema"), pengalih bahasa ID/EN, "Peran: {peran}", tombol "Keluar". **[V]**
- **Ponsel:** tiga tab pertama sesuai peran, ditambah "Lainnya" yang membuka lembar "Semua layar". Tab bawaan: Head office dan Direktur = "Ringkasan jaringan", "Pencarian", "Direktori depot"; Finance = "HR (SDM)", "Waralaba", "Pembayaran". **[D]**
- **Aksi cepat** (palet perintah): tekan Ctrl atau Cmd + K, atau tombol "Aksi cepat". Ketik di kolom "Cari layar atau aksi…". Panah atas/bawah memilih, Enter membuka, Esc menutup. Kosong: "Tidak ada hasil." **[V]**
  - Daftar "Layar" disaring menurut peran. Daftar "Aksi" TIDAK disaring: "Buat aturan harga", "Buat voucher", "Onboard depot", "Undang staf", "Broadcast notifikasi". Bagi Head office, Direktur, dan Finance sebagian aksi ini berujung layar "Khusus HQ" atau penolakan server **[B]**.
- **Layar "Khusus HQ"** muncul bila halaman tidak boleh dibuka peran Anda: "Konsol Admin & Super Admin hanya untuk head office dan super admin. Peran kamu saat ini {role} tidak memiliki akses." Tombol: "Kembali ke halaman saya". **[V]** Teks ini memakai kata "Admin" meski Direktur dan Finance juga boleh masuk pintu /hq. **[B]**
- **Indeks layar HQ** (`/hq/sitemap`) menampilkan semua layar yang boleh dibuka peran Anda, dikelompokkan seperti rail. Gunakan untuk memastikan akses nyata Anda. **[V]**
- **Profil admin** (`/hq/profile`): kartu "Akun" (baca saja) dan tabel "Notifikasi per event" (Push, Email, WhatsApp). Setiap klik sakelar langsung menyimpan ("Preferensi notifikasi disimpan"). Apakah tiap event benar-benar mengirim pemberitahuan belum diverifikasi **[K]**. Catatan: dokumen arsitektur menyebut otomasi WhatsApp sengaja dihentikan; jangan mengandalkan kanal itu. **[D]**

---

## 5. Menu dan modul tersedia

### 5.1 Tabel rail /hq (nilai bawaan)

Y = peran memegang kapabilitas secara bawaan. "-" = tidak; halaman tidak tampil di rail dan membuka URL-nya langsung menampilkan "Khusus HQ". HO = Head office, DIR = Direktur, FIN = Finance. Sumber: `apps/web/src/lib/hq-nav.ts`, label dari `dictionaries/id/hq.ts`. **[V]**

| Grup | Label | Rute | Kapabilitas | HO | DIR | FIN |
|---|---|---|---|:-:|:-:|:-:|
| Ringkasan & tata kelola | Ringkasan jaringan | /hq | dashboard | Y | Y | - |
| Ringkasan & tata kelola | Pencarian | /hq/search | depotDirectory | Y | Y | - |
| Ringkasan & tata kelola | Peran & hak akses | /hq/access | accessMatrixWrite | - | - | - |
| Jaringan depot | Direktori depot | /hq/depots | depotDirectory | Y | Y | - |
| Jaringan depot | Hierarki pembinaan | /hq/hierarchy | hierarchyAdmin | - | - | - |
| Jaringan depot | Konsol depot (keluar dari /hq) | /dashboard | dashboard | Y | Y | - |
| Staf & peran | Direktori staf | /hq/staff | staffAdmin | Y | - | - |
| Staf & peran | HR (SDM) (keluar dari /hq) | /hr | hrView | Y | Y | Y |
| Waralaba | Lamaran waralaba | /hq/applications | franchiseApplications | Y | Y | - |
| Waralaba | Waralaba | /hq/franchise | hqPayoutRead | Y | Y | Y |
| Keuangan & harga | Pembayaran | /hq/payments | hqPayoutRead | Y | Y | Y |
| Keuangan & harga | Harga jaringan | /hq/pricing | priceOverrideDecide | Y | Y | - |
| Keuangan & harga | Voucher | /hq/vouchers | voucherRead | Y | Y | - |
| Keuangan & harga | Refund | /hq/refunds | refundQueueRead | Y | Y | Y |
| Keuangan & harga | Rekonsiliasi | /hq/reconciliation | commissionRead | Y | Y | Y |
| Keuangan & harga | Laba rugi jaringan | /hq/pnl | dashboard | Y | Y | - |
| Keuangan & harga | Ekspor laporan | /hq/reports/export | orderReports | Y | Y | - |
| Keuangan & harga | Pajak & faktur | /hq/tax | taxSettings | Y | - | Y |
| Operasi harian | Inventory jaringan | /hq/inventory | inventoryRead | Y | Y | - |
| Operasi harian | Retur galon | /hq/returns | returnsRead | Y | Y | - |
| Operasi harian | Roster kurir | /hq/roster | driverRoster | Y | Y | - |
| Operasi harian | Pesanan | /hq/orders | orderQueue | Y | Y | - |
| Operasi harian | Notifikasi | /hq/notifications | opsNotif | Y | Y | - |
| Analitik & pertumbuhan | Analitik jaringan | /hq/analytics | dashboard | Y | Y | - |
| Analitik & pertumbuhan | Peringkat depot | /hq/scorecard | dashboard | Y | Y | - |
| Analitik & pertumbuhan | Bandingkan depot | /hq/compare | dashboard | Y | Y | - |
| Analitik & pertumbuhan | Prakiraan permintaan | /hq/forecast | forecast | Y | Y | - |
| Analitik & pertumbuhan | Churn & retensi | /hq/churn | churn | Y | Y | - |
| Analitik & pertumbuhan | Kampanye | /hq/campaigns | campaignRead | Y | Y | - |
| Analitik & pertumbuhan | Promosi & banner | /hq/promotions | promotionRead | Y | Y | - |
| Analitik & pertumbuhan | Aturan promo | /hq/promo-rules | promoRuleRead | Y | Y | - |
| Analitik & pertumbuhan | Customer 360 | /hq/customers | customerPhoneLookup | Y | Y | - |
| Analitik & pertumbuhan | Reseller (keluar dari /hq) | /resellers | resellerView | Y | Y | - |
| Katalog & harga | Katalog produk | /hq/catalog | catalogWrite | Y | - | - |
| Katalog & harga | Program loyalti | /hq/loyalty | rewardCatalog | - | - | - |
| Katalog & harga | Langganan galon | /hq/subscriptions | hqBackOffice | Y | Y | - |
| Form & flow | Aturan harga | /hq/forms/pricing-rule | depotAdmin | - | - | - |
| Form & flow | Voucher (formulir) | /hq/forms/voucher | voucherWrite | - | - | - |
| Form & flow | Skema komisi | /hq/forms/commission | commissionRead | Y | Y | Y |
| Form & flow | Segment | /hq/forms/segment | campaignWrite | - | - | - |
| Form & flow | Impor staf | /hq/staff/import | staffAdmin | Y | - | - |
| Form & flow | Broadcast notifikasi | /hq/broadcast | campaignWrite | - | - | - |
| Flow & analitik | Linimasa insiden | /hq/incidents | hqBackOffice | Y | Y | - |
| Flow & analitik | Tiket dukungan | /hq/tickets | hqBackOffice | Y | Y | - |
| Flow & analitik | Fraud & risiko | /hq/fraud | fraudReview | Y | Y | - |
| Flow & analitik | Laporan terjadwal | /hq/scheduled-reports | hqBackOffice | Y | Y | - |
| Flow & analitik | Onboarding depot | /hq/onboarding | depotDirectory | Y | Y | - |
| Sistem | Log audit | /hq/audit | hqBackOffice | Y | Y | - |
| Sistem | Feature flags | /hq/flags | platformAdmin | - | - | - |
| Sistem | Kesehatan sistem | /hq/health | hqBackOffice | Y | Y | - |
| Sistem | Log ekspor data | /hq/exports | hqBackOffice | Y | Y | - |
| Sistem | Kunci API | /hq/api-keys | platformAdmin | - | - | - |
| Sistem | Webhooks | /hq/webhooks | platformAdmin | - | - | - |
| Sistem | Kebijakan SLA | /hq/sla-policy | depotAdmin | - | - | - |
| Sistem | Model prakiraan | /hq/forecast-models | forecast | Y | Y | - |
| Sistem | Retensi & backup | /hq/retention | platformAdmin | - | - | - |
| Sistem | Permintaan data (UU PDP) | /hq/pdp | pdpRequests | Y | - | - |
| Sistem | Keamanan & 2FA | /hq/security | platformAdmin | - | - | - |
| Admin & polish | Profil admin | /hq/profile | ownNotifPrefs | Y | Y | Y |
| Admin & polish | Wizard HQ | /hq/wizard | platformAdmin | - | - | - |
| Admin & polish | Template faktur | /hq/invoice-template | taxSettings | Y | - | Y |
| Admin & polish | Konten dwibahasa | /hq/content | platformAdmin | - | - | - |
| Admin & polish | Indeks layar HQ | /hq/sitemap | hqConsole | Y | Y | Y |

### 5.2 Catatan tabel

- Layar dengan "-" di ketiga kolom adalah **layar khusus Admin** (Bab 10) atau layar Marketing/Manajer. Jangan menganggapnya fitur HQ. Rincian: /hq/access, /hq/hierarchy, /hq/flags, /hq/api-keys, /hq/webhooks, /hq/retention, /hq/security, /hq/wizard, /hq/content hanya untuk Super admin; /hq/loyalty, /hq/forms/segment, /hq/broadcast untuk Marketing dan Super admin; /hq/forms/voucher untuk Marketing, Manajer, Super admin; /hq/forms/pricing-rule dan /hq/sla-policy untuk Manajer dan Super admin. **[V]**
- **/hq/sla-policy** **[B]**: rail memakai kapabilitas depotAdmin, tetapi server memakai hqBackOffice (dipegang Head office dan Direktur). Akibatnya Head office dan Direktur tidak bisa menjangkau layar ini lewat rail maupun URL. Lihat bagian 6.28.
- **Finance tidak punya `dashboard`.** Karena itu Finance tidak boleh membuka /hq (Ringkasan jaringan). Finance mendarat di /hq/franchise. **[V]**
- Tiga entri rail membawa Anda keluar dari /hq: "Konsol depot" (/dashboard), "HR (SDM)" (/hr), "Reseller" (/resellers). **[V]**
- Tombol "Re-engage", "Buat kampanye", dan sejenisnya tidak ada di tabel karena merupakan aksi di dalam halaman (lihat bagian 9.2).

---

## 6. Prosedur langkah demi langkah

Setiap prosedur menyebut peran yang berwenang menurut nilai bawaan. Bila peran Anda tidak tercantum, jangan menekan tombol tulisnya.

### 6.1 Ringkasan jaringan (/hq)

**Tujuan:** Melihat kondisi 30 hari terakhir seluruh depot. **Peran:** Head office, Direktur (Finance ditolak). **Titik awal:** Rail "Ringkasan & tata kelola" > "Ringkasan jaringan". Layar hanya BACA. **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka /hq. | Enam kartu KPI: "Pendapatan" (+ "{n} pesanan"), "Pesanan", "SLA tepat waktu" (`{onTime}/{total} tepat waktu`; "—" bila belum ada pesanan terkirim), "Depot aktif" ("dari {total} depot"), "Pelanggan baru" ("30 hari terakhir"), "Menunggu persetujuan" (lamaran waralaba belum final). |
| 2 | Pilih tampilan: "Utama", "Peta", atau "Ringkas". | "Utama": tabel "Performa depot" (Depot, Pendapatan, SLA, Pesanan) dan kartu "Perlu perhatian". "Peta": "Depot aktif", "Total pendapatan", "Rata-rata SLA", "Sebaran depot". "Ringkas": "Pendapatan 30 hari", "Tren pendapatan", "Depot teratas". |
| 3 | Klik baris atau nama depot. | Membuka detail depot (/hq/depots/detail). |

**Hal yang perlu diketahui:**
- Untuk Direktur, kartu "Pelanggan baru" berisi "Tidak tersedia untuk peran ini" (butuh hak yang hanya dimiliki Head office). **[V]**
- Kartu "Perlu perhatian" memuat depot dengan SLA di bawah 88% ("SLA {v}% di bawah ambang"; ambang 88% tertanam di kode, bukan pengaturan **[V]**) dan sumber data yang mati ("Sumber {name} tidak tersedia"). Kosong: "Semua depot dalam kondisi sehat."
- Galat sebagian: "Sebagian data gagal dimuat ({sources}). Menampilkan yang tersedia." Jangan menyimpulkan nol dari tanda "—".

> **[SCREENSHOT REQUIRED: SS-hq-02 — /hq tampilan "Utama" dengan enam kartu KPI, tabel Performa depot, dan kartu Perlu perhatian]**
> *Gambar 9.2 — Ringkasan jaringan.*

### 6.2 Pencarian (/hq/search)

**Tujuan:** Menemukan depot, staf, pelanggan, atau pesanan. **Peran:** Head office, Direktur. **Titik awal:** "Pencarian". Hanya BACA. **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Ketik di kolom "Nama depot, staf, nomor pesanan, atau nomor HP pelanggan…". | Setelah jeda 300 ms hasil dikelompokkan: "Depot", "Staf", "Pelanggan", "Pesanan" (maksimal 10 baris per kelompok). |
| 2 | Klik hasil. | Depot membuka detail depot; Staf membuka /hq/staff; Pelanggan membuka /hq/customers. |

**Batasan:** kelompok "Pelanggan" hanya muncul bila input berupa nomor HP; tidak ada pencarian nama pelanggan. Baris "Pesanan" **tidak bisa diklik** **[B]**. Pesan: "Mulai mengetik untuk mencari di seluruh jaringan." / "Tidak ada hasil untuk "{q}"." / "Tidak bisa mencari di: {sources}. Hasil di bawah belum lengkap."

### 6.3 Depot: melihat, membuat, mengubah, menangguhkan (/hq/depots)

**Tujuan:** Mengelola direktori depot. **Peran membaca:** Head office, Direktur. **Peran menulis (bawaan):** Manajer dan Super admin saja. **Head office dan Direktur melihat tombol tulis tetapi simpan ditolak server** **[B][V]**. Finance tidak bisa membuka halaman ini. **Titik awal:** "Jaringan depot" > "Direktori depot".

**Membaca (Head office, Direktur):**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka /hq/depots. Ketik di "Cari depot, kota, atau kode…". | Kartu depot: kode · kota · provinsi, lencana "Aktif" atau "Ditangguhkan", "Milik pusat" atau "Waralaba", jarak "{n} km". Penyaringan dilakukan di layar atas nama, kode, kota, provinsi. |
| 2 | Klik kartu depot. | Detail depot (/hq/depots/detail?id=…): tombol "Semua depot", ubin "Pendapatan 30h", "Pesanan", "SLA tepat waktu", "Rating"; kartu "Cakupan & konfigurasi", "Kesehatan stok", "Staf depot", "Pesanan terbaru", "Payout waralaba tertunda". |

Kosong: "Belum ada depot. Onboard depot pertama." / "Tidak ada depot yang cocok."

### Prosedur: Onboard (membuat) depot

**Tujuan:** Mendaftarkan depot baru. **Peran:** Super admin atau Manajer (bawaan). Head office dan Direktur akan menerima penolakan 403 saat menyimpan **[B]**. **Prasyarat:** Untuk depot waralaba, akun Pemilik waralaba sudah ada (dibuat lewat "Undang staf", bagian 6.4). **Titik awal:** /hq/depots > tombol "＋ Onboard depot", atau `/hq/depots?onboard=1`, atau otomatis setelah lamaran waralaba disetujui (bagian 6.8).

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Isi "Kode" (wajib, contoh "JKT-01") dan "Nama depot" (wajib, contoh "Depot Cikini"). | — |
| 2 | Pilih "Kepemilikan": kartu "Milik pusat (HKP)" atau "Waralaba". | Bila "Waralaba", muncul pilihan "Pemilik waralaba" (wajib): "Wajib untuk depot waralaba — pendapatan depot masuk ke ledger pemilik ini." Bila daftar kosong: "Belum ada akun Pemilik waralaba. Buat dulu di Direktori staf." Memilih "Milik pusat" mengosongkan pemilik. |
| 3 | Isi "Alamat", "Kota", "Provinsi" (semua wajib), "Latitude" (-90 s.d. 90), "Longitude" (-180 s.d. 180). | Validasi di layar. |
| 4 | Isi "Radius km" (kosong = 5 km), "Ongkir" (0 atau lebih, wajib), "Min order" (kosong = tanpa minimum). | — |
| 5 | Isi "Nomor WhatsApp depot" (opsional): angka saja, boleh diawali +, 8–15 digit. | Kosong = ke nomor ops pusat. |
| 6 | Blok "Pembayaran ke depot" (opsional): "Nama bank", "Nomor rekening", "Atas nama", "URL gambar QRIS". | Tanpa tujuan pembayaran, pelanggan hanya ditawari tunai (dicatat di dokumen operasi). **[D]** |
| 7 | Tekan "Buat depot". "Batal" menutup tanpa menyimpan. | Sukses: depot muncul di daftar. Gagal: "Gagal menyimpan depot." atau pesan server. |

**Pesan validasi (sebagian masih Bahasa Inggris, belum dilokalkan) [B]:**

| Pesan | Arti | Solusi |
|---|---|---|
| "code is required." (dst. untuk nama, alamat, kota, provinsi) | Kolom wajib kosong. | Isi kolom. |
| "Latitude must be between -90 and 90." | Latitude di luar rentang. | Perbaiki. |
| "Delivery fee must be 0 or more." | Ongkir negatif. | Isi 0 atau lebih. |
| "Service radius must be greater than 0." | Radius 0 atau negatif. | Kosongkan atau isi lebih dari 0. |
| "A franchise (WARALABA) depot must have an owner." | Depot waralaba tanpa pemilik. | Pilih pemilik waralaba. |
| "A depot with this code already exists." | Kode ganda. | Pakai kode lain. |
| "Orang lain sudah mengubah data ini sejak Anda membukanya. Layar dimuat ulang — periksa lalu simpan lagi." | Data diubah orang lain (saat Ubah). | Periksa data baru lalu simpan ulang. |

**Mengubah depot:** detail depot > "Edit" > ubah kolom > "Simpan perubahan". **Hasil akhir:** depot tersimpan. **Izin:** sama dengan membuat depot.

### Prosedur: Tangguhkan dan aktifkan depot

**Tujuan:** Menonaktifkan depot. Dampaknya besar. **Peran:** Super admin atau Manajer (bawaan). **Titik awal:** detail depot > tombol merah "Tangguhkan".

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Tekan "Tangguhkan". | Dialog "Tangguhkan Depot?" — "Depot "{name}" akan dinonaktifkan. Tindakan ini berdampak besar." Blok "Dampak penangguhan": "Pesanan aktif dialihkan ke depot terdekat" (angka = total pesanan depot; "—" bila gagal baca), "Staf & kurir depot kehilangan akses" (Perkiraan), "Radius cakupan dikembalikan ke depot terdekat" (Perkiraan). |
| 2 | Ketik persis kode depot di kolom "Ketik kode depot "{code}" untuk mengonfirmasi". | Tombol "Tangguhkan depot" aktif hanya bila teks cocok. |
| 3 | Tekan "Tangguhkan depot". | Depot berlabel "Ditangguhkan". Gagal: "Gagal menangguhkan depot. Coba lagi." |
| Pemulihan | Pada depot nonaktif tekan "Aktifkan". | Depot aktif lagi tanpa konfirmasi. Bila ditolak server, tombol **gagal diam-diam tanpa pesan** **[B][V]**. |

**Catatan:** Dua baris "Perkiraan" dalam dialog hanya perkiraan teks; mekanisme pencabutan akses sesi staf belum ditelusuri **[D]**. Penangguhan depot waralaba tidak membekukan saldo pemilik (tidak ada kode yang mengaitkannya) **[D]**.

> **[SCREENSHOT REQUIRED: SS-hq-03 — detail depot dengan tombol Edit dan Tangguhkan, serta dialog "Tangguhkan Depot?" dengan blok Dampak penangguhan dan kolom ketik kode]**
> *Gambar 9.3 — Menangguhkan depot.*

### 6.4 Undang staf (/hq/staff)

### Prosedur: Mengundang atau menetapkan peran staf

**Tujuan:** Membuat akun staf baru, atau mengubah peran dan depot akun yang sudah ada. **Peran:** Head office (dan Super admin). Direktur dan Finance tidak memegang hak ini. **Prasyarat:** Nomor telepon staf; untuk Staf depot dan Kepala depot, depot penempatan. **Titik awal:** "Staf & peran" > "Direktori staf" > tombol "＋ Undang staf". **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Tekan "＋ Undang staf". | Kartu "Undang / tetapkan peran staf". |
| 2 | Isi "Nomor telepon" (wajib). Format 0812…, +62…, atau 62… diterima. | Kosong: "Masukkan nomor telepon." Nomor tidak sah: pesan server `"X" is not a valid Indonesian mobile number.` |
| 3 | Isi "Nama (untuk akun baru)". | Dipakai hanya untuk akun baru. |
| 4 | Pilih "Peran" (tombol). | Hanya peran yang boleh Anda berikan yang ditawarkan (lihat tabel di bawah). |
| 5 | Pilih "Depot penempatan (opsional)" (bawaan "Tanpa depot"). | Wajib untuk Staf depot dan Kepala depot. |
| 6 | Untuk selain Pemilik waralaba: isi "Posisi" (wajib), "Tanggal masuk" (bawaan hari ini), "Status kepegawaian" (Training / Percobaan / Tetap; bawaan Percobaan), "Gaji" (Bulanan atau Harian + angka lebih dari 0, wajib). | Bila kosong: "Posisi dan gaji wajib diisi — datanya dipakai membuat kartu karyawan." |
| 7 | Tekan "Kirim undangan". "Batal" menutup. | Form menutup dan daftar dimuat ulang. Gagal: pesan server atau "Gagal mengundang staf." |

**Hasil akhir:** Akun aktif seketika (tanpa status menunggu); kartu karyawan dibuat di HR. Nomor yang sudah punya akun DIPROMOSIKAN (peran dan depot berubah), bukan digandakan, dan akun nonaktif **ikut diaktifkan kembali** **[V]**. Orang yang diundang masuk dengan OTP telepon. **Tidak ada SMS atau pesan undangan** yang dikirim oleh langkah ini **[D]**; beri tahu staf secara terpisah. Pemilik waralaba tidak mendapat kartu karyawan (posisi "Pemilik waralaba").

**Peran yang boleh diberikan Head office** (RESTRICTED_GRANTS) **[V]**:

| Boleh | Tidak boleh (hanya Super admin) | Tidak boleh (Super admin atau HR) |
|---|---|---|
| Staf depot, Kepala depot, Asisten SPV, SPV, Pemilik waralaba, Head office | Super admin, Direktur, Finance, HR, Marketing | Manajer |

Penolakan server: "Peran {ROLE} hanya boleh diberikan oleh {A atau B}." (contoh: "Peran MANAGER hanya boleh diberikan oleh SUPER_ADMIN atau HR."). Tanpa depot: "Peran staf depot wajib terikat ke satu depot." Catatan: Head office dapat menciptakan sesama Head office **[D]**; konfirmasi ke pemilik apakah itu dikehendaki.

**Aksi lain pada baris staf (hanya Head office dan Super admin):**
- "Depot penempatan": pemilih untuk Staf depot, Kepala depot, Asisten SPV, SPV, Manajer. Konfirmasi "Pindahkan {name} ke {depot}?" Gagal: "Gagal memindahkan depot." Kartu karyawan ikut pindah. Depot yang terlihat oleh Manajer dan SPV ditentukan hierarki (Bab 10), bukan kolom ini.
- "Nonaktifkan" / "Aktifkan": **tanpa konfirmasi**. Kartu karyawan ikut berubah. Gagal: "Gagal mengubah status akun." Nonaktif tidak mematikan token yang sudah terbit; akses lama berlaku sampai sekitar 15 menit **[V]**.
- "Hapus": hanya Super admin (Bab 10).
- Tautan kuning "Belum ada data karyawan — buatkan" bila akun belum punya kartu karyawan di HR.

**Tidak ada tombol "ubah peran".** Untuk mengubah peran, undang ulang nomor yang sama dengan peran baru. **[V]**

### 6.5 Impor staf massal (/hq/staff/import)

**Tujuan:** Membuat atau memperbarui banyak akun sekaligus. **Peran:** Head office (dan Super admin). **Titik awal:** "Form & flow" > "Impor staf", judul "Impor Staf Massal".

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Tekan "Unduh template Excel", isi, simpan. | Berkas template. |
| 2 | Tekan "Pilih file" (.xlsx atau .csv, maksimal 500 baris). | Pratinjau: "{n} baris siap", "{n} baris bermasalah", status per baris. .xls atau .ods ditolak ("Format lama (.xls / .ods) tidak bisa dibaca…"). |
| 3 | Periksa pratinjau, lalu tekan "Import {n} baris". | Hasil: "{n} dibuat", "diperbarui", "dilewati", "gagal", dan daftar "Baris {r} — status". |
| 4 | Tekan "Unduh baris gagal" atau "Unduh baris bermasalah". | Berkas untuk diperbaiki dan diunggah ulang (aman; nomor yang ada diperbarui). |

**Kolom (tanda * wajib):** phone* (diubah ke +628…), fullName, role* (huruf besar), depotCode (kode depot), position*, joinDate* (YYYY-MM-DD), employmentStatus* (TRAINING / PROBATION / PERMANENT), salaryType* (DAILY / MONTHLY), dailyRate, monthlyRate. **Pesan:** `kolom "{column}" wajib diisi`; `kode depot "{value}" tidak dikenal`; "… bukan nomor HP Indonesia yang sah".

**Batasan [B]:** pilihan peran di template memuat semua 12 peran, tetapi server menolak per baris peran yang terbatas bagi Head office (baris menjadi "gagal" dengan pesan "Peran … hanya boleh diberikan oleh …"). Baris Staf depot atau Kepala depot tanpa depot juga gagal.

### 6.6 Payout waralaba dan maker-checker (/hq/payments)

**Tujuan:** Mencairkan saldo pemilik waralaba melalui dua orang berbeda. **Peran:** Finance mengajukan dan menyelesaikan; Direktur (atau Super admin) menyetujui; Head office hanya membaca. **Titik awal:** "Keuangan & harga" > "Pembayaran" (judul halaman "Pembayaran & payout"). **Finance: perlu verifikasi di lingkungan nyata** (bagian 15.1). **[V]**

**Isi halaman:** empat kartu KPI ("Terkumpul", "Belum settle", "Payout tertunda", "Refund perlu disetujui") dan lima kartu: "Belum settle per metode", "Rilis payout waralaba", "Rekening tujuan menunggu verifikasi", "Pengajuan rilis menunggu persetujuan", "Penarikan menunggu jawaban bank".

**Siapa boleh apa (ditegakkan server):**

| Aksi | Pemegang bawaan | Head office | Direktur | Finance |
|---|---|:-:|:-:|:-:|
| Membaca antrean, rekening, pengajuan, penarikan | hqPayoutRead | Y | Y | Y |
| "Ajukan rilis", "Verifikasi"/"Tolak" rekening, "Lunas"/"Gagal" | hqPayout (Finance, Super admin) | - | - | Y |
| "Setujui & rilis" / "Tolak" pengajuan | hqPayoutApprove (Direktur, Super admin) | - | Y | - |

Hanya tombol "Setujui & rilis" dan "Tolak" yang disaring per peran di layar. Tombol "Ajukan rilis", "Verifikasi", "Tolak" (rekening), "Lunas", "Gagal" tampil untuk Head office dan Direktur tetapi ditolak server **[B]**.

### Prosedur: Rilis payout waralaba (empat mata)

**Prasyarat:** Pemilik sudah mendaftarkan rekening dan rekening berstatus terverifikasi.

| Langkah | Pelaku | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|---|
| 1 | Finance | Di kartu "Rekening tujuan menunggu verifikasi", cocokkan nama dan nomor rekening ("{bank} · {no rek}", "{atas nama} · Pemilik waralaba / Kurir"). Tekan "Verifikasi". | Konfirmasi "Verifikasi rekening ini? Pencairan berikutnya akan dikirim ke sana." Toast "Rekening diverifikasi". Pencairan hanya ke rekening terverifikasi. |
| 1b | Finance | Bila tidak cocok, tekan "Tolak". | Konfirmasi "Tolak rekening ini? Pemiliknya harus mendaftarkan ulang." Toast "Rekening ditolak". Tidak ada kolom alasan; pemilik melihat "Ditolak: tanpa alasan". **[V]** |
| 2 | Finance | Di kartu "Rilis payout waralaba", lihat pemilik, "Jatuh tempo {tgl}" dan saldo. Tekan "Ajukan rilis". | Dibuat pengajuan berstatus menunggu untuk SELURUH saldo saat itu. Belum ada uang bergerak. Syarat: saldo lebih dari 0 ("Withdrawal amount must be greater than zero.") dan belum ada pengajuan lain untuk pemilik itu ("Pencairan untuk pemilik ini sudah diajukan dan menunggu persetujuan."). |
| 3 | Direktur (bukan pengaju) | Di kartu "Pengajuan rilis menunggu persetujuan" (tertulis "Diajukan oleh {actor}"), tekan "Setujui & rilis". | Konfirmasi "Setujui pengajuan ini? Saldo pemilik akan dipotong dan ditransfer." Toast "Pengajuan disetujui, payout dirilis". Sistem membuat penarikan berstatus PROCESSING; saldo dipotong saat itu. |
| 3b | Direktur | Atau tekan "Tolak". | Konfirmasi "Tolak pengajuan ini? Tidak ada saldo yang bergerak." Toast "Pengajuan ditolak". Layar tidak meminta alasan. |
| 4 | Finance | Setelah bank menjawab, di kartu "Penarikan menunggu jawaban bank" (sub-daftar "Pemilik waralaba" dan "Kurir") tekan "Lunas" bila transfer masuk. | Konfirmasi "Tandai penarikan ini sudah dibayar? Tidak bisa dibatalkan." Toast "Penarikan ditandai lunas." |
| 4b | Finance | Tekan "Gagal" bila transfer tidak masuk. | Konfirmasi "Tandai penarikan ini gagal? Saldonya akan dikembalikan dan ini tidak bisa dibatalkan." Toast "Penarikan ditandai gagal; saldonya dikembalikan." |

**Hasil akhir:** Penarikan berakhir PAID atau FAILED (saldo kembali). Status: pengajuan PENDING → APPROVED / REJECTED; penarikan PROCESSING → PAID / FAILED; rekening PENDING → VERIFIED / REJECTED. **[V]**

**Masalah umum:**

| Pesan | Arti | Solusi |
|---|---|---|
| "Pengaju pencairan tidak boleh menyetujui pengajuannya sendiri." | Pengaju mencoba menyetujui. | Minta Direktur lain atau Super admin yang bukan pengaju. |
| "Belum ada rekening tujuan yang terverifikasi. Daftarkan rekening dan tunggu verifikasi kantor pusat sebelum menarik saldo." | Tidak ada rekening terverifikasi; pengajuan dikembalikan ke menunggu. | Verifikasi rekening dulu. |
| "Withdrawal is already {status}; only a PROCESSING withdrawal can be settled." | Penarikan sudah final (Lunas/Gagal). | Muat ulang halaman; tidak ada tindakan lagi. |
| "Withdrawal of X exceeds available balance Y." | Jumlah melebihi saldo. | Periksa saldo. |

**Catatan:**
- Toast "Pengajuan disetujui, payout dirilis" muncul saat status PROCESSING. Uang belum terbukti keluar sampai Finance menandai Lunas. **[V]**
- Pemilik waralaba juga bisa menarik sendiri ("Cairkan saldo"). Penarikan itu langsung PROCESSING ke rekening terverifikasi tanpa pengajuan HQ, lalu muncul di kartu "Penarikan menunggu jawaban bank" untuk ditandai Lunas atau Gagal oleh Finance. **[V]**
- "Jatuh tempo" selalu tanggal 15 (WIB) berikutnya. Itu informasi, bukan penjadwal otomatis; tidak ditemukan pekerjaan yang merilis otomatis. **[D]**
- Super admin memegang kedua hak, tetapi server tetap melarang pengaju menyetujui pengajuannya sendiri. **[V]**
- Bila Finance membuka halaman ini, kemungkinan tampil layar galat penuh karena halaman memuat ringkasan eksekutif yang butuh hak `dashboard`. **[B][D]** Perlu verifikasi di lingkungan nyata.

> **[SCREENSHOT REQUIRED: SS-hq-04 — /hq/payments memperlihatkan kartu "Rilis payout waralaba" (tombol Ajukan rilis) dan "Pengajuan rilis menunggu persetujuan" (tombol Setujui & rilis dan Tolak) pada akun Direktur]**
> *Gambar 9.4 — Rilis payout dan persetujuan.*

> **[SCREENSHOT REQUIRED: SS-hq-05 — kartu "Penarikan menunggu jawaban bank" dengan tombol Lunas dan Gagal serta dialog konfirmasinya]**
> *Gambar 9.5 — Menyelesaikan penarikan.*

### 6.7 Antrean refund (/hq/refunds)

**Tujuan:** Memutuskan refund bernilai besar. **Peran membaca:** Head office, Direktur, Finance. **Peran memutuskan:** Finance (dan Super admin). **Titik awal:** "Keuangan & harga" > "Refund". Judul "Persetujuan refund"; subjudul "Di atas {amount} butuh persetujuan HQ" (nilai dari server, bawaan Rp100.000 **[K]**). **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka halaman. Periksa tiap baris: "Pesanan {nomor}", metode, alasan pemohon, "{n} jam lalu", jumlah. | Lencana "{n} menunggu". Kosong: "Tidak ada refund menunggu persetujuan." |
| 2 | Tekan "Setujui". | **Satu klik tanpa konfirmasi**: refund langsung diselesaikan (metode online memanggil gerbang pembayaran). Toast "Refund {order} disetujui". Gagal: "Gagal memproses refund." |
| 3 | Atau tekan "Tolak". | Dialog "Tolak refund ini?" — "… alasannya wajib ditulis dan tercatat atas nama Anda." Isi "Alasan penolakan" (wajib). Tekan "Tolak". Toast "Refund {order} ditolak". Pembayaran tetap PAID. |

**Pengecualian:** Tombol "Tolak" tidak muncul untuk pesanan dibatalkan; tertulis "Pesanan dibatalkan — refund wajib dikembalikan" atau "Status pesanan tidak terbaca — coba muat ulang". Server: "Pesanan ini sudah dibatalkan, jadi refundnya tidak bisa ditolak — uang pelanggan harus dikembalikan."

**Siapa boleh apa:** Memulai refund (`refundIssue`) = Finance, Manajer, Super admin (tombol "Ajukan refund" di detail pesanan konsol depot). Memutuskan (`refundQueue`) = Finance dan Super admin saja. Head office dan Direktur melihat tombol "Setujui"/"Tolak" tetapi server menolak **[B]**. Pesan bila sudah diputuskan: "This refund is not awaiting approval." (belum ada keputusan baru diperlukan).

**Maker-checker refund [B]:** pemisahan hanya lewat peran. Tidak ada pengecekan "pemohon berbeda dari penyetuju" di kode. Finance memegang kedua hak sehingga dapat memulai lalu menyetujui refund yang sama. **Kendalikan lewat kebiasaan kerja**: Finance tidak menyetujui refund yang ia mulai sendiri; Direktur atau pimpinan meninjau berkala di log audit.

> **[SCREENSHOT REQUIRED: SS-hq-06 — /hq/refunds dengan satu baris refund, dan dialog "Tolak refund ini?" berisi kolom Alasan penolakan]**
> *Gambar 9.6 — Antrean refund.*

### 6.8 Aplikasi (lamaran) waralaba (/hq/applications)

**Tujuan:** Meninjau calon mitra waralaba. **Peran:** Head office, Direktur (Finance tidak). **Titik awal:** "Waralaba" > "Lamaran waralaba". **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka daftar. | Antrean TERLAMA dahulu, 100 per halaman + "muat lagi". Kartu: nama pelamar, tahap (Baru / Verifikasi dokumen / Survei / Disetujui / Ditolak), umur "{n} hari" (merah bila 5 hari atau lebih), nama depot usulan, kota · telepon. Lencana "{n} menunggu". Kosong: "Tidak ada lamaran menunggu." |
| 2 | Tekan "Tinjau". | Detail: "Usulan depot", "Kontak", "Investasi", "Proyeksi omzet/bln", dan "Kelengkapan dokumen". |
| 3 | Untuk tiap butir ("KTP & NPWP terverifikasi", "Bukti kepemilikan lokasi", "Setoran modal awal", "Survei lapangan") klik tombol status. | Status **berganti tiap klik**: Menunggu → Terverifikasi → Ditolak → Menunggu. Lencana "Lengkap" muncul bila keempatnya terverifikasi. |
| 4 | Di "Ubah tahap" pilih Baru / Verifikasi dokumen / Survei. | Tahap berpindah bebas maju-mundur. |
| 5 | Putuskan: "Setujui & provision" atau tombol merah "Tolak". | **Tanpa konfirmasi dan tanpa kolom alasan.** Setuju: toast "Lamaran {name} disetujui — lanjut provision depot", tahap Disetujui, dan layar membuka `/hq/depots?onboard=1` dengan form terisi sebagian. Tolak: toast "Lamaran {name} ditolak", kembali ke daftar. |

**Hal penting [V]:**
- Lencana "Lengkap" hanya petunjuk; server TIDAK mewajibkan checklist lengkap sebelum menyetujui.
- Keputusan **final**. Pesan: "This application has already been approved or rejected." (lamaran sudah disetujui atau ditolak). Tombol nonaktif pada tahap Disetujui atau Ditolak.
- Menyetujui hanya mengubah tahap. Akun pemilik dan depot BELUM dibuat. Langkah lanjutan: (1) undang akun Pemilik waralaba (bagian 6.4; Head office bisa), lalu (2) simpan form "Onboard depot" (bagian 6.3; butuh Manajer atau Super admin). Data nama dan telepon pelamar tidak ikut terbawa ke form, dan data awal hanya tersimpan di tab browser itu; bila Anda berpindah halaman, data hilang. **[D]**
- Cara pelamar diberi tahu keputusan tidak ditemukan di kode (diduga manual lewat WhatsApp). **[K]**
- Formulir publik pelamar (/waralaba) tidak mengunggah dokumen; cara pelamar menyerahkan bukti belum diketahui. **[K]**

> **[SCREENSHOT REQUIRED: SS-hq-07 — /hq/applications/detail dengan checklist "Kelengkapan dokumen", panel "Ubah tahap", tombol "Setujui & provision" dan "Tolak"]**
> *Gambar 9.7 — Meninjau lamaran waralaba.*

### 6.9 Ikhtisar waralaba (/hq/franchise)

**Peran:** Head office, Direktur, Finance (Finance: perlu verifikasi di lingkungan nyata, bagian 15.1). **Hanya BACA** dengan tombol "Buka depot". Header "Jaringan waralaba"; lencana "{n} depot" dan merah "{n} tanpa pemilik"; kartu "Menunggu rilis ke pemilik". Baris per depot: nama, kode, "Nonaktif", pemilik atau "Belum ada pemilik — pendapatan depot ini tidak terbukukan" (merah) atau "Pemilik di luar daftar staf", "komisi {n}%" atau "komisi belum diatur", " · menunggu rilis" + jumlah. Kosong: "Belum ada depot waralaba." **[V]**

Untuk Finance, halaman ini adalah pendaratan tetapi memuat daftar depot yang butuh hak `depotDirectory`; kemungkinan tampil galat penuh. **[B][D]**

### 6.10 Keputusan harga jaringan (/hq/pricing)

**Tujuan:** Menyetujui atau menolak usulan override harga dari depot. **Peran:** Head office, Direktur (dan Super admin). **Titik awal:** "Keuangan & harga" > "Harga jaringan" (judul "Tata kelola harga"). **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Lihat kartu "Harga dasar jaringan": Produk, Harga dasar, Override ("{n} override" = usulan menunggu). | Hanya 50 produk pertama yang tampil **[B]**. |
| 2 | Di kartu "Override menunggu" baca: produk, "Diusulkan {who} · {depot}", catatan, harga "Sekarang" (dicoret) → "Usulan". | Kosong: "Tidak ada usulan menunggu." |
| 3 | Tekan "Setujui" atau "Tolak" (merah). | **Tanpa dialog dan tanpa alasan.** Toast "Override {product} disetujui" / "ditolak". Setuju membuat aturan harga aktif prioritas 100 untuk depot itu. Tolak mencatat audit tanpa mengubah harga. |

**Aturan empat mata:** Bila penyetuju adalah pengusul sendiri DAN dampak melebihi batas auto-pass depot (bawaan Rp100.000), server menolak: "Usulan ini Anda sendiri yang mengajukan dan nilainya di atas batas auto-pass. Persetujuan harus dari HQ." Usulan tetap menunggu. Keputusan ulang: "This price-override proposal has already been approved or rejected." **[V]** Catatan layar: "Prioritas tertinggi menang saat aturan tumpang tindih."

**Batasan:** Tombol "＋ Aturan baru" membuka /hq/forms/pricing-rule yang butuh hak Manajer atau Super admin; bagi Head office dan Direktur tampil "Khusus HQ". Usulan override dibuat Manajer depot di konsol depot atau lewat impor harga CSV ("Setiap baris menjadi usulan override harga dan tetap menunggu persetujuan HQ — tidak langsung berlaku.").

> **[SCREENSHOT REQUIRED: SS-hq-08 — /hq/pricing kartu "Override menunggu" dengan harga Sekarang dan Usulan serta tombol Setujui dan Tolak]**
> *Gambar 9.8 — Keputusan override harga.*

### 6.11 Voucher (/hq/vouchers)

**Peran:** Head office, Direktur (Finance tidak). **Hanya BACA.** **[V]**

- Judul "Tata kelola voucher": kartu "Belanja voucher jaringan" ("Total diskon terpakai" dan "{n} voucher aktif") dan daftar "Voucher aktif" (kode, deskripsi, "{n} terpakai", bilah kemajuan, "Terpakai: Rp…"). Hanya 50 voucher pertama. Kosong: "Belum ada voucher aktif."
- **Permintaan voucher TIDAK ADA lagi.** Antrean persetujuan voucher depot ke HQ dihapus atas keputusan pemilik pada 2026-09-04 (CA-2-42). Manajer depot membuat voucher depotnya sendiri; HQ hanya memantau. Kapabilitas `voucherRequestDecide` masih terdaftar di matriks tetapi tidak dipakai layar atau kontroler mana pun. Jangan mencari tombol "putuskan permintaan voucher". **[V]**
- Tombol "＋ Voucher baru" menuju /hq/forms/voucher yang butuh hak Marketing, Manajer, atau Super admin. Bagi Head office, Direktur, dan Finance tampil "Khusus HQ".

### 6.12 Rekonsiliasi (/hq/reconciliation)

**Tujuan:** Membaca rincian penjualan ke net payout untuk satu depot. **Peran:** Head office, Direktur, Finance (Finance: perlu verifikasi, bagian 15.1). **Titik awal:** "Keuangan & harga" > "Rekonsiliasi". **BACA + unduh.** **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Pilih depot di "Pilih depot" (bawaan depot pertama). | Kartu "Rekonsiliasi · {depot}" untuk "Periode 30 hari terakhir". |
| 2 | Baca baris: "Total penjualan"; "Biaya platform (x%)" (negatif); "Ongkir tertagih (sudah termasuk total penjualan)" (catatan, bukan penjumlah); "Refund periode ini" (negatif); "Dasar komisi (barang sebelum diskon)" (catatan); "Komisi waralaba (x%)" (negatif; atau "Komisi (belum ada skema)" / "Komisi (skema tidak terbaca)"); "Deposit galon" (negatif); bilah hijau "Net payout ke pemilik". | Net = penjualan − biaya platform − komisi − refund − deposit galon. Nilai tak terbaca ditulis "—" (bukan nol). Tanpa data: "Belum ada data penjualan untuk depot ini." |
| 3 | Tekan "Unduh XLSX". | Berkas `rekonsiliasi-{kodeDepot}.xlsx`, sheet "Rekonsiliasi", kolom "Komponen" dan "Jumlah (IDR)". Toast "Berkas rekonsiliasi terunduh" atau "Gagal membuat berkas." Sel tak diketahui dikosongkan, bukan 0. |

**Temuan [B][V]:** "Biaya platform" hanya dibaca bila peran memegang `depotAdmin` (Manajer, Super admin). Bagi Head office, Direktur, dan Finance nilainya "—", sehingga **"Net payout ke pemilik" selalu "—"**. Jangan mengambil kesimpulan "nol" dari tanda ini. Komisi dihitung dari subtotal barang sebelum diskon, bukan total penjualan.

### 6.13 Laba rugi jaringan (/hq/pnl)

**Peran:** Head office, Direktur. **Hanya BACA, tanpa unduhan.** **[V]**

- Header "Laba rugi jaringan" ("Per depot, {bulan}"), lencana "Laporan manajemen", pemilih "Pilih bulan" (12 bulan terakhir).
- Tabel: Depot | Omzet | Barang | Gaji & tunjangan | Komisi kurir | Klaim biaya | Pengembalian | Laba bersih; baris "Jaringan" (total).
- Biaya hanya dari yang tercatat (tanpa sewa dan listrik; keputusan pemilik 2026-09-04). Sel tak terbaca ditulis "—" dan tidak dihitung nol; peringatan "Sebagian angka tidak bisa dibaca bulan ini ({sources}), jadi ditulis "—" dan tidak dihitung sebagai nol."
- Disclaimer server (Bahasa Inggris, **[B]**): "Operational management report only; not statutory accounting or a tax statement." Artinya: hanya laporan manajemen operasional, bukan akuntansi resmi atau pernyataan pajak.
- Kosong: "Belum ada depot untuk dilaporkan."

### 6.14 Ekspor laporan pendapatan (/hq/reports/export)

**Tujuan:** Mengunduh laporan pendapatan. **Peran:** Head office, Direktur. **Titik awal:** "Keuangan & harga" > "Ekspor laporan". **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Pilih rentang: "7 hari", "30 hari" (bawaan), "Kuartal" (90 hari), atau "Kustom" (isi "Dari" dan "Sampai"). | — |
| 2 | Pilih "Kelompokkan per": "Depot", "Produk", atau "Metode". | "Pratinjau": tabel kolom Nama, Pesanan, Pendapatan. |
| 3 | Pilih "Format": XLSX, CSV, atau PDF. Tekan "Ekspor laporan". | Berkas `pendapatan-{depot atau product atau method}-{dari}_{sampai}.{ext}`; sheet XLSX "Pendapatan". Produk: maksimal 50 teratas. |

**Pesan:** "Tidak ada data pada rentang ini." (toast); untuk kelompok Depot bila sumber tidak lengkap: "Laporan pendapatan per depot belum lengkap: sebagian depot tidak masuk laporan sumbernya, jadi angkanya akan salah. Ekspor ditahan sampai sumbernya utuh." (ekspor ditolak, bukan dipotong); "Gagal membuat berkas." Ekspor manual dari layar ini tidak tercatat di "Log ekspor data". **[D]**

### 6.15 Laporan terjadwal dan Log ekspor data (/hq/scheduled-reports, /hq/exports)

**Peran:** Head office, Direktur. BACA + TULIS. **[V]**

### Prosedur: Membuat laporan terjadwal

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka /hq/scheduled-reports > "＋ Jadwal baru". | Panel "Buat laporan terjadwal". |
| 2 | Isi "Nama" (contoh "Ringkasan pendapatan harian"), "Penerima" (pisah koma, minimal satu), "Irama" (Harian / Mingguan / Bulanan), "Isi laporan" (Pendapatan per depot / per produk / per metode bayar), "Format" (XLSX / CSV / PDF). | Tombol kirim aktif setelah nama dan penerima terisi. Penerima tidak divalidasi sebagai email. **[V]** |
| 3 | Tekan tombol "＋ Jadwal baru" (kirim). "Batal" menutup. | Toast "Jadwal laporan dibuat". |
| 4 | Gunakan sakelar "Aktif"/"Nonaktif" untuk menjeda; ikon sampah "Hapus" → dialog "Hapus jadwal?" — "Jadwal "{name}" akan dihapus permanen." | Toast "Jadwal "{name}" diperbarui" / "Jadwal laporan dihapus". |

**Perilaku [V]:** periode yang dilaporkan adalah periode LENGKAP sebelumnya (harian = kemarin; mingguan = minggu Senin–Minggu sebelumnya; bulanan = bulan sebelumnya; batas UTC). Pemicu berjalan tiap jam (menit ke-17). Berkas **tidak dikirim lewat email**: catatan layar "Berkas dibuat otomatis dan diunduh dari HQ › Ekspor. Belum dikirim lewat email." Jalan terakhir gagal ditandai merah "Jalan terakhir GAGAL — berkasnya tidak terbentuk · {pesan}".

**Log ekspor data (/hq/exports):** chip "Semua" | "Selesai" | "Proses" | "Gagal"; tabel Dataset | Oleh | Format | Baris | Status | Berkas (tombol "Unduh"). Maksimal 100 entri, terbaru dahulu. Kosong "Belum ada ekspor."; galat "Gagal memuat log ekspor."; "Gagal mengunduh berkas."; "Berkas ekspor tidak tersedia."

### 6.16 Pajak, faktur, dan template faktur (/hq/tax, /hq/invoice-template)

**Tujuan:** Mengatur PPN dan identitas perusahaan di faktur. **Peran:** Head office dan Finance (Direktur tidak). **Titik awal:** "Keuangan & harga" > "Pajak & faktur". **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Isi "PPN (%)" (0–100; kosong atau bukan angka dibaca 0). | — |
| 2 | Isi "Format nomor faktur" (maksimal 64 karakter; petunjuk "Token: {YYYY} tahun · {MM} bulan · {NNNN} urutan."). | Lihat catatan token di bawah. |
| 3 | Atur sakelar "Harga sudah termasuk pajak". | "Jika aktif, PPN dihitung dari harga jual, bukan ditambahkan." |
| 4 | Isi "Nama perusahaan" (≤160), "NPWP" (≤64), "Alamat" (≤255). Tekan "Simpan pengaturan". | Toast "Pengaturan pajak disimpan". Gagal: "Gagal menyimpan pengaturan pajak." Bila orang lain menyimpan lebih dulu, layar dimuat ulang dengan "Orang lain sudah mengubah data ini sejak Anda membukanya. Layar dimuat ulang — periksa lalu simpan lagi." |

**Fakta penting [V][K]:** Bawaan PPN = 0 (bisnis bukan PKP; keputusan pemilik 2026-09-04). Blok pajak dan NPWP pada faktur hanya tampil bila PPN lebih dari 0. Format nomor faktur hanya memengaruhi pratinjau; faktur pesanan nyata memakai NOMOR PESANAN. **Jangan menjanjikan penomoran faktur otomatis.** Petunjuk layar menyebut `{NNNN}`, sedangkan bawaan server `HM/{YYYY}/{MM}/{SEQ}` **[B]**. Dokumen hukum internal mencatat belum ada faktur pajak/e-Faktur; berlaku selama depot bukan PKP. **[K]**

**Template faktur (/hq/invoice-template):** BACA + tombol "Cetak" (cetak browser). Pratinjau memakai pesanan nyata terbaru bila terbaca; selain itu lencana "Contoh". Stempel "LUNAS" hanya bila pembayaran PAID, selain itu "Belum lunas · {status}". Tidak ada PDF faktur dari server.

### 6.17 Operasi harian: inventori, retur galon, roster, pesanan, notifikasi

**Peran:** Head office, Direktur (Finance tidak). **[V]**

| Layar | Rute | Isi | Aksi |
|---|---|---|---|
| Inventory jaringan | /hq/inventory | Kartu per depot aktif: "{n} lini", "{n} menipis"; lencana "{n} depot kritis" atau "Semua depot sehat". Tautan "Restok" hanya membuka detail depot (bukan form restok; stok diubah di konsol depot). | BACA |
| Retur galon | /hq/returns | "Total galon beredar", "Total deposit tertahan"; tabel kolom Depot, Galon beredar, Deposit tertahan. Hanya 100 depot pertama **[B]**. | BACA |
| Roster kurir | /hq/roster | Kolom Kurir, Depot, Beban ("{n} tugas"), Status (Mengantar / Tersedia / Istirahat / Belum buka shift). Kosong "Belum ada kurir aktif." | BACA |
| Pesanan | /hq/orders, detail /hq/orders/detail?id= | Tab "Semua" dan "Belum terutuk" (pesanan lama tanpa depot). Kolom: No. pesanan, Pelanggan, Status, Total, pemilih depot. 50 baris per halaman. | Menugaskan atau memindahkan depot |
| Notifikasi | /hq/notifications | Aliran operasi. | "Tandai dibaca", "Tandai semua dibaca" |

**Menugaskan depot pada pesanan:** pada baris pesanan pilih depot di "Pilih depot…" (pesanan tanpa depot) atau "Pindahkan ke depot lain…". Pilihan **langsung tersimpan tanpa konfirmasi**. Pindah depot melepas stok depot lama dan menahan stok depot baru. Untuk pesanan tanpa depot, cek ketersediaan stok dulu ("stok belum di-reserve"). Galat server tampil apa adanya (misalnya stok kurang atau status pesanan terlalu lanjut). **[V]** Status pesanan di layar berbahasa Inggris **[B]**: Order placed, Confirmed, Preparing, Driver assigned, Picked up, On the way, Delivered, Completed; di luar alur: Cancelled, Voided at the counter. HQ hanya menugaskan depot, tidak mengubah status pesanan, dan tidak ada tombol refund di /hq/orders.

### 6.18 Analitik, peringkat, bandingkan, dan prakiraan

**Peran:** Head office, Direktur. Semua BACA kecuali Model prakiraan. **[V]**

- **Analitik jaringan (/hq/analytics):** "Tren pendapatan · 6 bulan", "Pendapatan per produk" (8 teratas), "Retensi cohort".
- **Peringkat depot / Scorecard (/hq/scorecard):** 30 hari. Skor komposit = bobot pendapatan (setelan `scorecardRevenueWeightPct`, bawaan 70) + sisanya SLA. Teks layar "Skor komposit = 70% pendapatan + 30% SLA." statis walau bobot diubah **[B]**. Kolom: peringkat, nama, "Pesanan", "SLA", "Pendapatan".
- **Bandingkan depot (/hq/compare):** pilih 2–3 depot ("Maksimal 3 depot.", "Pilih minimal 2 depot untuk membandingkan."); baris Pendapatan, Pesanan, SLA tepat waktu, Rata antar, Rating, Retur galon; lencana "Terbaik". Hanya 100 depot pertama.
- **Prakiraan permintaan (/hq/forecast):** 12 produk pertama, horizon 14 hari: "Prediksi (14h)", "Saat ini", "Keyakinan". Tombol "Muat ulang". Membangun ulang model dilakukan di /hq/health (hanya Super admin).
- **Model prakiraan (/hq/forecast-models):** BACA + TULIS. Pilih "Cakupan" (Global atau Depot). Tiap penyetel: "Simpan" atau "Kembalikan". Cakupan GLOBAL hanya Super admin ("Hanya SUPER_ADMIN yang boleh menulis cakupan GLOBAL."). Head office dan Direktur boleh menulis override per depot (kolom "ID depot" diketik manual). Toast: "Model tersimpan.", "Override dihapus; kembali ke cakupan induk.", "Belum ada yang diubah.", "Pilih depot dulu." Petunjuk: ukur dulu sebelum mengganti; menang di satu depot bukan alasan mengganti semua.

### 6.19 Pelanggan dan pemasaran (churn, kampanye, promosi, Customer 360)

**Peran:** Head office, Direktur. Layar ini terutama BACA; tombol tulis tampil tetapi ditolak server **[B][V]**.

| Layar | Isi | Tombol yang ditolak server |
|---|---|---|
| Churn & retensi (/hq/churn) | Kartu cohort "Aktif", "Melambat", "Berisiko", "Churned". | "Re-engage" (butuh `campaignWrite`; hanya Marketing dan Super admin). Pesan gagal: "Gagal mengirim pesan reaktivasi." |
| Kampanye (/hq/campaigns) | Wizard "Segmen" > "Pesan" > "Kirim"; "Estimasi penerima". | "Buat kampanye" dan kirim (butuh `campaignWrite`). Gagal: "Gagal membuat kampanye." |
| Promosi & banner (/hq/promotions) | Daftar slot carousel beranda. | "＋ Banner", "Edit", "Hapus" (butuh `promotionWrite`). Gagal: "Gagal menyimpan banner." |
| Aturan promo (/hq/promo-rules) | Daftar aturan dan simulator "Coba rule". | Tombol "＋ Aturan baru" TIDAK ditampilkan untuk Head office dan Direktur (disaring). |
| Customer 360 (/hq/customers) | Isi "Nomor telepon…" lalu "Cari": Profil, Loyalti, Pesanan terbaru, Nilai seumur hidup. | "Beri poin" (butuh `loyaltyAdjust`: Manajer, Marketing, Super admin). Direktur umumnya melihat "Data loyalty tidak bisa dibaca sekarang — ini bukan berarti belum punya akun." |

Pesan "Riwayat pesanan tidak bisa dibaca sekarang — ini BUKAN berarti nol." berarti sumber data gagal, bukan pelanggan tanpa pesanan. Pelanggan hanya dicari dengan nomor telepon persis.

### 6.20 Katalog produk (/hq/catalog)

**Tujuan:** Mengelola produk dan kategori. **Peran:** Head office (Direktur dan Finance tidak). **Titik awal:** "Katalog & harga" > "Katalog produk". **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Tekan "＋ Produk" (atau "Edit" pada produk). | Form "Produk baru" / "Edit produk". |
| 2 | Isi "Nama produk" (wajib), "SKU", "Satuan" (bawaan pcs), "Isi (ml)", "Foto produk" (JPG/PNG/WebP, maksimal 5 MB), centang "Galon isi ulang", "Harga dasar" (0 atau lebih), "Kategori", "Deskripsi", "Aktif" (hanya saat edit). | Pesan wajib: "Nama wajib diisi.", "Harga harus 0 atau lebih." |
| 3 | Tekan "Buat produk" / "Simpan". | Toast "Produk disimpan." |

**Peringatan layar yang perlu dipatuhi:** (a) Satuan menyebut "galon" tetapi centang galon isi ulang kosong: ongkir per galon dihitung dari centang, sehingga produk tidak akan kena ongkir. (b) "Isi (ml)" kosong: produk belum ikut dalam rekonsiliasi meteran air. "Riwayat harga dasar" mencatat siapa mengubah. Perubahan harga dasar tidak melalui antrean persetujuan.

**Kategori:** "＋ Kategori" ("Nama kategori", "Slug URL" huruf kecil dan tanda hubung), "Ubah", "Nonaktifkan"/"Aktifkan". **Impor:** /hq/catalog/import ("Import Katalog Produk"; kolom sku*, name*, unit*, basePrice*, categorySlug, volumeMl, isGallon, description; SKU yang sudah ada dilewati) dan /hq/catalog/import-categories. Maksimal 500 baris. Peran lain melihat "Impor massal tidak tersedia untuk peran ini". Alur sama seperti bagian 6.5.

### 6.21 Loyalty dan langganan galon

- **Program loyalti (/hq/loyalty):** hanya Marketing dan Super admin; tidak tersedia bagi Head office, Direktur, Finance. **[V]**
- **Langganan galon (/hq/subscriptions):** BACA untuk Head office dan Direktur. Dua sistem terpisah, "Langganan pelanggan" dan "Langganan dibuat depot"; jumlahnya bukan satu populasi. Kolom Produk, Frekuensi, "{n} pelanggan"; "Est. pengantaran / bln". Kosong "Belum ada langganan aktif." **[V]**

### 6.22 Skema komisi (/hq/forms/commission)

**Tujuan:** Menetapkan persentase komisi HQ per depot. **Peran melihat:** Head office, Direktur, Finance. **Peran menerapkan:** Finance dan Super admin. **Finance: perlu verifikasi di lingkungan nyata.** **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka halaman. Lihat kolom "Depot", "Saat ini" (persen atau "Belum diatur"), dan "Baru". | Maksimal 100 depot pertama. |
| 2 | Isi "Baru" (0–100) pada depot yang berubah dan "Tanggal berlaku" (bawaan hari ini; tanggal masa depan = terjadwal). | Hanya baris yang berubah dan 0–100 yang dikirim; nilai di luar rentang atau sama diabaikan diam-diam. |
| 3 | Tekan "Terapkan skema baru". | Sukses "Skema komisi baru diterapkan." Tanpa perubahan: "Tidak ada perubahan untuk diterapkan." Gagal: "Gagal menerapkan skema komisi." |

Server: "Commission percentage must be between 0 and 100." (persentase harus 0–100). Subjudul layar berbunyi "Persentase payout per depot", padahal persentase ini adalah komisi HQ yang dipotong dari penjualan **[B]**. Head office dan Direktur melihat tombol tetapi ditolak. Untuk Finance, halaman memuat daftar depot lewat hak yang tidak dimilikinya; kemungkinan tampil galat penuh **[B][D]**.

### 6.23 Insiden (/hq/incidents)

**Peran:** Head office, Direktur. BACA + TULIS. Insiden adalah catatan manual, bukan alarm otomatis. **[V][D]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Tekan "＋ Insiden baru". Isi "Judul" (wajib, ≤200), "Layanan terdampak" (wajib, ≤120, contoh "payment-service"), "Tingkat" (Kritis / Peringatan / Info), "Catatan awal" (opsional, ≤2000). Tekan "Buka insiden". | Toast "Insiden dibuka". |
| 2 | Pada kartu insiden isi "Tambah pembaruan linimasa…" (1–2000 karakter), tekan "Tambah". | Toast "Insiden diperbarui". |
| 3 | Tekan "Tandai selesai". | Toast "Insiden ditandai selesai". Status Berlangsung → Selesai. |

Filter chip: "Semua" | "Berlangsung" | "Selesai". Kosong "Tidak ada insiden."; galat "Gagal memuat insiden." / "Gagal menyimpan perubahan."

### 6.24 Tiket dukungan (/hq/tickets)

**Peran:** Head office, Direktur. BACA + TULIS. **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Pilih filter "Semua" / "Terbuka" / "Ditugaskan" / "Selesai" dan "Saring per depot". | Kartu: subjek, pelanggan, prioritas (Tinggi/Sedang/Rendah), status. |
| 2 | Tekan "Lihat percakapan". Tekan "Assign ke saya". | Toast "Tiket ditugaskan ke kamu". |
| 3 | Tulis di "Tulis balasan…", tekan "Kirim". | Toast "Balasan terkirim" (hanya selama belum Selesai). |
| 4 | Tekan "Tandai selesai". | Toast "Tiket "{subject}" ditandai selesai". |

**Membuat tiket atas nama pelanggan:** "Tiket baru" → "Ringkasan keluhan" (wajib, ≤200), "Nama pelanggan (boleh nama panggilan)" (wajib), "Nomor HP pelanggan" (wajib), "Nomor pesanan (opsional)", "Apa yang disampaikan pelanggan" (wajib, ≤2000) → "Buat tiket" → toast "Tiket dibuat." Apakah balasan staf sampai ke pelanggan lewat saluran luar belum diketahui; pelanggan melihat "Balasan Hydromart" di aplikasi. **[K]**

### 6.25 Fraud dan risiko (/hq/fraud)

**Peran:** Head office, Direktur. BACA + TULIS. **[V]**

- Chip "Semua" | "Terbuka" | "Ditinjau" | "Diblokir" | "Aman". Kartu: jenis (Pesanan/Akun), referensi, tingkat risiko, "Skor risiko", "Sinyal".
- Tombol (hanya pada status Terbuka atau Ditinjau): "Tinjau" (→ Ditinjau), "Blokir" (→ Diblokir), "Tandai aman" (→ Aman). **Tanpa konfirmasi dan tanpa alasan.** Untuk jenis Akun, "Blokir" MENONAKTIFKAN login akun itu; "Tandai aman" mengaktifkannya lagi kecuali masih ada blokir lain atas akun yang sama.
- Kosong "Tidak ada item berisiko." Sumber: pemindaian harian "refund berulang" yang hanya menandai untuk ditinjau, tidak memblokir sendiri. **[V]**

**Peringatan:** Blokir akun berdampak langsung pada orang. Baca "Sinyal" dan konfirmasi dengan Direktur bila ragu sebelum menekan "Blokir".

### 6.26 Onboarding depot (/hq/onboarding)

**Peran:** Head office, Direktur. Hanya BACA. Pilih depot ("Pilih depot") untuk melihat "{done}/{total} langkah selesai". Kesiapan DITURUNKAN dari data depot, stok, staf, dan setelan pembayaran, bukan dicentang manual. Langkah: Verifikasi dokumen legal, Survei lokasi & radius layanan, Provision depot di sistem, Isi jam operasional, Tetapkan pemilik waralaba, Isi stok awal & harga, Onboarding staf & kurir, Aktifkan kanal pembayaran. Tombol "Buka" menuju layar terkait; tautan ke /hq/catalog dan /hq/staff berakhir "Khusus HQ" bagi Direktur. **[V]**

### 6.27 Log audit (/hq/audit)

**Tujuan:** Meninjau jejak tindakan lintas layanan. **Peran:** Head office, Direktur. **Titik awal:** "Sistem" > "Log audit". **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka halaman. | Kolom Pelaku, Peran, Objek, Aksi, Waktu ("Sistem" bila otomatis); 100 baris per halaman + muat lagi. Catatan: "Log bersifat append-only — tidak bisa diubah atau dihapus." Kosong: "Belum ada aktivitas." |
| 2 | Tekan "Ekspor". | Berkas `audit-{YYYY-MM-DD}.xlsx` (sheet "Audit") berisi SELURUH jejak. Bila terlalu besar: "Jejak audit terlalu besar untuk diekspor utuh. Persempit dulu rentang atau saringannya — berkas sepotong lebih berbahaya daripada tidak ada berkas." |

**Gap [B]:** layar **tidak punya saringan atau pencarian** (tanggal, pelaku, aksi); pesan di atas menyarankan menyaring padahal kontrolnya tidak ada. Catatan "tidak bisa dihapus" berlaku untuk pengguna; baris dapat dibersihkan oleh sapuan retensi setelah masa simpan (batas bawah 365 hari). **[V]** Kegagalan menulis audit tidak menghalangi aksi (hanya dicatat di log server). Di konsol depot ada "Jejak audit" (/dashboard/audit) berfilter kategori per depot, dan di HR ada "Log Audit" (/hr/audit) tersendiri.

### 6.28 Kesehatan sistem dan Kebijakan SLA

- **Kesehatan sistem (/hq/health):** Head office dan Direktur. Ringkasan "{up}/{total} layanan operasional"; tabel Layanan | Status ("Operasional"/"Mati") | Latensi. Kartu "Sapuan terjadwal" (status "Jalan", "Gagal", "Terlambat", "Belum pernah jalan", "Sengaja dimatikan"; "{n} dari {total} sapuan bermasalah"). Kartu "Antrean efek pesanan" ("Tiriskan sekarang") dan "Bangun ulang read model" HANYA tampil bagi Super admin. Galat "Status layanan tidak bisa dimuat." **[V]**
- **Kebijakan SLA (/hq/sla-policy)** **[B]:** server mengizinkan Head office dan Direktur, tetapi rail dan layar memakai hak Manajer/Super admin sehingga keduanya tidak dapat menjangkaunya. Eskalasikan ke Admin bila perlu mengubah SLA. Ambang SLA di Ringkasan jaringan (88%) adalah angka tetap di kode, terpisah dari kebijakan ini.

### 6.29 Permintaan data pribadi (UU PDP) (/hq/pdp)

**Tujuan:** Menjawab hak subjek data: salinan data atau penghapusan akun pelanggan. **Peran:** Head office (dan Super admin). **Direktur dan Finance TIDAK** (disengaja). **Titik awal:** "Sistem" > "Permintaan data (UU PDP)"; judul "Permintaan data pribadi". **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Pilih filter "Menunggu" atau "Semua". | Baris: jenis ("Minta salinan data" / "Hapus akun"), status (Menunggu / Selesai / Ditolak), "Pelanggan {nama}", "Diminta {tgl}", "Batas jawab {tgl}" atau merah "LEWAT BATAS 3x24 jam". |
| 2a | Salinan data: tekan "Setujui". | File JSON terunduh otomatis; "Salinan data siap diunduh." (tombol "Unduh JSON"). Pelanggan hanya bisa mengunduh dalam 7 hari sejak disetujui. |
| 2b | Hapus akun: tekan "Setujui". | Dialog dengan peringatan "Menyetujui penghapusan bersifat permanen: identitas pelanggan dihapus, data keuangan tetap disimpan tanpa pemilik (retensi 10 tahun)." Konfirmasi → toast "Permintaan disetujui." |
| 2c | Tolak: tekan "Tolak", isi "Alasan penolakan (akan dibaca pelanggan)" (wajib). | Toast "Permintaan ditolak." |

**Pesan:** "Gagal memproses permintaan."; server: "Permintaan ini sudah diputuskan." (sudah final), "Permintaan tidak ditemukan." Bila penghapusan gagal di tengah, permintaan tetap Menunggu dan bisa diulang. **Batas jawab 72 jam (3x24 jam) dihitung dari saat permintaan dibuat**; halaman publik menjanjikan "sejak diverifikasi" sehingga ada selisih tafsir **[B]**. Tidak ada peringatan otomatis untuk yang terlambat. Kartu di bawah daftar, "Ketertinggalan persetujuan", hanya untuk dibaca. Penghapusan akun STAF ditangani lewat HRD atau Super admin, bukan layar ini. Ekspor tidak memuat riwayat pesanan, pembayaran, dan saldo loyalti (disimpan sesuai retensi keuangan). Alamat email privasi di halaman publik perlu diperiksa sebelum dikutip karena dokumen go-live mencatat belum ada MX (2026-09-25). **[K]**

> **[SCREENSHOT REQUIRED: SS-hq-09 — /hq/pdp daftar "Menunggu" dengan lencana "LEWAT BATAS 3x24 jam" dan dialog konfirmasi penghapusan akun]**
> *Gambar 9.9 — Menjawab permintaan UU PDP.*

### 6.30 Buka kembali buku harian dan Batas auto-pass approval

Dua pengaturan ini dimiliki Head office, tetapi **tidak ada di /hq**; letaknya di konsol depot.

### Prosedur: Membuka kembali hari yang sudah ditutup

**Tujuan:** Membuka kembali buku harian depot setelah ditutup. **Peran:** Head office dan Super admin (`dailyCloseReopen`; Direktur dan Finance tidak). **Titik awal:** `/dashboard/reports` (Konsol depot > laporan), tab "harian". **[V]**

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka /dashboard/reports. Pilih depot di pemilih depot ("Pilih depot di switcher untuk melihat laporan operasional."). | Tab "harian" menampilkan tanggal laporan. |
| 2 | Lihat status di kanan atas tanggal. | Bila ditutup: lencana hijau "Buku ditutup", tombol "Buka kembali", dan keterangan "{n} entri masuk setelah tutup ({amount})". Bila belum: tombol "Tutup buku" (Kepala depot, Manajer, Head office, Direktur, Super admin). |
| 3 | Tekan "Buka kembali". | Buku terbuka lagi. Galat: "Gagal menutup buku." / "Status tutup buku tidak bisa dibaca." |

**Catatan:** Menutup bulan (`/dashboard/monthly-review`, "Tutup bulan"/"Buka bulan") dibatasi hak `depotFinance` yang bawaannya tidak dimiliki Head office; Head office tampaknya tidak dapat membukanya **[B][D]**.

### Prosedur: Mengubah "Batas auto-pass approval"

**Tujuan:** Mengatur nilai di bawah mana persetujuan (opname, refund deposit, selisih COD) lolos otomatis dan sekaligus ambang empat mata pada override harga. **Peran:** secara hak, Head office dan Super admin (`approvalThresholdWrite`); **secara praktis hanya Super admin** **[B][V]**. **Titik awal:** `/dashboard/settings` ("Pengaturan"), bagian "Depot & Galon".

| Langkah | Tindakan pengguna | Respons sistem yang diharapkan |
|---|---|---|
| 1 | Buka /dashboard/settings. Pilih cakupan "Default jaringan" atau "Depot tertentu". | Bagi peran selain Manajer dan Super admin tampil "Khusus manajer depot — Editor pengaturan hanya untuk manajer depot dan super admin." |
| 2 | Cari "Batas auto-pass approval" (Rp, 0–100.000.000, bawaan Rp100.000 **[K]**). Isi "Nilai", tekan "Simpan". "Ikut default" mengembalikan nilai bawaan. | Tersimpan dan tercatat di audit. Cakupan "Default jaringan" butuh Super admin: "Hanya SUPER_ADMIN yang dapat mengubah default global." |

**Mengapa Head office tidak bisa:** halaman diblokir untuk selain pemegang `depotAdmin`, dan server membutuhkan `depotAdmin` ditambah `approvalThresholdWrite`. Head office hanya memegang yang kedua. Minta Admin mengubahnya. Pengaju tidak boleh memutuskan persetujuannya sendiri.

> **[SCREENSHOT REQUIRED: SS-hq-10 — /dashboard/reports tab harian dengan lencana "Buku ditutup" dan tombol "Buka kembali"]**
> *Gambar 9.10 — Letak tombol Buka kembali.*

> **[SCREENSHOT REQUIRED: SS-hq-11 — /dashboard/settings baris "Batas auto-pass approval" dengan kolom Nilai, tombol Simpan dan Ikut default]**
> *Gambar 9.11 — Letak Batas auto-pass approval.*

### 6.31 Ringkasan status dan transisi

| Objek | Status (label layar) | Pemutus bawaan | Final? |
|---|---|---|---|
| Usulan override harga | Menunggu → Disetujui / Ditolak | Head office, Direktur | Ya |
| Refund | Menunggu → Disetujui (refund jalan) / Ditolak | Finance | Ya |
| Pengajuan rilis payout | Menunggu → Disetujui / Ditolak | Direktur, bukan pengaju | Ya |
| Penarikan payout | PROCESSING → PAID / FAILED | Finance | Ya |
| Rekening payout | PENDING → VERIFIED / REJECTED | Finance | Pendaftaran ulang mengembalikan ke PENDING |
| Lamaran waralaba | Baru ↔ Verifikasi dokumen ↔ Survei → Disetujui / Ditolak | Head office, Direktur | Ya |
| Tiket | Terbuka → Ditugaskan → Selesai | Head office, Direktur | — |
| Insiden | Berlangsung → Selesai | Head office, Direktur | — |
| Fraud | Terbuka → Ditinjau → Diblokir / Aman | Head office, Direktur | Tidak |
| Permintaan UU PDP | Menunggu → Selesai / Ditolak | Head office | Ya |

---

## 7. Kolom wajib dan aturan validasi (ringkasan)

| Layar | Kolom wajib | Aturan penting |
|---|---|---|
| Masuk | Nomor telepon; Kode OTP | OTP 6 digit; berlaku 300 detik; maksimal 5 salah; jeda kirim ulang 60 detik (bawaan). **[V]** |
| Onboard depot | Kode, Nama depot, Alamat, Kota, Provinsi, Latitude, Longitude, Ongkir; Pemilik waralaba bila Waralaba | Latitude −90..90; Longitude −180..180; Ongkir ≥ 0; Radius > 0 bila diisi; WhatsApp 8–15 digit. **[V]** |
| Undang staf | Nomor telepon, Peran; Posisi, Gaji (selain Pemilik waralaba); Depot untuk Staf depot dan Kepala depot | Gaji > 0; peran sesuai hak pemberi. **[V]** |
| Impor staf | phone, role, position, joinDate, employmentStatus, salaryType | Maksimal 500 baris; tanggal YYYY-MM-DD. **[V]** |
| Tolak refund | Alasan penolakan | Wajib; tercatat atas nama pengambil keputusan. **[V]** |
| Tolak permintaan UU PDP | Alasan penolakan | Wajib; dibaca pelanggan. **[V]** |
| Tangguhkan depot | Ketik kode depot persis | Tombol aktif hanya bila cocok. **[V]** |
| Jadwal laporan | Nama, Penerima (≥1) | Penerima tidak divalidasi sebagai email. **[V]** |
| Pajak | — (semua opsional) | PPN 0–100; format faktur ≤64; NPWP ≤64. **[V]** |
| Insiden | Judul, Layanan terdampak | Judul ≤200; layanan ≤120. **[V]** |
| Tiket baru | Ringkasan, Nama pelanggan, Nomor HP, Isi | Isi ≤2000. **[V]** |
| Produk | Nama produk | Harga dasar ≥ 0; foto ≤5 MB. **[V]** |

Aksi **tanpa konfirmasi dan tanpa alasan** **[B]**: menyetujui atau menolak lamaran waralaba, menyetujui atau menolak override harga, menyetujui refund, Blokir/Tinjau/Tandai aman pada fraud, mengaktifkan depot, menonaktifkan atau mengaktifkan akun staf, memilih depot pesanan, "Re-engage". Periksa dua kali sebelum menekan.

---

## 8. Kesalahan umum dan solusi

| Gejala atau pesan | Arti | Solusi |
|---|---|---|
| "Khusus HQ" | Peran Anda tidak memegang hak halaman itu. | Gunakan Indeks layar HQ untuk melihat apa yang boleh; minta Admin bila perlu akses. |
| Tombol ditekan lalu muncul penolakan atau "Gagal …" | Tombol tampil tetapi hak tulis tidak ada di peran Anda **[B]**. | Lihat tabel bagian 9.2; serahkan ke peran yang berwenang. |
| Layar galat penuh pada Pembayaran, Waralaba, Rekonsiliasi, Skema komisi (Finance) | Halaman memuat data dari layanan yang menolak Finance **[B][D]**. | Catat dan laporkan ke Admin (bagian 15.1). Jangan berbagi akun Admin sebagai jalan keluar. |
| "—" di kartu atau tabel | Data tidak terbaca, BUKAN nol. | Muat ulang; bila berulang, laporkan. |
| "Net payout ke pemilik" selalu "—" | Biaya platform tidak terbaca untuk peran Anda **[B]**. | Minta Manajer atau Admin membaca angka itu. |
| "Orang lain sudah mengubah data ini sejak Anda membukanya…" | Dua orang menyimpan bersamaan. | Periksa data baru lalu simpan ulang. |
| "This application has already been approved or rejected." | Lamaran sudah final. | Tidak ada tindakan; keputusan tidak bisa diubah. |
| "Pengaju pencairan tidak boleh menyetujui pengajuannya sendiri." | Maker-checker. | Minta Direktur atau Super admin lain. |
| "Peran {ROLE} hanya boleh diberikan oleh …" | Peran terbatas. | Minta Super admin (atau HR untuk Manajer). |
| "Gagal memuat …" / "Sebagian data gagal dimuat" | Satu layanan sumber gagal. | Muat ulang; lihat /hq/health. |
| Aktifkan depot tidak berefek | Server menolak dan layar tidak menampilkan pesan **[B]**. | Minta Manajer atau Super admin. |

---

## 9. Batasan peran

### 9.1 Yang TIDAK bisa dilakukan menurut nilai bawaan

| Peran | Tidak bisa | Butuh |
|---|---|---|
| Head office | Membuat, mengubah, menangguhkan depot | Manajer atau Super admin |
| Head office | Memberikan peran Super admin, Direktur, Finance, HR, Marketing, Manajer | Super admin (Manajer juga oleh HR) |
| Head office | Ajukan rilis payout, verifikasi rekening, Lunas/Gagal, putuskan refund, terapkan komisi | Finance atau Super admin |
| Head office | Setujui rilis payout | Direktur atau Super admin |
| Head office | Mengubah ambang persetujuan (praktis) | Super admin |
| Direktur | Mengelola staf, katalog, pajak, menjawab permintaan UU PDP | Head office atau Super admin |
| Direktur | Mengajukan rilis payout | Finance |
| Finance | Membuka Ringkasan jaringan, Pencarian, Direktori depot, Harga, Voucher, Operasi harian, Analitik, Audit, Kesehatan | Head office, Direktur |
| Semua | Mengubah matriks hak akses, hierarki, kunci API, webhook, feature flag, retensi, keamanan | Super admin (Bab 10) |
| Semua | Membuat voucher, aturan harga, kampanye, banner, program loyalti | Marketing, Manajer, atau Super admin |

### 9.2 Tombol yang tampil tetapi ditolak server **[B][V]**

| Layar | Tombol | Hak yang dibutuhkan | Ditolak untuk |
|---|---|---|---|
| Direktori depot | "＋ Onboard depot", "Edit", "Tangguhkan", "Aktifkan" | depotAdmin | Head office, Direktur |
| Pembayaran | "Ajukan rilis", "Verifikasi"/"Tolak" rekening, "Lunas"/"Gagal" | hqPayout | Head office, Direktur |
| Refund | "Setujui", "Tolak" | refundQueue | Head office, Direktur |
| Skema komisi | "Terapkan skema baru" | commissionRuns | Head office, Direktur |
| Churn | "Re-engage" | campaignWrite | Head office, Direktur |
| Kampanye | Buat dan kirim | campaignWrite | Head office, Direktur |
| Promosi & banner | Simpan, hapus | promotionWrite | Head office, Direktur |
| Customer 360 | "Beri poin" | loyaltyAdjust | Head office, Direktur |
| Aksi cepat (⌘K) | "Buat aturan harga", "Buat voucher", "Broadcast notifikasi" | berbagai | tampil "Khusus HQ" |
| Harga jaringan | "＋ Aturan baru" | depotAdmin | tampil "Khusus HQ" |
| Voucher | "＋ Voucher baru" | voucherWrite | tampil "Khusus HQ" |

Tidak ada data yang berubah ketika server menolak.

---

## 10. Pertimbangan keamanan

1. **Satu akun satu orang.** Jangan berbagi akun HQ atau meminjam akun Admin. Semua tindakan keuangan dan pengelolaan staf dicatat atas nama pemegang akun; berbagi akun menghapus akuntabilitas.
2. **Pemisahan tugas uang.** Payout: Finance mengajukan, Direktur menyetujui, Finance menutup (Lunas/Gagal). Server melarang pengaju menyetujui sendiri. Refund: pemisahan hanya lewat peran dan Finance memegang kedua sisi; tinjau berkala di log audit. **[B]**
3. **Verifikasi rekening dengan teliti.** Cocokkan nama pemilik dan nomor rekening sebelum "Verifikasi". Uang hanya mengalir ke rekening terverifikasi.
4. **Aksi tanpa konfirmasi.** Lihat bagian 7. Periksa dua kali.
5. **Data pribadi.** Customer 360, Pencarian, dan UU PDP menampilkan data pelanggan. Gunakan hanya untuk keperluan kerja; jangan menyalin ke aplikasi pribadi.
6. **Sesi.** Keluar ("Keluar") dari perangkat bersama. Batas menganggur bawaan 15 menit, ditegakkan saat token diperbarui. Akun yang dinonaktifkan masih dapat bertindak hingga sekitar 15 menit. **[V]**
7. **Tidak ada 2FA.** OTP telepon adalah satu-satunya faktor. Layar "Keamanan & 2FA" milik Admin tidak menambah faktor kedua. **[V]**
8. **Tidak ada rahasia di dokumen.** Jangan menuliskan OTP, kata sandi, atau kunci API di tiket, catatan insiden, atau chat.
9. **Hak dapat berubah.** Super admin dapat mengubah matriks; hak nyata dapat berbeda dari tabel.
10. **Laporan terjadwal tidak dikirim lewat email**; unduh dari /hq/exports dan simpan di tempat yang aman.

---

## 11. Kegiatan akhir hari dan berkala

| Frekuensi | Kegiatan | Bagian |
|---|---|---|
| Harian | Periksa Ringkasan jaringan: "Perlu perhatian", SLA di bawah ambang. | 6.1 |
| Harian | Antrean lamaran waralaba (umur ≥5 hari ditandai merah). | 6.8 |
| Harian | Antrean override harga menunggu. | 6.10 |
| Harian (Finance) | Antrean refund; rekening menunggu verifikasi; penarikan menunggu jawaban bank (Lunas/Gagal). | 6.6, 6.7 |
| Harian (Direktur) | Pengajuan rilis payout menunggu persetujuan. | 6.6 |
| Harian | Permintaan UU PDP: pastikan tidak ada "LEWAT BATAS 3x24 jam". | 6.29 |
| Harian | Insiden berlangsung, tiket terbuka, item fraud terbuka. | 6.23–6.25 |
| Mingguan | Kesehatan sistem: sapuan "Gagal"/"Terlambat". | 6.28 |
| Mingguan | Log ekspor data dan laporan terjadwal: cari "GAGAL". | 6.15 |
| Bulanan | Peringkat depot, laba rugi jaringan (pilih bulan), rekonsiliasi per depot. | 6.13, 6.12, 6.18 |
| Bulanan | Tinjau skema komisi dan depot waralaba "tanpa pemilik". | 6.22, 6.9 |
| Berkala | Tinjau log audit untuk aksi sensitif (refund, payout, peran staf). | 6.27 |
| Berkala | Pastikan tutup buku harian depot dilakukan; buka kembali hanya dengan alasan tercatat. | 6.30 |

---

## 12. Skenario praktis

**Skenario 1 — Mencairkan saldo satu pemilik waralaba.** Pemilik mendaftarkan rekening. Finance mencocokkan nama dan nomor lalu menekan "Verifikasi". Finance menekan "Ajukan rilis" pada pemilik tersebut. Direktur (bukan Finance) membuka Pembayaran, memeriksa "Diajukan oleh", lalu menekan "Setujui & rilis". Finance melakukan transfer di luar sistem, lalu menekan "Lunas" setelah dana masuk. Bila transfer gagal, tekan "Gagal" sehingga saldo kembali.

**Skenario 2 — Melayani lamaran waralaba.** Buka lamaran tertua. Klik tiap butir dokumen sampai "Terverifikasi". Ubah tahap sesuai proses. Tekan "Setujui & provision". Undang akun Pemilik waralaba di Direktori staf. Minta Manajer atau Admin menyelesaikan form "Onboard depot" (Head office dan Direktur akan ditolak server).

**Skenario 3 — Refund besar.** Manajer depot mengajukan refund melebihi ambang. Finance membuka Refund, membaca alasan, lalu "Setujui" atau "Tolak" dengan alasan tertulis. Untuk pesanan yang dibatalkan, refund harus dikembalikan; tombol "Tolak" tidak tersedia.

**Skenario 4 — Permintaan hapus akun pelanggan.** Head office membuka Permintaan data, melihat batas jawab, memeriksa pelanggan, menekan "Setujui" dan membaca peringatan permanen. Data keuangan tetap disimpan tanpa pemilik selama 10 tahun.

**Skenario 5 — Direktur ingin mengubah harga satu depot.** Direktur tidak dapat membuat aturan harga (butuh Manajer atau Super admin). Direktur menunggu usulan override dari Manajer depot, lalu menyetujui di "Harga jaringan".

**Skenario 6 — Hari depot salah ditutup.** Head office membuka /dashboard/reports, memilih depot, tab "harian", menekan "Buka kembali", memperbaiki, lalu depot menutup buku kembali.

---

## 13. Daftar periksa penyelesaian

- [ ] Saya dapat masuk dan melihat peran yang benar di kaki rail.
- [ ] Saya tahu layar mana yang boleh saya buka (Indeks layar HQ).
- [ ] Saya paham tombol yang tampil belum tentu boleh dipakai (bagian 9.2).
- [ ] Saya dapat mengundang staf dan tahu peran apa yang tidak boleh saya berikan (Head office).
- [ ] Saya paham alur payout empat mata dan siapa pada tiap langkah.
- [ ] Saya tahu refund yang dibatalkan tidak boleh ditolak.
- [ ] Saya tahu keputusan lamaran waralaba tidak bisa dibatalkan.
- [ ] Saya tahu letak "Buka kembali" (/dashboard/reports) dan "Batas auto-pass approval" (/dashboard/settings).
- [ ] Saya tahu batas jawab permintaan UU PDP adalah 3x24 jam.
- [ ] (Finance) Saya tahu alur saya perlu verifikasi di lingkungan nyata dan siapa yang dilapori bila layar galat.

---

## 14. Inventaris screenshot bab ini

| ID | Layar | Kondisi | Status |
|---|---|---|---|
| SS-hq-01 | /hq/login langkah 1 dan 2 | Nomor sintetis; kode OTP tidak ditampilkan | Belum diambil |
| SS-hq-02 | /hq Ringkasan jaringan, tampilan "Utama" | Data sampel | Belum diambil |
| SS-hq-03 | Detail depot dan dialog "Tangguhkan Depot?" | Kode depot sampel terisi | Belum diambil |
| SS-hq-04 | /hq/payments rilis payout dan pengajuan menunggu | Akun Direktur; data sampel | Belum diambil |
| SS-hq-05 | /hq/payments "Penarikan menunggu jawaban bank" + konfirmasi | Rekening tersamar | Belum diambil |
| SS-hq-06 | /hq/refunds + dialog "Tolak refund ini?" | Alasan sampel | Belum diambil |
| SS-hq-07 | /hq/applications/detail | Checklist sebagian terverifikasi | Belum diambil |
| SS-hq-08 | /hq/pricing "Override menunggu" | Satu usulan sampel | Belum diambil |
| SS-hq-09 | /hq/pdp "Menunggu" + dialog hapus akun | Satu permintaan melewati batas | Belum diambil |
| SS-hq-10 | /dashboard/reports tab harian "Buku ditutup" | Depot sampel | Belum diambil |
| SS-hq-11 | /dashboard/settings "Batas auto-pass approval" | Cakupan Default jaringan | Belum diambil |

Seluruh gambar harus memakai data sintetis; samarkan nomor telepon dan rekening.

---

## 15. Catatan celah dan hal yang perlu dikonfirmasi

Rujuk juga ke `17-open-questions`.

### 15.1 Finance (temuan terbesar, dari pembacaan kode, belum diuji di browser) **[B][D]**

Finance lolos pintu /hq dan melihat Waralaba, Pembayaran, Refund, Rekonsiliasi, Pajak & faktur, Skema komisi, Template faktur, Profil, Indeks layar, dan HR (SDM). Namun:

- Pembayaran memuat ringkasan eksekutif yang butuh hak `dashboard` (tidak dimiliki Finance) dan kegagalannya menjadi layar galat penuh. Kartu Lunas/Gagal dan rilis mungkin tak terjangkau.
- Waralaba (pendaratan Finance), Skema komisi memuat daftar depot lewat hak `depotDirectory` (tidak dimiliki Finance): kemungkinan galat penuh.
- Rekonsiliasi memuat data jaringan lewat hak `dashboard`: kemungkinan galat penuh.
- Kemungkinan berfungsi: Refund, Pajak & faktur, Template faktur (data contoh), Profil, Indeks layar, HR.
- Komentar kode menyatakan Finance menjalankan refund, payout, dan komisi dari /hq. Dua dari tiga alur itu bergantung pada halaman di atas. **Semua alur Finance (payout Lunas/Gagal, skema komisi, rekonsiliasi) perlu verifikasi di lingkungan nyata** sebelum panduan ini dipakai melatih Finance.

### 15.2 Celah lain

| No | Celah | Tag |
|---|---|---|
| 1 | Head office dan Direktur melihat tombol tulis depot, payout, refund, komisi, kampanye yang ditolak server. | [B] |
| 2 | Lamaran waralaba dapat disetujui tanpa checklist lengkap; tanpa konfirmasi atau alasan; keputusan final. | [B] |
| 3 | Menyetujui lamaran tidak membuat akun pemilik atau depot; Head office tidak dapat menuntaskan depot sendiri. | [B] |
| 4 | "Net payout ke pemilik" selalu "—" bagi Head office, Direktur, Finance. | [B] |
| 5 | Kebijakan SLA tak terjangkau Head office dan Direktur walau server mengizinkan. | [B] |
| 6 | Log audit tanpa saringan; pesan ekspor menyarankan menyaring. | [B] |
| 7 | Pencarian: baris Pesanan tidak bisa diklik; pelanggan hanya via nomor telepon. | [B] |
| 8 | Refund: tidak ada pengecekan pemohon berbeda dari penyetuju; Finance memegang dua sisi. | [B] |
| 9 | Beberapa pesan dan label berbahasa Inggris (status pesanan, validasi depot, disclaimer L/R). | [B] |
| 10 | Teks skor komposit tetap "70% pendapatan + 30% SLA" walau bobot dapat diubah. | [B] |
| 11 | Format nomor faktur hanya memengaruhi pratinjau; token `{NNNN}` vs `{SEQ}`. | [B] |
| 12 | Daftar terbatas diam-diam: harga jaringan 50 produk, voucher 50, retur galon dan bandingkan depot dan komisi 100 depot. | [B] |
| 13 | Penutupan bulan (/dashboard/monthly-review) tampaknya tidak dapat dibuka Head office. | [B][D] |
| 14 | Ambang persetujuan: Head office memegang hak tetapi tidak punya pintu; praktis hanya Super admin. | [B] |
| 15 | Apakah balasan tiket sampai ke pelanggan, apakah pemindaian fraud berjalan terjadwal di produksi, apakah ada rilis payout otomatis tanggal 15. | [K] |
| 16 | Nilai bawaan (ambang refund Rp100.000, batas auto-pass Rp100.000, PPN 0) berasal dari pengaturan dan dapat berubah. | [K] |
| 17 | Kunjungi Bab 10 untuk celah akun, sesi, dan keamanan yang dikelola Admin. | — |
