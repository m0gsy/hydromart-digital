# Hydromart — Analisa Peluang Pengembangan (commit 1e93545a2) — PARTIAL

Audit statis; file lokal, belum dipublikasikan. Baseline utama tanpa perubahan tracked. Disusun 2026-11-03T13:50+07:00 (Asia/Jakarta).


## 1. Ringkasan Eksekutif

Implementasi telah melampaui MVP: layanan transaksi, HR, CRM, waralaba, mobile dan pelaporan tersedia. Peluang terpenting berada pada konsistensi efek lintas layanan, pemulihan kegagalan, pembatasan ekspor dan kualitas data laporan. Risiko berikut adalah skenario source-level; tidak ada pengukuran kerugian atau kejadian produksi.

| Prioritas | Peluang | Alasan |
| --- | --- | --- |
| FLW-010 | Outbox selesai meski efek stok/poin/referral/pendapatan gagal | [INFERRED] Handler memenuhi Promise tanpa throw ketika adapter gagal; run menandai DONE. Kegagalan lookup pemilik juga mengembalikan null sehingga memperbaiki adapter payout saja tidak cukup. |
| FLW-008 | Pulihkan efek samping setelah proof of delivery tersimpan | complete DELIVERED replay langsung return; advance order error hanya log; push earning dan webhook dijalankan void. Adapter payout menjawab false saat error, yang tidak direkonsiliasi pada jalur ini. |
| FLW-003 | Kunci gerakan GALON menyamakan issue dan return satu order | [INFERRED] Kedua arah membawa orderId yang sama pada item GALON yang sama; setelah movement pertama, moveRawLine mengembalikan shortfall 0 tanpa gerakan kedua. |
| FLW-004 | Penerimaan PO belum atomik terhadap retry/crash/paralel | [INFERRED] PO dibaca SENT, seluruh receiveStock dilakukan, lalu lines/status ditulis satu kali; repository update hanya where id. Dua penerimaan atau retry setelah crash dapat menggandakan stok. |
| FLW-020 | Logout native kehilangan bearer sebelum revoke dan unsubscribe | signOut memulai request auth lalu clearTokens pada tick sama. request menunggu waitForSession sebelum rawRequest membaca bearer. await atas promise yang sudah resolved pun menunda kelanjutan; token sudah null. nativeUnsubscribe juga menunggu readEndpoint. Gateway native meneruskan bearer yang diterima ke auth/logout SelfScoped. |
| AUT-012 | Ekspor karyawan melewati redaksi depot peminjam | [INFERRED] employeeReport memakai depotScopeIds lalu mencetak NIK/NPWP/rekening/gaji dari Employee penuh; tidak memakai homeDepot redaction seperti list. Dampak borrower memerlukan penugasan lintas depot aktif. |
| FLW-016 | Pertahankan pembayaran berbukti dalam antrean tinjau saat TTL lewat | findStalePending menyaring status/metode/createdAt tanpa proofUrl; sweep CAS PENDING menjadi FAILED. Bukti unggah bukan bukti uang sudah masuk, tetapi membutuhkan tinjau sebelum status terminal. |
| FLW-005 | Replay reschedule selalu memulihkan handoff order | Status RESCHEDULED disimpan sebelum advanceOrder(PREPARING). Replay tanggal sama memanggil finishRescheduleReplay, tetapi segera return jika cashReturned tidak true. |
| FLW-002 | Kampanye memakai lease tetapi belum meneruskan dedupeKey per penerima | [INFERRED] Notification ditulis sebelum recordRecipientResult. Lease recipient dapat kedaluwarsa; replay memanggil notify tanpa dedupeKey dan membuat row/push baru. |


**Status PARTIAL:** artefak laporan telah disatukan, tetapi audit seluruh source belum selesai. Jangan membaca jumlah endpoint/model sebagai bukti seluruh fungsi telah diperiksa. Tidak ada kode implementasi yang diubah.


## 2. Metodologi dan Cakupan

Prompt audit terakhir Claude dipulihkan dari sesi lokal dan checkpoint pada commit yang sama. Otorisasi: baca source, tulis hanya docs/analysis. Agent lama dan resume digunakan untuk wilayah terpisah; primary menguji kembali klaim prioritas terhadap source.

| Scope | READ | SKIPPED | BLOCKED | UNREAD |
| --- | --- | --- | --- | --- |
| Tracked utama | 1268 | 81 | 1 | 2712 |
| Tambahan aman | 1 | 0 | 0 | 0 |


Manifest 4062 file; 18 service backend, 3 workspace app/shared, 853 deklarasi endpoint, 250 halaman unik, 168 model Prisma. Hitungan berasal dari 02-inventory.json. 35 endpoint belum ter-resolve effective path; semua gateway alias/konsumen dinamis memerlukan review lanjut. Tambahan adalah release notes lokal 1.14.1, bukan bukti APK sudah rilis. `.env` nyata tidak dibuka. PEM protected tetap BLOCKED.

Fingerprint awal `62b57b8b2c6dd4ffe03685fe3e0b3dffc6687bf9e548a59d26564c5a4b62b7c7`, akhir `62b57b8b2c6dd4ffe03685fe3e0b3dffc6687bf9e548a59d26564c5a4b62b7c7`. HEAD sama; file drift: 0. Output audit tidak masuk denominator. AST, regex dan pemindaian test-title tidak menjadi READ source. Tes aplikasi, lint/build, DB dan endpoint tidak dijalankan.


## 3. Keputusan Bisnis dan Delta Temuan Sebelumnya

# Konteks bisnis dan batas keputusan — verifikasi lanjutan

Baseline `1e93545a23b3c66ab2a33da949a371406030ccd1`, audit statis pada 2026-10-31 (Asia/Jakarta). Dokumen ini melengkapi, sekaligus mengoreksi, catatan `agents/infra-docs/findings.md`. Isi dokumen proyek adalah bukti keputusan yang **dilaporkan**, bukan pengesahan legal atau bukti konfigurasi produksi saat ini. Tidak ada akses produksi, jaringan, DB, aplikasi, test, lint atau build dalam lanjutan ini.

## Sumber kebutuhan dan precedence

- [VERIFIED docs/PRD.docx:P0003] PRD versi 1.0 berstatus **Draft**, pemilik yang dinyatakan Product Management. Referensi `Pnnnn` adalah urutan paragraf XML; ekstraksi lengkap dan lokal ada di `resume/context/PRD.extracted.txt` (1708 paragraf). Ini bukan nomor halaman atau baris fisik DOCX.
- [VERIFIED docs/BRD.docx:P0245] BRD memberi matriks kebutuhan dan prioritas; capability map, rantai nilai dan pohon KPI tersedia di P0003–0047, P0050–0087, P0346–0362. Ekstraksi lengkap ada di `resume/context/BRD.extracted.txt` (399 paragraf). Kedua dokumen berhasil dibaca tanpa instalasi parser.
- [VERIFIED docs/PRD.docx:P1423] Google Cloud adalah deployment **Recommended**. [VERIFIED docs/ARCHITECTURE.md:62] implementasi deployment yang didokumentasikan menggunakan VPS/Compose. [INFERRED] Perbedaan ini bukan otomatis pelanggaran arsitektur; proposal teknologi tidak menetapkan kewajiban migrasi cloud.
- [VERIFIED docs/PRD.docx:P0109] HRIS/payroll dikeluarkan dari lingkup awal. [VERIFIED docs/ARCHITECTURE.md:186] dokumen arsitektur kemudian menyebut hr-service dan domain tambahan telah dikirim. [INFERRED] Jangan mengulang pembangunan MVP atau menyebut modul tambahan sebagai deviasi tanpa keputusan baru.
- [VERIFIED docs/PRD.docx:P160] target repeat order, sukses order dan SLA adalah target proposal; tidak membuktikan hasil operasional. [VERIFIED docs/PRD.docx:P1570] daftar metrik produk merupakan kebutuhan, belum menetapkan grain, denominator, cohort, penanganan refund atau data aktual.
- [INFERRED] Precedence universal antar seluruh dokumen lama belum ditemukan dalam cakupan pemeriksaan ini (SEARCH-CTX-06). Pertentangan dicatat, bukan diputus sendiri. Source saat ini dipakai untuk fakta implementasi; keputusan eksplisit pemilik dipakai sebagai batas usulan dengan tanggal dan sumbernya.

## Keputusan eksplisit yang relevan (ID melanjutkan daftar agent sebelumnya)

| ID | Keputusan yang dilaporkan / otoritas / tanggal | Sumber dan status audit |
|---|---|---|
| DEC-01 | Pemilik 2026-09-25: diskon membership dan expiry poin berlaku sesuai desain; setelan perlu diaktifkan | [VERIFIED docs/GO_LIVE.md:29]. Konfigurasi produksi **belum diverifikasi**; jangan menyebut expiry tidak dibangun hanya karena default inert |
| DEC-02 | Pemilik 2026-09-25: DEMO-01 dinonaktifkan setelah review Play, diaktifkan kembali sebelum review berikutnya | [VERIFIED docs/GO_LIVE.md:94]. Instruksi operasional; status review saat audit tidak diketahui |
| DEC-03 | Pemilik 2026-09-25: latihan kehilangan VPS penuh saat pindah VPS sebelum DNS | [VERIFIED docs/DISASTER_RECOVERY.md:150]. Bukan bukti latihan telah dijalankan |
| DEC-04 | Pemilik memilih penyedia backup kedua; provisioning masih tugas pemilik dalam dokumen | [VERIFIED docs/DISASTER_RECOVERY.md:213]. Kode second-provider ada [VERIFIED scripts/backup-second-provider.sh:30]; env aktual tidak dibaca |
| DEC-06 | Retensi backup objek PoD/payment-proof 395 hari | [VERIFIED docs/DISASTER_RECOVERY.md:20]. Kebijakan dokumen; bukan pembuktian lifecycle bucket aktif |
| DEC-07 | Pemilik 2026-09-04: belum PKP, jangan aktifkan pajak; buka kembali ketika kondisi usaha berubah | [VERIFIED docs/CONSOLE_AUDIT_REGISTER.md:350]. Sumber yang sama membolehkan layar/setelan pajak tetap tersedia dengan default 0; koreksi interpretasi IDO-06 di bawah |
| DEC-08 | Pemilik 2026-09-01: retensi FINANCIAL 10 tahun tetap, perbaiki teks penghapusan | [VERIFIED docs/CONSOLE_AUDIT_REGISTER.md:57]. Jangan mengusulkan penghapusan semua transaksi keuangan sebagai perbaikan PDP tanpa keputusan baru |
| DEC-09 | Pemilik 2026-09-04: pesanan batal harus melalui pengembalian uang | [VERIFIED docs/CONSOLE_AUDIT_REGISTER.md:332]; sejalan PRD BR-007 [VERIFIED docs/PRD.docx:P1113]. Kebijakan bukan bukti uang telah ditransfer |
| DEC-10 | Depot membuat voucher langsung; antrean persetujuan HQ dilepas | [VERIFIED docs/CONSOLE_AUDIT_REGISTER.md:340], [VERIFIED docs/EVALUATION_11_ITEMS_TRACKER.md:38]. Membangun ulang approval otomatis bertentangan dengan keputusan |
| DEC-11 | Pemilik 2026-09-04: payroll boleh disetujui saat absensi PENDING dengan peringatan; koreksi periode berikutnya | [VERIFIED docs/CONSOLE_AUDIT_REGISTER.md:247]. Jangan mengubah ke blok mutlak tanpa keputusan baru |
| DEC-12 | Kunci privat backup env harus disimpan di password manager di luar VPS | [VERIFIED docs/DISASTER_RECOVERY.md:80]. Lokasi dan salinan kunci aktual belum diverifikasi; berkas PEM tidak dibuka |
| DEC-13 | FINANCE mendapat HQ; catatan MARKETING bertentangan di register | [VERIFIED docs/CONSOLE_AUDIT_REGISTER.md:314] menyebut MARKETING tidak mendapatnya, tetapi [VERIFIED docs/CONSOLE_AUDIT_REGISTER.md:315] menyebut D11 memberi MARKETING pintu sama. [VERIFIED packages/access/src/index.ts:574] default `hqConsole` saat ini tidak memuat MARKETING. Konflik dokumentasi; jangan menyimpulkan akses produksi dari default karena runtime override tersedia |
| DEC-14 | Pemilik: istirahat tidak dibayar 60 menit, Jumat 90 menit, dapat disetel per depot | [VERIFIED docs/CONSOLE_AUDIT_REGISTER.md:244]. Rumus/override harus dibaca sebelum menganggap potongan sebagai bug |
| DEC-15 | Pemohon dan pemutus approval berbeda orang | [VERIFIED docs/CONSOLE_AUDIT_REGISTER.md:318]. Pengecualian payroll SUPER_ADMIN yang lebih baru dinyatakan di DEC-17 |
| DEC-16 | Pemilik 2026-09-11: role FINANCE/HR/MARKETING hanya diberikan SUPER_ADMIN; MANAGER oleh SUPER_ADMIN/HR. Marketing fail-closed, transaksional fail-open. Voucher/banner MANAGER tetap **seluruh jaringan**. Katalog MANAGER diperbolehkan dengan audit. Poin dibatasi depot dan plafon | [VERIFIED docs/SECURITY_AUDIT_REGISTER.md:15]–25. **PLP-04: ⚠ BERTENTANGAN DENGAN KEPUTUSAN** bila diusulkan sebagai pembatasan MANAGER ke depot tanpa persetujuan baru. Jangan masukkan sebagai Quick Win |
| DEC-17 | Pemilik 2026-10-14: pembuat slip tidak menyetujui sendiri kecuali SUPER_ADMIN; pembatalan approval khusus SUPER_ADMIN; HEAD_OFFICE baru hanya SUPER_ADMIN; minimum withdrawal dan batas kasbon ditetapkan | [VERIFIED docs/OPEN_GAPS_DECISIONS_2026-10.md:25]. Daftar lama §2 masih memuat pertanyaan yang sudah dijawab §1/§3; jangan menganggap semua pertanyaan lama tetap terbuka |
| DEC-18 | Pemilik 2026-10-14: manajer memutus beban selisih COD, penghapusan akun menolak order terbuka dengan force SUPER_ADMIN, deposit galon ditampilkan belum ditagih, janji refund 1–3 hari kerja | [VERIFIED docs/OPEN_GAPS_DECISIONS_2026-10.md:79]–89. [VERIFIED docs/OPEN_GAPS_DECISIONS_2026-10.md:85] deposit belum masuk total; proyek penagihan lintas service bukan patch UI |
| DEC-19 | Pemilik 2026-10-09: gambar promo tetap bucket AUTH | [VERIFIED docs/EVALUATION_11_ITEMS_TRACKER.md:87]. Jangan merekomendasikan bucket baru hanya karena env promo kosong |
| DEC-20 | Pemilik 2026-10-02: sub-role franchise ditunda sampai ada kebutuhan mitra nyata | [VERIFIED docs/EVALUATION_11_ITEMS_TRACKER.md:53]. Kelompok Jangan dikerjakan dulu |
| DEC-21 | Pemilik 2026-10-18: royalti di luar go-live, tarif belum disepakati dan belum diposting ledger | [VERIFIED docs/AUDIT_FR_MATRIX_2026-10.md:144]. Jangan menggandakan komisi/franchise ledger yang sudah ada sebagai royalti yang telah selesai |
| DEC-22 | Google login sengaja dihapus; transport WABA diganti inbox + web push | [VERIFIED docs/AUDIT_FR_MATRIX_2026-10.md:17], [VERIFIED docs/AUDIT_FR_MATRIX_2026-10.md:160]. Jangan membangun ulang dari draft PRD tanpa keputusan baru |

DEC-05, DEC-23, DEC-24, DEC-25 dari catatan agent awal (kanal alert kedua; registry mode; satu on-call diterima; status page dan pengiriman log ditunda) tetap berupa **catatan dokumen bertanggal**. Pemeriksaan lanjutan membaca bagian relevan runbook, bukan membuktikan operasionalnya; nilai secret, kontak personal dan state provider tidak disalin.

## Koreksi penilaian PPN (IDO-06)

[VERIFIED services/payment-service/src/application/services/tax-settings.service.ts:26]–35 default tarif adalah 0 dan NPWP kosong. [VERIFIED services/order-service/src/application/services/order.service.ts:2051]–2055 hanya menghitung bagian pajak bila tarif >0 dan total >0, mengembalikan percent null bila amount 0. [VERIFIED services/order-service/src/infrastructure/http/tax-rate.http.adapter.ts:24]–52 membaca tarif internal dengan timeout 3 detik, cache 5 menit dan fallback terakhir/null.

[VERIFIED docs/CONSOLE_AUDIT_REGISTER.md:350] keputusan lama secara eksplisit mempertahankan layar/form pajak dengan aktivasi tarif disengaja. Karena itu, **keberadaan taxAmount/taxPercent bukan bukti pajak salah dipungut atau bukti pelanggaran keputusan**. [VERIFIED docs/LEGAL_OPEN_ITEMS.md:21]–24 dan [VERIFIED docs/BRIEF_AKUNTAN.md:19]–22 masih mengatakan tidak ada baris pajak, sementara [VERIFIED docs/AUDIT_FR_MATRIX_2026-10.md:60] menyatakan pencatatan PPN per order. IDO-06 dipertahankan sebagai rekonsiliasi dokumentasi dan konfirmasi akuntan/pemilik, dampak 2, bukan cacat keuangan terverifikasi. Konfigurasi produksi dan status PKP tidak diketahui; audit tidak memberikan kesimpulan legal.

## Role resmi dan batas akses

[VERIFIED packages/access/src/index.ts:20]–40 mencantumkan 13 built-in role: CUSTOMER, STAFF_DEPOT, KEPALA_DEPOT, ASSISTANT_SUPERVISOR, SUPERVISOR, MANAGER, DIREKTUR, FRANCHISE_OWNER, HEAD_OFFICE, FINANCE, HR, MARKETING, SUPER_ADMIN; `RoleKey` juga mengizinkan `C_<slug>` untuk custom role. **Driver/kurir adalah workflow STAFF_DEPOT, bukan enum role DRIVER terpisah.** Finance, HR dan Marketing memang role source, bukan sekadar nama persona.

[VERIFIED packages/access/src/index.ts:15]–18 mendokumentasikan STAFF_DEPOT/KEPALA_DEPOT terkunci satu depot, tiga tingkat supervisi di resolved-set, DIREKTUR dan kantor network-wide. Itu komentar model default; kontrol aktual guard, runtime override, ownership dan jalur endpoint perlu ditelusuri oleh owner kode. [VERIFIED packages/access/src/index.ts:574] default `hqConsole` memuat HEAD_OFFICE, DIREKTUR, FINANCE, SUPER_ADMIN; [VERIFIED packages/access/src/index.ts:584] `hqBackOffice` hanya HEAD_OFFICE, DIREKTUR, SUPER_ADMIN. Jangan menyamakan akses shell HQ dengan wewenang semua aksinya.

## Pertanyaan bisnis yang masih relevan

1. [ASSUMPTION; DEC-07] Apakah ada keputusan PKP/tarif sesudah keputusan 2026-09-04, dan siapa akuntan penanggung jawab? Tidak memblokir pencatatan konflik dokumen.
2. [ASSUMPTION; DEC-13] Apakah MARKETING seharusnya punya HQ shell atau tetap console depot? Dua baris register bertentangan; runtime overrides tidak diakses.
3. [ASSUMPTION; DEC-18] Kapan deposit galon mulai ditagih, bagaimana refund-nya, dan siapa yang menandatangani snapshot amount/jalur COD? Belum siap diimplementasikan sebagai Quick Win.
4. [ASSUMPTION; DEC-21] Tarif, periode, dasar royalti dan perlakuan akuntansinya apa? Jangan mengaktifkan posting otomatis sebelum keputusan.
5. [ASSUMPTION; IDO-04] Apakah penyedia menjamin enkripsi sisi server untuk bucket dump, bagaimana kebijakan kunci dan pemulihannya? Source hanya membuktikan gzip dan upload bytes tanpa enkripsi klien.
6. [ASSUMPTION; DEC-04/12] Apakah bucket provider kedua dan salinan privat backup sudah siap di luar VPS? Dokumen historis tidak cukup untuk status terkini.
7. [VERIFIED docs/LEGAL_OPEN_ITEMS.md:37]–46 persetujuan tabel TER dan kecukupan bukti PDP memerlukan penanggung jawab berkualifikasi. Audit source tidak menetapkan kepatuhan hukum atau rumus pajak legal.

## Batas cakupan

Dokumen besar `AUDIT_L3.md`, `CONSOLE_AUDIT_REGISTER.md`, seluruh play-assets/perf, konfigurasi root dan seluruh script tidak dibaca ulang lengkap dalam lanjutan ini. Rentang tercatat di `resume/context/coverage.json`; temuan lama yang tidak direvalidasi tetap inherited, bukan otomatis VERIFIED. `docs/business/` dan `.Codex/` tidak ditemukan; `.claude/` berisi instruksi proyek yang terbaca sesi utama. Coverage lengkap tidak diklaim.

# Rekonsiliasi temuan lama (PREV)

Status di bawah memisahkan laporan dokumen dari source yang diperiksa sekarang. Tidak ada bukti runtime baru.

| ID | Laporan lama | Delta yang dapat dipastikan pada baseline | Keputusan |
|---|---|---|---|
| PREV-01 | [VERIFIED docs/SECURITY_AUDIT_REGISTER.md:13] menyebut Selesai5; tabel lain masih terbuka | [VERIFIED docs/SECURITY_AUDIT_REGISTER.md:22] PRM-1/PRM-5 justru diterima jaringan. Riwayat commit bukan bukti semua temuan lain selesai; source dibaca per owner | Rekonsiliasi register; jangan salin daftar lama menjadi backlog baru atau mengklaim97 sudah ditutup |
| PREV-02 | Console register menyatakan CA-2-52 pajak selesai lewat default0 | [VERIFIED services/payment-service/src/application/services/tax-settings.service.ts:27] default masih0; [VERIFIED services/order-service/src/application/services/order.service.ts:2051] pencatatan bersyarat ditambahkan | IDO-06 direklasifikasi docs/konfirmasi; tidak ada bukti salah pungut |
| PREV-03 | AUDIT_L3 banyak temuan lama | File tidak dibaca ulang lengkap pada lanjutan konteks | Jangan mengklaim seluruh delta L3 selesai; diwariskan sebagai cakupan terbuka |
| PREV-04 | Readiness register/DR mengakui backup luar kotak dan RPO24h, provider sama | [VERIFIED scripts/backup-second-provider.sh:48] mekanisme provider kedua memakai ulang backup-offsite. [VERIFIED scripts/backup-db.sh:47] dump tetap gzip; upload bytes [VERIFIED scripts/upload-to-s3.mjs:47] | IDO-04 delta baru spesifik enkripsi klien, bukan mengulang klaim backup tidak ada; provisioning provider belum diverifikasi |
| PREV-05 | Legal open items menyatakan non-PPN dan TER menunggu akuntan | [VERIFIED docs/LEGAL_OPEN_ITEMS.md:21] pernyataan mutlak non-PPN usang terhadap fitur bersyarat FR034; default tetap0 | Konfirmasi pemilik/akuntan, jangan menyatakan kepatuhan legal dari source |
| PREV-06 | OPEN_GAPS §2 masih memuat pemisahan payroll/akun terbuka dan refund | [VERIFIED docs/OPEN_GAPS_DECISIONS_2026-10.md:25] dan79 menandai keputusan kemudian dibangun, deposit hanya ditampilkan | Pertanyaan §2 yang terjawab tidak dimasukkan ulang; deposit billing tetap proyek lintas service |
| PREV-07 | EVALUATION11 menyebut subrole franchise belum dibangun | [VERIFIED docs/EVALUATION_11_ITEMS_TRACKER.md:53] ditunda eksplisit YAGNI | Jangan dikerjakan dulu; bukan gap implementasi wajib |
| PREV-08 | DISCOUNT_AUDIT menyebut keputusan E2/E3/E4 diperlukan | [VERIFIED docs/EVALUATION_11_ITEMS_TRACKER.md:34] E2 cart parity, E3 reseller base dikerjakan; E4 langganan sengaja tanpa promo | Jangan mengusulkan lagi tanpa regresi source baru; pembuktian seluruh implementasi milik owner promo/web |
| PREV-09 | PHASE_M_CLOSEOUT menutup milestone lama | Belum dibaca ulang lengkap pada lanjutan konteks | Tidak dipakai sebagai bukti runtime atau closure baru |
| PREV-10 | FR matrix menunda royalti dan mengganti Google/WABA | [VERIFIED docs/AUDIT_FR_MATRIX_2026-10.md:17],144,160 menyatakan itu eksplisit | Jangan membangun ulang sebagai Quick Win; royalti perlu tarif/dasar akuntansi baru |

Kandidat lintas owner yang ditutup/diparkir: PLP-04 bertentangan DEC-16; usulan approval voucher HQ bertentangan DEC-10; usulan WhatsApp/Google hanya dari PRD draft bertentangan DEC-22; sub-role franchise DEC-20 dan posting royalti DEC-21 perlu demand/keputusan lebih dulu.


## 4. Temuan Fitur

### FTR-002 — Lengkapi jejak persetujuan untuk akun yang dibuat lewat login

Kandidat asal `AUT-02`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Login nomor baru membuat CUSTOMER PENDING, lalu verify dapat mengaktifkan akun; recordRegistrationConsent hanya pada register akun baru. Bukan kesimpulan kepatuhan atau dasar hukum.

**Kontrol yang sudah ada.** ConsentService dan pending consent API tersedia; register baru mencatat consent; OTP dan audit auth tersedia.

**Usulan minimum.** Pilih satu titik UX persetujuan yang dapat diaudit bagi semua jalur aktivasi. Jangan mengisi backdated consent untuk akun lama tanpa tindakan pengguna.

**Acceptance criteria.** Aktivasi lewat login nomor baru menghasilkan event penerimaan yang eksplisit atau alur pending consent yang disetujui; marketing tidak di-opt-in otomatis.

**Cara verifikasi.** Spec login->verify->consent dan review Legal/Produk; audit ini tidak menjalankan flow.

**Owner.** Produk, Legal dan Backend Auth

**Dependensi / ketidakpastian.** [ASSUMPTION] Pilihan Legal/Produk tentang waktu persetujuan dan dokumen versinya.

**Prioritas.** Dampak 3/5; effort M; Strategis. Alasan effort: Auth dan UX aktivasi tanpa mengubah OTP/reuse controls.

**Risiko.** Kondisi: Sedang. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Jejak penerimaan antar jalur pendaftaran tidak konsisten.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/auth-service/src/application/services/login.service.ts:52] Akun baru dibuat lewat login.

[VERIFIED services/auth-service/src/application/services/otp-verification.service.ts:67] Verify REGISTRATION mengaktifkan dan menerbitkan sesi.

[VERIFIED services/auth-service/src/application/services/registration.service.ts:90] Consent hanya ketika akun belum existing.

### FTR-003 — Pisahkan mutasi alamat biasa dari penggantian alamat utama

Kandidat asal `CUS-01`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] UpdateAddressDto mewarisi isPrimary dari create; service/repository meneruskan patch. Tipe TS tidak menghapus field runtime. Efek 500/primary kosong adalah inferensi constraint/selector, bukan hasil eksekusi.

**Kontrol yang sudah ada.** Update memagari customerId; setPrimaryExclusive tersedia untuk jalur khusus; create/delete memakai lock.

**Usulan minimum.** Hilangkan isPrimary dari DTO patch atau tolak eksplisit; selalu gunakan jalur set-primary yang sudah atomik.

**Acceptance criteria.** PATCH isPrimary ditolak 400 tanpa mengubah alamat; set-primary resmi bekerja dan tetap satu primary saat paralel.

**Cara verifikasi.** DTO/controller contract spec dan regresi address race.

**Owner.** Backend Customer

**Dependensi / ketidakpastian.** [ASSUMPTION] Tidak ada schema baru; periksa klien lama yang mengirim isPrimary lewat PATCH.

**Prioritas.** Dampak 3/5; effort S; Strategis. Alasan effort: DTO dan mapping lokal, jalur benar sudah ada.

**Risiko.** Kondisi: Sedang. Implementasi: Rendah. Confidence: Tinggi

**Jika ditunda.** Invarian alamat utama dilewati melalui endpoint patch umum.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/customer-service/src/modules/dto/address.dto.ts:87] PartialType mewarisi isPrimary.

[VERIFIED services/customer-service/src/modules/address.controller.ts:89] DTO diteruskan tanpa projection.

[VERIFIED services/customer-service/src/infrastructure/prisma/address.prisma.repository.ts:135] Patch disimpan langsung.

### FTR-008 — HTTP exception code generik untuk 409/422/503

Kandidat asal `PLT-03`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Pemetaan HttpException hanya memberi code khusus lima status; konflik dan unprocessable menerima HTTP_ERROR. Status HTTP tetap benar dan DomainError tetap punya machine code.

**Kontrol yang sudah ada.** DomainError memberikan code stabil; frontend selalu membawa status juga.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Audit caller yang bergantung HTTP_ERROR sebelum kontrak diperluas.

**Acceptance criteria.** ConflictException/Unprocessable/ServiceUnavailable punya code terdokumentasi, status tidak berubah, DomainError code tetap.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Platform engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Audit caller yang bergantung HTTP_ERROR sebelum kontrak diperluas.

**Prioritas.** Dampak 2/5; effort S; Nice-to-have. Alasan effort: Audit caller yang bergantung HTTP_ERROR sebelum kontrak diperluas.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Tinggi

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED packages/platform/src/nest/all-exceptions.filter.ts:83] switch default menghasilkan HTTP_ERROR untuk 409/422/503

[VERIFIED apps/web/src/lib/api.ts:49] ApiError sudah membawa code server

### FTR-011 — Gate editor earning rule belum mengikuti capability server

Kandidat asal `WEB-02`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] UI memakai dua nama role langsung, sedangkan controller memakai Can(earningRules). Kondisi default sama; divergensi terjadi saat capability diubah.

**Kontrol yang sudah ada.** can() sudah membaca capabilities server untuk role sesi.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Konfirmasi keputusan desain 6b terhadap kebijakan override; jangan membuka gate hanya karena role staf.

**Acceptance criteria.** Perubahan earningRules pada snapshot sesi juga mengubah gate dan navigasi editor; default tetap sama.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Frontend engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Konfirmasi keputusan desain 6b terhadap kebijakan override; jangan membuka gate hanya karena role staf.

**Prioritas.** Dampak 2/5; effort S; Nice-to-have. Alasan effort: Konfirmasi keputusan desain 6b terhadap kebijakan override; jangan membuka gate hanya karena role staf.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Tinggi

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED apps/web/src/lib/roles.ts:153] UI literal FINANCE/SUPER_ADMIN

[VERIFIED services/payout-service/src/modules/earning-rule.controller.ts:34] server membaca capability dinamis

[VERIFIED packages/access/src/index.ts:502] default capability sama dengan UI saat ini

### FTR-007 — Override depot adjustMaxPoints tidak dibaca pada adjustment

Kandidat asal `PLP-10`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] [VERIFIED] adjust memanggil config.adjustMaxPoints(null); config menerima depotId dan mendukung override. HQ-only penulisan key tetap kontrol yang benar, jangan dicabut.

**Kontrol yang sudah ada.** Global cap aktif, scope customer/depot dan aktor tersedia; depot manager tidak boleh menaikkan cap sendiri.

**Usulan minimum.** Putuskan apakah cap memang global; jika per-depot, resolve depot yang sah untuk customer dan baca override; jika global, hapus janji konfigurasi depot.

**Acceptance criteria.** Override yang diatur HQ terbaca sesuai scope yang diputuskan, sementara manager tetap tidak dapat menaikkan sendiri.

**Cara verifikasi.** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner.** PO loyalty + backend

**Dependensi / ketidakpastian.** [ASSUMPTION] Definisi depot penanggung jawab adjustment

**Prioritas.** Dampak 1/5; effort S; Nice-to-have. Alasan effort: Definisi depot penanggung jawab adjustment

**Risiko.** Kondisi: Rendah. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-BACKEND; LOY-2 cap sudah berfungsi global; delta janji per-depot yang tidak terpakai.

[VERIFIED services/loyalty-service/src/application/services/loyalty.service.ts:303] Getter dipanggil null

[VERIFIED services/loyalty-service/src/config/loyalty-config.service.ts:71] Getter menerima depotId

[VERIFIED services/loyalty-service/src/modules/settings.controller.ts:26] adjustMaxPoints HQ-only termasuk depot override

### FTR-009 — FileProvider path luas bersifat hardening kondisional

Kandidat asal `PLT-10`; adjudikasi `reclassify`.

**Status / bukti.** PERLU DIPERDALAM; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Template path titik saja tidak membuktikan eksfiltrasi karena provider exported=false dan akses URI memerlukan grant. Perlu caller sharing path untuk menentukan risiko nyata.

**Kontrol yang sudah ada.** Provider tidak diekspor menurut audit awal.

**Usulan minimum.** Persempit path FileProvider hanya setelah memetakan URI yang benar-benar dibagi; jangan merusak export/share yang sah.

**Acceptance criteria.** File share hanya memberi URI subfolder yang dibutuhkan; external/cache path diuji dengan caller sah.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Mobile engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Belum ditelusuri semua caller native share/plugin.

**Prioritas.** Dampak 1/5; effort M; Nice-to-have. Alasan effort: Belum ditelusuri semua caller native share/plugin.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Sedang

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED mobile/android/app/src/main/res/xml/file_paths.xml:3] external-path dan cache-path sama-sama path titik

[VERIFIED mobile/android/app/src/main/AndroidManifest.xml:210] FileProvider tidak diekspor, tetapi mengizinkan URI grant

### FTR-012 — Sebagian teks utilitas belum memakai resolver locale

Kandidat asal `WEB-11`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] STALE_DEPOT_MESSAGE dan fallback gagal kirim berupa literal Indonesia. Dampak lokalisasi terbatas; tidak menghambat fungsi.

**Kontrol yang sudah ada.** Banner memakai keys locale dan error server tetap tersedia.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Gabungkan dengan maintenance locale, tidak mendahului integritas transaksi.

**Acceptance criteria.** Locale alternatif menghasilkan pesan terjemahan tanpa mengubah code/status error.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Frontend engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Gabungkan dengan maintenance locale, tidak mendahului integritas transaksi.

**Prioritas.** Dampak 1/5; effort S; Nice-to-have. Alasan effort: Gabungkan dengan maintenance locale, tidak mendahului integritas transaksi.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Tinggi

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED apps/web/src/lib/offline-queue.ts:185] teks literal depot berubah

[VERIFIED apps/web/src/lib/offline-queue.ts:498] fallback literal pada retry

### FTR-005 — Anonimisasi employee menyisakan field identitas lain

Kandidat asal `HR-23`; adjudikasi `defer-policy`.

**Status / bukti.** PERLU DIPERDALAM; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] [VERIFIED] Patch anonimisasi hanya menimpa nama/telepon/email/photo/authSubjectId (jalur account juga role/status), sedangkan sumber schema memiliki pengenal lain. Penghapusan seluruh field finansial tidak boleh disarankan otomatis tanpa kebijakan retensi.

**Kontrol yang sudah ada.** Biometrik/attendance/reviews dihapus, payload audit dibersihkan, payroll sengaja dipertahankan sesuai komentar aturan finansial.

**Usulan minimum.** Tentukan matriks retensi per field/tujuan dan bedakan pseudonimisasi dari anonimisasi; batasi akses data yang wajib disimpan, hapus yang tidak lagi perlu setelah keputusan sah.

**Acceptance criteria.** Fixture export/scrub menunjukkan kebijakan setiap field; legal/finance menyetujui pengecualian dan akses retained data; tidak ada klaim kepatuhan UU dari tes kode saja.

**Cara verifikasi.** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner.** Legal/finance + backend HR

**Dependensi / ketidakpastian.** [ASSUMPTION] Legal/finance retention field matrix + HR NIK/NPWP/rekening dan dokumen tertentu mungkin diwajibkan retensi; audit ini tidak menilai hukumnya.

**Prioritas.** Dampak 4/5; effort L; Jangan dikerjakan dulu. Alasan effort: Legal/finance retention field matrix + HR

**Risiko.** Kondisi: Tinggi. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-BACKEND; HR-2 sudah membersihkan payload audit; delta employee field yang tidak berada dalam patch scrub.

[VERIFIED services/hr-service/src/infrastructure/prisma/employee.prisma.repository.ts:56] Patch retensi terbatas

[VERIFIED services/hr-service/src/infrastructure/prisma/employee.prisma.repository.ts:94] Patch hapus akun terbatas

[VERIFIED services/hr-service/src/application/services/employee.service.ts:250] Jalur hapus akun memanggil anonymise dan hapus photos

### FTR-004 — Lembur dihitung dari menit kehadiran tanpa approval lembur terpisah pada jalur yang dibaca

Kandidat asal `HR-01`; adjudikasi `reclassify`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] [INFERRED] splitOvertime tidak menerapkan plafon; payroll menambahkan BONUS. Ini bukan auto-paid: slip masih melalui approve/pay dan guard pemisahan pembuat/penyetuju.

**Kontrol yang sudah ada.** PENDING dikecualikan; istirahat dipotong; slip butuh approval; owner decision basis lembur gaji pokok tidak diubah.

**Usulan minimum.** HR menentukan kebutuhan approval/exception atas jam tidak wajar dan plafon bila sah; tampilkan sumber menit agar approver menilai. Jangan menebak batas jam hukum.

**Acceptance criteria.** HR menandatangani kebijakan; contoh shift panjang dan koreksi checkout mengikuti kebijakan tanpa memotong jam sah secara diam-diam.

**Cara verifikasi.** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner.** HR lead + backend HR

**Dependensi / ketidakpastian.** [ASSUMPTION] HR lead dan kebijakan jam/approval [ASSUMPTION] Apakah approval slip saat ini memang persetujuan seluruh lembur?

**Prioritas.** Dampak 3/5; effort M; Jangan dikerjakan dulu. Alasan effort: HR lead dan kebijakan jam/approval

**Risiko.** Kondisi: Sedang. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-BACKEND; CA-1-39/D2 sudah menghapus istirahat dari lembur; delta exception panjang shift, bukan menghitung ulang istirahat.

[VERIFIED services/hr-service/src/application/services/payroll.service.ts:1192] Menghitung splitOvertime dari workedDays

[VERIFIED services/hr-service/src/application/services/payroll.service.ts:1223] Hasil berupa BONUS pada slip

[VERIFIED services/hr-service/src/domain/overtime.ts:75] Semua menit relevan dihitung tanpa plafon

[VERIFIED services/hr-service/src/application/services/payroll.service.ts:749] Payroll memiliki langkah approve

[VERIFIED services/hr-service/src/application/services/payroll.service.ts:761] Pembuat tidak approve kecuali SUPER_ADMIN

[VERIFIED services/hr-service/src/infrastructure/prisma/attendance.prisma.repository.ts:176] Hanya PRESENT/LATE masuk worked minutes

### FTR-006 — Scrub subscription menyisakan alamat dan koordinat

Kandidat asal `ORD-13`; adjudikasi `defer-policy`.

**Status / bukti.** PERLU DIPERDALAM; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] [VERIFIED] erasePerson membatalkan ACTIVE/PAUSED dan mengosongkan recipientName/phone/notes, tidak menyentuh alamat. Kebutuhan menghapus alamat harus dipetakan pada retensi yang disepakati.

**Kontrol yang sudah ada.** Subscription dihentikan sebelum scrub; transaksi mencegah pengiriman plan tanpa identitas.

**Usulan minimum.** Masukkan snapshot alamat/koordinat pada matriks retensi per field dan dokumentasikan status pseudonimisasi/anonymisasi.

**Acceptance criteria.** Alamat retained/deleted mengikuti keputusan PDP dan alur cancel tetap atomik.

**Cara verifikasi.** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner.** Legal/PO + backend order

**Dependensi / ketidakpastian.** [ASSUMPTION] Keputusan retensi PDP per field

**Prioritas.** Dampak 3/5; effort M; Jangan dikerjakan dulu. Alasan effort: Keputusan retensi PDP per field

**Risiko.** Kondisi: Sedang. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-BACKEND; PARSIAL: fitur erasure tersedia, bukan klaim ketiadaan fitur.

[VERIFIED services/order-service/src/infrastructure/prisma/subscription.prisma.repository.ts:197] Cancel dan scrub dalam transaksi

[VERIFIED services/order-service/src/infrastructure/prisma/subscription.prisma.repository.ts:207] Patch hanya name/phone/notes

### FTR-001 — Perjelas semantik BETA/ROLLOUT pada flag publik

Kandidat asal `AAS-10`; adjudikasi `defer-policy`.

**Status / bukti.** PERLU DIPERDALAM; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] publicFlags memetakan semua state kecuali OFF menjadi enabled; enum menjelaskan BETA/ROLLOUT. Belum diketahui apakah owner memerlukan audience gating, jadi tidak menyebut bug rollout produksi.

**Kontrol yang sudah ada.** Hanya tiga enforced key yang dipublikasikan; mutasi platformAdmin.

**Usulan minimum.** PO memilih boolean-only untuk key enforced atau kontrak audience yang eksplisit; jangan membangun eksperimen/AI tanpa demand.

**Acceptance criteria.** State yang diperbolehkan dan arti enabled sama pada UI/backend serta diuji; jika boolean-only, BETA/ROLLOUT ditolak untuk enforced key.

**Cara verifikasi.** Unit flag per state dan penelusuran consumer; tidak menyalakan flag.

**Owner.** Produk dan Platform

**Dependensi / ketidakpastian.** [ASSUMPTION] Keputusan Produk atas lifecycle; konfigurasi produksi tidak dibaca.

**Prioritas.** Dampak 2/5; effort M; Jangan dikerjakan dulu. Alasan effort: Kontrak lintas consumer bila audience gating dipilih.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Arti rolloutPct dapat disalahpahami operator.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/admin-service/src/modules/feature-flags.controller.ts:43] State selain OFF dipublikasikan enabled.

[VERIFIED services/admin-service/src/domain/flag-state.ts:18] Enum punya ROLLOUT/ACTIVE/BETA/OFF.

### FTR-010 — Recommendation service memakai ProductRef lokal tanpa status aktif/depot

Kandidat asal `REC-03`; adjudikasi `reclassify`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Service sepenuhnya dibaca: enrich hanya membuang productRef yang hilang. Dampak end-to-end belum dapat dipastikan sebelum frontend consumer/hydration ditelusuri; bukan bukti produk tidak tersedia tampil pada pelanggan.

**Kontrol yang sudah ada.** Limit ranking dan defensive missing-ref filter; catalog/checkout tetap dapat menolak produk unavailable di jalur lain, belum dibuktikan dalam scope ini.

**Usulan minimum.** Periksa consumer web sebelum keputusan; jika consumer sudah memfilter katalog aktif, tutup klaim tampilan invalid dan nilai hanya kesegaran ProductRef.

**Acceptance criteria.** Trace consumer menunjukkan apakah item inactive/unavailable dapat tampil; rekomendasi baru hanya bila fixture sumber membuktikan gap.

**Cara verifikasi.** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner.** Backend recommendation + frontend

**Dependensi / ketidakpastian.** [ASSUMPTION] Frontend consumer verification

**Prioritas.** Dampak 2/5; effort M; Jangan dikerjakan dulu. Alasan effort: Frontend consumer verification

**Risiko.** Kondisi: Rendah. Implementasi: Sedang. Confidence: Sedang

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-BACKEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/recommendation-service/src/application/services/recommendation.service.ts:42] Reorder tanpa selector depot

[VERIFIED services/recommendation-service/src/application/services/recommendation.service.ts:77] Enrich hanya memakai productRefs



## 5. Temuan Flow

### FLW-002 — Kampanye memakai lease tetapi belum meneruskan dedupeKey per penerima

Kandidat asal `CRM-01`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] [INFERRED] Notification ditulis sebelum recordRecipientResult. Lease recipient dapat kedaluwarsa; replay memanggil notify tanpa dedupeKey dan membuat row/push baru.

**Kontrol yang sudah ada.** Lease claimToken dan reclaim basi tersedia; dedupe notification dan migrasi unik sudah tersedia; marketing opt-out fail-closed.

**Usulan minimum.** Bawa identitas recipient ke delivery port lalu gunakan key deterministik campaign-recipient; tetap bedakan percobaan kampanye baru. Review hasil lease agar stale worker tidak menimpa hasil baru.

**Acceptance criteria.** Crash setelah row notification sebelum result, lalu reclaim recipient: satu inbox row dan paling banyak satu push attempt untuk recipient kampanye itu; kampanye berbeda tetap boleh mengirim.

**Cara verifikasi.** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner.** Backend CRM + marketing

**Dependensi / ketidakpastian.** [ASSUMPTION] Kontrak internal dalam crm; verifikasi migrasi dedupe pada deployment terpisah. Effort M karena port/fake/controller/service tests.

**Prioritas.** Dampak 4/5; effort M; Quick Win. Alasan effort: Kontrak internal dalam crm; verifikasi migrasi dedupe pada deployment terpisah. Effort M karena port/fake/controller/service tests.

**Risiko.** Kondisi: Sedang. Implementasi: Rendah. Confidence: Tinggi

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-BACKEND; CRM-9 sudah menutup duplicate claim antar worker; #766/#771 menambah notification dedupe. Delta pemanggil kampanye belum memakai fasilitas itu.

[VERIFIED services/crm-service/src/application/services/campaign.service.ts:306] Deliver sebelum simpan hasil

[VERIFIED services/crm-service/src/infrastructure/prisma/campaign.prisma.repository.ts:175] SENDING lease basi dapat diklaim ulang

[VERIFIED services/crm-service/src/infrastructure/notification/inbox-broadcast.delivery.ts:38] notify tanpa dedupeKey

[VERIFIED services/crm-service/src/application/services/notification.service.ts:244] Dedupe hanya jika key terisi; existing row tidak push ulang

[VERIFIED services/crm-service/src/infrastructure/prisma/notification.prisma.repository.ts:100] recordOnce menangani unique violation

[VERIFIED services/crm-service/prisma/migrations/20261030140000_notification_dedupe_key/migration.sql:11] Unique index dedupeKey tersedia sebagai migrasi source

[VERIFIED services/crm-service/src/modules/campaign.module.ts:48] InboxBroadcastDelivery terdaftar

[VERIFIED scripts/scheduler/crontab:83] Kampanye diproses setiap dua menit

### FLW-005 — Replay reschedule selalu memulihkan handoff order

Kandidat asal `DLV-01`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Status RESCHEDULED disimpan sebelum advanceOrder(PREPARING). Replay tanggal sama memanggil finishRescheduleReplay, tetapi segera return jika cashReturned tidak true.

**Kontrol yang sudah ada.** CAS status dan replay payload tanggal sama; kegagalan reversal tunai mencoba rollback; handoff mengenali OrderAlreadyClaimedError.

**Usulan minimum.** Pisahkan pemulihan handoff order dari syarat reversal kas; tangani replay order yang sudah mencapai tujuan secara idempoten. Notifikasi harus memakai identitas percobaan agar reassign sah tidak teredam.

**Acceptance criteria.** Advance pertama gagal setelah status tersimpan, retry payload sama tanpa cashReturned menyelesaikan handoff; reversal tunai tidak berulang; order yang sudah direassign tidak dimundurkan.

**Cara verifikasi.** Unit fault injection dan contract replay dengan order-service, termasuk status sudah lanjut. Belum dijalankan.

**Owner.** Backend Delivery

**Dependensi / ketidakpastian.** [ASSUMPTION] Semantik konflik/transisi order yang sudah ada; jangan menelan seluruh 409 sebagai sukses.

**Prioritas.** Dampak 4/5; effort S; Quick Win. Alasan effort: Perubahan lokal helper replay; tanpa schema atau kontrak baru.

**Risiko.** Kondisi: Tinggi. Implementasi: Rendah. Confidence: Tinggi

**Jika ditunda.** Delivery sudah RESCHEDULED sementara order tertahan pada percobaan lama.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/delivery-service/src/application/services/delivery.service.ts:845] Replay return awal bila cashReturned false.

[VERIFIED services/delivery-service/src/application/services/delivery.service.ts:874] Replay tanggal sama menuju helper.

[VERIFIED services/delivery-service/src/application/services/delivery.service.ts:940] Advance order dilakukan setelah status lokal tersimpan.

### FLW-016 — Pertahankan pembayaran berbukti dalam antrean tinjau saat TTL lewat

Kandidat asal `PPA-01`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] findStalePending menyaring status/metode/createdAt tanpa proofUrl; sweep CAS PENDING menjadi FAILED. Bukti unggah bukan bukti uang sudah masuk, tetapi membutuhkan tinjau sebelum status terminal.

**Kontrol yang sudah ada.** CASH dikecualikan; CAS mencegah menimpa PAID; TTL mempunyai kill switch; notifikasi bukti tersedia.

**Usulan minimum.** Pisahkan expiry belum-ada-bukti dari review bukti. Cek proof dalam predicate atomik agar unggah serentak tidak ditimpa. Pertahankan notifikasi dan antrean manual yang sudah ada.

**Acceptance criteria.** PENDING dengan proofUrl tidak menjadi FAILED pada expiry; proof yang masuk serentak dengan sweep mendapat hasil konsisten; PENDING tanpa bukti tetap dapat kedaluwarsa; CASH dan PAID tidak berubah.

**Cara verifikasi.** Unit sweep dan race upload-vs-expire; verifikasi antrean staf. Tidak menjalankan pembayaran nyata.

**Owner.** Backend Payment dan Finance Ops

**Dependensi / ketidakpastian.** [ASSUMPTION] Kontrak review bukti yang sudah ada; Finance menyepakati penanganan bukti invalid melalui jalur fail manual.

**Prioritas.** Dampak 4/5; effort M; Quick Win. Alasan effort: Query dan mutasi satu service; perlu regresi concurrency dan reminder.

**Risiko.** Kondisi: Tinggi. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Pembayaran yang telah mengunggah bukti berpotensi menjadi terminal sebelum staf memeriksanya; frekuensi tidak diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/payment-service/src/infrastructure/prisma/payment.prisma.repository.ts:122] Query stale tanpa pengecualian proof.

[VERIFIED services/payment-service/src/application/services/payment.service.ts:703] Sweep memindah PENDING ke FAILED.

[VERIFIED services/payment-service/src/domain/payment.ts:98] FAILED terminal pada domain transition.

### FLW-020 — Logout native kehilangan bearer sebelum revoke dan unsubscribe

Kandidat asal `WEB-01`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] signOut memulai request auth lalu clearTokens pada tick sama. request menunggu waitForSession sebelum rawRequest membaca bearer. await atas promise yang sudah resolved pun menunda kelanjutan; token sudah null. nativeUnsubscribe juga menunggu readEndpoint. Gateway native meneruskan bearer yang diterima ke auth/logout SelfScoped.

**Kontrol yang sudah ada.** Pembersihan profil/lokasi/depot/familyId sudah ada; gateway selalu membersihkan cookie web dan mengembalikan revoked; subscribe berikutnya mengganti pemilik endpoint.

**Usulan minimum.** Tangkap token pada request revoke/unsubscribe sebelum clear, atau tunggu revoke dengan deadline lalu selalu bersihkan lokal. Jangan biarkan jaringan macet menahan logout.

**Acceptance criteria.** Pada native sesi terbuka, signOut membuat POST logout dan DELETE push memakai bearer sebelum pembersihan; server revoke mengembalikan revoked=true. Saat layanan gagal, pembersihan lokal tetap selesai dengan deadline dan UI membedakan revoke belum terbukti.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Frontend/mobile engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Pertahankan token di snapshot request atau selesaikan revoke/unsubscribe secara terbatas sebelum clear. Jangan mengandalkan urutan pemanggilan promise.

**Prioritas.** Dampak 4/5; effort S; Quick Win. Alasan effort: Pertahankan token di snapshot request atau selesaikan revoke/unsubscribe secara terbatas sebelum clear. Jangan mengandalkan urutan pemanggilan promise.

**Risiko.** Kondisi: Tinggi. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Tinggi

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED apps/web/src/lib/auth-context.tsx:151] logout fire-and-forget dan unsubscribe diikuti clearTokens tanpa await

[VERIFIED apps/web/src/lib/api.ts:383] request menunggu sebelum rawRequest

[VERIFIED apps/web/src/lib/api.ts:265] rawRequest membaca bearer dari token store saat dijalankan

[VERIFIED apps/web/src/lib/token-store.ts:163] setTokens(null) menghapus token memori secara sinkron

[VERIFIED apps/web/src/lib/push.ts:212] unsubscribe membaca endpoint asinkron sebelum DELETE

[VERIFIED services/gateway-service/src/routing/session-bff.ts:253] native logout membaca Authorization request dan meneruskannya ke auth-service

[VERIFIED services/auth-service/src/modules/auth/account.controller.ts:388] logout SelfScoped memakai CurrentUser untuk actorCustomerId

### FLW-010 — Outbox selesai meski efek stok/poin/referral/pendapatan gagal

Kandidat asal `ORD-01`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] [INFERRED] Handler memenuhi Promise tanpa throw ketika adapter gagal; run menandai DONE. Kegagalan lookup pemilik juga mengembalikan null sehingga memperbaiki adapter payout saja tidak cukup.

**Kontrol yang sudah ada.** Outbox ditulis bersama status; backoff 6 percobaan dan 10 untuk PAYMENT_REVERSAL; pembatalan order mencegah side effect baru; reversal pembayaran/pendapatan sudah dapat throw.

**Usulan minimum.** Bedakan integrasi nonaktif yang sah dari dependency unavailable; failure efek wajib harus mempertahankan PENDING. Audit idempotensi penerima dan kompensasi lebih dahulu, khususnya referral reward; tambahkan alert/replay dengan batas kewenangan.

**Acceptance criteria.** Untuk setiap topik, 500/timeout tidak menghasilkan DONE; pemulihan dependency menghasilkan satu efek bisnis; pengulangan/referral tidak memberi reward ganda; HKP tanpa pemilik tetap no-op yang sah.

**Cara verifikasi.** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner.** Backend order + pemilik depot/loyalty/referral/payout + SRE

**Dependensi / ketidakpastian.** [ASSUMPTION] Validasi idempotensi penerima per orderId, REF-01, strict lookup ownership, rollout lintas service. Effort L karena kontrak failure dan efek uang lintas database.

**Prioritas.** Dampak 5/5; effort L; Strategis. Alasan effort: Validasi idempotensi penerima per orderId, REF-01, strict lookup ownership, rollout lintas service. Effort L karena kontrak failure dan efek uang lintas database.

**Risiko.** Kondisi: Tinggi. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-BACKEND; Berbeda dari H-10/CA-5-01: outbox dan scheduler sudah ada, gap berada pada failure contract adapter. Bukan usulan menambah outbox kedua.

[VERIFIED services/order-service/src/application/services/order.service.ts:337] Registrasi handler empat topik pada constructor

[VERIFIED services/order-service/src/application/services/outbox.service.ts:125] deliver diikuti markDone; retry hanya di catch

[VERIFIED services/order-service/src/infrastructure/http/inventory.http.adapter.ts:67] consume menelan error

[VERIFIED services/order-service/src/infrastructure/http/loyalty-coordination.http.adapter.ts:59] awardPoints gagal mengembalikan null

[VERIFIED services/order-service/src/infrastructure/http/referral-coordination.http.adapter.ts:39] qualify menelan error

[VERIFIED services/order-service/src/infrastructure/http/franchise-revenue.http.adapter.ts:70] orderCompleted gagal mengembalikan null

[VERIFIED services/order-service/src/infrastructure/http/depot-directory.http.adapter.ts:202] lookup pemilik gagal mengembalikan null

[VERIFIED services/order-service/src/application/services/order.service.ts:2319] null ownership menyebabkan handler return

[VERIFIED services/order-service/src/modules/order.module.ts:88] Provider adapter nyata didaftarkan

[VERIFIED scripts/scheduler/crontab:37] Outbox dipicu setiap 10 menit

### FLW-003 — Kunci gerakan GALON menyamakan issue dan return satu order

Kandidat asal `DEP-01`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] [INFERRED] Kedua arah membawa orderId yang sama pada item GALON yang sama; setelah movement pertama, moveRawLine mengembalikan shortfall 0 tanpa gerakan kedua.

**Kontrol yang sudah ada.** Ledger issue/return dan idempotensi per order sudah ada; refund dibatasi outstanding deposit.

**Usulan minimum.** Pisahkan identitas kejadian issue vs return pada movement dan desain migrasi/backfill terukur; pertahankan replay masing-masing arah.

**Acceptance criteria.** Issue 2 dan return GOOD 2 pada order sama menghasilkan dua movement dengan net 0, di kedua urutan; replay setiap arah tidak menggandakan movement.

**Cara verifikasi.** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner.** Backend depot + operasi stok

**Dependensi / ketidakpastian.** [ASSUMPTION] Schema key movement, pra-cek histori dan saldo; effort L karena data lama dan migrasi identitas event

**Prioritas.** Dampak 4/5; effort L; Strategis. Alasan effort: Schema key movement, pra-cek histori dan saldo; effort L karena data lama dan migrasi identitas event

**Risiko.** Kondisi: Tinggi. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-BACKEND; CA-2-57 sudah menghubungkan buku galon ke stok; delta collision kedua arah pada key baru itu.

[VERIFIED services/depot-service/src/application/services/gallon-issue.service.ts:231] Issue meneruskan orderId

[VERIFIED services/depot-service/src/application/services/gallon-return.service.ts:108] Return meneruskan orderId pada moveRawLine

[VERIFIED services/depot-service/src/application/services/gallon-return.service.ts:414] Courier return meneruskan input.orderId

[VERIFIED services/depot-service/src/application/services/inventory.service.ts:875] Movement yang sudah ada membuat no-op

[VERIFIED services/depot-service/prisma/schema.prisma:303] Unique itemId,orderId

### FLW-004 — Penerimaan PO belum atomik terhadap retry/crash/paralel

Kandidat asal `DEP-02`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] [INFERRED] PO dibaca SENT, seluruh receiveStock dilakukan, lalu lines/status ditulis satu kali; repository update hanya where id. Dua penerimaan atau retry setelah crash dapat menggandakan stok.

**Kontrol yang sudah ada.** Kuantitas outstanding dibatasi; kegagalan booking baris tetap outstanding dan unbooked dilaporkan.

**Usulan minimum.** Unit transaksi receipt lokal atau receipt line beridentitas idempoten; CAS saja sebelum posting perlu jalur crash recovery. Pertahankan partial receipt.

**Acceptance criteria.** Dua receive paralel tidak menaikkan stok dua kali; crash setelah line pertama lalu retry tidak menggandakan line itu; baris gagal tetap outstanding.

**Cara verifikasi.** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner.** Backend depot + procurement

**Dependensi / ketidakpastian.** [ASSUMPTION] Repository PO + inventory dalam database depot; effort M karena unit transaksi domain tunggal

**Prioritas.** Dampak 4/5; effort M; Strategis. Alasan effort: Repository PO + inventory dalam database depot; effort M karena unit transaksi domain tunggal

**Risiko.** Kondisi: Tinggi. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-BACKEND; CA-2-31/CA-2-55 telah membenahi partial receipt/status; delta crash/concurrency. Komentar 148-151 menjanjikan persist per line tetapi implementasi 270 hanya sekali.

[VERIFIED services/depot-service/src/application/services/purchase-order.service.ts:159] Pre-check SENT

[VERIFIED services/depot-service/src/application/services/purchase-order.service.ts:227] Loop posting receiveStock

[VERIFIED services/depot-service/src/application/services/purchase-order.service.ts:270] Satu update PO setelah loop

[VERIFIED services/depot-service/src/infrastructure/prisma/purchase-order.prisma.repository.ts:75] Update berdasarkan id tanpa expected version

### FLW-007 — Tutup celah jendela pertanggungjawaban COD pada shift basi

Kandidat asal `DLV-05`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Auto-close memakai expectedEndAt sementara assignableShift tidak memeriksa waktu; settlement memilih deliveredAt dalam jendela shift. Delivery selesai setelah expectedEndAt sebelum check-in baru dapat berada di luar dua jendela (inferensi).

**Kontrol yang sudah ada.** Failed dan rescheduled cash sudah termasuk codBearingInWindow; setoran fail-closed; daftar unsettled tersedia.

**Usulan minimum.** Hubungkan pertanggungjawaban delivery ke shift atau buat recovery eksplisit bagi interval yang tidak tercakup; jangan mengubah attendance checkout untuk menyamarkan waktu kerja.

**Acceptance criteria.** Delivery selesai di celah expectedEndAt/check-in baru tetap dapat disetor dan tidak dihitung dua kali pada shift mana pun.

**Cara verifikasi.** Spec jendela shift stale dan end-to-end settlement dengan ledger kas fake; race nyata sebelum rollout.

**Owner.** Backend Delivery dan Finance Ops

**Dependensi / ketidakpastian.** [ASSUMPTION] Aturan Ops/Finance untuk shift penanggung jawab dan join payment tunai.

**Prioritas.** Dampak 4/5; effort L; Strategis. Alasan effort: Menyentuh kepemilikan setoran, shift, dan sumber payment; perlu rekonsiliasi historis.

**Risiko.** Kondisi: Tinggi. Implementasi: Tinggi. Confidence: Sedang

**Jika ditunda.** Kas dapat tidak termuat dalam settlement rutin; jumlah aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/delivery-service/src/application/services/shift.service.ts:232] Shift stale berakhir pada expectedEndAt.

[VERIFIED services/delivery-service/src/application/services/shift.service.ts:200] Assignable hanya mengecek adanya shift dan status.

[VERIFIED services/delivery-service/src/infrastructure/prisma/delivery.prisma.repository.ts:444] Kas dipilih dengan timestamp dalam jendela.

### FLW-008 — Pulihkan efek samping setelah proof of delivery tersimpan

Kandidat asal `DLV-07`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] complete DELIVERED replay langsung return; advance order error hanya log; push earning dan webhook dijalankan void. Adapter payout menjawab false saat error, yang tidak direkonsiliasi pada jalur ini.

**Kontrol yang sudah ada.** PoD disimpan dahulu dengan CAS; earning mempunyai sourceRef per delivery; HTTP timeout dan log tersedia. Pemulihan manual mungkin dilakukan, bukan dibuktikan otomatis.

**Usulan minimum.** Persist intent handoff/earning/event bersama PoD atau antrean recovery durable. Reuse sourceRef penerima; identitas webhook perlu dedup tersendiri sebelum retry. Bedakan configuration disabled dari transient failure.

**Acceptance criteria.** Dependency gagal setelah PoD, pulih lalu handoff order dan earning tercatat sekali; retry tidak menggandakan insentif; poison item terlihat dan bisa direplay; crash setelah commit tidak kehilangan intent.

**Cara verifikasi.** Fault injection tiap boundary dan real-Postgres concurrency pada journal; staging tanpa transaksi nyata.

**Owner.** Backend Delivery, Order, Payout dan SRE

**Dependensi / ketidakpastian.** [ASSUMPTION] Order transition replay; payout idempotency termasuk insentif; admin webhook eventId. Gabungkan AAS-11 untuk sisi publisher, bukan membuat outbox kedua.

**Prioritas.** Dampak 4/5; effort L; Strategis. Alasan effort: Kontrak/journal lintas service dan rollout penerima sebelum produser.

**Risiko.** Kondisi: Tinggi. Implementasi: Tinggi. Confidence: Tinggi

**Jika ditunda.** PoD dapat benar sementara status order, earning, atau partner event tertinggal saat dependency gagal.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/delivery-service/src/application/services/delivery.service.ts:436] Replay DELIVERED tidak melanjutkan side effect.

[VERIFIED services/delivery-service/src/application/services/delivery.service.ts:493] Handoff failure hanya log dan break.

[VERIFIED services/delivery-service/src/application/services/delivery.service.ts:505] Earning/event asynchronous void.

[VERIFIED services/delivery-service/src/infrastructure/http/courier-payout.http.adapter.ts:102] Error push menghasilkan false.

[VERIFIED services/payout-service/src/application/services/courier-payout.service.ts:82] Earning sourceRef deterministic sudah tersedia.

### FLW-011 — Penjualan konter dan pencatatan pembayaran masih dua langkah

Kandidat asal `ORD-06`; adjudikasi `reclassify`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] [INFERRED] Penjualan pickup dibuat COMPLETED dan completion outbox ditulis sebelum browser mencatat pembayaran. Klaim lama tidak ada tampilan rekonsiliasi salah: payment-recon sudah menampilkan order tanpa payment dan jalur remediasi.

**Kontrol yang sudah ada.** Idempotency-Key penjualan; pembayaran aktif tidak digandakan; UI retry pembayaran; layar rekonsiliasi manual tersedia.

**Usulan minimum.** Putuskan apakah completed berarti barang diserahkan atau pembayaran diterima; tambahkan recovery durable/exception aging pada alur existing jika diperlukan, bukan layar recon baru.

**Acceptance criteria.** Tutup browser setelah order create sebelum payment; operator tetap menemukan dan menyelesaikan kewajiban tersebut sekali. Outbox earning/revenue mengikuti definisi bisnis final.

**Cara verifikasi.** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner.** PO + operasi kasir + backend order/payment

**Dependensi / ketidakpastian.** [ASSUMPTION] Definisi bisnis completed/counter + kontrak order/payment + frontend

**Prioritas.** Dampak 4/5; effort L; Strategis. Alasan effort: Definisi bisnis completed/counter + kontrak order/payment + frontend

**Risiko.** Kondisi: Tinggi. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-BACKEND; K3.2 sudah menambah retry layar dan payment-recon tersedia. Delta adalah ketahanan terhadap sesi hilang, bukan ketiadaan rekonsiliasi.

[VERIFIED services/order-service/src/application/services/order.service.ts:1247] Pickup konter lahir COMPLETED

[VERIFIED services/order-service/src/application/services/order.service.ts:1261] Completion outbox ditulis saat create

[VERIFIED apps/web/src/app/dashboard/payment-recon/page.tsx:55] Join order dan payment

[VERIFIED apps/web/src/app/dashboard/payment-recon/page.tsx:123] Null payment ditampilkan sebagai noPayment

[VERIFIED services/payment-service/src/modules/payment.controller.ts:332] Endpoint for-orders

[VERIFIED services/payment-service/src/application/services/payment.service.ts:516] Batch payment dibatasi scope order

### FLW-019 — Pisahkan qualification referral dari penyelesaian reward durable

Kandidat asal `REF-01`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Referral berubah QUALIFIED sebelum dua reward; safeReward dan adapter menelan error. Request reward tidak membawa idempotencyKey; replay QUALIFIED return tanpa memulihkan hadiah. Masalah utamanya kehilangan/recovery, bukan klaim double-award pada replay biasa.

**Kontrol yang sudah ada.** Transisi qualification CAS dan uniqueness referee; loyalty mendukung reward key; timeout HTTP.

**Usulan minimum.** Persist dua reward intent dengan key referralId+sisi, dedup di loyalty, rekonsiliasi status dan ledger. Jangan backfill QUALIFIED lama tanpa memeriksa apakah hadiah pernah tercatat.

**Acceptance criteria.** Reward sisi pertama berhasil, sisi kedua timeout: retry melengkapi sisi kedua tepat sekali; crash setelah qualification dapat dipulihkan; ledger membedakan pending/credited.

**Cara verifikasi.** Receiver-before-sender contract tests dan fault injection dua sisi, race Postgres untuk dedup.

**Owner.** Backend Referral dan Loyalty

**Dependensi / ketidakpastian.** [ASSUMPTION] Loyalty contract idempotency, migrasi reward status, dan ORD-01 producer recovery.

**Prioritas.** Dampak 4/5; effort L; Strategis. Alasan effort: Kontrak lintas service, journal dan rekonsiliasi sejarah.

**Risiko.** Kondisi: Tinggi. Implementasi: Tinggi. Confidence: Tinggi

**Jika ditunda.** Dashboard qualification bisa terlihat selesai meski reward gagal diberikan.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/referral-service/src/application/services/referral.service.ts:217] Qualification commit mendahului reward.

[VERIFIED services/referral-service/src/application/services/referral.service.ts:211] QUALIFIED replay return tanpa reward.

[VERIFIED services/referral-service/src/infrastructure/http/loyalty-reward.http.adapter.ts:36] Payload tanpa idempotencyKey.

[VERIFIED services/referral-service/src/infrastructure/http/loyalty-reward.http.adapter.ts:42] Error hanya log.

### FLW-001 — Retry penyesuaian stok delta dapat membuat movement kedua

Kandidat asal `APP-02`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Frontend mengirim delta tanpa attempt key. Controller meneruskan delta tanpa key, service selalu memanggil applyMovement, dan repository menambah quantity serta movement baru per request. Unique itemId/orderId hanya berlaku untuk SALE; ADJUSTMENT memakai orderId null. Dua request yang sama setelah jawaban hilang dapat menjadi dua koreksi; kejadian produksi belum diukur.

**Kontrol yang sudah ada.** UI menahan tombol selama request berjalan; backend menolak stok negatif dan mencatat movement atomik. Kontrol ini tidak membedakan retry dari dua koreksi yang disengaja.

**Usulan minimum.** Beri tiap upaya koreksi satu key yang stabil sampai hasilnya diketahui dan deduplikasi key di transaksi movement server. Buat key baru untuk koreksi berikutnya yang disengaja.

**Acceptance criteria.** Retry dengan key sama mengubah stok sekali dan mengembalikan hasil yang konsisten; dua key berbeda masing-masing membuat movement; request lama tanpa key ditangani menurut kontrak kompatibilitas yang disepakati.

**Cara verifikasi.** Contract test controller, transaksi repository dan retry lost-response; belum dijalankan dalam audit baca-saja.

**Owner.** Frontend dan Backend Depot

**Dependensi / ketidakpastian.** [ASSUMPTION] Perubahan kontrak web, DTO/controller, dan penyimpanan key di depot-service; periksa klien mobile lama sebelum mewajibkan header.

**Prioritas.** Dampak 3/5; effort M; Strategis. Alasan effort: Perubahan kontrak web, DTO/controller, dan penyimpanan key di depot-service; periksa klien mobile lama sebelum mewajibkan header.

**Risiko.** Kondisi: Sedang. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Sedang

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Pemeriksaan lanjutan menutup defer-evidence frontend dengan membaca controller, service, repository dan constraint schema. Tidak ada bukti duplikasi aktual pada data produksi.

[VERIFIED apps/web/src/app/dashboard/inventory/page.tsx:171] Web mengirim delta tanpa attempt key.

[VERIFIED services/depot-service/src/modules/inventory.controller.ts:365] Controller tidak menerima attempt key.

[VERIFIED services/depot-service/src/application/services/inventory.service.ts:335] Setiap panggilan adjust meneruskan movement baru.

[VERIFIED services/depot-service/src/infrastructure/prisma/inventory.prisma.repository.ts:218] applyMovement menaikkan quantity dan menambah ledger dalam transaksi.

[VERIFIED services/depot-service/prisma/schema.prisma:303] Unique itemId/orderId tidak menduplikasi adjustment dengan orderId null.

### FLW-006 — Teruskan customerId dan deliveryWindow pada dispatch staf

Kandidat asal `DLV-03`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Controller membuat AssignInput eksplisit dan tidak memasukkan dua field yang tersedia pada DTO/use-case. Hasil historis aktual perlu pemeriksaan data terpisah.

**Kontrol yang sudah ada.** Dispatch dibatasi capability dan akses depot; DTO dan service sudah menyediakan field.

**Usulan minimum.** Lengkapi pemetaan DTO-ke-input; jangan mengarang backfill customerId baris lama.

**Acceptance criteria.** Controller meneruskan dua field persis; service menyimpan customer dan jendela antar dari dispatch; input lama tanpa field tetap sah.

**Cara verifikasi.** Spec pass-through controller dan use-case; tidak perlu menyentuh data produksi.

**Owner.** Backend Delivery

**Dependensi / ketidakpastian.** [ASSUMPTION] Validasi konsumen UI dan DTO; tidak ada migrasi baru.

**Prioritas.** Dampak 3/5; effort S; Strategis. Alasan effort: Pemetaan lokal dua field dengan tes kontrak.

**Risiko.** Kondisi: Sedang. Implementasi: Rendah. Confidence: Tinggi

**Jika ditunda.** Konteks pelanggan/jendela antar dari dispatch hilang pada boundary.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/delivery-service/src/modules/delivery.controller.ts:53] AssignInput eksplisit melewatkan kedua field.

### FLW-013 — Audit HTTP best-effort masih berpotensi kehilangan entri

Kandidat asal `PLT-01`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] recordAuditEvent satu kali fetch ber-deadline, catch hanya logger.error. Fail-open ini keputusan teknis eksplisit yang harus dipertahankan untuk tidak membatalkan uang yang sudah settled; peningkatan durability adalah strategi baru, bukan kontrol yang diklaim belum pernah ada.

**Kontrol yang sudah ada.** Audit sink, deadline lima detik, error logging dan static audit coverage sudah ada.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. PO/security menentukan tingkat evidensial yang dibutuhkan; desain outbox lokal dan ingest dedup lintas service.

**Acceptance criteria.** Keputusan finansial yang disepakati menulis audit lokal atomik; auth-service padam tidak membatalkan transaksi, dan setelah pulih audit dikirim sekali dengan key idempoten.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Backend/platform lead

**Dependensi / ketidakpastian.** [ASSUMPTION] PO/security menentukan tingkat evidensial yang dibutuhkan; desain outbox lokal dan ingest dedup lintas service.

**Prioritas.** Dampak 3/5; effort L; Strategis. Alasan effort: PO/security menentukan tingkat evidensial yang dibutuhkan; desain outbox lokal dan ingest dedup lintas service.

**Risiko.** Kondisi: Sedang. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Tinggi

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED packages/platform/src/nest/audit-trail.ts:15] sumber menyatakan fail-open sebagai batas desain

[VERIFIED packages/platform/src/nest/audit-trail.ts:50] fetch satu kali; kegagalan dicatat error

[VERIFIED packages/platform/src/nest/audit-mutations.interceptor.ts:145] interceptor memakai sink secara fire-and-forget

### FLW-021 — Retensi offline menghapus seluruh jenis job termasuk pencatatan uang

Kandidat asal `WEB-03`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] flush memeriksa expired sebelum error dan menghapus semua kind setelah tujuh hari. Kebijakan melindungi payload foto, tetapi codConfirm dan gallonReturn juga hilang. Peristiwa lewat tujuh hari perlu rekonsiliasi, bukan replay tanpa batas.

**Kontrol yang sudah ada.** Owner isolation, Web Lock, retry/backoff, MAX_ATTEMPTS dan tampilan error sudah ada.

**Usulan minimum.** Arsipkan job uang yang kedaluwarsa menjadi needs-review yang terlihat, dengan metadata aman dan instruksi rekonsiliasi; jangan replay otomatis transaksi tua tanpa cek status server.

**Acceptance criteria.** Job COD/galon kedaluwarsa menghasilkan status rekonsiliasi minimum yang terlihat dan tidak otomatis mengubah saldo; payload foto tetap terhapus sesuai retensi yang disepakati.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Frontend + finance ops

**Dependensi / ketidakpastian.** [ASSUMPTION] PO/finance menentukan umur rekonsiliasi dan minimisasi metadata; jangan meniadakan retensi biometrik.

**Prioritas.** Dampak 3/5; effort M; Strategis. Alasan effort: PO/finance menentukan umur rekonsiliasi dan minimisasi metadata; jangan meniadakan retensi biometrik.

**Risiko.** Kondisi: Sedang. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Tinggi

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED apps/web/src/lib/offline-queue.ts:188] batas retensi global tujuh hari

[VERIFIED apps/web/src/lib/offline-queue.ts:475] semua job milik pengguna dibuang bila kedaluwarsa

[VERIFIED apps/web/src/lib/offline-queue.ts:312] job COD mengandung paymentId, cashReceived dan capturedAt

[VERIFIED apps/web/src/components/offline-queue-banner.tsx:50] pembuangan manual punya konfirmasi, sedangkan expired otomatis tidak

### FLW-009 — Installer belum menyiapkan log backup provider kedua

Kandidat asal `IDO-01`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Kegagalan bersyarat: bila file log belum ada dan user tidak dapat menulis /var/log, shell gagal sebelum skrip. Bukan bukti backup produksi gagal.

**Kontrol yang sudah ada.** Freshness checker dan mode inert bila provider kedua belum dikonfigurasi.

**Usulan minimum.** Tambahkan file log provider kedua ke installer dan pemeriksaan idempotensi installer.

**Acceptance criteria.** Pada filesystem fixture non-root dengan /var/log tidak writable, installer menyiapkan log backup2; dua instalasi tidak menggandakan cron.

**Cara verifikasi.** Uji installer dengan permission realistis secara terpisah dari audit; cek --show tanpa menjalankan backup.

**Owner.** DevOps

**Dependensi / ketidakpastian.** [ASSUMPTION] Owner DevOps; test installer, tidak perlu migrasi aplikasi.

**Prioritas.** Dampak 3/5; effort S; Nice-to-have. Alasan effort: Owner DevOps; test installer, tidak perlu migrasi aplikasi.

**Risiko.** Kondisi: Sedang. Implementasi: Rendah. Confidence: Tinggi

**Jika ditunda.** Aktivasi provider kedua dapat gagal sebelum skrip dipanggil.

**SEARCH / PREV / DEC.** SEARCH-CTX-05; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED scripts/install-host-cron.sh:92] Cron redirect menuju hydromart-backup2.log

[VERIFIED scripts/install-host-cron.sh:163] Loop persiapan lima log tidak mencakup backup2

[VERIFIED scripts/backup-second-provider.sh:30] Provider kedua inert bila destination kosong

### FLW-014 — Kursor invalid diam-diam memakai nomor halaman

Kandidat asal `PLT-05`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] pageArgs mengabaikan cursor yang tidak dapat didecode. Ini kebijakan fallback terdokumentasi untuk menghindari Prisma P2025, tetapi mengaburkan error input dan bisa mengulang halaman dalam infinite-scroll.

**Kontrol yang sudah ada.** Version/checksum dan WHERE tenant tetap mencegah query cursor mentah lintas scope.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Kontrak backward compatibility browser/APK; perlu keputusan API sebelum mengganti fallback.

**Acceptance criteria.** Kontrak invalid cursor eksplisit; jika beralih 400 INVALID_CURSOR, klien mereset feed dengan pesan/retry yang sesuai dan cursor versi lama terdukung.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Platform + frontend engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Kontrak backward compatibility browser/APK; perlu keputusan API sebelum mengganti fallback.

**Prioritas.** Dampak 2/5; effort M; Nice-to-have. Alasan effort: Kontrak backward compatibility browser/APK; perlu keputusan API sebelum mengganti fallback.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Tinggi

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED packages/platform/src/domain/keyset.ts:79] decode gagal memakai page-based skip

[VERIFIED packages/platform/src/domain/keyset.ts:75] fallback adalah keputusan teknis eksplisit, bukan crash tersembunyi

### FLW-023 — needsPayment hanya mengecualikan CANCELLED

Kandidat asal `WEB-08`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] VOIDED/COMPLETED dengan payment REFUNDED/FAILED diperlakukan membutuhkan pembayaran baru oleh helper. Ini bug affordance UI bersyarat; tidak membuktikan charge server berhasil pada status terminal.

**Kontrol yang sudah ada.** Satu active payment per order dipagari backend; gateway methods/depot methods difilter.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. PO menentukan apakah terminal unpaid historis boleh dibayar. Verifikasi domain payment sebelum mengubah helper.

**Acceptance criteria.** Tabel status terminal dan status payment diuji; VOIDED/COMPLETED tidak menawarkan initiate payment kecuali aturan bisnis eksplisit membolehkannya.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Frontend engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] PO menentukan apakah terminal unpaid historis boleh dibayar. Verifikasi domain payment sebelum mengubah helper.

**Prioritas.** Dampak 2/5; effort S; Nice-to-have. Alasan effort: PO menentukan apakah terminal unpaid historis boleh dibayar. Verifikasi domain payment sebelum mengubah helper.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Tinggi

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED apps/web/src/lib/payments.ts:83] hanya CANCELLED yang ditolak berdasarkan status order

[VERIFIED apps/web/src/app/orders/detail/page.tsx:671] halaman detail memakai helper untuk panel payment

### FLW-015 — Callback geolocation native hanya satu slot pending

Kandidat asal `PLT-11`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Prompt geolokasi kedua menimpa pendingOrigin/pending sebelum answer. Ini skenario konkuren kondisional; tidak menyatakan kejadian perangkat aktual.

**Kontrol yang sudah ada.** Daftar permission sesuai manifest dan coarse-only fallback sudah ada.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Verifikasi native/device terisolasi, tidak dijalankan.

**Acceptance criteria.** Dua prompt beruntun menerima penyelesaian masing-masing; coarse-only customer tetap berfungsi pada Android lama.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Mobile engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Verifikasi native/device terisolasi, tidak dijalankan.

**Prioritas.** Dampak 1/5; effort S; Nice-to-have. Alasan effort: Verifikasi native/device terisolasi, tidak dijalankan.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Tinggi

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED mobile/android/app/src/main/java/id/hydromart/app/MainActivity.java:97] slot callback baru menimpa pending tanpa menolak callback lama

[VERIFIED mobile/android/app/src/main/java/id/hydromart/app/MainActivity.java:102] hasil permission menjawab hanya callback terakhir

### FLW-022 — Kegagalan delete IndexedDB disembunyikan dari UI

Kandidat asal `WEB-04`; adjudikasi `reclassify`.

**Status / bukti.** PERLU DIPERDALAM; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] discard menangkap kegagalan delete lalu menghapus cache. Replay setelah reload mungkin, tetapi tidak cukup untuk menyimpulkan uang terdebit ganda karena server memiliki dedup/status guards. Hardening UX, bukan temuan integritas uang tersendiri.

**Kontrol yang sudah ada.** Backend replay-safe disebut dalam laporan awal; validasi per-domain diperlukan.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Gabungkan dengan WEB-03 bila menyusun perbaikan lifecycle queue.

**Acceptance criteria.** Jika delete storage gagal, operator menerima status belum terhapus; replay-safe server tetap dipertahankan.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Frontend engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Gabungkan dengan WEB-03 bila menyusun perbaikan lifecycle queue.

**Prioritas.** Dampak 1/5; effort S; Nice-to-have. Alasan effort: Gabungkan dengan WEB-03 bila menyusun perbaikan lifecycle queue.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Sedang

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED apps/web/src/lib/offline-queue.ts:288] delete failure ditelan dan cache tetap dihapus

### FLW-017 — Bedakan persetujuan refund manual dari uang benar-benar diserahkan

Kandidat asal `PPA-03`; adjudikasi `defer-policy`.

**Status / bukti.** PERLU DIPERDALAM; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] executeRefund memindahkan REFUNDED; transfer gateway hanya untuk EWALLET/VA dengan reference. CASH/TRANSFER/QRIS tidak memanggil bank. Ini membuktikan pencatatan status, bukan bahwa pelanggan sudah menerima dana.

**Kontrol yang sudah ada.** Claim CAS sebelum refund; approval ambang; audit refund; order refund coordination.

**Usulan minimum.** Finance menetapkan SOP/kanal dan definisi REFUNDED. Tambah tahap approved-awaiting-disbursement atau evidence money-out, tanpa mengubah histori menjadi klaim settlement palsu.

**Acceptance criteria.** Refund manual mencatat penerima/kanal/ref/aktor/waktu atau tetap pending money-out; retry tidak membayar dua kali.

**Cara verifikasi.** Review SOP, model status, fault injection; gateway tests hanya sandbox bila nanti diotorisasi.

**Owner.** Finance dan Product Owner

**Dependensi / ketidakpastian.** [ASSUMPTION] Keputusan Finance: siapa membayar dan bukti apa yang wajib; tanpa itu jangan mengotomasi uang keluar.

**Prioritas.** Dampak 4/5; effort L; Jangan dikerjakan dulu. Alasan effort: Definisi domain dan kontrak status lintas payment/order/UI.

**Risiko.** Kondisi: Tinggi. Implementasi: Tinggi. Confidence: Tinggi

**Jika ditunda.** Status REFUNDED dapat dibaca lebih kuat daripada bukti yang sistem simpan.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/payment-service/src/application/services/payment.service.ts:1286] Patch REFUNDED disiapkan sebelum bank effect.

[VERIFIED services/payment-service/src/application/services/payment.service.ts:1308] Gateway hanya dipanggil untuk metode online dengan reference.

[VERIFIED services/payment-service/src/domain/payment.ts:75] Online hanya EWALLET dan VA.

### FLW-018 — Tetapkan alokasi reversal franchise untuk refund setelah order selesai

Kandidat asal `PPA-05`; adjudikasi `defer-policy`.

**Status / bukti.** PERLU DIPERDALAM; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] recordRefund hanya menulis refundedAmount dan mengirim notifikasi; jalur ini tidak membalik franchise ledger. Refund terhadap penjualan selesai dan aturan pembebanan biaya perlu dikonfirmasi.

**Kontrol yang sudah ada.** Void revenue outbox tersedia pada pembatalan konter; sourceRef ledger mencegah duplikasi.

**Usulan minimum.** Finance menentukan pihak penanggung dan apakah clawback owner/komisi berlaku; kemudian intent reversal idempoten, bukan reuse pembatalan penuh untuk refund parsial.

**Acceptance criteria.** Skenario refund yang disepakati menghasilkan ledger reversal proporsional sekali; withdrawal yang sudah dibayar tidak diubah diam-diam.

**Cara verifikasi.** Contoh pembukuan disetujui Finance dan contract/race tests; tidak mengoreksi data produksi otomatis.

**Owner.** Finance Franchise dan Backend Order/Payout

**Dependensi / ketidakpastian.** [ASSUMPTION] SOP refund dan model franchise direct-to-depot; keputusan Finance.

**Prioritas.** Dampak 4/5; effort L; Jangan dikerjakan dulu. Alasan effort: Domain keuangan lintas service, histori dan backfill.

**Risiko.** Kondisi: Tinggi. Implementasi: Tinggi. Confidence: Sedang

**Jika ditunda.** Pendapatan dan kewajiban owner dapat berbeda setelah refund; besarnya belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/order-service/src/application/services/order.service.ts:3139] recordRefund hanya repository dan notifikasi.

[VERIFIED services/order-service/src/infrastructure/prisma/order.prisma.repository.ts:1124] Repository hanya set refundedAmount.

### FLW-012 — Kebijakan voucher online batal belum dipulihkan pada jalur cancel yang dibaca

Kandidat asal `PLP-01`; adjudikasi `defer-policy`.

**Status / bukti.** PERLU DIPERDALAM; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] [INFERRED] Jalur cancel tidak memanggil release yang sudah tersedia; apakah voucher harus kembali adalah keputusan bisnis. Bukan Quick Win siap implementasi tanpa keputusan tersebut.

**Kontrol yang sudah ada.** Release idempoten tersedia dan counter void/checkout failure memakainya.

**Usulan minimum.** PO menentukan hangus/kembali dan alasan cancellation yang berlaku; bila kembali, gunakan delivery yang dapat dipulihkan, bukan fail-open yang dapat hilang permanen.

**Acceptance criteria.** Tes customer/staff/sweep cancel sesuai kebijakan; retry tidak menurunkan usedCount dua kali; budget dan perCustomerLimit konsisten.

**Cara verifikasi.** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner.** PO + backend order/promo

**Dependensi / ketidakpastian.** [ASSUMPTION] PO kebijakan cancellation + order/promo; gabungan ORD-02 [ASSUMPTION] Apakah voucher dikembalikan pada semua cancellation, atau hanya alasan tertentu?

**Prioritas.** Dampak 3/5; effort M; Jangan dikerjakan dulu. Alasan effort: PO kebijakan cancellation + order/promo; gabungan ORD-02

**Risiko.** Kondisi: Sedang. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-BACKEND; PRM-8 telah menutup race release; delta hanya pemanggil cancel online.

[VERIFIED services/order-service/src/application/services/order.service.ts:2016] Pembatalan mengantre reversal pembayaran

[VERIFIED services/order-service/src/application/services/order.service.ts:3116] Release stock tanpa release voucher

[VERIFIED services/promo-service/src/application/services/voucher.service.ts:367] release tersedia

[VERIFIED services/promo-service/src/infrastructure/prisma/voucher.prisma.repository.ts:396] Claim release releasedAt null atomik dan usedCount turun

### FLW-025 — Tidak adanya Idempotency-Key bukan bukti semua POST tidak idempoten

Kandidat asal `WEB-12`; adjudikasi `defer-evidence`.

**Status / bukti.** PERLU DIPERDALAM; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Ditemukan empat header call site dan satu body idempotencyKey, tetapi status/CAS/unique constraints server dapat menyediakan semantik replay tanpa header. Timeout 15 detik menghasilkan hasil tidak pasti, bukan bukti duplikasi. Pecah hanya setelah service owner membuktikan satu operasi non-idempoten.

**Kontrol yang sudah ada.** Web Lock offline, checkout/walk-in/withdraw attempt key, unique/status guards server.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Gabungkan APP-05; APP-02 delta stok diserahkan ke depot owner.

**Acceptance criteria.** Setiap mutasi dinilai terhadap duplicate/lost-response pada state server; jangan menambah header yang tidak dikonsumsi.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Frontend engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Gabungkan APP-05; APP-02 delta stok diserahkan ke depot owner.

**Prioritas.** Dampak 3/5; effort L; Jangan dikerjakan dulu. Alasan effort: Gabungkan APP-05; APP-02 delta stok diserahkan ke depot owner.

**Risiko.** Kondisi: Sedang. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Sedang

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED apps/web/src/lib/api.ts:29] JSON deadline lima belas detik

[VERIFIED apps/web/src/app/checkout/page.tsx:689] checkout mempertahankan attempt key

[VERIFIED apps/web/src/app/dashboard/payout/page.tsx:142] payout mempertahankan attempt key

### FLW-024 — Sinkronisasi sesi lintas tab belum diperiksa memadai

Kandidat asal `WEB-09`; adjudikasi `defer-evidence`.

**Status / bukti.** PERLU DIPERDALAM; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Klaim ketiadaan storage/BroadcastChannel berasal pencarian awal; audit resume tidak menelusuri seluruh mekanisme browser/cookie/tab. Jangan mempromosikan tanpa SEARCH lintas file dan skenario konkret.

**Kontrol yang sudah ada.** Token web ada di cookie httpOnly; polling profil/fokus sudah ada.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Perlu full search lintas session-store/depot-store/app lifecycle.

**Acceptance criteria.** Tetapkan skenario logout/ganti depot antar tab dan kontrak sinkronisasi sebelum implementasi.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Frontend engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Perlu full search lintas session-store/depot-store/app lifecycle.

**Prioritas.** Dampak 1/5; effort M; Jangan dikerjakan dulu. Alasan effort: Perlu full search lintas session-store/depot-store/app lifecycle.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Sedang

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.





### Alur lintas service

# Alur lintas layanan yang ditinjau

Audit ini membaca jalur kode, bukan menjalankan transaksi. Status sesudah kegagalan adalah kemungkinan yang diturunkan dari urutan operasi; frekuensi produksi belum diketahui.

| Alur | Aktor dan batas lokal | Handoff dan titik gagal | Pemulihan yang terlihat | Keputusan audit |
|---|---|---|---|---|
| Checkout ke stok, poin, referral, waralaba | order-service menyimpan order dan outbox | Empat adapter HTTP dapat mengembalikan tanpa melempar saat penerima gagal | outbox menandai DONE jika handler resolve; replay tidak terjadi untuk kegagalan yang ditelan | FLW-010 (ORD-01): audit idempotensi penerima sebelum retry wajib |
| Bukti pengantaran ke order, earning, webhook | kurir menuntaskan delivery dan proof tersimpan | advance order dapat gagal; earning dan event dipanggil asynchronous | replay DELIVERED langsung kembali, sehingga efek yang gagal tidak otomatis diulang | FLW-008 (DLV-07): simpan intent recovery dan identitas dedupe |
| Reschedule ke order | delivery disimpan RESCHEDULED | hand-back ke order PREPARING dilakukan sesudah status lokal | replay tanggal sama berhenti lebih awal jika cashReturned tidak true | FLW-005 (DLV-01): perbaiki replay hand-back tanpa mengulang pembalikan kas |
| Referral ke poin | referral menjadi QUALIFIED | dua reward dikirim setelah transisi; adapter menelan kegagalan | replay QUALIFIED langsung kembali | FLW-019 (REF-01): intent reward per sisi dan dedupe penerima |
| Pembayaran berbukti ke antrean staf | payment PENDING dan proofUrl dapat terisi | sweep TTL mencari PENDING tanpa menyaring proofUrl | CAS menjadi FAILED terminal; bukti perlu review manusia | FLW-016 (PPA-01): pisahkan kedaluwarsa tanpa bukti dari antrean bukti |
| PO ke stok | purchase order SENT dibaca; receiveStock dipanggil per baris | status PO diperbarui setelah loop | retry/crash dapat memposting ulang stok; kontrak receipt perlu dibuat atomik/idempoten | FLW-004 (DEP-02): desain identitas receipt dan pemulihan parsial |

Sumber baris: `recommendations.json` untuk FLW-010 (ORD-01), FLW-008 (DLV-07), FLW-005 (DLV-01), FLW-019 (REF-01), FLW-016 (PPA-01) dan FLW-004 (DEP-02) memuat path serta baris source yang dibaca ulang. Urutan lintas database tidak transaksional; tabel ini tidak menyatakan receiver sudah idempoten. Status batal/refund dan pembagian franchise menunggu keputusan Finance/Produk.


## 6. BI: katalog KPI dan dashboard per role

# Katalog KPI kandidat

Katalog ini menyebut grain, sumber dan batas perhitungan yang bisa ditelusuri dari source. Rumus dan akses lintas layanan perlu persetujuan owner sebelum dipakai sebagai angka resmi. Nilai tidak boleh diganti nol bila sumber gagal atau belum lengkap.

| ID | KPI / pemilik | Grain dan jendela | Sumber dan rumus kandidat | Batas / status |
|---|---|---|---|---|
| BI-KPI-01 | P&L depot / Finance HQ | depot × periode kalender | pendapatan order yang countsAsSale, COGS, payroll, opex dan refund dari dashboard-service `networkPnl`; laba = pendapatan − biaya − refund | PARTIAL: refund memakai `refundedAt` sedangkan penjualan memakai waktu order; refund order CANCELLED/VOIDED mungkin terhitung dua kali; cocokkan orderId dan status sebelum memakai angka (PLP-13) |
| BI-KPI-02 | SLA pengantaran / Operasional | delivery attempt atau order × hari; belum diputuskan | assignedAt sampai deliveredAt; status on-time mengikuti aturan earning dan report delivery-service | PARTIAL: reassign mempertahankan assignedAt/slaAlertedAt. PO menentukan apakah SLA per order atau percobaan (BI-001 (DLV-02)) |
| BI-KPI-03 | Poin/reward referral yang benar-benar masuk / CRM | referral × sisi reward | ledger loyalty dan intent referral yang cocok, bukan status QUALIFIED saja | BELUM TERSEDIA sebagai angka utuh: reward dapat gagal sesudah QUALIFIED; perlu intent dan rekonsiliasi (FLW-019 (REF-01)) |
| BI-KPI-04 | Penyelesaian efek order / Operasional | outbox event × topik × hari | jumlah PENDING/FAILED/DONE dibanding bukti penerimaan stok/poin/referral/waralaba | PARTIAL: DONE producer belum membuktikan efek receiver jika adapter fail-open (FLW-010 (ORD-01)) |
| BI-KPI-05 | Kualitas forecast / Perencanaan | feed cursor × run | jumlah page/order teringest, lag dan status incomplete terpisah dari EOF | PARTIAL: timeout/non-2xx sekarang dapat tampil seperti EOF normal (AUT-011 (FCS-04)) |
| BI-KPI-06 | Bruto pajak dan BPJS / HR dan akuntan | karyawan × masa payroll | payroll.gross sekarang BASE + ALLOWANCE; BONUS terpisah | KEPUTUSAN DIPERLUKAN: dasar PPh dan BPJS tidak otomatis sama; komponen variabel perlu keputusan akuntan (BI-002 (HR-04)) |

Tidak ada kueri data produksi atau rekonsiliasi nilai aktual pada audit ini. Model dan deklarasi endpoint terindeks di `02-inventory.json`; bukti tiap kandidat berada di `recommendations.json`. Katalog sengaja tidak mengisi target, tren, atau denominator yang belum disahkan.


### BI-003 — Register keamanan perlu direkonsiliasi per bukti

Kandidat asal `IDO-05`; adjudikasi `reclassify`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Tidak membuktikan97 selesai hanya dari git log; ubah narasi menjadi register historis perlu source-level revalidation. Setiap owner mengisi delta source/test, bukan menutup otomatis.

**Kontrol yang sudah ada.** Register mengandung keputusan dan daftar PR historis; audit lanjutan owner memeriksa source.

**Usulan minimum.** Tambahkan source/PR/test/provenance untuk setiap status dan pertahankan keputusan accepted.

**Acceptance criteria.** Setiap baris yang dipindah selesai punya source saat ini, test yang relevan dan status bukti; accepted tidak diubah menjadi bug; count dihitung programatik.

**Cara verifikasi.** Baca source dan review per baris, bandingkan tally.

**Owner.** QA/security

**Dependensi / ketidakpastian.** [ASSUMPTION] Owner service; jangan pakai runtime claims tanpa akses terpisah.

**Prioritas.** Dampak 3/5; effort M; Strategis. Alasan effort: Owner service; jangan pakai runtime claims tanpa akses terpisah.

**Risiko.** Kondisi: Sedang. Implementasi: Rendah. Confidence: Sedang

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-CTX-10; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED docs/SECURITY_AUDIT_REGISTER.md:13] Dokumen masih melaporkan Selesai5

[VERIFIED docs/SECURITY_AUDIT_REGISTER.md:22] Dua kontrol sengaja diterima bukan terbuka

[VERIFIED docs/SECURITY_AUDIT_REGISTER.md:46] PRM1/PRM5 tercantum diterima pemilik

### BI-004 — Dokumen status PPN perlu diselaraskan dengan fitur tarif0

Kandidat asal `IDO-06`; adjudikasi `reclassify`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Keberadaan field tidak membuktikan pengenaan PPN/konflik keputusan; default nonaktif sesuai keputusan lama. Konflik aktual adalah teks dokumen dan status keputusan terbaru.

**Kontrol yang sudah ada.** Default0, tarif null bila amount0, total inclusive tidak ditambah, cache/timeout adapter.

**Usulan minimum.** Rekonsiliasi dokumen dan minta konfirmasi pemilik/akuntan tentang kebijakan sebelum aktivasi; jangan ubah nominal transaksi.

**Acceptance criteria.** Dokumen membedakan fitur tersedia dari aktif produksi; keputusan PKP/tarif punya pemilik/tanggal; tidak ada klaim salah pungut tanpa data.

**Cara verifikasi.** Review dokumentasi terhadap source dan keputusan, bukan kesimpulan kepatuhan.

**Owner.** Pemilik produk/akuntan

**Dependensi / ketidakpastian.** [ASSUMPTION] Pemilik dan akuntan untuk status legal/bisnis; bukan blok audit.

**Prioritas.** Dampak 2/5; effort S; Nice-to-have. Alasan effort: Pemilik dan akuntan untuk status legal/bisnis; bukan blok audit.

**Risiko.** Kondisi: Rendah. Implementasi: Rendah. Confidence: Tinggi

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-CTX-03; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED docs/LEGAL_OPEN_ITEMS.md:21] Dokumen mengatakan tidak ada baris pajak di mana pun

[VERIFIED docs/AUDIT_FR_MATRIX_2026-10.md:60] FR034 menyebut pencatatan dan preview pajak

[VERIFIED services/payment-service/src/application/services/tax-settings.service.ts:27] Default ppnPercent0

[VERIFIED services/order-service/src/application/services/order.service.ts:2051] Tax amount hanya bila tarif>0; total tidak ditambah

[VERIFIED docs/CONSOLE_AUDIT_REGISTER.md:350] Keputusan lama mempertahankan form/layar aktif bila rate diisi sengaja

### BI-005 — Kumpulan komentar historis usang perlu adjudikasi per baris

Kandidat asal `IDO-07`; adjudikasi `reclassify`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Delapan subklaim awal tidak seluruhnya dibaca ulang; jangan memperlakukan bundle sebagai satu temuan prioritas tinggi. Konflik keputusan substansial dicatat konteks, sisanya editorial.

**Kontrol yang sudah ada.** Tracker bertanggal dan source aktual tersedia.

**Usulan minimum.** Perbarui komentar setelah owner memvalidasi state yang dimaksud; jangan menghapus sejarah keputusan.

**Acceptance criteria.** Tiap koreksi menyebut perilaku source yang berlaku dan tanggal, tanpa mengklaim state produksi dari template.

**Cara verifikasi.** Diff docs terhadap source yang relevan.

**Owner.** Dokumentasi/DevOps

**Dependensi / ketidakpastian.** [ASSUMPTION] Owner dokumen terkait.

**Prioritas.** Dampak 2/5; effort S; Nice-to-have. Alasan effort: Owner dokumen terkait.

**Risiko.** Kondisi: Rendah. Implementasi: Rendah. Confidence: Sedang

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-CTX-06; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED docs/EVALUATION_11_ITEMS_TRACKER.md:34] E2/E3/E4 punya keputusan sesudah dokumen diskon

[VERIFIED docs/AUDIT_FR_MATRIX_2026-10.md:144] Royalti ditunda eksplisit

### BI-006 — readAllPages ceiling tidak ketat pada short final page

Kandidat asal `PLT-04`; adjudikasi `reclassify`.

**Status / bukti.** PERLU DIPERDALAM; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] rows.length < pageSize mengembalikan sebelum ceiling. Namun pemanggil report yang diperiksa memakai max kelipatan pageSize; eksposur production overflow pada konfigurasi tersebut belum terbukti. Ini kontrak helper dan memori yang perlu diperbaiki, bukan laporan aktual salah.

**Kontrol yang sudah ada.** Ceiling full page dan deterministic cursor sudah ada.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Tinjau seluruh konfigurasi caller; jangan mengklaim saat ini unbounded.

**Acceptance criteria.** max=100/pageSize=500/400 rows memicu overflow; definisikan apakah tepat max diterima; semua caller dipastikan mengikuti kontrak.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Platform engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Tinjau seluruh konfigurasi caller; jangan mengklaim saat ini unbounded.

**Prioritas.** Dampak 2/5; effort S; Nice-to-have. Alasan effort: Tinjau seluruh konfigurasi caller; jangan mengklaim saat ini unbounded.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Sedang

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED packages/platform/src/domain/read-all.ts:27] short page mendahului pemeriksaan max

[VERIFIED services/depot-service/src/infrastructure/prisma/operational-report.prisma.repository.ts:18] pemanggil depot memakai max 20000 dan pageSize 500

[VERIFIED packages/platform/src/domain/read-all.spec.ts:43] test default pageSize tidak menguji result melebihi max pada short page

### BI-007 — Netralisasi CSV mengubah angka negatif menjadi teks

Kandidat asal `WEB-07`; adjudikasi `reclassify`.

**Status / bukti.** PERLU DIPERDALAM; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] escapeCell mengonversi semua tipe ke string lalu menambah apostrof untuk minus. Kontrak helper terbukti, tetapi ekspor cashbook memakai kolom Masuk/Keluar positif sehingga dampak negatif aktif belum terbukti dalam call site yang diperiksa.

**Kontrol yang sudah ada.** Anti formula-injection sudah ada dan harus dipertahankan.

**Usulan minimum.** Bedakan nilai number dari teks sebelum netralisasi formula; pertahankan perlindungan teks berbahaya. Jangan mengubah semua ekspor menjadi numeric coercion.

**Acceptance criteria.** Angka bertipe number tetap numerik di CSV, string berbahaya tetap dinetralisasi; tunjukkan call site dengan nilai negatif sebelum menaikkan prioritas.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Frontend engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Korelasikan AAS-07; satu akar helper berbeda, hindari hitungan ganda dampak BI.

**Prioritas.** Dampak 2/5; effort S; Nice-to-have. Alasan effort: Korelasikan AAS-07; satu akar helper berbeda, hindari hitungan ganda dampak BI.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Sedang

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED apps/web/src/lib/csv.ts:123] minus di awal termasuk number menerima apostrof

[VERIFIED apps/web/src/app/dashboard/cashbook/page.tsx:217] cashbook memisahkan uang masuk/keluar menjadi kolom terpisah

### BI-001 — Definisikan jam SLA tiap percobaan pengantaran ulang

Kandidat asal `DLV-02`; adjudikasi `defer-policy`.

**Status / bukti.** PERLU DIPERDALAM; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Reassign mereset pickup/start/ETA tetapi assignedAt dan slaAlertedAt tetap; earning menghitung selisih deliveredAt-assignedAt. Kode terbukti; definisi SLA order vs percobaan perlu PO.

**Kontrol yang sudah ada.** Riwayat status dan cap kurir atomik tetap ada.

**Usulan minimum.** PO memilih SLA order utuh atau per-attempt. Jika per-attempt, simpan attempt dan jamnya tanpa merusak jejak percobaan lama.

**Acceptance criteria.** KPI dan bonus menggunakan jam yang disetujui; histori attempt pertama dapat diaudit.

**Cara verifikasi.** Unit reassign, SLA, earning dan review kebijakan ops.

**Owner.** Product Owner dan Operasional

**Dependensi / ketidakpastian.** [ASSUMPTION] Keputusan PO/operasional tentang denominator SLA dan bonus.

**Prioritas.** Dampak 4/5; effort M; Jangan dikerjakan dulu. Alasan effort: Beberapa laporan dan bonus membaca timestamp yang sama.

**Risiko.** Kondisi: Sedang. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Perbandingan SLA/bonus antar kurir berpotensi mencampur waktu percobaan berbeda.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/delivery-service/src/infrastructure/prisma/delivery.prisma.repository.ts:214] Reassign tidak mengganti assignedAt/slaAlertedAt.

[VERIFIED services/delivery-service/src/application/services/delivery.service.ts:543] Earning memakai assignedAt.

### BI-002 — Definisi bruto pajak variabel perlu konfirmasi akuntan

Kandidat asal `HR-04`; adjudikasi `defer-policy`.

**Status / bukti.** PERLU DIPERDALAM; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Source memverifikasi gross=BASE+ALLOWANCE, terpisah dari totalBonus; PPh Desember memakai YTD gross yang sama. Ini tidak membuktikan pelanggaran pajak, dan dasar BPJS tidak boleh otomatis disamakan dengan dasar PPh.

**Kontrol yang sudah ada.** Tabel TER configurable dan rekonsiliasi Desember tersedia; brief akuntan sudah mendokumentasikan pertanyaan.

**Usulan minimum.** Akuntan memutuskan komponen penghasilan/pemotongan per basis dan proses di luar aplikasi; setelah itu selaraskan input serta ekspor rekonsiliasi.

**Acceptance criteria.** Kasus bonus/THR/Desember yang disetujui akuntan menjadi fixture; output aplikasi cocok dengan kasus tersebut dan menjelaskan komponen yang diproses di luar aplikasi.

**Cara verifikasi.** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner.** Akuntan + HR + backend HR

**Dependensi / ketidakpastian.** [ASSUMPTION] Jawaban akuntan; perbedaan basis PPh/BPJS; bukan audit hukum [ASSUMPTION] Apakah variabel ditangani dalam pelaporan di luar aplikasi?

**Prioritas.** Dampak 4/5; effort M; Jangan dikerjakan dulu. Alasan effort: Jawaban akuntan; perbedaan basis PPh/BPJS; bukan audit hukum

**Risiko.** Kondisi: Tinggi. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-BACKEND; Pertanyaan sudah ada dalam BRIEF_AKUNTAN; bukti tambahan adalah YTD Desember juga memakai gross tanpa BONUS.

[VERIFIED services/hr-service/src/application/services/payroll.service.ts:523] gross tidak memuat BONUS

[VERIFIED services/hr-service/src/application/services/payroll.service.ts:531] statutoryInput memakai gross

[VERIFIED services/hr-service/src/application/services/payroll.service.ts:551] Desember memakai decemberPph21

[VERIFIED services/hr-service/src/infrastructure/prisma/payroll.prisma.repository.ts:179] YTD menjumlah payroll.gross

[VERIFIED services/hr-service/src/domain/statutory.ts:418] AnnualGross YTD+Desember

[VERIFIED docs/BRIEF_AKUNTAN.md:59] Pertanyaan THR/bonus masuk bruto TER masih diajukan



## 7. Automation

### AUT-007 — Lindungi peran akun saat ini dan super admin terakhir pada perubahan peran

Kandidat asal `AUT-01`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] canGrantRole mengevaluasi peran baru; invite akun yang sudah ada mengubah role lalu save by id. Guard super admin terakhir tersedia untuk delete/suspend, bukan save role. Risiko penurunan peran disimpulkan dari interleaving source, bukan insiden produksi.

**Kontrol yang sudah ada.** RESTRICTED_GRANTS membatasi pemberian peran baru; suspend/delete melindungi super admin terakhir dengan lock.

**Usulan minimum.** Gunakan otorisasi terhadap peran lama dan baru; lindungi keluar dari SUPER_ADMIN dalam transaksi dengan pola lock yang sudah tersedia, termasuk invite ulang dan jalur internal HR.

**Acceptance criteria.** HEAD_OFFICE tidak dapat mengganti SUPER_ADMIN menjadi STAFF_DEPOT melalui invite; dua penurunan paralel tidak menghapus super admin aktif terakhir; perpindahan depot tanpa perubahan peran tetap bekerja.

**Cara verifikasi.** Unit policy actor/old/new role, controller wiring, dan race Postgres pada demotion. Belum dijalankan.

**Owner.** Backend Auth dan Security

**Dependensi / ketidakpastian.** [ASSUMPTION] Kontrak grantedBy HR yang sudah ada; perlu review kompatibilitas peran custom.

**Prioritas.** Dampak 4/5; effort M; Quick Win. Alasan effort: Beberapa jalur mutasi dan repository satu domain; pola penguncian sudah ada.

**Risiko.** Kondisi: Tinggi. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Akun istimewa dapat kehilangan peran melalui jalur yang hanya memvalidasi peran tujuan.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/auth-service/src/application/services/account.service.ts:359] Pemeriksaan grant memakai role tujuan sebelum membaca akun existing.

[VERIFIED services/auth-service/src/application/services/account.service.ts:375] Existing dipromosikan/diganti peran dan disimpan.

[VERIFIED services/auth-service/src/infrastructure/prisma/repositories/customer.prisma.repository.ts:201] save mengubah role by id tanpa guard last-admin.

[VERIFIED packages/access/src/index.ts:842] canGrantRole bergantung targetRole.

### AUT-012 — Ekspor karyawan melewati redaksi depot peminjam

Kandidat asal `HR-21`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] [INFERRED] employeeReport memakai depotScopeIds lalu mencetak NIK/NPWP/rekening/gaji dari Employee penuh; tidak memakai homeDepot redaction seperti list. Dampak borrower memerlukan penugasan lintas depot aktif.

**Kontrol yang sudah ada.** Scope depot ada; list/get employee dan payroll menerapkan redaksi; ekspor sengaja lengkap untuk round-trip HQ.

**Usulan minimum.** Gunakan kebijakan home/current-depot yang sama untuk ekspor, pertahankan field lengkap bagi pihak berwenang; tambahkan jejak download metadata tanpa payload PII.

**Acceptance criteria.** Borrowed employee tetap terlihat operasional tetapi NIK/rekening/gaji kosong di CSV dan XLSX; home/HQ tetap dapat round-trip yang diizinkan; download tercatat tanpa menyalin PII.

**Cara verifikasi.** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner.** Backend HR + pemilik akses HR

**Dependensi / ketidakpastian.** [ASSUMPTION] Reuse employee redaction/home-depot reach; fixture penugasan lintas depot. Effort M karena ekspor dua format dan kontrol akses. Aktivasi DEPOT_ASSIGNMENT_ENABLED dan penugasan aktual produksi tidak diperiksa.

**Prioritas.** Dampak 4/5; effort M; Quick Win. Alasan effort: Reuse employee redaction/home-depot reach; fixture penugasan lintas depot. Effort M karena ekspor dua format dan kontrol akses.

**Risiko.** Kondisi: Tinggi. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-BACKEND; CA-1-62 menambah ekspor penuh untuk round-trip; delta redaksi borrower yang sudah ditegakkan pada jalur list.

[VERIFIED services/hr-service/src/modules/reports.controller.ts:81] GET export memakai hrView

[VERIFIED services/hr-service/src/application/services/analytics.service.ts:218] employeeReport memakai current depot scope

[VERIFIED services/hr-service/src/application/services/analytics.service.ts:293] Kolom identitas dan rekening diekspor

[VERIFIED services/hr-service/src/infrastructure/prisma/analytics.prisma.repository.ts:266] Query Employee lengkap dengan live depotId

[VERIFIED services/hr-service/src/application/services/employee.service.ts:294] List menerapkan redaksi bila home depot tidak terjangkau

[VERIFIED services/hr-service/src/domain/employee-redaction.ts:11] Daftar field yang wajib disamarkan bagi peminjam

[VERIFIED services/hr-service/src/infrastructure/http/audit.interceptor.ts:31] GET dilewati audit mutasi

### AUT-001 — Validasi penerima laporan dan putuskan akses per dataset

Kandidat asal `AAS-04`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Recipients hanya string/array; kelas controller memakai hqBackOffice sementara dataset termasuk KASBON_BALANCE/ORDERS_DETAIL. Domain allowlist dan pemisahan capability belum merupakan keputusan tertulis dalam source yang dibaca.

**Kontrol yang sudah ada.** JWT/capability HQ, internal-key pada sweep, audit mutasi dan lease runner tersedia.

**Usulan minimum.** Terapkan validasi email dan batas array yang disetujui; Produk/Security menetapkan capability tiap dataset dan kebijakan domain eksternal sebelum pembatasan rollout.

**Acceptance criteria.** Email malformed ditolak; role tanpa izin dataset ditolak menurut matriks yang disahkan; tujuan sah tetap menerima laporan.

**Cara verifikasi.** DTO + policy/controller specs, sandbox mail; tidak mengirim email dalam audit.

**Owner.** Security, Produk dan Backend Admin

**Dependensi / ketidakpastian.** [ASSUMPTION] Keputusan Security/Produk per dataset dan daftar tujuan bisnis; jangan menutup domain eksternal secara sewenang-wenang.

**Prioritas.** Dampak 4/5; effort M; Strategis. Alasan effort: Beberapa DTO/policy/runner satu service; aturan bisnis perlu ditetapkan.

**Risiko.** Kondisi: Tinggi. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Pengiriman data sensitif terjadwal bergantung pada izin HQ yang luas dan input penerima longgar.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/admin-service/src/modules/dto/scheduled-report.dto.ts:31] Recipients hanya string, bukan IsEmail.

[VERIFIED services/admin-service/src/modules/scheduled-reports.controller.ts:33] Kelas memakai hqBackOffice.

[VERIFIED services/admin-service/src/domain/report-dataset.ts:19] Dataset termasuk saldo kasbon.

### AUT-010 — Ikat key foto PoD ke objek yang sah sebelum sign/delete

Kandidat asal `DLV-08`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] storageKeyFromUrl menerima substring mulai pod/ tanpa verifikasi origin/ownership. Key kemudian ditandatangani dan dihapus. Dampak lintas objek adalah inferensi yang memerlukan model permission bucket dan pengetahuan key; tidak ada klaim eksploitasi produksi.

**Kontrol yang sudah ada.** Bucket private dan signed link TTL; upload memeriksa berkas; endpoint proof dibatasi aktor.

**Usulan minimum.** Simpan key hasil upload yang tervalidasi dan terikat ke delivery/aktor; larang key lintas prefix/ownership saat sign/delete. Periksa kompatibilitas URL historis sebelum memperketat validasi.

**Acceptance criteria.** Proof URL/key asing ditolak; sign/delete hanya menyentuh objek yang terikat; PoD historis sah tetap dapat dibaca atau masuk daftar migrasi.

**Cara verifikasi.** Unit URL/key boundary serta fake storage assert object key; review prefix bersama expense receipt.

**Owner.** Backend Delivery dan Security

**Dependensi / ketidakpastian.** [ASSUMPTION] Kontrak storage dan upload; bukti ownership historis.

**Prioritas.** Dampak 4/5; effort M; Strategis. Alasan effort: Beberapa operasi storage satu domain dan kompatibilitas data lama.

**Risiko.** Kondisi: Tinggi. Implementasi: Sedang. Confidence: Sedang

**Jika ditunda.** Integritas bukti dan batas penghapusan objek bergantung pada input URL.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/delivery-service/src/application/services/delivery.service.ts:64] Key berasal dari pencarian substring pod/.

[VERIFIED services/delivery-service/src/application/services/delivery.service.ts:1117] Key dipakai signedUrl.

[VERIFIED services/delivery-service/src/application/services/delivery.service.ts:1139] Key dipakai remove pada purge.

### AUT-015 — Dump database diunggah sebagai gzip tanpa enkripsi klien

Kandidat asal `IDO-04`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Temuan baru spesifik proteksi material backup; bukan klaim backup/offsite/verification tidak tersedia. Tidak menyimpulkan SSE provider tidak aktif dan tidak menyimpulkan pelanggaran hukum.

**Kontrol yang sudah ada.** Offsite read-back checksum; backup env asimetris; provider kedua dapat dikonfigurasi; restore/drill sudah ada.

**Usulan minimum.** Pastikan jaminan provider terlebih dulu; jika threat model mencakup bocor credential bucket, enkripsi dump asimetris sebelum upload, batasi permission lokal, versikan format; sesuaikan restore-db, drill, deploy backup dan kedua provider sebelum rollout.

**Acceptance criteria.** Restore dari format baru membutuhkan kunci di luar VPS; tanpa kunci gagal jelas; format lama tetap dapat dipulihkan selama retensi; offsite read-back, kedua provider dan drill dapat memverifikasi artefak baru tanpa mengekspos data.

**Cara verifikasi.** Drill terisolasi dengan dataset sintetis dan kunci latihan saat implementasi; tidak dijalankan dalam audit.

**Owner.** DevOps/security dan pemilik backup

**Dependensi / ketidakpastian.** [ASSUMPTION] Kunci privat/custody teruji, keputusan kebijakan enkripsi, perbarui runbook restore/drill dan inventory format. Effort L karena pipeline lintas skrip, format, compatibility serta latihan; bukan Quick Win.

**Prioritas.** Dampak 4/5; effort L; Strategis. Alasan effort: Kunci privat/custody teruji, keputusan kebijakan enkripsi, perbarui runbook restore/drill dan inventory format. Effort L karena pipeline lintas skrip, format, compatibility serta latihan; bukan Quick Win.

**Risiko.** Kondisi: Tinggi. Implementasi: Sedang. Confidence: Tinggi untuk bytes source; enkripsi provider tidak diketahui

**Jika ditunda.** Kebocoran hak baca bucket dapat membuka seluruh dump bila provider/kebijakan tidak menghalanginya.

**SEARCH / PREV / DEC.** SEARCH-CTX-01; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED scripts/backup-db.sh:47] pg_dumpall dialirkan hanya melalui gzip

[VERIFIED scripts/upload-to-s3.mjs:44] PutObject meneruskan file

[VERIFIED scripts/upload-to-s3.mjs:47] Body readFileSync; tidak ada transform enkripsi

[VERIFIED scripts/backup-env.sh:106] Enkripsi SMIME AES256 sudah tersedia khusus env

[VERIFIED scripts/backup-second-provider.sh:48] Provider kedua memakai ulang backup-offsite dump

### AUT-022 — Simpan pelaku, waktu dan referensi hasil pencairan manual

Kandidat asal `PPA-02`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Controller membawa user.sub ke service, tetapi repository settle hanya menulis status; model withdrawal tidak menyimpan settledBy/transferRef. Aksi bank tetap manual. Ketiadaan audit payout end-to-end belum diklaim mutlak.

**Kontrol yang sudah ada.** CAS PROCESSING dan reversal saldo dalam transaksi; idempotency withdrawal dan maker-checker request tersedia.

**Usulan minimum.** Catat settledBy/At, reason dan bank reference untuk hasil transfer; audit append-only. Bedakan maker-checker request dari bukti settlement bank; kebijakan orang kedua opsional menunggu Finance.

**Acceptance criteria.** PAID baru memiliki aktor/waktu/ref; FAILED memiliki alasan dan reversal tepat sekali; data lama ditandai unknown tanpa fabricated actor.

**Cara verifikasi.** Migration compatibility, unit/DB race settle dan audit failure; tidak mengirim transfer.

**Owner.** Backend Payout dan Finance

**Dependensi / ketidakpastian.** [ASSUMPTION] Finance menentukan bukti referensi yang diterima dan retensinya.

**Prioritas.** Dampak 4/5; effort M; Strategis. Alasan effort: Schema dan repository dua jenis withdrawal dalam satu service.

**Risiko.** Kondisi: Tinggi. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Status uang keluar sulit ditelusuri ke bukti/pelaku yang tersimpan.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/payout-service/src/modules/hq-payout.controller.ts:203] Aktor tersedia di controller.

[VERIFIED services/payout-service/src/infrastructure/prisma/withdrawal.prisma.repository.ts:147] Settle hanya menulis status.

[VERIFIED services/payout-service/prisma/schema.prisma:269] Model courier withdrawal tanpa settlement evidence.

[VERIFIED services/payout-service/prisma/schema.prisma:290] Model owner withdrawal tanpa settlement evidence.

### AUT-002 — Pisahkan hasil pembuatan file dan hasil pengiriman laporan

Kandidat asal `AAS-05`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] File DONE disimpan, mailer.send di-await tetapi hasilnya diabaikan, kemudian run mengembalikan ok:true. File tersimpan adalah kontrol yang sah; gap berada pada visibilitas pengiriman.

**Kontrol yang sudah ada.** File tetap dapat diunduh dari hq/exports; error sumber menghasilkan FAILED; runner punya lease.

**Usulan minimum.** Catat produced/deliverySent/deliverySkipped/deliveryFailed terpisah; jangan menyebut file gagal ketika hanya email yang gagal.

**Acceptance criteria.** Mailer false menghasilkan indikator kirim gagal/dilewati, file tetap tersedia, retry kirim tidak membuat dua file atau dua email setelah sukses.

**Cara verifikasi.** Unit runner dengan mailer true/false dan konfigurasi SMTP kosong; manual lihat status UI.

**Owner.** Backend Admin dan Operasional HQ

**Dependensi / ketidakpastian.** [ASSUMPTION] Kontrak mailer boolean tersedia; UI ekspor perlu label terpisah.

**Prioritas.** Dampak 3/5; effort S; Strategis. Alasan effort: Perubahan status/metadata dan tampilan kecil; retry harus menghormati lease.

**Risiko.** Kondisi: Sedang. Implementasi: Rendah. Confidence: Tinggi

**Jika ditunda.** Operator dapat mengira laporan terkirim padahal hanya file yang dibuat.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/admin-service/src/application/services/scheduled-report-runner.service.ts:111] File disimpan DONE.

[VERIFIED services/admin-service/src/application/services/scheduled-report-runner.service.ts:123] Hasil mailer tidak dipakai.

[VERIFIED services/admin-service/src/application/services/scheduled-report-runner.service.ts:125] Hasil run tetap ok true.

### AUT-009 — Retur kurir belum mengikat order/customer ke delivery yang berwenang

Kandidat asal `DEP-06`; adjudikasi `reclassify`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] [INFERRED] Body depotId/orderId/customerId diteruskan ke recordFromCourier; method yang dibaca mengukur saldo pelanggan itu dan mencatat return tanpa lookup order/delivery. Guard depot tetap ada, jadi klaim kurir bebas lintas depot tidak didukung.

**Kontrol yang sudah ada.** STAFF_DEPOT terkunci depot; refund min(rate*qty,depositLeft); unknown customer refund 0; serialized balance; idempoten per order.

**Usulan minimum.** Validasi bahwa order/customer/depot/courier cocok dengan delivery miliknya melalui kontrak service-auth; jangan gandakan depot guard.

**Acceptance criteria.** Kurir tidak dapat mengatasnamakan customer/order lain dalam depotnya; retry handover sah tetap idempoten; depot lain ditolak existing guard.

**Cara verifikasi.** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner.** Backend depot/delivery + operasi kurir

**Dependensi / ketidakpastian.** [ASSUMPTION] Kontrak delivery/order lookup + aturan handover non-order

**Prioritas.** Dampak 3/5; effort M; Strategis. Alasan effort: Kontrak delivery/order lookup + aturan handover non-order

**Risiko.** Kondisi: Sedang. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-BACKEND; CA-4-47 sudah menutup refund kolektif anonymous; delta hubungan identifier order/customer/driver yang telah diisi.

[VERIFIED services/depot-service/src/modules/driver-gallon-return.controller.ts:30] Identifier body diteruskan

[VERIFIED services/depot-service/src/application/services/gallon-return.service.ts:342] Hanya requireDepot pada awal recordFromCourier

[VERIFIED services/depot-service/src/application/services/gallon-return.service.ts:375] Outstanding dihitung terhadap customerId body

[VERIFIED services/depot-service/src/application/services/gallon-return.service.ts:384] createFromOrder memakai identifier body

[VERIFIED packages/access/src/index.ts:324] courierReturn STAFF_DEPOT

[VERIFIED packages/platform/src/nest/depot-scope.ts:15] STAFF_DEPOT locked

[VERIFIED packages/platform/src/nest/depot-scope.guard.ts:79] depotId request harus di set caller

### AUT-011 — Rebuild forecast tidak membedakan feed gagal dari feed selesai

Kandidat asal `FCS-04`; adjudikasi `reclassify`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] [INFERRED] Ingest real-time best-effort disengaja. Adapter feed mengembalikan empty/null pada 500/timeout; rebuild berhenti dan return ingested/pages seperti EOF normal. Dampak diturunkan 4 ke 3 karena read model BI, bukan efek stok/uang.

**Kontrol yang sudah ada.** Ingest idempoten dan rebuild manual tersedia. Tidak perlu memblokir checkout atas outage forecast.

**Usulan minimum.** Return status failed/incomplete beserta cursor durable dan lag read-model; baru jadwalkan backfill setelah failure contract benar. Jangan menjanjikan semua order pulih dengan rebuild fail-open saat ini.

**Acceptance criteria.** Feed 500 di halaman kedua menandai incomplete dan menyimpan titik lanjut; retry memulihkan order sekali; EOF kosong yang sah tetap success.

**Cara verifikasi.** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner.** Backend forecast/order + pemilik BI

**Dependensi / ketidakpastian.** [ASSUMPTION] Order feed + read model; kebijakan freshness PO, bukan SLA 24 jam karangan

**Prioritas.** Dampak 3/5; effort M; Strategis. Alasan effort: Order feed + read model; kebijakan freshness PO, bukan SLA 24 jam karangan

**Risiko.** Kondisi: Sedang. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-BACKEND; CA-2-69 sudah membetulkan label reload/rebuild UI; delta kegagalan feed dan status completeness di backend.

[VERIFIED services/order-service/src/application/services/order.service.ts:2412] Recommendation/forecast di luar outbox, best-effort

[VERIFIED services/order-service/src/infrastructure/http/forecast-coordination.http.adapter.ts:52] Ingest gagal hanya warn

[VERIFIED services/forecast-service/src/infrastructure/http/order-feed.http.adapter.ts:49] Non-2xx menjadi halaman kosong EOF

[VERIFIED services/forecast-service/src/infrastructure/http/order-feed.http.adapter.ts:63] Catch menjadi halaman kosong EOF

[VERIFIED services/forecast-service/src/application/services/rebuild.service.ts:31] Loop berhenti nextCursor null dan return hitungan

[VERIFIED services/forecast-service/src/modules/forecast.controller.ts:206] Rebuild tersedia untuk SUPER_ADMIN

### AUT-014 — Input dispatch disisipkan ke badan shell sebelum validasi

Kandidat asal `IDO-03`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Source menunjukkan injection boundary di runner pembentuk command dan remote script. Hak dispatch membatasi exposure; tidak ada bukti exploit atau akses anonim.

**Kontrol yang sudah ada.** Dispatch berwenang; envs dipakai untuk secret lain; command mode pilihan tetap.

**Usulan minimum.** Gunakan environment variabel dan quote setiap argumen, validasi sha/nama service/phone sebelum command; hindari command string dinamis. Periksa mobile version_name521 dengan pola sama.

**Acceptance criteria.** Nilai mengandung quote, substitusi shell atau newline ditolak/sebagai literal, tidak menciptakan command tambahan di runner maupun SSH; mode sah tetap bekerja.

**Cara verifikasi.** Uji command assembly dengan shell fixture lokal tanpa SSH/secret dalam implementasi nanti.

**Owner.** DevOps/security

**Dependensi / ketidakpastian.** [ASSUMPTION] Owner CI/DevOps; regression fixture resolusi command.

**Prioritas.** Dampak 3/5; effort S; Strategis. Alasan effort: Owner CI/DevOps; regression fixture resolusi command.

**Risiko.** Kondisi: Sedang. Implementasi: Rendah. Confidence: Tinggi

**Jika ditunda.** Pengguna dispatch atau input salah dapat mengubah perintah yang dieksekusi.

**SEARCH / PREV / DEC.** SEARCH-CTX-02; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED .github/workflows/deploy.yml:235] sha diinterpolasi ke perintah echo shell

[VERIFIED .github/workflows/deploy.yml:282] services diinterpolasi ke perintah echo shell

[VERIFIED .github/workflows/deploy.yml:295] demo_phone diinterpolasi ke shell pembentuk command

[VERIFIED .github/workflows/deploy.yml:435] Command output dijalankan di SSH

[VERIFIED .github/workflows/deploy.yml:375] Nilai lain sudah memakai envs

### AUT-017 — Pemantauan belum membuktikan kesehatan ujung-ke-ujung jalur alert

Kandidat asal `IDO-09`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Spot-check deterministik primary: KEEP dengan batas. Source mendukung blind spot running-but-hung alert pipeline; jangan menyebut tidak ada monitoring sama sekali atau menyatakan alert produksi hilang. `vector(0)` alert bisnis bukan dead-man.

**Kontrol yang sudah ada.** Restart policy, watchdog stopped/running-unhealthy untuk container ber-healthcheck, scrape/exporter alerts, Uptime GitHub independen, webhook aplikasi langsung.

**Usulan minimum.** Tambahkan probe kesehatan dua container dan heartbeat end-to-end dengan penerima independen jika pemilik memilih cakupan itu. Heartbeat dari dalam VPS harus diperiksa dari luar agar tidak mati bersama sistem.

**Acceptance criteria.** Pada latihan terisolasi, hang Alertmanager/Prometheus saat API/web sehat terdeteksi oleh jalur independen; respons pemulihan teramati; kehilangan webhook receiver juga terlihat. Ambang/cadence ditetapkan DevOps.

**Cara verifikasi.** Latihan gangguan terisolasi setelah implementasi, tidak pada produksi/audit.

**Owner.** DevOps/on-call

**Dependensi / ketidakpastian.** [ASSUMPTION] Penerima heartbeat di luar VPS dan keputusan operasional biaya; healthchecks saja belum membuktikan delivery webhook.

**Prioritas.** Dampak 3/5; effort M; Strategis. Alasan effort: Penerima heartbeat di luar VPS dan keputusan operasional biaya; healthchecks saja belum membuktikan delivery webhook.

**Risiko.** Kondisi: Sedang. Implementasi: Sedang. Confidence: Tinggi dalam cakupan source

**Jika ditunda.** API bisa tampak sehat sementara sebagian rantai notifikasi tidak mengirim; kejadian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-CTX-08; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED docker-compose.prod.yml:896] Prometheus896–910 tanpa healthcheck

[VERIFIED docker-compose.prod.yml:975] Alertmanager975–999 tanpa healthcheck

[VERIFIED ops/prometheus.yml:23] Scrape aplikasi dan infra, bukan heartbeat pipeline

[VERIFIED scripts/watchdog.sh:41] Watchdog mengambil daftar container unhealthy

[VERIFIED scripts/lib/deploy-common.sh:191] Container tanpa healthcheck dinilai running saja

[VERIFIED scripts/uptime-probe.sh:48] External uptime memeriksa gateway/depot/web saja

### AUT-023 — Nudge pesan ulang berulang dan penghitung sukses mengabaikan boolean

Kandidat asal `RET-01`; adjudikasi `reclassify`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] [INFERRED] Query mengambil pelanggan tertua berdasarkan semua orders; notify tanpa key dan .then(()=>true) membuang false dari adapter. Jadwal nyata harian ditemukan. Klasifikasi marketing reminder perlu PO; jangan langsung klaim pelanggaran consent.

**Kontrol yang sudah ada.** Limit query dan scheduler tersedia; notification delivery fail-open; push-mute preference tersedia. Opt-out marketing bukan bagian jalur notify langsung yang dibaca.

**Usulan minimum.** Pertama gunakan boolean hasil notify untuk counter; PO menentukan nudge cadence, eligible status dan marketing/transaksional; lalu key per customer/periode dan eligibility paging yang tidak menahan 500 tertua selamanya.

**Acceptance criteria.** Adapter false menaikkan failed; dua sweep satu periode tidak menggandakan nudge; eligible batch setelah 500 pelanggan tetap tercapai; opt-out mengikuti klasifikasi PO.

**Cara verifikasi.** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner.** PO/marketing + backend order/CRM

**Dependensi / ketidakpastian.** [ASSUMPTION] Gabungkan ORD-03; keputusan cadence/status/consent PO

**Prioritas.** Dampak 3/5; effort M; Strategis. Alasan effort: Gabungkan ORD-03; keputusan cadence/status/consent PO

**Risiko.** Kondisi: Sedang. Implementasi: Sedang. Confidence: Tinggi

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-BACKEND; J7 sudah menambah counter failure; delta boolean yang dibuang membuat counter itu tetap salah.

[VERIFIED services/order-service/src/infrastructure/prisma/order.prisma.repository.ts:323] Query latest-order cutoff tanpa status dan penanda sudah dinudge

[VERIFIED services/order-service/src/application/services/order.service.ts:1619] notify lalu then true

[VERIFIED services/order-service/src/infrastructure/http/notification.http.adapter.ts:16] ONCE_PER_ORDER tidak memuat REORDER_REMINDER

[VERIFIED services/order-service/src/infrastructure/http/notification.http.adapter.ts:100] Adapter error menghasilkan false

[VERIFIED services/crm-service/src/application/services/notification.service.ts:244] Dedupe opsional

[VERIFIED services/crm-service/src/infrastructure/notification/inbox-broadcast.delivery.ts:37] Marketing gate ada pada campaign path

[VERIFIED scripts/scheduler/crontab:30] Nudge dijadwalkan 08:00 timezone container

### AUT-004 — Allowlist auth test terlalu luas pada products namespace

Kandidat asal `APP-01`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] PUBLIC_PREFIXES mencakup seluruh products, termasuk mutation/admin paths. Koreksi narasi lama: api.ts saat ini melampirkan bearer bila token tersedia meskipun auth=false; flag menentukan wait/unlock dan refresh. Gap adalah regresi saat boot/session expiry, bukan pasti tanpa bearer setiap saat.

**Kontrol yang sudah ada.** Seluruh call site aktif yang dipindai awal sudah menggunakan flag yang sesuai.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Jangan menyebut broken production mutation tanpa bukti call site.

**Acceptance criteria.** Mutation products tanpa auth flag ditolak guard test; browse/get/batch/categories publik tetap diterima.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Frontend engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Jangan menyebut broken production mutation tanpa bukti call site.

**Prioritas.** Dampak 2/5; effort S; Nice-to-have. Alasan effort: Jangan menyebut broken production mutation tanpa bukti call site.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Tinggi

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED apps/web/test/unauthenticated-calls.test.ts:44] allowlist menerima semua members products

[VERIFIED apps/web/src/lib/endpoints/shop.ts:41] namespace juga memiliki mutation admin

[VERIFIED apps/web/src/lib/api.ts:139] authHeader mengirim bearer bila tersedia tanpa memeriksa options.auth

### AUT-016 — Perjelas permissions workflow dan pin Buildx SHA

Kandidat asal `IDO-08`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Hardening source; tidak ada bukti default token broad atau aksi supply-chain terjadi. Permissions org/repo belum dibaca.

**Kontrol yang sudah ada.** Action lain dipin; permission default disebut read-only dalam dokumen lama, tidak diverifikasi live.

**Usulan minimum.** Deklarasikan permissions minimum top-level/job yang membutuhkan write; pin dua action Buildx ke SHA kompatibel.

**Acceptance criteria.** Semua job tetap mendapat hak minimum yang diperlukan dan seluruh third-party action mengikuti pinning policy; update dependency tetap memiliki jalur terkelola.

**Cara verifikasi.** Review YAML dan job requirements; CI nanti, audit tidak menjalankannya.

**Owner.** DevOps/security

**Dependensi / ketidakpastian.** [ASSUMPTION] Owner CI; ketahui job publish/comment yang perlu hak lebih.

**Prioritas.** Dampak 2/5; effort S; Nice-to-have. Alasan effort: Owner CI; ketahui job publish/comment yang perlu hak lebih.

**Risiko.** Kondisi: Rendah. Implementasi: Rendah. Confidence: Tinggi untuk deklarasi source

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-CTX-07; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED .github/workflows/ci.yml:1108] Setup Buildx memakai tagv3

[VERIFIED .github/workflows/ci.yml:1240] Pemanggilan kedua memakai tagv3

### AUT-018 — Raw URL pada alert memperlebar cardinality dan konteks sensitif

Kandidat asal `PLT-02`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] AllExceptionsFilter meneruskan request.url; webhook dedup dan teks memakai path mentah, Sentry transaction name juga. Stack/message disamarkan tetapi path tidak. Pengiriman PII aktual belum dibuktikan; risiko kondisional pada URL yang mengandung input pribadi.

**Kontrol yang sudah ada.** Redaksi stack, DSN/webhook opt-in, bounded map 500 dan dedupe 60 detik sudah ada.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Normalisasi route harus mempertahankan diagnosis tanpa mengekspor query.

**Acceptance criteria.** Alert banyak id pada template sama dibatasi sesuai kebijakan; query/credential tidak tampil pada transaction name atau webhook.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Platform engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Normalisasi route harus mempertahankan diagnosis tanpa mengekspor query.

**Prioritas.** Dampak 2/5; effort S; Nice-to-have. Alasan effort: Normalisasi route harus mempertahankan diagnosis tanpa mengekspor query.

**Risiko.** Kondisi: Sedang. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Tinggi

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED packages/platform/src/nest/all-exceptions.filter.ts:45] filter memasukkan URL mentah

[VERIFIED packages/platform/src/nest/error-alerter.ts:79] dedup berbeda untuk setiap id/query

[VERIFIED packages/platform/src/nest/error-alerter.ts:91] label webhook memuat path tanpa redactAlertText

[VERIFIED packages/platform/src/nest/sentry.ts:61] Sentry transaction memakai path mentah

[VERIFIED apps/web/src/lib/endpoints/identity.ts:32] builder identitas menaruh phone dalam query; error 5xx pada jalur ini belum dibuktikan

### AUT-019 — Regex audit terlalu luas untuk field shipping dan params mentah

Kandidat asal `PLT-07`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] SECRET_KEY memuat pin tanpa anchor, sehingga shippingFee cocok dan teredaksi. params dimasukkan tanpa redaksi. Kebocoran token aktual pada param belum dibuktikan; kehilangan field shipping adalah konsekuensi deterministik regex.

**Kontrol yang sudah ada.** Shallow redaction, payload array/object minimization dan coverage interceptor sudah ada.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Nilai params mana yang boleh disimpan perlu data classification, jangan mencetak token uji nyata.

**Acceptance criteria.** shippingFee terlihat sebagai data non-secret, pin/token/password tetap disamarkan, params sensitif juga disamarkan.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Platform engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Nilai params mana yang boleh disimpan perlu data classification, jangan mencetak token uji nyata.

**Prioritas.** Dampak 2/5; effort S; Nice-to-have. Alasan effort: Nilai params mana yang boleh disimpan perlu data classification, jangan mencetak token uji nyata.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Tinggi

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED packages/platform/src/nest/audit-mutations.interceptor.ts:28] alternatif pin cocok sebagai substring

[VERIFIED packages/platform/src/nest/audit-mutations.interceptor.ts:141] params ditulis mentah ke metadata

### AUT-020 — Audit permission mobile memakai allowlist gabungan dua binary

Kandidat asal `PLT-08`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] ALLOWED menerima Bluetooth/Wi-Fi dengan justifikasi Ops; CLI hanya mengenal path manifest, tidak binary. customer includePlugins sudah mengecualikan printer, sehingga ini guard regresi terhadap kebocoran dependency, bukan bukti permission customer aktif bocor.

**Kontrol yang sudah ada.** Merged-manifest audit dan customer plugin allowlist sudah WIRED.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Manifest output aktual tidak dibangun atau diperiksa pada audit ini.

**Acceptance criteria.** Manifest customer dengan permission Ops-only gagal, Ops tetap diterima dengan alasan; strip camera/fine customer tetap divalidasi.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Mobile/DevOps engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Manifest output aktual tidak dibangun atau diperiksa pada audit ini.

**Prioritas.** Dampak 2/5; effort S; Nice-to-have. Alasan effort: Manifest output aktual tidak dibangun atau diperiksa pada audit ini.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Tinggi

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED mobile/scripts/audit-manifest.mjs:36] daftar izin gabungan dua binary

[VERIFIED mobile/scripts/audit-manifest.mjs:176] argument hanya path manifest

[VERIFIED mobile/capacitor.config.ts:44] customer plugin list sudah mengecualikan printer

[VERIFIED .github/workflows/mobile.yml:605] workflow customer menjalankan auditor manifest yang sama

### AUT-021 — Dependency mobile terpisah dari npm workspace vulnerability gate

Kandidat asal `PLT-09`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] mobile sengaja di luar root workspaces; workflow menginstal dependency mobile sendiri. Gate audit root menjalankan npm audit di cwd root, sehingga lock mobile tidak termasuk. Belum ditemukan step audit mobile dalam scope workflow yang dipindai (SEARCH-FE-04). Tidak menyatakan ada CVE aktual.

**Kontrol yang sudah ada.** Exact plugin pins dan root npm audit/security workflows sudah ada.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Perlu reuse policy allowlist dan jadwal audit mobile; audit ini tidak mengakses registry.

**Acceptance criteria.** Advisory high/critical yang tidak ditriase pada lock mobile menggagalkan gate dengan basis advisory yang tercatat, tanpa mengubah scope deploy VPS.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** DevOps/mobile engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Perlu reuse policy allowlist dan jadwal audit mobile; audit ini tidak mengakses registry.

**Prioritas.** Dampak 2/5; effort M; Nice-to-have. Alasan effort: Perlu reuse policy allowlist dan jadwal audit mobile; audit ini tidak mengakses registry.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Tinggi

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED mobile/README.md:19] mobile memiliki lock/dependency sendiri

[VERIFIED scripts/audit-gate.mjs:103] gate audit menjalankan npm audit pada cwd pemanggil

[VERIFIED .github/workflows/mobile.yml:130] workflow memiliki instalasi dependency mobile

### AUT-024 — Upload PoD diulang pada tiap retry complete

Kandidat asal `WEB-05`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] run(pod) meng-upload photo/signature sebelum complete pada setiap eksekusi. URL tidak disimpan pada QueuedJob. Jika complete gagal sesudah upload, percobaan berikut meng-upload lagi.

**Kontrol yang sudah ada.** Retry terbatas enam kali, privasi retensi tujuh hari.

**Usulan minimum.** Persist key/URL upload yang sukses pada job sehingga retry complete memakai objek yang sama; hapus orphan hanya dengan bukti kepemilikan.

**Acceptance criteria.** Complete gagal setelah upload lalu diulang memakai objek yang sama bila masih valid; penghapusan payload dan objek yatim mengikuti retensi.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Frontend engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Kontrak URL/signing/storage ownership delivery-service.

**Prioritas.** Dampak 1/5; effort M; Nice-to-have. Alasan effort: Kontrak URL/signing/storage ownership delivery-service.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Tinggi

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED apps/web/src/lib/offline-queue.ts:351] upload dilakukan sebelum complete pada tiap run

[VERIFIED apps/web/src/lib/offline-queue.ts:148] job menyimpan payload data URL dan metadata retry tanpa hasil URL

### AUT-025 — Revalidasi profil memicu refresh data turunan

Kandidat asal `WEB-06`; adjudikasi `reclassify`.

**Status / bukti.** PERLU DIPERDALAM; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Objek session baru memang ditulis pada fokus, tetapi manfaat performa belum diukur. Klaim familyId hilang dari indikator perangkat tidak tepat: familyId disimpan terpisah di session-device dan hanya dihapus saat signOut.

**Kontrol yang sudah ada.** Batas revalidasi satu menit dan single-flight GET sudah ada.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Tidak ada runtime profiling dalam audit ini.

**Acceptance criteria.** Ukur request tambahan dahulu; optimasi tidak boleh menunda pembaruan role/depot/capability.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Frontend engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Tidak ada runtime profiling dalam audit ini.

**Prioritas.** Dampak 1/5; effort S; Nice-to-have. Alasan effort: Tidak ada runtime profiling dalam audit ini.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Sedang

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED apps/web/src/lib/auth-context.tsx:90] profil ditulis ulang sesudah revalidate

[VERIFIED apps/web/src/lib/session-device.ts:18] familyId indikator perangkat punya penyimpanan sendiri

### AUT-026 — File transfer belum memakai telemetry dan retry rate-limit JSON

Kandidat asal `WEB-10`; adjudikasi `keep`.

**Status / bukti.** PARSIAL; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] uploadFile/getBlob/postBlob membangun authHeader sendiri, tanpa appHeaders dan pemrosesan x-hm-depot-changed yang ada pada rawRequest. Ini perbedaan observability/recovery, bukan hilangnya auth: ketiganya menunggu waitForSession dan menangani 401.

**Kontrol yang sudah ada.** Timeout 60 detik, wait unlock, parse error dan refresh 401 sudah ada.

**Usulan minimum.** Satukan header telemetry dan kebijakan rate-limit untuk upload/blob bila kontraknya aman; retry mutasi upload wajib mempertimbangkan dedup.

**Acceptance criteria.** Transfer file membawa identitas build dan merespons depot-change sama dengan JSON; retry hanya bila aman untuk operasi/stream.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Frontend engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Jangan menerapkan replay upload otomatis tanpa kajian objek duplikat WEB-05.

**Prioritas.** Dampak 1/5; effort M; Nice-to-have. Alasan effort: Jangan menerapkan replay upload otomatis tanpa kajian objek duplikat WEB-05.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Tinggi

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED apps/web/src/lib/api.ts:452] multipart punya timeout dan refresh retry sendiri

[VERIFIED apps/web/src/lib/api.ts:504] file GET memakai authHeader tanpa appHeaders

[VERIFIED apps/web/src/lib/api.ts:297] JSON request mengolah depot change header

### AUT-003 — Tentukan retensi dataset lokal admin sebelum membuat purge

Kandidat asal `AAS-08`; adjudikasi `defer-policy`.

**Status / bukti.** PERLU DIPERDALAM; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Registry executor yang dibaca berisi dataset remote, bukan export_logs/webhook/tickets/fraud. Pencarian absence harus dibatasi source/registry yang diaudit; belum membuktikan konfigurasi retensi produksi.

**Kontrol yang sudah ada.** Engine retensi dan daftar UNENFORCED untuk policy yang terdaftar; erasure tiket per orang terpisah.

**Usulan minimum.** Inventaris dan klasifikasi data lokal admin; putuskan window/hold lalu tambahkan executor. Jangan menghapus catatan sengketa/keuangan dengan cutoff arbitrer.

**Acceptance criteria.** Setiap dataset punya kebijakan atau exemption bernama; dry-run menampilkan calon purge/hold dan audit trail; legal hold mencegah hapus.

**Cara verifikasi.** Review policy dan fake executor cutoff/hold; tidak menjalankan purge saat audit.

**Owner.** Data Governance dan Backend Admin

**Dependensi / ketidakpastian.** [ASSUMPTION] Legal/Finance/Security menetapkan klasifikasi/window; baseline data aktual belum diperiksa.

**Prioritas.** Dampak 3/5; effort M; Jangan dikerjakan dulu. Alasan effort: Kebijakan beberapa model dan executor aman dengan legal hold.

**Risiko.** Kondisi: Sedang. Implementasi: Tinggi. Confidence: Sedang

**Jika ditunda.** Cakupan retensi lokal belum dapat dipastikan dari registry remote.

**SEARCH / PREV / DEC.** SEARCH-RESUME-PRIMARY; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED services/admin-service/src/infrastructure/http/purge-executor.registry.ts:21] Daftar executor remote; tidak menunjukkan executor lokal dataset ini.

### AUT-008 — Penyesuaian stok mentah dan opname perlu kebijakan kontrol kuantitas

Kandidat asal `DEP-04`; adjudikasi `defer-policy`.

**Status / bukti.** PERLU DIPERDALAM; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Temuan lama menyebut dampak 3-4. Tidak dipromosikan sebagai temuan kuat pada resume ini: source adjust/opname/approval belum dibaca ulang lengkap; tidak boleh menganggap approval pasca-fakta salah tanpa keputusan proses.

**Kontrol yang sudah ada.**

**Usulan minimum.** Pertahankan kandidat legacy dengan label belum diverifikasi ulang dan pertanyaan PO tentang approval sebelum/sesudah fakta.

**Acceptance criteria.** Bukti source lengkap dan keputusan proses tersedia sebelum implementasi.

**Cara verifikasi.** Unit/contract/race sesuai acceptance, hanya pada tahap implementasi terpisah; belum dijalankan.

**Owner.** Backend

**Dependensi / ketidakpastian.** [ASSUMPTION] Operasi stok + finance

**Prioritas.** Dampak 3/5; effort M; Jangan dikerjakan dulu. Alasan effort: Operasi stok + finance

**Risiko.** Kondisi: Sedang. Implementasi: Sedang. Confidence: Rendah

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-RESUME-BACKEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.



### AUT-005 — Input placeholder perlu telaah label persisten dan AT

Kandidat asal `APP-03`; adjudikasi `defer-evidence`.

**Status / bukti.** PERLU DIPERDALAM; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Source tanpa aria-label/id-label tidak otomatis membuktikan accessible name kosong: placeholder bisa menjadi fallback accessible name. Reframe sebagai dugaan label tidak persisten; uji DOM/AT diperlukan sebelum klaim pelanggaran.

**Kontrol yang sudah ada.** Banyak form sudah memakai Field/aria-label.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Tidak menjalankan browser/axe dalam audit statis ini.

**Acceptance criteria.** Input punya label persisten atau aria yang sesuai konteks, diperiksa DOM/axe dan keyboard pada halaman terpilih.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Frontend engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Tidak menjalankan browser/axe dalam audit statis ini.

**Prioritas.** Dampak 2/5; effort S; Jangan dikerjakan dulu. Alasan effort: Tidak menjalankan browser/axe dalam audit statis ini.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Sedang

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED apps/web/src/components/ui.tsx:174] Input adalah wrapper passthrough; nama aksesibel ditentukan pemanggil

### AUT-006 — Gate dashboard per halaman merupakan perlindungan regresi

Kandidat asal `APP-04`; adjudikasi `defer-evidence`.

**Status / bukti.** PARSIAL; WIRED; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] Dashboard layout menjamin auth tetapi tidak membatasi semua capability. Halaman insight mendelegasikan gate ke InsightDashboard. Tidak ada halaman bocor data yang dibuktikan; usulan penjaga regresi lebih tepat daripada menambah gate role kasar yang dapat memblokir custom role sah.

**Kontrol yang sudah ada.** Backend RBAC tetap menolak akses yang tidak sah; gate halaman sudah banyak tersedia.

**Usulan minimum.** Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Metode static guard harus mengerti komponen yang mendelegasikan gate.

**Acceptance criteria.** Halaman dashboard baru tanpa policy eksplisit gagal pemeriksaan; gate delegasi terdokumentasi dan custom role tetap mengikuti capability.

**Cara verifikasi.** Usulan verifikasi terisolasi; tidak dijalankan dalam audit statis.

**Owner.** Frontend engineer

**Dependensi / ketidakpastian.** [ASSUMPTION] Metode static guard harus mengerti komponen yang mendelegasikan gate.

**Prioritas.** Dampak 2/5; effort S; Jangan dikerjakan dulu. Alasan effort: Metode static guard harus mengerti komponen yang mendelegasikan gate.

**Risiko.** Kondisi: Rendah. Implementasi: Sedang; perlu review compatibility pemanggil.. Confidence: Tinggi

**Jika ditunda.** Risiko merupakan skenario dari source, bukan bukti kejadian atau kerugian produksi.

**SEARCH / PREV / DEC.** SEARCH-RESUME-FRONTEND; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED apps/web/src/app/dashboard/layout.tsx:45] layout membatasi autentikasi saja

[VERIFIED apps/web/src/app/dashboard/insight/page.tsx:9] insight mendelegasikan gate

[VERIFIED apps/web/src/app/hq/layout.tsx:37] HQ menerapkan capability gate terpusat per pathname

### AUT-013 — Baseline Load gagal dipush tetapi run tetap sukses

Kandidat asal `IDO-02`; adjudikasi `reclassify`.

**Status / bukti.** PARSIAL; STATIC; runtime belum diverifikasi

**Skenario, aktor dan masalah.** [INFERRED] DROP klaim tidak pernah mendarat/karena branch protection: tidak ada provenance runtime. KEEP pilihan warning yang memang sengaja dinyatakan source, sebagai tradeoff bukan bug pasti.

**Kontrol yang sudah ada.** Retry3x; hasil job summary; gate beban sendiri tidak hilang.

**Usulan minimum.** Jika pemilik membutuhkan histori committed, gunakan artifact/PR baseline dengan indikator freshness; jangan mengubah run sehat merah tanpa kebutuhan itu.

**Acceptance criteria.** Satu run simulasi push ditolak tetap meninggalkan data teridentifikasi commit dan dapat dicari; kebijakan stale disepakati DevOps.

**Cara verifikasi.** Inspeksi artifact/run terpisah; audit ini tidak mengakses GitHub.

**Owner.** DevOps

**Dependensi / ketidakpastian.** [ASSUMPTION] Keputusan kebutuhan histori dan akses repo Actions saat implementasi.

**Prioritas.** Dampak 2/5; effort S; Jangan dikerjakan dulu. Alasan effort: Keputusan kebutuhan histori dan akses repo Actions saat implementasi.

**Risiko.** Kondisi: Rendah. Implementasi: Rendah. Confidence: Tinggi untuk fallback warning, rendah untuk penyebabnya

**Jika ditunda.** Risiko yang disimpulkan dari source tetap terbuka; frekuensi dan kerugian aktual belum diketahui.

**SEARCH / PREV / DEC.** SEARCH-CTX-10; Delta dibatasi source yang dirujuk dan kontrol di atas; seluruh register lama belum direvalidasi. Kandidat tidak menjadi bukti produksi.

[VERIFIED .github/workflows/load.yml:255] Rebase/push dicoba tiga kali

[VERIFIED .github/workflows/load.yml:264] Kegagalan akhir menjadi warning; hasil tetap ada di job summary



# Otomasi yang ada dan batas pemulihannya

| Jalur | Pemicu saat ini | Kontrol yang terlihat | Celah dan langkah berikutnya |
|---|---|---|---|
| Order outbox | worker outbox mengirim topik stok, poin, referral, franchise | retry saat handler melempar | FLW-010 (ORD-01): adapter yang menelan error membuat DONE terlalu dini; pastikan kontrak kegagalan penerima dan dedupe sebelum replay |
| Sweep pembayaran TTL | jadwal mencari pembayaran PENDING lama | CAS status dan pengecualian metode tertentu | FLW-016 (PPA-01): proofUrl belum membedakan kasus yang perlu tinjau; lindungi race upload dan sweep |
| Kampanye CRM | worker memproses recipient dengan lease | notifikasi mendukung dedupeKey bila dikirim | FLW-002 (CRM-01): delivery kampanye belum membawa key per recipient; lease kedaluwarsa dapat mengirim ulang |
| Rebuild forecast | feed order dibaca per page | ingest real-time best-effort | AUT-011 (FCS-04): error feed diperlakukan seperti EOF; simpan status incomplete/cursor sebelum menjanjikan backfill |
| Reminder reorder | jadwal harian | batas batch 500 | AUT-023 (RET-01): hasil boolean pengiriman dan pengulangan nudge perlu dipisahkan; jangan menyebut semua penerima berhasil |

Ini adalah pemetaan source dan usulan minimum, bukan bukti job berjalan pada jadwal produksi. Kunci, lease, status retry dan urutan receiver perlu diuji dengan fault injection pada tugas implementasi yang terpisah.


## 8. Matriks Prioritas dan Roadmap Tiga Fase

Urutan: integritas transaksi/kontinuitas, pembuka dependency, manfaat, effort dan confidence. Tidak ada weighted score/ROI nominal atau tanggal fiktif. Quick Win hanya dampak 4–5, effort S/M, kontrol/dependensi tersedia; patch tetap memerlukan tes pada implementasi.

| ID | Area | Judul | Masalah saat ini | Usulan | Dampak | Effort | Risiko saat ini | Risiko implementasi | Dependensi | Kelompok |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUT-007 | AUT | Lindungi peran akun saat ini dan super admin terakhir pada perubahan peran | [INFERRED] canGrantRole mengevaluasi peran baru; invite akun yang sudah ada mengubah role lalu save by id. Guard super admin terakhir tersedia untuk delete/suspend, bukan save role. Risiko penurunan peran disimpulkan dari interleaving source, bukan insiden produksi. | Gunakan otorisasi terhadap peran lama dan baru; lindungi keluar dari SUPER_ADMIN dalam transaksi dengan pola lock yang sudah tersedia, termasuk invite ulang dan jalur internal HR. | 4 | M | Tinggi | Sedang | Kontrak grantedBy HR yang sudah ada; perlu review kompatibilitas peran custom. | Quick Win |
| AUT-012 | AUT | Ekspor karyawan melewati redaksi depot peminjam | [INFERRED] [INFERRED] employeeReport memakai depotScopeIds lalu mencetak NIK/NPWP/rekening/gaji dari Employee penuh; tidak memakai homeDepot redaction seperti list. Dampak borrower memerlukan penugasan lintas depot aktif. | Gunakan kebijakan home/current-depot yang sama untuk ekspor, pertahankan field lengkap bagi pihak berwenang; tambahkan jejak download metadata tanpa payload PII. | 4 | M | Tinggi | Sedang | Reuse employee redaction/home-depot reach; fixture penugasan lintas depot. Effort M karena ekspor dua format dan kontrol akses. | Quick Win |
| FLW-002 | FLW | Kampanye memakai lease tetapi belum meneruskan dedupeKey per penerima | [INFERRED] [INFERRED] Notification ditulis sebelum recordRecipientResult. Lease recipient dapat kedaluwarsa; replay memanggil notify tanpa dedupeKey dan membuat row/push baru. | Bawa identitas recipient ke delivery port lalu gunakan key deterministik campaign-recipient; tetap bedakan percobaan kampanye baru. Review hasil lease agar stale worker tidak menimpa hasil baru. | 4 | M | Sedang | Rendah | Kontrak internal dalam crm; verifikasi migrasi dedupe pada deployment terpisah. Effort M karena port/fake/controller/service tests. | Quick Win |
| FLW-005 | FLW | Replay reschedule selalu memulihkan handoff order | [INFERRED] Status RESCHEDULED disimpan sebelum advanceOrder(PREPARING). Replay tanggal sama memanggil finishRescheduleReplay, tetapi segera return jika cashReturned tidak true. | Pisahkan pemulihan handoff order dari syarat reversal kas; tangani replay order yang sudah mencapai tujuan secara idempoten. Notifikasi harus memakai identitas percobaan agar reassign sah tidak teredam. | 4 | S | Tinggi | Rendah | Semantik konflik/transisi order yang sudah ada; jangan menelan seluruh 409 sebagai sukses. | Quick Win |
| FLW-016 | FLW | Pertahankan pembayaran berbukti dalam antrean tinjau saat TTL lewat | [INFERRED] findStalePending menyaring status/metode/createdAt tanpa proofUrl; sweep CAS PENDING menjadi FAILED. Bukti unggah bukan bukti uang sudah masuk, tetapi membutuhkan tinjau sebelum status terminal. | Pisahkan expiry belum-ada-bukti dari review bukti. Cek proof dalam predicate atomik agar unggah serentak tidak ditimpa. Pertahankan notifikasi dan antrean manual yang sudah ada. | 4 | M | Tinggi | Sedang | Kontrak review bukti yang sudah ada; Finance menyepakati penanganan bukti invalid melalui jalur fail manual. | Quick Win |
| FLW-020 | FLW | Logout native kehilangan bearer sebelum revoke dan unsubscribe | [INFERRED] signOut memulai request auth lalu clearTokens pada tick sama. request menunggu waitForSession sebelum rawRequest membaca bearer. await atas promise yang sudah resolved pun menunda kelanjutan; token sudah null. nativeUnsubscribe juga menunggu readEndpoint. Gateway native meneruskan bearer yang diterima ke auth/logout SelfScoped. | Tangkap token pada request revoke/unsubscribe sebelum clear, atau tunggu revoke dengan deadline lalu selalu bersihkan lokal. Jangan biarkan jaringan macet menahan logout. | 4 | S | Tinggi | Sedang; perlu review compatibility pemanggil. | Pertahankan token di snapshot request atau selesaikan revoke/unsubscribe secara terbatas sebelum clear. Jangan mengandalkan urutan pemanggilan promise. | Quick Win |
| FLW-010 | FLW | Outbox selesai meski efek stok/poin/referral/pendapatan gagal | [INFERRED] [INFERRED] Handler memenuhi Promise tanpa throw ketika adapter gagal; run menandai DONE. Kegagalan lookup pemilik juga mengembalikan null sehingga memperbaiki adapter payout saja tidak cukup. | Bedakan integrasi nonaktif yang sah dari dependency unavailable; failure efek wajib harus mempertahankan PENDING. Audit idempotensi penerima dan kompensasi lebih dahulu, khususnya referral reward; tambahkan alert/replay dengan batas kewenangan. | 5 | L | Tinggi | Sedang | Validasi idempotensi penerima per orderId, REF-01, strict lookup ownership, rollout lintas service. Effort L karena kontrak failure dan efek uang lintas database. | Strategis |
| AUT-001 | AUT | Validasi penerima laporan dan putuskan akses per dataset | [INFERRED] Recipients hanya string/array; kelas controller memakai hqBackOffice sementara dataset termasuk KASBON_BALANCE/ORDERS_DETAIL. Domain allowlist dan pemisahan capability belum merupakan keputusan tertulis dalam source yang dibaca. | Terapkan validasi email dan batas array yang disetujui; Produk/Security menetapkan capability tiap dataset dan kebijakan domain eksternal sebelum pembatasan rollout. | 4 | M | Tinggi | Sedang | Keputusan Security/Produk per dataset dan daftar tujuan bisnis; jangan menutup domain eksternal secara sewenang-wenang. | Strategis |
| AUT-010 | AUT | Ikat key foto PoD ke objek yang sah sebelum sign/delete | [INFERRED] storageKeyFromUrl menerima substring mulai pod/ tanpa verifikasi origin/ownership. Key kemudian ditandatangani dan dihapus. Dampak lintas objek adalah inferensi yang memerlukan model permission bucket dan pengetahuan key; tidak ada klaim eksploitasi produksi. | Simpan key hasil upload yang tervalidasi dan terikat ke delivery/aktor; larang key lintas prefix/ownership saat sign/delete. Periksa kompatibilitas URL historis sebelum memperketat validasi. | 4 | M | Tinggi | Sedang | Kontrak storage dan upload; bukti ownership historis. | Strategis |
| AUT-015 | AUT | Dump database diunggah sebagai gzip tanpa enkripsi klien | [INFERRED] Temuan baru spesifik proteksi material backup; bukan klaim backup/offsite/verification tidak tersedia. Tidak menyimpulkan SSE provider tidak aktif dan tidak menyimpulkan pelanggaran hukum. | Pastikan jaminan provider terlebih dulu; jika threat model mencakup bocor credential bucket, enkripsi dump asimetris sebelum upload, batasi permission lokal, versikan format; sesuaikan restore-db, drill, deploy backup dan kedua provider sebelum rollout. | 4 | L | Tinggi | Sedang | Kunci privat/custody teruji, keputusan kebijakan enkripsi, perbarui runbook restore/drill dan inventory format. Effort L karena pipeline lintas skrip, format, compatibility serta latihan; bukan Quick Win. | Strategis |
| AUT-022 | AUT | Simpan pelaku, waktu dan referensi hasil pencairan manual | [INFERRED] Controller membawa user.sub ke service, tetapi repository settle hanya menulis status; model withdrawal tidak menyimpan settledBy/transferRef. Aksi bank tetap manual. Ketiadaan audit payout end-to-end belum diklaim mutlak. | Catat settledBy/At, reason dan bank reference untuk hasil transfer; audit append-only. Bedakan maker-checker request dari bukti settlement bank; kebijakan orang kedua opsional menunggu Finance. | 4 | M | Tinggi | Sedang | Finance menentukan bukti referensi yang diterima dan retensinya. | Strategis |
| FLW-003 | FLW | Kunci gerakan GALON menyamakan issue dan return satu order | [INFERRED] [INFERRED] Kedua arah membawa orderId yang sama pada item GALON yang sama; setelah movement pertama, moveRawLine mengembalikan shortfall 0 tanpa gerakan kedua. | Pisahkan identitas kejadian issue vs return pada movement dan desain migrasi/backfill terukur; pertahankan replay masing-masing arah. | 4 | L | Tinggi | Sedang | Schema key movement, pra-cek histori dan saldo; effort L karena data lama dan migrasi identitas event | Strategis |
| FLW-004 | FLW | Penerimaan PO belum atomik terhadap retry/crash/paralel | [INFERRED] [INFERRED] PO dibaca SENT, seluruh receiveStock dilakukan, lalu lines/status ditulis satu kali; repository update hanya where id. Dua penerimaan atau retry setelah crash dapat menggandakan stok. | Unit transaksi receipt lokal atau receipt line beridentitas idempoten; CAS saja sebelum posting perlu jalur crash recovery. Pertahankan partial receipt. | 4 | M | Tinggi | Sedang | Repository PO + inventory dalam database depot; effort M karena unit transaksi domain tunggal | Strategis |
| FLW-007 | FLW | Tutup celah jendela pertanggungjawaban COD pada shift basi | [INFERRED] Auto-close memakai expectedEndAt sementara assignableShift tidak memeriksa waktu; settlement memilih deliveredAt dalam jendela shift. Delivery selesai setelah expectedEndAt sebelum check-in baru dapat berada di luar dua jendela (inferensi). | Hubungkan pertanggungjawaban delivery ke shift atau buat recovery eksplisit bagi interval yang tidak tercakup; jangan mengubah attendance checkout untuk menyamarkan waktu kerja. | 4 | L | Tinggi | Tinggi | Aturan Ops/Finance untuk shift penanggung jawab dan join payment tunai. | Strategis |
| FLW-008 | FLW | Pulihkan efek samping setelah proof of delivery tersimpan | [INFERRED] complete DELIVERED replay langsung return; advance order error hanya log; push earning dan webhook dijalankan void. Adapter payout menjawab false saat error, yang tidak direkonsiliasi pada jalur ini. | Persist intent handoff/earning/event bersama PoD atau antrean recovery durable. Reuse sourceRef penerima; identitas webhook perlu dedup tersendiri sebelum retry. Bedakan configuration disabled dari transient failure. | 4 | L | Tinggi | Tinggi | Order transition replay; payout idempotency termasuk insentif; admin webhook eventId. Gabungkan AAS-11 untuk sisi publisher, bukan membuat outbox kedua. | Strategis |
| FLW-011 | FLW | Penjualan konter dan pencatatan pembayaran masih dua langkah | [INFERRED] [INFERRED] Penjualan pickup dibuat COMPLETED dan completion outbox ditulis sebelum browser mencatat pembayaran. Klaim lama tidak ada tampilan rekonsiliasi salah: payment-recon sudah menampilkan order tanpa payment dan jalur remediasi. | Putuskan apakah completed berarti barang diserahkan atau pembayaran diterima; tambahkan recovery durable/exception aging pada alur existing jika diperlukan, bukan layar recon baru. | 4 | L | Tinggi | Sedang | Definisi bisnis completed/counter + kontrak order/payment + frontend | Strategis |
| FLW-019 | FLW | Pisahkan qualification referral dari penyelesaian reward durable | [INFERRED] Referral berubah QUALIFIED sebelum dua reward; safeReward dan adapter menelan error. Request reward tidak membawa idempotencyKey; replay QUALIFIED return tanpa memulihkan hadiah. Masalah utamanya kehilangan/recovery, bukan klaim double-award pada replay biasa. | Persist dua reward intent dengan key referralId+sisi, dedup di loyalty, rekonsiliasi status dan ledger. Jangan backfill QUALIFIED lama tanpa memeriksa apakah hadiah pernah tercatat. | 4 | L | Tinggi | Tinggi | Loyalty contract idempotency, migrasi reward status, dan ORD-01 producer recovery. | Strategis |
| AUT-002 | AUT | Pisahkan hasil pembuatan file dan hasil pengiriman laporan | [INFERRED] File DONE disimpan, mailer.send di-await tetapi hasilnya diabaikan, kemudian run mengembalikan ok:true. File tersimpan adalah kontrol yang sah; gap berada pada visibilitas pengiriman. | Catat produced/deliverySent/deliverySkipped/deliveryFailed terpisah; jangan menyebut file gagal ketika hanya email yang gagal. | 3 | S | Sedang | Rendah | Kontrak mailer boolean tersedia; UI ekspor perlu label terpisah. | Strategis |
| AUT-009 | AUT | Retur kurir belum mengikat order/customer ke delivery yang berwenang | [INFERRED] [INFERRED] Body depotId/orderId/customerId diteruskan ke recordFromCourier; method yang dibaca mengukur saldo pelanggan itu dan mencatat return tanpa lookup order/delivery. Guard depot tetap ada, jadi klaim kurir bebas lintas depot tidak didukung. | Validasi bahwa order/customer/depot/courier cocok dengan delivery miliknya melalui kontrak service-auth; jangan gandakan depot guard. | 3 | M | Sedang | Sedang | Kontrak delivery/order lookup + aturan handover non-order | Strategis |
| AUT-011 | AUT | Rebuild forecast tidak membedakan feed gagal dari feed selesai | [INFERRED] [INFERRED] Ingest real-time best-effort disengaja. Adapter feed mengembalikan empty/null pada 500/timeout; rebuild berhenti dan return ingested/pages seperti EOF normal. Dampak diturunkan 4 ke 3 karena read model BI, bukan efek stok/uang. | Return status failed/incomplete beserta cursor durable dan lag read-model; baru jadwalkan backfill setelah failure contract benar. Jangan menjanjikan semua order pulih dengan rebuild fail-open saat ini. | 3 | M | Sedang | Sedang | Order feed + read model; kebijakan freshness PO, bukan SLA 24 jam karangan | Strategis |
| AUT-014 | AUT | Input dispatch disisipkan ke badan shell sebelum validasi | [INFERRED] Source menunjukkan injection boundary di runner pembentuk command dan remote script. Hak dispatch membatasi exposure; tidak ada bukti exploit atau akses anonim. | Gunakan environment variabel dan quote setiap argumen, validasi sha/nama service/phone sebelum command; hindari command string dinamis. Periksa mobile version_name521 dengan pola sama. | 3 | S | Sedang | Rendah | Owner CI/DevOps; regression fixture resolusi command. | Strategis |
| AUT-017 | AUT | Pemantauan belum membuktikan kesehatan ujung-ke-ujung jalur alert | [INFERRED] Spot-check deterministik primary: KEEP dengan batas. Source mendukung blind spot running-but-hung alert pipeline; jangan menyebut tidak ada monitoring sama sekali atau menyatakan alert produksi hilang. `vector(0)` alert bisnis bukan dead-man. | Tambahkan probe kesehatan dua container dan heartbeat end-to-end dengan penerima independen jika pemilik memilih cakupan itu. Heartbeat dari dalam VPS harus diperiksa dari luar agar tidak mati bersama sistem. | 3 | M | Sedang | Sedang | Penerima heartbeat di luar VPS dan keputusan operasional biaya; healthchecks saja belum membuktikan delivery webhook. | Strategis |
| AUT-023 | AUT | Nudge pesan ulang berulang dan penghitung sukses mengabaikan boolean | [INFERRED] [INFERRED] Query mengambil pelanggan tertua berdasarkan semua orders; notify tanpa key dan .then(()=>true) membuang false dari adapter. Jadwal nyata harian ditemukan. Klasifikasi marketing reminder perlu PO; jangan langsung klaim pelanggaran consent. | Pertama gunakan boolean hasil notify untuk counter; PO menentukan nudge cadence, eligible status dan marketing/transaksional; lalu key per customer/periode dan eligibility paging yang tidak menahan 500 tertua selamanya. | 3 | M | Sedang | Sedang | Gabungkan ORD-03; keputusan cadence/status/consent PO | Strategis |
| BI-003 | BI | Register keamanan perlu direkonsiliasi per bukti | [INFERRED] Tidak membuktikan97 selesai hanya dari git log; ubah narasi menjadi register historis perlu source-level revalidation. Setiap owner mengisi delta source/test, bukan menutup otomatis. | Tambahkan source/PR/test/provenance untuk setiap status dan pertahankan keputusan accepted. | 3 | M | Sedang | Rendah | Owner service; jangan pakai runtime claims tanpa akses terpisah. | Strategis |
| FLW-001 | FLW | Retry penyesuaian stok delta dapat membuat movement kedua | [INFERRED] Frontend mengirim delta tanpa attempt key. Controller meneruskan delta tanpa key, service selalu memanggil applyMovement, dan repository menambah quantity serta movement baru per request. Unique itemId/orderId hanya berlaku untuk SALE; ADJUSTMENT memakai orderId null. Dua request yang sama setelah jawaban hilang dapat menjadi dua koreksi; kejadian produksi belum diukur. | Beri tiap upaya koreksi satu key yang stabil sampai hasilnya diketahui dan deduplikasi key di transaksi movement server. Buat key baru untuk koreksi berikutnya yang disengaja. | 3 | M | Sedang | Sedang; perlu review compatibility pemanggil. | Perubahan kontrak web, DTO/controller, dan penyimpanan key di depot-service; periksa klien mobile lama sebelum mewajibkan header. | Strategis |
| FLW-006 | FLW | Teruskan customerId dan deliveryWindow pada dispatch staf | [INFERRED] Controller membuat AssignInput eksplisit dan tidak memasukkan dua field yang tersedia pada DTO/use-case. Hasil historis aktual perlu pemeriksaan data terpisah. | Lengkapi pemetaan DTO-ke-input; jangan mengarang backfill customerId baris lama. | 3 | S | Sedang | Rendah | Validasi konsumen UI dan DTO; tidak ada migrasi baru. | Strategis |
| FLW-013 | FLW | Audit HTTP best-effort masih berpotensi kehilangan entri | [INFERRED] recordAuditEvent satu kali fetch ber-deadline, catch hanya logger.error. Fail-open ini keputusan teknis eksplisit yang harus dipertahankan untuk tidak membatalkan uang yang sudah settled; peningkatan durability adalah strategi baru, bukan kontrol yang diklaim belum pernah ada. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. PO/security menentukan tingkat evidensial yang dibutuhkan; desain outbox lokal dan ingest dedup lintas service. | 3 | L | Sedang | Sedang; perlu review compatibility pemanggil. | PO/security menentukan tingkat evidensial yang dibutuhkan; desain outbox lokal dan ingest dedup lintas service. | Strategis |
| FLW-021 | FLW | Retensi offline menghapus seluruh jenis job termasuk pencatatan uang | [INFERRED] flush memeriksa expired sebelum error dan menghapus semua kind setelah tujuh hari. Kebijakan melindungi payload foto, tetapi codConfirm dan gallonReturn juga hilang. Peristiwa lewat tujuh hari perlu rekonsiliasi, bukan replay tanpa batas. | Arsipkan job uang yang kedaluwarsa menjadi needs-review yang terlihat, dengan metadata aman dan instruksi rekonsiliasi; jangan replay otomatis transaksi tua tanpa cek status server. | 3 | M | Sedang | Sedang; perlu review compatibility pemanggil. | PO/finance menentukan umur rekonsiliasi dan minimisasi metadata; jangan meniadakan retensi biometrik. | Strategis |
| FTR-002 | FTR | Lengkapi jejak persetujuan untuk akun yang dibuat lewat login | [INFERRED] Login nomor baru membuat CUSTOMER PENDING, lalu verify dapat mengaktifkan akun; recordRegistrationConsent hanya pada register akun baru. Bukan kesimpulan kepatuhan atau dasar hukum. | Pilih satu titik UX persetujuan yang dapat diaudit bagi semua jalur aktivasi. Jangan mengisi backdated consent untuk akun lama tanpa tindakan pengguna. | 3 | M | Sedang | Sedang | Pilihan Legal/Produk tentang waktu persetujuan dan dokumen versinya. | Strategis |
| FTR-003 | FTR | Pisahkan mutasi alamat biasa dari penggantian alamat utama | [INFERRED] UpdateAddressDto mewarisi isPrimary dari create; service/repository meneruskan patch. Tipe TS tidak menghapus field runtime. Efek 500/primary kosong adalah inferensi constraint/selector, bukan hasil eksekusi. | Hilangkan isPrimary dari DTO patch atau tolak eksplisit; selalu gunakan jalur set-primary yang sudah atomik. | 3 | S | Sedang | Rendah | Tidak ada schema baru; periksa klien lama yang mengirim isPrimary lewat PATCH. | Strategis |
| FLW-009 | FLW | Installer belum menyiapkan log backup provider kedua | [INFERRED] Kegagalan bersyarat: bila file log belum ada dan user tidak dapat menulis /var/log, shell gagal sebelum skrip. Bukan bukti backup produksi gagal. | Tambahkan file log provider kedua ke installer dan pemeriksaan idempotensi installer. | 3 | S | Sedang | Rendah | Owner DevOps; test installer, tidak perlu migrasi aplikasi. | Nice-to-have |
| AUT-004 | AUT | Allowlist auth test terlalu luas pada products namespace | [INFERRED] PUBLIC_PREFIXES mencakup seluruh products, termasuk mutation/admin paths. Koreksi narasi lama: api.ts saat ini melampirkan bearer bila token tersedia meskipun auth=false; flag menentukan wait/unlock dan refresh. Gap adalah regresi saat boot/session expiry, bukan pasti tanpa bearer setiap saat. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Jangan menyebut broken production mutation tanpa bukti call site. | 2 | S | Rendah | Sedang; perlu review compatibility pemanggil. | Jangan menyebut broken production mutation tanpa bukti call site. | Nice-to-have |
| AUT-016 | AUT | Perjelas permissions workflow dan pin Buildx SHA | [INFERRED] Hardening source; tidak ada bukti default token broad atau aksi supply-chain terjadi. Permissions org/repo belum dibaca. | Deklarasikan permissions minimum top-level/job yang membutuhkan write; pin dua action Buildx ke SHA kompatibel. | 2 | S | Rendah | Rendah | Owner CI; ketahui job publish/comment yang perlu hak lebih. | Nice-to-have |
| AUT-018 | AUT | Raw URL pada alert memperlebar cardinality dan konteks sensitif | [INFERRED] AllExceptionsFilter meneruskan request.url; webhook dedup dan teks memakai path mentah, Sentry transaction name juga. Stack/message disamarkan tetapi path tidak. Pengiriman PII aktual belum dibuktikan; risiko kondisional pada URL yang mengandung input pribadi. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Normalisasi route harus mempertahankan diagnosis tanpa mengekspor query. | 2 | S | Sedang | Sedang; perlu review compatibility pemanggil. | Normalisasi route harus mempertahankan diagnosis tanpa mengekspor query. | Nice-to-have |
| AUT-019 | AUT | Regex audit terlalu luas untuk field shipping dan params mentah | [INFERRED] SECRET_KEY memuat pin tanpa anchor, sehingga shippingFee cocok dan teredaksi. params dimasukkan tanpa redaksi. Kebocoran token aktual pada param belum dibuktikan; kehilangan field shipping adalah konsekuensi deterministik regex. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Nilai params mana yang boleh disimpan perlu data classification, jangan mencetak token uji nyata. | 2 | S | Rendah | Sedang; perlu review compatibility pemanggil. | Nilai params mana yang boleh disimpan perlu data classification, jangan mencetak token uji nyata. | Nice-to-have |
| AUT-020 | AUT | Audit permission mobile memakai allowlist gabungan dua binary | [INFERRED] ALLOWED menerima Bluetooth/Wi-Fi dengan justifikasi Ops; CLI hanya mengenal path manifest, tidak binary. customer includePlugins sudah mengecualikan printer, sehingga ini guard regresi terhadap kebocoran dependency, bukan bukti permission customer aktif bocor. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Manifest output aktual tidak dibangun atau diperiksa pada audit ini. | 2 | S | Rendah | Sedang; perlu review compatibility pemanggil. | Manifest output aktual tidak dibangun atau diperiksa pada audit ini. | Nice-to-have |
| AUT-021 | AUT | Dependency mobile terpisah dari npm workspace vulnerability gate | [INFERRED] mobile sengaja di luar root workspaces; workflow menginstal dependency mobile sendiri. Gate audit root menjalankan npm audit di cwd root, sehingga lock mobile tidak termasuk. Belum ditemukan step audit mobile dalam scope workflow yang dipindai (SEARCH-FE-04). Tidak menyatakan ada CVE aktual. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Perlu reuse policy allowlist dan jadwal audit mobile; audit ini tidak mengakses registry. | 2 | M | Rendah | Sedang; perlu review compatibility pemanggil. | Perlu reuse policy allowlist dan jadwal audit mobile; audit ini tidak mengakses registry. | Nice-to-have |
| BI-004 | BI | Dokumen status PPN perlu diselaraskan dengan fitur tarif0 | [INFERRED] Keberadaan field tidak membuktikan pengenaan PPN/konflik keputusan; default nonaktif sesuai keputusan lama. Konflik aktual adalah teks dokumen dan status keputusan terbaru. | Rekonsiliasi dokumen dan minta konfirmasi pemilik/akuntan tentang kebijakan sebelum aktivasi; jangan ubah nominal transaksi. | 2 | S | Rendah | Rendah | Pemilik dan akuntan untuk status legal/bisnis; bukan blok audit. | Nice-to-have |
| BI-005 | BI | Kumpulan komentar historis usang perlu adjudikasi per baris | [INFERRED] Delapan subklaim awal tidak seluruhnya dibaca ulang; jangan memperlakukan bundle sebagai satu temuan prioritas tinggi. Konflik keputusan substansial dicatat konteks, sisanya editorial. | Perbarui komentar setelah owner memvalidasi state yang dimaksud; jangan menghapus sejarah keputusan. | 2 | S | Rendah | Rendah | Owner dokumen terkait. | Nice-to-have |
| BI-006 | BI | readAllPages ceiling tidak ketat pada short final page | [INFERRED] rows.length < pageSize mengembalikan sebelum ceiling. Namun pemanggil report yang diperiksa memakai max kelipatan pageSize; eksposur production overflow pada konfigurasi tersebut belum terbukti. Ini kontrak helper dan memori yang perlu diperbaiki, bukan laporan aktual salah. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Tinjau seluruh konfigurasi caller; jangan mengklaim saat ini unbounded. | 2 | S | Rendah | Sedang; perlu review compatibility pemanggil. | Tinjau seluruh konfigurasi caller; jangan mengklaim saat ini unbounded. | Nice-to-have |
| BI-007 | BI | Netralisasi CSV mengubah angka negatif menjadi teks | [INFERRED] escapeCell mengonversi semua tipe ke string lalu menambah apostrof untuk minus. Kontrak helper terbukti, tetapi ekspor cashbook memakai kolom Masuk/Keluar positif sehingga dampak negatif aktif belum terbukti dalam call site yang diperiksa. | Bedakan nilai number dari teks sebelum netralisasi formula; pertahankan perlindungan teks berbahaya. Jangan mengubah semua ekspor menjadi numeric coercion. | 2 | S | Rendah | Sedang; perlu review compatibility pemanggil. | Korelasikan AAS-07; satu akar helper berbeda, hindari hitungan ganda dampak BI. | Nice-to-have |
| FLW-014 | FLW | Kursor invalid diam-diam memakai nomor halaman | [INFERRED] pageArgs mengabaikan cursor yang tidak dapat didecode. Ini kebijakan fallback terdokumentasi untuk menghindari Prisma P2025, tetapi mengaburkan error input dan bisa mengulang halaman dalam infinite-scroll. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Kontrak backward compatibility browser/APK; perlu keputusan API sebelum mengganti fallback. | 2 | M | Rendah | Sedang; perlu review compatibility pemanggil. | Kontrak backward compatibility browser/APK; perlu keputusan API sebelum mengganti fallback. | Nice-to-have |
| FLW-023 | FLW | needsPayment hanya mengecualikan CANCELLED | [INFERRED] VOIDED/COMPLETED dengan payment REFUNDED/FAILED diperlakukan membutuhkan pembayaran baru oleh helper. Ini bug affordance UI bersyarat; tidak membuktikan charge server berhasil pada status terminal. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. PO menentukan apakah terminal unpaid historis boleh dibayar. Verifikasi domain payment sebelum mengubah helper. | 2 | S | Rendah | Sedang; perlu review compatibility pemanggil. | PO menentukan apakah terminal unpaid historis boleh dibayar. Verifikasi domain payment sebelum mengubah helper. | Nice-to-have |
| FTR-008 | FTR | HTTP exception code generik untuk 409/422/503 | [INFERRED] Pemetaan HttpException hanya memberi code khusus lima status; konflik dan unprocessable menerima HTTP_ERROR. Status HTTP tetap benar dan DomainError tetap punya machine code. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Audit caller yang bergantung HTTP_ERROR sebelum kontrak diperluas. | 2 | S | Rendah | Sedang; perlu review compatibility pemanggil. | Audit caller yang bergantung HTTP_ERROR sebelum kontrak diperluas. | Nice-to-have |
| FTR-011 | FTR | Gate editor earning rule belum mengikuti capability server | [INFERRED] UI memakai dua nama role langsung, sedangkan controller memakai Can(earningRules). Kondisi default sama; divergensi terjadi saat capability diubah. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Konfirmasi keputusan desain 6b terhadap kebijakan override; jangan membuka gate hanya karena role staf. | 2 | S | Rendah | Sedang; perlu review compatibility pemanggil. | Konfirmasi keputusan desain 6b terhadap kebijakan override; jangan membuka gate hanya karena role staf. | Nice-to-have |
| AUT-024 | AUT | Upload PoD diulang pada tiap retry complete | [INFERRED] run(pod) meng-upload photo/signature sebelum complete pada setiap eksekusi. URL tidak disimpan pada QueuedJob. Jika complete gagal sesudah upload, percobaan berikut meng-upload lagi. | Persist key/URL upload yang sukses pada job sehingga retry complete memakai objek yang sama; hapus orphan hanya dengan bukti kepemilikan. | 1 | M | Rendah | Sedang; perlu review compatibility pemanggil. | Kontrak URL/signing/storage ownership delivery-service. | Nice-to-have |
| AUT-025 | AUT | Revalidasi profil memicu refresh data turunan | [INFERRED] Objek session baru memang ditulis pada fokus, tetapi manfaat performa belum diukur. Klaim familyId hilang dari indikator perangkat tidak tepat: familyId disimpan terpisah di session-device dan hanya dihapus saat signOut. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Tidak ada runtime profiling dalam audit ini. | 1 | S | Rendah | Sedang; perlu review compatibility pemanggil. | Tidak ada runtime profiling dalam audit ini. | Nice-to-have |
| AUT-026 | AUT | File transfer belum memakai telemetry dan retry rate-limit JSON | [INFERRED] uploadFile/getBlob/postBlob membangun authHeader sendiri, tanpa appHeaders dan pemrosesan x-hm-depot-changed yang ada pada rawRequest. Ini perbedaan observability/recovery, bukan hilangnya auth: ketiganya menunggu waitForSession dan menangani 401. | Satukan header telemetry dan kebijakan rate-limit untuk upload/blob bila kontraknya aman; retry mutasi upload wajib mempertimbangkan dedup. | 1 | M | Rendah | Sedang; perlu review compatibility pemanggil. | Jangan menerapkan replay upload otomatis tanpa kajian objek duplikat WEB-05. | Nice-to-have |
| FLW-015 | FLW | Callback geolocation native hanya satu slot pending | [INFERRED] Prompt geolokasi kedua menimpa pendingOrigin/pending sebelum answer. Ini skenario konkuren kondisional; tidak menyatakan kejadian perangkat aktual. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Verifikasi native/device terisolasi, tidak dijalankan. | 1 | S | Rendah | Sedang; perlu review compatibility pemanggil. | Verifikasi native/device terisolasi, tidak dijalankan. | Nice-to-have |
| FLW-022 | FLW | Kegagalan delete IndexedDB disembunyikan dari UI | [INFERRED] discard menangkap kegagalan delete lalu menghapus cache. Replay setelah reload mungkin, tetapi tidak cukup untuk menyimpulkan uang terdebit ganda karena server memiliki dedup/status guards. Hardening UX, bukan temuan integritas uang tersendiri. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Gabungkan dengan WEB-03 bila menyusun perbaikan lifecycle queue. | 1 | S | Rendah | Sedang; perlu review compatibility pemanggil. | Gabungkan dengan WEB-03 bila menyusun perbaikan lifecycle queue. | Nice-to-have |
| FTR-007 | FTR | Override depot adjustMaxPoints tidak dibaca pada adjustment | [INFERRED] [VERIFIED] adjust memanggil config.adjustMaxPoints(null); config menerima depotId dan mendukung override. HQ-only penulisan key tetap kontrol yang benar, jangan dicabut. | Putuskan apakah cap memang global; jika per-depot, resolve depot yang sah untuk customer dan baca override; jika global, hapus janji konfigurasi depot. | 1 | S | Rendah | Sedang | Definisi depot penanggung jawab adjustment | Nice-to-have |
| FTR-009 | FTR | FileProvider path luas bersifat hardening kondisional | [INFERRED] Template path titik saja tidak membuktikan eksfiltrasi karena provider exported=false dan akses URI memerlukan grant. Perlu caller sharing path untuk menentukan risiko nyata. | Persempit path FileProvider hanya setelah memetakan URI yang benar-benar dibagi; jangan merusak export/share yang sah. | 1 | M | Rendah | Sedang; perlu review compatibility pemanggil. | Belum ditelusuri semua caller native share/plugin. | Nice-to-have |
| FTR-012 | FTR | Sebagian teks utilitas belum memakai resolver locale | [INFERRED] STALE_DEPOT_MESSAGE dan fallback gagal kirim berupa literal Indonesia. Dampak lokalisasi terbatas; tidak menghambat fungsi. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Gabungkan dengan maintenance locale, tidak mendahului integritas transaksi. | 1 | S | Rendah | Sedang; perlu review compatibility pemanggil. | Gabungkan dengan maintenance locale, tidak mendahului integritas transaksi. | Nice-to-have |
| BI-001 | BI | Definisikan jam SLA tiap percobaan pengantaran ulang | [INFERRED] Reassign mereset pickup/start/ETA tetapi assignedAt dan slaAlertedAt tetap; earning menghitung selisih deliveredAt-assignedAt. Kode terbukti; definisi SLA order vs percobaan perlu PO. | PO memilih SLA order utuh atau per-attempt. Jika per-attempt, simpan attempt dan jamnya tanpa merusak jejak percobaan lama. | 4 | M | Sedang | Sedang | Keputusan PO/operasional tentang denominator SLA dan bonus. | Jangan dikerjakan dulu |
| BI-002 | BI | Definisi bruto pajak variabel perlu konfirmasi akuntan | [INFERRED] Source memverifikasi gross=BASE+ALLOWANCE, terpisah dari totalBonus; PPh Desember memakai YTD gross yang sama. Ini tidak membuktikan pelanggaran pajak, dan dasar BPJS tidak boleh otomatis disamakan dengan dasar PPh. | Akuntan memutuskan komponen penghasilan/pemotongan per basis dan proses di luar aplikasi; setelah itu selaraskan input serta ekspor rekonsiliasi. | 4 | M | Tinggi | Sedang | Jawaban akuntan; perbedaan basis PPh/BPJS; bukan audit hukum | Jangan dikerjakan dulu |
| FLW-017 | FLW | Bedakan persetujuan refund manual dari uang benar-benar diserahkan | [INFERRED] executeRefund memindahkan REFUNDED; transfer gateway hanya untuk EWALLET/VA dengan reference. CASH/TRANSFER/QRIS tidak memanggil bank. Ini membuktikan pencatatan status, bukan bahwa pelanggan sudah menerima dana. | Finance menetapkan SOP/kanal dan definisi REFUNDED. Tambah tahap approved-awaiting-disbursement atau evidence money-out, tanpa mengubah histori menjadi klaim settlement palsu. | 4 | L | Tinggi | Tinggi | Keputusan Finance: siapa membayar dan bukti apa yang wajib; tanpa itu jangan mengotomasi uang keluar. | Jangan dikerjakan dulu |
| FLW-018 | FLW | Tetapkan alokasi reversal franchise untuk refund setelah order selesai | [INFERRED] recordRefund hanya menulis refundedAmount dan mengirim notifikasi; jalur ini tidak membalik franchise ledger. Refund terhadap penjualan selesai dan aturan pembebanan biaya perlu dikonfirmasi. | Finance menentukan pihak penanggung dan apakah clawback owner/komisi berlaku; kemudian intent reversal idempoten, bukan reuse pembatalan penuh untuk refund parsial. | 4 | L | Tinggi | Tinggi | SOP refund dan model franchise direct-to-depot; keputusan Finance. | Jangan dikerjakan dulu |
| FTR-005 | FTR | Anonimisasi employee menyisakan field identitas lain | [INFERRED] [VERIFIED] Patch anonimisasi hanya menimpa nama/telepon/email/photo/authSubjectId (jalur account juga role/status), sedangkan sumber schema memiliki pengenal lain. Penghapusan seluruh field finansial tidak boleh disarankan otomatis tanpa kebijakan retensi. | Tentukan matriks retensi per field/tujuan dan bedakan pseudonimisasi dari anonimisasi; batasi akses data yang wajib disimpan, hapus yang tidak lagi perlu setelah keputusan sah. | 4 | L | Tinggi | Sedang | Legal/finance retention field matrix + HR | Jangan dikerjakan dulu |
| AUT-003 | AUT | Tentukan retensi dataset lokal admin sebelum membuat purge | [INFERRED] Registry executor yang dibaca berisi dataset remote, bukan export_logs/webhook/tickets/fraud. Pencarian absence harus dibatasi source/registry yang diaudit; belum membuktikan konfigurasi retensi produksi. | Inventaris dan klasifikasi data lokal admin; putuskan window/hold lalu tambahkan executor. Jangan menghapus catatan sengketa/keuangan dengan cutoff arbitrer. | 3 | M | Sedang | Tinggi | Legal/Finance/Security menetapkan klasifikasi/window; baseline data aktual belum diperiksa. | Jangan dikerjakan dulu |
| AUT-008 | AUT | Penyesuaian stok mentah dan opname perlu kebijakan kontrol kuantitas | [INFERRED] Temuan lama menyebut dampak 3-4. Tidak dipromosikan sebagai temuan kuat pada resume ini: source adjust/opname/approval belum dibaca ulang lengkap; tidak boleh menganggap approval pasca-fakta salah tanpa keputusan proses. | Pertahankan kandidat legacy dengan label belum diverifikasi ulang dan pertanyaan PO tentang approval sebelum/sesudah fakta. | 3 | M | Sedang | Sedang | Operasi stok + finance | Jangan dikerjakan dulu |
| FLW-012 | FLW | Kebijakan voucher online batal belum dipulihkan pada jalur cancel yang dibaca | [INFERRED] [INFERRED] Jalur cancel tidak memanggil release yang sudah tersedia; apakah voucher harus kembali adalah keputusan bisnis. Bukan Quick Win siap implementasi tanpa keputusan tersebut. | PO menentukan hangus/kembali dan alasan cancellation yang berlaku; bila kembali, gunakan delivery yang dapat dipulihkan, bukan fail-open yang dapat hilang permanen. | 3 | M | Sedang | Sedang | PO kebijakan cancellation + order/promo; gabungan ORD-02 | Jangan dikerjakan dulu |
| FLW-025 | FLW | Tidak adanya Idempotency-Key bukan bukti semua POST tidak idempoten | [INFERRED] Ditemukan empat header call site dan satu body idempotencyKey, tetapi status/CAS/unique constraints server dapat menyediakan semantik replay tanpa header. Timeout 15 detik menghasilkan hasil tidak pasti, bukan bukti duplikasi. Pecah hanya setelah service owner membuktikan satu operasi non-idempoten. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Gabungkan APP-05; APP-02 delta stok diserahkan ke depot owner. | 3 | L | Sedang | Sedang; perlu review compatibility pemanggil. | Gabungkan APP-05; APP-02 delta stok diserahkan ke depot owner. | Jangan dikerjakan dulu |
| FTR-004 | FTR | Lembur dihitung dari menit kehadiran tanpa approval lembur terpisah pada jalur yang dibaca | [INFERRED] [INFERRED] splitOvertime tidak menerapkan plafon; payroll menambahkan BONUS. Ini bukan auto-paid: slip masih melalui approve/pay dan guard pemisahan pembuat/penyetuju. | HR menentukan kebutuhan approval/exception atas jam tidak wajar dan plafon bila sah; tampilkan sumber menit agar approver menilai. Jangan menebak batas jam hukum. | 3 | M | Sedang | Sedang | HR lead dan kebijakan jam/approval | Jangan dikerjakan dulu |
| FTR-006 | FTR | Scrub subscription menyisakan alamat dan koordinat | [INFERRED] [VERIFIED] erasePerson membatalkan ACTIVE/PAUSED dan mengosongkan recipientName/phone/notes, tidak menyentuh alamat. Kebutuhan menghapus alamat harus dipetakan pada retensi yang disepakati. | Masukkan snapshot alamat/koordinat pada matriks retensi per field dan dokumentasikan status pseudonimisasi/anonymisasi. | 3 | M | Sedang | Sedang | Keputusan retensi PDP per field | Jangan dikerjakan dulu |
| AUT-005 | AUT | Input placeholder perlu telaah label persisten dan AT | [INFERRED] Source tanpa aria-label/id-label tidak otomatis membuktikan accessible name kosong: placeholder bisa menjadi fallback accessible name. Reframe sebagai dugaan label tidak persisten; uji DOM/AT diperlukan sebelum klaim pelanggaran. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Tidak menjalankan browser/axe dalam audit statis ini. | 2 | S | Rendah | Sedang; perlu review compatibility pemanggil. | Tidak menjalankan browser/axe dalam audit statis ini. | Jangan dikerjakan dulu |
| AUT-006 | AUT | Gate dashboard per halaman merupakan perlindungan regresi | [INFERRED] Dashboard layout menjamin auth tetapi tidak membatasi semua capability. Halaman insight mendelegasikan gate ke InsightDashboard. Tidak ada halaman bocor data yang dibuktikan; usulan penjaga regresi lebih tepat daripada menambah gate role kasar yang dapat memblokir custom role sah. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Metode static guard harus mengerti komponen yang mendelegasikan gate. | 2 | S | Rendah | Sedang; perlu review compatibility pemanggil. | Metode static guard harus mengerti komponen yang mendelegasikan gate. | Jangan dikerjakan dulu |
| AUT-013 | AUT | Baseline Load gagal dipush tetapi run tetap sukses | [INFERRED] DROP klaim tidak pernah mendarat/karena branch protection: tidak ada provenance runtime. KEEP pilihan warning yang memang sengaja dinyatakan source, sebagai tradeoff bukan bug pasti. | Jika pemilik membutuhkan histori committed, gunakan artifact/PR baseline dengan indikator freshness; jangan mengubah run sehat merah tanpa kebutuhan itu. | 2 | S | Rendah | Rendah | Keputusan kebutuhan histori dan akses repo Actions saat implementasi. | Jangan dikerjakan dulu |
| FTR-001 | FTR | Perjelas semantik BETA/ROLLOUT pada flag publik | [INFERRED] publicFlags memetakan semua state kecuali OFF menjadi enabled; enum menjelaskan BETA/ROLLOUT. Belum diketahui apakah owner memerlukan audience gating, jadi tidak menyebut bug rollout produksi. | PO memilih boolean-only untuk key enforced atau kontrak audience yang eksplisit; jangan membangun eksperimen/AI tanpa demand. | 2 | M | Rendah | Sedang | Keputusan Produk atas lifecycle; konfigurasi produksi tidak dibaca. | Jangan dikerjakan dulu |
| FTR-010 | FTR | Recommendation service memakai ProductRef lokal tanpa status aktif/depot | [INFERRED] Service sepenuhnya dibaca: enrich hanya membuang productRef yang hilang. Dampak end-to-end belum dapat dipastikan sebelum frontend consumer/hydration ditelusuri; bukan bukti produk tidak tersedia tampil pada pelanggan. | Periksa consumer web sebelum keputusan; jika consumer sudah memfilter katalog aktif, tutup klaim tampilan invalid dan nilai hanya kesegaran ProductRef. | 2 | M | Rendah | Sedang | Frontend consumer verification | Jangan dikerjakan dulu |
| FLW-024 | FLW | Sinkronisasi sesi lintas tab belum diperiksa memadai | [INFERRED] Klaim ketiadaan storage/BroadcastChannel berasal pencarian awal; audit resume tidak menelusuri seluruh mekanisme browser/cookie/tab. Jangan mempromosikan tanpa SEARCH lintas file dan skenario konkret. | Usulan dibatasi acceptance berikut; scope implementasi rinci belum diputuskan. Perlu full search lintas session-store/depot-store/app lifecycle. | 1 | M | Rendah | Sedang; perlu review compatibility pemanggil. | Perlu full search lintas session-store/depot-store/app lifecycle. | Jangan dikerjakan dulu |




### Fase 1 — tutup gap yang siap dan selaraskan kebijakan

Entry: baseline source tetap dan scope patch disetujui pada tugas implementasi terpisah. Prioritas FLW-020 (WEB-01), FLW-005 (DLV-01), FLW-016 (PPA-01), AUT-007 (AUT-01), AUT-012 (HR-21), FLW-002 (CRM-01); FTR-003 (CUS-01) dan FLW-006 (DLV-03) dapat berjalan sebagai patch kecil dengan dampak 3 (bukan dipaksakan menjadi Quick Win).

Exit: acceptance masing-masing terpenuhi pada unit/contract dan race nyata bila menyentuh state, receiver migration diverifikasi sebelum sender, regresi RBAC/native diuji. Dampak produksi belum dianggap terbukti hanya dari tes lokal.

### Fase 2 — pemulihan lintas service dan ledger

Entry: kontrak idempotensi penerima disahkan, aturan uang/retensi yang relevan diputuskan. FLW-019 (REF-01) mendahului penguatan retry FLW-010 (ORD-01); FLW-003 (DEP-01)/FLW-004 (DEP-02) menutup identitas movement dan receipt; FLW-008 (DLV-07) menutup recovery PoD; AUT-022 (PPA-02) menambah bukti settlement. FLW-017 (PPA-03)/FLW-018 (PPA-05) dan FLW-007 (DLV-05) menunggu SOP/alokasi Finance/Ops. AUT-015 (IDO-04) menunggu custody kunci dan format restore.

Exit: crash/replay tidak menghilangkan atau menggandakan efek bisnis dalam skenario yang diuji; backlog rekonsiliasi terukur dan manual override diaudit. Jangan backfill transaksi lama tanpa rencana rekonsiliasi.

### Fase 3 — kualitas KPI dan optimasi

Entry: histori dan reconciliation dari fase 2 tersedia. Validasi katalog KPI, SLA attempt BI-001 (DLV-02), report quality AUT-011 (FCS-04), definisi bruto BI-002 (HR-04) bersama akuntan, lalu dashboard sesuai role. Tidak menambah stack BI atau AI otomatis tanpa kebutuhan. Royalti, subrole franchise, dan rollout audience tetap mengikuti keputusan/demand.

Exit: formula/status/window/join disahkan, angka dapat ditelusuri ke sumber dan completeness unknown tidak tampil sebagai nol. Owner metrik menerima hasil; threshold disepakati, bukan dibuat auditor.


## 9. Asumsi, Konflik dan Pertanyaan PO

| Topik | Keputusan yang diperlukan |
| --- | --- |
| Refund manual | Siapa mengembalikan uang, kanal/bukti, serta arti REFUNDED? |
| Franchise refund | Siapa menanggung refund setelah COMPLETED, bagaimana ledger/clawback jika sudah withdraw? |
| SLA dan COD | SLA dihitung per order atau per attempt, dan shift mana menanggung kas di celah auto-close? |
| HR dan retensi | Komponen bruto disahkan akuntan; klasifikasi NIK/rekening/alamat dan legal hold ditentukan pemilik data. Tidak menyimpulkan hukum dari kode. |
| Voucher MANAGER | Jaringan memang keputusan accepted; pembatasan depot akan bertentangan DEC-16, bukan patch otomatis. |
| Royalti/deposit | Royalti di luar go-live; deposit belum ditagih. Tetapkan dasar/tarif/alur sebelum otomatisasi. |
| Penerima laporan | Siapa boleh mengirim dataset apa ke domain mana? |
| Backup | Jaminan SSE provider dan custody kunci aktual belum diketahui. |



## 10. Lampiran dan Status Gate

| Artefak | Isi |
| --- | --- |
| [00-context.md](00-context.md) | Keputusan/role/precedence |
| [01-file-ledger.md](01-file-ledger.md) | Ledger seluruh manifest; JSON dan CSV tersedia |
| [02-inventory.md](02-inventory.md) | Unit hitungan dan batas extractor |
| [03-cross-service-flows.md](03-cross-service-flows.md) | State, handoff dan recovery |
| [04-search-log.md](04-search-log.md) | Pencarian dan batas klaim negatif |
| [05-verification.md](05-verification.md) | Gate, baseline dan batas cakupan |
| [05-spot-check.json](05-spot-check.json) | Populasi/seed/15 hasil |
| [06-duplicate-check.md](06-duplicate-check.md) | Keep/reclassify/merge/drop |
| [recommendations.json](recommendations.json) | Backlog dan evidence terstruktur |
| [05-artifact-verification.json](05-artifact-verification.json) | Kesetaraan Markdown/HTML dan visual |


# Verifikasi audit — PARTIAL

| Gate | Hasil |
| --- | --- |
| Manifest vs ledger | PASS |
| Coverage penuh | FAIL: 2712 UNREAD, 1 BLOCKED |
| Baseline HEAD/fingerprint | PASS |
| Referensi rekomendasi: path/baris | PASS |
| Sampel reproduksibel | 15 kandidat, populasi/seed/algoritme di 05-spot-check.json |
| Runtime test/build/lint/DB | NOT RUN — di luar otorisasi audit statis |
| Mermaid SVG | NOT RENDERED — renderer lokal tidak tersedia |
| HTML semantic/visual | Lihat 05-artifact-verification.json dan 05-browser-check.json; Mermaid tetap belum dirender |


## Batas penting

READ warisan tidak sama dengan verifikasi ulang primary. Banyak file hanya scan struktur atau judul tes; ledger mempertahankannya UNREAD. Unit test yang ada tidak disebut lulus. Endpoint/model/page dihitung programatik, dengan unit dan batas pada inventaris. Tidak ada deklarasi production-ready atau kepatuhan hukum.

Tiga agent resume mencapai usage limit setelah menyimpan sebagian artefak. Primary memulihkan hasil tersimpan, memeriksa bukti prioritas dan menyatukan laporan; tidak menyatakan seluruh cakupan agen tuntas.

| Kandidat sampel | Keputusan | Hasil pembacaan source | Batas |
| --- | --- | --- | --- |
| PLP-10 | keep | source supports scoped claim | Effect on configured depot override was inferred; no settings or runtime data read. |
| IDO-09 | keep | source supports limited monitoring gap | Absence of an external alert pipeline cannot be proved from this repo. |
| WEB-10 | keep | source supports client path difference | No upload failure or 429 behavior executed. |
| ORD-01 | keep | source supports failure path | Receiver behavior and production incidence were not measured. |
| AAS-10 | defer-policy | source supports mapping | Whether BETA or ROLLOUT should gate audience is a product decision. |
| WEB-07 | reclassify | source supports helper behavior | A live negative-number export through the inspected cashbook caller was not shown. |
| FCS-04 | reclassify | source supports indistinguishable EOF | Read-model impact depends on failed feed and later recovery; no run executed. |
| DEP-06 | reclassify | source supports identifier trust within depot scope | DepotScopeGuard restricts STAFF_DEPOT; cross-depot return was not established. |
| WEB-01 | keep | source supports native logout race | Native timing and retained-token duration were not tested on device. |
| ORD-13 | defer-policy | source supports field-level scrub limit | Retention policy for address snapshots requires owner decision. |
| PLT-10 | reclassify | source supports broad path with URI grant | No unauthorized URI grant or data exposure was established. |
| WEB-05 | keep | source supports repeat upload path | Whether orphan objects persist depends on storage lifecycle; no failure injected. |
| APP-02 | keep | source supports duplicate delta on retry | No production duplicate was measured; client compatibility must be planned. |
| DEP-02 | keep | source supports non-atomic receipt sequence | Concurrent/crash reproduction was not run; partial receipt semantics must be preserved. |
| REC-03 | reclassify | source supports enrichment-only filter | Frontend consumer and resulting customer display were not traced. |



## 11. Kandidat historis yang belum seluruhnya disahkan

Bagian ini mempertahankan seluruh isi laporan per wilayah Claude agar konteks tidak hilang. **Ini bahan audit lama, bukan tambahan rekomendasi terverifikasi.** `LEGACY-CLAIM` menggantikan tag VERIFIED lama; perubahan/koreksi pada bagian 4–8 dan duplicate-check mengalahkan klaim historis. Hitungan cakupan di blok lama tidak berlaku; gunakan ledger pusat. Kandidat tanpa adjudikasi tetap terbuka dan tidak boleh langsung diimplementasikan.


### Arsip wilayah apps-web-app

Provenance: `agents/apps-web-app/findings.md`.

#### Temuan apps/web/src/app (owner: apps-web-app)
Metode: STRUCTURED-SCAN (scan.py/scan2.py/scan3.py di folder ini) + baca excerpt. Tingkat: STATIC. Tidak ada RUNTIME.

#### APP-01 [AUT] Tes penjaga panggilan tanpa-auth buta terhadap mutasi products.*
- Masalah: PUBLIC_PREFIXES memuat 'endpoints.products.' utuh [LEGACY-CLAIM apps/web/test/unauthenticated-calls.test.ts:44]. Namespace itu juga berisi rute staf: create, import, update, remove, uploadImage, categoryCreate, browseAll [LEGACY-CLAIM apps/web/src/lib/endpoints/shop.ts:~40-62]. api.post(endpoints.products.create, body) tanpa true lolos tes, lalu di shell native (tanpa cookie) gagal "Missing bearer token" - kelas bug yang tes ini dibuat untuk mencegah (komentar test:5-11).
- Kondisi saat ini: semua panggilan products.* tanpa auth hanyalah browse/get/batch/categories [LEGACY-CLAIM scan.json]; mutasi memakai true (mis. hq/catalog/page.tsx:329). Gap = proteksi regresi, bukan bug aktif.
- Kontrol ada: tes allowlist itu sendiri.
- Usulan minimum: ganti prefix luas dengan entri eksplisit (browse(, get(, batch(, categories).
- Dampak 2 | Effort S | Risiko rendah | Dependensi: -
- Acceptance: panggilan mutasi products.* tanpa auth membuat tes gagal. Verifikasi: fixture negatif sementara. Owner: FE lead. Bila ditunda: regresi baru terlihat di perangkat native.

#### APP-02 [FTR] Penyesuaian stok (adjust) tanpa dedup di FE maupun server
- Masalah: api.post(endpoints.inventory.adjust(id), {delta, reason}, true) tanpa Idempotency-Key [LEGACY-CLAIM apps/web/src/app/dashboard/inventory/page.tsx:171-172]. Server: controller tidak membaca header itu [LEGACY-CLAIM services/depot-service/src/modules/inventory.controller.ts:363-377] dan service memakai quantity terbaca + delta lalu applyMovement tanpa kunci/cek duplikat [LEGACY-CLAIM services/depot-service/src/application/services/inventory.service.ts:335-356]. Ketuk ulang / retry setelah jawaban hilang = delta teraplikasi dua kali (bukan sekadar disetel ke nilai yang sama).
- Koreksi atas laporan awal: klaim "opname berkunci" SALAH (flag IDEM scan = artefak koma-akhir). Opname tidak berkunci tetapi aman ulang karena ditulis sebagai selisih terhadap hitungan (komentar inventory.service.ts:370-375, CA-2-21) [INFERRED].
- Kontrol ada: setBusy menonaktifkan tombol selama request; guard negatif (NegativeStockError, baris 345).
- Usulan minimum: Idempotency-Key per upaya di FE (pola attemptKey walk-in/page.tsx:742-768) + dedup di depot-service.
- Dampak 3 | Effort M | Risiko rendah | Dependensi: depot-service
- Acceptance: dua POST berkunci sama = satu movement. Verifikasi: tes integrasi kirim ganda. Owner: backend depot + FE ops. Bila ditunda: selisih stok setelah jaringan buruk.

#### APP-03 [AUT] ~14 input hanya ber-placeholder (tanpa nama aksesibel)
- Bukti [LEGACY-CLAIM scan3.py + spot-check dibaca]: hq/tickets/page.tsx:311-316,353; dashboard/returns/page.tsx:138,248; dashboard/purchase-orders/page.tsx:280,286; dashboard/inventory/page.tsx:306,728 (hitungan opname per item); dashboard/search/page.tsx:148; hq/customers/page.tsx:124; hq/forms/commission/page.tsx:119; hq/forms/segment/page.tsx:162; hq/hierarchy/page.tsx:143; hq/incidents/page.tsx:181; resellers/reseller-row.tsx:99. Komponen Input tidak menambah label [LEGACY-CLAIM apps/web/src/components/ui.tsx:174-186].
- Kontrol ada: sebagian besar form memakai Field/aria-label; row-click tabel HQ punya Link keyboard (hq/orders/page.tsx:150-166, hq/page.tsx:250-262); tidak ada img tanpa alt (scan).
- Usulan: aria-label dari placeholder/kolom. Dampak 2 | Effort S
- Acceptance: tiap input punya nama aksesibel. Verifikasi: axe pada halaman tsb / perluas test/console-a11y.test.tsx. Owner: FE. Bila ditunda: pembaca layar kesulitan, input opname paling rawan.
- Batas: placeholder diterima sebagai nama oleh sebagian browser; tidak diuji dengan AT.

#### APP-04 [AUT] Gerbang peran /dashboard/* hanya konvensi per halaman
- Layout dashboard hanya RequireAuth [LEGACY-CLAIM apps/web/src/app/dashboard/layout.tsx:41-51]; komentar mengakui "Nothing above this page gates a /dashboard route" [LEGACY-CLAIM dashboard/insight/page.tsx:4-6]. Scan: 72/74 halaman memanggil can*()/is*(); /dashboard memakai dashboardLandingView (page.tsx:386-407); /dashboard/insight mendelegasi ke InsightDashboard [INFERRED, gate sendiri per komentar]. Saat ini tidak ada halaman terbuka; halaman baru tanpa gate terbuka bagi CUSTOMER yang login (API tetap menolak; dampak = layar rusak).
- Tes pemindai gerbang dashboard belum ditemukan dalam cakupan apps/web/test (SEARCH-apps-web-app-04). HQ sudah punya gerbang di layout (hq/layout.tsx:34-76).
- Usulan: gerbang kasar di layout atau tes pemindai. Dampak 2 | Effort S-M | Owner FE | Verifikasi: tes memindai page.tsx.

#### APP-05 DITUTUP sebagai temuan generik; sisa dipecah ke APP-02/06/07
Koreksi metode: klaim awal "berkunci" memakai heuristik jumlah argumen dan salah. Header Idempotency-Key di FE hanya dikirim di 4 file [LEGACY-CLAIM grep apps/web/src/app: checkout/page.tsx:767-ish, dashboard/walk-in/page.tsx:767, dashboard/payout/page.tsx, driver/earnings/page.tsx:63-65]. Server hanya membacanya di order-service dan payout-service (courier-payout.controller.ts:103-105, payout.controller.ts) [LEGACY-CLAIM grep services]. Jadi dedup lain harus berasal dari state/unique. Diperiksa sisi server:
- payout.release: dedup. request() membuat record; create mengembalikan null bila sudah ada pending -> ReleaseAlreadyRequestedError [LEGACY-CLAIM payout-service/src/application/services/hq-release.service.ts:52-58]. TUTUP.
- voidWalkIn: update bersyarat status COMPLETED -> VOIDED, selain itu OrderAlreadyVoidedError [LEGACY-CLAIM order-service/src/infrastructure/prisma/order.prisma.repository.ts:1101-1113]. TUTUP.
- receiveTransfer: hanya dari status SENT (TransferNotPendingError) [LEGACY-CLAIM depot-service transfer service ~baris 115]. TUTUP.
- referrals.redeem: AlreadyReferredError [LEGACY-CLAIM referral-service/src/application/services/referral.service.ts:181-182]. TUTUP.
- generatePayroll: ditolak bila sudah bukan DRAFT; DRAFT dibangkitkan ulang (by design) [LEGACY-CLAIM hr-service/src/application/services/payroll.service.ts:172-175]. TUTUP.
- settlements verify/approve/reject/dispute: guard status/aktor [LEGACY-CLAIM delivery-service/src/application/services/settlement.service.ts:264,320,328,378]. TUTUP.
- markRedemptionUsed: idempoten [LEGACY-CLAIM loyalty-service reward.service.ts:179]. TUTUP.
- payments.initiate: PaymentAlreadyExistsError [LEGACY-CLAIM payment-service/src/application/services/payment.service.ts:250]. TUTUP.
- cashbook.reverse: CashbookAlreadyReversedError [LEGACY-CLAIM depot-service cashbook.service.ts:95]. TUTUP.
- Tidak berdedup -> APP-02 (stock adjust), APP-06, APP-07.

#### APP-06 [FTR/BI] Penukaran poin: kunci idempotensi dibuat baru setiap panggilan, sehingga dedup server tidak pernah memakainya
- Masalah: redeem() mengirim idempotencyKey: crypto.randomUUID() di dalam fungsi [LEGACY-CLAIM apps/web/src/app/rewards/page.tsx:270-275]. Server memang dedup per (customer, key) [LEGACY-CLAIM services/loyalty-service/src/application/services/reward.service.ts:76-81], tetapi setiap upaya (termasuk retry setelah jawaban hilang/timeout, lalu pelanggan menekan Tukar lagi) membawa kunci berbeda, jadi poin dipotong dan penukaran dibuat dua kali. Bandingkan pola benar di checkout/walk-in (attemptKey ref, dikosongkan hanya setelah sukses).
- Kontrol ada: setPending(item.id) memblokir ketuk ganda selama request berjalan; cek stok dan saldo di server (RewardOutOfStockError, InsufficientPointsError).
- Usulan minimum: simpan satu kunci per (item, depot) di ref sampai sukses; reset sesudahnya.
- Dampak 3 | Effort S | Risiko rendah | Dependensi: -
- Acceptance: dua panggilan redeem beruntun setelah error jaringan memakai kunci sama dan menghasilkan satu penukaran. Verifikasi: tes komponen dengan fetch gagal lalu ulang. Owner: FE customer. Bila ditunda: pelanggan kehilangan poin ganda pada jaringan buruk (sebagai aplikasi seluler, kondisi umum).

#### APP-07 [FTR] Pencatatan uang/poin manual tanpa dedup (FE dan server)
- cashbook.create: payload depotId/direction/category/label/amount tanpa kunci [LEGACY-CLAIM apps/web/src/app/dashboard/cashbook/page.tsx:93-97]; service record() langsung create dengan sourceRef null [LEGACY-CLAIM depot-service/src/application/services/cashbook.service.ts:51-65]. Kirim ulang = dua baris kas.
- loyalty.adjust (penyesuaian poin manual HQ): body {customerId, points, reason} [LEGACY-CLAIM apps/web/src/app/hq/customers/page.tsx:94-98]; service hanya guard saldo >= 0 dan batas besar [LEGACY-CLAIM loyalty-service/src/application/services/loyalty.service.ts:296-311]; DTO idempotencyKey ada hanya untuk jalur reward sistem (loyalty.controller.ts:193), bukan adjust [INFERRED].
- sendTransfer (dashboard/inventory/page.tsx:829-833) tanpa kunci; dedup server belum diperiksa [ASSUMPTION, U-01].
- Kontrol ada: busy flag pada ketiga form; cashbook punya reverse yang tercatat (jejak audit) sehingga kerusakan dapat dikoreksi; adjust poin berbatas untuk peran capped.
- Usulan minimum: kunci per upaya + kolom sourceRef/unique di cashbook; kunci opsional di adjust poin.
- Dampak 2 | Effort M | Risiko rendah. Acceptance: kirim ganda = satu entri. Verifikasi: tes integrasi. Owner: backend depot/loyalty + FE. Bila ditunda: baris ganda perlu dikoreksi manual lewat reverse.
- Catatan ringan: klaim expense kurir (driver/expenses/page.tsx:87-91) tanpa kunci; server menandai kuitansi terpakai (createCheckingReceipt) sehingga duplikat tidak otomatis disetujui [LEGACY-CLAIM payout-service expense service ~baris 68-86]; risiko rendah, tidak dijadikan temuan.

#### Kontrol yang sudah baik (bukan gap)
- Semua HTTP lewat wrapper api/uploadFile/getBlob; nol fetch mentah di app/.
- 45 panggilan tanpa auth=true seluruhnya publik sesuai allowlist tes (tidak diverifikasi vs gateway).
- Ekspor CSV: anti formula-injection + BOM [LEGACY-CLAIM lib/csv.ts:111-131]; ekspor audit HQ memakai fetchAllPages, menolak bila terpotong [LEGACY-CLAIM hq/audit/page.tsx:35-36,76-82].
- Checkout memakai Idempotency-Key per upaya (checkout/page.tsx:652-690).



### Arsip wilayah apps-web-other

Provenance: `agents/apps-web-other/findings.md`.

#### Temuan apps/web (non-src/app) - HEAD 1e93545a2
Bukti: STATIC/WIRED (trace kode). Cakupan: 47 file dibaca utuh; 627 UNREAD (ledger.json, unresolved.md).

#### WEB-01 - Logout native dan lepas-push berangkat TANPA bearer (AUT) - dampak 4, effort S
- Masalah: signOut memanggil api.post(logout, refreshToken, auth=true) lalu langsung clearTokens(). request() menjalankan await waitForSession() SEBELUM rawRequest membaca authHeader(), jadi tokens=null sebelum header dibuat (komentar kode mengklaim sebaliknya) [LEGACY-CLAIM apps/web/src/lib/api.ts:371-385,138-141; auth-context.tsx:151-193]. Gateway native memakai bearerToken(req) ke hulu; hulu auth/logout memakai SelfScoped dan CurrentUser, butuh bearer [LEGACY-CLAIM services/gateway-service/src/routing/session-bff.ts:253-277; services/auth-service/src/modules/auth/account.controller.ts:387-403]. [INFERRED] hulu 401, revoked=false, refresh token tetap valid 30 hari. Error ditelan catch kosong.
- Lepas push: nativeUnsubscribe meng-await readEndpoint() (vault async) sebelum api.del, DELETE terjadi setelah clearTokens [LEGACY-CLAIM push.ts:212-219; auth-context.tsx:167]. Registrasi FCM akun lama tertinggal.
- Kontrol ada: gateway menyapu cookie (web); flag revoked; test native-auth memeriksa bearer pada request biasa, bukan signOut [LEGACY-CLAIM test/native-auth.test.ts:150-182 via grep].
- Usulan minimum: kirim logout dan unsubscribe dengan token yang ditangkap sebelum clearTokens, atau tunggu selesai baru clear.
- Acceptance: signOut native -> logout membawa Authorization, revoked=true; DELETE push 200. Verifikasi: unit test fetch mock + token native.
- Risiko sedang. Owner: mobile/web engineer. Bila ditunda: sesi ponsel bersama hidup 30 hari; push akun lama bocor ke pengguna berikut. ASSUMPTION: apakah hulu benar menolak logout tanpa bearer?

#### WEB-02 - Gate aturan penghasilan kurir hardcode role, server pakai capability - dampak 2, effort S
- canManageEarningRules = FINANCE atau SUPER_ADMIN [LEGACY-CLAIM lib/roles.ts:153-154]; server Can(earningRules) [LEGACY-CLAIM services/payout-service/src/modules/earning-rule.controller.ts:34], default FINANCE,SUPER_ADMIN [LEGACY-CLAIM packages/access/src/index.ts:502]. Matriks/peran kustom berubah -> UI dan server berbeda. Dipakai app/dashboard/earning-rules/page.tsx:429, ops-rail.tsx:409.
- Usulan: can(earningRules, role). Acceptance: roles.test mencakup peran kustom. Bila ditunda: drift diam-diam setelah custom-roles.

#### WEB-03 - Retensi 7 hari membuang job uang (codConfirm/gallonReturn) tanpa jejak (FLW) - dampak 3, effort S
- flush memanggil discard untuk SEMUA job kadaluarsa, termasuk berisi uang dan yang sudah error [LEGACY-CLAIM offline-queue.ts:416-419,473-478]. Dokumen file: job ditolak dipertahankan sampai operator membuang. Alasan retensi (PII wajah/foto) tidak berlaku untuk codConfirm. Tidak ada notifikasi/log.
- Usulan: untuk kind tanpa payload biometrik tandai error dan tampilkan. Acceptance: test codConfirm 8 hari tetap ada dengan error.

#### WEB-04 - discard menelan kegagalan IDB, job terkirim ulang setelah reload - dampak 1-2, effort S
- [LEGACY-CLAIM offline-queue.ts:288-296]. Server replay-safe untuk confirm (payment.service.ts:601-604), gallon (alreadyRecorded), delivery (delivery.service.ts:435,567,804), punch (attendance:152) -> dampak kecil.

#### WEB-05 - Retry PoD meng-upload ulang foto tiap percobaan - dampak 1, effort S
- pod mengunggah foto+tanda tangan sebelum complete; 6 percobaan gagal = unggahan yatim [LEGACY-CLAIM offline-queue.ts:350-368]. Usulan: simpan url hasil upload pada job.

#### WEB-06 - Revalidasi /auth/me membuat objek customer baru (perf) - dampak 1, effort S
- setSession(customer) tiap fokus >=60s [LEGACY-CLAIM auth-context.tsx:78-95]; CartProvider.refresh bergantung pada customer [LEGACY-CLAIM cart-context.tsx:46-95] -> GET cart ulang. Juga membuang familyId dari Session tersimpan. [INFERRED] tanpa pengukuran.

#### WEB-07 - Penetral formula CSV merusak angka negatif (BI) - dampak 2, effort S
- escapeCell memberi apostrof pada nilai berawalan minus termasuk number [LEGACY-CLAIM lib/csv.ts escapeCell]; test hanya angka positif [LEGACY-CLAIM test/csv.test.ts:98-102]. [INFERRED] angka negatif jadi teks. Usulan: lewati netralisasi untuk tipe number. ASSUMPTION: apakah ada ekspor CSV dengan angka negatif?

#### WEB-08 - needsPayment hanya mengecualikan CANCELLED - dampak 2, effort S
- [LEGACY-CLAIM lib/payments.ts:83-87; app/orders/detail/page.tsx:356,671]. [INFERRED] order VOIDED/COMPLETED dengan payment REFUNDED memunculkan panel bayar. ASSUMPTION: apakah API menolak initiate pada status itu?

#### WEB-09 - Tidak ada sinkron lintas-tab sesi/depot (web) - dampak 1
- Belum ditemukan dalam cakupan apps/web/src listener storage/BroadcastChannel (SEARCH-WEB-01).

#### WEB-10 - uploadFile/getBlob/postBlob melewati retry 429, x-hm-depot-changed, tag X-App-Id - dampak 1-2
- [LEGACY-CLAIM api.ts:452-558] hanya rawRequest yang memakainya.

#### WEB-11 - Teks error hardcode di util non-komponen - dampak 1
- use-async.ts (Something went wrong); depot-context.tsx (Gagal memuat daftar depot); offline-queue STALE_DEPOT_MESSAGE dan Gagal mengirim [LEGACY-CLAIM file masing-masing].

#### WEB-12 - Idempotency-Key hanya pada 5 jalur tulis; timeout 15s membuat hasil tak pasti jadi error - dampak 2-3
- Header di checkout, payout, walk-in, driver/earnings; rewards via body [LEGACY-CLAIM grep]; backend mengenal key hanya di order-service dan payout-service [LEGACY-CLAIM grep]. POST lain bergantung guard status server. [ASSUMPTION] daftar POST non-idempoten perlu ditinjau service owner.

#### Kontrol yang sudah ada (jangan dilaporkan ulang)
Replay-safe server untuk job antrian; guard MOBILE_API_URL https non-kosong di CI (.github/workflows/mobile.yml:250-253,440-442) + ARG wajib Dockerfile; check-endpoint-contracts.mjs (path+method) di CI (ci.yml:432); enum status klien = prisma; refresh single-flight, tidak logout pada 408/0; Web Lock flush antar-tab; Sentry di-scrub.

#### Tambahan putaran 2

#### WEB-13 - Hari lokal perangkat dipakai di 2 tempat, lolos dari gerbang check-tz-usage (BI) - dampak 2, effort S
- employee-depot-assignment.tsx:26-28 membangun tanggal dari getFullYear/getMonth/getDate perangkat; order-detail.tsx:245-246 memakai setHours(0,0,0,0) perangkat sebagai batas hari shift-on-duty [LEGACY-CLAIM]. Platform menghitung dalam WIB (lib/wib.ts) dan gerbang scripts/check-tz-usage.mjs hanya menangkap toISOString().slice, date_trunc, getUTC* [LEGACY-CLAIM scripts/check-tz-usage.mjs:1-40], jadi pola getter-lokal tidak terjaga. Pencarian pola ini di components+lib hanya menemukan 2 lokasi (SEARCH-WEB-07). Perangkat WITA/WIT atau penyewa zona lain menggeser batas hari. Tampilan jam saja (cashier-shift-bar.tsx:165, operator-ringkasan.tsx:33) juga memakai zona perangkat tanpa timeZone (INFERRED, kosmetik).
- Usulan: pakai todayWib()/batas WIB; perluas check-tz-usage ke getFullYear/getDate/setHours pada now. Acceptance: test perangkat TZ=Asia/Jayapura menghasilkan hari WIB yang sama.

#### WEB-14 - localStorage tanpa try/catch di provider akar (FLW) - dampak 2, effort S
- LocaleProvider (locale-context.tsx:91,117), ThemeProvider (theme-context.tsx:37,51), OnboardingTour (onboarding-tour.tsx:24,43,59) dan setSession (session-store.ts:60) mengakses localStorage tanpa guard, sedangkan printer-prefs, session-device, pending-add, unread, locale-sync menjaganya [LEGACY-CLAIM baris tsb]. Bila penyimpanan diblokir (mode privat tertentu, kebijakan kuki) effect akar melempar dan seluruh aplikasi jatuh ke global-error. Tidak ada test yang mensimulasikan localStorage melempar (grep test). Usulan: bungkus helper tunggal safeStorage.

#### WEB-15 - Toast kesalahan menampilkan String(err) mentah (FTR) - dampak 1
- payout-account.tsx save(): toast(err instanceof ApiError ? err.message : String(err)) [LEGACY-CLAIM] sehingga error jaringan non-ApiError tampil sebagai teks teknis Inggris.

#### Hasil pemindaian terstruktur putaran 2
- Tes: 338 file (test, e2e, e2e-static), 2415 kasus, tidak ada file tanpa expect; satu skip bersyarat terdokumentasi (e2e/hr-checkin.spec.ts:163) [STRUCTURED-SCAN, /tmp skrip].
- Panggilan mutasi api.post/put/patch/del tanpa try/catch dalam 14 baris: hanya jalur antrian (offline-queue.ts, ditangani flush), push.ts (dipanggil dengan catch di pemanggil), settings.ts (pemanggil di app/, di luar cakupan). Tidak ada temuan baru.
- Pola dangerouslySetInnerHTML, fetch mentah, window.open, console.log, ts-ignore, target=_blank tanpa rel: tidak ditemukan di components+lib (kecuali yang tercatat di SEARCH-WEB-05).



### Arsip wilayah auth-gateway-access

Provenance: `agents/auth-gateway-access/findings.md`.

#### Temuan: auth-service + gateway-service + packages/access (HEAD 1e93545a2)
Bukti: STATIC (kode dibaca) kecuali dinyatakan; RUNTIME tidak mungkin. Area: FTR/FLW/BI/AUT. Kontrol yang SUDAH ada dan tidak dilaporkan ulang: canGrantRole+RESTRICTED_GRANTS (packages/access/src/index.ts:823-861); guard last-SUPER_ADMIN untuk delete/suspend (customer.prisma.repository.ts:141-199); rotasi refresh token atomik + deteksi reuse (session.service.ts:78-124); OTP issueExclusive+claimAttempt (otp-token.prisma.repository.ts:55-113); tier OTP gateway (gateway.setup.ts:185-191,302-313); strip x-internal-key (gateway.setup.ts:388); CUSTOM_FORBIDDEN (index.ts:948); idle limit HQ (session.service.ts:199-221). Keputusan docs diterima: access token hidup <=15 menit setelah nonaktif (docs/OPEN_GAPS_DECISIONS_2026-10.md:67-68).

#### AUT-01 - Akun berperan tinggi bisa diturunkan/dinonaktifkan peran lebih rendah; guard super admin terakhir tidak ada di jalur ganti-peran
Area AUT. Dampak 4. Effort S-M.
Masalah: canGrantRole hanya menilai peran TARGET (index.ts:842-850). inviteStaffDetailed memanggil existing.promoteToStaff(role) pada akun apa pun yang nomornya cocok [LEGACY-CLAIM account.service.ts:354-386]. setStaffRole (internal, dipanggil hr-service) hanya memeriksa canGrantRole(grantedBy, role baru) [LEGACY-CLAIM account.service.ts:592]. Peran target seperti STAFF_DEPOT/SUPERVISOR tidak ada di RESTRICTED_GRANTS (index.ts:823-833), jadi HEAD_OFFICE (staffAdmin) atau HR (via hr-service) dapat menurunkan SUPER_ADMIN/DIREKTUR/FINANCE yang sudah ada. Guard last-SUPER_ADMIN hanya di markDeletedGuardingLastSuperAdmin/suspendGuardingLastSuperAdmin; save() menulis role mentah [LEGACY-CLAIM customer.prisma.repository.ts:141-227]. Serupa: PATCH auth/staff/:id/status (staffAdmin, account.controller.ts:315-327) -> applyActive tidak membandingkan peran aktor vs target [LEGACY-CLAIM account.service.ts:738-771]. Spec hanya menguji pemberian peran terbatas (test/unit/account.service.spec.ts:216,254, STRUCTURED-SCAN) [INFERRED: tidak ada uji penurunan].
Usulan minimum: tolak ubah-peran/nonaktif bila peran SAAT INI target ada di RESTRICTED_GRANTS dan aktor bukan grantor sahnya; guard last-SUPER_ADMIN transaksional untuk perubahan peran dari SUPER_ADMIN.
Risiko: skenario HR sah (MANAGER dipindah); uji regresi jalur hr-service. Dependensi: hr-service sudah mengirim grantedBy. Acceptance: HEAD_OFFICE invite/status pada SUPER_ADMIN -> 403/409; super admin terakhir tidak bisa diturunkan paralel. Verifikasi: unit test + race test (pola test/race). Owner: tim Auth/Security. Bila ditunda: satu akun HEAD_OFFICE (atau salah ketik nomor) dapat mencabut superuser; pemulihan butuh akses DB. Delta: CORE-1/XCUT-4 menutup penaikan, bukan penurunan.

#### AUT-02 - Akun dibuat lewat /auth/login (dan pre-register impor) tidak punya baris consent TERMS/PRIVACY
Area BI (UU PDP). Dampak 4. Effort S.
Masalah: sejak AUTH-3 nomor tak dikenal dibuat PENDING oleh requestLogin tanpa recordRegistrationConsent [LEGACY-CLAIM login.service.ts:52-64]; consent hanya ditulis di RegistrationService.register dan hanya bila akun belum ada [LEGACY-CLAIM registration.service.ts:88-92; grep: satu-satunya pemanggil]. Web: login nomor baru langsung ke /verify purpose REGISTRATION tanpa checkbox [LEGACY-CLAIM apps/web/src/app/login/page.tsx:95-113]. preRegisterCustomer juga tidak menulis [LEGACY-CLAIM account.service.ts:806-825]. Dampak: ledger bukan bukti untuk jalur utama; pendingAcceptance menandai mereka belum diminta [INFERRED consent.service.ts:157-162]. Belum ditemukan dalam cakupan services/auth-service/src (SEARCH-AGA-02).
Usulan: tampilkan persetujuan di langkah verify REGISTRATION dan rekam saat markPhoneVerified, atau rekam source tersendiri + prompt wajib via /account/consents/pending. [ASSUMPTION] apakah persetujuan implisit sah secara hukum? (unresolved).
Acceptance: setiap CUSTOMER ACTIVE punya TERMS+PRIVACY. Verifikasi: hitung customer tanpa consent_records (butuh DB, di luar audit). Owner: Produk+Legal. Bila ditunda: kepatuhan PDP tahap 2 tidak terbukti untuk jalur masuk utama.

#### AUT-03 - Salinan lokal getRequestContext masih mempercayai X-Forwarded-For (delta AUTH-4)
Area AUT. Dampak 3. Effort S.
Fakta: perbaikan CORE-3/AUTH-4 ada di platform (packages/platform/src/http/request-context.ts: XFF dipercaya hanya bila peer privat) [LEGACY-CLAIM]. auth-service punya fork yang mengambil hop pertama tanpa syarat [LEGACY-CLAIM services/auth-service/src/common/http/request-context.ts:7-11], dipakai auth.controller dan account.controller untuk audit ipAddress dan refresh_tokens.ipAddress/daftar sesi [LEGACY-CLAIM account.controller.ts:28]. docs/SECURITY_AUDIT_REGISTER.md:92 mencatat AUTH-4 Terbuka; delta: perbaikan tidak sampai ke service pemilik trail.
Usulan: pakai versi platform, hapus fork. Acceptance: spec XFF palsu dari peer publik diabaikan. Owner: Auth. Bila ditunda: trail audit/sesi dapat dipalsukan pada deploy tanpa Caddy.

#### GW-04 - BFF sesi gateway tidak meneruskan IP/User-Agent klien; login/refresh web tercatat sebagai IP gateway dan berbagi satu bucket throttle auth-service
Area AUT/FLW. Dampak 3-4. Effort S.
Fakta: callAuth hanya mengirim content-type dan authorization [LEGACY-CLAIM session-bff.ts:137-147]; tidak ada xfwd/XFF/UA di src gateway (grep nol). Akibat: (a) getRequestContext auth-service menerima peer gateway + UA fetch, sehingga audit OTP_FAILED/LOGIN_SUCCEEDED dan daftar perangkat (session.service.ts:21-41) tidak informatif [INFERRED]; (b) clientIpTracker (packages/platform/src/http/per-client-throttle.ts:19-21) memakai alamat itu, jadi seluruh otp/verify, refresh, logout lewat BFF berbagi satu bucket SERVICE_RATE_LIMIT_MAX=3000/menit (docker-compose.prod.yml:28) [LEGACY-CLAIM nilai; INFERRED efek]. Beberapa IP penyerang (gateway mengizinkan 600/mnt/IP) dapat menghabiskan bucket dan menolak login/refresh semua pengguna.
Usulan: teruskan X-Forwarded-For (req.ip) dan User-Agent di callAuth. Acceptance: e2e membuktikan ip/ua klien tiba di auth-service dan throttle per klien. Owner: Platform. Bila ditunda: DoS login lintas-pengguna + audit buta. [ASSUMPTION] perlu uji runtime.

#### GW-05 - Tier OTP: jalur auth/me/phone tidak tercakup; kunci per alamat IPv6 penuh
Area BI. Dampak 2-3. Effort S.
Fakta: regex hanya register, login, otp/resend [LEGACY-CLAIM gateway.setup.ts:190] padahal POST auth/me/phone mengirim SMS ke nomor sembarang [LEGACY-CLAIM account.controller.ts:105-116, phone-change.service.ts:80]; hanya dibatasi cooldown 1/menit/akun + bucket umum per-user. Kunci tier = otp: + req.ip [LEGACY-CLAIM gateway.setup.ts:306]: satu bucket per alamat; blok IPv6 /64 memberi bucket baru per request [INFERRED]. [ASSUMPTION] apakah ingress publik melayani IPv6? (unresolved).
Usulan: tambah me/phone ke tier; agregasi IPv6 ke /64. Acceptance: unit test isOtpIssuingPath + keyGenerator. Owner: Platform.

#### AUT-06 - /auth/otp/resend masih oracle enumerasi (AUTH-3 separuh selesai)
Area AUT. Dampak 2. Effort S.
Fakta: login sudah satu-pintu (login.service.ts:33-50), tetapi resend melempar CustomerNotFoundError untuk nomor tak dikenal [LEGACY-CLAIM otp-verification.service.ts:104-109]; purpose dipilih klien termasuk PHONE_CHANGE tanpa targetPhone [LEGACY-CLAIM resend-otp.dto.ts]. Register mencantumkan resend; delta: bagian itu belum tertutup.
Usulan: jawaban bentuk sama; batasi purpose ke LOGIN dan REGISTRATION. Owner: Auth.

#### AUT-07 - Hapus akun staf tidak memeriksa kepemilikan depot FRANCHISE_OWNER
Area FLW. Dampak 3. Effort S.
Fakta: applyActive menolak nonaktif owner ber-share [LEGACY-CLAIM account.service.ts:739-748]; deleteStaffAccount (SUPER_ADMIN, tak bisa dibatalkan) tidak memanggil OwnedDepotsPort [LEGACY-CLAIM data-subject.service.ts:313-386; grep ownedDepots hanya di account.service]. Hasil: owner teranonimkan sementara depot.ownerId menunjuk dan payout terus terakru [INFERRED]. Usulan: countOwned sebelum markDeleted (fail-closed). Acceptance: delete owner ber-share -> 409.

#### AUT-08 - Retensi/penghapusan otp_tokens, refresh_tokens dan sisa PII anonimisasi belum ada
Area BI (PDP). Dampak 3. Effort M.
Fakta: tidak ada executor retensi untuk otp_tokens/refresh_tokens (services/admin-service/src/infrastructure/http/purge-executor.registry.ts: dataset audit_logs, notifications_messages, proof_of_delivery, payment_proof, dll, tanpa otp/refresh) dan tidak ada deleteMany kedaluwarsa di auth-service (grep nol) [LEGACY-CLAIM]. otp_tokens.targetPhone (nomor pihak ketiga) plaintext, tidak ada di ERASURE_EXEMPTION_LIST [LEGACY-CLAIM erasure-executor.registry.ts:123-157]; docs/AUDIT_L3.md sekitar baris 619 dan 675 sudah menandainya (delta: belum ditangani di HEAD). anonymiseCustomer hanya menghapus refresh token [LEGACY-CLAIM data-subject-request.prisma.repository.ts:118-126]; anonymisedIdentity tidak menghapus plateNumber/vehicleType/assignedDepotId [LEGACY-CLAIM data-subject-request.ts:60-68].
Usulan: purge OTP consumed/kedaluwarsa dan refresh kedaluwarsa; nolkan targetPhone/plate saat anonimisasi atau tulis sebagai pengecualian. Owner: Auth+Legal.

#### AUT-09 - Perubahan RBAC dapat selesai tanpa jejak audit
Area AUT. Dampak 2. Effort S.
Fakta: AuditService.record menelan semua kegagalan [LEGACY-CLAIM audit.service.ts:65-73]; AccessMatrixService.record dipanggil setelah tulis DB, tanpa transaksi bersama [LEGACY-CLAIM access-matrix.service.ts:565-574]. Usulan: untuk aksi access.* dan staff.account.deleted jadikan kegagalan audit terlihat (error + metrik) atau satu transaksi. Owner: Auth.

#### AUT-10 - Edit matriks tanpa kontrol konkurensi; TOCTOU arsip/nonaktif peran
Area FLW. Dampak 1-2. Effort S.
Fakta: set/applyAll menulis daftar penuh tanpa seenUpdatedAt [LEGACY-CLAIM access-matrix.service.ts:184-232] padahal peran custom memakai assertFresh (:331); archiveRole/setBuiltInDisabled menghitung pemegang lalu menulis tanpa kunci (:357-363,:433-438), sehingga invite bersamaan bisa menempatkan akun pada peran yang baru diarsipkan (assignable dari snapshot memori, account.service.ts:84-87) [INFERRED]. Hanya SUPER_ADMIN menulis, risiko rendah.

#### AUT-11 - Satu INTERNAL_SERVICE_KEY bersama; tidak ada denylist /internal/ di tepi
Area AUT. Dampak 2. Effort M.
Fakta: satu kunci dibandingkan di InternalAuthGuard [LEGACY-CLAIM internal-auth.guard.ts:24-35]; endpoint internal membuat/ubah peran, menangguhkan, dan menyuntik audit dengan actorId bebas [LEGACY-CLAIM internal.controller.ts, audit.controller.ts:92-104]. grantedBy hanya klaim pemanggil (internal.dto.ts:79-88) tetapi dibatasi HR_MANAGED_ROLES. Gateway menghapus header kunci (gateway.setup.ts:388) tetapi tetap meneruskan /auth/api/v1/auth/internal/* (gateway.setup.ts:410-416) [LEGACY-CLAIM]; satu-satunya kontrol adalah guard. Rotasi PREVIOUS sudah ada (env.validation.ts:104). Usulan: 404 di tepi untuk segmen /internal/ (berlapis). Dampak rendah selama kunci tidak bocor.
#### AUT-12 - Endpoint publik otp/verify menerima purpose PHONE_CHANGE: token akses curian berubah menjadi sesi 30 hari
Area AUT. Dampak 3. Effort S. (ditemukan putaran 3)
Fakta: VerifyOtpDto memakai IsEnum(OtpPurpose) sehingga PHONE_CHANGE lolos [LEGACY-CLAIM dto/verify-otp.dto.ts; domain/otp/otp-purpose.enum.ts:2-12]; OtpVerificationService.verify tidak membatasi purpose dan langsung menerbitkan sesi (otp-verification.service.ts:44-101) [LEGACY-CLAIM]. Pemegang access token korban (hidup <=15 menit) memanggil POST auth/me/phone ke nomor miliknya sendiri, lalu memverifikasi kode itu di /auth/otp/verify (public, BFF) dengan purpose PHONE_CHANGE: ia memperoleh refresh token baru (30 hari) tanpa memindahkan nomor, tanpa revokeAll, dan tanpa sendPhoneChanged ke nomor lama (peringatan hanya di confirm, phone-change.service.ts:164-168) [INFERRED dari alur kode]. Komentar port otp-purpose.enum menyebut tujuan pemisahan purpose agar kode tidak dapat dipakai silang, tetapi pemisahan hanya berlaku di sisi penerbit.
Usulan: verify/resend publik hanya LOGIN dan REGISTRATION (IsIn); PHONE_CHANGE hanya lewat confirm. Acceptance: uji verify purpose=PHONE_CHANGE -> 400. Owner: Auth. Bila ditunda: pencurian token jangka pendek meningkat menjadi persistensi tanpa jejak peringatan. Terkait AUT-06 (resend menerima purpose bebas yang sama).

#### AUT-13 - Antrean PDP staf tidak mengurutkan PENDING lebih dulu (urutan alfabet status)
Area FLW (PDP). Dampak 2. Effort S. (putaran 3)
Fakta: komentar dan port berjanji "PENDING first, longest wait first" (data-subject-request.repository.ts port baris 33; data-subject-request.prisma.repository.ts:67-75), tetapi orderBy status asc pada kolom TEXT (schema.prisma:214 status String) mengurutkan COMPLETED, IN_PROGRESS, PENDING, REJECTED secara leksikal [LEGACY-CLAIM kode; INFERRED urutan hasil]. Tanpa batas halaman (findMany tanpa take selain pengaman platform loggedQueryBounds). Akibatnya permintaan PENDING terlama terkubur di bawah riwayat selesai; juga DataSubjectRequestDto mendeklarasikan status enum tanpa IN_PROGRESS (dto/data-subject.dto.ts:45) dan filter ?status hanya PENDING/COMPLETED/REJECTED (data-subject.controller.ts:76-79), sehingga klaim yang macet IN_PROGRESS hanya terlihat tanpa filter.
Usulan: urutan eksplisit (CASE status) atau filter default PENDING+IN_PROGRESS; tambahkan IN_PROGRESS ke DTO/filter. Acceptance: spec antrean memuat PENDING di atas COMPLETED. Owner: Auth/Legal-ops. Bila ditunda: SLA respons PDP bisa terlewat tanpa disadari.


### Arsip wilayah crm-reco-forecast

Provenance: `agents/crm-reco-forecast/findings.md`.

#### Temuan crm-reco-forecast (crm-service, recommendation-service, forecast-service) - HEAD 1e93545a2
Tingkat bukti: STATIC semua. Path relatif repo. C=services/crm-service/src, F=services/forecast-service/src, R=services/recommendation-service/src.
Cakupan akhir: 205 READ (120 full-read, 85 STRUCTURED-SCAN untuk migrasi SQL dan nama kasus spec), 41 SKIPPED (boilerplate konfigurasi, DTO generated, helper tes race/fakes, .env.example tidak dicetak), 0 BLOCKED, 0 UNREAD. Isi assertion spec tidak dibaca. Lihat ledger.json.

#### CRM-01 Kampanye tanpa dedupeKey -> pesan ganda bila klaim kedaluwarsa/crash (FLW, dampak 3, effort M) [DIFINALKAN setelah baca scheduler]
Masalah: deliver() memanggil notify(BROADCAST, phone, {message}, customerId) tanpa dedupeKey [LEGACY-CLAIM C/infrastructure/notification/inbox-broadcast.delivery.ts:38]. Mekanisme dedupe sudah ada (recordOnce + kolom unik) [LEGACY-CLAIM C/infrastructure/prisma/notification.prisma.repository.ts:100-127] tapi hanya aktif bila pengirim mengirim kunci. Klaim penerima SENDING kedaluwarsa 10 menit bisa diklaim ulang [LEGACY-CLAIM C/infrastructure/prisma/campaign.prisma.repository.ts:54,175-180]; hasil dicatat sesudah deliver [LEGACY-CLAIM C/application/services/campaign.service.ts:306-313]. Crash/timeout antara deliver dan recordRecipientResult, atau batch 200 yang >10 menit (CRM-03), mengirim penerima yang sama lagi (inbox + push kedua). [INFERRED dari ref di atas]
Kontrol ada: klaim bersyarat + claimToken (CRM-9); dedupeKey event satu-kali (#771); sweep berkunci per job (mkdir lock) sehingga tick normal tidak tumpang tindih [LEGACY-CLAIM scripts/scheduler/sweep.sh:34-55]. Kadens: */2 menit [LEGACY-CLAIM scripts/scheduler/crontab:83]; timeout request 600 s = sama dengan jendela klaim 600 s [LEGACY-CLAIM sweep.sh:32 vs campaign.prisma.repository.ts:54], dan pembatalan wget tidak menghentikan loop di server, jadi tumpang tindih hanya muncul bila satu tick >10 menit atau crash. Dampak diturunkan 4->3.
Usulan minimum: dedupeKey deterministik per recipientId dari sweep ke notify.
Acceptance: dua deliver untuk recipient sama menghasilkan 1 Notification dan 1 push. Verifikasi: tes sweep dengan klaim kedaluwarsa + fake notify. Owner: BE crm. Risiko rendah. Dependensi: tidak ada. Ditunda: promo ganda pada kampanye besar/lambat.

#### CRM-02 Kegagalan sementara jadi FAILED permanen; kampanye 0-terkirim tetap SENT; opt-out dihitung gagal (FLW+BI, dampak 3, M)
Error apa pun (termasuk MarketingPreferenceUnavailable 503 saat customer-service turun) -> penerima FAILED, tak dicoba lagi [LEGACY-CLAIM C/application/services/campaign.service.ts:314-322]. Tanpa pending, kampanye di-finalize SENT apa pun hasilnya [LEGACY-CLAIM campaign.service.ts:327-334]. Opt-out masuk failedCount [LEGACY-CLAIM inbox-broadcast.delivery.ts:37; campaign.service.ts:314-317] sehingga KPI gagal bercampur pilihan pelanggan dan outage. Sinyal satu-satunya: ok=false untuk heartbeat [LEGACY-CLAIM campaign.service.ts:336].
Kontrol ada: pesan error per baris penerima; flag ok (J7).
Usulan: status penerima terpisah (opt-out vs gagal), retry terbatas untuk 5xx/503, status kampanye turunan bila sent=0.
Acceptance: outage preferensi tidak menghabiskan audiens; laporan memisahkan opt-out. Verifikasi: tes sweep prefs 503 lalu pulih. Owner: BE crm + marketing. Risiko: perubahan enum (skema satu rilis lebih awal). Ditunda: audiens hilang diam-diam saat gangguan.

#### CRM-03 Throughput sweep rendah: 3 HTTP serial per penerima ke endpoint yang sama (FLW, dampak 3, M)
marketingAllowed, localeFor, pushAllowedFor masing-masing GET /profile/internal/notifications, timeout 3 s [LEGACY-CLAIM C/infrastructure/http/notification-preference.http.adapter.ts:27-39,42-51,66-70; C/application/services/notification.service.ts:215,265; inbox-broadcast.delivery.ts:37-38]. BATCH=200, maks 5 kampanye/tick, serial [LEGACY-CLAIM campaign.service.ts:66-67,284]. Kadens */2 menit [LEGACY-CLAIM scripts/scheduler/crontab:83]. Kapasitas maks 200 penerima/kampanye/tick = 6.000/jam; audiens 50.000 = ~250 tick (~8 jam) bila 1 kampanye. Memperbesar risiko CRM-01.
Usulan: satu pembacaan preferensi per penerima (endpoint gabungan/cache), paralel terbatas. Acceptance: waktu batch turun >=3x pada fake latensi 100 ms. Owner BE crm. Risiko rendah.

#### CRM-04 Tak ada cancel/pause kampanye; audiens di-snapshot saat dibuat (FTR, dampak 3, M)
Enum hanya DRAFT/SENDING/SENT [LEGACY-CLAIM C/domain/campaign-status.ts:4-8]; controller tanpa cancel/hapus [LEGACY-CLAIM C/modules/campaign.controller.ts:49-184]. Terjadwal langsung SENDING saat tombol kirim [LEGACY-CLAIM campaign.prisma.repository.ts:141-143]; penerima dibekukan saat create [LEGACY-CLAIM campaign.service.ts:90-122]; scheduledFor hanya IsDateString [LEGACY-CLAIM C/modules/dto/campaign.dto.ts:150-152]. Opt-out tetap dicek saat kirim (baik).
Usulan: status CANCELLED + endpoint cancel; validasi scheduledFor >= now. Acceptance: kampanye dibatalkan tidak mengirim apa pun. Owner BE crm + marketing. Ditunda: salah kirim terjadwal tak bisa ditarik.

#### CRM-05 Kepala depot/manajer bisa buat & kirim kampanye depot tapi tak bisa baca hasilnya (FTR, dampak 2, S) [INFERRED]
depotCampaign = KEPALA_DEPOT, MANAGER, MARKETING, SUPER_ADMIN [LEGACY-CLAIM packages/access/src/index.ts:139]; GET /campaigns dan /:id butuh campaignRead = MARKETING, HEAD_OFFICE, DIREKTUR, SUPER_ADMIN [LEGACY-CLAIM packages/access/src/index.ts:132; C/modules/campaign.controller.ts:97-107]. Halaman depot hanya create+send [LEGACY-CLAIM apps/web/src/app/dashboard/broadcast/page.tsx:126,137]. [ASSUMPTION: ada layar progres lain? tanya produk]. Usulan: GET kampanye milik sendiri (createdBy) untuk depotCampaign.

#### CRM-06 "Tandai semua dibaca" ops mengabaikan lingkup depot dan notifikasi personal (FLW, dampak 2, S)
markAllOpsRead mengambil limit baris terbaru semua event ops tanpa filter depot/PERSONAL, beda dari listOpsFeedFor [LEGACY-CLAIM C/infrastructure/prisma/notification.prisma.repository.ts:193-206 vs 149-176; C/modules/notification.controller.ts:91-93]. Akibat: alert depot staf kecil bisa tetap unread (jendela 50 se-jaringan) dan baris depot lain/personal orang lain ikut ditandai atas namanya. Usulan: pakai filter yang sama dengan feed. Acceptance: setelah read-all feed staf itu 0 unread.

#### FCS-01 Hari berjalan (parsial) ikut deret historis forecast (BI, dampak 3, S)
toDay = today, deret dense mencakup hari ini [LEGACY-CLAIM F/application/services/forecast.service.ts:116-118,128-131; F/domain/series.ts:41-54]. MA 14 hari dan slope memasukkan hari belum selesai -> cenderung under-forecast (permintaan dan omzet). Tak ada penanganan parsial [LEGACY-CLAIM F/domain/forecast.ts:45-70]. [INFERRED]. Usulan: akhiri jendela kemarin atau skala hari berjalan. Acceptance: hasil stabil sepanjang hari (tes now 08:00 vs 23:00).

#### FCS-02 Daftar churn: top-N dari lastOrderAt bukan skor; tak ada batas "sudah hilang" (BI, dampak 3, M)
Repo urut lastOrderAt asc lalu take limit [LEGACY-CLAIM F/infrastructure/prisma/forecast.prisma.repository.ts:243-248]; service baru menskor dan mengurut ulang di antara baris itu [LEGACY-CLAIM forecast.service.ts:288-318]; komentar "already the most at-risk" [forecast.service.ts:287] keliru karena skor memakai bobot frekuensi+monetari [LEGACY-CLAIM F/domain/churn.ts:38-47]. Recency dijepit 1, jadi pelanggan loyal lapsed berbulan-bulan (skor ~0.3) bisa mengisi 50/200 slot dan menyingkirkan sekali-beli yang baru lewat window (skor 1.0). Tak ada batas atas lost, pelanggan tidur bertahun mendominasi. [INFERRED]. Tak ada indeks lastOrderAt saja untuk query tanpa depot [LEGACY-CLAIM F prisma/schema.prisma:56]. Usulan: kandidat lebih luas atau skor di SQL; tambah maxDays. Acceptance: fixture 1 sekali-beli 50 hari vs 300 loyal 200 hari -> sekali-beli muncul.

#### FCS-03 Fitur akhir pekan dataset salah indeks (BI, dampak 2, S) - dormant
WEEKEND_DAYS=[5,6] dengan day % 7 pada hari-sejak-epoch [LEGACY-CLAIM F/domain/dataset.ts:68,100]. 1970-01-01 Kamis, jadi indeks 2=Sabtu, 3=Minggu; [5,6]=Selasa/Rabu [INFERRED kalender; satu-satunya tes, pr-j-engine.spec.ts:39-44, memakai WEEKEND_DAYS[0] sendiri sehingga tautologis dan tidak menguji tanggal kalender nyata]. Dataset belum dipakai model (hanya spec; SEARCH-CRF-05) jadi dampak nol sekarang, merusak model berfitur ini nanti. Usulan: default [2,3] + tes tanggal nyata (Sabtu 2026-10-31).

#### FCS-04 Ingest fire-and-forget tanpa retry/outbox; rebuild manual dan gagal-diam (FLW, dampak 4, M)
order-service memanggil ingest sekali, timeout 5 s, error hanya log [LEGACY-CLAIM services/order-service/src/infrastructure/http/forecast-coordination.http.adapter.ts:21-58; services/order-service/src/application/services/order.service.ts:2412-2415]. Pemulihan satu-satunya POST /rebuild SUPER_ADMIN via tombol HQ [LEGACY-CLAIM F/modules/forecast.controller.ts:206-213; apps/web/src/lib/endpoints/insight.ts:30-32]; cron rebuild tak ditemukan [SEARCH-CRF-02]. Adapter feed fail-open: non-2xx/timeout/URL kosong = halaman kosong, nextCursor null, rebuild tampak sukses [LEGACY-CLAIM F/infrastructure/http/order-feed.http.adapter.ts:37,49,63-65; F/application/services/rebuild.service.ts:31-42]. Sinkron dalam HTTP (hingga 1000x500) [LEGACY-CLAIM rebuild.service.ts:14,31]. Gap data tak terlihat -> forecast/churn/rekomendasi bias; tak ada metrik lag ingest.
Kontrol ada: ingest idempoten (IngestedOrder + advisory lock) [LEGACY-CLAIM F/infrastructure/prisma/forecast.prisma.repository.ts:41-44,148].
Usulan: rebuild terjadwal harian incremental + hasil membedakan selesai vs berhenti karena error + metrik COMPLETED vs IngestedOrder. Acceptance: order gagal ingest muncul <=24 jam tanpa tindakan manual. Owner BE forecast/order. Risiko: beban feed order-service.

#### REC-01 Bucket harian ditulis UTC, jendela trending dibuka tengah malam lokal (BI, dampak 2, S)
Tulis utcDay(cmd.at) [LEGACY-CLAIM R/infrastructure/prisma/recommendation.prisma.repository.ts:12-14,36]. Baca startOfLocalDay (17:00Z hari sebelumnya untuk WIB) lalu day >= fromDay pada @db.Date [LEGACY-CLAIM R/application/services/recommendation.service.ts:69-72; R/infrastructure/prisma/recommendation.prisma.repository.ts:172; packages/platform/src/domain/business-time.ts:102-104]. Pesanan 00:00-07:00 WIB masuk bucket UTC hari sebelumnya: jendela N hari meleset 7 jam; fix C2 hanya sisi baca. Forecast benar (toBusinessDay saat tulis) [LEGACY-CLAIM F/application/services/forecast.service.ts:102]. Usulan: bucket tulis pakai zona bisnis.

#### REC-02 Skor co-buy bisa >1; hitungan per baris, bukan per pesanan/unit (BI, dampak 3, S)
purchaseCount, buyCount, pasangan dihitung per BARIS item [LEGACY-CLAIM R/infrastructure/prisma/recommendation.prisma.repository.ts:38-42,48-63], sementara forecast sengaja satu pesanan per produk meski BOGO memecah baris [LEGACY-CLAIM F/infrastructure/prisma/forecast.prisma.repository.ts:46-51]. confidence=coCount/buyCount(A) [LEGACY-CLAIM R/domain/co-buy.ts:3-5] bisa >1 (A 1 baris, B 2 baris -> A->B=2, buyCount(A)=1). IngestItem tanpa quantity [LEGACY-CLAIM R/application/ports/recommendation.repository.ts:4-9] -> trending = jumlah baris, bukan galon. [INFERRED]. Usulan: hitung per pesanan-produk distinct, bawa quantity untuk trending.

#### REC-03 Rekomendasi tak memperhatikan depot/ketersediaan (FTR, dampak 3, M) [ASSUMPTION]
reorder dan related tanpa filter depot/aktif; trending depot opsional; cold-start se-jaringan; enrich hanya membuang id tanpa ProductRef [LEGACY-CLAIM R/application/services/recommendation.service.ts:42-86; R/modules/recommendation.controller.ts:30-67]. Purchases tanpa depotId [LEGACY-CLAIM R prisma/schema.prisma:18-28]. [ASSUMPTION: apakah web memfilter dengan katalog depot aktif? apps/web/src/lib/endpoints/shop.ts:315-326 hanya URL; tanya tim web]. Dampak: produk nonaktif/tak tersedia direkomendasikan.

#### RET-01 Sweep REORDER_REMINDER: 500 tertua diulang, tanpa penanda sudah-diingatkan/dedupeKey, melewati opt-out marketing (FTR+FLW, dampak 4, M) - lintas service [FINAL]
findReorderReminderTargets = pelanggan MAX(createdAt) < cutoff, ASC, LIMIT 500, tanpa batas atas dan tanpa pengecualian yang sudah diingatkan [LEGACY-CLAIM services/order-service/src/infrastructure/prisma/order.prisma.repository.ts:312-332]; notify tanpa dedupeKey [LEGACY-CLAIM services/order-service/src/application/services/order.service.ts:1615-1626]; days=14 [order.service.ts:1577-1581]. Bila sweep berulang: pelanggan paling lama tidur dinudge tiap putaran, pelanggan 14-N hari yang layak tak terjangkau setelah 500 tertua. Lewat notify() langsung, tak melalui marketingAllowed (hanya push-mute) [LEGACY-CLAIM C/application/services/notification.service.ts:215-287], padahal ajakan pesan ulang [LEGACY-CLAIM C/domain/notification-event.ts:129-130]; keputusan CRM-2 fail-closed hanya di jalur kampanye [LEGACY-CLAIM inbox-broadcast.delivery.ts:17-26]. Kadens: harian 08:00 tanpa parameter, jadi days=14 dan limit=500 default [LEGACY-CLAIM scripts/scheduler/crontab:29-30; services/order-service/src/modules/order.controller.ts:752-760]. FINAL: 500 pelanggan yang sama (paling lama tidur) mendapat baris inbox + push setiap hari selama mereka belum memesan lagi; jumlah pelanggan di jendela 14-N hari tak pernah dijangkau bila >500 tertua. [INFERRED dari query tanpa penanda dan kadens harian] Tak memakai interval pesan ulang pelanggan atau model churn forecast.
Usulan: dedupeKey per pelanggan-per-periode + jendela [14,60] hari + cek marketingAllowed. Acceptance: maks 1 nudge/periode; >60 hari tak dinudge. Verifikasi: tes repo 600 pelanggan. Owner BE order + produk. Dependensi: keputusan hukum nudge transaksional vs promosi [ASSUMPTION].
#### CRM-07 Status Notification FAILED praktis tak pernah terisi untuk kegagalan transport push (BI, dampak 2, S)
Adapter FCM/webpush menangkap semua error dan mengembalikan {ok:false} tanpa melempar [LEGACY-CLAIM C/infrastructure/fcm/fcm.sender.adapter.ts:100-109; C/infrastructure/webpush/web-push.sender.adapter.ts:32-47]; PushService.sendToCustomer hanya mengembalikan hitungan devices/delivered [LEGACY-CLAIM C/application/services/push.service.ts:62-79]; notify() hanya memanggil markFailed bila rantai push melempar, hasil hitungan diabaikan [LEGACY-CLAIM C/application/services/notification.service.ts:264-280]. Akibat: baris tetap SENT walau 0 perangkat atau FCM menolak; KPI delivery rate dari Notification.status tidak berarti. Usulan: simpan devices/delivered (atau markFailed bila devices>0 dan delivered=0). Acceptance: FCM 5xx pada satu-satunya perangkat -> baris FAILED/ber-error.

#### CRM-08 CUSTOMER_SERVICE_URL kosong lolos validasi produksi -> seluruh audiens kampanye FAILED (FLW, dampak 3, S)
env.validation mewajibkan DEPOT/AUTH_SERVICE_URL di produksi tetapi CUSTOMER_SERVICE_URL dan ORDER_SERVICE_URL boleh kosong [LEGACY-CLAIM C/config/env.validation.ts:15,19 vs 41-54]. URL kosong membuat pembacaan preferensi mengembalikan null [LEGACY-CLAIM notification-preference.http.adapter.ts:61-64] sehingga marketingAllowed melempar (fail-closed) dan tiap penerima FAILED permanen (CRM-02), lalu kampanye berstatus SENT. Salah konfigurasi menghabiskan audiens tanpa jalan balik. Usulan: wajibkan kedua URL di produksi. Acceptance: boot produksi gagal bila kosong. [INFERRED]

#### CRM-09 Siaran depot ke kurir pull-only: tanpa push/notifikasi meski level URGENT (FTR, dampak 2, S)
BroadcastService.create hanya menyimpan baris dan log [LEGACY-CLAIM C/application/services/broadcast.service.ts:26-36]; tidak memanggil NotificationService/PushService [LEGACY-CLAIM C/modules/broadcast.controller.ts:28-38]. Kurir baru tahu setelah membuka inbox. Kontrol ada: baris DepotBroadcastRead untuk resi baca. [ASSUMPTION: apakah client melakukan polling/banner? tanya produk]. Usulan: fan-out push ke staf depot memakai recipientsForDepot untuk level URGENT.

#### Catatan tambahan (bukan temuan)
- Tes reco 'starts the window at LOCAL midnight' hanya mencakup sisi baca (REC-01 tetap berlaku) [LEGACY-CLAIM services/recommendation-service/test/unit/recommendation.service.spec.ts, nama kasus via STRUCTURED-SCAN].
- Tes forecast.service.spec menamai 'churnList ranks by recency (most-stale first)', konsisten dengan FCS-02: perilaku itu sengaja, yang dipertanyakan adalah klaim "paling berisiko".


### Arsip wilayah customer-referral

Provenance: `agents/customer-referral/findings.md`.

#### Temuan audit: services/customer-service + services/referral-service (HEAD 1e93545a2)
Tingkat bukti: STATIC kecuali dinyatakan lain (RUNTIME tidak mungkin). Delta vs register lama: grep referral|isPrimary|birthday di docs/*AUDIT*/REGISTER*.md hanya menemukan REF-1 (baca lintas depot, sudah ada kontrol depotIds), CA-3-40/45/47 -- bukan topik di bawah.

#### REF-01 (FLW/BI) Hadiah poin referral tidak idempoten dan tidak bisa dipulihkan
- Masalah: qualify membalik PENDING->QUALIFIED lalu memanggil loyalty reward tanpa idempotencyKey; adapter menelan semua kegagalan (log warn) dan return sukses. Baris referral sudah menyimpan referrerPoints/refereePoints seolah terbayar. Tidak ada sweep/retry. [LEGACY-CLAIM services/referral-service/src/application/services/referral.service.ts:217-228,236-247] [LEGACY-CLAIM services/referral-service/src/infrastructure/http/loyalty-reward.http.adapter.ts:20-47] [LEGACY-CLAIM services/referral-service/src/application/ports/loyalty-reward.port.ts:6 (signature tanpa key)]. loyalty /reward SUDAH mendukung idempotencyKey [LEGACY-CLAIM services/loyalty-service/src/application/services/loyalty.service.ts:327-344]; customer-service memakainya untuk birthday [LEGACY-CLAIM services/customer-service/src/application/services/profile.service.ts:109-115]. Test mengunci fail-open [LEGACY-CLAIM services/referral-service/test/unit/referral.service.spec.ts, judul "still qualifies (fail-open) when a loyalty reward throws"].
- Kontrol ada: transisi atomik PENDING->QUALIFIED [LEGACY-CLAIM referral.prisma.repository.ts:163-172]; timeout 5s.
- Akibat: loyalty down sesaat = poin 500/250 hilang permanen, sementara dasbor depot (sumReferrerPoints, referral.prisma.repository.ts:129-136) melaporkan poin "diberikan".
- Usulan minimum: key deterministik per referral+sisi (referral:<id>:referrer|referee); catat status belum-terbayar dan ulangi dengan key yang sama.
- Dampak 4 | Effort M | Risiko: backfill baris QUALIFIED lama yang tak terbayar perlu rekonsiliasi dengan ledger loyalty | Dependensi: loyalty-service | Owner: backend referral/loyalty.
- Acceptance: loyalty mati saat qualify -> poin masuk tepat sekali setelah pulih; panggil ulang tidak menggandakan. Verifikasi: spec fake loyalty gagal lalu pulih + query rekonsiliasi referrals QUALIFIED vs ledger. Bila ditunda: kehilangan poin diam-diam.

#### REF-02 (AUT/PDP) referral-service tidak ada di jalur ekspor/hapus UU PDP dan tidak dinyatakan pengecualian
- Masalah: referral_codes dan referrals menyimpan customerId referrer/referee (relasi + kode). Registry penghapusan hanya CRM, delivery, order.subscriptions, loyalty, depot disputes, admin tickets; UNENFORCED kosong; exemptions hanya order.orders, payout, audit_logs, consent. Referral tidak disebut. [LEGACY-CLAIM services/auth-service/src/infrastructure/http/erasure-executor.registry.ts:27-99,107-116,123-160]. referral-service tidak punya route pdp-export/pdp-anonymise [LEGACY-CLAIM services/referral-service/src/modules/referral.controller.ts:44-146 (seluruh route)]. Ekspor customer-service juga tidak mencakup referral [LEGACY-CLAIM services/customer-service/src/infrastructure/prisma/pdp.prisma.repository.ts:15-26].
- Kontrol ada: pola RemoteErasureExecutor + exemption tertulis.
- Usulan: endpoint internal export + anonymise di referral-service, daftarkan di REMOTE_DATASETS; atau exemption beralasan.
- Dampak 3 | Effort M | Risiko: agregat depot (topReferrers) berubah | Dependensi: auth-service (owner lain) | Owner: backend + legal.
- Acceptance: laporan penghapusan menyebut dataset referral; setelah anonymise tak ada baris yang mengaitkan customerId. Verifikasi: spec data-subject + query. Ditunda: dataset tak tercatat.
- [ASSUMPTION] Apakah legal menganggap relasi referral data pribadi (docs/LEGAL_OPEN_ITEMS.md tidak dibaca)?

#### REF-03 (FLW) Pemicu qualify dari order-service bisa hilang diam-diam; referral PENDING selamanya
- Masalah: order-service mendaftarkan outbox REFERRAL_QUALIFY [LEGACY-CLAIM services/order-service/src/application/services/order.service.ts:338,425-427], tetapi adapter menelan error dan non-2xx lalu return normal [LEGACY-CLAIM services/order-service/src/infrastructure/http/referral-coordination.http.adapter.ts:36-45]; komentarnya mengklaim retry aman, padahal tanpa throw tak ada retry [INFERRED: butuh verifikasi semantik outbox, ref VERIFIED di atas]. Referral-service tidak punya sweep untuk referee yang sudah punya order COMPLETED.
- Usulan: adapter melempar agar outbox mengulang (qualify sudah idempoten), atau sweep rekonsiliasi.
- Dampak 3 | Effort S-M | Dependensi: order-service | Acceptance: referral-service mati saat order selesai -> qualify terjadi setelah pulih. Verifikasi: spec outbox. Ditunda: pengajak tak dapat hadiah tanpa alarm.

#### REF-04 (BI) Pengendalian penyalahgunaan referral minim
- Masalah: tak ada batas referral per pengajak, tak ada kedaluwarsa PENDING, "pesanan pertama" = order COMPLETED apa pun (tanpa nilai minimum), tak ada dedup identitas selain id sama. [LEGACY-CLAIM services/referral-service/src/application/services/referral.service.ts:175-196,205-223; prisma/schema.prisma:36-54]. Rate limit hanya throttler global [LEGACY-CLAIM app.module.ts:41-48]. Kontrol ada: pelanggan lama ditolak (CA-3-40), fail-closed.
- Dampak 3 | Effort M | Owner: product + backend. Usulan: keputusan bisnis (a) cap/pengajak, (b) umur PENDING, (c) nilai minimum; implementasikan yang disetujui.
- [ASSUMPTION] Apakah OTP nomor unik dianggap cukup anti-fraud? Acceptance/verifikasi: spec per aturan yang diputuskan.

#### REF-05 (FTR) Ringkasan depot referral: keanggotaan sempit, fail-open = nol, tulis-saat-baca
- depotSummary memakai customerIdsForDepot = favoriteDepot + reseller [LEGACY-CLAIM services/customer-service/src/infrastructure/prisma/depot-crm.prisma.repository.ts:86-93; internal.controller.ts:168-175], sedangkan direktori CRM juga memasukkan yang pernah order (depot-crm.prisma.repository.ts:44-82) -> angka berbeda antar layar. Adapter gagal -> [] identik dengan "tidak ada" [LEGACY-CLAIM services/referral-service/src/infrastructure/http/customer-directory.http.adapter.ts:39-44]. Daftar id tak berbatas di klausa IN. getCustomerSummary (GET staf) membuat kode rujukan pelanggan lain [LEGACY-CLAIM referral.service.ts:120-122,146-161].
- Dampak 2 | Effort S-M | Usulan: null saat direktori gagal; satu definisi keanggotaan; baca tanpa membuat kode.

#### CUS-01 (FTR/BI) PATCH /addresses/:id menerima isPrimary dan melewati invarian satu-primary
- Masalah: UpdateAddressDto = PartialType(CreateAddressDto) mewarisi isPrimary; komentar DTO menyatakan primary hanya lewat endpoint khusus. Tipe UpdateAddressData membuang isPrimary hanya di compile-time; pipe whitelist meloloskannya; repo update = updateMany data: patch tanpa advisory lock dan tanpa catch P2002. [LEGACY-CLAIM services/customer-service/src/modules/dto/address.dto.ts:80-87; src/application/services/address.service.ts:89-92; src/infrastructure/prisma/address.prisma.repository.ts:130-141; packages/platform/src/nest/validation.pipe.ts:23]. Tidak ada test PATCH isPrimary [LEGACY-CLAIM grep test/].
- Akibat: isPrimary:true saat sudah ada primary -> P2002 tak terpetakan -> 500 [INFERRED dari index parsial migration 20260718141000]; isPrimary:false pada primary -> pelanggan tanpa primary, hilang dari findSegment/findRecipient (JOIN isPrimary) [LEGACY-CLAIM profile.prisma.repository.ts:127-155].
- Usulan: OmitType isPrimary dari DTO update atau tolak di service. Dampak 3 | Effort S | Acceptance: PATCH {isPrimary} -> 400. Verifikasi: e2e. Ditunda: pelanggan bisa menghilangkan primary sendiri.

#### CUS-02 (BI) PATCH alamat membatalkan invarian create (pin wajib; kolom non-null)
- create mewajibkan latitude/longitude demi routing depot [LEGACY-CLAIM address.dto.ts:60-69]; PartialType + IsOptional menerima null -> PATCH {latitude:null} mengosongkan pin; null pada kolom NOT NULL (label, city, dst.) -> 500. [INFERRED: semantik IsOptional class-validator; ref address.dto.ts:87, repo update :135-138]. Dampak 2 | Effort S | Acceptance: null ditolak 400.

#### CUS-03 (FLW/AUD) Harga agen: update dan jejak audit tidak atomik; sweep terjadwal tanpa klaim
- update menulis profil lalu recordPriceChange per field tanpa transaksi; crash di antaranya = harga berubah tanpa jejak, padahal itu tujuan K4.2 [LEGACY-CLAIM services/customer-service/src/application/services/reseller.service.ts:206-216]. oldValue dari baca sebelumnya (baca-ubah-tulis) [:180-187]. applyScheduled tanpa lock/klaim: dua tick tumpang tindih menerapkan dan mengumumkan dua kali; markPriceChangeApplied tidak bersyarat appliedAt IS NULL [LEGACY-CLAIM reseller.service.ts:236-262; reseller.prisma.repository.ts:76-79]. Bila mark gagal setelah update, tick berikut menimpa perubahan manual yang lebih baru [reseller.service.ts:248-251].
- Usulan: satu transaksi profil+jejak; klaim baris due dengan UPDATE ... WHERE appliedAt IS NULL RETURNING / SKIP LOCKED.
- Dampak 3 (uang agen) | Effort M | Acceptance: dua sweep paralel = 1 aplikasi, 1 notifikasi. Ditunda: notifikasi ganda, audit bolong.

#### CUS-04 (FTR) Perubahan harga terjadwal tidak bisa dibatalkan/diedit
- Hanya POST/PATCH/GET price-changes; tidak ada cancel [LEGACY-CLAIM reseller.controller.ts:211-252]. Salah input tanggal/harga hanya bisa ditimpa jadwal baru. Dampak 2 | Effort S-M | Usulan: DELETE untuk baris appliedAt NULL dengan jejak pembatal. [Pertanyaan pemilik: cancel saja atau edit?]

#### CUS-05 (AUT/PDP) Setelah anonimisasi pelanggan tetap di audiens broadcast/direktori; sisa PII alamat
- anonymise menghapus notification_preferences (opt-out marketing) tetapi profil dan alamat tetap ("Pengguna dihapus", phone "-"). findSegment memakai NOT EXISTS opt-out, jadi tiadanya baris = termasuk audiens [LEGACY-CLAIM pdp.prisma.repository.ts:43-62; profile.prisma.repository.ts:142-174]. addressLine, city, koordinat, postalCode, label, favoriteDepotId tetap; justifikasi "pesanan 10 tahun" berlaku untuk snapshot order-service, bukan tabel addresses ini.
- Dampak 3 | Effort S-M | Usulan: tandai erasedAt dan kecualikan dari findSegment/findRecipient/direktori depot; kurangi alamat ke level kota kecuali ada exemption tertulis.
- [ASSUMPTION] Apakah crm-service menolak phone '-' saat kirim (handoff). Acceptance: setelah anonymise tak muncul di /profile/directory. Verifikasi: spec pdp.repository + segment.

#### CUS-06 (BI/perf) Direktori broadcast dan by-depot tak berbatas
- findSegment queryRaw tanpa LIMIT, mengembalikan nama+telepon seluruh jaringan; middleware bounds tidak menyentuh raw query (diakui depot-crm.dto.ts:19-22) [LEGACY-CLAIM profile.prisma.repository.ts:142-174; profile.controller.ts:113-140]. internal/by-depot mengembalikan semua id [LEGACY-CLAIM internal.controller.ts:168-175]; internal/crm-summaries menerima daftar depot tak terbatas dan tak divalidasi UUID [LEGACY-CLAIM internal.controller.ts:190-207]. Dampak 3 pada skala | Effort M | Usulan: cursor/limit + batas jumlah ids.

#### CUS-07 (BI) Dasbor CRM: kegagalan order-service tampil sebagai nol
- OrderCrmHttpAdapter fail-soft [], getCrmDashboard menghitung total 0, repeat 0, tanpa follow-up, tanpa tanda "tidak diketahui", sementara ledger gallon sudah memakai null [LEGACY-CLAIM order-crm.http.adapter.ts:35-63; depot-crm.service.ts:316-339; kontras depot-ledger.http.adapter.ts:16-18]. Dampak 2 | Effort S | Usulan: port mengembalikan null, dasbor menandai tidak tersedia.

#### CUS-08 (AUT/minimisasi) Kartu pelanggan depot membuka seluruh buku alamat; anggota agen-only 404
- getDepotDetail mengembalikan semua alamat pelanggan ke depot mana pun yang berhubungan (favorit atau pernah order). Cek keanggotaan tak memasukkan reseller homeDepot padahal daftar memasukkannya [LEGACY-CLAIM depot-crm.service.ts:417-419,443; bandingkan depot-crm.prisma.repository.ts:66-68]. Dampak 2 | Effort S | Usulan: satu definisi keanggotaan; batasi alamat.

#### CUS-09 (FLW) Impor dan resolve-by-phone memindahkan favoriteDepotId pelanggan PENDING depot lain
- upsertFavoriteDepot menimpa tanpa syarat bila status != active [LEGACY-CLAIM customer-import.service.ts:105-107,133; profile.prisma.repository.ts:45-55]. Depot B (impor/kasir) mengambil pelanggan hasil impor depot A sebelum aktivasi; importAddresses juga menambah alamat ke akun PENDING depot lain (:192-224). Dampak 2 | Effort S | Usulan: pakai claimFavoriteDepotIfUnset di resolve-by-phone; impor = keputusan bisnis. [Pertanyaan: "last import wins" disengaja?]

#### CUS-10 (BI) Tanggal lahir mandiri tanpa batas -> poin ulang tahun bisa dipancing
- birthdate hanya IsDateString strict; boleh masa depan/ekstrem dan dapat diubah kapan saja [LEGACY-CLAIM profile.dto.ts:28-36; profile.service.ts:63-66]. Pelanggan mengatur DOB = hari sweep -> 250 poin, sekali/tahun (stempel tahun membatasi) [LEGACY-CLAIM profile.service.ts:97-116]. Feb-29 PARSIAL (ponytail profile.service.ts:84). Dampak 2 | Effort S | Usulan: rentang umur wajar + batasi frekuensi ubah.

#### CUS-11 (FTR) Default CRM_ACTIVE_DAYS tidak konsisten (30 vs 90)
- Joi default 90 [env.validation.ts:63], config fallback '30' [customer-config.service.ts:80], .env.example 30. Segmen AKTIF/INACTIVE tergantung lingkungan. [ASSUMPTION] nilai prod? Dampak 2 | Effort S.

#### CUS-12 (AUT) Foto agen diunggah sebelum cek akses/keberadaan reseller
- storage.put jalan sebelum resellers.get/update yang memeriksa assertDepotAccess; ditolak (403/404) meninggalkan objek (sering KTP) tanpa penunjuk [LEGACY-CLAIM reseller.controller.ts:174-203]. Kontrol ada: foto lama dihapus saat diganti (:191-197) dan pdpAnonymise menghapus objek (internal.controller.ts:93-97). Dampak 2 | Effort S | Usulan: cek reseller dulu atau hapus objek bila langkah berikut gagal.

#### CUS-13 (BI) Koleksi self-service tanpa batas/skema
- saved payment methods tanpa batas jumlah dan create tidak atomik [payment-method.service.ts:45-57]; remove default tidak transaksional (:75-84); favorites tanpa batas; categories IsObject tanpa whitelist kunci/tipe [profile.dto.ts:77-83]; maskedIdentifier teks bebas 40 karakter [payment-method.dto.ts:21-25]. Dampak 1-2 | Effort S.

#### CUS-14 (FLW) reseller.register cek-lalu-buat -> 500 pada balapan
- findById lalu create tanpa menangkap P2002 [reseller.service.ts:157-161; reseller.prisma.repository.ts:32-45]. Dampak 1 | Effort S.

#### Kontrol yang diperiksa dan memadai (bukan temuan)
Advisory lock create/hapus/primary alamat (address.prisma.repository.ts:48-96); kepemilikan di query update (CUS-2); SelfScoped; DepotScopeGuard (query/body/param); AUTHZ-A7 kartu depot; kunci idempotensi birthday; fail-closed order-history saat redeem; unik refereeCustomerId + terjemahan P2002; PDP hapus objek foto sebelum pointer.


### Arsip wilayah infra-docs

Provenance: `agents/infra-docs/findings.md`.

#### Temuan agent infra-docs (scripts, .uat, ops, infra, .github, .claude, test, root, docs)
Bukti: STATIC. RUNTIME tidak mungkin. Cakupan jujur: 31 READ, 113 PARTIAL, 27 SKIPPED, 202 UNREAD (ledger.json). Kontrol CI/CD, alerting, backup, DR sudah matang; hanya temuan berbukti di bawah.

#### IDO-01 (FLW) Log cron backup2 tidak dibuat installer
- Cron 04:00 menulis ke /var/log/hydromart-backup2.log [LEGACY-CLAIM scripts/install-host-cron.sh:92]. Loop pembuat log hanya: backup, restore-drill, watchdog, ops-checks, objects [LEGACY-CLAIM install-host-cron.sh:163]. Bila /var/log tak writable oleh user deploy, redirect gagal dan skrip tak jalan. check-backup-freshness lalu melapor "log tidak ada, pasang blok cron" [LEGACY-CLAIM scripts/check-backup-freshness.sh:155-170] padahal installer tak memperbaikinya. Tes installer tak menyebut backup2 [LEGACY-CLAIM grep install-host-cron.test.sh: 0 hit].
- Kontrol ada: freshness mendeteksi ketiadaan log (hanya bila BACKUP2_OFFSITE_DEST diisi). Latent: BACKUP2 belum dikonfigurasi (docs/DISASTER_RECOVERY.md:204-233). PARSIAL.
- Usulan: tambah hydromart-backup2 ke daftar + uji. Dampak 3, effort S, risiko rendah. Acceptance: installer membuat 6 log; tes gagal bila hilang. Verifikasi: install-host-cron.test.sh. Owner DevOps. Bila ditunda: begitu penyedia kedua aktif, salinan kedua diam-diam tak terjadi sampai alert 05:00.

#### IDO-02 (FLW) Perekam baseline Load tampaknya tak pernah mendarat, hanya warning
- load.yml mingguan push ke main dengan token bot; gagal 3x hanya warning [LEGACY-CLAIM .github/workflows/load.yml:255-263]. Baris terakhir BASELINE.md 2026-08-29 [LEGACY-CLAIM docs/perf/BASELINE.md:117-119]; git log tanpa commit github-actions, perubahan terakhir file 2026-08-30 manusia [LEGACY-CLAIM git log]. Register B11: main berproteksi 7 cek wajib [LEGACY-CLAIM docs/PRODUCTION_READINESS_REGISTER.md:47]. Sebab [INFERRED]: push ditolak proteksi. [ASSUMPTION] run mingguan berjalan: tanya `gh run list --workflow Load`.
- Usulan: artifact/PR otomatis atau jadikan gagal-push merah. Dampak 2, effort S, owner DevOps. Acceptance: baris baru tiap run atau run merah.

#### IDO-03 (AUT) Input workflow_dispatch diinterpolasi ke shell di deploy.yml
- `sha`, `services`, `demo_phone` disisipkan ke perintah yang dieksekusi di VPS via SSH [LEGACY-CLAIM deploy.yml:235,282,295 lalu :435]. Berkas memakai env untuk nilai lain agar tak dieksekusi (deploy.yml:367-375). rollback.sh memvalidasi sha, tetapi setelah shell mengekspansi. Serupa mobile.yml:521 [LEGACY-CLAIM].
- Kontrol: dispatch butuh hak tulis. Dampak 2, effort S. Usulan: lewat envs + "$VAR" berkutip + regex. Acceptance: input berisi titik-koma + perintah tak dieksekusi. Owner DevOps.

#### IDO-04 (AUT/BI) Dump database tak dienkripsi saat keluar kotak, .env dienkripsi
- backup-db.sh hanya gzip [LEGACY-CLAIM backup-db.sh:47]; upload-to-s3.mjs PutObject tanpa SSE/enkripsi klien [LEGACY-CLAIM upload-to-s3.mjs:39-46]; tak ada chmod/umask [LEGACY-CLAIM grep]. pg_dumpall memuat seluruh PII dan data biometrik (SECURITY.md:3-4). ARCHITECTURE.md:15 menargetkan AES-256 at rest; bukti enkripsi dump belum ditemukan dalam cakupan scripts/ dan docs/ (SEARCH-INFRA-03).
- Kontrol: bucket tak publik (storage-policy.sh), kunci kedua tanpa hak hapus, .env terenkripsi ke sertifikat publik. [ASSUMPTION] SSE sisi server penyedia: tanya pemilik.
- Usulan: enkripsi dump ke sertifikat publik sama (pola backup-env.sh) + umask 077. Dampak 4, effort M. Risiko: drill dan DR langkah 1 harus dekripsi. Dependensi: kunci privat aman (DEC-12). Acceptance: objek tak terbaca tanpa kunci; drill hijau. Bila ditunda: bocor akun bucket = bocor seluruh basis pelanggan.

#### IDO-05 (BI) SECURITY_AUDIT_REGISTER.md: 97 dari 102 temuan "Terbuka", git menunjukkan perbaikannya
- Register "Selesai: 5" [LEGACY-CLAIM docs/SECURITY_AUDIT_REGISTER.md:11-13,52-153]. git log memuat perbaikan AUTH-1/PAY-1 (#541), PYO (#544,#547), GW (#543), CRM (#545), HR-2/3 (#549), ADM (#553), LOY (#550), DLV-1..3 (#534), ORD (#533), PRM-2 (#540) [LEGACY-CLAIM git log --grep]. Register terakhir diubah 2026-09-25.
- Usulan: rekonsiliasi register dengan PR. Dampak 3, effort M, owner QA. Agen lain: jangan menilai temuan lama "terbuka" dari register ini; efektivitas kode di luar owner saya.

#### IDO-06 (BI) Dokumen PPN bertentangan
- LEGAL_OPEN_ITEMS.md:18-24 dan BRIEF_AKUNTAN.md:19: non-PPN, tanpa baris pajak; CA-2-52 (2026-09-04): belum PKP, jangan bangun [LEGACY-CLAIM CONSOLE_AUDIT_REGISTER.md:350]. Namun AUDIT_FR_MATRIX_2026-10.md:60: PPN dicatat per pesanan + pratinjau (#683, 2026-10-18) [LEGACY-CLAIM order-service/prisma/schema.prisma:94-95; commit d49d07ecf].
- [ASSUMPTION] adakah keputusan pemilik setelah 2026-09-04 yang mengizinkan pencatatan PPN? Tanya pemilik. BRIEF_AKUNTAN memuat fakta usang. Dampak 3, effort S, owner pemilik+akuntan.

#### IDO-07 (BI) Dokumen/komentar usang (tiap butir terverifikasi)
1. DEPLOY.md:17-19 dan docker-compose.prod.yml:96-100: Postgres di semua antarmuka; docker-compose.yml:21-24 mengikat 127.0.0.1.
2. ci.yml:1045-1050 "main tak berproteksi" vs PRODUCTION_READINESS_REGISTER.md:47 "7 cek wajib".
3. DISCOUNT_AUDIT_2026-10.md:18-20 E-2..E-4 "Perlu keputusan" vs EVALUATION_11_ITEMS_TRACKER.md:34 (E-2 #623, E-3 #622, E-4 disengaja).
4. CODEOWNERS "/Caddyfile"; berkas ada di infra/caddy/Caddyfile (tanpa efek: default *).
5. ci.yml:1150 "13 databases"; init-databases.sql membuat 16.
6. RUNBOOK_INCIDENTS.md:208-211 "belum ada pemantauan saldo Zenziva" vs install-host-cron.sh:132-136.
7. RUNBOOK_ONCALL.md:19 menyebut Postgres/Redis; Redis dihapus (alert-rules.yml:166).
8. AUDIT_FR_MATRIX_2026-10.md:144 FR-083 "DITUNDA" vs ringkasan :179 "ADA (tarif belum diatur): 1".
Dampak 2, effort S, owner pemilik dokumen.

#### IDO-08 (AUT) Workflow tanpa permissions eksplisit; dua action tak dipin
- ci.yml, registry-check.yml, uat.yml tanpa blok permissions [LEGACY-CLAIM grep]. Mitigasi: deploy.yml:136-140 mencatat default repo read-only [ASSUMPTION masih benar: cek Settings > Actions]. docker/setup-buildx-action@v3 tak dipin SHA di ci.yml:1108,1240 [LEGACY-CLAIM], lainnya dipin (CI-13). registry-check.yml SSH ke produksi.
- Usulan: permissions contents read top-level; pin SHA. Dampak 2, effort S.

#### IDO-09 (FLW) Prometheus/Alertmanager tanpa healthcheck atau heartbeat dead-man
- Rule hanya untuk up{job=hydromart|infra} [LEGACY-CLAIM alert-rules.yml:15-66]; tak ada alert/heartbeat untuk Prometheus/Alertmanager; compose tanpa healthcheck keduanya [LEGACY-CLAIM docker-compose.prod.yml:896-1003]. Kontrol: watchdog menangani container berhenti (bukan hang), Uptime GitHub dari luar. PARSIAL. Alertmanager hang tapi running membuat alert bisnis diam.
- Usulan: healthcheck /-/healthy + rule Watchdog vector(1) ke pemantau luar. Dampak 3, effort S-M.

#### Bukan temuan (kontrol ada)
Deploy menunggu image (deploy.sh:843-855), migrasi sebelum kode dengan dump (deploy.sh:794-807), rollback registry, drill restore mingguan, selektor alert diperiksa promtool, gitleaks/semgrep/trivy/SBOM, /metrics 404 di Caddy.

#### DEC-xxx (keputusan pemilik, untuk 00-context.md)
Otoritas PEMILIK = tertulis sebagai keputusan pemilik di dokumen repo (bukan bukti primer).
- DEC-01 Diskon membership dan poin hangus berlaku sesuai desain; disetel di /dashboard/settings GLOBAL+DEPOT; pointExpirySweepEnabled=1, 12 bulan. docs/GO_LIVE.md:29-42. PEMILIK 2026-09-25; nilai produksi belum tentu disetel.
- DEC-02 DEMO-01 dinonaktifkan bukan dihapus setelah review Play; aktifkan sebelum tiap review. GO_LIVE.md:92-105. PEMILIK 2026-09-25; menunggu.
- DEC-03 Latihan kotak hilang sekali saat pindah VPS sebelum DNS. DISASTER_RECOVERY.md:150. PEMILIK 2026-09-25; belum dijalankan.
- DEC-04 Penyedia backup kedua Backblaze B2, kunci tanpa deleteFiles, Object Lock. DISASTER_RECOVERY.md:213-215. PEMILIK 2026-09-25; bucket/kunci belum dibuat.
- DEC-05 Kanal alert kedua untuk critical. alertmanager.yml:19-24; RUNBOOK_ONCALL.md:98. PEMILIK 2026-09-25. Orang kedua tidak ada, DITERIMA (RUNBOOK_ONCALL.md:70-78).
- DEC-06 Salinan objek backup kedaluwarsa 395 hari. DISASTER_RECOVERY.md:20,249-252; PRODUCTION_READINESS_REGISTER.md:38.
- DEC-07 PPN: belum PKP, tidak membangun; buka lagi bila omzet > Rp4,8 miliar/tahun. CONSOLE_AUDIT_REGISTER.md:350. PEMILIK 2026-09-04. Konflik: IDO-06.
- DEC-08 Retensi pesanan FINANCIAL 10 tahun tetap; yang salah teks /hapus-akun. REGISTER:57. PEMILIK 2026-09-01.
- DEC-09 Pesanan batal = uang wajib kembali. REGISTER:332. PEMILIK 2026-09-04.
- DEC-10 Depot boleh mencetak voucher sendiri; antrean persetujuan voucher HQ dilepas. REGISTER:340. PEMILIK 2026-09-04.
- DEC-11 Payroll boleh dikunci dengan absen PENDING (peringatkan). REGISTER:247. PEMILIK 2026-09-04.
- DEC-12 Kunci privat .env wajib di password manager. DISASTER_RECOVERY.md:80-83; lokasi belum terbukti (GO_LIVE.md:113).
- DEC-13 FINANCE diberi hqConsole, MARKETING tidak. REGISTER:314. PEMILIK 2026-09-02.
- DEC-14 Istirahat 60 mnt (90 Jumat) tak dibayar, per depot. REGISTER:244 (D2).
- DEC-15 Pembuat dan pemutus approval harus beda orang. REGISTER:318 (D7).
- DEC-16 Pemberian peran: FINANCE/HR/MARKETING hanya SUPER_ADMIN; MANAGER oleh SUPER_ADMIN/HR; CRM-2 marketing fail-closed; voucher/banner MANAGER tetap jaringan (DITERIMA); katalog MANAGER boleh edit + audit; poin MANAGER dibatasi depot + plafon. SECURITY_AUDIT_REGISTER.md:17-23. PEMILIK 2026-09-11.
- DEC-17 Approve payroll oleh pembuat slip ditolak (SUPER_ADMIN dikecualikan); Head office hanya dibuat SUPER_ADMIN; tarik min Rp50.000; kasbon maks 1x gaji pokok, kedaluwarsa 3 hari kerja. OPEN_GAPS_DECISIONS_2026-10.md:25. PEMILIK 2026-10-14, dibangun.
- DEC-18 Beban selisih COD butuh MANAJER/SUPER_ADMIN; hapus akun ditolak bila pesanan terbuka (force SUPER_ADMIN); deposit galon tampil belum ditagih; refund 1-3 hari. OPEN_GAPS_DECISIONS:79-83. PEMILIK 2026-10-14.
- DEC-19 Gambar promo tetap di bucket AUTH. EVALUATION_11_ITEMS_TRACKER.md:87. PEMILIK 2026-10-09.
- DEC-20 Sub-role franchise ditunda. TRACKER:53. PEMILIK 2026-10-02.
- DEC-21 FR-083 Royalti ditunda, di luar go-live. AUDIT_FR_MATRIX:144. PEMILIK 2026-10-18.
- DEC-22 Login Google dan transport WhatsApp dihapus (broadcast = inbox + web push). AUDIT_FR_MATRIX:17,160; ARCHITECTURE.md:186-189. OPEN_GAPS butir 21 masih menanyakan sisa konfigurasi WA.
- DEC-23 Mode registry (IMAGE_PREFIX) aktif sejak 2026-09-17. RUNBOOK_ONCALL.md:255-261.
- DEC-24 Rota on-call satu orang, sekunder risiko diterima. RUNBOOK_ONCALL.md:70-78.
- DEC-25 Ditunda: halaman status di luar VPS, pengiriman log keluar kotak. RUNBOOK_ONCALL.md:133-135,162-164.
Menunggu pemilik: OPEN_GAPS_DECISIONS_2026-10.md:33-73 butir 1-25; LEGAL_OPEN_ITEMS.md:12-64 (PKP, TER, bukti PDP); GO_LIVE.md:107-115; MX privacy@ (OPEN_GAPS:89).

#### PREV-xxx (temuan lama; status = yang dilaporkan dokumen, bukan verifikasi kode)
- PREV-01 SECURITY_AUDIT 2026-09 (102: High 35, Med 28, Low 39 + XCUT-4). Dilaporkan Selesai 5, Terbuka 95, Diterima 2 (PRM-1, PRM-5). git menunjukkan mayoritas diperbaiki (#533-#560; IDO-05). PLAT-5 sebagian (key unscoped).
- PREV-02 CONSOLE_AUDIT_REGISTER: 292 baris CA-*; 279 SUDAH DIPERBAIKI, 3 DUPLIKAT, 2 DITOLAK, 8 baris format pendek tak terklasifikasi [STRUCTURED-SCAN]; 0 TERBUKA. Baseline depot-scope 63 route by-id.
- PREV-03 AUDIT_L3 (2026-08-25): tidak dibaca (UNREAD).
- PREV-04 PRODUCTION_READINESS_REGISTER 2026-09-25: A1,A2,A3,B1-B6(kode),B8,B10,B12,E1-E9 SELESAI; PEMILIK: A4 (MX privacy@), A5 (rekening/QRIS), A6, A7, B7 (bucket B2), B11 (publik/proteksi), B14 (PPN/TER); DITERIMA: B13, E8. B6 kapasitas hanya diukur di runner.
- PREV-05 LEGAL_OPEN_ITEMS: PPN tanpa pemilik, TER menunggu akuntan, bukti PDP belum diuji pihak ketiga, RTO penuh belum terukur, uji keamanan dijalankan belum ada. TERBUKA.
- PREV-06 OPEN_GAPS_DECISIONS_2026-10 (148 gap diverifikasi ulang): ~16 dibangun; 25 butir menunggu pemilik/uji peramban.
- PREV-07 EVALUATION_11_ITEMS_TRACKER 2026-10-09: item 1,2 blocked aksi pemilik; 3,4,6,8,10,11 selesai; 5 selesai kode, verifikasi browser produksi menunggu pemilik; 7 ditunda; 9 mayoritas.
- PREV-08 DISCOUNT_AUDIT E-1..E-4: dokumen "Perlu keputusan", tracker menutup (IDO-07 butir 3).
- PREV-09 PHASE_M_CLOSEOUT: M16/M15 tertutup; M10 sudah diflip 2026-09-17; M2 klausa 3 sengaja tak dikerjakan.
- PREV-10 AUDIT_FR_MATRIX_2026-10: 94 ADA, 2 stub (E-Wallet, VA), 1 DIHAPUS, 1 TIDAK BERLAKU, 1 BERBEDA; 72/100 diuji runtime.
#### TAMBAHAN (putaran lanjutan)

#### IDO-10 (AUT) Berkas webhook alert kedua dibuat 0644 (rahasia terbaca semua user lokal)
- set-alert-channel.sh menulis URL webhook lalu `chmod 644` dan dir 755 [LEGACY-CLAIM scripts/set-alert-channel.sh:63-66]; alasannya sah (Alertmanager jalan sebagai nobody). Webhook Discord = kemampuan memposting ke kanal ops. Kontrol: kotak satu pengguna, .env yang lebih sensitif ada di host yang sama (RUNBOOK_ONCALL.md:243). Dampak 1-2, effort S (grup khusus atau secret docker). Hanya relevan bila akun host kedua diberikan (rota sekunder).

#### IDO-11 (FLW) uat.yml: komentar menyebut 439 kasus, ringkasan 366; run bersifat report-only dan bernilai informasi
- uat.yml:3 "439 scripted cases" vs :237 "printed 366 cases" [LEGACY-CLAIM]. Disengaja report-only (uat.yml:11-14). Bukan cacat kontrol; hanya catatan agar tak dipakai sebagai gerbang rilis. Dampak 1.

#### Catatan cakupan putaran ini
- Ledger kini hanya READ/SKIPPED/BLOCKED. 346 READ = 32 dibaca utuh (READ-FULL), 2 docx (ekstraksi zipfile+xml seluruh dokumen), dan 312 STRUCTURED-SCAN DANGKAL (seluruh file diproses skrip pola, logikanya TIDAK dibaca). Pola yang dipindai: insecure TLS, TODO/FIXME, chmod 7xx, docker.sock, echo secret, continue-on-error, || true, sudo, IP hardcode (+ strict-mode, eval, rm -rf, DROP/TRUNCATE untuk .sh). Hasil pindai: tidak ada TLS-insecure, tidak ada secret nyata, satu chmod (IDO-10), 2 docker.sock (cadvisor/Trivy), continue-on-error hanya di uat.yml.
- Jangan membaca "READ" pada 312 berkas itu sebagai audit logika. Kandidat pembacaan lanjut berprioritas: ci.yml (86K), mobile.yml (38K), backup-offsite.sh, backup-objects.mjs, restore-db.sh, check-launch-blockers.mjs, deploy-common.sh, .uat/*, test/integration/flow.mjs.

#### PREV tambahan / koreksi
- PREV-03 (dibaca ringkasan + 2.5; sisanya dipindai) AUDIT_L3 2026-08-25, 15 butir. Status terhadap repo saat ini: L3-SEC-1 (bypass rate-limit via Authorization palsu) SUDAH DIPERBAIKI [LEGACY-CLAIM services/gateway-service/src/gateway.setup.ts:61-69 rateLimitKey memverifikasi sub, jatuh ke ember IP]; L3-DR-4 (gate rota tak di CI) SUDAH [LEGACY-CLAIM ci.yml:325]; L3-DR-1 RPO 24 jam TETAP (DISASTER_RECOVERY.md:31); L3-LEG-3 PPN TETAP tanpa pemilik (LEGAL_OPEN_ITEMS.md); L3-LEG-1 TER: tabel kini ditranskripsi (LEGAL_OPEN_ITEMS.md:37-42) tetapi belum ditandatangani akuntan; L3-RET-1/2 ditangani sebagian lewat registry purge (PRODUCTION_READINESS_REGISTER B1, CONSOLE CA-3-*). Butir lain (CAP-1, CAP-2, DR-2, DR-3, SEC-2, SEC-3, RET-3, LEG-2): tak diverifikasi.
- PREV-11 PRD §34 Open Questions (9 butir; PRD.docx): per-depot pricing/membership/royalti dijawab sebagian oleh kode+DEC (DEC-21 royalti ditunda; PER-depot membership di memori; pembayaran langsung ke depot); POS/ERP, status driver, retur/galon: tak ditemukan keputusan tertulis dalam cakupan (SEARCH-INFRA-10). BRD.docx memuat 17 BR, 27 bagian; PRD §14 memuat 100 FR (cocok dengan AUDIT_FR_MATRIX).


### Arsip wilayah mobile-platform

Provenance: `agents/mobile-platform/findings.md`.

#### Temuan audit: mobile + packages/platform (HEAD 1e93545a2)
Cakupan: 165 file ledger (90 READ, 75 SKIPPED: 44 spec STRUCTURED-SCAN, 31 png/jar/gradlew/lock/generated). Tingkat bukti STATIC. mobile/ tidak berisi kode produk (hanya shell Capacitor, mobile/README.md:2); aplikasi = apps/web (agen lain).

#### PLT-01 (FLW/BI) Jejak audit lintas service: HTTP best-effort, gagal = hilang, tanpa retry tahan-lama
- Masalah: recordAuditEvent memanggil auth-service sekali (timeout 5 dtk); kegagalan hanya di-log error, tanpa antrean/ulang [LEGACY-CLAIM packages/platform/src/nest/audit-trail.ts:62-90]. AuditMutationsInterceptor dan SettingsSliceService.audit memakai jalur sama [LEGACY-CLAIM nest/audit-mutations.interceptor.ts:150-157; config/settings-slice.ts:207-218]. Outbox hanya ada di order-service; belum ditemukan outbox/event bus bersama dalam cakupan packages/platform [LEGACY-CLAIM packages/platform/src/index.ts tanpa export outbox; SEARCH-MP-01].
- Kontrol sudah ada: log error per entri; docstring mengakui batas (audit-trail.ts:17-21); order-service punya outbox + retry untuk efek order [LEGACY-CLAIM services/order-service/src/application/services/outbox.service.ts:54-60].
- Usulan minimum: untuk aksi uang (refund, override harga, settings uang) tulis baris audit lokal di DB service pemutus lalu kirim ulang; sisanya tetap fail-open.
- Dampak 3 | Effort L | Risiko: skema berubah di banyak service | Dependensi: ingest auth-service idempoten | Acceptance: auth-service mati 10 menit saat refund -> setelah pulih entri audit tiba tepat sekali | Verifikasi: tes integrasi matikan auth-service | Owner: backend lead | Bila ditunda: celah jejak refund/harga saat insiden auth-service.

#### PLT-02 (FLW) Alert webhook/Sentry: dedupe per URL lengkap, path tidak disamarkan
- Masalah: kunci dedupe svc|METHOD path|ErrName, path = request.url (id dan query ikut) [LEGACY-CLAIM nest/error-alerter.ts:80-84; nest/all-exceptions.filter.ts:43-48]. Rute berparameter menghasilkan kunci beda per id, jadi badai 5xx lolos throttle 1/menit; peta di-clear total pada lebih dari 500 entri (error-alerter.ts:86). Teks pesan dan Sentry.setTransactionName memakai path mentah; hanya stack lewat redactAlertText [LEGACY-CLAIM error-alerter.ts:90-97; nest/sentry.ts:54]. Query berisi HP/token akan keluar ke pihak ketiga [INFERRED; ASSUMPTION: adakah rute yang menerima PII di query dan bisa 5xx? cek per service].
- Kontrol ada: redaksi stack (H-21/PLAT-7), throttle 60 dtk, 503 pada /health dikecualikan.
- Usulan: kunci dedupe dan label alert pakai template path (UUID/angka jadi :id, buang query) dan redactAlertText pada path; templateOf di metrics.ts bisa dipakai ulang.
- Dampak 2 | Effort S | Acceptance: 100 5xx pada 100 id berbeda jadi 1 pesan; query berisi nomor HP tidak tampil | Verifikasi: error-alerter.spec | Owner: platform dev | Bila ditunda: banjir webhook saat insiden, kebocoran PII kecil.

#### PLT-03 (FTR) Envelope error: kode mesin hanya 5 status; 409/422/503 menjadi HTTP_ERROR
- Bukti: httpErrorCode hanya memetakan 400/401/403/404/429 [LEGACY-CLAIM nest/all-exceptions.filter.ts:84-99]; HTTP_STATUS mendefinisikan CONFLICT/UNPROCESSABLE/SERVICE_UNAVAILABLE [LEGACY-CLAIM domain/domain-error.ts:17-28]; 65 pemakaian ConflictException/UnprocessableEntityException di services [LEGACY-CLAIM grep services src]; klien membaca ApiError.code [LEGACY-CLAIM apps/web/src/lib/api.ts:59]. Klien tidak bisa membedakan konflik dari error umum tanpa mencocokkan teks.
- Kontrol ada: DomainError punya kode stabil (mis. STALE_WRITE).
- Usulan: tambah CONFLICT, UNPROCESSABLE, SERVICE_UNAVAILABLE; jangan ubah kode yang sudah dipakai klien.
- Dampak 2 | Effort S | Risiko: klien yang bergantung HTTP_ERROR | Acceptance: ConflictException menghasilkan code CONFLICT | Verifikasi: all-exceptions.filter.spec | Owner: platform dev | Bila ditunda: penanganan error klien tetap berbasis teks.

#### PLT-04 (BI) readAllPages: ceiling max tidak ketat
- Bukti: overflow dicek hanya setelah halaman PENUH [LEGACY-CLAIM domain/read-all.ts:24-30]. Jika max lebih kecil dari pageSize (500), atau kelebihan terjadi di halaman terakhir yang pendek, fungsi mengembalikan lebih dari max baris tanpa onOverflow (mis. max=100, total 400 baris kembali 400). Dipakai di 12 tempat [LEGACY-CLAIM grep readAllPages services src; SEARCH-MP-05]; nilai max tiap pemanggil tidak saya telaah.
- Usulan: cek panjang hasil terhadap max sebelum return; take = min(pageSize, max+1).
- Dampak 2 | Effort S | Acceptance: max=100 dengan 400 baris memicu onOverflow | Verifikasi: kasus baru di read-all.spec | Owner: platform dev | Bila ditunda: laporan yang dijanjikan bounded bisa melampaui batas memori.

#### PLT-05 (FLW) Kursor tidak valid diam-diam jatuh ke paginasi halaman
- Bukti: pageArgs mengabaikan kursor yang gagal decode dan memakai skip berbasis nomor halaman [LEGACY-CLAIM domain/keyset.ts:84-88]. Klien infinite-scroll dengan kursor rusak menerima halaman 1 lagi plus nextCursor valid, bisa mengulang/menggandakan baris [INFERRED].
- Kontrol: checksum FNV (CORE-6) menolak ketikan tangan.
- Usulan: kursor non-kosong yang tidak decode dijawab 400 INVALID_CURSOR.
- Dampak 2 | Effort S | Risiko: pemanggil membawa kursor lama (versi k1 tetap) | Acceptance: kursor abc dijawab 400 | Verifikasi: keyset.spec | Owner: platform dev | Bila ditunda: loop/duplikasi di klien pada kursor korup.

#### PLT-06 (FTR/BI) Idempotency tanpa helper bersama; perilaku berbeda tiap service
- Bukti: header opsional di checkout [LEGACY-CLAIM services/order-service/src/modules/order.controller.ts:110-121]; order hanya trim() tanpa batas panjang [LEGACY-CLAIM order.service.ts:2994-2996]; payout memotong 120 karakter [LEGACY-CLAIM payout-service/src/modules/payout.controller.ts:77]; loyalty memakai field body [LEGACY-CLAIM loyalty-service/src/modules/dto/reward.dto.ts:26]. Replay mengembalikan baris lama tanpa membandingkan isi permintaan [LEGACY-CLAIM order.service.ts:2677-2683]. Scope unik per pelanggan sudah benar [LEGACY-CLAIM order-service/prisma/schema.prisma:190].
- Kontrol ada: unique (customerId,key) dan penanganan race (order.service.ts:2612, 2661).
- Usulan: helper platform normalizeIdempotencyKey (trim, maks 120, charset) + simpan hash payload, balas 409 bila key sama body beda; wajibkan header untuk klien native.
- Dampak 3 | Effort M | Risiko: klien lama tanpa header | Acceptance: key sama body beda dijawab 409; key 10 KB dijawab 400 | Verifikasi: spec per service | Owner: backend lead | Bila ditunda: ketukan ganda tanpa header membuat order ganda [ASSUMPTION: apakah web/APK selalu mengirim key? cek apps/web/src/lib/api.ts:574].

#### PLT-07 (BI) redactBody audit: regex pin terlalu luas, params tidak disamarkan
- Bukti: SECRET_KEY berisi alternatif pin tanpa anchor sehingga cocok dengan kunci shipping, mapping, dst. [LEGACY-CLAIM nest/audit-mutations.interceptor.ts:30]; objek bersarang jadi teks object atau jumlah item; req.params masuk metadata tanpa redaksi (baris 141-144); query tidak dicatat. Field sah hilang dari jejak, token di path-param tersimpan.
- Usulan: beri anchor pada pin dan terapkan regex ke params.
- Dampak 2 | Effort S | Acceptance: body dengan field shippingFee tercatat; param bernama token tersamar | Verifikasi: kasus baru di audit-mutations.interceptor.spec (kini tidak ada kasus shipping) | Owner: platform dev | Bila ditunda: jejak audit kurang lengkap.

#### PLT-08 (FTR) Gate izin manifest mobile tidak per-binary
- Bukti: ALLOWED satu daftar untuk kedua binary; komentar menyebut izin Bluetooth/Wi-Fi di customer berarti includePlugins bocor, tetapi skrip tak tahu binary [LEGACY-CLAIM mobile/scripts/audit-manifest.mjs:54-84,156-170]; CI menjalankan skrip sama untuk customer dan ops [LEGACY-CLAIM .github/workflows/mobile.yml:183,213]. CAMERA/FINE_LOCATION customer dijaga task strip di build.gradle; Bluetooth dan Wi-Fi pencetak di customer tidak terdeteksi.
- Usulan: argumen customer atau ops; customer menolak CAMERA, FINE_LOCATION, semua BLUETOOTH dan WIFI.
- Dampak 2 | Effort S | Acceptance: manifest customer berisi BLUETOOTH_SCAN membuat exit 1 | Verifikasi: jalankan skrip pada manifest uji | Owner: mobile dev | Bila ditunda: deklarasi Play (Data Safety) bisa tak sesuai biner.

#### PLT-09 (FTR) Dependensi mobile/ di luar gerbang audit npm
- Bukti: mobile di luar workspaces, lock sendiri 117 paket [LEGACY-CLAIM mobile/README.md:13-16; parse package-lock]; scripts/audit-gate.mjs tidak menyebut mobile (0 hit) dan .github/workflows/security.yml tidak menyebut mobile (SEARCH-MP-04). Plugin Capacitor membawa kode native ke APK.
- Usulan: langkah audit untuk mobile/ dengan ALLOWLIST yang sama.
- Dampak 2 | Effort S | Acceptance: advisory HIGH di mobile menggagalkan CI | Verifikasi: PR uji | Owner: devops | Bila ditunda: CVE plugin native tak terlihat.

#### PLT-10 (FTR) file_paths.xml membuka seluruh external storage dan cache
- Bukti: external-path dan cache-path ber-path titik [LEGACY-CLAIM mobile/android/app/src/main/res/xml/file_paths.xml:2-3]; provider exported=false, grantUriPermissions=true (AndroidManifest.xml). Template scaffold; berisiko hanya bila kode membagi URI sembarang.
- Usulan: persempit ke subfolder yang dipakai.
- Dampak 1 | Effort S | Acceptance: path bukan titik | Verifikasi: uji share di perangkat | Owner: mobile dev | Bila ditunda: hanya hardening.

#### PLT-11 (FTR) MainActivity geolokasi: prompt kedua menimpa callback tertunda; tanpa tes native
- Bukti: satu slot pending/pendingOrigin; permintaan baru menimpa tanpa menjawab callback lama [LEGACY-CLAIM MainActivity.java, GeolocationWebChromeClient.onGeolocationPermissionsShowPrompt]; tak ada onGeolocationPermissionsHidePrompt. Satu-satunya kode native custom tanpa tes; ExampleInstrumentedTest mengharap package com.getcapacitor.app (gagal bila dijalankan) [LEGACY-CLAIM mobile/android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java:19]; CI hanya assemble (mobile.yml), tanpa connectedAndroidTest.
- Usulan: jawab callback lama dengan false sebelum menimpa; ganti tes scaffold.
- Dampak 1 | Effort S | Acceptance: dua permintaan beruntun terjawab semua | Verifikasi: uji manual perangkat | Owner: mobile dev | Bila ditunda: request geolokasi jarang menggantung.

#### PLT-12 (proses) Register keamanan usang terhadap kode platform
- Bukti: docs/SECURITY_AUDIT_REGISTER.md memuat PLAT-2,3,6,7,8 dan CORE-3,4,5,6 berstatus Terbuka (progres PR-13 dan PR-11 tertulis 0 dari total) [LEGACY-CLAIM SECURITY_AUDIT_REGISTER.md:42-43,94,124-126,140-144], padahal kode memuat perbaikannya: alg/iss/aud dipin (jwt-auth.guard.ts, token-claims.ts), staleness dibatasi (capability-refresh.ts), redaksi kutip (error-alerter.ts), relation-report (query-bounds.ts), IP terpercaya (request-context.ts), internalServiceKey (env-secret.ts), polyglot (file-type.ts), kursor ber-checksum (keyset.ts). [INFERRED bahwa kode sudah dikirim; ASSUMPTION: adakah perbaikan yang belum merge? cek git log]. Bagian hr-service dari CORE-4 dan PLAT-5 (kunci tanpa scope) tetap perlu verifikasi di service.
- Usulan: rekonsiliasi register dengan hash commit.
- Dampak 2 (proses) | Effort S | Owner: tech lead | Bila ditunda: pekerjaan duplikat, status rilis keliru.



### Arsip wilayah payout-payment

Provenance: `agents/payout-payment/findings.md`.

#### Temuan agent payout-payment (services/payout-service + services/payment-service)

HEAD 1e93545a2. Bukti: STATIC kecuali ditandai WIRED. RUNTIME tidak mungkin. ID PPA-nn. Area FTR/FLW/BI/AUT.

Fakta dasar: pembayaran direct-to-depot tanpa gateway di produksi (PAYMENT_GATEWAY_BASE_URL kosong; EWALLET/VA ditolak sebelum baris ditulis [LEGACY-CLAIM payment.service.ts:324-327]; TRANSFER/QRIS/CASH diselesaikan manual staf [LEGACY-CLAIM payment.service.ts:310-312,1467-1482]). Tidak ada SDK penyedia pembayaran/bank di dependensi [LEGACY-CLAIM package.json kedua service]. Pencairan = buku kas internal + antrean PROCESSING diselesaikan manusia [LEGACY-CLAIM hq-payout.controller.ts:195-243].
Kontrol yang SUDAH ada (bukan gap): unique parsial 1 payment aktif/order; compare-and-set updateIfStatus; replay confirm idempoten; advisory lock + Idempotency-Key withdraw; maker-checker rilis HQ (PYO-2); rekening tujuan terverifikasi (PYO-3); guard status di WHERE pada settle (PYO-4); sourceRef unik; rule/skema effectiveDate<=now; audit refund (H-29); purge bukti transfer; webhook HMAC + jendela 5 menit.

#### PPA-01 FLW/BI: transfer/QRIS sudah dibayar + bukti diunggah bisa kedaluwarsa jadi FAILED (terminal)
- Masalah: expireStalePending menggagalkan semua payment non-CASH > TTL 24 jam tanpa memeriksa bukti [LEGACY-CLAIM payment.service.ts:703-750; payment.prisma.repository.ts:122-139; env.validation.ts:80]. FAILED terminal (TRANSITIONS[FAILED]=[] [LEGACY-CLAIM domain/payment.ts:98-104]); refund hanya untuk PAID [LEGACY-CLAIM payment.ts:110-112]; staf yang telat memeriksa mutasi tak bisa confirm; pembeli diberi tahu EXPIRED [LEGACY-CLAIM payment.service.ts:729-734]. Reminder tetap dikirim ke yang sudah unggah bukti [LEGACY-CLAIM payment.prisma.repository.ts:141-158].
- Kontrol ada: TTL bisa 0; notifikasi PROOF_UPLOADED ke depot [LEGACY-CLAIM payment.service.ts:381-387].
- Usulan: lewati baris ber-proofUrl atau pindah ke antrean tinjau; hentikan reminder bila bukti ada.
- Dampak 4, effort S, owner Finance Ops/Kepala Depot. Dependensi konsol ops. Acceptance: PENDING+bukti tidak di-FAIL sweep. Verifikasi: tes unit dua baris; hitung baca-saja FAILED dengan proofUrl oleh pemilik. Bila ditunda: pembayaran nyata dianggap gagal. [INFERRED; frekuensi tak terukur]

#### PPA-02 AUT/BI: penyelesaian pencairan PAID/FAILED oleh satu orang; pelaku & referensi transfer tidak tersimpan
- markWithdrawalPaid/Failed (owner & kurir) cukup hqPayout=FINANCE/SUPER_ADMIN [LEGACY-CLAIM hq-payout.controller.ts:195-243; packages/access/src/index.ts:495]. settle hanya ubah status (+koreksi ledger bila FAILED) [LEGACY-CLAIM withdrawal.prisma.repository.ts:126-179; courier-withdrawal.prisma.repository.ts:127-179]; aktor hanya logger [LEGACY-CLAIM payout.service.ts:414]. Model tanpa settledBy/settledAt/transferRef [LEGACY-CLAIM schema.prisma:269-308]. recordAuditEvent tidak dipakai di payout-service [SEARCH-PPA-02]. Satu akun bisa transfer manual lalu tandai FAILED (saldo kembali, tarik lagi) atau PAID tanpa bukti.
- Kontrol ada: CAS PROCESSING, sourceRef koreksi, maker-checker hanya untuk permintaan rilis.
- Usulan: kolom settledBy/settledAt/transferRef (wajib PAID)/failReason + audit event; opsional dua orang untuk FAILED.
- Dampak 4, effort M, owner Finance. Risiko migrasi (rule schema satu rilis di depan). Acceptance: tiap PAID punya pelaku+waktu+referensi. Verifikasi: tes unit settle + audit di auth-service. Bila ditunda: kecurangan/kesalahan tak terlacak.

#### PPA-03 FLW/BI: refund CASH/TRANSFER/QRIS jadi REFUNDED saat disetujui tanpa bukti uang keluar
- executeRefund memanggil gateway hanya bila online+reference; selebihnya membalik status [LEGACY-CLAIM payment.service.ts:1280-1358]. Gateway kosong -> semua refund nyata lewat jalur ini. Tak ada status lanjutan (cf. PROCESSING->PAID pencairan), tak ada referensi transfer balik, tak ada rekening tujuan pelanggan [LEGACY-CLAIM schema.prisma:46-124]. refundDueAt hanya diukur ke persetujuan; antrean overdue hanya untuk approval PENDING [LEGACY-CLAIM payment.prisma.repository.ts:297-312].
- Kontrol ada: audit payment.refund.settled, ambang HQ, aturan CA-2-34.
- Usulan: tentukan kanal pengembalian; tambah refundPaidAt/By/Ref atau daftar "disetujui belum diserahkan". Dampak 4, effort M, dependensi keputusan pemilik. Acceptance: tiap REFUNDED non-gateway tahu siapa/kapan/ref. Verifikasi: tes alur refund TRANSFER.
- [ASSUMPTION] refund dibayar di luar sistem. Pertanyaan: siapa dan lewat apa?

#### PPA-04 AUT: pemisahan pengaju-penyetuju refund tidak ditegakkan (kolom pengaju sudah ada)
- refundIssue=FINANCE/MANAGER/SUPER_ADMIN, refundQueue=FINANCE/SUPER_ADMIN [LEGACY-CLAIM packages/access/src/index.ts:484,487]; FINANCE & SUPER_ADMIN memegang keduanya. approveRefund tidak membandingkan dengan refundRequestedBy [LEGACY-CLAIM payment.service.ts:1175-1193]; kolom "Information only" [LEGACY-CLAIM payment.service.ts:946-948]. Refund <= ambang langsung oleh satu orang [LEGACY-CLAIM payment.service.ts:925-962].
- Delta: keputusan terbuka #2 OPEN_GAPS_DECISIONS_2026-10.md:38; prasyarat kolom kini ada (migrasi 20261014).
- Usulan: tolak approve bila pengaju==penyetuju kecuali pengecualian terkonfigurasi & diaudit. Dampak 3, effort S. Risiko: toko satu-Finance terblokir (keputusan pemilik).

#### PPA-05 BI: refund atas pesanan COMPLETED tidak menarik kembali kredit penjualan/komisi ledger franchise
- refund() tak memeriksa status order [LEGACY-CLAIM payment.service.ts:911-962]; order hanya recordRefund [LEGACY-CLAIM order.prisma.repository.ts:1124-1126]; reverseOrderRevenue hanya dari jalur void [LEGACY-CLAIM order.service.ts:352,1457,2354]; payout tak punya endpoint refund [LEGACY-CLAIM inventory.json]. Saldo withdrawable owner tidak turun. Tingkat WIRED.
- Usulan: kebijakan siapa menanggung + reversal parsial saat internal-refund. Dampak 4, effort L, dependensi order-service & keputusan bisnis. [ASSUMPTION] refund pasca-selesai terjadi; tanyakan frekuensi.

#### PPA-06 AUT/BI: konfirmasi/penolakan pembayaran tidak menyimpan pelaku dan tidak diaudit
- confirm/fail hanya logger [LEGACY-CLAIM payment.service.ts:634,659]; tanpa kolom confirmedBy [LEGACY-CLAIM schema.prisma:46-124]; audit hanya untuk refund [LEGACY-CLAIM payment.service.ts:1401-1435]. PAID adalah satu-satunya peristiwa pembukuan pendapatan pada model direct-to-depot.
- Usulan: audit payment.confirm/fail + settledBy. Dampak 3, effort S.

#### PPA-07 BI: koordinasi ke order-service fail-open tanpa retry; rekonsiliasi hanya sebagian
- confirmPaid/notifyPaymentEvent/notifyRefunded menelan error [LEGACY-CLAIM order-coordination.http.adapter.ts:205-228]. Pemulihan ada untuk non-CASH PAID-order-CREATED (flagUnconfirmed [LEGACY-CLAIM payment.service.ts:806-851]) dan PAID-pada-order-batal; tidak ada untuk notifyRefunded -> orders.refundedAmount bisa kosong padahal REFUNDED; CASH tak tercakup.
- Usulan: job pembanding REFUNDED vs refundedAmount atau outbox. Dampak 3, effort M. [INFERRED]

#### PPA-08 FLW: penghasilan kurir hilang diam-diam tanpa rule; tarif memakai rule saat push
- Tanpa rule -> null/"skipped" [LEGACY-CLAIM courier-payout.service.ts:88-92], controller 200 recorded:false [LEGACY-CLAIM courier-payout.controller.ts:175-184]; currentRule tanpa asOf=deliveredAt [LEGACY-CLAIM courier-payout.service.ts:88; repo punya asOf courier-ledger.prisma.repository.ts:190-192].
- Usulan: asOf=deliveredAt; gagalkan terukur bila tak ada rule. Dampak 3, effort S-M. Dependensi: retry delivery-service (handoff).

#### PPA-09 FLW: persetujuan "putuskan dulu, pindahkan uang kemudian" tanpa pemulihan bila proses mati
- HqReleaseService.approve [LEGACY-CLAIM hq-release.service.ts:67-85], approveAndCredit [LEGACY-CLAIM expense-claim.service.ts:102-121]; reopen hanya di catch [LEGACY-CLAIM release-request.prisma.repository.ts:79-84]. Mati di antaranya -> APPROVED tanpa withdrawalId/ledgerEntryId, tak bisa diputuskan lagi, tanpa sweep.
- Usulan: laporan "APPROVED tanpa tautan" + lanjutkan (klaim aman via sourceRef expense:id; rilis pakai id request sebagai idempotency key). Dampak 3, effort S-M.

#### PPA-10 BI/FLW: rilis HQ membayar saldo saat approve (bukan nominal yang dilihat); bankAccountRef request mati
- releaseForOwner = saldo penuh [LEGACY-CLAIM payout.service.ts:317-320]; amountAtRequest hanya disimpan [LEGACY-CLAIM schema.prisma:86-89]; bankAccountRef request tak dipakai [LEGACY-CLAIM hq-release.service.ts:77; payout.dto.ts:58-73], docstring menyesatkan.
- Usulan: bayar min(saldo, amountAtRequest); hapus field mati. Dampak 2-3, effort S.

#### PPA-11 AUT: klaim biaya auto-approve tanpa batas frekuensi; "struk" = gambar apa pun diunggah sekali
- Syarat: jumlah<=ambang(50rb)+URL pod/uuid.img+objek ada+belum dipakai [LEGACY-CLAIM expense-claim.service.ts:83-90,226-242; domain/expense-claim.ts:19-21]. Tak ada batas per kurir/hari; tak pernah ditinjau. Delta atas CA-4-02 (fixed): kontrol mencegah ketikan URL, bukan volume.
- Usulan: batas N/hari/kurir -> peninjau. Dampak 3, effort S. [INFERRED: rute unggah struk memakai prefix pod, lihat unresolved]

#### PPA-12 FLW: Idempotency-Key opsional/lemah; payment.initiate tanpa kunci
- Header opsional [LEGACY-CLAIM payout.controller.ts:75; courier-payout.controller.ts:103]; tanpa kunci dua withdraw lolos [LEGACY-CLAIM test/race/payout.race.ts:154-155]; replay beda jumlah mengembalikan yang pertama [LEGACY-CLAIM withdrawal.prisma.repository.ts:67-79]; initiate retry -> 409 bukan payment sama [LEGACY-CLAIM payment.service.ts:248-251].
- Usulan: wajibkan/derive kunci, 409 bila jumlah beda, kembalikan payment aktif milik sama. Dampak 2, effort S.

#### PPA-13 BI: revenue per metode memfilter PAID menurut createdAt, bukan paidAt
- [LEGACY-CLAIM payment.prisma.repository.ts:374-390] vs kas depot paidAt [LEGACY-CLAIM payment.prisma.repository.ts:433-456]. Dipakai revenue-by-method & internal/export-rows. Usulan: paidAt. Dampak 2-3, effort S.

#### PPA-14 FTR: kontrak gateway/webhook belum matang (dorman; bereskan sebelum EWALLET/VA aktif)
- Webhook bertanda tangan tanpa nominal & nominal tak dicek [LEGACY-CLAIM payment.service.ts:1365-1392; payment.dto.ts:268-296]; findByReference findFirst tanpa indeks/unik [LEGACY-CLAIM payment.prisma.repository.ts:209-212; schema.prisma:112-118]; refund claim-first lalu revert tanpa Idempotency-Key ke penyedia, timeout 8 dtk [LEGACY-CLAIM payment.service.ts:1308-1338; payment-gateway.http.adapter.ts:57-83]; charge timeout -> FAILED [LEGACY-CLAIM payment.service.ts:345-352]; tanpa rekonsiliasi penyedia. Status: STUB. Dampak 2 sekarang/4 saat aktif, effort L.

#### PPA-15 FLW: pencairan manual; HQ tak bisa membaca nomor rekening terverifikasi via API / ekspor batch
- Ledger hanya masked [LEGACY-CLAIM domain/bank-account.ts:9-13]; rute HQ rekening hanya listByStatus('PENDING') [LEGACY-CLAIM hq-payout.controller.ts:62-68]. Nomor lengkap setelah VERIFIED harus diambil di luar sistem. Status: MANUAL.
- Usulan: endpoint baca terautentikasi+audit atau SOP resmi; ekspor batch. Dampak 3, effort M. [ASSUMPTION] tanyakan cara Finance mendapat nomor hari ini.

#### PPA-16 AUT/PDP: nomor rekening polos, tanpa retensi
- accountNumber TEXT polos [LEGACY-CLAIM schema.prisma:57-60], dikembalikan tak tertopeng [LEGACY-CLAIM payout.dto.ts:267-281]; tak ada purge, sementara bukti transfer punya engine retensi [LEGACY-CLAIM payment-proof-retention.service.ts:26-69]. Tak ada verifikasi nama ke bank.
- Usulan: enkripsi kolom + retensi. Dampak 2-3, effort M.

#### PPA-17 BI: saldo < minimum penarikan tak bisa dicairkan, tanpa jalur penutupan
- Ditolak di [LEGACY-CLAIM payout.service.ts:342-345; hq-release.service.ts:49-51; env.validation.ts:37]; koreksi hanya "manual SQL" [LEGACY-CLAIM payout.service.ts:104-105]. Dampak 1-2, effort S/kebijakan.



### Arsip wilayah promo-loyalty-product-dashboard

Provenance: `agents/promo-loyalty-product-dashboard/findings.md`.

#### Temuan: promo / loyalty / product / dashboard (HEAD 1e93545a2)
Tingkat bukti: STATIC. RUNTIME tidak mungkin. Path relatif ke services/ kecuali disebut.
Tiap temuan: masalah+bukti | kontrol ada | usulan | dampak | effort | risiko | dependensi | acceptance | verifikasi | owner | bila ditunda

#### PLP-01 (FLW) Voucher tidak dikembalikan saat order online CANCELLED
- Masalah: promo.release() hanya dipanggil di order.service.ts:1435 (void walk-in) dan :2652 (checkout gagal). Jalur cancel() pelanggan (:1984-2025) dan pembatalan staf (:3106-3120) hanya menulis outbox PAYMENT_REVERSAL + releaseStock [LEGACY-CLAIM order-service/src/application/services/order.service.ts:1435,2652,1984-2025,3106-3120]. usedCount, perCustomerLimit, budgetCap tetap terbakar untuk order batal. Endpoint release sudah idempoten [LEGACY-CLAIM promo-service/src/infrastructure/prisma/voucher.prisma.repository.ts:375-411].
- Kontrol ada: release idempoten + releasedAt (PRM-8). Tidak ditemukan di CONSOLE/SECURITY register (grep voucher+batal/release hanya CA-2-65, PRM-3).
- [ASSUMPTION] Apakah voucher hangus saat pelanggan batal memang kebijakan? Tanya pemilik.
- Usulan: putuskan kebijakan; bila dikembalikan, panggil release di kedua jalur cancel (fail-open seperti void).
- Dampak 4 | effort S | risiko rendah | dependensi order-service | owner PO + backend order.
- Acceptance: order CANCELLED -> redemption.releasedAt terisi, usedCount turun. Verifikasi: tes unit cancel memanggil promo.release; bandingkan burn-summary.
- Ditunda: voucher perCustomerLimit=1 hangus oleh order batal; budget kampanye menyusut palsu.

#### PLP-02 (BI) PromoApplication tanpa reversal; biaya promo otomatis menghitung order batal/void
- PromoApplication tanpa releasedAt/status [LEGACY-CLAIM promo-service/prisma/schema.prisma model PromoApplication]. usageByRule, recentOrdersByRule, applicationsInWindow (laporan PROMO_COST) tidak menyaring order batal [LEGACY-CLAIM promo-service/src/infrastructure/prisma/promo-rule.prisma.repository.ts:72-152]. PromoRuleController hanya quote/apply, tanpa release [LEGACY-CLAIM promo-service/src/modules/promo-rule.controller.ts:282-335]. Voucher punya PRM-8, rule tidak.
- Usulan: kolom releasedAt + endpoint internal release dipanggil bersama PLP-01; agregasi releasedAt IS NULL. Dampak 3 | effort M | risiko migrasi aditif | owner backend promo. Acceptance: biaya per rule turun setelah void. Verifikasi: tes repo. Ditunda: usage dan PROMO_COST menggelembung.

#### PLP-03 (BI) Analitik voucher/promosi menghitung redemption yang sudah di-release
- redemptionAnalytics (aggregate, count window, daily raw SQL, groupBy top customer, orderIds) tanpa releasedAt null [LEGACY-CLAIM voucher.prisma.repository.ts:225-293]; pembaca lain memfilter (:135-173,:195). findRedemptionsFor (:217) juga. Dipakai PromotionService.analytics (promotion.service.ts:128-178): totalUses, totalSavingsIdr, topCustomers, affectedOrders membengkak; tak konsisten dengan burnSummary.
- Usulan: tambah filter di 5 query. Dampak 3 | effort S | owner backend promo. Acceptance: analytics sama dengan burn-summary untuk voucher yang sama. Verifikasi: tes dengan satu redemption released.

#### PLP-04 (AUT) voucherWrite/promotionWrite memuat MANAGER (terikat depot) tanpa cek kepemilikan pada update/deactivate/grant
- voucherWrite = MARKETING, MANAGER, SUPER_ADMIN [LEGACY-CLAIM packages/access/src/index.ts:153]; MANAGER depot-scoped [LEGACY-CLAIM packages/platform/src/nest/depot-scope.ts DEPOT_SCOPED_ROLES]. PATCH/DELETE/POST :id/grant hanya @Can(voucherWrite) + id, tanpa assertDepotAccess ke voucher.depotId [LEGACY-CLAIM promo-service/src/modules/voucher.controller.ts:226-310]; DepotScopeGuard hanya memeriksa param/query/body depotId, bukan id voucher [LEGACY-CLAIM packages/platform/src/nest/depot-scope.guard.ts requestedDepotIds]. Browse dan burn-summary sudah disaring depot (:83-105), tulis tidak. MANAGER depot A dapat mengubah value/budgetCap, menonaktifkan, atau grant voucher jaringan/depot lain. Create tanpa depotId, jadi voucher buatan MANAGER jaringan-luas.
- [ASSUMPTION] Apakah MANAGER memang dimaksud menulis voucher jaringan (keputusan PRM-1)? Tanya pemilik.
- Promotion banner: promotionWrite memuat MANAGER, model tanpa depotId [INFERRED banner global dapat diubah manager depot].
- Usulan: tolak write pada voucher depotId null / bukan miliknya untuk peran terikat depot, atau keluarkan MANAGER dari voucherWrite. Dampak 4 | effort S-M | owner PO + backend. Acceptance: MANAGER A dapat 403 pada voucher depot B/jaringan.

#### PLP-05 (BI) KPI redeemedThisMonth loyalty menghitung penukaran yang dibatalkan
- sumRedeemedSince menjumlah pointsSpent semua rewardRedemption sejak awal bulan tanpa filter status [LEGACY-CLAIM loyalty-service/src/infrastructure/prisma/loyalty.prisma.repository.ts:122-129]; CANCELLED mengembalikan poin (reward.prisma.repository.ts:217-247). Usulan: status bukan CANCELLED. Dampak 2 | effort S | owner backend loyalty.

#### PLP-06 (FLW) Kedaluwarsa poin: klaim lot tidak atomik dengan debit; lot bukan FIFO
- recordExpiry: updateMany expired=true lalu transaksi terpisah (EXPIRE + debit) [LEGACY-CLAIM loyalty.prisma.repository.ts:329-357]; kegagalan di antaranya meninggalkan lot expired tanpa debit dan tanpa retry. Tidak ada konsumsi lot saat REDEEM/ADJUST; kedaluwarsa dibatasi saldo (loyalty.service.ts:407) sehingga bisa mengambil poin lot lebih baru [LEGACY-CLAIM loyalty.service.ts:385-416]. Sweep default MATI (pointExpirySweepEnabled envDefault 0, config/setting-defs.ts) sehingga belum berdampak; berdampak saat dinyalakan. Endpoint publik rules menyatakan masa berlaku (loyalty.controller.ts:76-82) [INFERRED menyesatkan selama sweep mati].
- Usulan: satu transaksi claim+debit; putuskan model FIFO/sisa-lot sebelum sweep dinyalakan. Dampak 3 (saat aktif) | effort M | owner PO + backend.

#### PLP-07 (FLW) Reversal earn bisa mendebit ganda bila lot sudah kedaluwarsa; ledger menyimpang dari saldo
- recordReversal mendebit earn.points penuh (GREATEST 0) tanpa memeriksa expired lot [LEGACY-CLAIM loyalty.prisma.repository.ts:273-312; findEarnByOrder :131 tak menyaring expired]. GREATEST pada reversal/expiry membuat jumlah ledger tidak sama dengan pointsBalance (header schema: balance = sum ledger). Job rekonsiliasi belum ditemukan dalam cakupan (SEARCH-PLP-03). Dampak 2 | effort M. Verifikasi: tes void order setelah sweep.

#### PLP-08 (FLW) Cancel redemption: race memunculkan P2025 mentah (500)
- RewardPrismaRepository.cancel: update where status ACTIVE dalam transaksi tanpa catch P2025 [LEGACY-CLAIM reward.prisma.repository.ts:217-247]; service hanya pre-check (reward.service.ts:140-141). Tidak ada double refund, tetapi yang kalah mendapat 500. Usulan: petakan ke RewardAlreadyCancelled/Used. Dampak 2 | effort S.

#### PLP-09 (FTR) Hadiah tidak otomatis menjadi manfaat; redemption ACTIVE tak pernah kedaluwarsa
- Seed hadiah Voucher Rp 25.000 dan Gratis Ongkir (loyalty-service/prisma/seed.ts) tetapi tidak ada pemanggilan grant ke promo-service di loyalty src [belum ditemukan dalam cakupan loyalty-service, SEARCH-PLP-04]; pemenuhan manual via rewardHandover (reward.controller.ts:154-167). Redemption ACTIVE tanpa batas waktu menahan stok sampai pelanggan membatalkan [belum ditemukan kedaluwarsa otomatis, SEARCH-PLP-05].
- [ASSUMPTION] Apakah hadiah memang diserahkan manual semua? Dampak 3 | effort M-L | owner PO.

#### PLP-10 (FLW) adjustMaxPoints per-depot tidak pernah berlaku
- adjust memanggil adjustMaxPoints(null) [LEGACY-CLAIM loyalty.service.ts:303]; kunci tidak global dan hanya HQ boleh set (settings.controller.ts:26-31); override depot mati. Dampak 1 | effort S.

#### PLP-11 (BI) Dashboard: asimetri capability dan fan-out N+1
- /dashboard/network-pnl dan /monthly-pnl hanya @Can(dashboard) (termasuk SUPERVISOR, ASSISTANT_SUPERVISOR) sementara executive/network butuh dashboardFinance [LEGACY-CLAIM dashboard.controller.ts:19,36,51-84; packages/access/src/index.ts:53-60,619-627]. Isi network-pnl: gaji bruto, komisi kurir, klaim biaya per depot ter-scope [LEGACY-CLAIM dashboard.service.ts:342-448]. [ASSUMPTION] apakah supervisor boleh melihat payroll depot? monthly-pnl bergantung DepotScopeGuard pada query depotId [INFERRED].
- Fan-out: network() satu lowStock per depot (:499-502), networkPnl 2N panggilan tanpa batas konkurensi (:358-364), timeout 5 s, allDepots hanya 100 (adapter:187-194). franchise tak memakai pola null E-3 (revenue 0 saat order unavailable, :611-624). Dampak 2 | effort M.

#### PLP-12 (FTR) Validasi/dead code kecil
- Voucher.validFrom lebih besar dari validUntil tidak divalidasi (rule promo punya, promo-rule.service.ts:452) [LEGACY-CLAIM voucher.service.ts tidak memuatnya]. Model VoucherRequest tidak dipakai kode src mana pun (route dihapus CA-2-42) [LEGACY-CLAIM grep src]. GET public /products/batch tanpa batas jumlah id dan tanpa validasi UUID, kolom uuid (product.controller.ts:61-72) [INFERRED 500/query besar]. deactivate produk tak diaudit (product.service.ts:174-179). Notifikasi stok gagal tak direkonsiliasi (stock-notifier.http.adapter.ts). classifyVoucherStatus mengabaikan budgetCap habis [LEGACY-CLAIM domain/voucher.ts:107-120]. Dampak 1-2 | effort S.

#### Kontrol yang sudah ada (tidak diulang)
Idempotensi redeem (FOR UPDATE + unique orderId), audience GRANTED, preview publik minimal (PRM-7), assertFresh, audit harga (PRD-1), unique idempotencyKey reward/earn, cap adjust (LOY-2), HQ-only settings (LOY-5), P&L null-bukan-nol (CA-2-59).

#### ADENDUM verifikasi lanjutan
#### PLP-01 FINAL (tetap terbuka)
- Handler outbox PAYMENT_REVERSAL = reversePayment -> paymentReversal.cancelForOrder saja, tanpa voucher/poin [LEGACY-CLAIM order-service/src/application/services/order.service.ts:344,363-368; outbox.service.ts:140-209]. Tidak ada jalur lain memanggil promo.release (grep seluruh order-service/src: hanya :1435 dan :2652). Jadi PLP-01 final: voucher online batal tidak pernah dikembalikan oleh kode; yang tersisa hanya keputusan kebijakan [ASSUMPTION].
#### PLP-13 (BI) network-pnl berpotensi menghitung refund dua kali (laba bersih terlalu rendah)
- Pendapatan per depot = jumlah total order yang countsAsSale, yaitu semua status KECUALI CANCELLED dan VOIDED [LEGACY-CLAIM order-service/src/application/services/report.service.ts:432-434,1324,1338]. Refund = SUM(refundedAmount) pembayaran berstatus REFUNDED pada jendela refundedAt, tanpa menyaring apakah order-nya masih dihitung sebagai penjualan [LEGACY-CLAIM payment-service/src/infrastructure/prisma/payment.prisma.repository.ts:251-272]. networkPnl lalu mengurangi refundIdr dari pendapatan [LEGACY-CLAIM dashboard.service.ts:392-397]. Refund atas order CANCELLED/VOIDED sudah tidak ada di pendapatan, jadi pengurangannya menghitung ganda; refund atas order selesai (retur) memang benar dikurangkan. Jendela waktu juga berbeda (createdAt order vs refundedAt). Proporsi refund-order-batal [ASSUMPTION], perlu data.
- Usulan: kurangkan hanya refund dari order yang masih countsAsSale, atau jangan kurangi refund order batal. Dampak 3 | effort M | lintas order/payment/dashboard | owner backend + finance. Acceptance: depot dengan satu order batal berrefund menghasilkan laba tidak berubah oleh refund tsb. Verifikasi: tes network-pnl dengan fixture order batal + refund.
#### PLP-11 pembaruan
- depot-monthly dipanggil dashboard dengan x-internal-key, diterima sebagai SUPER_ADMIN [LEGACY-CLAIM packages/platform/src/nest/jwt-auth.guard.ts:41-47; report.controller.ts:402-412]; revenue = total order bukan batal/void (lihat PLP-13). Cakupan P&L: COGS (PO supplier) per periode vs revenue per order = campuran basis kas dan akrual [INFERRED]; sudah dinyatakan sebagai laporan manajemen (disclaimer).
#### Tambahan PLP-12 (hasil baca file UNREAD)
- Promotion.ctaHref/imageUrl string bebas (MaxLength 2048) tanpa validasi skema URL, dirender di Home pelanggan [LEGACY-CLAIM promo-service/src/modules/dto/promotion.dto.ts CreatePromotionDto]; risiko skema javascript: tergantung render web [ASSUMPTION; cek apps/web]. voucherCode di Promotion tidak diperiksa ada/tidaknya [LEGACY-CLAIM promotion.service.ts create].
- listRedemptionsByCustomer dan listRedemptionsByStatus (antrean serah-terima) tanpa take/paging [LEGACY-CLAIM loyalty-service/src/infrastructure/prisma/reward.prisma.repository.ts:162-186]. listForCustomer vouchers semua PUBLIC aktif tanpa batas [LEGACY-CLAIM voucher.prisma.repository.ts:175-210].
- RedeemRewardDto.depotId hanya IsUUID: depot sembarang/tidak ada membuat redemption tanpa pelayan, kecuali dibatalkan pelanggan [LEGACY-CLAIM loyalty-service/src/modules/dto/reward.dto.ts; reward.service.ts redeem tidak memvalidasi depot] (menambah PLP-09).
- Category.update: assertFresh membaca dulu lalu update tanpa where updatedAt (TOCTOU), tidak seperti product/voucher [LEGACY-CLAIM product-service category.service.ts update + category.prisma.repository.ts:34-36].
- Category nonaktif tidak memblokir/menyembunyikan produk aktif miliknya [INFERRED, product query hanya memfilter product.active].

#### ADENDUM putaran 3 (6 file DTO/controller dibaca utuh + 32 file bootstrap dibaca utuh)
- Koreksi PLP-12: daftar tanpa take TIDAK tanpa batas. PrismaService semua service memasang loggedQueryBounds: findMany tanpa take dipotong ke 500 baris, hanya log warn [LEGACY-CLAIM packages/platform/src/nest/query-bounds.ts DEFAULT_MAX_ROWS=500; promo/loyalty/product prisma.service.ts onModuleInit]. Dampak nyata: antrean serah-terima hadiah (reward.prisma.repository.ts:171-186, urut createdAt asc) bila >500 ACTIVE, yang terbaru tidak tampil tanpa tanda; findActiveCandidates promo (promo-rule.prisma.repository.ts:154) memotong diam-diam bila >500 rule aktif sehingga rule bisa tidak berlaku; dashboard tidak memakai Prisma. Dampak 2 saat ambang tercapai, effort S (paging atau tanda truncated).
- PLP-14 (FTR) Import produk melonggarkan validasi: ImportProductRowDto.basePrice @Min(0) dan volumeMl @Min(0) [LEGACY-CLAIM product-service/src/modules/dto/product.dto.ts:175,178], sedangkan CreateProductDto mewajibkan IsPositive (:109-113). Produk berharga 0 bisa masuk via import dan tidak tercatat di jejak harga (import hanya membuat). DTO respons menyebut status 'updated' padahal importer tidak pernah update. Dampak 2 | effort S.
- QuoteVoucherDto.depotId hanya IsString, bukan IsUUID [LEGACY-CLAIM voucher.dto.ts:274-277]; nilai non-UUID hanya membuat voucher depot-scoped ditolak, tidak berbahaya. Dampak 1.
- Konfirmasi tanpa temuan baru: RewardPointsDto idempotencyKey opsional (loyalty.dto.ts:134-141) sehingga reward tanpa key tidak idempoten, tanggung jawab pemanggil; upload.controller/product storage memakai sniff byte (H-20); health dashboard hanya liveness tanpa cek dependensi [LEGACY-CLAIM dashboard-service/src/modules/health.controller.ts]; product main hanya melayani /uploads statis di non-production.



### Arsip wilayah services-admin-service

Provenance: `agents/services-admin-service/findings.md`.

#### Temuan audit services/admin-service (HEAD 1e93545a2) - STATIC, tanpa runtime

Cakupan: admin-service TIDAK memiliki waralaba, royalti, settlement, dispute, approval/override (lihat handoff.md). Dimiliki: feature flag, setting, API key, webhook, export log, laporan terjadwal, tiket CS, fraud flag, insiden, SLA/retensi/security policy, sweep monitor. Kontrol sudah ada dan dicek (tidak diulang): CA-2-05, ADM-1/2/5/6/7/8/9, CA-2-37/53/58/66/67, K1.5, lease klaim webhook/laporan, unique parsial fraud.
Path relatif services/admin-service/ kecuali disebut lain. Format: Area | Masalah+bukti | Kontrol ada | Usulan | Dampak/Effort | Dependensi | Acceptance | Verifikasi | Owner | Bila ditunda.

#### AAS-01 Blokir akun vs clear flag lain dapat saling menimpa [FLW, dampak 3, effort M]
- clear memegang advisory lock per entitas dan menghitung flag BLOCKED lain [LEGACY-CLAIM src/infrastructure/prisma/fraud-flag.prisma.repository.ts:73,76-80]; block tidak memakai lock, memanggil setActive(false) dulu lalu menandai status [LEGACY-CLAIM src/application/services/fraud-flag.service.ts:50-56]. Clear flag B di sela suspend dan commit status BLOCKED flag A menghitung 0 penahan lalu mengaktifkan akun [INFERRED dari dua baris itu; interleaving tidak diuji].
- Hitungan penahan memakai status=BLOCKED, padahal flag yang di-REVIEWED setelah block tetap punya blockedAt [LEGACY-CLAIM fraud-flag.prisma.repository.ts:76-80 vs setStatus :103-120]; clear flag B melepas akun yang masih ditahan A.
- Kontrol ada: lock di clear, blockedAt, rollback status bila reinstate gagal.
- Usulan: block ikut transaksi+lock sama; penahan = blockedAt non-null dan status != CLEARED. Dependensi: auth-service setActive.
- Acceptance: block A, review A, clear B tidak mengaktifkan akun; test di test/race. Verifikasi: jest.race (di luar audit). Owner: BE admin. Bila ditunda: akun terblokir bisa aktif lagi tanpa tanda di antrian.

#### AAS-02 Scan fraud memunculkan lagi pelanggan yang sudah CLEARED [FLW/BI, dampak 3, effort S]
- Dedup hanya terhadap status OPEN [LEGACY-CLAIM src/application/services/fraud-scan.service.ts:68-77]; jendela refund bergulir 30 hari, jadi pelanggan yang sudah diputuskan bukan fraud muncul OPEN lagi dengan signal sama [INFERRED dari :54-57,68-77].
- Kontrol ada: unique parsial 1 OPEN per entitas (migrasi 20261030100000), FraudFlagAlreadyOpenError.
- Usulan: tekan flag baru bila ada CLEARED/REVIEWED dengan refund tak bertambah. Acceptance: pelanggan CLEARED tanpa refund baru tidak dibuat ulang. KPI-candidate fraud_flags.status. Owner: produk risiko. Bila ditunda: antrian terisi ulang, keputusan manusia terbuang.

#### AAS-03 Transisi status fraud tanpa guard [FLW, dampak 2, effort S]
- setStatus menulis status apa pun dari status apa pun [LEGACY-CLAIM fraud-flag.prisma.repository.ts:103-120]; block pada CLEARED menangguhkan lagi; clear kedua menjalankan reinstate lagi karena blockedAt masih terisi [LEGACY-CLAIM fraud-flag.service.ts:50-56; repository clear :80-88], dapat membuka akun yang ditangguhkan jalur lain [INFERRED].
- Usulan: tabel transisi eksplisit, 409 untuk selainnya. Acceptance: clear kedua = no-op tanpa panggilan auth. Owner: BE admin.

#### AAS-04 Penerima laporan terjadwal tak divalidasi; otorisasi dataset kasar [AUT, dampak 4, effort M]
- recipients hanya IsString+MaxLength 200, tanpa IsEmail, tanpa batas jumlah, tanpa allowlist domain [LEGACY-CLAIM src/modules/dto/scheduled-report.dto.ts:31-36,72-78]. Controller hanya dijaga hqBackOffice [LEGACY-CLAIM src/modules/scheduled-reports.controller.ts, dekorator kelas], padahal dataset mencakup ORDERS_DETAIL, KASBON_BALANCE (hr-service), COD_UNSETTLED [LEGACY-CLAIM src/domain/report-dataset.ts:10-22; src/infrastructure/http/report-source.http.adapter.ts:40-52]. Satu peran back-office dapat mengirim dataset berkapabilitas lebih sempit ke alamat eksternal secara berkala.
- Kontrol ada: audit mutasi (lihat AAS-09), SMTP opsional.
- Usulan: IsEmail+ArrayMaxSize, allowlist domain via konfigurasi, cek kapabilitas per dataset. [ASSUMPTION] Apakah kapabilitas per dataset harus lebih sempit dari hqBackOffice? Tanya pemilik produk.
- Acceptance: recipient non-email/di luar allowlist 400; peran tanpa kapabilitas dataset 403. Verifikasi: unit test DTO+controller. Owner: security/BE. Bila ditunda: jalur eksfiltrasi data terjadwal lewat akun HQ yang dibobol.

#### AAS-05 Run laporan dicatat sukses walau email gagal atau data terpotong [FLW/BI, dampak 3, effort S]
- Hasil mailer.send diabaikan [LEGACY-CLAIM src/application/services/scheduled-report-runner.service.ts:122-124] lalu run dicatat ok [:125]; SMTP tak terkonfigurasi hanya mengembalikan false [LEGACY-CLAIM src/infrastructure/mail/smtp-report-mailer.ts, cabang tanpa smtp]. Terpotong hanya menjadi baris catatan di file, status tetap OK [LEGACY-CLAIM report-source.http.adapter.ts:88-91,121-126]. Bila logs.create di cabang catch melempar, schedule tidak di-update dan baru coba lagi setelah lease 15 menit [LEGACY-CLAIM runner:79-93,126-137; akibat INFERRED].
- Usulan: simpan status kirim (terkirim/dilewati/gagal) dan flag truncated; tampilkan di /hq/exports. Acceptance: SMTP mati terlihat di lastError/status. Owner: BE admin.

#### AAS-06 Perbandingan periode lalu mengabaikan truncation dan mencocokkan per nama [BI, dampak 2, effort S]
- before.truncated dibuang, hanya before.rows [LEGACY-CLAIM report-source.http.adapter.ts:111-112]; baris dicocokkan per label [LEGACY-CLAIM src/domain/report-table.ts:50-51,69], dua depot bernama sama menyatu [INFERRED]. Usulan: gagalkan/beri catatan bila previous terpotong; cocokkan per id. Owner: BE admin.

#### AAS-07 CSV merusak angka negatif [BI, dampak 3, effort S]
- csvCell memberi tanda kutip tunggal di depan nilai berawalan minus, termasuk bertipe number, dipakai untuk semua sel [LEGACY-CLAIM src/domain/report-file.ts:56-59,204]. Kolom delta/saldo negatif menjadi teks; SUM rusak. Tidak ada test untuk csvCell/renderTable [LEGACY-CLAIM grep test/ nihil, SEARCH-ADM-07].
- Usulan: sanitasi hanya string. Acceptance: angka -5 tetap -5; teks berawalan = tetap dinetralkan. Owner: BE admin.

#### AAS-08 Retensi tidak mencakup tabel milik admin-service sendiri [AUT/PDP, dampak 4, effort M]
- Executor hanya remote untuk 10 dataset [LEGACY-CLAIM src/infrastructure/http/purge-executor.registry.ts:21-107]; migrasi retensi tidak memuat export_logs, webhook_deliveries, support_tickets/ticket_messages, fraud_flags, incidents [LEGACY-CLAIM grep INSERT retention_policies pada migrasi, SEARCH-ADM-03]. Komentar skema menyatakan export_logs ditrim retention purge [LEGACY-CLAIM prisma/schema.prisma:203-205], tidak ada di kode. export_logs menyimpan file laporan (bytes); webhook_deliveries menyimpan payload utuh; tiket menyimpan nama/telepon dan hanya terhapus saat erasure per orang [LEGACY-CLAIM src/modules/support-tickets.controller.ts internal/pdp-anonymise].
- Usulan: policy+executor lokal; window diputuskan pemilik [ASSUMPTION: tidak ada keputusan tertulis ditemukan]. Bila ditunda: DB tumbuh tak terbatas dan data personal tersimpan melebihi janji kebijakan privasi.

#### AAS-09 Jejak audit kehilangan isi array dan nilai sebelum/sesudah [AUT, dampak 3, effort M]
- redactBody mengganti array dengan ringkasan jumlah item dan objek dengan [object] [LEGACY-CLAIM packages/platform/src/nest/audit-mutations.interceptor.ts:82-85]. Entri audit pembuatan API key (scopes), PUT security policy (ipAllowlist), laporan terjadwal (recipients), webhook (events) tak memuat nilainya [LEGACY-CLAIM src/modules/dto/api-key.dto.ts:21, security-policy.dto.ts:45, scheduled-report.dto.ts:36]. Tidak ada nilai sebelumnya. Sink fail-open dan fire-and-forget [LEGACY-CLAIM interceptor.ts:145-153; src/infrastructure/http/audit.sink.ts]. Kontrol ada: actor, target, success, error (cukup untuk siapa, tidak untuk apa persisnya).
- Usulan: simpan array pendek non-rahasia dan snapshot sebelum untuk singleton policy. Lintas service (handoff). Owner: platform.

#### AAS-10 Flag publik: BETA/ROLLOUT dibaca aktif untuk semua [FTR, dampak 3, effort S]
- enabled = state bukan OFF [LEGACY-CLAIM src/modules/feature-flags.controller.ts:43]; rolloutPct tidak diteruskan dan tidak dibaca di admin-service [LEGACY-CLAIM schema.prisma:41; grep cakupan]. BETA/ROLLOUT 25% tampil ON bagi semua [INFERRED; konsumen tidak dibuka]. [ASSUMPTION] Apakah flag ENFORCED_FLAG_KEYS (src/domain/flag-state.ts:12-16) pernah di state selain ACTIVE/OFF di produksi? Update flag tanpa guard stale-write [LEGACY-CLAIM src/application/services/feature-flag.service.ts:26-30].
- Usulan: kontrak eksplisit per state atau larang BETA/ROLLOUT untuk flag enforced. Acceptance: test publik per state.

#### AAS-11 Event webhook tanpa kunci idempotensi; publisher fail-open [FLW, dampak 3, effort M]
- publish selalu membuat delivery baru, event tanpa id [LEGACY-CLAIM src/application/services/webhook-dispatch.service.ts:63-76]. Produser ditemukan: delivery-service, inline, gagal hanya log [LEGACY-CLAIM services/delivery-service/src/infrastructure/http/event-publisher.http.adapter.ts:21-38]. Admin down = event hilang; retry produser = duplikat. Produser lain belum ditemukan dalam cakupan (SEARCH-ADM-05).
- Usulan: eventId dari produser + unique(endpointId,eventId); outbox di produser (handoff).

#### AAS-12 Tiket CS satu arah, tanpa metrik, tanpa idempotensi [FTR/FLW/BI, dampak 3, effort L]
- Pelanggan hanya create/list; tak ada balasan pelanggan [LEGACY-CLAIM src/modules/customer-support.controller.ts hanya GET/POST; authorType CUSTOMER hanya saat create, src/infrastructure/prisma/support-ticket.prisma.repository.ts:100]. Notifikasi balasan staf ke pelanggan belum ditemukan dalam cakupan services/admin-service/src (SEARCH-ADM-04). Tak ada resolvedAt/firstResponseAt/resolvedBy [LEGACY-CLAIM schema.prisma:305-345], MTTR tak terhitung. from-depot tak idempoten dan depot dapat mengirim ulang [LEGACY-CLAIM services/depot-service/src/infrastructure/http/hq-complaint.http.adapter.ts:23-47]. orderRef pelanggan tak diverifikasi miliknya [LEGACY-CLAIM customer-support.controller.ts:71]. Resolve tanpa guard asal-status [LEGACY-CLAIM support-ticket.prisma.repository.ts:178-186].
- Satu-satunya jalur dispute pelanggan di cakupan; tak terkait refund. [ASSUMPTION] Apakah pelanggan wajib bisa membalas dan siapa mengirim notifikasi?

#### AAS-13 Guard stale-write tidak atomik; sebagian mutasi tanpa guard [FLW, dampak 2, effort S]
- assertFresh(get()) lalu upsert tanpa WHERE updatedAt [LEGACY-CLAIM src/application/services/retention.service.ts:57-69; security-policy.service.ts:51-52; sla-policy.service.ts:39-40]; platform mengakui batas ms [LEGACY-CLAIM packages/platform/src/domain/stale-write.ts]. SystemSettings tanpa guard [LEGACY-CLAIM system-settings.service.ts:33-35]. Usulan: updateMany WHERE updatedAt=seen.

#### AAS-14 Aksi berisiko tinggi tanpa persetujuan kedua [AUT, dampak 3, effort L] - ASSUMPTION
- POST /retention/purge, cabut API key, ubah ipAllowlist/2FA, ubah window retensi dijalankan satu aktor platformAdmin [LEGACY-CLAIM src/modules/retention.controller.ts, api-keys.controller.ts, security-policy.controller.ts: tanpa workflow persetujuan, hanya audit]. [ASSUMPTION] Apakah pemilik mewajibkan four-eyes? Tidak ada keputusan tertulis ditemukan; bila tidak, tutup sebagai accepted-risk.

#### AAS-15 Webhook: jendela DNS rebinding sisa dan replay tanpa batas [AUT, dampak 2, effort M]
- Validasi me-resolve lalu fetch me-resolve ulang [LEGACY-CLAIM src/domain/safe-webhook-url.ts:80-92 vs webhook-dispatch.service.ts:160-169]; ADM-1 sudah ada, ini sisa celahnya. Replay mitra mereset attempts tanpa batas selain throttle global [LEGACY-CLAIM src/infrastructure/prisma/webhook-delivery.prisma.repository.ts:155-169]. Usulan: pin IP hasil lookup; batas replay.

#### AAS-16 Unduh ekspor tidak diaudit; entri ekspor browser dipercaya dari klien [AUT, dampak 2, effort S]
- GET download tak tercatat dan setiap hqBackOffice dapat mengunduh ekspor mana pun [LEGACY-CLAIM src/modules/export-logs.controller.ts:78-90; interceptor.ts:122 mengabaikan GET]. record() menerima dataset/rowCount dari klien [LEGACY-CLAIM export-logs.controller.ts:100-118] sehingga log bukan bukti. Usulan: audit unduhan; tandai entri klien CLIENT_REPORTED.



### Arsip wilayah services-delivery-service

Provenance: `agents/services-delivery-service/findings.md`.

#### services/delivery-service — temuan (HEAD 1e93545a2; STATIC, WIRED untuk DLV-03; RUNTIME tidak mungkin)

Ledger: 192 entri = 183 READ (70 FULL-READ, 113 STRUCTURED-SCAN) + 9 SKIPPED (tooling/config); BLOCKED 0, UNREAD 0. Path relatif ke services/delivery-service/ kecuali disebut.

Kontrol yang sudah ada dan efektif (bukan temuan): advisory lock kapasitas per kurir; unique orderId/shiftId + satu shift terbuka per kurir; CAS status (StaleDeliveryStatusError); proof ditulis sebelum order digeser; replay idempoten complete/fail/no-show/reschedule; pembalikan tunai gagal mengembalikan status; setoran fail-closed; pembebanan selisih butuh dua orang; jarak PoD selalu diukur.

| ID | Area | Judul | Dampak | Effort |
|---|---|---|---|---|
| DLV-01 | FLW | Replay reschedule tidak memperbaiki hand-back order ke PREPARING | 4 | S |
| DLV-02 | BI | Reassign RESCHEDULED tidak reset assignedAt/slaAlertedAt (SLA dan bonus on-time salah) | 4 | S |
| DLV-03 | FLW | Controller assign membuang customerId dan deliveryWindow | 3 | S |
| DLV-04 | AUT/BI | Assign tidak mencocokkan depot shift kurir dengan depot order | 3 | S |
| DLV-05 | BI | Auto-close shift basi: delivery di luar jendela setoran | 4 | M |
| DLV-06 | FLW | cancelByStaff/releaseByStaff: urutan salah, tanpa replay/tunai | 3 | M |
| DLV-07 | FLW | Penutupan order/earning/event pasca-PoD fail-open tanpa perbaikan | 4 | M |
| DLV-08 | AUT | photoUrl/signatureUrl PoD tak terikat berkas unggahan | 3 | S |
| DLV-09 | FTR | Syarat bearer usang: laporan COD kehilangan data tunai gagal/reschedule | 2 | S |
| DLV-10 | BI | Kurir dapat memfailkan order sepihak, alasan bebas, tanpa review | 3 | M |
| DLV-11 | FLW | pickup/start geser order sebelum status lokal, tanpa replay | 2 | S |
| DLV-12 | FTR | Utilisasi kurir belum dihitung (PARSIAL) | 2 | M |
| DLV-13 | FTR | Komentar env "bucket public-read" basi | 2 | S |

#### DLV-01 [FLW]
- Masalah: reschedule() menulis RESCHEDULED dulu; advanceOrder(...,'PREPARING') tidak fail-open dan bisa melempar [LEGACY-CLAIM src/application/services/delivery.service.ts:897-946]. Retry tanggal sama masuk finishRescheduleReplay, yang return delivery bila cashReturned falsy [LEGACY-CLAIM delivery.service.ts:845]; komentar :835-839 menjanjikan re-run dua langkah, padahal hanya jalan bila cashReturned=true. Hasil: delivery RESCHEDULED, order tertahan ON_DELIVERY, notifikasi (:945) tak terkirim. Assign berikutnya ditolak order-service lalu undoAssignment (:332-352); penolakan itu [INFERRED] (order-coordination.http.adapter.ts:62-64 flag refused).
- Tes: happy replay test/unit/delivery.service.spec.ts:709-716; kasus advanceOrder gagal tidak ada (SEARCH-DLV-05).
- Usulan minimum: pada replay selalu coba ulang hand-back + notifikasi (abaikan OrderAlreadyClaimedError).
- Acceptance: advanceOrder gagal sekali, retry payload sama membuat order PREPARING dan notify terpanggil, cashReturned undefined.
- Risiko rendah. Dependensi: kontrak 409/422 order-service. Owner: backend delivery. Bila ditunda: order beku, stok checkout tertahan sampai perbaikan manual.

#### DLV-02 [BI]
- reassignIfUnderCap hanya ubah driverId, status, pickedUpAt, startedAt, estimatedArrivalAt [LEGACY-CLAIM src/infrastructure/prisma/delivery.prisma.repository.ts:214-223]; assignedAt, slaAlertedAt, failedAt, rescheduled*, lastLat/Lng tetap.
- Semua metrik waktu pakai assignedAt: on-time pushEarning delivery.service.ts:541-550; SLA report repo:729,779; performance.service.ts:70-72; report.service.ts:140-145; sweep J8 repo:802-817. Order dijadwal besok lalu diantar kurir ke-2 dihitung terlambat belasan jam; bonus on-time hilang; sweep diam bila slaAlertedAt sudah terisi. Dampak ke nilai payout [INFERRED] (aturan di payout-service).
- Kode mengakui rescheduledFor "never cleared" (delivery.service.ts:211-214) tetapi tidak menyinggung assignedAt.
- Usulan: tetapkan definisi jam SLA percobaan ke-2 (saran assignedAt=now, slaAlertedAt=null; riwayat tetap di history). Keputusan bisnis.
- Acceptance: setelah reassign assignedAt baru, slaAlertedAt null; tes di test/unit/prisma-repositories.spec.ts dekat :1481. Owner: product + backend. Bila ditunda: bonus salah bayar, KPI SLA tercemar.

#### DLV-03 [FLW, WIRED]
- Konsol mengirim customerId dan deliveryWindow [LEGACY-CLAIM apps/web/src/components/dashboard/order-detail.tsx:293,304]; DTO menerima (modules/dto/delivery.dto.ts:130,179); service siap (delivery.service.ts:84,94,318,322); controller menyusun AssignInput tanpa keduanya [LEGACY-CLAIM modules/delivery.controller.ts:55-72].
- Delivery hasil dispatch staf tersimpan customerId/deliveryWindow null; hanya self-claim (flag OFF) mengisi. Dampak: notifikasi DELIVERY_RESCHEDULED tak masuk feed in-app (delivery.service.ts:992); PDP erasure per customerId hanya menemukan baris via telepon (repo:681); kurir tak melihat jendela waktu.
- Usulan: teruskan dua field di controller + tes pass-through. Baris lama tidak bisa di-backfill. Risiko rendah. Owner: backend delivery.

#### DLV-04 [AUT/BI]
- assign hanya memanggil assignableShift(driverId), boolean tanpa depot [LEGACY-CLAIM src/application/services/shift.service.ts:200-203; delivery.service.ts:282]; depotId dari body, assertDepotAccess hanya cek nilai kiriman (delivery.controller.ts:54).
- Setoran COD diikat ke depot SHIFT (settlement.service.ts:237) sedangkan laporan "belum disetor" pakai depot DELIVERY (repo:362): COD kurir lintas depot diverifikasi kasir depot lain. Self-claim aman (pagar di order-service, order-lookup.http.adapter.ts:9-20).
- Frekuensi kurir lintas depot [ASSUMPTION] (U-02); driver-incident.controller.ts:23-27 menyebut kurir "dipinjam ke depot lain".
- Usulan: tolak atau minta konfirmasi bila shift.depotId !== input.depotId. Risiko: memblokir kurir pinjaman. Owner: ops/product + backend.

#### DLV-05 [BI]
- closeStale menutup shift pada expectedEndAt saat check-in berikutnya, sengaja tanpa cek delivery aktif [LEGACY-CLAIM shift.service.ts:227-242]. Jendela setoran [checkInAt, checkOutAt] dengan deliveredAt <= checkOutAt (repo:444-466): delivery di celah tak masuk setoran mana pun; hanya tampak di unsettledCod 30 hari (settlement.service.ts:53,416). assignableShift tidak cek basi (shift.service.ts:200-203).
- Frekuensi [ASSUMPTION] (U-03). Usulan: geser batas jendela ke check-in baru / delivery terakhir, atau setoran dengan jendela eksplisit; uji regresi codBearingInWindow. Owner: backend + finance ops.

#### DLV-06 [FLW]
- cancelByStaff membatalkan order dulu (fail-open) baru menulis status [LEGACY-CLAIM delivery.service.ts:1294-1302]; fail kurir sengaja terbalik karena race (:573-583). Balapan complete vs cancelByStaff [INFERRED] dari urutan kode.
- FailDeliveryDto.cashReturned diabaikan di jalur staf (delivery.controller.ts:96-103); tunai tetap PAID dan masuk setoran via owedFor (aman bagi kas); refund pelanggan di payment/order-service tak dapat dipastikan. releaseByStaff tanpa replay, hand-back tidak fail-open (:1268-1279).
- Usulan: pola CAS dulu lalu order, plus replay idempoten. Tes: balapan complete vs cancelByStaff; advanceOrder gagal pada release lalu diulang. Dependensi kontrak refund.

#### DLV-07 [FLW]
- Setelah proof tersimpan, kegagalan advanceOrder(DELIVERED/COMPLETED) hanya di-log lalu break [LEGACY-CLAIM delivery.service.ts:493-502]; pushEarning dan publishDelivered `void` (:505,508); adapter payout return false tanpa antre ulang (courier-payout.http.adapter.ts:24-28,91-107); replay complete return delivery karena sudah DELIVERED (:436).
- Belum ditemukan sweep rekonsiliasi dalam cakupan (SEARCH-DLV-02). Akibat: order tersangkut ON_DELIVERY (tanpa loyalti BR-013, referral, konsumsi stok), kurir tak dibayar.
- Kontrol ada: laporan komisi paidDeliveries vs delivered (commission.service.ts:14-18,101). Tidak ada alert aktif (beda dengan cancelOrderFor alertServerError :734). Idempotensi push payout belum diverifikasi (U-04).
- Usulan: alert; replay complete mencoba ulang advance + earning idempoten; opsional sweep DELIVERED yang order-nya belum COMPLETED.

#### DLV-08 [AUT]
- DTO photoUrl/signatureUrl hanya IsString/IsNotEmpty/MaxLength(500) [LEGACY-CLAIM modules/dto/delivery.dto.ts:185-194]. storageKeyFromUrl ambil substring mulai `pod/` pertama (delivery.service.ts:64-67), dipakai untuk tautan staf (:1117-1122), purge retensi storage.remove (:1139-1162), photo-link (retention.controller.ts:84-90).
- URL buatan `x/pod/<uuid-objek-lain>.jpg` membuat purge menghapus objek lain di bucket yang sama; adapter disk lokal tak menormalisasi `pod/../..` (local-disk-storage.adapter.ts:41-43; hanya non-produksi main.ts:30-32). Reaper unggahan yatim tidak ditemukan [INFERRED].
- Usulan: validasi pola URL + tolak `..`; periksa data APK lama dulu.

#### DLV-09 [FTR]
- sumCollected melempar bila authorization kosong (cash-collection.http.adapter.ts:34-36) padahal request pakai x-internal-key (:50-56); reportTable(COD_UNSETTLED) mengecualikan tunai gagal/reschedule (settlement.service.ts:488-495); unsettledCod dengan authorization='' selalu failedCashSource:'unavailable' (:413,428-431,443-448). Laporan terjadwal meremehkan uang di tangan kurir.
- Usulan: hapus cek di adapter, sertakan unsettledUnfinished.

#### DLV-10 [BI]
- ASSIGNED/PICKED_UP/ON_DELIVERY boleh langsung FAILED (domain/delivery-status.ts:28-45); fail() terima reason bebas dan membatalkan order tak terbalik (delivery.service.ts:559-616); hanya no-show dipagari (domain/no-show.ts). Tak ada review/alert ke ops. Kontrol ada: riwayat alasan, laporan FAILED_DELIVERIES (settlement.service.ts:521-540).
- Usulan (keputusan bisnis U-05): notifikasi ops untuk gagal non-no-show, atau status "diajukan gagal"; tingkat gagal per kurir di dasbor.

#### DLV-11 [FLW]
- advance() panggil order-service dulu baru applyStatus (delivery.service.ts:1185-1200); gagal tulis lokal membuat retry ditolak dan terbaca "diambil pihak lain" (:1349-1351). Antrean offline tak membawa pickup/start (apps/web/src/lib/offline-queue.ts:332-356), eksposur terbatas. Usulan: CAS lokal dulu atau baca ulang status saat 409.

#### DLV-12 [FTR]
- Bahan ada (Shift checkInAt/checkOutAt/breakSecondsUsed/expectedEndAt; Delivery startedAt/deliveredAt); laporan hanya jumlah, on-time, gagal, rating (report.service.ts:59-76; performance.service.ts:7-29); lokasi hanya menimpa (prisma/schema.prisma:140-141). Usulan: utilisasi = Σ(deliveredAt−startedAt)/(checkOut−checkIn−break) per kurir-hari; definisi bisnis U-06.

#### DLV-13 [FTR]
- Komentar config/env.validation.ts:93-96 "must be public-read" vs CA-4-49 bucket privat + signed link (s3-storage.adapter.ts:21-26). Usulan: perbarui komentar.

#### DLV-14 [FTR/BI] distanceMeters PoD ditulis tetapi tidak pernah bisa dibaca — dampak 3, effort S
- delivery.service.ts:460-479 menghitung jarak dan completeWithProof menyimpannya ke kolom distanceMeters [LEGACY-CLAIM]. ProofRow/toRecord membuang kolom itu (src/infrastructure/prisma/delivery.prisma.repository.ts:58-67,157-168); ProofRecord hanya menyebut distanceMeters? sebagai input (ports/delivery.repository.ts:4-23); ProofResponseDto tidak memuatnya (modules/dto/responses.generated.dto.ts:129-146). Grep distanceMeters di src delivery-service dan apps/web/src tidak menemukan pembaca (SEARCH-DLV-07).
- Dampak: setting-defs menjanjikan bukti dapat ditinjau HQ sebelum proofRadiusEnforced dinyalakan; lewat API/UI angka tak terlihat, hanya query DB langsung.
- Usulan minimum: petakan distanceMeters di toRecord dan ProofResponseDto; opsional laporan distribusi jarak per depot. Acceptance: GET /deliveries/:id mengembalikan proof.distanceMeters. Owner: backend delivery.

#### DLV-15 [AUT] Incident photoUrl dan deliveryId tidak divalidasi — dampak 2, effort S
- ReportIncidentDto menerima photoUrl bebas (maks 2048) dan deliveryId uuid apa pun, tanpa cek milik kurir itu (modules/dto/incident.dto.ts:39-60); signedPhotoUrl menandatangani key turunan dari string tersebut (incident.service.ts) [LEGACY-CLAIM per agent]. Kelas masalah sama dengan DLV-08 (dapat digabung). Usulan: validasi pola URL upload + kepemilikan delivery.

#### DLV-16 [FTR] Skema respons yang "mirrors exactly" menyimpang dari record — dampak 1-2, effort S
- DeliveryResponseDto tidak memuat deliveryWindow (ada di DeliveryRecord, ports/delivery.repository.ts:58); ProofResponseDto tidak memuat distanceMeters; customerId non-optional di DTO tetapi customerId?: string | null di record. Klien OpenAPI tidak melihat field itu.

#### DLV-17 [BI] depositedAmount tanpa batas atas — dampak 2, effort S
- SubmitSettlementDto hanya @IsInt @Min(0) (modules/dto/settlement.dto.ts) sedangkan kolom Prisma Int 32-bit; nilai di atas 2.147.483.647 mungkin menjadi error DB 500 bukan 422 [INFERRED; guard pipeline global belum dicek]. Usulan: @Max wajar per shift.

Pembaruan putaran 3: OrderCoordinationError = 422 (errors.ts:89-95) sedangkan penolakan "refused" dipetakan ke 409 OrderAlreadyClaimedError; apakah isRetryable di offline-queue.ts memperlakukan 422 sebagai retry belum diverifikasi (U-08). Port CashCollectionPort.sumCollected memang mewajibkan authorization (DLV-09: syarat ada di kontrak port, bukan hanya adapter). Tidak ada kontrol baru yang membatalkan temuan lama.

---
#### Inventory ringkas
Endpoint (/api/v1; DepotScopeGuard global di delivery.module.ts; guard @Can/@Roles/InternalAuthGuard; sumber src/modules/*.controller.ts): POST /deliveries; POST /deliveries/:id/release|cancel; GET /deliveries(/:id, /:id/proof-links); /driver/deliveries (list, :id, claim, pickup, start, fail, no-show, reschedule, complete, location, contact-attempts, uploads); /driver/shifts (list, current, check-in, :id/check-out, :id/status); /driver/settings, /driver/performance, /driver/incidents, /field-incidents, /driver/settlement (+expected/:shiftId, :id); /shifts; /settlements (+unsettled, rules, :id/verify|approve-charge|reject-charge|dispute, internal/deposited, internal/report-table); /commission; /reports/sla|sla-by-depot|depot-team|internal/sla; /proofs/purge-expired|internal/pdp-anonymise|photo-link; /deliveries/internal/sla-sweep; /settings(/schema); /health.
Model (prisma/schema.prisma): Delivery (unique orderId, depotId?, status, codAmount, assignedAt, slaAlertedAt), ProofOfDelivery (unique deliveryId), Shift (partial unique satu non-ENDED per driver, raw SQL), CashSettlement (unique shiftId, orderIds uuid[]), ContactAttempt, FieldIncident, DeliveryStatusHistory, ServiceSetting.
Transisi: Delivery ASSIGNED→PICKED_UP→ON_DELIVERY→DELIVERED; {ASSIGNED,PICKED_UP,ON_DELIVERY}→FAILED|RESCHEDULED; RESCHEDULED→ASSIGNED (domain/delivery-status.ts:20-33). Shift ONLINE/BREAK/OFFLINE saling pindah, →ENDED via check-out (domain/shift.ts:16-23). Settlement SUBMITTED|DISPUTED→VERIFIED; SUBMITTED→DISPUTED; charge: requestCharge→claimChargeApproval→push payout→resolve.
Cron: tidak ada; sla-sweep dipicu scheduler eksternal (U-01); setInterval refresh cache setting. Event: tanpa broker; HTTP sinkron fail-open ke admin webhook delivery.delivered, crm notifikasi, payout courier/ledger/internal dan variance/internal. Integrasi wired: order-service, payment-service (for-order, void-for-order, cash-collected), depot-service lokasi, S3/disk. Flag: courierSelfClaimEnabled=0, proofRadiusEnforced=0, settlementExpectFromCod=1, SURPLUS_NOTE_THRESHOLD_IDR=5000.
KPI-candidate: deliveredAt−assignedAt per depot/hari; failedAt per driverId; CashSettlement.variance; breakSecondsUsed/(checkOut−checkIn); ProofOfDelivery.distanceMeters; ContactAttempt per delivery; utilisasi (belum ada).

#### Search-log
SEARCH-DLV-01 (cancelByStaff, releaseByStaff, assignedAt reset, cross-depot, stale shift, utilis; docs/*AUDIT*, *REGISTER*, OPEN_GAPS*; grep): tak ada PREV yang cocok; batas: register tidak dibaca utuh. SEARCH-DLV-02 (@Cron|setInterval|ScheduleModule|Interval( di src): hanya refresh cache; job rekonsiliasi belum ditemukan dalam cakupan service. SEARCH-DLV-03 (pickup|start|isRetryable di offline-queue.ts): pickup/start tak di antrean. SEARCH-DLV-04 (recipientPhone/customerId di apps/web): konsol kirim keduanya. SEARCH-DLV-05 (tes replay/assignedAt): tak ada tes advanceOrder-gagal-lalu-replay maupun asersi assignedAt pasca-reassign. SEARCH-DLV-06 (utilisasi di src): belum ditemukan; BFF dasbor service lain tidak dibaca.

#### Unresolved
U-01 pemicu/frekuensi sla-sweep; U-02 kurir lintas depot nyata?; U-03 frekuensi lupa check-out; U-04 idempotensi payout per deliveryId; U-05 kebijakan fail sepihak dan refund setelah tunai; U-06 definisi utilisasi; U-07 kasus ganda hipotetis: kurir-1 tunai lalu reschedule lalu setoran-1, kurir-2 selesaikan; owedFor=max(codAmount,paidCash) bisa menuntut dua kali (tak diverifikasi).

#### Handoff
order-service: kontrak PATCH PREPARING, refund saat batal setelah tunai PAID (DLV-01/06/07). payout-service: idempotensi push earning, aturan onTime (DLV-02/07), variance/internal. payment-service: cash-collected, void-for-order (U-07). admin-service: scheduler sla-sweep/purge-expired/report-table, konsumen delivery.delivered. depot-service: internal/deposited (DLV-04). crm-service: customerId null (DLV-03). apps/web: konsol assign sudah benar. packages/access: tracking vs orderFulfilment sudah diketahui.



### Arsip wilayah services-depot-service

Provenance: `agents/services-depot-service/findings.md`.

#### Temuan - services/depot-service (HEAD 1e93545a2)
Bukti semua level STATIC. Path relatif ke services/depot-service/. Temuan hanya dari file berstatus READ di ledger.json (banyak file UNREAD).
Format ringkas: area | masalah+bukti | kontrol ada | usulan minimum | dampak/effort | owner | bila ditunda.

#### DEP-01 [FLW] Gerakan stok GALON issue dan retur untuk order yang sama saling membatalkan
- [LEGACY-CLAIM src/application/services/inventory.service.ts:875-877] moveRawLine melewati gerakan bila sudah ada movement (line, orderId), return shortfall 0. Issue dari order memakai orderId [LEGACY-CLAIM gallon-issue.service.ts:231]; retur kurir order yang sama memakai orderId sama pada garis GALON sama [LEGACY-CLAIM gallon-return.service.ts:108-115,414]. Unik DB (itemId,orderId) [LEGACY-CLAIM prisma/schema.prisma:303]. Tukar-galon memang issue +1 retur -1 per order [LEGACY-CLAIM gallon-issue.service.ts:46-54]. Tes hanya mengulang issue yang sama [LEGACY-CLAIM test/unit/gallon-stock-book.spec.ts:202-203].
- [INFERRED] satu sisi tukar-galon tidak masuk stok fisik GALON, drift tanpa jejak (tujuan CA-2-57 gagal).
- Kontrol ada: idempotensi per order (benar untuk retry satu arah). Usulan: kunci idempotensi menyertakan arah; tes issue+retur satu order.
- Dampak 4 / S-M. Risiko: perubahan unik, data lama sudah drift. Dependensi: urutan event order-service. Acceptance: issue 2 + retur 2 satu order = 2 movement, net 0. Verifikasi: spec dengan fake yang menegakkan unik. Owner backend depot. Ditunda: stok GALON fisik terus selisih dengan saldo beredar.

#### DEP-02 [FLW/AUT] Terima PO tidak aman terhadap klik ganda/paralel dan crash di tengah
- [LEGACY-CLAIM purchase-order.service.ts:159-162] cek SENT dari bacaan; stok diposting per baris [227-261]; lines/status ditulis sekali setelahnya [270-276] via update by id tanpa CAS/versi [purchase-order.prisma.repository.ts:75-84]; tabel tanpa kolom versi [schema.prisma:584-605]. Komentar 148-151 mengklaim jumlah tiba ditulis per baris, padahal sekali di 270. Tanpa Idempotency-Key [purchase-order.controller.ts:79-86] (pola ada di payout #770).
- [INFERRED] dua receive paralel atau retry pasca-crash menambah stok dua kali.
- Kontrol ada: batas outstanding per panggilan (efektif hanya sekuensial). Usulan: klaim atomik (UPDATE WHERE status=SENT dan versi) sebelum posting, atau satu transaksi.
- Dampak 4 / M. Risiko: menyatukan repo PO dan inventory. Acceptance: dua receive paralel = stok naik sekali. Verifikasi: tes race seperti test/race/. Owner backend depot. Ditunda: stok/HPP menggelembung.

#### DEP-03 [FLW] consumeForOrder: SALE dan penyelesaian reservasi beda transaksi; retry melewati penyelesaian
- [LEGACY-CLAIM inventory.service.ts:707-718] applyMovement lalu consumeReservation; transaksi terpisah [inventory.prisma.repository.ts:218-256 vs 501-524]; retry alreadyConsumed `continue` [inventory.service.ts:702-705] tanpa menyelesaikan.
- [INFERRED] crash di antara = reserved naik terus, available terlalu rendah, low-stock palsu.
- Usulan: jalur alreadyConsumed tetap consumeReservation (idempoten via CAS). Dampak 3 / S. Acceptance: setelah retry reserved turun. Verifikasi: fake gagal di consumeReservation. Owner backend depot.

#### DEP-04 [BI/FTR] Adjust dan opname barang mentah tanpa alasan wajib, tanpa persetujuan, tanpa batas
- [LEGACY-CLAIM modules/dto/inventory.dto.ts:196-207] delta @IsInt tanpa Max, boleh 0, reason opsional; adjust tidak membuat approval [inventory.service.ts:335-367]; hanya opname [376-405] dan nilainya sellPrice, garis mentah (AIR/GALON/TUTUP/SEGEL) bernilai 0 sehingga tak pernah masuk antrean [466-474, ponytail 459-465]; wastage tanpa Rupiah untuk garis mentah [901-929].
- Kontrol ada: ledger append-only, actorId, wastageSummary, approval opname PRODUK. Usulan: reason wajib untuk delta negatif, delta != 0, ambang jumlah/nilai per-unit untuk garis mentah, Max.
- Dampak 3-4 (GALON aset berdeposit) / M. Owner ops/finance+backend. Acceptance: koreksi negatif tanpa alasan ditolak; selisih galon besar masuk antrean. Ditunda: penyusutan galon tak terlihat.

#### DEP-05 [FLW/BI] Antrean approval tidak mengikat
- [LEGACY-CLAIM approval.service.ts:199-220] decide hanya ubah status; ApprovalStatus hanya dirujuk service+repo approval (grep src). Opname sudah ubah stok sebelum approval [inventory.service.ts:386-402]; refund deposit retur rusak sudah tercatat sebelum approval [gallon-return.service.ts:305-327].
- Akibat: Tolak tidak membatalkan apa pun. [ASSUMPTION] apakah memang pasca-fakta? Pertanyaan ke owner proses. Dampak 3 / M-L. Owner product+backend. Ditunda: kontrol semu; KPI approvalsReviewed menyesatkan.

#### DEP-06 [AUT] Retur galon kurir memercayai orderId/customerId/depotId dari body
- [LEGACY-CLAIM driver-gallon-return.controller.ts:22-40; gallon-return.service.ts:337-396] tidak ada verifikasi order (tidak ada port ke order-service di daftar ports). Refund = min(tarif x qty, deposit tersisa) [380-383]; stok +qty [414].
- Dibatasi deposit pelanggan; risiko kolusi atau salah id. [ASSUMPTION] apakah DepotScopeGuard mengunci peran kurir ke depotnya (d.ts platform hanya menyebut STAFF_DEPOT/KEPALA_DEPOT) - tanya agen platform.
- Usulan: validasi order via order-service. Dampak 3-4 / M. Dependensi order-service.

#### DEP-07 [FLW] Retur/issue manual tanpa idempotensi (uang keluar)
- [LEGACY-CLAIM gallon-return.service.ts:279-330; gallon-issue.service.ts:190-206] tanpa kunci; hanya batas saldo di bawah lock. Kontras jalur kurir idempoten [372-395]; payout punya Idempotency-Key.
- Tap ganda pada pelanggan dengan deposit >1 galon mencatat refund dua kali yang tampak sah. Usulan Idempotency-Key. Dampak 3 / M.

#### DEP-08 [FLW] Referensi transfer: hari lokal vs jendela UTC dan balapan
- [LEGACY-CLAIM stock-transfer.service.ts:83] day lokal (Asia/Jakarta: depot-config.service.ts:133-135); hitung memakai jendela UTC dan melewatkan ms terakhir [stock-transfer.prisma.repository.ts:206-215]; reference UNIQUE [schema.prisma:555].
- [INFERRED] transfer 00:00-07:00 WIB terhitung hari UTC sebelumnya; setelah 07:00 WIB urutan bisa mulai 0001 lagi pada day-key sama = tabrakan unik, kirim 500 (stok aman, rollback). Kirim paralel juga bertabrakan. Dampak 2 / S.

#### DEP-09 [BI/FTR] Transfer: tujuan tidak divalidasi; tak ada penolakan atau penuaan in-transit
- [LEGACY-CLAIM stock-transfer.service.ts:55-98] toDepot tidak dicek; FK Restrict [schema.prisma:556-559]: id tak ada = 500, depot nonaktif diterima. Hanya pengirim bisa batal [stock-transfer.service.ts:147-167]; tak ada penuaan (SEARCH-SDS-01). Tanpa nilai/HPP [schema.prisma:552-582]. [ASSUMPTION] transfer antar pemilik waralaba beda dilarang? tanya owner. Dampak 2-3 / S-M.

#### DEP-10 [BI] Nonaktifkan depot tanpa pra-cek
- [LEGACY-CLAIM depot.service.ts:277-281; depot.controller.ts:549-563] hanya active=false; tidak cek reservasi aktif, PO SENT, transfer SENT, shift OPEN, saldo galon. [ASSUMPTION] mungkin dicek di UI/service lain. Dampak 3 / M.

#### DEP-11 [AUT/FTR] Validasi input receive/PO lemah
- [LEGACY-CLAIM procurement.dto.ts:109-138] received/notes @IsObject tanpa tipe nilai; service memakai langsung [purchase-order.service.ts:167,186]: string/pecahan lolos lalu gagal di Prisma (masuk unbooked), .trim pada non-string = 500. Baris PO tanpa Max dan tanpa batas jumlah baris [procurement.dto.ts:64-100,185-199]; subtotal Int4 [schema.prisma:595-597] = overflow 500. Dampak 2 / S.

#### DEP-12 [FTR/perf] Bacaan tak terbatas
- [LEGACY-CLAIM inventory.prisma.repository.ts:266-272] listMovements tanpa take, dipakai GET inventory/:itemId/movements [inventory.controller.ts:401-410]; tabel tumbuh tercepat (schema 304-307); versi per-depot sudah dipaginasi (300-344). PO listForDepot tanpa batas [purchase-order.prisma.repository.ts:47-53]. Dampak 3 / S.

#### DEP-13 [AUT] Import depot (upsert) tanpa audit per depot
- [LEGACY-CLAIM depot-import.service.ts:113-131] satu audit ringkas berisi hitungan; PATCH mencatat depot+nama field [depot.controller.ts:489-494]. Import dapat ubah rekening, QRIS, ownerId [depot-import.service.ts:155-160] dengan depotAdmin+depotLifecycle [depot-import.controller.ts:25-33]. Dampak 3 / S: audit per baris (nama field saja).

#### DEP-14 [FTR] Import: kode beda huruf besar/kecil menggandakan depot
- [LEGACY-CLAIM depot-import.service.ts:77-89] dedup file case-insensitive, tetapi pencocokan DB eksak [depot.prisma.repository.ts:165-172; service 87-101]; unik case-sensitive [schema.prisma:54]; create juga eksak [depot.service.ts:114]. Dampak 2 / S.

#### DEP-15 [FLW] reserveForOrder mengabaikan status reservasi; reserve paralel satu order = 500
- [LEGACY-CLAIM inventory.service.ts:546-550; repo 430-435] findReservation tanpa filter status; createMany melanggar unik (itemId,orderId) [repo 478-480; schema 281] pada balapan. [ASSUMPTION] order-service tak reserve ulang order yang sudah dilepas. Dampak 2 / S.

#### DEP-16 [FLW] Jendela crash antara ledger dan gerakan stok
- [LEGACY-CLAIM inventory.service.ts:218-240] create baris lalu RECEIPT pembuka terpisah (saldo awal hilang, impor ulang skipped). Retur kurir: stok hanya bila created=true [gallon-return.service.ts:414]. moveStockOut: approval tidak best-effort [gallon-issue.service.ts:101-112], retry shortfall 0 = approval hilang. Dampak 2 / M.

#### DEP-17 [FLW] restockForOrder tidak idempoten
- [LEGACY-CLAIM inventory.service.ts:765-767,789-798] tanpa orderId pada movement; komentar mengakui. Retry at-least-once menggandakan stok. [ASSUMPTION] order-service menjaga satu panggilan. Dampak 2 / S.

#### DEP-18 [FTR] Supplier.onTimeRate tak pernah dihitung
- [LEGACY-CLAIM schema.prisma:513-515; supplier.service.ts:58] hanya manual dari DTO, padahal expectedAt/receivedAt ada. Dampak 1 / S-M.

#### Putaran lanjutan (DEP-19 dst). Level STATIC. Path relatif ke services/depot-service/.

#### DEP-19 [FLW] Tutup shift kasir tidak atomik dengan posting kas
- [LEGACY-CLAIM src/application/services/cashier-shift.service.ts:118-139] shifts.close menandai CLOSED lebih dulu, baru cashbook.create(KONTER). Jika posting gagal, retry ditolak ShiftAlreadyClosed [99] dan tunai konter tidak pernah masuk buku/tutup harian. [INFERRED] selisih kas permanen. Usulan: satu transaksi atau posting idempoten per sourceRef shift:<id> yang dilanjutkan saat retry. Dampak 3 / M.

#### DEP-20 [FLW/BI] Entri kas bertanggal mundur ke hari/bulan yang sudah ditutup; batas jendela inklusif
- [LEGACY-CLAIM cashbook.service.ts:51-65; dto/cashbook.dto.ts:62-65] occurredAt bebas (tanpa batas) dan tanpa cek hari tutup/bulan segel. Hari tutup hanya melaporkan lateEntries saat dibaca [daily-close.service.ts:92-113]; tampilan bulan tidak punya penanda serupa [monthly-close.service.ts:91-102], padahal snapshot bulan dijumlah dari snapshot harian [143-158].
- [LEGACY-CLAIM cashbook.prisma.repository.ts:60] batas atas memakai lte, sedangkan jendela pemanggil setengah-terbuka (daily-close.service.ts:83-90; DTO depot-costs bertulis exclusive, cashbook.dto.ts:81): entri tepat pada 00:00 hari berikut terhitung dua hari/bulan. Dampak 3 / S-M.

#### DEP-21 [BI] Opex mengabaikan koreksi (reversal) buku kas; dua definisi biaya
- [LEGACY-CLAIM depot-costs.service.ts:54-57; operational-report.prisma.repository.ts:81-83] hanya entri OUT dihitung; reversal memposting arah berlawanan [cashbook.service.ts:97-111] sehingga OUT yang dikoreksi tetap terhitung sebagai biaya. Selain itu COGS DepotCosts = PO diterima dalam jendela (+ongkir), sedangkan laporan operasional = unit terjual x biaya PO terakhir hanya dari PO berstatus RECEIVED [operational-report.prisma.repository.ts:65-69]; dua angka berbeda untuk depot-bulan yang sama. [ASSUMPTION] layar mana yang dipakai pemilik. Dampak 3 / S-M.

#### DEP-22 [FLW] Selisih kasir/COD tidak pernah masuk antrean persetujuan
- [LEGACY-CLAIM cashier-shift.service.ts:117-124] variance hanya disimpan; ApprovalType.COD_VARIANCE didefinisikan tetapi tidak pernah dibuat di src (grep: hanya domain/approval.ts:8 dan peta di approval.prisma.repository.ts:84). Kekurangan laci tidak dieskalasi. Dampak 3 / M.

#### DEP-23 [FLW] Jeda/lanjut langganan hanya mengubah baris lokal; mesin order-service tidak dikabari
- [LEGACY-CLAIM subscription.service.ts:144-152; ports/order-subscription.port.ts:24-27] port hanya punya create; pause/resume tidak memanggil mesin; tidak ada cancel padahal enum CANCELLED ada [schema.prisma:964-968]. [INFERRED] langganan "PAUSED" di konsol tetap menghasilkan pesanan. Create: mesin dulu lalu baris lokal [109-131], kegagalan lokal meninggalkan plan yatim; request tanpa kunci idempotensi dan timeout 8 dtk [order-subscription.http.adapter.ts:27-50] sehingga retry membuat plan ganda. Dampak 4 / M.

#### DEP-24 [FLW/AUT] Persetujuan price-override tidak atomik dan dasar four-eyes dari klien
- [LEGACY-CLAIM price-override.service.ts:156-178] rule dibuat dulu lalu status proposal diperbarui (update by id, tanpa CAS): persetujuan paralel atau kegagalan update menggandakan rule priority 100; terminal dicek dari bacaan lama [133]. currentPrice/productName disuplai pengusul [82-100] dan menentukan dampak untuk ambang four-eyes [domain/price-override-proposal.ts:48-77]. Dampak 2-3 / S-M.

#### DEP-25 [AUT/BI] Tata kelola harga HQ dapat dilewati manajer depot
- [LEGACY-CLAIM modules/pricing.controller.ts:56-76] POST pricing rules (termasuk ABSOLUTE, priority bebas) hanya butuh depotAdmin (MANAGER+SUPER_ADMIN per depot.controller.ts:459-462); sellPrice per-depot juga bisa diubah lewat PATCH inventory (inventoryWrite) [inventory.controller.ts:349-359]. Alur proposal bertujuan HQ menyetujui override [price-override.service.ts:43-51], padahal jalan langsung tidak butuh persetujuan. [ASSUMPTION] manajer memang boleh set harga sendiri bila di dalam batas; DTO rule tidak dibaca. Dampak 3 / M-L; tanya owner kebijakan harga.

#### DEP-26 [FLW/BI] Resolusi sengketa REFUND: selalu refund penuh, orderRef bebas, balapan; RESEND tidak berefek
- [LEGACY-CLAIM dispute.service.ts:118-134; infrastructure/http/dispute-refund.http.adapter.ts:46-50] body refund hanya {reason}; amountIdr sengketa tidak diteruskan sehingga klaim OVERCHARGED sebagian memicu refund seluruh pembayaran. orderRef teks bebas tidak dikaitkan ke depot sengketa [schema.prisma:872-880] (pencocokan eksak dengan token manajer; cakupan order-service [ASSUMPTION]). Status dibaca lalu refund diminta lalu update tanpa CAS [98-133]: dua manajer menghasilkan dua permintaan refund. RESEND ditandai RESOLVED tanpa tindakan (diakui di kode). Dampak 3-4 / M.

#### DEP-27 [FLW] Persetujuan franchise tidak mensyaratkan checklist/tahap
- [LEGACY-CLAIM franchise-application.service.ts:162-178; controller:137-147] approve hanya menolak jika sudah final; PENDING langsung APPROVED tanpa cek checklist VERIFIED/survey. Pembuatan depot terpisah dan tidak terkait aplikasi (komentar kelas 45-51); kode usulan bisa terpakai di antaranya. Dampak 2-3 / S.

#### DEP-28 [AUT] POST /approvals dapat membuat catatan "disetujui otomatis" sembarang
- [LEGACY-CLAIM approval.controller.ts:25-43; approval.service create] pemegang capability approvals memilih type, judul, dan nominal; nominal di bawah ambang langsung APPROVED. Jejak persetujuan dapat dipalsukan/menumpuk noise. Usulan: batasi pembuatan ke jalur sistem. Dampak 2 / S.

#### DEP-29 [AUT] Serah-terima shift: tanda tangan tanpa identitas dan tanpa dua pihak
- [LEGACY-CLAIM handover.service.ts:66-69; handover.controller.ts:47-56; schema.prisma:1024-1043] sign hanya set signedAt; tidak ada signedBy, tidak dicek penandatangan = toStaff, dan tanda ulang menimpa waktu. Catatan tidak membawa hitungan kas/stok. Dampak 2 / S.

#### DEP-30 [FLW] Insiden: PATCH status ke RESOLVED melewati catatan penyelesaian; buka ulang menghapus jejak
- [LEGACY-CLAIM incident.service.ts:107-125] updateStatus(RESOLVED) hanya set resolvedAt (tanpa resolvedBy/note); status lain menghapus resolutionNote/resolvedBy. Dampak 2 / S.

#### DEP-31 [BI/AUT] Tarif deposit galon dapat diubah manajer depot; refund memakai tarif saat ini
- [LEGACY-CLAIM config/setting-defs.ts:31-38,57-67] gallonDepositIdr tanpa `requires` (hanya approvalAutoPassIdr dibatasi) sehingga depotAdmin (manajer) menulis override per-depot [settings.controller.ts:34-49,72-75], maks 1.000.000. Deposit ditahan = tarif saat issue [gallon-issue.service.ts:225], refund = tarif saat retur [gallon-return.service.ts:380-383]: perubahan tarif membuat refund tidak sama dengan yang ditahan (dibatasi depositLeft). Dampak 3 / S: batasi penulisan ke HQ atau simpan tarif per baris.

#### DEP-32 [FTR] Lookup SKU katalog hanya melihat 20 hasil pencarian pertama
- [LEGACY-CLAIM infrastructure/http/product-catalog.http.adapter.ts:44-51] pencocokan SKU eksak hanya di antara limit=20 hasil search (yang juga cocok nama); SKU umum bisa terbaca missing/CatalogProductNotFoundError saat impor. Dampak 1-2 / S.

#### DEP-33 [FTR/perf] Bacaan tak berbatas yang tersisa (delta atas QUERY_BOUNDS)
- [LEGACY-CLAIM cashbook.prisma.repository.ts:57-67; inventory.prisma.repository.ts:346-397; scan2.json] cashbook tanpa from/to mengembalikan seluruh riwayat (DTO from/to opsional, cashbook.dto.ts:23-33); wastage dan opnameVariances tanpa rentang membaca semua ADJUSTMENT/OPNAME; 35 findMany tanpa take di repo (scan2.json). docs/QUERY_BOUNDS.md:81-98 mengakui sisanya sebagai utang kecil; delta di sini hanya tiga bacaan yang tumbuh tanpa batas. Dampak 2-3 / S.



### Arsip wilayah services-hr-service

Provenance: `agents/services-hr-service/findings.md`.

#### Temuan audit services/hr-service (HEAD 1e93545a2)

Tingkat bukti: semua STATIC (kode dibaca, tidak ada eksekusi; RUNTIME tidak mungkin). Path relatif repo; `hr/` = `services/hr-service/`. Skala dampak 1-5, effort S/M/L/XL. Cakupan baca: lihat ledger.json. Bagian "Kontrol sudah ada" dicatat agar tidak direkomendasikan ulang.

#### A. Uang / payroll / pajak

#### HR-01 Lembur dibayar otomatis tanpa persetujuan dan tanpa batas (FTR, BI) dampak 4, effort M
- Masalah: `overtimeBonus` menghitung semua menit kerja di atas jam standar dari `workingMinutes` (check-out minus check-in) lalu menulis baris BONUS "Lembur" ke slip [LEGACY-CLAIM hr/src/application/services/payroll.service.ts:1168-1224; hr/src/domain/overtime.ts splitOvertime]. Tidak ada entitas permintaan/persetujuan lembur dan tidak ada plafon harian/mingguan (belum ditemukan dalam cakupan hr-service, SEARCH-hr-service-01). Check-out boleh menutup baris check-in hingga 24 jam sebelumnya [LEGACY-CLAIM hr/src/application/services/attendance.service.ts:113-132,246-247], jadi lupa check-out lalu check-out esok pagi menghasilkan belasan jam lembur terbayar.
- Kontrol sudah ada: PENDING tidak masuk lembur [LEGACY-CLAIM hr/src/infrastructure/prisma/attendance.prisma.repository.ts:174-180]; pembuat slip tidak boleh approve [LEGACY-CLAIM payroll.service.ts:761]; basis lembur gaji pokok = keputusan terdokumentasi (docs/HRIS_GAP_PLAN.md:115).
- Usulan minimum: plafon menit lembur per hari (setelan) dan tandai hari terpotong di slip; opsional status persetujuan lembur per hari.
- Acceptance: hari berdurasi melebihi plafon dibayar sampai plafon dan ditandai. Verifikasi: spec payroll dengan baris 16 jam. Owner: backend HR + HR lead. Risiko: kebijakan batas [ASSUMPTION: berapa jam lembur maksimum per hari/minggu menurut HR/hukum?]. Bila ditunda: pembayaran berlebih lolos sampai approve.

#### HR-02 Cuti disetujui menimpa baris absensi yang sudah ada tanpa jejak (FLW) dampak 3, effort S
- Masalah: `settleAttendance` memanggil `upsertManual` status LEAVE untuk tiap hari kerja [LEGACY-CLAIM hr/src/application/services/leave.service.ts:379-388]; pada baris yang ada `upsertManual` hanya `update: {status,...}` tanpa menghapus check-in/foto/lateMinutes dan tanpa `recordAdjustment` [LEGACY-CLAIM hr/src/infrastructure/prisma/attendance.prisma.repository.ts:35-48]. Hari yang sebenarnya hadir berubah jadi LEAVE; karyawan DAILY kehilangan upah hari itu (basePay memakai presentDays).
- Kontrol ada: `createManual` menolak hari yang sudah punya catatan (CA-1-14) [LEGACY-CLAIM attendance.service.ts:627-658]; jalur cuti tidak memakainya.
- Usulan: lewati/laporkan hari PRESENT/LATE/PENDING saat settle, atau catat adjustment before/after. Acceptance: persetujuan pada rentang berisi hari hadir tidak mengubah hari itu. Verifikasi: spec leave dengan baris PRESENT.

#### HR-03 Koreksi absensi tidak menghitung ulang menit kerja; koreksi tidak peduli slip terkunci (FLW) dampak 3, effort S
- (a) `adjust` mengirim checkInAt/checkOutAt tetapi `upsertManual` tidak menulis `workingMinutes`, dan `lateMinutes` hanya bila dikirim [LEGACY-CLAIM attendance.service.ts:595-603; attendance.prisma.repository.ts:35-48]. Check-out yang dikoreksi HR tidak menghasilkan menit/lembur.
- (b) `adjust`, `decide`, `createManual` tidak memeriksa status payroll bulan itu; hanya `importHistory` yang memeriksa [LEGACY-CLAIM attendance.service.ts:684-692 vs 304-329,577-658]. Koreksi setelah slip APPROVED/PAID tidak berpengaruh ke slip dan tidak ada tanda.
- Kontrol ada: keputusan "bayar tepat waktu, koreksi bulan depan" untuk PENDING [LEGACY-CLAIM payroll.service.ts:910-921]. Delta: tidak ada penanda untuk koreksi pada periode terkunci.
- Usulan: hitung ulang workingMinutes/lateMinutes pada adjust; peringatan eksplisit untuk periode non-DRAFT. Verifikasi: spec adjust check-out lalu regenerate.

#### HR-04 Dasar PPh 21 dan BPJS hanya gaji pokok+tunjangan; bonus, lembur, THR tidak pernah kena pajak di aplikasi (BI) dampak 4, effort M
- `gross = BASE + ALLOWANCE`; semua BONUS (THR, lembur, bonus harian) tidak masuk `statutoryInput.grossIdr` [LEGACY-CLAIM payroll.service.ts:523-540]. Rekonsiliasi Desember memakai `payroll.gross` yang sama [LEGACY-CLAIM hr/src/infrastructure/prisma/payroll.prisma.repository.ts:146-184; hr/src/domain/statutory.ts:409-444], jadi penghasilan variabel tidak dipajaki bahkan di Desember. Komentar kode: bonus "dipajaki lewat pelaporan tahunan" [LEGACY-CLAIM payroll.service.ts:527-529] tetapi aplikasi tidak menghasilkan angka itu.
- Delta atas dokumen lama: pertanyaan "THR/bonus masuk bruto TER?" sudah diajukan ke akuntan [LEGACY-CLAIM docs/BRIEF_AKUNTAN.md:59-60], belum ada jawaban terdokumentasi (belum ditemukan dalam cakupan docs/*.md yang dicari). Baru: Desember juga mengecualikannya.
- [ASSUMPTION] pertanyaan ke akuntan: bagaimana selisih ditutup di luar aplikasi (1721-A1)? Usulan: setelah ada jawaban, masukkan komponen kena pajak ke dasar TER/Desember atau tampilkan peringatan di slip. Risiko: kewajiban pemotongan perusahaan. Owner: akuntan + backend.

#### HR-05 Rekonsiliasi Desember bergantung urutan approve dan pencocokan label teks (BI) dampak 3, effort S
- (a) `pph21YearToDate` hanya menghitung slip APPROVED/PAID sebelum bulan itu [LEGACY-CLAIM payroll.prisma.repository.ts:153-157]; slip Desember yang digenerate saat bulan sebelumnya masih DRAFT memakai YTD kurang, dan tidak dihitung ulang saat approve (approve hanya memeriksa pergeseran depot) [LEGACY-CLAIM payroll.service.ts:749-785].
- (b) PPh/BPJS terdahulu dikenali dari label `startsWith('BPJS ')` dan `=== 'PPh 21'` [LEGACY-CLAIM payroll.prisma.repository.ts:171-177]; potongan manual yang `note`-nya berawalan itu (label = note) [LEGACY-CLAIM payroll.service.ts:476-483] tercampur.
- Usulan: penanda eksplisit baris statutori; syarat bulan sebelumnya non-DRAFT sebelum Desember dibuat/disetujui. Verifikasi: spec Desember dengan November DRAFT.

#### HR-06 Gaji/jabatan/setelan dibaca "saat ini" saat regenerate DRAFT periode lampau (BI) dampak 3, effort M
- `generate` memakai `monthlyRate/dailyRate/role/ptkpStatus` karyawan dan setelan BPJS/denda hari ini [LEGACY-CLAIM payroll.service.ts:172-300,541; hr/src/application/services/employee.service.ts:941-945]. EmploymentHistory menyimpan perubahan gaji tetapi payroll tidak membacanya. Kenaikan gaji Oktober + regenerate DRAFT September memakai gaji baru; plafon JP yang berubah ikut berubah.
- Kontrol: hanya DRAFT yang bisa regenerate. Usulan: gaji berlaku-tanggal, atau konfirmasi regenerate bila data berubah sejak slip dibuat.

#### HR-07 THR dihitung tanpa tunjangan tetap (BI) dampak 3, effort S
- `monthWage = basePay(...)` hanya gaji pokok [LEGACY-CLAIM payroll.service.ts:315-323]; komentar menyatakan sengaja. [ASSUMPTION] pertanyaan ke HR/hukum: apakah tunjangan POSITION/HOUSING tetap termasuk "upah satu bulan" THR (PP 36/2021)? Bila ya, THR kurang bayar.

#### HR-08 Aturan bonus otomatis tanpa batas atas dan tidak diprorata masa kerja (BI) dampak 3, effort S
- `rewardValue` hanya `Min(0)`; PERCENT = % dari base [LEGACY-CLAIM hr/src/modules/dto/rules.dto.ts; hr/src/domain/bonus-rules.ts evalBonusRule; hr/src/application/services/bonus-rule.service.ts validate]. Aturan jaringan (depotId null) berlaku semua karyawan; satu salah ketik memengaruhi seluruh slip. Tidak diprorata (D6 hanya memprorata tunjangan) [LEGACY-CLAIM payroll.service.ts:336-367].
- Kontrol: stale-write guard pada edit; hanya hrAdmin; approver melihat slip. Usulan: `@Max` untuk PERCENT dan plafon bonus otomatis per slip.

#### HR-09 Nominal bonus/potongan/impor payroll tanpa batas atas (BI) dampak 2, effort S
- `amount` hanya `IsInt IsPositive`; kolom Decimal(12,2) [LEGACY-CLAIM hr/src/modules/dto/payroll.dto.ts CreateBonusDto/CreateDeductionDto; hr/prisma/schema.prisma Bonus.amount]. Di atas 9.999.999.999 jadi 500 DB (ShareCorrectionDto di file yang sama sudah punya @Max); angka typo besar di bawahnya diterima. ImportPayrollRowDto juga tanpa @Max [LEGACY-CLAIM hr/src/modules/dto/history-import.dto.ts].

#### HR-10 Slip dengan shortfall tidak bisa dialokasikan ulang konsisten (BI) dampak 2, effort S
- `allocatePayroll` menyimpan `deduction` = bagian terambil dan `shortfall` terpisah; `reallocationProblems` menuntut jumlah `deduction` = `totalDeduction` penuh dan mengabaikan shortfall [LEGACY-CLAIM hr/src/domain/payroll-allocation.ts allocatePayroll, reallocationProblems]. Untuk slip net dilantai 0 pembagian yang sama persis akan ditolak. Jarang (hanya dengan fitur penugasan depot aktif).

#### HR-11 Tabel TER kosong default dan PTKP kosong menghasilkan PPh 0 tanpa laporan (BI) dampak 3, effort S
- TER default kosong sehingga metode tahunan-progresif jalan [LEGACY-CLAIM hr/src/domain/statutory.ts:17-28; hr/src/config/env.validation.ts HR_PPH21_TER_TABLE_JSON default ''; docs/BRIEF_AKUNTAN.md:43]. `pph21Monthly` mengembalikan 0 bila ptkpStatus null [LEGACY-CLAIM statutory.ts:316]. Tidak ada laporan "karyawan tanpa PTKP/NPWP/BPJS" di daftar endpoint reports. [ASSUMPTION] apakah tabel TER sudah dimuat di produksi? Tidak dapat dipastikan dari kode.

#### B. Kasbon dan persetujuan

#### HR-12 Pinjaman dinonaktifkan tetap dihitung sebagai saldo terbuka (BI) dampak 3, effort S
- `viewsFor` mengambil semua pinjaman dan `settled` tidak melihat `active` [LEGACY-CLAIM hr/src/application/services/loan.service.ts:134-160; hr/src/infrastructure/prisma/loan.prisma.repository.ts listByEmployee]; `openBalance` menjumlah yang belum settled dan dipakai batas 1x gaji pengajuan kasbon [LEGACY-CLAIM loan.service.ts:116-119; hr/src/application/services/loan-request.service.ts:178-185]. Kasbon yang dihapuskan via `deactivate` terus memotong jatah pengajuan selamanya. Usulan: abaikan active=false. Verifikasi: spec deactivate lalu submit.

#### HR-13 Tidak ada larangan "mengubah/menyetujui diri sendiri" di luar cuti, kasbon, approve slip (AUT) dampak 3, effort M
- Larangan ada pada cuti (CA-1-40), keputusan kasbon, approve slip [LEGACY-CLAIM leave.service.ts:276-286; loan-request.service.ts:244-247; payroll.service.ts:761]. Tidak ada pada `LoanService.deactivate/create` [LEGACY-CLAIM loan.service.ts:62-96], `EmployeeService.update` (gaji, rekening) [LEGACY-CLAIM employee.service.ts:847-1016], `AttendanceService.adjust/decide/createManual` [LEGACY-CLAIM attendance.service.ts:304-329,577-658], bonus/potongan/tunjangan [LEGACY-CLAIM adjustment.service.ts; allowance.service.ts]. Staf HR yang punya record karyawan dapat menghapus kasbon sendiri, mengubah gaji, atau menyetujui absensi PENDING miliknya. Mitigasi sebagian: approve slip oleh orang lain.
- Usulan: helper "bukan diri sendiri" pada jalur tulis sensitif. Keputusan kebijakan: HR lead.

#### HR-14 Jejak audit tidak membedakan aksi dan tidak merekam penolakan (AUT) dampak 3, effort S
- Interceptor menulis `action = method HTTP`, entity = segmen pertama path, entityId = uuid pertama, `before` null, `after` = body tersaring [LEGACY-CLAIM hr/src/infrastructure/http/audit.interceptor.ts:46-70,94-100]. `POST /payroll/:id/approve`, `/pay`, `/regenerate` tanpa body menghasilkan baris identik; stage 1 dan 2 cuti sama-sama PATCH leave dengan body {approve,note}. Hanya `unapprove` dan `reallocate` mencatat aksi eksplisit [LEGACY-CLAIM payroll.service.ts:810-818,890-898]. Hanya request sukses dicatat dan penulisan best-effort [LEGACY-CLAIM hr/src/application/services/audit.service.ts:11-17].
- Bukan pengulangan HR-2 lama (redaksi PII). Usulan: sertakan sisa path/verb pada `action`; catat transisi status.

#### HR-15 Kasbon APPROVED tanpa Loan bila proses mati di antara dua tulis (FLW) dampak 2, effort S
- Request ditandai APPROVED sebelum Loan dibuat; kegagalan loan dibalik `reopen`, tetapi crash di antaranya meninggalkan APPROVED/loanId null tanpa rekonsiliasi dan tanpa notifikasi [LEGACY-CLAIM loan-request.service.ts:337-372; hr/src/infrastructure/prisma/loan-request.prisma.repository.ts decide, reopen]. Usulan: laporan/penyapu APPROVED tanpa loanId.

#### C. Absensi, cuti, jadwal

#### HR-16 Rentang tanggal cuti tak terbatas; SICK/EMERGENCY tak tertahan kuota (FLW) dampak 3, effort S
- `SubmitLeaveDto` hanya `IsISO8601` [LEGACY-CLAIM hr/src/modules/dto/leave.dto.ts]; `workingDaysFor` mengiterasi tiap hari [LEGACY-CLAIM hr/src/domain/calendar.ts workingDaysInRange] dan query libur seluruh rentang. SICK/EMERGENCY tidak kena kuota [LEGACY-CLAIM hr/src/domain/leave.ts deductsQuota; leave.service.ts:120-127]. Pengajuan sampai tahun 9999 membakar CPU, tersimpan dengan workingDays jutaan, dan persetujuan HR menulis satu upsert berurutan per hari [LEGACY-CLAIM leave.service.ts:379-388]. Throttle hanya membatasi laju.
- Usulan: batas panjang rentang (mis. 90 hari). Tambahan dampak 1: kuota ditagih ke tahun startDate untuk rentang lintas tahun [LEGACY-CLAIM leave.service.ts:363-365].

#### HR-17 Cuti APPROVED tidak bisa dicabut; kuota dan baris LEAVE tak bisa dikembalikan (FTR) dampak 2, effort M
- Transisi hanya PENDING_* ke CANCELLED; APPROVED terminal [LEGACY-CLAIM hr/src/domain/leave.ts:46-57], padahal rentang APPROVED memblokir pengajuan overlap [LEGACY-CLAIM leave.service.ts:115-118]. Hanya impor saldo yang menimpa usedDays. Usulan: aksi HR "cabut" yang mengembalikan kuota dan baris LEAVE, dengan alasan dan audit.

#### HR-18 capturedAt dari klien memajukan check-in sampai 10 menit tanpa review (BI) dampak 2, effort S
- Punch dengan capturedAt dalam `offlineAutoAcceptMinutes` (default 10) diterima sebagai PRESENT/LATE memakai waktu klaim klien [LEGACY-CLAIM attendance.service.ts:144-147,185-190,294-301; hr/src/config/hr-config.service.ts:74-76]. Face match dan geofence tetap live. [ASSUMPTION] toleransi telat default 15 menit mungkin membuat ini kecil.

#### HR-19 Pengingat shift berhenti diam-diam saat penugasan > 5000 baris (FLW) dampak 2, effort S
- `listAllAssignmentsUpTo(latest, 5000)` mengurut `effectiveFrom ASC` lalu take [LEGACY-CLAIM hr/src/infrastructure/prisma/shift.prisma.repository.ts:118-124; hr/src/application/services/shift-reminder.service.ts ASSIGNMENT_LIMIT]; tabel append-only [LEGACY-CLAIM schema.prisma ShiftAssignment]. Setelah riwayat >5000, penugasan TERBARU terpotong dan karyawannya tak diingatkan, tanpa log. Klaim dibuat sebelum kirim dan notify tidak melempar, jadi kegagalan kirim hilang selamanya (diakui "ponytail").

#### HR-20 Publikasi pengumuman tanpa klaim: sweep tumpang tindih mengirim ganda (FLW) dampak 3, effort S
- `publish` mengirim notifikasi satu per satu lalu `markPublished` tanpa syarat `publishedAt null` [LEGACY-CLAIM hr/src/application/services/announcement.service.ts publish; hr/src/infrastructure/prisma/announcement.prisma.repository.ts:111-121]. Dua pemicu cron tumpang tindih, atau satu sweep mati di tengah banyak pengiriman, mengirim ulang ke semua penerima. Pembanding: shift reminder punya `claimShiftReminder`. Audiens dipotong 5000 hanya dengan log. Usulan: klaim atomik, atau kunci dedupe CRM (lihat handoff, PR #771).

#### D. Data pribadi / PDP

#### HR-21 Ekspor direktori karyawan: PII penuh, melewati redaksi depot peminjam, baca tidak diaudit (AUT) dampak 4, effort S
- `GET /hr-reports/employees` bergerbang hrView dan mengeluarkan NIK, NPWP, BPJS, rekening, alamat, tgl lahir, kontak darurat, gaji [LEGACY-CLAIM hr/src/modules/reports.controller.ts:81-95; hr/src/application/services/analytics.service.ts employeeReport]. Query memfilter `depotId` hidup tanpa `redactForLendingDepot` [LEGACY-CLAIM hr/src/infrastructure/prisma/analytics.prisma.repository.ts:266-275 vs employee.service.ts:295-298]. Dengan penugasan lintas depot aktif (DEPOT_ASSIGNMENT_ENABLED, default off) depot peminjam mengunduh data yang di daftar API sengaja disamarkan. Interceptor hanya mencatat mutasi, jadi unduhan massal tidak tercatat [LEGACY-CLAIM audit.interceptor.ts:15,29-31].
- Kontrol ada: scope depot; redaksi pada list/getById. Usulan: redaksi pada ekspor, batasi ekspor PII ke hrAdmin, catat unduhan.

#### HR-22 Injeksi formula pada ekspor CSV (AUT) dampak 3, effort S
- `escapeCell` hanya mengutip koma/kutip/newline; awalan = + - @ tidak dinetralkan [LEGACY-CLAIM hr/src/domain/csv.ts]. `leaveReport` mengekspor `reason` (teks bebas karyawan via self-service) dan `decisionNote` ke CSV default [LEGACY-CLAIM analytics.service.ts leaveReport; reports.controller.ts deliver]. Formula dieksekusi saat HR membuka CSV di Excel. XLSX menulis string biasa. Usulan: awali sel berbahaya dengan apostrof.

#### HR-23 Anonimisasi retensi meninggalkan pengenal langsung (BI, PDP) dampak 4, effort M
- `anonymiseRetentionEligible` dan `anonymiseByAuthSubjectId` hanya menimpa fullName, phone, email, photoUrl, authSubjectId (+role/status di jalur akun) [LEGACY-CLAIM hr/src/infrastructure/prisma/employee.prisma.repository.ts:42-99]. NIK (unik), NPWP, BPJS, tgl lahir, gender, alamat, rekening, kontak darurat tetap; EmploymentHistory (nilai gaji) dan LeaveRequest (alasan, attachmentUrl) tak dibersihkan; dokumen KTP/KK hanya terhapus bila sapuan terpisah `employee-documents/internal/retention-purge` dipanggil [LEGACY-CLAIM hr/src/application/services/document.service.ts purgeRetentionEligible] dan jalur hapus-akun tidak menghapus dokumen [LEGACY-CLAIM employee.service.ts:250-260]. Deskripsi endpoint hanya menyebut biometrik/absensi/review [LEGACY-CLAIM hr/src/modules/employees.controller.ts:63-71].
- [ASSUMPTION] pertanyaan: apakah retensi NIK/NPWP/rekening untuk kewajiban pajak/keuangan 10 tahun adalah keputusan sadar? Tidak ditemukan di docs/LEGAL_OPEN_ITEMS.md (SEARCH-hr-service-04). Jam dormansi memakai `updatedAt` yang bergeser tiap sentuhan baris.

#### HR-24 Kunci enkripsi template wajah tanpa versi (BI) dampak 2, effort M
- Blob = iv|tag|ciphertext tanpa id kunci; kunci = SHA-256 dari secret [LEGACY-CLAIM hr/src/infrastructure/crypto/face-vector.cipher.ts]. Rotasi `HR_FACE_ENCRYPTION_KEY` membuat semua template tak terbaca tanpa jalur migrasi. Belum ditemukan runbook rotasi kunci ini dalam cakupan (SEARCH-hr-service-05; docs/RUNBOOK_SECRET_ROTATION.md tidak dibaca isinya).

#### E. Integrasi dan konfigurasi

#### HR-25 Peran/nama/telepon dari konsol HQ tidak dicerminkan ke hr-service (FLW) dampak 3, effort M
- Route internal yang ada: provision, provision-many, status, depot, anonymise [LEGACY-CLAIM hr/src/modules/employees.controller.ts:96-175]. Belum ditemukan dalam cakupan hr-service route yang menerima perubahan role/nama/telepon dari auth-service. Payroll membaca `Employee.role` lokal (KEPALA_DEPOT: kenaikan masa kerja, tarif denda) [LEGACY-CLAIM payroll.service.ts:269,415-416]. Jabatan yang diubah di konsol HQ tanpa lewat HR membuat gaji/denda memakai peran lama. Sisi auth-service tidak dibaca (lihat handoff).

#### HR-26 STORAGE_DRIVER=local (default validasi env) menghasilkan penyimpanan nonaktif (FLW) dampak 2, effort S
- Validasi mengizinkan `local` (default) dan `STORAGE_LOCAL_DIR` [LEGACY-CLAIM hr/src/config/env.validation.ts STORAGE_DRIVER]; modul memilih S3 hanya bila 's3', selainnya `DisabledStorageAdapter` [LEGACY-CLAIM hr/src/modules/hr.module.ts providers STORAGE_PORT; hr/src/infrastructure/storage/disabled-storage.adapter.ts]. Upload dokumen 503 dan foto absensi tak tersimpan diam-diam di lingkungan non-S3.

#### Catatan negatif (kontrol memadai, jangan diulang)
Unique (employeeId,periodMonth) payroll; guard status pada setStatus/regenerate; klaim kuota cuti atomik; decide cuti/kasbon berguard status; partial unique kasbon PENDING; shift reminder claim; ledger depot append-only; alokasi largest-remainder BigInt; larangan self-approve slip/cuti/kasbon; kasbon fail-closed saat depot-service mati; redaksi peminjam pada list/getById; redaksi PII pada payload audit; tabel TER parsial ditolak.


#### F. Tambahan setelah pembacaan lanjutan

#### HR-27 HR dapat menautkan ulang karyawan ke akun login mana pun lewat authSubjectId (AUT) dampak 3, effort S
- `UpdateEmployeeDto` dan `CreateEmployeeDto` menerima `authSubjectId` (UUID) [LEGACY-CLAIM hr/src/modules/dto/employee.dto.ts CreateEmployeeDto/UpdateEmployeeDto]; `update` menyalin kunci itu ke baris [LEGACY-CLAIM hr/src/application/services/employee.service.ts:897-923] dan `create` memakainya alih-alih provisioning [LEGACY-CLAIM employee.service.ts:402]. Tidak ada pemeriksaan ke auth-service bahwa akun itu ada, milik orang yang dimaksud, atau berperan staf. Akun yang ditautkan menjadi "diri sendiri" pada slip gaji, kasbon, cuti, absensi (`getSelf`/`findByAuthSubjectId`), sehingga data slip karyawan A terbaca oleh pemilik akun yang ditautkan. Hanya unique index yang menahan (akun yang sudah tertaut ditolak) [LEGACY-CLAIM employee.service.ts:466-468].
- Kontrol ada: hrAdmin saja; uniqueness; riwayat ACCOUNT_LINKED hanya untuk jalur invite. Usulan: larang edit authSubjectId lewat PATCH (jalur khusus + validasi auth-service + catat riwayat), atau hapus dari DTO. Verifikasi: spec update menolak authSubjectId.

#### HR-28 FACE_VERIFIER_DRIVER: stub boleh di produksi, 'http' valid tapi jatuh ke ONNX (FLW) dampak 2, effort S
- Validasi env mengizinkan neo|onnx|http|stub tanpa larangan stub di production [LEGACY-CLAIM hr/src/config/env.validation.ts FACE_VERIFIER_DRIVER]. `StubFaceVerifier` memetakan hash byte gambar ke vektor, jadi frame yang sama persis selalu cocok [LEGACY-CLAIM hr/src/infrastructure/face/stub-face.verifier.ts]; di produksi itu berarti replay satu frame yang pernah dikirim lolos. Nilai 'http' tidak punya kelas; `switch` hr.module jatuh ke ONNX [LEGACY-CLAIM hr/src/modules/hr.module.ts providers FACE_VERIFIER]. Usulan: tolak stub bila NODE_ENV=production; buang 'http'.
- Catatan terkait (sudah diakui kode): liveness NEO default off [LEGACY-CLAIM hr-config.service.ts neoLiveness]; driver NEO mengabaikan `faceMatchThreshold` dan memakai `verified` dari penyedia [LEGACY-CLAIM neo-face.provider.ts verify].

#### HR-29 Objek jaringan (depotId kosong) dibuat tanpa pemeriksaan scope (AUT) dampak 2, effort S [ASSUMPTION]
- Aturan bonus, hari libur, shift, rotasi, departemen hanya memanggil `assertDepotAccess` bila `depotId` diisi; tanpa depotId objek berlaku jaringan [LEGACY-CLAIM hr/src/application/services/bonus-rule.service.ts create; holiday.service.ts create; shift.service.ts create; department.service.ts create]. Aman hanya jika tidak ada peran terikat-depot yang memegang `hrAdmin`. [ASSUMPTION] pertanyaan: apakah `hrAdmin` hanya HR/pusat di matriks @hydromart/access? (paket itu bukan milik hr-service dan tidak dibaca.)

#### HR-30 Template .env.example tidak memuat variabel yang wajib di produksi (FLW) dampak 2, effort S
- `hr/.env.example` tidak memuat HR_FACE_ENCRYPTION_KEY (wajib min 32 karakter di production), DEPOT_SERVICE_URL (wajib di production), CRM_SERVICE_URL, ORDER_SERVICE_URL, DEPOT_ASSIGNMENT_ENABLED, HR_PPH21_TER_TABLE_JSON [LEGACY-CLAIM grep hitungan 0 pada hr/.env.example; hr/src/config/env.validation.ts]. Env validasi akan menggagalkan boot produksi, tetapi template tidak memberi tahu. (Pola sejenis sudah tercatat di memory proyek, tidak dibaca ulang.)

#### G. Penambahan pada temuan sebelumnya (hasil pembacaan DTO/repository)
- HR-03: `AdjustAttendanceDto` tidak memvalidasi checkOutAt >= checkInAt maupun bahwa waktu jatuh pada workDate [LEGACY-CLAIM hr/src/modules/dto/attendance.dto.ts AdjustAttendanceDto].
- HR-09: `monthlyRate`, `dailyRate` (CreateEmployeeDto/UpdateEmployeeDto) dan `amount` tunjangan (CreateAllowanceDto) hanya `IsNumber IsPositive` tanpa @Max [LEGACY-CLAIM hr/src/modules/dto/employee.dto.ts; hr/src/modules/dto/allowance.dto.ts]; Decimal(12,2).
- HR-16: pembatas rentang sudah ada di tempat lain (`IsWithinDays('from')` pada ListAttendanceDto/OwnerSummaryQueryDto) [LEGACY-CLAIM hr/src/modules/dto/attendance.dto.ts; owner-attendance.dto.ts] tetapi tidak dipakai di SubmitLeaveDto, jadi perbaikan tinggal memakai dekorator yang sama.
- Ekspor laporan sudah dibatasi 50.000 baris dengan error (`MAX_EXPORT_ROWS`) [LEGACY-CLAIM hr/src/infrastructure/prisma/analytics.prisma.repository.ts allPages], jadi tidak diajukan sebagai temuan rentang laporan.

#### H. Pemeriksaan test untuk temuan utama (STRUCTURED-SCAN nama test; badan test hanya dibaca terarah)
- HR-01: hanya uji aritmetika (overtime.spec.ts: splitOvertime, overtimePay, break D2; payroll-branches.spec.ts "pays identical overtime..."). Tidak ada uji plafon atau persetujuan lembur. Tidak menutup temuan.
- HR-04: nol nama test yang menyebut bonus/THR/lembur bersama PPh/bruto. Test December ada (payroll.service.spec.ts "PPh 21 in December", statutory.spec.ts "December reconciliation") tetapi mengukur gross base+tunjangan. Tidak menutup temuan.
- HR-14: audit.interceptor.spec.ts menegaskan `action: 'POST'` (baris ~50), jadi perilaku ini terkunci oleh test, bukan kebetulan.
- HR-21: hanya `redactForLendingDepot` (depot-readers.spec.ts) dan "employees export defaults to CSV with a BOM" (controllers.spec.ts, delegasi). Tidak ada uji ekspor untuk depot peminjam. Tidak menutup temuan.
- HR-22: tidak ada uji awalan formula (csv.spec.ts hanya kutip koma/kutip/newline).
- HR-23: uji `anonymiseByAuthSubjectId (B-7)` menegaskan role/authSubjectId null (employee.service.spec.ts ~1371-1372); tidak ada pernyataan tentang NIK/NPWP/rekening/alamat.
- HR-19: tidak ada uji batas 5000. HR-02: "writes one LEAVE attendance row per working day" tidak menguji baris PRESENT yang sudah ada.



### Arsip wilayah services-order-service

Provenance: `agents/services-order-service/findings.md`.

#### Temuan audit services/order-service (HEAD 1e93545a2) - STATIC/WIRED saja
Path relatif ke services/order-service/. RUNTIME tidak mungkin.

#### ORD-01 [FLW] Outbox INVENTORY_CONSUME/LOYALTY_AWARD/REFERRAL_QUALIFY/FRANCHISE_REVENUE ditandai DONE walau downstream gagal
- Masalah: handler memanggil adapter fail-open yang menelan error, handler tidak throw, lalu markDone. [LEGACY-CLAIM src/infrastructure/http/inventory.http.adapter.ts:57-70 (consume catch->warn); loyalty-coordination.http.adapter.ts:59-62 (return null); referral-coordination.http.adapter.ts:39-44; franchise-revenue.http.adapter.ts:70-75 (return null); handler tanpa throw src/application/services/order.service.ts:383-440,2313-2345; markDone src/application/services/outbox.service.ts:125-127]. Adapter mengakui sendiri: franchise-revenue.http.adapter.ts:45-47. Tes mengunci: test/unit/http-adapters.spec.ts:116-119. Hanya GALLON_ISSUE, PAYMENT_REVERSAL, FRANCHISE_REVENUE_VOID fail-closed.
- Kontrol ada: outbox, retry 6x (10x utk reversal), sweep 10 menit (docs/RUNBOOK_INCIDENTS.md:151). Tujuan outbox (prisma/schema.prisma:366-377) tidak tercapai untuk 4 dari 7 topik. Belum ada di register docs (SEARCH-ORD-01).
- Usulan: adapter 4 topik itu melempar saat gagal bila dipanggil dari handler (mode strict); URL/key kosong tetap skip.
- Dampak 5 | Effort M | Risiko: retry ke downstream mati (backoff ada). Dependensi: penerima idempoten per orderId [ASSUMPTION sesuai komentar kode].
- Acceptance: downstream 500 -> baris PENDING, attempts naik, DEAD setelah batas; pulih -> DONE.
- Verifikasi: unit test handler+adapter; staging matikan depot-service, selesaikan order, cek GET orders/outbox/pending.
- Owner: backend order + SRE. Ditunda: stok drift, poin dan komisi franchise hilang diam-diam.

#### ORD-02 [FLW] Voucher tidak dikembalikan saat order dibatalkan (customer/staff/sweep)
- promo.release hanya dipanggil pada void konter dan checkout gagal [LEGACY-CLAIM order.service.ts:1434,2652; tidak ada di cancel() 1984-2025, updateStatus 3075-3121, expireAbandoned 2191-2306]. Voucher sekali-pakai hangus. Promo-service mungkin melepas lewat jalur lain [ASSUMPTION: H-03].
- Usulan: outbox topic VOUCHER_RELEASE bersama PAYMENT_REVERSAL pada transisi CANCELLED. Dampak 3 | Effort S | Risiko rendah. Acceptance: batalkan order bervoucher -> redemption bebas. Owner: backend order+promo. Ditunda: keluhan pelanggan, budgetCap terbakar.

#### ORD-03 [FLW/BI] Sweep pengingat pesan ulang: gagal dihitung sukses, tanpa dedupe, target tidak disaring
- notify mengembalikan boolean (tidak throw) tetapi then(() => true) membuat failed selalu 0 dan ok selalu true [LEGACY-CLAIM order.service.ts:1619-1632 vs notification.http.adapter.ts:96-104]. Bandingkan requestReviews yang benar (order.service.ts:1674-1685).
- Seleksi: MAX(createdAt) < cutoff termasuk order CANCELLED/VOIDED dan sentinel anonim, tertua dulu, LIMIT 500 [LEGACY-CLAIM src/infrastructure/prisma/order.prisma.repository.ts:323-330]; tak ada penanda sudah-diingatkan di schema; REORDER_REMINDER tanpa dedupeKey [LEGACY-CLAIM notification.http.adapter.ts:16-27]. Dijadwalkan harian (services/admin-service/src/domain/sweep-schedule.ts:36). Potensi: pelanggan dorman diingatkan tiap hari. Throttle di crm [ASSUMPTION: H-04].
- Usulan: pakai hasil boolean; penanda/dedupeKey per periode; saring void-like dan sentinel; jendela dorman maksimum. Dampak 3 | Effort M. Acceptance: sweep dua kali -> satu pesan; gagal -> failed>0. Owner: backend order+CRM.

#### ORD-04 [FLW] Order langganan: depot tidak diberi tahu, tanpa PPN, kebal sapuan -> CREATED menahan stok tanpa batas
- placeScheduled tidak memanggil notifyDepotOfOrder, taxPreview, promoAutoApply.apply, claimFavoriteDepot [LEGACY-CLAIM order.service.ts:1027-1093 vs checkout 756-850]. Order CREATED; sweep melewati subscriptionId bila subscriptionSweepExempt=1 (default) [LEGACY-CLAIM src/config/order-config.service.ts:98-102, setting-defs.ts:202-210, order.prisma.repository.ts:664]. Bayar langsung ke depot, tak ada konfirmasi otomatis.
- Usulan: kirim DEPOT_ORDER_INCOMING dan isi taxAmount di placeScheduled; batas umur khusus langganan (mis. 48 jam) + alert. Dampak 3 | Effort S-M. Acceptance: sweep langganan memicu notifikasi depot, taxAmount terisi, CREATED langganan lewat N jam teralert. Pertanyaan: sengaja tanpa PPN/promo? [ASSUMPTION]. Owner: backend order.

#### ORD-05 [FLW] deliveryWindow teks bebas membebaskan order dari sweep 4 hari tambahan
- Sweep mengecualikan order ber-deliveryWindow non-kosong selain EXPRESS sampai statusChangedAt lebih tua dari 4 hari + ambang [LEGACY-CLAIM order.prisma.repository.ts:671-675,85]. Klien bebas mengirim deliveryWindow (maks 40 char) tanpa scheduledFor [LEGACY-CLAIM src/modules/dto/order.dto.ts:115-123; order.service.ts:772-774]. Kolom scheduledFor sudah ada (migrasi 20261017100000_order_scheduled_for), sweep masih heuristik (komentar repo 77-81 menyebut akan diganti).
- Dampak: stok depot bisa ditahan 4+ hari oleh order CREATED. Usulan: pakai scheduledFor (+toleransi), abaikan label bebas. Dampak 3 | Effort S. Acceptance: label tanpa scheduledFor kena sweep normal. Owner: backend order.

#### ORD-06 [FLW/BI] Penjualan konter COMPLETED + efek (stok, poin, komisi) sebelum pembayaran tercatat
- walkInSale tidak memanggil payment-service; port PaymentCash hanya membaca [LEGACY-CLAIM order.service.ts:1127-1354; payment-cash.http.adapter.ts]. Pembayaran dicatat klien sesudahnya; web mengakui celah dan menambah retry [rujukan luar owner: apps/web/test/counter-payment-retry.test.tsx:2-12]. Outbox komisi/poin ditulis saat order dibuat (order.service.ts:1261-1265).
- Belum ditemukan dalam cakupan service ini: rekonsiliasi order konter COMPLETED tanpa payment PAID (SEARCH-ORD-03). Klien non-web [ASSUMPTION: H-05].
- Usulan: laporan/alert harian order konter COMPLETED vs cashByOrder; atau endpoint atomik. Dampak 4 | Effort M. Acceptance: selisih tampil di depotDaily. Owner: backend order+payment, ops kasir.

#### ORD-07 [FLW/BI] Data kurir/ETA tidak dikosongkan saat order kembali ke PREPARING
- applyStatus hanya menulis driverName/driverPhone/estimatedArrivalAt bila non-null [LEGACY-CLAIM order.prisma.repository.ts:757-760]; graf mengizinkan DRIVER_ASSIGNED/PICKED_UP/ON_DELIVERY -> PREPARING [src/domain/order-status.ts:42-48]. Tracking publik menampilkan driverFirstName/ETA lama [order.prisma.repository.ts:466-489]. Dampak 2 | Effort S. Usulan: null saat to=PREPARING. Acceptance: tes transisi balik.

#### ORD-08 [BI] Definisi revenue tidak konsisten; refund tidak dinetkan
- sumDepotSales (bonus HR): DELIVERED/COMPLETED by createdAt [order.prisma.repository.ts:561-571]. salesSeries/topDepots/depotDaily: semua non-CANCELLED/VOIDED termasuk CREATED/in-flight [813-857,885-911; src/application/services/report.service.ts:1035-1061]. Komisi franchise saat COMPLETED amount=total [order.service.ts:2332-2345]. Tak ada yang mengurangi refundedAmount; total termasuk ongkir dan PPN. failedDeliveries = hitungan CANCELLED termasuk batal pelanggan/sweep [report.service.ts:1067]. refundsByDepot berdasar createdAt order [order.prisma.repository.ts:1071-1092].
- Usulan: kamus metrik (booked/realized/net), ganti nama kolom; failedDeliveries dari delivery-service. Dampak 3 | Effort M. Owner: finance + backend.

#### ORD-09 [BI] completedAt feed internal/completed = updatedAt
- src/modules/order.controller.ts:581-584 memakai updatedAt; berubah oleh claimReviewRequest/recordRefund/assignDepot [INFERRED: perilaku updatedAt Prisma, prisma/schema.prisma:165]. Kolom benar statusChangedAt. Konsumen recommendation-service. Dampak 2 | Effort S.

#### ORD-10 [FLW] internal-refund menimpa refundedAmount tanpa batas/idempotensi
- recordRefund = set, bukan tambah [order.prisma.repository.ts:1124-1126]; DTO Min(0) tanpa max [order.dto.ts:296-301]; tak ada cek <= total/status; tiap panggilan mengirim REFUND_PROCESSED tanpa dedupe [order.service.ts:3138-3146] sehingga retry payment-service = pesan ganda. Payment-service kini refund penuh (rujukan payment.service.ts:950,1290) sehingga risiko parsial laten. Dampak 2 | Effort S. Usulan: validasi 0<amount<=total, dedupeKey.

#### ORD-11 [FLW] Batas jumlah kurang: akumulasi keranjang dan langganan
- Cart add: existing+delta tanpa tutup (Max 999 hanya delta) [cart.service.ts:165-167; cart.dto.ts:10-15]. CreateSubscriptionDto.quantity tanpa Max, firstDeliveryAt tanpa batas, tak ada batas langganan per pelanggan [order.dto.ts:384-410]. Dampak 2 | Effort S.

#### ORD-12 [FLW] Outbox: jalur inline terpotong backlog; DEAD tanpa alert/requeue kecuali PAYMENT_REVERSAL
- processForOrder = findDue(limit 50) lalu filter orderId [outbox.service.ts:102-108]. DEAD hanya alert untuk PAYMENT_REVERSAL (140-151); tak ada endpoint requeue (order.controller.ts:356-396). Dampak 3 | Effort S-M. Usulan: query by orderId; alert DEAD semua topik uang/stok; requeue admin.

#### ORD-13 [AUT/BI] Anonimisasi langganan menyisakan alamat dan koordinat
- erasePerson hanya mengosongkan recipientName/phone/notes [subscription.prisma.repository.ts:205-208]. Apakah alamat masuk lingkup keputusan UU PDP item 13: [ASSUMPTION]. Dampak 3 | Effort S.

#### ORD-14 [BI] Impor penjualan historis: struk multi-baris, lineTotal tak divalidasi, tumpang tindih dengan data live
- unique(depotId, externalRef) dan satu productLabel per baris [prisma/schema.prisma:424-436]: baris kedua struk yang sama jadi duplikat dan dilewati (kecuali wizard memberi suffix: H-06). lineTotal tak dicek = unitPrice*quantity; occurredAt tak dibatasi sebelum go-live, hasil digabung ke revenue depot [report.service.ts:526-551; sales-import.dto.ts]. orders dihitung per baris. Dampak 3 | Effort S-M.

#### ORD-15 [FLW] Review: race ganda -> 500; tipAmount hanya dicatat
- cek findReviewByOrderId lalu create tanpa tangkap P2002 [order.service.ts:1938-1948]; tip tanpa jalur bayar di service ini [schema.prisma:339]. Dampak 1.

#### ORD-16 [FLW] Idempotency-Key opsional dan tanpa validasi panjang
- Header dipakai langsung; tanpa header = tanpa proteksi [order.controller.ts:121-145; order.service.ts:2994-2996]. Dampak 2 | Effort S: wajibkan untuk klien app, maks 64 char.

#### ORD-17 [FLW] Langganan: kegagalan sementara menjeda plan dalam 3 siklus; error setelah order terbentuk ikut dihitung
- MAX_CONSECUTIVE_FAILURES=3, sweep per jam [subscription.service.ts:44,313-316,350-353]; stok habis/depot tutup diperlakukan sama dengan data rusak; bila advance melempar setelah placeScheduled sukses, failure tercatat padahal order ada. Dampak 2 | Effort S: bedakan error transien.

Catatan umum ORD-02..17: acceptance = tes unit yang gagal sebelum perbaikan; verifikasi = jalankan suite order-service (oleh tim, bukan audit ini); owner default backend order.

---
#### Tambahan putaran 2 (verifikasi ORD-01 + bacaan lengkap sisa file)

#### Verifikasi ORD-01 (lengkap)
- Alur penuh dibaca: producer tx (order.prisma.repository.ts:748-765 applyStatus; 1102-1119 voidWalkIn; 430-442 create) -> OutboxService.processForOrder/processDue/run/deliver (outbox.service.ts:78-203) -> handler terdaftar (order.service.ts:337-345) -> adapter. run() hanya memanggil markFailed bila deliver() melempar (outbox.service.ts:124-131); handler 4 topik tidak melempar karena port didokumentasikan fail-open: ports/inventory.port.ts:1-12, loyalty-coordination.port.ts:1-10, referral-coordination.port.ts:1-8, franchise-revenue.port.ts:30-40 ("Fails OPEN"). Tes mengunci: test/unit/http-adapters-errors.spec.ts:74,110,195-220 ("swallows a 500"), http-adapters.spec.ts:116-119.
- Konfirmasi lawan: ports/gallon-issue.port.ts:15-22 menyatakan "unlike the fail-open adapters it MUST throw" (GALLON_ISSUE benar), payment-reversal dan orderVoided melempar. Jadi 3 dari 7 topik benar, 4 tidak. Jadwal retry nyata: crontab */10 (scripts/scheduler/crontab:37), komentar di crontab:31-36 menyebut jalur ini "purely the RETRY path" -> untuk 4 topik jalur itu tidak pernah berisi baris.
- Tambahan: URL/key kosong (PAYOUT_SERVICE_URL dsb.) juga membuat baris DONE tanpa efek (franchise-revenue.http.adapter.ts:27-32; inventory.http.adapter.ts:46-50; loyalty-coordination.http.adapter.ts:30-33). Status final: TERVERIFIKASI (STATIC + test-pinned). RUNTIME: tidak diuji.

#### Jadwal cron (menutup klaim "tidak terverifikasi")
- orders/internal/expire-abandoned: menit ke-5 tiap jam (crontab:53); efektif order CREATED dibatalkan 60-120 menit setelah dibuat (abandonMinutes 60 + granularitas jam).
- orders/reminders/review: tiap 10 menit (crontab:147). orders/reminders/reorder: 08:00 harian (crontab:30). subscriptions/process-due: tiap jam menit 0 (crontab:28). outbox: */10 (crontab:37). daily-sales-broadcast: 07:30 pagi, 13:00 siang, 21:00 sore (crontab:93-95). sweep.sh memakai lock per job, timeout 600 dtk, dan membaca "ok":false dari badan respons (sweep.sh:~118-130) -> bug ORD-03 (ok selalu true) membuat kegagalan notifikasi reorder tak pernah memerahkan heartbeat.

#### ORD-18 [FLW/KONFIG] URL/key integrasi boleh kosong di production dan diam-diam menonaktifkan efek uang
- env.validation.ts:589 (PAYOUT_SERVICE_URL allow ''), :646 (PAYMENT_SERVICE_URL), :647-648; tidak ada `when NODE_ENV=production required` (hanya AUTH_SERVICE_URL, :656-660). Akibat: PAYOUT kosong -> komisi franchise dilewati lalu DONE (ORD-01); PAYMENT kosong -> setiap pembatalan menghasilkan PAYMENT_REVERSAL gagal sampai DEAD (~8,5 jam) dan void konter ditolak (payment-reversal.http.adapter.ts:40-43). .env.example usang: memuat ORDER_DELIVERY_FEE (tak ada di skema validasi) dan tidak memuat PAYMENT/PAYOUT/DELIVERY/HR/AUTH/ADMIN_SERVICE_URL. Dampak 3 | Effort S. Usulan: wajibkan PAYMENT_SERVICE_URL & PAYOUT_SERVICE_URL di production; rapikan .env.example. Acceptance: boot production tanpa kedua URL gagal. Owner: SRE+backend.

#### ORD-19 [BI] VOIDED diperlakukan sebagai penjualan di rekonsiliasi meter dan ekspor harian
- meter.service.ts:25-27 `totalsFrom` hanya mengecualikan CANCELLED, sedangkan report.service.ts:432-433 `countsAsSale` mengecualikan CANCELLED dan VOIDED (dan komentar meter.service.ts:60-62 menjanjikan "same rows depotDaily reads"). Penjualan konter yang di-void (barang kembali ke rak) tetap dihitung sebagai liter terjual/omzet -> variance meter vs jual bias dan alert dapat lolos. Juga depotDailyRows/PDF: flag `cancelled` hanya CANCELLED (report.service.ts:1162) dan PDF mencetak total untuk baris VOIDED (depot-daily-pdf.ts, kolom Total: `r.cancelled ? 'Batal' : rupiah`), padahal ringkasan harian mengecualikannya. Pesanan in-flight (CREATED..ON_DELIVERY) juga ikut liter terjual meter. Dampak 3 | Effort S. Acceptance: tes totalsFrom dengan order VOIDED -> tidak terhitung. Owner: backend order.

#### ORD-20 [BI] Segmen/audiens broadcast menyertakan sentinel pelanggan anonim
- segmentPredicates (order.prisma.repository.ts:1531-1549) dan audienceReach (1338-1346) hanya NOT_VOID_SQL; retentionCohort/newVsRepeat/depotCustomerAggregates/topCustomers justru mengecualikan ANONYMOUS_CUSTOMER_ID (1236-1239, 1616-1620, 1313). Sentinel bisa lolos kriteria minOrders dan dikembalikan ke crm lewat internal/segment-customers (report.controller.ts:448-454); hitungan audiens +1 dan target campaign tak berponsel valid ('-'). Dampak 2 | Effort S.

#### ORD-21 [FLW/PERF] DTO laporan: rentang terbuka dan depotIds tak tervalidasi
- sales/top-customers/top-depots/revenue-by-category/retention/rating/shipping/refunds menerima from/to opsional; IsWithinDays hanya aktif bila keduanya ada, jadi tanpa parameter = scan seluruh tabel orders [report.dto.ts:22-62, 306-335; hanya StatusSummaryQueryDto mewajibkan keduanya, :152-165]. depotIds di SalesReport/TopReport hanya @IsString (komentar :174 sendiri mengakui string polos jadi 500 di kolom uuid). DepotCompare.depotIds dan ResellerRollup.customerIds tak dibatasi jumlah (:202-218, 263-268); internal export-rows/report-table tanpa batas jendela (:271-304). Dampak 2 | Effort S.

#### ORD-22 [FLW/DOK] Kontrak yang usang di komentar port/jadwal; race 500 minor
- ports/promo.port.ts header: redeem "fails OPEN", sebaliknya promo.http.adapter.ts:137-148 melempar (fail-closed) dan order.service.ts:2618-2619 bergantung padanya. ports/payment-reversal.port.ts:19-23 "called BEFORE the status is written" sedangkan cancel() kini status-first (order.service.ts:1997-2017). crontab:20-21 menyebut expire-abandoned tanpa catch per baris, kode sudah punya (order.service.ts:2253-2265). report.service.ts:1414-1417 menyebut notify "returns void" padahal boolean; broadcastDailySales menghitung `attempted` tanpa melihat boolean (1454-1472) sehingga ok=true walau semua pesan gagal (sama dengan ORD-03).
- Race jadi 500 (bukan 409): MeterService.save findUnique lalu create pada unique (depotId,readingDate) [meter-reading.prisma.repository.ts:84-117]; review ganda (ORD-15). ORDERS_DETAIL terpotong membuang pesanan terbaru karena urut ASC lalu take cap+1 [order.prisma.repository.ts:1581-1613]. Dampak 1-2.

#### Tambahan ORD-22 (errors.ts dibaca penuh)
- src/domain/errors.ts:226-233 VoidWindowClosedError berpesan "bukan hari ini, jadi tidak bisa dibatalkan", padahal aturan void sekarang berbasis shift (order.service.ts:1388-1391); pesan menyesatkan kasir. Pesan ke pelanggan/kasir bercampur bahasa Inggris (EmptyCartError :89, OutOfServiceAreaError :132, DepotRequiredError :145, DepotUnavailableError :191, VoucherRejectedError :199, InsufficientStockError :331, StockCheckUnavailableError :351, OrderNotCancellableError :406). Dampak 1.
