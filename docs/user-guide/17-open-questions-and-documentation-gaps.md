# Bab 17 — Pertanyaan Terbuka dan Celah Dokumentasi

| | |
|---|---|
| **Dokumen** | 17 — Konsolidasi celah, pertanyaan bisnis, asumsi, dan keputusan pemetaan peran |
| **Versi** | 0.1 (draf) |
| **Tanggal** | 2026-10-10 |
| **Klasifikasi** | Internal — Rahasia (memuat risiko keamanan dan kepatuhan) |
| **Bahasa** | Indonesia |
| **Sumber** | Temuan A–I (`scratchpad/findings`), bagian 15/16 panduan `01`–`10`, matriks kapabilitas bawaan (K) |

> **Catatan status dokumen.** Semua butir berasal dari pembacaan kode dan dokumen repositori. **Belum ada pengujian yang dijalankan oleh penulis dokumen ini**, termasuk uji peramban. Hasil UAT terakhir yang tercatat di `.uat/STATE.md`: 398 dari 439 kasus lulus, 36 N/A, 5 terblokir (tidak dijalankan ulang di sini). **[V]**
> Tag bukti: **[V]** terverifikasi di kode · **[D]** dugaan, perlu uji/konfirmasi · **[K]** perlu konfirmasi bisnis · **[B]** diketahui bermasalah/tidak konsisten.
> Hak akses = nilai BAWAAN dari `packages/access/src/index.ts`; Super admin dapat mengubahnya saat berjalan (±30 detik), sehingga butir "Ya/Tidak" bisa berbeda di produksi.

---

## 1. Cara Membaca

- **ID** stabil (G-001 …). Rujuk ID ini di tiket dan di Bab 13.
- **Kategori**: (a) fitur dijanjikan UI/teks tetapi tidak ada · (b) inkonsistensi atau cacat yang diketahui [B] · (c) perlu konfirmasi bisnis [K] · (d) belum terverifikasi/perlu uji peramban [D] · (e) fungsi hilang atau tidak dapat diakses · (f) risiko keamanan/kepatuhan.
- **Bukti** memakai format `berkas:baris` bila tersedia; bila tidak, rujukan temuan (mis. "B §6 G5" = berkas temuan B, bagian 6, butir G5). Path relatif terhadap akar repo.
- **Pemilik yang disarankan** adalah usulan, bukan penugasan: Produk · Rekayasa · Keamanan · Operasi · HR · Finance · Hukum/Kepatuhan · Dokumentasi.
- Duplikat antar-bab sudah digabung; kolom "Peran terdampak" mencantumkan semua peran.

### 1.1 Ringkasan jumlah

| Kategori | Rentang ID | Jumlah |
|---|---|---|
| (a) Fitur dijanjikan tetapi tidak ada | G-001 – G-016 | 16 |
| (b) Inkonsistensi/cacat [B] | G-017 – G-060 | 44 |
| (c) Perlu konfirmasi bisnis [K] | G-061 – G-084 | 24 |
| (d) Belum terverifikasi [D] | G-085 – G-096 | 12 |
| (e) Fungsi hilang/tidak dapat diakses | G-097 – G-124 | 28 |
| (f) Risiko keamanan/kepatuhan | G-125 – G-148 | 24 |

(Penonaktifan diri sendiri/Super admin terakhir yang tidak dijaga = G-129.)

---

## 2. Kategori (a) — Fitur Dijanjikan UI/Teks tetapi Tidak Ada

| ID | Modul | Peran terdampak | Deskripsi | Bukti | Dampak ke pengguna | Status | Pemilik | Rekomendasi |
|---|---|---|---|---|---|---|---|---|
| G-001 | Pelacakan pesanan | Pelanggan | Tur: "Pantau kurir real-time". Tidak ada peta langsung; hanya status, nama/nomor kurir, ETA, segar tiap 15 detik | A §6 G11 | Harapan salah | [B][V] | Produk | Ubah teks atau bangun peta |
| G-002 | Pesanan | Pelanggan | FAQ: alamat bisa diubah dari Lacak pesanan. Tidak ada endpoint/UI ubah alamat | A §6 G4; `order.controller.ts` | Pelanggan harus batal lalu pesan ulang | [B][V] | Produk/Dokumentasi | Hapus klaim FAQ atau bangun fitur |
| G-003 | Langganan | Pelanggan | Syarat Pasal 10 menjanjikan "melewati satu jadwal"; hanya Jeda/Lanjutkan/Batal/Ubah alamat | A §6 G8; `subscription.controller.ts:108-148` | Tidak bisa skip satu siklus | [B][V] | Produk/Hukum | Samakan Syarat dengan fitur |
| G-004 | Refund | Pelanggan | FAQ "1–3 hari kerja"; tidak ada kode yang mencatat/menegakkan, tak ada tampilan status refund | A §6 G6, G15; `payment.service.ts:633-650` | Pelanggan tak tahu status | [B][V] | Produk/Finance | Tambah status refund dan notifikasi |
| G-005 | Checkout | Pelanggan | Syarat Pasal 6: nilai deposit galon ditampilkan sebelum bayar; keranjang/checkout tidak menampilkan baris deposit | A §6 G7 | Biaya tak terlihat | [B][V] | Produk | Tampilkan deposit atau ubah Syarat |
| G-006 | Produk/Beranda | Pelanggan | "Pesan sebelum 16.00 — tiba hari ini, ±30 menit"; tak ada aturan jam batas; ETA "±30–45 menit" teks statis | A §6 G5; `shop.pdp.cutoff` | Janji waktu tak dijamin | [B][V] | Produk | Hapus atau implementasikan |
| G-007 | Pendaftaran | Pelanggan | Lencana "+50 poin"; bawaan referral 250 poin (penerima) dan 500 (pengajak), hanya setelah pesanan pertama selesai | A §6 G9; `referral-service env.validation.ts:26-27` | Poin tak sesuai | [B][V] | Produk | Samakan teks |
| G-008 | Pemberitahuan | Pelanggan | Tidak ada notifikasi pembayaran dikonfirmasi/gagal, refund selesai, balasan komplain, keputusan PDP | A §6 G15; `notification-event.ts` | Pelanggan harus memeriksa layar | [B][V] | Produk | Tambah peristiwa notifikasi |
| G-009 | Pembayaran | Pelanggan | Teks pemasaran: e-wallet dan virtual account; gateway kosong di produksi menurut komentar kode | A §6 G19; `payment.service.ts:240-249` | Metode tidak muncul | [B][D][K] | Produk/Finance | Verifikasi `/payments/methods` produksi |
| G-010 | Pengaturan Kepala depot | Kepala depot | Baris "Data akun" dan "Ubah PIN" tidak berfungsi; "Ambang low-stock default 20" statis | B §6 G9 | Tombol mati | [B][V] | Rekayasa | Sembunyikan atau implementasikan |
| G-011 | Akun waralaba | Pemilik waralaba | Baris "PIN persetujuan" dan "Perangkat masuk" tidak berfungsi; lencana "Usulan" tak jelas | E §O.9-10 | Membingungkan | [B][V] | Rekayasa | Sama |
| G-012 | Konsol depot | SPV, Manajer | Chip "Atur aturan" di Loyalty tak bisa diklik; "Mulai tur"/"Lewati" sama-sama ke /dashboard; pintasan "Pesanan pembelian" membuka Inventori | D §7 G9 | UI menyesatkan | [B][V] | Rekayasa | Perbaiki |
| G-013 | Keamanan HQ | Admin | "Wajib 2FA", rail "Keamanan & 2FA", langkah wizard "Verifikasi 2FA akun kamu" — tidak ada faktor kedua selain OTP | H §10 #5; Admin 15 #2 | Salah paham keamanan | [B][V] | Keamanan | Hapus label atau bangun 2FA |
| G-014 | Kanal notifikasi | Semua | PRD menyebut WhatsApp dan email; kode hanya SMS (OTP), push, kotak masuk; WhatsApp dihapus; email tidak ada | I §2.1; PRD §5.5 | Ekspektasi salah | [B][V] | Produk | Perbarui PRD |
| G-015 | Payout | Pemilik waralaba | "Payout berikutnya" tanggal 15 hanya tampilan; tak ada penjadwal ditemukan | E §O.5 | Pemilik menunggu jadwal yang tak ada | [B][K] | Finance/Produk | Konfirmasi kebijakan |
| G-016 | Check-in kurir | Staf depot | Daftar centang "Lokasi terverifikasi" dan "Kondisi baik · siap jalan" statis (komentar "no vehicle record yet") | C Part F #2; `check-in/page.tsx` | Rasa aman palsu | [B][V] | Rekayasa | Hubungkan ke data nyata atau hapus |

