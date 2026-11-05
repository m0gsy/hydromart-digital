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
