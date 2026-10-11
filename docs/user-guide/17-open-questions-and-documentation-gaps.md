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

(Catatan: Bab 13 menyebut penonaktifan Super admin terakhir sebagai G-097; lihat nomor yang benar di kategori (f), G-129, dan tabel silang di bagian 8.)

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