---

## 3. Kategori (b) — Inkonsistensi dan Cacat yang Diketahui [B]

| ID | Modul | Peran terdampak | Deskripsi | Bukti | Dampak ke pengguna | Status | Pemilik | Rekomendasi |
|---|---|---|---|---|---|---|---|---|
| G-017 | Rincian pesanan | Pelanggan | Status pembayaran dan metode tampil kode Inggris mentah (PENDING, PAID, CASH, QRIS); teks instruksi Inggris | A §6 G1; `orders/detail/page.tsx`; `payment.service.ts:1053-1068` | Sulit dipahami | [B][V] | Rekayasa | Terjemahkan |
| G-018 | Lacak publik | Pelanggan/publik | `/track` berlabel Inggris (Order placed, Confirmed, …) | A §6 G2; `lib/order-status.ts` | Tidak konsisten | [B][V] | Rekayasa | Samakan kamus |
| G-019 | Pesan server | Semua | Banyak pesan server Inggris tampil mentah: ORDER_*, PAYMENT_*, VOUCHER_*, LOYALTY_*, REFERRAL_*, CUSTOMER_ADDRESS_LIMIT, SUBSCRIPTION_NOT_ACTIONABLE; kurir (SHIFT_*, DELIVERY_*, penarikan); waralaba; HQ; `errors.ts byCode` hanya AUTH_* dan RATE_LIMITED | A §6 G3; C Part F #3; E §O.8; G §5.3 | Pesan tak terbaca | [B][V] | Rekayasa | Perluas `byCode` |
| G-020 | Pembatalan | Pelanggan | `cancelIntro` bilang boleh batal sebelum disiapkan, kode mengizinkan juga saat PREPARING; Syarat Pasal 8 berbeda lagi | A §6 G4; `order-status.ts:72-78`; `terms.ts` | Aturan tak jelas | [B][V] | Produk/Hukum | Satukan aturan |
| G-021 | Checkout | Pelanggan, Depot | Label slot di kamus (08.00–11.00 …) tidak sama dengan slot checkout; `deliveryWindow` teks bebas tanpa validasi; tanggal pesan tidak disimpan | A §6 G17; `checkout/page.tsx:72-90`; `order.dto.ts:104-111` | Depot tak bisa mengandalkan tanggal | [B][V] | Rekayasa | Simpan tanggal dan validasi slot |
| G-022 | Verifikasi OTP | Pelanggan | UI 6 digit dikunci; server bisa 4–8 | A §6 G18; `verify/page.tsx:27` | Rusak bila konfigurasi diubah | [B][V] | Rekayasa | Baca panjang dari server |
| G-023 | Beranda pesanan | Pelanggan | Kartu aktif menulis "sedang diantar" untuk status non-final termasuk CREATED | A §6 G12 | Salah info | [B][V] | Rekayasa | Pakai label status |
| G-024 | Notifikasi | Pelanggan | ORDER_DRIVER_ASSIGNED berbunyi "sudah diambil kurir" padahal status "Kurir ditugaskan" | A §6 G13; I §2.2 | Salah info | [B][V] | Produk | Ubah teks |
| G-025 | Akun | Pelanggan | Kamus `codeSentTo` memakai `{{phone}}` sehingga tampil dengan kurung kurawal | A §6 G14; `locale-context.tsx:82` | Kosmetik | [B][D] | Rekayasa | Perbaiki templat |
| G-026 | Poin | Pelanggan | Teks "hangus 12 bulan tanpa aktivitas" vs kode 12 bulan sejak diperoleh; penyapuan mati bawaan | A §6 G10; `loyalty/internal/expire` | Janji tak ditegakkan | [B][K] | Produk | Konfirmasi kebijakan |
| G-027 | Hapus akun | Pelanggan, HQ | Penyetujuan hapus tanpa penjaga pesanan terbuka; halaman publik menyebut "tautan akun Google" (dihapus); SLA "3x24 jam sejak diverifikasi" vs kode dari saat dibuat | A §6 G16; H §10 #7; `data-subject.service.ts:145-205` | Risiko hapus pesanan aktif; SLA ambigu | [B][V] | Hukum/Rekayasa | Tambah penjaga, selaraskan teks |
| G-028 | Antrean pesanan | Kepala depot | Badge status pesanan Inggris; pembayaran/pengantaran enum mentah | B §6 G8 | Tak konsisten | [B][V] | Rekayasa | Terjemahkan |
| G-029 | Tab konsol | Kepala depot | Tab Pembayaran terlihat tetapi ditolak ("Akses manajer depot"); tombol tulis Promo tampil padahal server hanya baca | B §6 G1, G2; `payments/page.tsx:280` | 403 setelah klik | [B][V] | Rekayasa | Saring per peran |
| G-030 | Teks penolak | Kepala depot, SPV, Asisten SPV | "Khusus Manajer depot" pada halaman yang dibuka Kepala depot/SPV (Huddle, Serah terima, Perawatan, Sengketa, Buku kas, Target, Performa tim); gate Permintaan pinjam berjudul "Impor massal tidak tersedia untuk peran ini" | B §6 G3; D §7 G9 | Pesan keliru | [B][V] | Rekayasa | Ubah teks per kapabilitas |
| G-031 | Setoran COD | Kepala depot | Jumlah "Disetor" dimasukkan kurir; kasir tak punya kolom hitung sendiri | B §6 G7; `settlements/page.tsx:130-190` | Kontrol lemah | [B][V] | Operasi/Rekayasa | Tambah kolom hitung kasir |
| G-032 | Serah terima shift | Kepala depot | Tanda tangan tidak diblokir oleh daftar periksa belum selesai | B §6 G11 | Kontrol lemah | [B][V] | Operasi | Tegakkan |
| G-033 | Tutup buku | Kepala depot, Manajer | Tutup harian hanya memeriksa shift kasir terbuka; tak mensyaratkan setoran COD terverifikasi | B §6 G12; `daily-close.service.ts` | Selisih lolos | [B][V] | Finance | Tambah syarat |
| G-034 | Dasbor | Kepala depot, Manajer | "Pesanan masuk" = 100 pesanan terbaru, "Order hari ini" berisi data 30 hari; subtitle notifikasi "seluruh jaringan" padahal per depot; "target 96%" dan "v1.0.0" tetap | B §6 G13, G14; D §7 G9 | Angka menyesatkan | [B][V] | Rekayasa | Perbaiki label/sumber |
| G-035 | Approval | Manajer | `COD_VARIANCE` ada tetapi tak pernah dibuat | B §6 G15; D §7 G4 | Salah paham | [B][V] | Rekayasa | Hapus atau pakai |
| G-036 | Approval | Manajer | Item HELD hilang dari daftar (hanya PENDING); detail desktop membaca kunci payload salah untuk GALLON_VARIANCE/DEPOSIT_REFUND (Rp0); desktop tanpa dialog konfirmasi; editor ambang tampil untuk Manajer (403 saat simpan) | D §7 G4 | Keputusan tak terlihat | [B][V] | Rekayasa | Perbaiki |
| G-037 | Komentar RBAC | SPV, Asisten SPV | Komentar `index.ts:35-36` "tanpa tulis, uang, approval" bertentangan dengan hak tulis SPV (insiden, sengketa, target, buku kas, pinjam karyawan, aksi pengiriman) | D §7 G1; `packages/access/src/index.ts:35-36` | Dokumen kode menyesatkan | [B][V] | Rekayasa | Perbarui komentar |
| G-038 | Rail menu | SPV, Asisten SPV | Performa tim (keduanya), Komisi kurir dan Tinjauan bulanan (SPV) tampil di rail tetapi data ditolak | D §7 G2 | Galat penuh | [B][D] | Rekayasa | Saring rail |
| G-039 | Cakupan depot | SPV, Manajer | "Semua depot" memakai depot pertama untuk halaman satu-depot; landing menjumlah semua; ponsel tanpa "Semua depot" | D §7 G5 | Angka beda | [B][V] | Rekayasa | Tandai jelas atau paksa pilih |
| G-040 | Voucher | Manajer | Alur permintaan voucher dihapus (keputusan 2026-09-04), komentar `index.ts:415-416` dan nama kapabilitas `voucherRequestDecide` usang; keterikatan depot voucher buatan Manajer belum diverifikasi | D §7 G6 | Dokumen kode usang | [B][D] | Rekayasa | Bersihkan |
| G-041 | Katalog/Depot | Manajer | Katalog (jaringan) dapat ditulis Manajer (`catalogWrite`) dan buat/nonaktifkan depot (`depotAdmin`) padahal "Pengaturan depot" menyebut lewat kantor pusat | D §7 G8 | Dampak lintas depot | [B][D] | Produk | Konfirmasi |
| G-042 | Pengantaran/HR | Staf depot | Dua "check-in" (shift dan absen wajah) tak terhubung | C Part F #1 | Kurir harus dua kali | [B][V] | Produk/HR | Putuskan satu sumber |
| G-043 | Kurir | Staf depot | Teks tetap vs pengaturan: "minimal 2 kali", "5 menit", tanda tangan "wajib", "lokasi terkirim", "dipotong dari upah", "payout mingguan", "Foto & tanda tangan", "deposit dikembalikan" untuk galon rusak, "persetujuan depot" vs Manajer/Finance | C Part F #4 | Salah paham aturan | [B][V] | Rekayasa/Produk | Ambil dari pengaturan |
| G-044 | Waralaba | Pemilik, HQ | Teks sukses "dikirim" padahal PROCESSING; label "Persentase payout per depot" padahal komisi HQ; komisi dasar tanpa ongkir tetapi pemilik dikredit total termasuk ongkir | E §O.7, O.14, O.15; `payout.service.ts:86-91` | Salah baca | [B][V] | Finance/Rekayasa | Samakan label |
| G-045 | Waralaba | Pemilik | Halaman pemilik tak menampilkan riwayat pencairan (API mengembalikan, halaman mengabaikan); buku kas hanya 8 terakhir | E §O.6 | Tak bisa cek status | [B][V] | Rekayasa | Tampilkan |
| G-046 | Waralaba | Pemilik | Navigasi ponsel "Antrean" untuk pemilik tanpa hak; pencarian menaut ke halaman yang tak bisa dibuka | E §O.11 | Halaman kosong | [B][D] | Rekayasa | Saring |
| G-047 | HR | HR | Pesan penolakan layanan masuk diratakan jadi "auth-service menolak permintaan (403)"; pesan "Peran X hanya boleh diberikan oleh …" tak diteruskan | F §6; `identity.http.adapter.ts:58-82` | HR tak tahu penyebab | [B][V] | Rekayasa | Teruskan pesan |
| G-048 | HR | HR, Head office, Direktur | Dropdown jabatan menawarkan Manager ke Head office/Direktur padahal server menolak; Head office/Direktur punya `hrAdmin` tetapi tak dapat memutuskan cuti di layar | F §6; Bab 8 §15 #4, #11 | Pilihan sia-sia | [B][V] | Rekayasa | Saring |
| G-049 | HR | HR | Placeholder "mis. EMP-0012" vs format `HR-####`; pesan klien menampilkan nama kolom teknis ("depotId", "fullName") | F §6; D §7 | Membingungkan | [B][V] | Rekayasa | Perbaiki |
| G-050 | HQ | Head office, Direktur, Finance | Tombol tulis (depot, rilis, rekening, Lunas/Gagal, refund, komisi, Re-engage, kampanye, Beri poin, banner, "＋ Aturan baru") tampil tetapi ditolak server; "Aktifkan depot" gagal tanpa pesan | G §5.2; `hq-nav.ts` | 403 setelah klik | [B][V] | Rekayasa | Saring per peran |
| G-051 | HQ | Head office, Direktur, Finance | "Net payout ke pemilik" selalu "—"; `/hq/sla-policy` tak terjangkau Head office/Direktur (rail `depotAdmin` vs server `hqBackOffice`); Penutupan bulan tak terjangkau Head office; ambang persetujuan praktis hanya Super admin | G §5.3; Bab 9 §15.2 #4, #5, #13, #14 | Fungsi terblokir | [B][V][D] | Rekayasa | Selaraskan gerbang |
| G-052 | HQ | HQ | Teks tetap "Skor komposit = 70% pendapatan + 30% SLA" padahal bobot disetel; token faktur layar `{NNNN}` vs server `{SEQ}` (hanya pratinjau); catatan refund "Nama depot & nomor pesanan belum ditampilkan" usang; kamus tak terpakai (Pantau, stage.*, bottomNav.*) | G §5.3 | Info usang | [B][V] | Rekayasa | Bersihkan |
| G-053 | HQ | HQ | Daftar terbatas diam-diam (harga jaringan 50, voucher 50, retur galon/bandingkan depot/komisi 100 depot); label status pesanan Inggris di `/hq/orders`; validasi form depot Inggris; disclaimer P&L Inggris | G §5.3 | Data terpotong | [B][V] | Rekayasa | Beri penanda/paginasi |
| G-054 | HQ | HQ | Pencarian: baris Pesanan tak bisa diklik; pelanggan hanya via nomor telepon; Log audit tanpa saringan; pesan ekspor menyarankan menyaring | G §5.3; H §10 #8 | Sulit menelusuri | [B][V] | Rekayasa | Tambah saringan |
| G-055 | Admin | Admin | Undangan dari `/dashboard/staff` tidak mengirim kolom wajib (position, joinDate, employmentStatus, salaryType); kemungkinan 400 | H §10 #3; `staff.dto.ts` | Undangan gagal | [B][D] | Rekayasa | Samakan dengan `/hq/staff` |
| G-056 | Admin | Admin | IP allowlist hanya untuk kunci API mitra (x-api-key), bukan konsol HQ; komentar halaman keamanan usang (batas diam kini ditegakkan sejak CA-2-06) | H §10 #6, #10; `hq/security/page.tsx:20-55` | Salah kira perlindungan | [B][V] | Keamanan | Perbarui teks |
| G-057 | Admin | Admin | Audit "append-only" vs retensi menghapus baris audit setelah jendela (min 365 hari); `/hr/audit` menampilkan awalan ID pelaku bukan nama | H §10 #8 | Salah kira | [B][V] | Keamanan | Dokumentasikan |
| G-058 | Admin | Admin | Wizard HQ dicentang manual, tak diturunkan dari kondisi nyata; grid matriks menampilkan bawaan bila muat gagal | Admin 15 #10, #7 | Centang bukan bukti; risiko simpan salah | [B][V] | Rekayasa | Turunkan dari data; tolak simpan |
| G-059 | Admin | Admin | Mencabut Super admin dari baris matriks tak berefek; kapabilitas `accessMatrixWrite` bisa diberikan ke peran lain tanpa pelindung | Admin 15 #8; `index.ts` | Perlu kebijakan | [B][D] | Keamanan | Tulis kebijakan |
| G-060 | Notifikasi | Semua | Sisa WhatsApp: `WHATSAPP_API_URL/TOKEN` di compose/env, komentar `notification.service.ts:25`, ringkasan controller dan `index.ts:~598` masih menyebut WhatsApp; laporan penjualan harian "ke nomor depot" | I §2.1 | Dokumen kode usang | [B][V] | Rekayasa | Bersihkan |

## 4. Kategori (c) — Perlu Konfirmasi Bisnis [K]

Nilai berasal dari data/pengaturan atau kebijakan yang tidak ada di kode. Dokumentasi memakai nilai bawaan kode dan menandainya [K].

| ID | Modul | Peran terdampak | Deskripsi | Bukti | Dampak ke pengguna | Status | Pemilik | Rekomendasi |
|---|---|---|---|---|---|---|---|---|
| G-061 | Checkout | Pelanggan, Kepala depot | Nilai per depot: minimum pesanan (`minOrderAmount`, bawaan kosong), ongkir per galon, biaya ekspres (bawaan Rp5.000, ETA 30–60 mnt), jam slot, radius layanan (bawaan 5 km), diskon langganan | A §6 G20; `env.validation.ts:59-65` | Panduan tak bisa menyebut angka | [K] | Operasi | Isi tabel nilai produksi |
| G-062 | Refund | Pelanggan, Finance | Cara dan waktu pengembalian dana untuk tunai/transfer/QRIS (dikembalikan manual oleh depot); apakah "1–3 hari kerja" berlaku | A §6 G6, UNKNOWN | Janji tak terbukti | [K] | Finance/Produk | Tetapkan SOP |
| G-063 | Deposit galon | Pelanggan, Staf depot, Kepala depot | Bagaimana dan kapan pelanggan membayar/menerima deposit (dugaan di pintu); tarif bawaan Rp20.000 (`GALLON_DEPOSIT_IDR`) | A §6 G7; `depot-service env.validation.ts:35` | Sengketa deposit | [K][D] | Operasi | Tetapkan alur dan tampilkan |
| G-064 | Ambang persetujuan | Kepala depot, Manajer, Finance | Nilai produksi `REFUND_HQ_THRESHOLD` (Rp100.000), batas auto-pass approval (Rp100.000), `EXPENSE_MANAGER_APPROVE_MAX_IDR` (Rp500.000), auto-setuju klaim (Rp50.000), ambang surplus setoran Rp5.000 (konstanta), selisih meteran 200 liter | D §7 G10b; B UNKNOWN | Aturan keputusan | [K] | Finance | Konfirmasi |
| G-065 | Penugasan lintas depot | HR, SPV, Manajer | Apakah `DEPOT_ASSIGNMENT_ENABLED` aktif di produksi (bawaan mati → pinjam karyawan 404, kartu penugasan hilang) | D §7 G10b; F §6 | Fitur tak tampak | [K] | Operasi | Konfirmasi |
| G-066 | Sesi | Semua | Nilai produksi batas diam sesi (komentar menyebut 15 mnt) | A UNKNOWN; `session.service.ts:84-91` | Sesi putus | [K] | Keamanan | Konfirmasi |
| G-067 | Upah kurir | Staf depot | Nilai upah dasar, bonus jam sibuk, tepat waktu, insentif berjenjang, target mingguan per depot | C Part F #7 | Kurir bertanya | [K] | HR/Finance | Dokumentasikan |
| G-068 | Setoran COD | Staf depot, Kepala depot | Kebijakan kapan selisih dibebankan ke kurir, tenggat setoran, tenggat tutup buku | C Part F #7; Kepala depot §15 K2-K3 | Perselisihan | [K] | Finance/Operasi | Tetapkan kebijakan |
| G-069 | Penarikan | Staf depot, Pemilik waralaba | Lama proses penarikan, minimum, biaya, batas harian; siapa membayar (dugaan Finance) | E §O.5; C | Pengguna menunggu | [K][D] | Finance | Tetapkan |
| G-070 | Kasbon | Karyawan, Asisten SPV | Batas nominal kasbon dan batas waktu keputusan tidak ada | Bab 6 §16 A3, A9 | Risiko keputusan sembarang | [K] | HR | Tetapkan batas dan SLA |
| G-071 | Cuti | Karyawan, HR | Rincian kebijakan (surat dokter cuti sakit), kuota bawaan 12 hari | C Part F #7; `env.validation.ts:60` | Aturan tak jelas | [K] | HR | Dokumentasikan |
| G-072 | Pajak/BPJS | HR, Finance | Tabel TER PPh 21 kosong sampai dimuat; tarif bawaan BPJS/JKK/JKM perlu konfirmasi pajak | F §6; Bab 8 §15 #8 | Salah hitung | [K] | Finance | Muat tabel, verifikasi |
| G-073 | Payout waralaba | Pemilik, Finance | Kebijakan tanggal 15 (tampilan saja), rilis otomatis, apakah penangguhan depot membekukan payout | E §O.5, O.12; G §5.5 | Ekspektasi pemilik | [K] | Finance | Putuskan |
| G-074 | Lamaran waralaba | Pemohon, HQ | Cara menyerahkan KTP/NPWP/bukti lokasi/setoran modal (formulir tanpa unggah, dugaan WhatsApp); apakah boleh disetujui tanpa checklist lengkap | E §O.1, O.3 | Alur offline tak tertulis | [K] | Produk/HQ | Dokumentasikan alur |
| G-075 | Hierarki | Asisten SPV, SPV, Manajer | Cara depot mendapat Asisten SPV selain `/hq/hierarchy` (hanya Super admin); impor staf tak bisa membuat Asisten SPV/SPV/Manajer | D §7 G10c; `STAFF_IMPORT_ROLES` | Depot tak terlihat | [K] | Operasi | Tetapkan prosedur |
| G-076 | Dukungan | Semua | Nomor/kanal dukungan pusat dan jam layanan tidak terdokumentasi; jalur eskalasi darurat resmi | Bab 1 §15; Bab 4 §15 K7 | Pengguna tak tahu ke mana | [K] | Operasi | Tetapkan |
| G-077 | Platform | Semua | Daftar peramban/perangkat resmi; status aplikasi Android di Play Store (uji internal per 2026-09-25) | Bab 1 §17 #1, #7 | Dukungan tak terarah | [K] | Produk | Tetapkan |
| G-078 | Feature flag | Admin | Beberapa flag "Belum ditegakkan" (tak ada layanan yang membacanya); daftarnya belum ditentukan | H §10 #9 | Janji efek keliru | [K] | Rekayasa | Inventarisasi |
| G-079 | Undangan staf | Head office | Head office dapat mengundang Head office lain dan Pemilik waralaba tanpa batas | H §10 #12 | Konsentrasi hak | [K] | Keamanan | Konfirmasi maksud |
| G-080 | Meteran air | Staf depot, Kepala depot | Apakah kurir diminta mencatat meteran; hak `meterWrite` dimiliki tapi tak ada pintu | C Part F #7; Bab 4 §15 B8 | Fungsi nganggur | [K] | Operasi | Putuskan |
| G-081 | Peran | HR, Staf depot | Arti "STAFF_DEPOT" di HR (jabatan teks bebas; label "Staf Depot / Kurir"); apakah kurir digaji harian dan per antar sekaligus | C Part F #7; F | Salah paham peran | [K] | HR | Konfirmasi |
| G-082 | Notifikasi ops | Asisten SPV, SPV | Asisten SPV tak punya `opsNotif` sehingga stok menipis tak diberi tahu; SPV hanya STOCK_LOW dan COURIER_INCIDENT di ponsel | Bab 6 §16 A7; D §7 G10e | Peringatan terlewat | [K][D] | Operasi | Putuskan cakupan |
| G-083 | Hak tulis SPV | SPV | Apakah SPV memang boleh menulis buku kas dan target | Bab 5 §15 S9 | Kontrol keuangan | [K] | Finance | Konfirmasi |
| G-084 | Pembatalan & tab | Kepala depot, Manajer | Siapa menyetujui pembatalan pesanan yang belum dikirim bila Kepala depot tak bisa; apakah Kepala depot sebaiknya memegang tab Meteran, Sengketa, Aturan promo; arti `/dashboard/search` belum dibaca | Bab 3 §15 K4-K6 | Alur buntu | [K] | Operasi | Putuskan |

---

## 5. Kategori (d) — Belum Terverifikasi / Perlu Uji Peramban [D]

| ID | Modul | Peran terdampak | Deskripsi | Bukti | Dampak ke pengguna | Status | Pemilik | Rekomendasi |
|---|---|---|---|---|---|---|---|---|
| G-085 | Seluruh dokumen | Semua | Semua temuan dari pembacaan kode; tak ada uji peramban/aplikasi; label dan alur bisa berbeda saat berjalan | Semua bab | Risiko panduan tidak akurat | [D] | Dokumentasi/QA | Walkthrough tiap bab sebelum dirilis |
| G-086 | HQ Finance | Finance | Alur Finance (Pembayaran Lunas/Gagal, Skema komisi, Rekonsiliasi, Waralaba) diduga galat penuh karena memuat `dashboard`/`depotDirectory`; belum diuji | G §5.1; Bab 9 §15.1 | Finance mungkin tak bisa bekerja | [D][B] | QA/Rekayasa | Uji dengan akun Finance |
| G-087 | SPV/Asisten SPV | SPV, Asisten SPV | Wujud tampilan galat saat data ditolak (Performa tim, Komisi kurir, Tinjauan bulanan) belum dilihat | D §7 G2 | Teks bantuan tak pasti | [D] | QA | Uji |
| G-088 | Pemilik waralaba | Pemilik | Navigasi ponsel, Pencarian, alert toggle (Approval baru, Stok kritis) apakah pernah menyala untuk pemilik | E §O.10-11 | Tak pasti | [D] | QA | Uji |
| G-089 | Keamanan HQ | Admin | Isi layar `/hq/security` (sakelar 2FA), `/hq/access` landing, flags belum dibaca penuh | H §10 #5, #10 | Panduan Admin mungkin tidak lengkap | [D] | Dokumentasi | Baca dan uji |
| G-090 | Sesi staf | Admin, HR | Apakah penangguhan depot atau offboarding mencabut sesi staf (dialog menyebut "kehilangan akses"); tampak tidak | H §10 #10, #17; F §6 | Janji pemutusan akses | [D] | Keamanan | Telusuri |
| G-091 | Notifikasi ops | Semua staf | Tujuan ketukan notifikasi `LOAN_REQUEST_SUBMITTED` di aplikasi; pemicu notifikasi per peristiwa di `/hq/profile` | Bab 6 §16 A2; G §5.5 | Jalur ke antrean kasbon | [D] | QA | Uji |
| G-092 | HR mandiri | Staf, HR | Isi `/hr/me`, notifikasi ke HR untuk item tertunda, jendela filter absensi (`@IsWithinDays`), rumus skor kinerja, ambang cocok wajah selain 75% (penanda merah), target audiens pengumuman, isi entri Log Audit | F §6 | Panduan belum lengkap | [D] | Dokumentasi | Baca |
| G-093 | Promosi | Manajer | Apakah Manajer dapat membuka `/dashboard/promotions` dan kampanye (rail menyembunyikan) | D §7 G10a | Tak pasti | [D] | QA | Uji |
| G-094 | Audit | Admin | Nama aksi audit yang tampil (mis. perubahan matriks) belum dipastikan | Admin 15 #16 | Pencarian log | [D] | QA | Ambil contoh nyata |
| G-095 | Operasi terjadwal | HQ | Apakah balasan tiket sampai ke pelanggan, apakah pemindaian fraud terjadwal berjalan di produksi, apakah ada rilis payout otomatis tanggal 15 | G §5.5; Bab 9 §15.2 #15 | Janji layanan | [D][K] | Rekayasa | Verifikasi cron produksi |
| G-096 | Lain-lain | Pelanggan, Kepala depot | Hadiah ulang tahun (cron ada, tidak diverifikasi dari sisi pelanggan); jumlah Rp0 di halaman Persetujuan desktop; sender-id SMS yang terlihat pengguna; hasil UAT 398/439 tidak dijalankan ulang | Bab 2 §15; Bab 3 §15 #6; A UNKNOWN; I §4.3 | Tak pasti | [D] | QA | Uji ulang |

---

## 6. Kategori (e) — Fungsi Hilang atau Tidak Dapat Diakses

| ID | Modul | Peran terdampak | Deskripsi | Bukti | Dampak ke pengguna | Status | Pemilik | Rekomendasi |
|---|---|---|---|---|---|---|---|---|
| G-097 | Antrean pesanan | Kepala depot | Tidak ada tombol batal pesanan oleh staf; pesanan CONFIRMED/PREPARING yang belum dikirim tak bisa dibatalkan di UI walau server mengizinkan | B §6 G5 | Pesanan menggantung | [V] | Rekayasa | Tambah tombol |
| G-098 | Setoran COD | Kepala depot | Setoran DISPUTED tak bisa diselesaikan dari UI padahal server mendukung | B §6 G6 | Sengketa menggantung | [V] | Rekayasa | Tambah aksi |
| G-099 | Approval | Kepala depot | Kepala depot tak punya halaman status persetujuan yang ia picu | B §6 G15 | Tak tahu hasil | [V] | Rekayasa | Tambah daftar baca-saja |
| G-100 | Navigasi | Kepala depot | Meteran, Forecast, Aturan promo, Sengketa, CRM, Peran, Akun, Pengaturan depot, Pencarian tidak ada di tab, hanya via URL | B §6 G4; `operator-shell.tsx` | Fitur tersembunyi | [V] | Rekayasa | Tambah ke navigasi atau pindah |
| G-101 | Navigasi | SPV, Asisten SPV, HR | Antrean kasbon, cuti, dan permintaan pinjam karyawan tak ada tautan dari rel; pintu = notifikasi atau ketik `/hr/...`; layar cuti dan pinjam tak ada di aplikasi ponsel | D §7 G3; Bab 6 §16 A1 | Persetujuan tertunda | [D] | Rekayasa | Tambah tautan |
| G-102 | Harga | Manajer | Satu-satunya jalur ke antrean persetujuan HQ untuk harga adalah impor CSV "Import Harga Depot"; tak ada form usulan tunggal dan layar status pengusul; alat langsung (Harga dinamis, Inventori "Harga") mengubah harga tanpa persetujuan | D §7 G7 | Kontrol lemah | [V][D] | Produk | Putuskan jalur |
| G-103 | Akun staf | Admin, HR | Tidak ada layar "ubah peran"; hanya undang ulang | H §10 #2 | Salah ketik berisiko | [V] | Rekayasa | Tambah layar |
| G-104 | Pinjam karyawan | HR | Tidak ada kotak masuk global untuk permintaan pinjam | F §6 | Permintaan terlewat | [V] | Rekayasa | Tambah |
| G-105 | Payroll | HR, Finance | Tidak ada pembatalan persetujuan payroll; tidak ada langkah mundur | F §6; Bab 8 §9 | Koreksi sulit | [V] | HR/Rekayasa | Tambah alur koreksi |
| G-106 | Offboarding | HR | Tidak ada wizard; Resign tanpa Tanggal keluar membuat payroll menolak | F §6 | Kesalahan proses | [V] | HR | Tambah wizard |
| G-107 | Self-service kurir | Staf depot | Tidak ada cara: mengedit/membatalkan setoran atau klaim, membantah selisih/absensi, melihat skor wajah, membatalkan cuti disetujui; melihat slip Draft | C Part F #6, #8 | Ketergantungan manual | [V] | HR/Produk | Tambah |
| G-108 | Aplikasi kurir | Staf depot | Pengantaran Dijadwalkan ulang tak ada di Riwayat; tab Dompet praktis tak terlihat | C Part F #6, #10 | Kehilangan jejak | [V] | Rekayasa | Perbaiki |
| G-109 | Meteran | Staf depot | Hak `meterWrite` dimiliki tetapi tak ada pintu | Bab 4 §15 B8 | Fungsi nganggur | [V] | Rekayasa | Putuskan |
| G-110 | Layanan mandiri pelanggan | Pelanggan | Tidak ada: ubah verifikasi email, lihat status refund, ubah alamat pesanan, skip siklus, peta kurir, belanja tamu | A §6 G21, G22 | Beban dukungan | [V] | Produk | Prioritaskan |
| G-111 | Lamaran waralaba | Pemohon | Formulir publik tanpa unggah dokumen dan tanpa halaman status pemohon | E §O.1 | Tak tahu status | [V] | Produk | Tambah |
| G-112 | Lamaran waralaba | HQ | Persetujuan tidak membuat akun pemilik atau depot; data pemohon tak terbawa; prefill hanya di sessionStorage | E §O.2 | Kerja manual HQ | [V] | Produk | Otomatiskan |
| G-113 | Lamaran waralaba | HQ | Persetujuan boleh dengan checklist belum lengkap; keputusan tanpa alasan/konfirmasi (kecuali Tolak refund dan Tolak PDP); final tak bisa dibatalkan | E §O.3; G §5.3 | Keputusan keliru permanen | [V] | Produk | Tambah konfirmasi |
| G-114 | Pelanggan di konsol | Kepala depot | Tombol "Buatkan pesanan" di detail pelanggan hanya membuka antrean | B §6 G10 | Tombol menyesatkan | [V] | Rekayasa | Perbaiki |
| G-115 | Konten | Admin | Konten dwibahasa hanya menghasilkan diff, tidak menyimpan | Admin 15 #11 | Butuh pengembang | [V] | Rekayasa | Tambah simpan |
| G-116 | Pemulihan akun | Admin, Pelanggan | Tidak ada layar: pemulihan Admin tunggal, mengganti nomor orang lain, mengaktifkan kembali pelanggan SUSPENDED | Admin 15 #18; A | Eskalasi ke pengembang | [K][D] | Keamanan | Tentukan SOP |
| G-117 | Insiden kurir | Staf depot | Laporan insiden tanpa koordinat; tidak ada QRIS di aplikasi kurir | C Part F #4, #6 | Bantuan terlambat | [V] | Rekayasa | Sertakan lokasi |
| G-118 | Payroll | HR | Batch hanya karyawan Aktif (maks. 500/depot); payroll hanya setelah bulan berakhir | F §6 | Slip karyawan keluar manual | [V] | HR | Dokumentasikan |
| G-119 | Absensi | HR | Tidak ada sapuan otomatis "absen"; ABSENT lewat input manual/impor; `absentAfterMinutes` bawaan 0 | I §3.3 | Kehadiran tak otomatis | [V] | HR | Konfirmasi maksud |
| G-120 | Setoran | Kasir | Surplus setoran tidak dikreditkan ke kurir | C Part F | Kurir dirugikan/netral | [V][K] | Finance | Tetapkan kebijakan |
| G-121 | Ekspor | HQ | Ekspor manual `/hq/reports/export` tidak masuk Log ekspor; laporan terjadwal tidak dikirim email | G 2.14-2.16 | Jejak tidak lengkap | [D] | Rekayasa | Catat ekspor |
| G-122 | Hierarki | Manajer | Cakupan dan hierarki hanya diedit Super admin; Manajer tidak bisa mengubah cakupan sendiri | D §8 | Ketergantungan Admin | [V] | Operasi | Delegasikan bila perlu |
| G-123 | Laporan PDP | HQ | Tidak ada peringatan untuk permintaan PDP yang lewat batas waktu | `pdp-sla.ts`; H §10 #7 | Pelanggaran SLA tak terdeteksi | [V] | Hukum/Rekayasa | Tambah peringatan |
| G-124 | Sengketa/insiden | Asisten SPV | Asisten SPV tak punya menu Insiden/Sengketa/Buku kas/Target (hanya SPV) | Bab 6 §9 | Harus lewat SPV | [V] | Operasi | Konfirmasi |

---

## 7. Kategori (f) — Risiko Keamanan dan Kepatuhan

| ID | Modul | Peran terdampak | Deskripsi | Bukti | Dampak ke pengguna | Status | Pemilik | Rekomendasi |
|---|---|---|---|---|---|---|---|---|
| G-125 | Autentikasi | Semua, terutama HQ/Admin | Tidak ada 2FA: OTP SMS satu-satunya faktor, termasuk Super admin dan HQ | H §10 #5; `login.service.ts:18-19` | Pengambilalihan SIM berdampak besar | [V][B] | Keamanan | Faktor kedua untuk peran istimewa |
| G-126 | Sesi | Admin, HR | Token akses tetap berlaku hingga 15 menit setelah akun dinonaktifkan (guard tidak memeriksa status); token penyegar tidak dicabut; tidak ada paksa-keluar admin | H §10 #1; `jwt-auth.guard.ts` | Akses sisa | [V][B] | Keamanan | Cek status di guard, tambah paksa-keluar |
| G-127 | Privasi | Publik | `privacy@hydromart-digital.com` tanpa catatan MX per 2026-09-25; surat berisiko tidak sampai | `GO_LIVE.md:94-99`; Bab 1 §15 | Permintaan data pribadi hilang | [B][K] | Hukum/Operasi | Perbaiki dan verifikasi ulang |
| G-128 | Refund | Finance, Manajer | Tidak ada pemeriksaan pemohon ≠ penyetuju; Finance memegang pengajuan dan putusan | G §5.4; `payment.controller.ts:629-643` | Risiko penyalahgunaan | [V][B] | Finance/Keamanan | Wajibkan orang berbeda |
| G-129 | Akun Admin | Admin | Menonaktifkan diri sendiri atau Super admin terakhir tidak dijaga (hapus dijaga); risiko terkunci | H §10 #11; `account.service.ts:606-664` | Kehilangan akses admin | [V][B] | Keamanan | Tambah penjaga |
| G-130 | Payroll | HR, Finance | Tidak ada maker-checker: satu akun dapat membuat, menyetujui, dan menandai dibayar; karyawan melihat slip Draft | `payroll.service.ts:718-768`; F | Risiko penipuan gaji | [V][B] | HR/Finance | Pemisahan tugas |
| G-131 | Akun staf | Admin, Head office | Ubah peran lewat undang ulang nomor yang sama; salah ketik mengubah/mengaktifkan akun lain; undang ulang mengaktifkan akun nonaktif | H §10 #2 | Eskalasi hak tak sengaja | [V][B] | Keamanan | Layar ubah peran dengan konfirmasi |
| G-132 | Sesi | Semua | Batas diam dicek hanya saat penyegaran; kebijakan tak terbaca = tanpa batas (fail-open); nilai produksi tidak diketahui | `session.service.ts:102-115` | Sesi menggantung | [V][K] | Keamanan | Fail-closed atau default |
| G-133 | Biometrik | HR, Karyawan | Cek hidup hanya proksi gerak (foto cetak bergerak mungkin lolos); data wajah = biometrik (persetujuan dan penghapusan ada) | `face-capture.tsx`; C §B3 | Absen titip | [V][B] | HR/Keamanan | Perkuat liveness |
| G-134 | Undangan | Head office | Head office dapat membuat sesama Head office dan Pemilik waralaba tak terbatas | H §10 #12 | Konsentrasi hak | [V][K] | Keamanan | Tinjau kebijakan |
| G-135 | Kasbon | Asisten SPV, Manajer, HR | Tidak ada batas nominal dan SLA pada keputusan kasbon | Bab 6 §11 | Risiko uang | [K] | HR/Finance | Tetapkan |
| G-136 | Kontrol uang | Kepala depot, Manajer | Opname langsung mengubah stok tanpa menunggu approval; void konter tanpa approval; harga langsung berlaku; kekurangan setoran diputuskan satu orang | B §2.5-2.7; G12 | Kontrol lemah | [V][B] | Finance | Tinjau ambang |
| G-137 | Lamaran waralaba | HQ | Keputusan final tanpa konfirmasi, alasan, atau checklist lengkap | E §O.3; G §5.3 | Keputusan tak dapat dibatalkan | [V][B] | Produk | Tambah konfirmasi |
| G-138 | Hapus akun/PDP | Pelanggan, HQ | Persetujuan hapus tanpa penjaga pesanan terbuka; batas 3x24 jam tanpa peringatan; teks publik berbeda dari kode | A §6 G16; H §10 #7 | Kepatuhan UU PDP | [V][B] | Hukum | Selaraskan |
| G-139 | Hak akses | Admin | Grid matriks diam-diam menampilkan bawaan bila muat gagal (risiko simpan salah); `accessMatrixWrite` dapat diberikan tanpa pelindung selain Super admin | Admin 15 #7, #8 | Hak keliru | [V][B] | Keamanan | Gagal tertutup |
| G-140 | Jejak audit | Admin | Audit tanpa saringan; ekspor manual tidak dicatat; retensi menghapus baris audit setelah jendela; pelaku di `/hr/audit` hanya awalan ID | H §10 #8; G | Investigasi sulit | [V][B] | Keamanan | Perbaiki |
| G-141 | OTP reviewer | Operasi | Satu nomor penguji Play Store dapat memiliki kode tetap hingga tanggal kedaluwarsa (kosong = mati); harus dimatikan di produksi | `otp.service.ts:202-214`; `env.validation.ts:47-60` | Pintasan login | [V][K] | Keamanan | Pastikan nonaktif |
| G-142 | OTP saluran | Operasi | Saluran `console` menulis kode ke log (hanya dev); produksi wajib `zenziva`/`sms` (validasi boot; jalan keluar `OTP_CONSOLE_ACK` untuk E2E) | `env.validation.ts:108-116,157-195` | Kode bocor bila salah konfigurasi | [V][K] | Keamanan | Audit konfigurasi produksi |
| G-143 | Tautan lacak | Pelanggan | Siapa pun dengan tautan lacak dapat melihat status pesanan | Bab 2 §10 | Kebocoran ringan | [V] | Produk | Dokumentasikan/batasi |
| G-144 | Retensi | Admin, HQ | Retensi FINANCIAL ≥ 3650 hari dan audit ≥ 365 hari; payroll disimpan tanpa pemilik setelah anonimisasi; bukti antar 12 bulan; sapuan menandai "dataset belum ditegakkan" | H P9; F | Kepatuhan | [V][K] | Hukum | Tinjau |
| G-145 | Payout | Pemilik, Finance | Penangguhan depot tidak membekukan payout; Head office tak memegang pemisahan pengaju/penyetuju; pengaju ≠ penyetuju ditegakkan server | E §O.12; G §5.4 | Kebocoran dana | [V][K] | Finance | Putuskan |
| G-146 | Setoran | Kepala depot | Jenis `COD_VARIANCE` tidak dipakai: keputusan beban selisih oleh satu orang tanpa approval | B §6 G15 | Risiko kolusi | [V][B] | Finance | Tambah maker-checker |
| G-147 | Perimeter | Admin | IP allowlist tidak melindungi konsol HQ (hanya API mitra) | H §10 #6; `ipUnenforced` | Salah kira | [V][B] | Keamanan | Tegakkan atau hapus |
| G-148 | Konsentrasi hak | Super admin | Super admin memegang hampir semua kapabilitas (mengajukan dan menyetujui payout, mengubah matriks, menghapus akun); server tetap mewajibkan dua akun berbeda untuk rilis payout | G §5.4; H | Satu akun berisiko tinggi | [V] | Keamanan | Batasi jumlah dan awasi |

---

## 8. Tabel Silang: Masalah Bab 13 ke ID Celah

| Masalah (Bab 13) | ID celah terkait |
|---|---|
| T-01 – T-04 (OTP, jeda, batas IP) | G-022, G-066, G-141, G-142 |
| T-05 (akun nonaktif) | G-116, G-126, G-129 |
| T-08 (sesi, idle) | G-066, G-126, G-132 |
| T-11 – T-16 (akses, cakupan) | G-029, G-030, G-038, G-039, G-050, G-051, G-075, G-086 |
| T-19 – T-26 (transaksi) | G-005, G-019, G-033, G-061, G-063 |
| T-27 – T-32 (persetujuan) | G-036, G-070, G-099, G-101, G-112, G-113, G-128 |
| T-33 – T-37 (status) | G-004, G-008, G-020, G-021, G-097 |
| T-38 – T-43 (laporan, unggah) | G-053, G-054, G-121 |
| T-44 – T-47 (notifikasi) | G-008, G-014, G-060, G-082 |
| T-48 – T-53 (kurir) | G-016, G-042, G-043, G-067, G-068, G-098, G-107 |
| T-54 (absensi wajah) | G-092, G-119, G-133 |
| T-55 – T-58 (payroll/BPJS) | G-072, G-105, G-106, G-118, G-130 |
| T-59 – T-63 (payout waralaba) | G-015, G-044, G-045, G-069, G-073, G-145 |

---

## 9. Pertanyaan Bisnis Terbuka (butuh jawaban pemilik produk)

Setiap butir membutuhkan keputusan; sampai dijawab, panduan memakai nilai bawaan kode yang ditandai [K].

| No | Pertanyaan | Pemilik jawaban | ID |
|---|---|---|---|
| Q-01 | Berapa minimum pesanan, ongkir per galon, biaya ekspres, radius, dan jam slot yang berlaku di produksi per depot? | Operasi | G-061 |
| Q-02 | Bagaimana dan kapan pelanggan membayar serta menerima kembali deposit galon? Apakah nilainya harus tampil di checkout? | Operasi/Produk | G-005, G-063 |
| Q-03 | Berapa lama dan lewat cara apa refund tunai/transfer/QRIS dikembalikan? Perlu status refund untuk pelanggan? | Finance/Produk | G-004, G-062 |
| Q-04 | Apakah e-wallet dan virtual account aktif di produksi? | Finance | G-009 |
| Q-05 | Berapa nilai produksi ambang refund HQ, auto-pass approval, batas klaim Manajer/auto, ambang surplus? | Finance | G-064 |
| Q-06 | Apakah penugasan lintas depot (`DEPOT_ASSIGNMENT_ENABLED`) aktif? | Operasi | G-065 |
| Q-07 | Berapa batas diam sesi di produksi, dan apakah kebijakan tak terbaca harus memblokir? | Keamanan | G-066, G-132 |
| Q-08 | Apa aturan upah kurir (dasar, jam sibuk, tepat waktu, jenjang)? Apakah kurir digaji harian dan per antar? | HR/Finance | G-067, G-081 |
| Q-09 | Kapan selisih setoran dibebankan ke kurir, berapa tenggat setoran dan tutup buku, dan ke mana surplus pergi? | Finance | G-068, G-120 |
| Q-10 | Berapa lama proses penarikan, adakah minimum/biaya/batas harian? Apakah ada pembayaran otomatis tanggal 15? | Finance | G-015, G-069, G-073 |
| Q-11 | Apakah penangguhan depot waralaba harus membekukan payout? | Finance | G-073, G-145 |
| Q-12 | Berapa batas nominal dan SLA keputusan kasbon? | HR/Finance | G-070, G-135 |
| Q-13 | Apa kebijakan cuti sakit (surat dokter), dan apakah kuota 12 hari benar? | HR | G-071 |
| Q-14 | Apakah tabel TER PPh 21 dan tarif BPJS bawaan sudah benar dan siapa memuat tabelnya? | Finance/pajak | G-072 |
| Q-15 | Bagaimana pemohon waralaba menyerahkan dokumen, dan apakah boleh disetujui tanpa checklist lengkap? | Produk/HQ | G-074, G-111, G-113 |
| Q-16 | Bagaimana depot mendapat Asisten SPV selain `/hq/hierarchy`? Haruskah HR/HQ dapat melakukannya? | Operasi | G-075 |
| Q-17 | Nomor/kanal dukungan pusat, jam layanan, dan jalur eskalasi darurat resmi? Siapa pemilik dokumen ini? | Operasi | G-076 |
| Q-18 | Peramban/perangkat resmi dan status rilis Android? | Produk | G-077 |
| Q-19 | Flag mana yang "Belum ditegakkan"? Boleh Head office membuat Head office lain? | Rekayasa/Keamanan | G-078, G-079 |
| Q-20 | Apakah kurir wajib mencatat meteran air? Pintu apa yang dipakai? | Operasi | G-080, G-109 |
| Q-21 | Apakah SPV memang boleh menulis buku kas dan target? Apakah Asisten SPV perlu notifikasi ops? | Finance/Operasi | G-082, G-083 |
| Q-22 | Siapa menyetujui pembatalan pesanan yang belum dikirim, dan apakah Kepala depot dapat memegang tab Meteran/Sengketa/Aturan promo? | Operasi | G-084, G-097 |
| Q-23 | Apakah penghapusan akun harus diblokir bila ada pesanan aktif, dan dari kapan batas 3x24 jam dihitung? | Hukum | G-027, G-138 |
| Q-24 | Apakah Finance harus dapat membuka halaman Pembayaran/Waralaba/Rekonsiliasi/Skema komisi? | Produk | G-086 |
| Q-25 | Alamat privasi mana yang resmi dan kapan MX diperbaiki? | Hukum/Operasi | G-127 |
| Q-26 | Apakah keputusan "refund oleh orang berbeda" dan "payroll maker-checker" akan diwajibkan? | Finance/HR | G-128, G-130 |

---

## 10. Asumsi yang Dipakai Dokumentasi

| No | Asumsi | Dampak bila salah |
|---|---|---|
| AS-01 | Kode repositori pada 2026-10-10 mencerminkan produksi; nilai bawaan kode dipakai bila nilai produksi tidak diketahui (ditandai [K]) | Angka dalam panduan keliru |
| AS-02 | Hak akses mengikuti matriks bawaan `packages/access/src/index.ts`; Super admin dapat mengubahnya saat berjalan (±30 detik), dan cakupan depot ±60 detik | Menu/izin berbeda |
| AS-03 | Belum ada uji peramban/aplikasi; label diambil dari kamus Indonesia (`apps/web/src/lib/dictionaries/id`) dan bisa berbeda di layar | Panduan tak cocok dengan layar |
| AS-04 | Kamus bahasa Inggris tidak dibaca; seluruh label UI memakai Indonesia | Label ganda |
| AS-05 | Pesan Inggris dari server dikutip persis, dan artinya diterjemahkan oleh penulis | Terjemahan kurang tepat |
| AS-06 | Saluran notifikasi nyata = SMS (OTP), push (web/FCM), kotak masuk; WhatsApp dan email dianggap tidak ada | Janji saluran keliru |
| AS-07 | SMS produksi memakai penyedia Zenziva (dugaan dari komentar gerbang) | Detail SMS keliru |
| AS-08 | Waktu penyapu terjadwal dalam WIB (Asia/Jakarta) | Jam salah |
| AS-09 | Contoh data bersifat sintetis; tak ada nomor telepon asli, kredensial, token, atau kunci API dalam dokumen | — |
| AS-10 | "Pelanggan" tidak melihat prosedur internal; panduan pelanggan terpisah dari panduan internal | — |
| AS-11 | Hasil UAT 398/439 tidak dijalankan ulang dan tidak dipakai sebagai bukti kebenaran panduan | — |
| AS-12 | Tidak ada nomor telepon atau email dukungan pusat; hanya jalur yang terdokumentasi di repositori yang dicantumkan | Pengguna tak tahu ke mana |

---

## 11. Keputusan Pemetaan Peran

Dasar: `CONVENTIONS.md` dan `packages/access/src/index.ts`.

### 11.1 Pemetaan permintaan ke kode

| Peran dalam permintaan | Kode sistem | Konsol/pintu | Catatan |
|---|---|---|---|
| Customer | `CUSTOMER` | Aplikasi pelanggan | Satu peran tetap |
| Kepala Depot | `KEPALA_DEPOT` | `/dashboard` | Terkunci satu depot |
| **Staff Depot** | **`STAFF_DEPOT` = kurir** | **`/driver`** (aplikasi kurir) | Keputusan: "Staff Depot" ditulis sebagai kurir; bukan petugas konsol. Label HR: "Staf Depot / Kurir". Tidak ada peran petugas konsol non-kepala; apakah perusahaan membutuhkannya = G-081 / Bab 4 §15 |
| Supervisor | `SUPERVISOR` | `/dashboard`, `/hr` baca | Cakupan = depot Asisten SPV bawahan |
| Asisten Supervisor | `ASSISTANT_SUPERVISOR` | `/dashboard`, `/hr` baca | Pemutus kasbon depot binaan |
| Waralaba | `FRANCHISE_OWNER` | `/dashboard` (ringkasan waralaba) | Tanpa peran operasional di depot |
| HR | `HR` | `/hr` | `hrAdmin`, `hrPayroll`, `leaveApprove` |
| **HQ** | **`HEAD_OFFICE`** (+ `DIREKTUR` dan `FINANCE` yang juga masuk `/hq`) | `/hq` | UI menyebut "Head office" / "Kantor pusat"; `MANAGER` sengaja ditolak dari `/hq` |
| Admin | `SUPER_ADMIN` | Semua pintu | UI: "Super admin" |

### 11.2 Empat peran tambahan di kode (didokumentasikan, tidak diabaikan)

| Kode | Label UI | Fungsi singkat | Dibahas di |
|---|---|---|---|
| `MANAGER` | Manajer | Memegang antrean approval, pembelian, harga, pengaturan depot; tidak masuk `/hq`; konsol ponsel `/m/manager` | Bab 5 Lampiran A; Bab 3 |
| `DIREKTUR` | Direktur | Masuk `/hq`; menyetujui rilis payout (bersama Super admin); `hrAdmin` tanpa payroll | Bab 9 |
| `FINANCE` | Finance | Masuk `/hq`; refund, payout (Lunas/Gagal, Ajukan rilis), komisi, payroll (`hrPayroll`) | Bab 9; Bab 8 |
| `MARKETING` | Marketing | Kampanye, promo, voucher di konsol depot (sebagian) | Bab 9 (batasan), Bab 13 |

### 11.3 Catatan

- "Staff Depot" dalam permintaan tidak sama dengan "staf depot" di Direktori staf: Direktori staf berisi semua peran login, sedangkan peran `STAFF_DEPOT` hanya kurir **[V]**.
- Tabel 13 peran dan konsol lengkap ada di Bab 1 bagian 12.
- Super admin dapat mengubah hak akses saat berjalan; pemetaan di atas adalah nilai bawaan.

---

## 12. Celah Baru yang Ditemukan Saat Menyusun Bab 13 dan 17

| Temuan | ID |
|---|---|
| Penyapu auto-batal berjalan menit :05 dan auto-gagal bayar menit :25 tiap jam sehingga waktu kejadian bisa lebih lama dari 60 menit/24 jam; belum ada layar yang menjelaskan alasan pembatalan otomatis kepada pelanggan | G-020, G-021 (tambahan) |
| Satu nomor OTP reviewer tetap dan saluran `console` adalah risiko konfigurasi produksi | G-141, G-142 |
| Pembaruan token yang dipakai ulang mencabut seluruh keluarga sesi (dua tab/perangkat berbagi sesi dapat saling memutus) [D] | G-132 (tambahan) |
| Antrean luring kurir: tidak semua tindakan diantre (pickup, mulai antar, no-show, setoran, klaim, penarikan, insiden) | G-107 (tambahan) |

*Akhir dokumen. Daftar ini harus diperbarui setiap kali kode atau pengaturan produksi berubah.*
