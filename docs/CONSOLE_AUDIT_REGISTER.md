# Register audit konsol — CONSOLE_AUDIT_REGISTER

Sumber: artefak **“Audit Konsol Hydromart”** (audit dijalankan 26–31 Agustus 2026; §50 “Deep check
laporan ini” ditulis 1 September 2026) silang dengan **docs/AUDIT_L3.md** (25 Agustus 2026).

Register ini adalah **state loop**, bukan ringkasan. Tiap PR yang merge memperbarui kolom
`Status` dan `PR` pada baris-barisnya, di PR yang sama. Kalau sesi terputus, register ini
menunjukkan posisi persis.

Bukti re-cek per kartu Kritis dan Tinggi ada di [CONSOLE_AUDIT_RECHECK.md](CONSOLE_AUDIT_RECHECK.md).

---

## Cara membaca

**Status**

| Nilai | Arti |
| --- | --- |
| `TERBUKA` | belum dikerjakan |
| `SUDAH DIPERBAIKI (PR #x)` | ditutup di `main`, dengan nomor PR yang menutupnya |
| `DUPLIKAT DARI <ID>` | kartu yang sama dilaporkan dua kali; baris ini tetap ada supaya nomornya tidak bergeser |
| `KEPUTUSAN` | repo punya komentar berkode yang menyatakan ini disengaja — tidak diperbaiki tanpa jawaban pemilik |
| `DITOLAK` | premisnya gugur saat dibuka; barisnya tetap ada beserta alasannya |

**Kelas akar** (dari §50 kekurangan 4, plus dua yang §50 namai tapi tidak beri kelas)

| Kelas | Isi |
| --- | --- |
| `depot-scope-by-id` | `DepotScopeGuard` hanya membaca kunci bernama `depotId`/`depotIds`; route `:id` dan `:orderId` lolos. 165 parameter by-id, 44 dari 57 controller tanpa `assertDepotAccess` maupun `depotScopeIds` |
| `gerbang-kapabilitas` | 45 dari 61 pintu rail /hq tanpa gerbang; 58 dari 64 halaman /hq tidak menggerbang dirinya |
| `confirm-dialog` | komponennya ada, 4 dari 132 halaman konsol memakainya |
| `pdp-registry` | penghapusan atas permintaan tidak punya registry setara `purge-executor.registry.ts`; 9 tabel AUDIT_L3 §4.2 |
| `jalur-uang` | uang berpindah, atau berhenti berpindah, tanpa penjaga |
| `proyeksi-publik` | halaman staf membaca route `@Public()` yang mengembalikan proyeksi yang lebih sempit |
| `sweep-tanpa-penonton` | pekerjaan terjadwal tanpa halaman, jadi audit yang digerakkan halaman tidak melihatnya |
| `lain` | belum punya akar bersama — dikerjakan sebagai tiket satuan |

---

## Koreksi terhadap laporan sumber

Ditulis di sini supaya tidak hilang, sesuai §50 kekurangan 8:

1. **Tiga duplikat, tidak dihapus, ditandai.** `CA-1-10` (§4 Tinggi) duplikat `CA-1-42` (§10 Sedang)
   atas `payroll.service.ts:88` yang sama — dan §10 **membantah** kartu §4 (“‘Hilang permanen’ tidak
   benar”) tanpa kartu §4 pernah ditarik. `CA-4-20` duplikat `CA-4-18` (tangga bonus MINGGUAN vs
   BULANAN, dua kali di §44, keduanya Tinggi). `CA-4-27` duplikat `CA-4-25` (label `INCENTIVE`, dua
   kali di §44, keduanya Rendah).
2. **Aritmetika §15.** §15 menulis “138 klaim, 23 gugur, 115 bertahan”. Yang benar **38 gugur**,
   seperti §14 dan paragraf penutup — hanya dengan 38 jumlah 546/86/460 bisa ditutup.
3. **Dateline.** Kepala laporan menulis 26 Agustus; penutupnya menulis 26–31 Agustus. Yang dipakai
   register ini: **26–31 Agustus 2026**, dengan §50 pada 1 September 2026.
4. **Satu Kritis bertentangan dengan AUDIT_L3, dan AUDIT_L3 yang benar.** Kartu `CA-3-01` menyuruh
   scrub `order-service`. AUDIT_L3 §4.2 mengukur `order.orders.phone`/`recipientName`/`driverPhone`
   (813 baris) sebagai **pengecualian yang tertulis** — kelas FINANCIAL, 10 tahun, dinyatakan di
   `notIncluded` pada payload ekspor. **Keputusan pemilik 1 September 2026: retensi TETAP; yang
   salah adalah kalimat di halaman /hapus-akun.** Perbaikan `CA-3-01` berubah jadi perbaikan teks
   plus menuliskan pengecualiannya. Lihat langkah 04.
5. **AUDIT_L3 menemukan sembilan tabel, bukan satu.** Delapan tabel di luar `order.orders` tidak
   muncul di audit konsol sama sekali; semuanya masuk register ini di Bagian V/langkah 04.

---

## Ringkasan hitungan


| Yang dihitung | Angka |
| --- | --- |
| Baris register, seluruhnya | **280** |
| — kartu individual (§50: 219 + 2 dicoret) | 221 |
| — baris dari tabel ringkas | 59 |
| Kritis / Tinggi / Sedang / Rendah | 9 / 67 / 100 / 43 |
| Baris SAPUAN | 11 |

**Per kelas akar:** `lain` 126 · `jalur-uang` 83 · `gerbang-kapabilitas` 31 · `pdp-registry` 13 · `depot-scope-by-id` 12 · `confirm-dialog` 11 · `sweep-tanpa-penonton` 3 · `proyeksi-publik` 1

**Per status** (1 September 2026, sesudah langkah 04): `TERBUKA` 260 · `SUDAH DIPERBAIKI` 14 ·
`DUPLIKAT` 3 · `DITOLAK` 2 · `KEPUTUSAN` 1

> Sepuluh sel §28 memayungi **136 item** yang laporan sumber hitung tapi tidak pernah tiketkan;
> satu baris CA-5 memayungi **14 sweep**. Merencanakan 460 tiket melebihkan pekerjaan sekitar dua
> kali lipat; merencanakan 219 melewatkan justru sapuan-sapuan ini.

---


## Bagian I — Modul HR (§1–§15, 37 halaman)

| ID | Bagian | Tingkat | Judul | file:baris | Kelas akar | Status | Bukti re-cek | PR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CA-1-01` | §2 | Sedang | Baris absensi tidak menyebut siapa pun | `apps/web/src/app/hr/attendance/page.tsx:145–149` | `lain` | TERBUKA | — | — |
| `CA-1-02` | §2 | Sedang | Aset yang dipegang orang yang sudah keluar tertulis “dipegang karyawan” | `apps/web/src/app/hr/assets/page.tsx:75, :277, :292–293` | `lain` | TERBUKA | — | — |
| `CA-1-03` | §2 | Sedang | Jejak audit tidak menampilkan pelaku maupun isi perubahan | `apps/web/src/app/hr/audit/page.tsx:36–39` | `lain` | TERBUKA | — | — |
| `CA-1-04` | §3 | Tinggi | Tunjangan tidak diprorata terhadap tanggal berlakunya sendiri | `services/hr-service/src/application/services/payroll.service.ts:187` | `jalur-uang` | SUDAH DIPERBAIKI | baris :188 kini `amount: Math.round(rupiah(a.amount) * window.fraction)`, komentar D6 di :182-184 | #122 |
| `CA-1-05` | §3 | Tinggi | Sisa kasbon dihitung dari bulan yang berlalu, bukan dari yang benar-benar terpotong | `services/hr-service/src/domain/loan.ts:42` | `jalur-uang` | TERBUKA | `export function loanRemainingAfter(loan: LoanTerms, period: string): number {` | — |
| `CA-1-06` | §3 | Sedang | Payroll bisa digenerate untuk bulan berjalan dan mendenda hari yang belum terjadi | `services/hr-service/src/application/services/payroll.service.ts:273 · payroll/page.tsx:25` | `jalur-uang` | TERBUKA | — | — |
| `CA-1-07` | §3 | Sedang | currentPeriod() memakai bulan UTC, bukan bulan WIB | `apps/web/src/lib/hr.ts:717` | `lain` | TERBUKA | — | — |
| `CA-1-08` | §4 | Tinggi | Bonus yang dibuat setelah payroll disetujui hilang diam-diam | `apps/web/src/app/hr/adjustments/page.tsx:143` | `jalur-uang` | TERBUKA | `<p className="text-xs text-muted">{t('hrFix.adjustments.entersPayroll')}</p>` | — |
| `CA-1-09` | §4 | Tinggi | Bonus dan potongan yang salah ketik tidak bisa dihapus dari mana pun | `services/hr-service/src/modules/adjustment.controller.ts:23–67` | `jalur-uang` | TERBUKA | `@Get()` | — |
| `CA-1-10` | §4 | Tinggi | Payroll bisa dikunci meski masih ada absen PENDING | `services/hr-service/src/application/services/payroll.service.ts:88` | `jalur-uang` | DUPLIKAT DARI CA-1-42 | berkas:baris identik dengan kartu §10 (CA-1-42); §10 membantah kalimat "hilang permanen" dan kartu §4 tidak pernah ditarik | — |
| `CA-1-11` | §5 | Tinggi | Setujui dan Tandai Dibayar langsung eksekusi | `apps/web/src/app/hr/payroll/detail/page.tsx:96–97` | `confirm-dialog` | TERBUKA | `{canRun && (` | — |
| `CA-1-12` | §5 | Tinggi | Hapus departemen tanpa konfirmasi — dan tanpa pemeriksaan referensi | `apps/web/src/app/hr/departments/page.tsx:109 · department.service.ts:53` | `confirm-dialog` | TERBUKA | `<Button variant="ghost" onClick={() => remove(d.id)}>` | — |
| `CA-1-13` | §5 | Sedang | Reset setelan denda dan tarif absen tanpa konfirmasi | `apps/web/src/app/hr/settings/page.tsx:115` | `confirm-dialog` | TERBUKA | — | — |
| `CA-1-14` | §5 | Rendah | Absen manual menimpa catatan kehadiran yang sudah ada | `apps/web/src/app/hr/attendance/page.tsx:96` | `lain` | TERBUKA | — | — |
| `CA-1-15` | §5 | Rendah | Batalkan pengajuan cuti sendiri tanpa konfirmasi | `apps/web/src/app/hr/me/leave/page.tsx:176` | `confirm-dialog` | TERBUKA | — | — |
| `CA-1-16` | §6 | Tinggi | Antrean cuti berhenti di 20 permohonan, tanpa halaman 2 | `apps/web/src/app/hr/leave/page.tsx:53 · endpoints/hr.ts:217` | `lain` | TERBUKA | `api.get<HrPage<LeaveRequest>>(endpoints.hr.leaveQueue({ status: status \|\| undefined }), true),` | — |
| `CA-1-17` | §6 | Tinggi | Pemilih karyawan terkunci di 100 orang aktif | `apps/web/src/components/hr/employee-select.tsx:44` | `lain` | KEPUTUSAN | komentar berkode `ponytail:` di employee-select.tsx:42-43 menyatakan 100 = `@Max` DTO dan menyebut picker cari-sambil-ketik sebagai perbaikan yang benar — TANYA PEMILIK | — |
| `CA-1-18` | §6 | Sedang | Setiap daftar berhenti di 100 baris walau totalnya ditulis di judul | `employees:87 · attendance:31,:89 · payroll:30 · audit:21 · assets:57` | `lain` | TERBUKA | — | — |
| `CA-1-19` | §6 | Rendah | Riwayat absensi karyawan sendiri terkunci 60 baris terakhir | `apps/web/src/app/hr/me/attendance/page.tsx:17` | `lain` | TERBUKA | — | — |
| `CA-1-20` | §7 | Sedang | POST /payroll/generate-batch lengkap dengan laporan gagal per orang — nol pemanggil | `services/hr-service/src/modules/payroll.controller.ts:114` | `jalur-uang` | TERBUKA | — | — |
| `CA-1-21` | §7 | Sedang | Filter depot didukung seluruh API, tidak pernah ditawarkan | `apps/web/src/lib/endpoints/hr.ts:106 · reports/page.tsx:62,:118,:149` | `lain` | TERBUKA | — | — |
| `CA-1-22` | §7 | Sedang | Rule bonus tidak bisa diedit walau DTO-nya menerima delapan field | `apps/web/src/app/hr/rules/page.tsx:78` | `jalur-uang` | TERBUKA | — | — |
| `CA-1-23` | §7 | Sedang | Libur dan shift khusus depot tidak bisa dibuat, padahal dibedakan saat ditampilkan | `apps/web/src/app/hr/calendar/page.tsx:33, :44` | `lain` | TERBUKA | — | — |
| `CA-1-24` | §7 | Sedang | Log koreksi absensi ditulis lengkap, tidak bisa dibaca dari mana pun | `services/hr-service/src/application/ports/attendance.repository.ts:84` | `lain` | TERBUKA | — | — |
| `CA-1-25` | §7 | Rendah | Filter status payroll didukung API dan builder, tanpa kontrol | `apps/web/src/app/hr/payroll/page.tsx:30` | `jalur-uang` | TERBUKA | — | — |
| `CA-1-26` | §7 | Rendah | Respons cuti tidak sesuai tipe yang dipakai klien | `services/hr-service/src/modules/leave.controller.ts:62` | `lain` | TERBUKA | — | — |
| `CA-1-27` | §8 | Tinggi | Tunjangan dipagari hrAdmin, servernya minta hrPayroll | `apps/web/src/app/hr/allowances/page.tsx:16 · allowance.controller.ts:28,:36,:44` | `gerbang-kapabilitas` | TERBUKA | `const isAdmin = canManageHr(customer?.role);` | — |
| `CA-1-28` | §8 | Sedang | Tombol Setujui cuti tahap 1 muncul untuk peran tanpa leaveApprove | `apps/web/src/app/hr/leave/page.tsx:110` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-1-29` | §8 | Sedang | Daftar pengumuman tidak di-scope dan ikut membawa draft | `services/hr-service/src/modules/announcement.controller.ts:32` | `depot-scope-by-id` | TERBUKA | — | — |
| `CA-1-30` | §8 | Rendah | Halaman tulis karyawan bisa dibuka lewat URL oleh peran yang hanya boleh membaca | `apps/web/src/app/hr/employees/detail/edit/page.tsx:12` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-1-31` | §8 | Rendah | Dua endpoint HR melewatkan scope depot | `rules.controller.ts:30 · reports.controller.ts:197` | `depot-scope-by-id` | TERBUKA | — | — |
| `CA-1-32` | §8 | Rendah | Menu Pelanggan dan Reseller tampil untuk peran yang API-nya menolak | `apps/web/src/components/hr/hr-rail.tsx:41–42` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-1-33` | §9 | Sedang | Konsol HR tidak punya navigasi apa pun di bawah 640px | `apps/web/src/app/hr/layout.tsx:44 · hr-rail.tsx:69` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-1-34` | §9 | Sedang | Kasbon punya halaman import, tidak punya halaman daftar | `apps/web/src/app/hr/loans/import/page.tsx` | `jalur-uang` | TERBUKA | — | — |
| `CA-1-35` | §9 | Sedang | Filter daftar karyawan hilang setelah menekan kembali | `apps/web/src/app/hr/employees/page.tsx:76–78` | `lain` | TERBUKA | — | — |
| `CA-1-36` | §9 | Sedang | Staf HR sendiri tidak punya jalan ke /hr/me | `apps/web/src/components/hr/hr-rail.tsx:37` | `lain` | TERBUKA | — | — |
| `CA-1-37` | §9 | Rendah | Dari Departemen tidak ada jalan ke karyawan di dalamnya | `apps/web/src/app/hr/departments/page.tsx:98` | `lain` | TERBUKA | — | — |
| `CA-1-38` | §10 | Tinggi | Payroll mengabaikan rota yang HR susun sendiri | `services/hr-service/src/application/services/payroll.service.ts:598, :667, :699 · leave.service.ts:287 · performance.service.ts:242` | `jalur-uang` | TERBUKA | `const standardWorkingMinutes = this.config.standardWorkingMinutes(depotId);` | — |
| `CA-1-39` | §10 | Tinggi | Jam istirahat ikut dibayar sebagai lembur, setiap hari, untuk semua orang | `services/hr-service/src/application/services/attendance.service.ts:133` | `jalur-uang` | TERBUKA | `const score = await this.assertFace(employee, punch);` | — |
| `CA-1-40` | §10 | Tinggi | Staf HR bisa menyetujui cutinya sendiri, dua tahap sekaligus | `services/hr-service/src/application/services/leave.service.ts:176–202 · modules/leave.controller.ts:80, :92` | `gerbang-kapabilitas` | TERBUKA | `async decideManager(` | — |
| `CA-1-41` | §10 | Sedang | Tabel TER PPh 21 tidak bisa disimpan — server menolak di 128 karakter | `services/hr-service/src/modules/dto/settings.dto.ts:16 · config/setting-defs.ts:224` | `lain` | TERBUKA | — | — |
| `CA-1-42` | §10 | Sedang | Payroll bisa dikunci meski masih ada absen PENDING | `services/hr-service/src/application/services/payroll.service.ts:88, :448` | `jalur-uang` | TERBUKA | — | — |
| `CA-1-43` | §10 | Sedang | Kontrak PKWT dan masa percobaan yang akan berakhir tidak muncul di layar mana pun | `services/hr-service/src/application/services/analytics.service.ts:63 · schema.prisma:238` | `lain` | TERBUKA | — | — |
| `CA-1-44` | §10 | Sedang | HR tidak bisa mengajukan cuti atas nama karyawan | `services/hr-service/src/application/services/leave.service.ts:68 · modules/leave.controller.ts:38` | `lain` | TERBUKA | — | — |
| `CA-1-45` | §10 | Sedang | THR tidak punya rumus prorata | `services/hr-service/prisma/schema.prisma:113` | `lain` | TERBUKA | — | — |
| `CA-1-46` | §10 | Rendah | Kuota cuti tahunan datar untuk semua | `services/hr-service/src/application/services/leave.service.ts:291` | `lain` | TERBUKA | — | — |
| `CA-1-47` | §10 | Rendah | Kedaluwarsa dokumen tidak pernah dibaca — dan tidak ada tipe dokumen SIM | `services/hr-service/src/application/services/document.service.ts:99 · employee-documents.tsx:98` | `lain` | TERBUKA | — | — |
| `CA-1-48` | §10 | Rendah | Enam ketiadaan kecil yang penyangkalnya turunkan | `employee.service.ts:836, :491 · shift.service.ts:35 · schema.prisma:551 · statutory.ts:201 · attendance.repository.ts:84` | `lain` | TERBUKA | — | — |
| `CA-1-49` | §11 | Sedang | CI melaporkan “no hardcoded Indonesian copy” di atas ±60 string keras | `scripts/check-i18n.mjs:243, :254, :315` | `jalur-uang` | TERBUKA | — | — |
| `CA-1-50` | §11 | Sedang | Enam halaman impor: seluruh paragraf peringatan tidak diterjemahkan | `apps/web/src/components/csv-import.tsx:336` | `lain` | TERBUKA | — | — |
| `CA-1-51` | §11 | Rendah | Kalender mencetak token {workStartTime} mentah ke layar | `apps/web/src/app/hr/calendar/page.tsx:104` | `lain` | TERBUKA | — | — |
| `CA-1-52` | §11 | Rendah | Sepuluh berkas lain dengan string yang lolos t() | `lihat tabel §13` | `jalur-uang` | TERBUKA | — | — |
| `CA-1-53` | §12 | Tinggi | Tombol pilih file di semua halaman impor tidak bisa dicapai keyboard | `apps/web/src/components/csv-import.tsx:348` | `lain` | TERBUKA | `className="hidden"` | — |
| `CA-1-54` | §12 | Sedang | Pesan error memakai warna mentah yang tidak ikut mode gelap | `12 pemakaian text-red-600 di app/hr + components/hr` | `lain` | TERBUKA | — | — |
| `CA-1-55` | §12 | Sedang | Kamera check-in gagal: hanya teks merah, tanpa tombol coba lagi | `apps/web/src/components/hr/face-capture.tsx:102` | `lain` | TERBUKA | — | — |
| `CA-1-56` | §12 | Rendah | Slip gaji memaksa 3 kolom di layar HP | `me/payroll/detail/page.tsx:93 · payroll/detail/page.tsx:88` | `jalur-uang` | TERBUKA | — | — |
| `CA-1-57` | §12 | Rendah | Baris absensi tidak pernah membungkus | `apps/web/src/app/hr/attendance/page.tsx:145` | `lain` | TERBUKA | — | — |
| `CA-1-58` | §12 | Rendah | Kelas border-ty tidak ada di Tailwind | `apps/web/src/app/hr/assets/page.tsx:302, :337, :346` | `lain` | TERBUKA | — | — |
| `CA-1-59` | §13 | Ringkas | Jenis bonus & potongan tampil sebagai enum Inggris mentah | `apps/web/src/app/hr/adjustments/page.tsx:110,116,132` | `lain` | TERBUKA | — | — |
| `CA-1-60` | §13 | Ringkas | Threshold rule bonus tanpa format rupiah | `apps/web/src/app/hr/rules/page.tsx:105` | `jalur-uang` | TERBUKA | — | — |
| `CA-1-61` | §13 | Ringkas | Total Karyawan di dashboard ikut menghitung yang resign | `apps/web/src/app/hr/page.tsx:66 · analytics.service.ts:85` | `lain` | TERBUKA | — | — |
| `CA-1-62` | §13 | Ringkas | Ekspor direktori 11 kolom, template impor 27 kolom | `services/hr-service/src/application/services/analytics.service.ts:162` | `lain` | TERBUKA | — | — |
| `CA-1-63` | §13 | Ringkas | Detail karyawan tidak menampilkan role, depot, tanggal keluar | `apps/web/src/app/hr/employees/detail/page.tsx:141` | `lain` | TERBUKA | — | — |
| `CA-1-64` | §13 | Ringkas | Riwayat karyawan menampilkan nama kolom database mentah | `apps/web/src/app/hr/employees/detail/page.tsx:212` | `lain` | TERBUKA | — | — |
| `CA-1-65` | §13 | Ringkas | Riwayat kinerja hanya skor akhir; periode tak terukur jadi 0 | `apps/web/src/app/hr/performance/page.tsx:136` | `lain` | TERBUKA | — | — |
| `CA-1-66` | §13 | Ringkas | Foto selfie & skor face-match tidak pernah ditampilkan | `apps/web/src/app/hr/attendance/page.tsx:59` | `lain` | TERBUKA | — | — |
| `CA-1-67` | §13 | Ringkas | Riwayat pengumuman menyebut dimensi target tanpa nilainya | `apps/web/src/app/hr/announcements/page.tsx:101` | `lain` | TERBUKA | — | — |
| `CA-1-68` | §13 | Ringkas | Karyawan tidak bisa melihat menit keterlambatannya sendiri | `apps/web/src/app/hr/me/attendance/page.tsx:32` | `jalur-uang` | TERBUKA | — | — |
| `CA-1-69` | §13 | Ringkas | Tanggal disetujui & dibayar tidak pernah ditampilkan | `apps/web/src/app/hr/payroll/detail/page.tsx:62` | `jalur-uang` | TERBUKA | — | — |
| `CA-1-70` | §13 | Ringkas | window.prompt untuk alasan koreksi absensi; teks kosong = batal senyap | `apps/web/src/app/hr/attendance/page.tsx:105` | `confirm-dialog` | TERBUKA | — | — |
| `CA-1-71` | §13 | Ringkas | Kegagalan memuat daftar depot tidak dilaporkan di halaman impor | `apps/web/src/app/hr/employees/import/page.tsx:158` | `lain` | TERBUKA | — | — |
| `CA-1-72` | §13 | Ringkas | Pesan gagal impor muncul ribuan piksel di atas tombolnya | `apps/web/src/components/csv-import.tsx:293` | `lain` | TERBUKA | — | — |
| `CA-1-73` | §13 | Ringkas | Statistik pengumuman gagal dimuat tanpa pesan | `apps/web/src/app/hr/announcements/page.tsx:128` | `lain` | TERBUKA | — | — |
| `CA-1-74` | §13 | Ringkas | Hasil check-in menampilkan enum mentah, selalu hijau | `apps/web/src/app/hr/me/check-in/page.tsx:99` | `lain` | TERBUKA | — | — |
| `CA-1-75` | §13 | Ringkas | Pencarian karyawan & filter audit menembak request tiap ketikan | `apps/web/src/app/hr/employees/page.tsx:91 · audit/page.tsx:22` | `lain` | TERBUKA | — | — |
| `CA-1-76` | §13 | Ringkas | “Buatkan akun” berhasil tanpa pesan, fokus terlempar ke body | `apps/web/src/app/hr/employees/page.tsx:56` | `lain` | TERBUKA | — | — |
| `CA-1-77` | §13 | Ringkas | Tombol Masuk/Pulang tidak mengumumkan mana yang terpilih | `apps/web/src/app/hr/me/check-in/page.tsx:89` | `lain` | TERBUKA | — | — |
| `CA-1-78` | §13 | Ringkas | Filter & kotak cari tanpa nama aksesibel (5 halaman) | `hr/employees:124 · hr/leave:86 · hr/audit:28 · hr/announcements:273,287` | `lain` | TERBUKA | — | — |
| `CA-1-79` | §13 | Ringkas | Ruang kosong 96px di bawah setiap halaman HR di HP | `apps/web/src/app/hr/layout.tsx:45` | `lain` | TERBUKA | — | — |
| `CA-1-80` | §13 | Ringkas | Judul /hr/me/attendance hardcoded padahal key-nya sudah ada | `apps/web/src/app/hr/me/attendance/page.tsx:23` | `lain` | TERBUKA | — | — |
| `CA-1-81` | §13 | Ringkas | loans/import mengirim judul mentah ke t(), bukan key | `apps/web/src/app/hr/loans/import/page.tsx:20` | `lain` | TERBUKA | — | — |
| `CA-1-82` | §13 | Ringkas | Dokumen kepegawaian: 7 string hardcoded | `apps/web/src/components/hr/employee-documents.tsx:58` | `lain` | TERBUKA | — | — |
| `CA-1-83` | §13 | Ringkas | Kasbon: 8 string termasuk 3 badge status | `apps/web/src/components/hr/employee-loans.tsx:74` | `lain` | TERBUKA | — | — |
| `CA-1-84` | §13 | Ringkas | Peringatan pengambilalihan akun seluruhnya hardcoded | `apps/web/src/components/hr/employee-form.tsx:366` | `lain` | TERBUKA | — | — |
| `CA-1-85` | §13 | Ringkas | Halaman kinerja: 7 string skor & error | `apps/web/src/app/hr/performance/page.tsx:173` | `lain` | TERBUKA | — | — |
| `CA-1-86` | §13 | Ringkas | Pengaturan: label Cakupan & opsi GLOBAL/DEPOT hardcoded | `apps/web/src/app/hr/settings/page.tsx:75` | `lain` | TERBUKA | — | — |
| `CA-1-87` | §13 | Ringkas | Dashboard: dua judul kartu tidak diterjemahkan | `apps/web/src/app/hr/page.tsx:78, :83` | `lain` | TERBUKA | — | — |
| `CA-1-88` | §13 | Ringkas | Riwayat mutasi aset: “dari” diterjemahkan, “ke” dan “kondisi” tidak | `apps/web/src/app/hr/assets/page.tsx:293` | `lain` | TERBUKA | — | — |

## Bagian II — Konsol depot dan kantor pusat (§16–§30, 132 halaman)

| ID | Bagian | Tingkat | Judul | file:baris | Kelas akar | Status | Bukti re-cek | PR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CA-2-01` | §16 | Dicoret | “Persetujuan klaim pengeluaran kurir tidak dibatasi depot” | `services/payout-service/src/application/services/expense-claim.service.ts:133–142` | `depot-scope-by-id` | DITOLAK | dicoret oleh audit sendiri di §16 — penjagaannya ada di kode, dengan komentar berkode yang menamainya | — |
| `CA-2-02` | §16 | Dicoret | “Head office bisa mencetak SUPER_ADMIN untuk nomornya sendiri” | `services/auth-service/src/application/services/account.service.ts:304–307` | `gerbang-kapabilitas` | DITOLAK | dicoret oleh audit sendiri di §16 — penjagaannya ada di kode, dengan komentar berkode yang menamainya | — |
| `CA-2-03` | §17 | Kritis | Manajer bisa mengubah rekening bank dan QRIS SETIAP depot di jaringan | `services/depot-service/src/modules/depot.controller.ts:251, :263, :309` | `depot-scope-by-id` | SUDAH DIPERBAIKI | parameter jadi `:depotId` pada `manage/:depotId`, `PATCH`, `POST :depotId/qris`, `DELETE` — `DepotScopeGuard` akhirnya melihatnya | #416 |
| `CA-2-04` | §17 | Kritis | Detail depot HQ membaca proyeksi publik — menyuntingnya menghapus rekening bank depot | `apps/web/src/app/hq/depots/detail/page.tsx:42` | `proyeksi-publik` | TERBUKA | `const depot = useAsync<DepotAdmin>(() => api.get(endpoints.depots.detail(id), true), [id]);` | — |
| `CA-2-05` | §18 | Tinggi | “Blokir” di antrean fraud tidak memblokir apa pun | `apps/web/src/app/hq/fraud/page.tsx:114 · fraud-flag.service.ts:35` | `lain` | TERBUKA | `<Button variant="danger" onClick={() => act(r, 'block')}>` | — |
| `CA-2-06` | §18 | Tinggi | IP allowlist dan timeout sesi disimpan, tidak ditegakkan di mana pun | `apps/web/src/app/hq/security/page.tsx:97–110 · security-policy.service.ts:31` | `lain` | TERBUKA | `<div className="flex flex-col gap-6">` | — |
| `CA-2-07` | §18 | Sedang | Kill switch yang tidak membunuh apa pun — “Cash on delivery: MATI” sementara COD jalan | `apps/web/src/app/hq/flags/page.tsx:46 · admin-service/prisma/seed.mjs:11–15` | `jalur-uang` | TERBUKA | — | — |
| `CA-2-08` | §19 | Tinggi | Ongkir dihitung dua kali dalam net payout | `apps/web/src/app/hq/reconciliation/page.tsx:173` | `jalur-uang` | TERBUKA | `? sales - platformFee - commission + shippingBilled - refunds - gallonDeposit` | — |
| `CA-2-09` | §19 | Tinggi | Komisi waralaba dihitung dari dasar yang berbeda dengan yang benar-benar ditagih | `apps/web/src/app/hq/reconciliation/page.tsx:117 vs order.service.ts:1612` | `jalur-uang` | TERBUKA | `const commission = sales != null && scheme ? Math.round(sales * (scheme.pct / 100)) : null;` | — |
| `CA-2-10` | §19 | Tinggi | Rekonsiliasi hanya bisa dibuat untuk 10 depot terbesar | `apps/web/src/app/hq/reconciliation/page.tsx:105 · dashboard.service.ts:142` | `jalur-uang` | TERBUKA | `const topRow = dash.data?.topDepots?.items.find((r) => r.depotId === selected) ?? null;` | — |
| `CA-2-11` | §19 | Sedang | Biaya platform terbaca 0% untuk semua peran kecuali super admin | `apps/web/src/app/hq/reconciliation/page.tsx:94` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-2-12` | §20 | Tinggi | Aturan harga memakai batas hari UTC — promo mati jam 07:00 di hari terakhirnya | `services/depot-service/src/modules/pricing.controller.ts:13 · domain/pricing-rule.ts:54` | `jalur-uang` | TERBUKA | `return v ? new Date(v) : null;` | — |
| `CA-2-13` | §20 | Tinggi | Tarif kurir bertanggal depan langsung berlaku saat disimpan | `services/payout-service/src/infrastructure/prisma/courier-ledger.prisma.repository.ts:164` | `jalur-uang` | SUDAH DIPERBAIKI | `currentRule(depotId, asOf)` kini menyaring `effectiveDate <= asOf`; komentarnya menyebut ukuran produksi 2026-08-31 | #413 |
| `CA-2-14` | §20 | Tinggi | Skema komisi bertanggal depan juga langsung berlaku | `services/payout-service/src/infrastructure/prisma/commission-scheme.prisma.repository.ts:31, :39` | `jalur-uang` | TERBUKA | `// silently stops being paid.` | — |
| `CA-2-15` | §21 | Tinggi | Konsol depot memilih depot default dari daftar seluruh jaringan, bukan depot milik penggunanya | `apps/web/src/lib/depot-context.tsx:68, :91` | `depot-scope-by-id` | TERBUKA | `.get<Page<Depot>>(endpoints.depots.browse({ limit: 100 }), true)` | — |
| `CA-2-16` | §21 | Tinggi | FINANCE dan MARKETING memegang kapabilitas yang layarnya hanya ada di /hq — dan isHq() menolak keduanya | `apps/web/src/lib/roles.ts:68` | `gerbang-kapabilitas` | TERBUKA | `export function isHq(role: string \| null \| undefined): boolean {` | — |
| `CA-2-17` | §21 | Tinggi | FINANCE mendarat di konsol HR dan terkurung di sana | `apps/web/src/lib/roles.ts:266` | `gerbang-kapabilitas` | TERBUKA | `}` | — |
| `CA-2-18` | §21 | Tinggi | Konsol operator memakai daftar menu ketiga yang di-hardcode dan tidak difilter kapabilitas | `apps/web/src/components/operator/operator-shell.tsx:30–61` | `gerbang-kapabilitas` | TERBUKA | `const primaryTabs: Tab[] = [` | — |
| `CA-2-19` | §21 | Tinggi | Halaman peringkat depot gagal total untuk HEAD_OFFICE dan DIREKTUR | `apps/web/src/app/hq/scorecard/page.tsx:33, :37` | `gerbang-kapabilitas` | TERBUKA | `const settings = useAsync<SettingsSchema>(() => fetchSettingsSchema('/payout/api/v1', null), []);` | — |
| `CA-2-20` | §22 | Tinggi | Satu orang bisa mengajukan, menyetujui, dan sekaligus menaikkan ambang persetujuan depotnya sendiri | `services/depot-service/src/application/services/approval.service.ts:94` | `gerbang-kapabilitas` | TERBUKA | `async decide(` | — |
| `CA-2-21` | §22 | Tinggi | Penulisan stok tidak atomik — dua penyesuaian bersamaan saling menimpa | `services/depot-service/src/infrastructure/prisma/inventory.prisma.repository.ts:202` | `lain` | TERBUKA | `async applyMovement(` | — |
| `CA-2-22` | §22 | Tinggi | Buku kas depot tidak punya jalur koreksi apa pun | `services/depot-service/src/modules/cashbook.controller.ts:63` | `jalur-uang` | TERBUKA | `@Post()` | — |
| `CA-2-23` | §23 | Tinggi | fetchAllPages meminta 200 padahal server menolak di atas 100 — enam layar katalog mati | `apps/web/src/lib/fetch-all-pages.ts:22` | `lain` | SUDAH DIPERBAIKI | komentar :22-31 kini menerangkan 100 = `@Max(100)` DTO server, dan cerita 200-nya ditulis sebagai regresi yang sudah ditutup | #407 |
| `CA-2-24` | §23 | Tinggi | Tidak ada satu pun pintu untuk mengajukan refund, padahal wewenangnya diiklankan di matriks RBAC | `services/payment-service/src/modules/payment.controller.ts:514` | `gerbang-kapabilitas` | TERBUKA | `@Post(':id/refund')` | — |
| `CA-2-25` | §24 | Tinggi | Ekspor “pendapatan per depot” hanya berisi 10 depot teratas | `apps/web/src/app/hq/reports/export/page.tsx:87` | `lain` | TERBUKA | `return (dash.data?.topDepots?.items ?? []).map((r) => ({` | — |
| `CA-2-26` | §24 | Tinggi | Enam layar jaringan berhenti di 100 depot, dua di antaranya mencetak angka dari potongan itu | `hq/franchise:23 · hq/depots:46 · hq/onboarding:35 · hq/inventory:27 · hq/roster:30` | `lain` | TERBUKA | berkas majemuk — lihat RECHECK | — |
| `CA-2-27` | §24 | Tinggi | Antrean aplikasi waralaba mengubur pemohon baru begitu 100 aplikasi pernah masuk | `apps/web/src/app/hq/applications/page.tsx:33` | `jalur-uang` | TERBUKA | `() => api.get(endpoints.franchiseApps.list({ limit: 100 }), true),` | — |
| `CA-2-28` | §24 | Tinggi | Log audit HQ hanya 100 baris terbaru, dan ekspornya ikut terpotong tanpa memberi tahu | `apps/web/src/app/hq/audit/page.tsx:30` | `lain` | TERBUKA | `const log = useAsync<Page<AuditEntry>>(() => api.get(endpoints.audit.list({ limit: 100 }), true));` | — |
| `CA-2-29` | §24 | Tinggi | Papan lacak hanya memuat ON_DELIVERY; tombol tarik-kembali tak terjangkau | `apps/web/src/app/dashboard/tracking/page.tsx:181` | `lain` | TERBUKA | `variant="secondary"` | — |
| `CA-2-30` | §25 | Tinggi | Tier harga borongan selalu berlaku untuk SEMUA produk | `apps/web/src/app/dashboard/wholesale/page.tsx:76` | `jalur-uang` | TERBUKA | `await api.post(` | — |
| `CA-2-31` | §25 | Tinggi | PO berisi barang katalog ditandai “Diterima” tanpa stok pernah bertambah | `services/depot-service/src/application/services/purchase-order.service.ts:112` | `jalur-uang` | TERBUKA | `await this.inventory.receiveStock(` | — |
| `CA-2-32` | §25 | Tinggi | Pembebanan selisih setoran ke kurir dikirim tanpa jaminan sampai | `services/delivery-service/src/application/services/settlement.service.ts:155` | `jalur-uang` | TERBUKA | `if (charged) {` | — |
| `CA-2-33` | §25 | Tinggi | Daftar pelanggan berisiko churn tidak dibatasi depot saat switcher di “Semua depot” | `services/forecast-service/src/modules/forecast.controller.ts:139` | `depot-scope-by-id` | TERBUKA | `async churn(@Query() query: ChurnQueryDto): Promise<{ customers: ChurnItem[] }> {` | — |
| `CA-2-34` | §25 | Tinggi | Menolak refund pada pesanan yang sudah dibatalkan menahan uang pelanggan tanpa jejak | `apps/web/src/app/hq/refunds/page.tsx:33` | `jalur-uang` | TERBUKA | `async function decide(r: RefundQueueItem, approved: boolean) {` | — |
| `CA-2-35` | §25 | Tinggi | “Harga tetap” di form aturan harga tidak menghasilkan harga tetap | `apps/web/src/app/hq/forms/pricing-rule/page.tsx:62` | `jalur-uang` | TERBUKA | `// Map the 3-way UI onto the backend's PERCENT\|FIXED. Fixed = absolute target price,` | — |
| `CA-2-36` | §25 | Tinggi | Kotak masuk insiden depot tidak punya form lapor | `apps/web/src/app/dashboard/incidents/page.tsx:179` | `lain` | TERBUKA | `const list = useAsync<DepotIncident[]>(` | — |
| `CA-2-37` | §25 | Tinggi | Setiap webhook yang dibuat dari konsol dikirim tanpa tanda tangan, selamanya | `apps/web/src/app/hq/webhooks/page.tsx:153` | `lain` | TERBUKA | `await api.post(endpoints.admin.webhooks.create, { url: url.trim(), events: eventList }, true);` | — |
| `CA-2-38` | §25 | Tinggi | Baris tabel pesanan HQ hanya bisa dibuka dengan tetikus | `apps/web/src/app/hq/orders/page.tsx:118` | `lain` | TERBUKA | `<tr` | — |
| `CA-2-39` | §25 | Tinggi | Sengketa pesanan hanya mengubah status — REFUND tidak mengembalikan uang, RESEND tidak mengirim apa pun | `services/depot-service/src/application/services/dispute.service.ts:78` | `jalur-uang` | TERBUKA | `async resolve(` | — |
| `CA-2-40` | §25 | Tinggi | Ekspor dan antrean lain yang ikut terpotong | `dashboard/orders:288 · dashboard/returns:338 · hq/orders:55` | `lain` | TERBUKA | berkas majemuk — lihat RECHECK | — |
| `CA-2-41` | §25 | Tinggi | Roster kurir salah menghitung beban | `apps/web/src/app/hq/roster/page.tsx:29` | `lain` | TERBUKA | `api.get<Page<Delivery>>(endpoints.deliveries.list({ limit: 100 }), true),` | — |
| `CA-2-42` | §23 | Sedang (ringkas) | Dua antrean persetujuan HQ tidak akan pernah terisi — rute “propose” dihapus dari sisi depot | `apps/web/src/lib/endpoints/shop.ts:241` | `jalur-uang` | TERBUKA | — | — |
| `CA-2-43` | §23 | Sedang (ringkas) | Log pengiriman webhook dan tombol kirim-ulang sudah jadi dan diuji, tidak pernah dipanggil | `services/admin-service/src/modules/webhook-delivery.controller.ts:72` | `lain` | TERBUKA | — | — |
| `CA-2-44` | §23 | Sedang (ringkas) | Pratinjau dan dryRun sapu retensi sudah dibangun, tombolnya langsung menghapus permanen | `apps/web/src/app/hq/retention/page.tsx:45` | `confirm-dialog` | TERBUKA | — | — |
| `CA-2-45` | §23 | Sedang (ringkas) | Pembayaran PENDING hanya bisa dikonfirmasi, tidak bisa ditandai gagal — rute fail tanpa pintu | `services/payment-service/src/modules/payment.controller.ts:503` | `jalur-uang` | TERBUKA | — | — |
| `CA-2-46` | §26 | Ringkas | Gerbang i18n buta terhadap kalimat JSX yang punya interpolasi — 23 string keras di 14 berkas konsol | `scripts/check-i18n.mjs:232` | `lain` | TERBUKA | — | — |
| `CA-2-47` | §26 | Ringkas | Bentuk ternary, prop description=, dan setFileError() lolos gerbang — 12 string lagi | `scripts/check-i18n.mjs:246` | `lain` | TERBUKA | — | — |
| `CA-2-48` | §26 | Ringkas | Daftar kata Indonesia gerbang terlalu sempit — tidak mengenali morfologi imbuhan | `scripts/check-i18n.mjs:31` | `lain` | TERBUKA | — | — |
| `CA-2-49` | §26 | Ringkas | Aturan “sudah diterjemahkan kalau barisnya memuat t(” membuang temuan pada baris campuran | `scripts/check-i18n.mjs:389` | `lain` | TERBUKA | — | — |
| `CA-2-50` | §26 | Ringkas | 132 halaman konsol tidak pernah diukur aksesibilitasnya — Lighthouse anonim tak menjangkau rute bersesi | `scripts/check-lighthouse.mjs:109` | `lain` | TERBUKA | — | — |
| `CA-2-51` | §26 | Ringkas | 188 kelas warna Tailwind mentah di 70 berkas konsol melewati token tema, dan jatuh di mode gelap | `apps/web/src/app/globals.css:68` | `lain` | TERBUKA | — | — |
| `CA-2-52` | §27 | Ringkas | PPN dan faktur pajak tidak pernah menyentuh satu transaksi pun | `services/order-service/prisma/schema.prisma:61` | `jalur-uang` | TERBUKA | — | — |
| `CA-2-53` | §27 | Ringkas | Tidak ada kontrol konkurensi di seluruh dua konsol — setiap form tulis-terakhir-menang | `apps/web/src/app/hq/tax/page.tsx:36` | `lain` | TERBUKA | — | — |
| `CA-2-54` | §27 | Ringkas | Tidak ada transfer stok antar depot — satu-satunya stok masuk adalah PO ke pemasok | `services/depot-service/prisma/schema.prisma:471` | `lain` | TERBUKA | — | — |
| `CA-2-55` | §27 | Ringkas | Penerimaan barang selalu dianggap sesuai pesanan — tidak ada kurang kirim, tolak, atau rusak | `services/depot-service/src/application/services/purchase-order.service.ts:105` | `jalur-uang` | TERBUKA | — | — |
| `CA-2-56` | §27 | Ringkas | Pesanan yang salah rute tidak bisa dipindahkan ke depot lain selamanya | `services/order-service/src/application/services/order.service.ts:1413` | `lain` | TERBUKA | — | — |
| `CA-2-57` | §27 | Ringkas | Ledger deposit galon tidak pernah menyentuh stok galon fisik | `services/depot-service/prisma/schema.prisma:128` | `jalur-uang` | TERBUKA | — | — |
| `CA-2-58` | §27 | Ringkas | Keluhan pelanggan terbelah dua sistem yang tidak pernah saling melihat | `services/admin-service/prisma/schema.prisma:283` | `lain` | TERBUKA | — | — |
| `CA-2-59` | §27 | Ringkas | Kantor pusat tidak punya laba-rugi jaringan — hanya omzet | `apps/web/src/lib/endpoints/insight.ts:142` | `jalur-uang` | TERBUKA | — | — |
| `CA-2-60` | §28 | SAPUAN | SAPUAN · Izin dan gerbang (9 item) — 45 dari 61 pintu rail /hq tanpa gerbang kapabilitas; 58 dari 64 halaman /hq tidak menggerbang dirinya; rail depot memakai “apakah dia staf” sebagai izin untuk lima layar; empat layar impor massal tanpa gerbang; tiga item rail membawa kapabilitas yang bukan yang ditegakkan server; jumlah penerima broadcast butuh kapabilitas yang tak dipegang peran depot mana pun | `apps/web/src/components/hq/hq-rail.tsx:125 · components/ops/ops-rail.tsx:123` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-2-61` | §28 | SAPUAN | SAPUAN · Navigasi (6 item) — konsol HQ di ponsel hanya 4 tab tetap, 56 dari 60 rute tak terjangkau dan satu tab mati; tidak ada tombol keluar di konsol depot untuk 9 dari 11 peran; tiga jawaban yang bertentangan atas “peran ini mendarat di mana”; dua pencarian global yang tidak mencari objek utama konsolnya sendiri | `apps/web/src/components/hq/hq-bottom-nav.tsx:25` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-2-62` | §28 | SAPUAN | SAPUAN · Aksi merusak (12 item) — ConfirmDialog dipakai 4 dari 132 halaman konsol; tombol aksi yang saling meniadakan tidak terkunci saat request berjalan; window.prompt/confirm sebagai input alur kerja termasuk untuk alasan yang tercatat sebagai bukti; simpan matriks RBAC bisa berlaku separuh | `apps/web/src/app/hq/access/rbac-matrix.tsx:279 · hq/pdp/page.tsx:59` | `confirm-dialog` | TERBUKA | — | — |
| `CA-2-63` | §28 | SAPUAN | SAPUAN · Uang dan periode (18 item) — rilis payout mencatat tujuan “Rilis HQ” bukan rekening pemilik; faktur memakai total yang bukan yang dibayar dan mencap LUNAS pada pesanan apa pun; periode uang dihitung dari jam perangkat/UTC di tiga layar; metode pembulatan pajak direset diam-diam tiap simpan; laporan L/R hanya bulan berjalan; potongan selisih setoran memakai tanggal yang salah | `services/payout-service/src/application/services/payout.service.ts:238 · apps/web/src/app/hq/invoice-template:28` | `jalur-uang` | TERBUKA | — | — |
| `CA-2-64` | §28 | SAPUAN | SAPUAN · Stok dan pembelian (9 item) — opname bisa menurunkan stok di bawah jumlah yang sudah dipesan pelanggan; tidak ada penerimaan sebagian; kolom harga PO yang dikosongkan jadi Rp 0 lalu masuk COGS; supplier tidak bisa diubah atau dihapus; aturan harga menyasar produk lewat UUID yang diketik tangan | `services/depot-service/src/application/services/inventory.service.ts:358` | `jalur-uang` | TERBUKA | — | — |
| `CA-2-65` | §28 | SAPUAN | SAPUAN · Pelanggan dan promo (14 item) — voucher HQ lahir tanpa kedaluwarsa, kuota dan plafon; voucher persentase menerima nilai di atas 100; persetujuan permintaan voucher depot melahirkan voucher se-jaringan; perkiraan jangkauan dihitung dari populasi berbeda dari yang dikirimi; hadiah tanpa depot bisa diserahkan dua kali; impor pelanggan yang diulang menumpuk alamat ganda | `apps/web/src/app/hq/forms/voucher/page.tsx:49 · services/loyalty-service/.../reward.service.ts:153` | `jalur-uang` | TERBUKA | — | — |
| `CA-2-66` | §28 | SAPUAN | SAPUAN · Data yang tidak sampai ke layar (16 item) — pelanggan teratas hanya potongan UUID; detail persetujuan tidak menyebut pengaju maupun pemutus; kinerja tim menampilkan UUID sebagai nama kurir; peringkat depot memberi SLA 0% saat service-nya tak terbaca; Customer 360 menampilkan Rp 0 saat laporannya gagal; laporan terjadwal tidak pernah menunjukkan kalau gagal | `apps/web/src/app/hq/scorecard/page.tsx:46 · hq/customers/page.tsx:51` | `lain` | TERBUKA | — | — |
| `CA-2-67` | §28 | SAPUAN | SAPUAN · Jejak audit (3 item) — perubahan setelan uang, perubahan peran dan matriks RBAC, serta kunci API/flag/webhook/kebijakan keamanan tidak pernah masuk log; admin-service tidak punya klien audit sama sekali padahal jalur ingest lintas-layanan sudah ada | `services/admin-service/src/.../settings-slice.ts:103 · audit.service.ts:38` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-2-68` | §28 | SAPUAN | SAPUAN · Bahasa dan aksesibilitas (21 item) — teks Indonesia keras di 14+ berkas; delapan kontrol form tanpa nama yang bisa dibaca; 20 pesan galat tanpa live region; label Field tidak terhubung ke inputnya; tombol pilih berkas impor tidak bisa dicapai keyboard | `apps/web/src/components/csv-import.tsx:344` | `lain` | TERBUKA | — | — |
| `CA-2-69` | §28 | SAPUAN | SAPUAN · Layar dan keadaan (28 item) — kartu menampilkan 0 selama masih dimuat; pencarian yang gagal melapor “tidak ada hasil”; satu depot gagal dibaca membuat seluruh halaman stok jaringan kosong; checklist go-live selamanya mentok 5/6; tabel retur punya dua kolom berjudul beda yang isinya sama; tombol “Bangun ulang” prakiraan tidak membangun ulang apa pun | `apps/web/src/app/hq/onboarding/page.tsx:60 · hq/forecast/page.tsx:45` | `lain` | TERBUKA | — | — |

## Bagian III — Aplikasi pelanggan (§31–§40, 28 halaman)

| ID | Bagian | Tingkat | Judul | file:baris | Kelas akar | Status | Bukti re-cek | PR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CA-3-01` | §31 | Kritis | Hapus akun tidak menyentuh order-service: nama, nomor HP, dan titik GPS pelanggan tetap utuh 10 tahun, padahal halaman hapus-akun menjanjikan sebaliknya | `apps/web/src/lib/dictionaries/id/deleteAccount.ts:30` | `pdp-registry` | SUDAH DIPERBAIKI | registry penghapusan di auth-service + teks /hapus-akun diperbaiki: pengecualian `order.orders` dinyatakan apa adanya, bukan disembunyikan di balik kata "dianonimkan" | #419 |
| `CA-3-02` | §31 | Kritis | Langganan tetap berjalan setelah akun dihapus: pesanan baru terus dibuat atas nama orang yang sudah minta dilupakan | `services/order-service/src/application/services/subscription.service.ts:243` | `sweep-tanpa-penonton` | SUDAH DIPERBAIKI | `erasePerson` di order-service MEMBATALKAN langganan lebih dulu, baru menghapus snapshot alamatnya — sweep tidak bisa lagi menemukannya | #419 |
| `CA-3-03` | §32 | Tinggi | Foto profil dan foto pendaftaran agen (KTP) tidak pernah dihapus dari bucket saat akun dihapus — hanya kolomnya yang dikosongkan | `services/auth-service/src/application/ports/storage.port.ts:22` | `pdp-registry` | TERBUKA | `put(input: StoragePutInput): Promise<StoragePutResult>;` | — |
| `CA-3-04` | §32 | Tinggi | Depot tutup memblokir SEMUA pesanan, termasuk slot terjadwal yang justru dirancang server untuk diterima | `apps/web/src/app/checkout/page.tsx:364` | `sweep-tanpa-penonton` | SUDAH DIPERBAIKI | checkout/page.tsx:371-372 `const depotClosed = ...; const expressBlocked = express && depotClosed;` | #405 |
| `CA-3-05` | §32 | Tinggi | Akun yang sudah didaftarkan tapi belum verifikasi tidak bisa masuk, dan disuruh menghubungi dukungan | `apps/web/src/app/login/page.tsx:104` | `jalur-uang` | TERBUKA | `// least reads "Nomor ini belum terdaftar", but still leaves the visitor to find` | — |
| `CA-3-06` | §32 | Tinggi | Nomor telepon pelanggan disalin ke tabel komplain admin-service dan tidak pernah ikut terhapus maupun ikut diekspor | `services/admin-service/src/modules/customer-support.controller.ts:61` | `pdp-registry` | TERBUKA | `customerRef: user.phone,` | — |
| `CA-3-07` | §32 | Tinggi | Foto bukti transfer pelanggan disimpan permanen di bucket publik dan tidak pernah disebut di Kebijakan Privasi | `apps/web/src/lib/dictionaries/id/privacy.ts:40` | `pdp-registry` | TERBUKA | `body: 'Data akun disimpan selama akunmu aktif. Bukti pengantaran (foto, tanda tangan, nama penerima, lokasi) disimpan ma` | — |
| `CA-3-08` | §33 | Sedang | Halaman favorit dan promo masih memakai harga katalog, bukan harga depot (PG-03 belum sampai ke dua layar ini) | `apps/web/src/app/favorites/page.tsx:82` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-09` | §33 | Sedang | Keranjang menampilkan diskon member untuk agen, dan menyembunyikan harga agen yang sebenarnya ditagih | `apps/web/src/app/cart/page.tsx:76` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-10` | §33 | Sedang | Keranjang tidak pernah memberi tahu bahwa harganya harga katalog, walau responsnya menyebutkan itu | `apps/web/src/app/cart/page.tsx:42` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-11` | §33 | Sedang | Layar promo dan favorit masih mencetak harga katalog tanpa label, sementara keranjang menagih harga depot | `apps/web/src/app/promo/page.tsx:230` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-12` | §33 | Sedang | Kuotasi voucher tidak dihitung ulang saat depot berubah, jadi total di layar berbeda dari yang ditagih | `apps/web/src/app/checkout/page.tsx:477` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-13` | §33 | Sedang | Kuota voucher bertahan setelah depot berubah dan tidak digugurkan untuk agen — total di tombol beda dengan tagihan | `apps/web/src/app/checkout/page.tsx:671` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-14` | §33 | Rendah | Biaya express masuk total checkout tapi tidak punya baris sendiri, jadi rincian tidak menjumlah | `apps/web/src/app/checkout/page.tsx:1258` | `lain` | TERBUKA | — | — |
| `CA-3-15` | §33 | Rendah | Catatan diskon member di halaman produk membaca tarif global, bukan tarif depot yang menagih | `apps/web/src/app/products/detail/page.tsx:63` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-16` | §34 | Sedang | Halaman produk menjanjikan pengantaran dari depot yang tidak melayani alamat itu | `apps/web/src/app/products/detail/page.tsx:69` | `lain` | TERBUKA | — | — |
| `CA-3-17` | §34 | Sedang | Setiap baris keranjang mengklaim "Stok tersedia" tanpa data stok apa pun | `apps/web/src/app/cart/page.tsx:264` | `lain` | TERBUKA | — | — |
| `CA-3-18` | §34 | Sedang | Halaman produk selalu menandai depot "Buka" dan menjanjikan tiba hari ini, walau depot tutup | `apps/web/src/app/products/detail/page.tsx:264` | `lain` | TERBUKA | — | — |
| `CA-3-19` | §34 | Sedang | Beranda menjanjikan e-wallet dan QRIS yang tidak bisa dipakai membayar | `apps/web/src/components/nearby-depots.tsx:94` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-20` | §34 | Sedang | Minimum order depot tidak pernah disebut sampai tombol bayar ditekan, lalu penolakannya berbahasa Inggris | `apps/web/src/app/checkout/page.tsx:1347` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-21` | §34 | Sedang | Tanggal pengiriman pertama langganan dihitung dalam UTC, jadi "besok" jadi hari ini antara 00.00-07.00 WIB | `apps/web/src/app/subscriptions/page.tsx:31` | `lain` | TERBUKA | — | — |
| `CA-3-22` | §34 | Sedang | Metode pembayaran yang sudah dipilih tidak divalidasi ulang saat daftar metode depot menyempit | `apps/web/src/app/checkout/page.tsx:304` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-23` | §35 | Sedang | Barang yang produknya dinonaktifkan hilang dari keranjang tanpa satu kata pun | `services/order-service/src/application/services/cart.service.ts:177` | `lain` | TERBUKA | — | — |
| `CA-3-24` | §35 | Sedang | Gagal menambah ke keranjang tidak memberi pesan apa pun di kartu produk dan rail rekomendasi | `apps/web/src/components/product-card.tsx:67` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-3-25` | §35 | Sedang | Tombol "+" di rail Beranda membuang produk yang tamu pilih dan mendarat di layar yang salah | `apps/web/src/components/product-rec-rail.tsx:36` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-3-26` | §35 | Sedang | Semua favorit gagal dimuat terlihat seperti "belum ada favorit" | `apps/web/src/app/favorites/page.tsx:24` | `lain` | TERBUKA | — | — |
| `CA-3-27` | §35 | Sedang | Daftar pesanan hanya memuat 20 terbaru dan tidak punya halaman berikutnya | `apps/web/src/app/orders/page.tsx:19` | `lain` | TERBUKA | — | — |
| `CA-3-28` | §35 | Sedang | "Pesan lagi" selalu bilang berhasil meski tidak ada barang yang masuk keranjang | `apps/web/src/app/orders/detail/page.tsx:285` | `lain` | TERBUKA | — | — |
| `CA-3-29` | §35 | Sedang | "Kosongkan keranjang" jalan seketika tanpa konfirmasi maupun laporan gagal | `apps/web/src/app/cart/page.tsx:126` | `confirm-dialog` | TERBUKA | — | — |
| `CA-3-30` | §35 | Sedang | Halaman Promo: kegagalan baca terbaca sebagai "belum ada promo", dan produk biasa dilabeli "Promo" | `apps/web/src/app/promo/page.tsx:137` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-3-31` | §35 | Sedang | Jadikan-utama dan hapus metode pembayaran gagal tanpa suara | `apps/web/src/app/account/page.tsx:134` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-32` | §35 | Sedang | Penjualan konter yang dibatalkan (VOIDED) menempel selamanya di Beranda sebagai pesanan berjalan | `apps/web/src/components/active-order-card.tsx:17` | `lain` | TERBUKA | — | — |
| `CA-3-33` | §35 | Sedang | Kode voucher yang tertinggal di kolom menolak seluruh pesanan | `apps/web/src/app/checkout/page.tsx:529` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-34` | §35 | Rendah | Ubah jumlah dan hapus baris di keranjang membalik sendiri tanpa penjelasan | `apps/web/src/app/cart/page.tsx:97` | `lain` | TERBUKA | — | — |
| `CA-3-35` | §36 | Sedang | Tautan "Lewati" di /register mengikuti next mentah dari URL, termasuk alamat situs lain | `apps/web/src/app/register/page.tsx:96` | `lain` | TERBUKA | — | — |
| `CA-3-36` | §36 | Sedang | Galat batas kirim ulang OTP muncul dalam bahasa Inggris di layar berbahasa Indonesia | `apps/web/src/lib/dictionaries/id/errors.ts:20` | `lain` | TERBUKA | — | — |
| `CA-3-37` | §36 | Sedang | Tombol "Kirim ulang kode" tidak terkunci saat permintaan berjalan dan tidak pernah dikunci ulang setelah gagal | `apps/web/src/app/verify/page.tsx:124` | `lain` | TERBUKA | — | — |
| `CA-3-38` | §36 | Sedang | Mendaftar ulang nomor yang masih menunggu verifikasi membuang nama dan email yang baru diketik | `services/auth-service/src/application/services/registration.service.ts:58` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-3-39` | §36 | Rendah | Kolom nama dan email di pendaftaran terlihat wajib padahal opsional | `apps/web/src/app/register/page.tsx:149` | `lain` | TERBUKA | — | — |
| `CA-3-40` | §37 | Sedang | Kode rujukan bisa dipakai pelanggan lama — syarat "pelanggan baru" tidak pernah ditegakkan | `services/referral-service/src/application/services/referral.service.ts:144` | `lain` | TERBUKA | — | — |
| `CA-3-41` | §37 | Sedang | Tombol "Riwayat poin →" di /rewards tidak melakukan apa pun di layar ponsel | `apps/web/src/app/rewards/page.tsx:712` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-42` | §37 | Sedang | Dompet voucher tidak pernah menyebut status; voucher yang belum berlaku ditawarkan sebagai bisa dipakai | `apps/web/src/app/vouchers/page.tsx:139` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-43` | §37 | Sedang | Stok hadiah dikurangi tanpa penjaga, jadi hadiah terakhir bisa ditukar dua orang | `services/loyalty-service/src/infrastructure/prisma/reward.prisma.repository.ts:101` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-44` | §37 | Sedang | /resellers memberi SUPERVISOR dan HR formulir tulis yang selalu ditolak server | `apps/web/src/app/resellers/page.tsx:222` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-3-45` | §37 | Sedang | /referral menjanjikan potongan harga untuk teman, padahal yang diberikan adalah poin setelah pesanan selesai | `apps/web/src/lib/dictionaries/id/hrFix.ts:1389` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-46` | §37 | Sedang | Formulir waralaba mengirim nilai investasi kosong sebagai Rp 0 tanpa peringatan | `apps/web/src/app/waralaba/page.tsx:90` | `lain` | TERBUKA | — | — |
| `CA-3-47` | §37 | Rendah | Tombol salin kode referral tidak memberi umpan balik apa pun dan bisa gagal diam-diam | `apps/web/src/app/referral/page.tsx:22` | `lain` | TERBUKA | — | — |
| `CA-3-48` | §38 | Sedang | Toggle persetujuan "Promo dan penawaran" tidak berpengaruh apa pun | `apps/web/src/app/account/page.tsx:505` | `pdp-registry` | TERBUKA | — | — |
| `CA-3-49` | §38 | Sedang | Email tidak bisa dikosongkan lagi setelah pernah diisi | `apps/web/src/app/account/edit/page.tsx:89` | `lain` | TERBUKA | — | — |
| `CA-3-50` | §38 | Sedang | Akun staf/kurir yang membuka /account: Preferensi, Data pribadi, dan Persetujuan hanya menampilkan error | `apps/web/src/app/account/page.tsx:1089` | `pdp-registry` | TERBUKA | — | — |
| `CA-3-51` | §38 | Sedang | Halaman Syarat & Ketentuan tidak terjangkau dari mana pun di ponsel | `apps/web/src/app/account/page.tsx:1102` | `lain` | TERBUKA | — | — |
| `CA-3-52` | §38 | Sedang | Patokan alamat yang dikosongkan tidak pernah terhapus dari buku alamat | `apps/web/src/lib/addresses.ts:129` | `lain` | TERBUKA | — | — |
| `CA-3-53` | §38 | Sedang | Formulir waralaba publik mengumpulkan nama, nomor HP, dan titik GPS tanpa persetujuan, tanpa tautan kebijakan, dan tanpa masa simpan | `apps/web/src/app/waralaba/page.tsx:102` | `pdp-registry` | TERBUKA | — | — |
| `CA-3-54` | §38 | Sedang | Ekspor data lengkap bisa diambil kapan saja tanpa melewati antrean persetujuan yang jadi alasan antrean itu ada | `services/auth-service/src/modules/auth/data-subject.controller.ts:58` | `pdp-registry` | TERBUKA | — | — |
| `CA-3-55` | §38 | Rendah | Halaman hapus akun menjanjikan 30 hari kerja; aplikasi menjanjikan dan mengukur 3x24 jam | `apps/web/src/lib/dictionaries/id/deleteAccount.ts:20` | `pdp-registry` | TERBUKA | — | — |
| `CA-3-56` | §38 | Rendah | Penanda "sudah dibaca" notifikasi tidak dibersihkan saat keluar, jadi akun berikutnya di HP yang sama melihat inbox-nya kosong-terbaca | `apps/web/src/lib/unread.ts:23` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-3-57` | §38 | Rendah | Daftar perangkat tidak menandai perangkat yang sedang dipakai | `apps/web/src/app/account/page.tsx:833` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-3-58` | §38 | Rendah | Langkah-langkah di halaman hapus akun menyebut menu yang tidak ada namanya di aplikasi | `apps/web/src/lib/dictionaries/id/deleteAccount.ts:42` | `pdp-registry` | TERBUKA | — | — |
| `CA-3-59` | §38 | Rendah | Titik lokasi pelanggan tetap tersimpan di perangkat setelah keluar akun | `apps/web/src/lib/auth-context.tsx:89` | `pdp-registry` | TERBUKA | — | — |
| `CA-3-60` | §39 | Sedang | text-deep-teal dipakai di atas permukaan yang ikut gelap — ETA kurir dan catatan riwayat hilang di mode gelap | `apps/web/src/components/order-views.tsx:144` | `lain` | TERBUKA | — | — |
| `CA-3-61` | §39 | Sedang | Kartu promo amber di Beranda: judul dan subjudul tak terbaca di mode gelap | `apps/web/src/components/promo-carousel.tsx:73` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-3-62` | §39 | Rendah | Keranjang tidak menampilkan satu pun foto produk | `apps/web/src/app/cart/page.tsx:253` | `lain` | TERBUKA | — | — |
| `CA-3-63` | §39 | Rendah | Gambar produk yang mati meninggalkan kotak kosong di grid katalog dan halaman detail | `apps/web/src/components/product-card.tsx:83` | `lain` | TERBUKA | — | — |
| `CA-3-64` | §39 | Rendah | Pesan galat form gagal kontras di mode gelap — text-red-600 mati, bukan token --danger | `apps/web/src/components/ui.tsx:123` | `lain` | TERBUKA | — | — |
| `CA-3-65` | §39 | Rendah | Tiga <label> menunjuk id yang tidak ada, sehingga kontrolnya tanpa nama bagi pembaca layar | `apps/web/src/app/subscriptions/page.tsx:252` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-3-66` | §39 | Rendah | Pemilih lokasi di app bar tidak bisa ditutup dengan mengetuk di luar atau tombol back | `apps/web/src/components/location-selector.tsx:96` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-67` | §39 | Rendah | Blok ganti nomor berada di dalam form profil, sehingga Enter menyimpan profil alih-alih mengirim kode | `apps/web/src/app/account/edit/page.tsx:191` | `lain` | TERBUKA | — | — |
| `CA-3-68` | §39 | Rendah | Tombol tambah di kartu "Sering dibeli bersama" hanya 34px — di bawah lantai sentuh 44px | `apps/web/src/app/products/detail/page.tsx:411` | `lain` | TERBUKA | — | — |
| `CA-3-69` | §39 | Rendah | Panel instruksi pembayaran di detail pesanan memakai teks Indonesia mati, tidak lewat kamus | `apps/web/src/app/orders/detail/page.tsx:463` | `jalur-uang` | TERBUKA | — | — |
| `CA-3-70` | §39 | Rendah | <Button> dibungkus <Link> di keadaan kosong katalog — kontrol bersarang, dua perhentian tab | `apps/web/src/app/products/page.tsx:330` | `lain` | TERBUKA | — | — |

## Bagian IV — Aplikasi kurir dan konsol manajer mobile (§41–§49, 33 halaman)

| ID | Bagian | Tingkat | Judul | file:baris | Kelas akar | Status | Bukti re-cek | PR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CA-4-01` | §41 | Kritis | Penarikan saldo kurir memotong saldo tapi tidak punya jalur pembayaran — status PROCESSING selamanya | `services/payout-service/src/application/services/courier-payout.service.ts:233` | `jalur-uang` | SUDAH DIPERBAIKI | `settleWithdrawal()` di kedua sisi: PAID mengubah status, FAILED mengembalikan saldo lewat kredit ADJUSTMENT ber-`sourceRef` di transaksi yang sama | #417 |
| `CA-4-02` | §41 | Kritis | Klaim biaya auto-approve dan mengkredit ledger kurir berdasarkan depotId dan receiptUrl yang dikirim klien sendiri | `services/payout-service/src/application/services/expense-claim.service.ts:43` | `depot-scope-by-id` | SUDAH DIPERBAIKI | `submit()` kini menerima pemanggilnya: `assertDepotAccess` atas depot yang diminta, jatuh ke depot token kalau body kosong; dan hanya URL http(s) yang dihitung sebagai struk | #418 |
| `CA-4-03` | §41 | Kritis | Uang COD yang sudah dipungut hilang dari setoran begitu pengantaran ditandai Gagal atau Jadwal Ulang | `apps/web/src/app/driver/deliveries/detail/page.tsx:280` | `jalur-uang` | TERBUKA | TERBUKA setelah langkah 03: memerlukan STATUS pembayaran, bukan hanya jumlahnya — `OrderPaymentPort.forOrder()` hanya mengembalikan `{ method, amount }`. Memperluas port itu adalah langkahnya sendiri. | — |
| `CA-4-04` | §41 | Kritis | Riwayat pembayaran pesanan depot manapun bisa dibaca kurir dengan satu UUID | `services/payment-service/src/modules/payment.controller.ts:325` | `depot-scope-by-id` | SUDAH DIPERBAIKI | `listForOrderAs()` membaca depot pesanan lewat order-service lalu `assertDepotAccess`; gagal tertutup kalau pesanannya tak terbaca | #416 |
| `CA-4-05` | §41 | Kritis | Kurir bisa tutup shift lalu menyelesaikan antaran — uang COD-nya lolos dari setoran | `services/delivery-service/src/application/services/shift.service.ts:99` | `jalur-uang` | SUDAH DIPERBAIKI | `checkOut()` menolak selama `countActiveByDriver > 0` — hitungan yang sama yang dipakai dispatch untuk memutuskan kurir bebas | #418 |
| `CA-4-06` | §42 | Tinggi | KPI beranda manajer mobile adalah angka seluruh jaringan, dipajang di bawah nama depotnya | `apps/web/src/app/m/manager/page.tsx:77` | `depot-scope-by-id` | TERBUKA | `const dash = useAsync<ExecutiveDashboard>(() => api.get(endpoints.dashboard.executive(), true), []);` | — |
| `CA-4-07` | §42 | Tinggi | Konsol manajer mobile terkunci ke depot pertama jaringan — antrean approval depot sendiri tak pernah muncul | `apps/web/src/app/m/manager/approvals/page.tsx:70` | `depot-scope-by-id` | TERBUKA | `? api.get(endpoints.approvals.list({ depotId: scopedId, status: 'PENDING' }), true)` | — |
| `CA-4-08` | §42 | Tinggi | Tab Tim selalu kosong atau 403: roster kurir diminta tanpa depotId lalu disaring dengan depot yang salah | `apps/web/src/app/m/manager/team/page.tsx:31` | `depot-scope-by-id` | TERBUKA | `const roster = useAsync<Customer[]>(() => api.get(endpoints.auth.drivers, true), []);` | — |
| `CA-4-09` | §42 | Tinggi | Konsol manajer di HP memilih depot dari daftar publik seluruh jaringan dan tak punya pengalih depot | `apps/web/src/lib/depot-context.tsx:91` | `depot-scope-by-id` | TERBUKA | `const scopedId = selectedId ?? depots[0]?.id ?? null;` | — |
| `CA-4-10` | §42 | Sedang | Halaman Harga bilang 'belum ada depot' padahal yang gagal adalah pemuatan daftar depot | `apps/web/src/app/m/manager/pricing/page.tsx:101` | `jalur-uang` | TERBUKA | — | — |
| `CA-4-11` | §42 | Sedang | Dua dari tiga pintasan "Buka di desktop" di akun manajer mengarah ke layar penolakan | `apps/web/src/app/m/manager/account/page.tsx:26` | `lain` | TERBUKA | — | — |
| `CA-4-12` | §43 | Tinggi | Beranda tugas menutup antaran tanpa gerbang COD — uang tunai tak pernah tercatat dan tak ada jalan kembali | `apps/web/src/app/driver/page.tsx:187` | `jalur-uang` | SUDAH DIPERBAIKI | tombol PoD di beranda diganti tautan ke layar detail untuk pesanan ber-COD; gerbang C1(c) tetap satu, tidak diduplikasi | #418 |
| `CA-4-13` | §43 | Tinggi | Tombol PoD di layar Beranda kurir menutup pengantaran COD tanpa memungut uang — pagar C1(c) hanya ada di layar detail | `apps/web/src/app/driver/page.tsx:198` | `jalur-uang` | SUDAH DIPERBAIKI | idem CA-4-12 — jalur satu-ketuk hanya tersisa untuk pengantaran non-COD | #418 |
| `CA-4-14` | §43 | Tinggi | Ikon tong sampah di banner antrean luring menghapus setoran tunai dengan satu sentuhan, tanpa konfirmasi | `apps/web/src/components/offline-queue-banner.tsx:74` | `confirm-dialog` | TERBUKA | `<button` | — |
| `CA-4-15` | §43 | Tinggi | Tutup shift tidak diperiksa terhadap pengantaran yang masih berjalan, dan kurir langsung terkunci dari tugasnya | `apps/web/src/app/driver/shift/status/page.tsx:72` | `jalur-uang` | SUDAH DIPERBAIKI | sisi server ditutup bersama CA-4-05; layar kurir kini menerima 409 `SHIFT_HAS_ACTIVE_DELIVERIES` dengan pesan yang menyebutkan jalan keluarnya | #418 |
| `CA-4-16` | §43 | Sedang | Layar setoran COD tidak pernah menampilkan total tagihan sebelum kurir menyerahkan uang, padahal selisih kurangnya didebet dari upahnya | `apps/web/src/app/driver/settlement/page.tsx:105` | `jalur-uang` | TERBUKA | — | — |
| `CA-4-17` | §43 | Sedang | Setelah PoD tersimpan di antrean offline, kurir dibawa ke layar sukses yang justru menampilkan error | `apps/web/src/app/driver/deliveries/detail/success/page.tsx:28` | `lain` | TERBUKA | — | — |
| `CA-4-18` | §44 | Tinggi | Progres tangga bonus di /driver/goal memakai hitungan antar MINGGUAN dibanding ambang tangga yang BULANAN | `apps/web/src/app/driver/goal/page.tsx:108` | `jalur-uang` | TERBUKA | `const achieved = delivered >= tier.deliveries;` | — |
| `CA-4-19` | §44 | Tinggi | Tidak ada apa pun yang bisa menutup shift yang lupa di-check-out, dan check-in berikutnya diam-diam menyambung shift lama | `services/delivery-service/src/application/services/shift.service.ts:72` | `gerbang-kapabilitas` | TERBUKA | `if (open.depotId === depotId) return this.view(open);` | — |
| `CA-4-20` | §44 | Tinggi | Tangga bonus di layar Target membandingkan hitungan MINGGUAN dengan syarat BULANAN yang dipakai server untuk membayar | `apps/web/src/app/driver/goal/page.tsx:44` | `jalur-uang` | DUPLIKAT DARI CA-4-18 | kartu kedua atas goal/page.tsx yang sama (§44 memuatnya dua kali, keduanya Tinggi) | — |
| `CA-4-21` | §44 | Sedang | Klaim biaya kurir tidak bisa melampirkan struk, padahal layar menjanjikan persetujuan otomatis yang mustahil terjadi | `apps/web/src/app/driver/expenses/page.tsx:59` | `pdp-registry` | TERBUKA | — | — |
| `CA-4-22` | §44 | Sedang | "Bulan ini" di layar pendapatan tidak menghitung bonus tangga, sehingga tidak cocok dengan saldo di kartu yang sama | `services/payout-service/src/application/services/courier-payout.service.ts:202` | `jalur-uang` | TERBUKA | — | — |
| `CA-4-23` | §44 | Sedang | Hitung mundur sisa istirahat beku di angka penuh selama kurir sedang istirahat | `services/delivery-service/src/application/services/shift.service.ts:207` | `lain` | TERBUKA | — | — |
| `CA-4-24` | §44 | Sedang | Kurir hanya diberi tahu klaim biayanya "Ditolak", alasannya sudah ada di data tapi tidak pernah ditampilkan | `apps/web/src/app/driver/expenses/page.tsx:146` | `jalur-uang` | TERBUKA | — | — |
| `CA-4-25` | §44 | Rendah | Jenis entri INCENTIVE tidak ada di tipe web, jadi baris bonus di riwayat pendapatan tampil tanpa label jenis | `apps/web/src/lib/types.ts:1390` | `jalur-uang` | TERBUKA | — | — |
| `CA-4-26` | §44 | Rendah | Delta yang memburuk di layar performa selalu dirender hijau | `apps/web/src/app/driver/performance/page.tsx:235` | `lain` | TERBUKA | — | — |
| `CA-4-27` | §44 | Rendah | Baris bonus (INCENTIVE) di riwayat penghasilan kurir muncul tanpa label jenis | `apps/web/src/app/driver/earnings/history/page.tsx:38` | `jalur-uang` | DUPLIKAT DARI CA-4-25 | label INCENTIVE dilaporkan dua kali di §44, keduanya Rendah | — |
| `CA-4-28` | §45 | Sedang | Tombol Chat di layar no-show selalu ditolak server — percobaan kontak tidak pernah tercatat | `apps/web/src/app/driver/deliveries/detail/no-show/page.tsx:156` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-4-29` | §45 | Sedang | Estimasi waktu di layar rute kurir tak pernah muncul: endpoint-nya menolak peran kurir | `apps/web/src/app/driver/route/page.tsx:64` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-4-30` | §45 | Sedang | Layar no-show lupa segalanya saat aplikasi dibuka ulang, dan ambang 2 percobaan di-hardcode di klien | `apps/web/src/app/driver/deliveries/detail/no-show/page.tsx:44` | `jalur-uang` | TERBUKA | — | — |
| `CA-4-31` | §45 | Sedang | Pengembalian galon kedua untuk satu order ditelan diam-diam, dan layar melaporkan angka pengembalian pertama sebagai sukses baru | `apps/web/src/app/driver/deliveries/detail/returns/page.tsx:54` | `lain` | TERBUKA | — | — |
| `CA-4-32` | §45 | Sedang | Nomor urut perhentian di layar rute tak terlihat, dan kartunya putih di tema gelap | `apps/web/src/app/driver/route/page.tsx:167` | `lain` | TERBUKA | — | — |
| `CA-4-33` | §45 | Sedang | Penjadwalan ulang menerima tanggal yang sudah lewat, lalu memberitahukannya ke pelanggan | `apps/web/src/app/driver/deliveries/detail/reschedule/page.tsx:66` | `lain` | TERBUKA | — | — |
| `CA-4-34` | §45 | Sedang | Formulir bukti serah tidak punya jalan keluar; tombol back Android membuang foto, nama penerima, dan tanda tangan | `apps/web/src/app/driver/deliveries/detail/page.tsx:205` | `jalur-uang` | TERBUKA | — | — |
| `CA-4-35` | §45 | Sedang | Segel rusak tidak bisa dicatat — centang segel wajib bernilai "utuh" sebelum PoD boleh dikirim | `apps/web/src/components/driver/pod-capture.tsx:145` | `lain` | TERBUKA | — | — |
| `CA-4-36` | §45 | Sedang | Tombol Telepon dan Chat di layar no-show tidak menelepon dan tidak membuka chat | `apps/web/src/app/driver/deliveries/detail/no-show/page.tsx:145` | `lain` | TERBUKA | — | — |
| `CA-4-37` | §45 | Sedang | Gerbang no-show di layar memakai angka 2 yang dipatok di kode, sementara servernya per depot | `apps/web/src/app/driver/deliveries/detail/no-show/page.tsx:68` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-4-38` | §45 | Rendah | Layar sukses PoD mengklaim "bukti terkirim" untuk bukti yang baru masuk antrean offline | `apps/web/src/app/driver/deliveries/detail/success/page.tsx:69` | `lain` | TERBUKA | — | — |
| `CA-4-39` | §45 | Rendah | ETA di layar antar kurir memakai kecepatan tetap 22 km/jam, berbeda dari yang dijanjikan ke pelanggan | `apps/web/src/components/driver/live-nav.tsx:26` | `lain` | TERBUKA | — | — |
| `CA-4-40` | §46 | Sedang | Satu ketukan di HP mematikan aturan harga hasil persetujuan HQ, tanpa konfirmasi dan tanpa jejak audit | `apps/web/src/app/m/manager/pricing/page.tsx:51` | `confirm-dialog` | TERBUKA | — | — |
| `CA-4-41` | §46 | Sedang | Manajer menyetujui atau menolak uang dari HP tanpa bisa menulis alasan, dan tanpa melihat alasan pengaju | `apps/web/src/app/m/manager/approvals/detail/page.tsx:38` | `gerbang-kapabilitas` | TERBUKA | — | — |
| `CA-4-42` | §46 | Sedang | Layar keputusan di HP menghilangkan 'Tahan' dan konteks pengajuan (kapan diajukan, oleh siapa) | `apps/web/src/app/m/manager/approvals/detail/page.tsx:181` | `lain` | TERBUKA | — | — |
| `CA-4-43` | §46 | Sedang | Layar harga manajer menampilkan UUID produk sebagai nama aturan yang sedang dihidup-matikan | `apps/web/src/app/m/manager/pricing/page.tsx:65` | `jalur-uang` | TERBUKA | — | — |
| `CA-4-44` | §46 | Sedang | Setujui dan Tolak berdampingan dengan ukuran sama, tanpa konfirmasi, pada keputusan uang yang tidak bisa dibatalkan | `apps/web/src/app/m/manager/approvals/detail/page.tsx:191` | `confirm-dialog` | TERBUKA | — | — |
| `CA-4-45` | §46 | Rendah | Login manajer membuang masa berlaku dan cooldown OTP yang sudah dijawab server | `apps/web/src/app/m/manager/login/page.tsx:33` | `jalur-uang` | TERBUKA | — | — |
| `CA-4-46` | §47 | Tinggi | Laporan insiden kurir dikirim tanpa lokasi dan tanpa depot — kecelakaan tidak bisa didatangi siapa pun | `apps/web/src/app/driver/incidents/new/page.tsx:67` | `jalur-uang` | TERBUKA | `{ category, severity, description: description.trim(), photoUrl },` | — |
| `CA-4-47` | §47 | Tinggi | Delivery tanpa customerId membuat retur galon kurir dibayar dari saldo deposit kolektif depot | `services/delivery-service/src/application/services/delivery.service.ts:199` | `jalur-uang` | TERBUKA | `customerId: input.customerId ?? null,` | — |
| `CA-4-48` | §47 | Sedang | Insiden LOW dan MEDIUM masuk ke tabel yang tidak punya satu pun pembaca | `services/delivery-service/src/application/ports/incident.repository.ts:32` | `lain` | TERBUKA | — | — |
| `CA-4-49` | §47 | Sedang | Foto bukti serah dan foto insiden disimpan di URL bucket publik tanpa autentikasi maupun kedaluwarsa | `services/delivery-service/src/infrastructure/storage/s3-storage.adapter.ts:19` | `pdp-registry` | TERBUKA | — | — |
| `CA-4-50` | §48 | Sedang | Saklar notifikasi kurir hanya ditulis ke localStorage dan tidak pernah dibaca oleh apa pun, termasuk "Jangan ganggu" | `apps/web/src/app/driver/settings/page.tsx:80` | `jalur-uang` | TERBUKA | — | — |
| `CA-4-51` | §48 | Sedang | Ubin "Kurir aktif" di beranda manajer menghitung pengantaran, bukan kurir | `apps/web/src/app/m/manager/page.tsx:88` | `lain` | TERBUKA | — | — |
| `CA-4-52` | §48 | Rendah | JSON.parse preferensi tanpa penjaga membuat halaman setelan kurir gagal render kalau nilainya rusak | `apps/web/src/app/driver/settings/page.tsx:74` | `lain` | TERBUKA | — | — |

## Bagian V — Di luar permukaan halaman (§50 kekurangan 7)

| ID | Bagian | Tingkat | Judul | file:baris | Kelas akar | Status | Bukti re-cek | PR |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `CA-5-01` | §50/k7 | SAPUAN | SAPUAN · 14 sweep terjadwal berjalan tanpa penonton di jalur uang dan PDP — subscriptions, retention, payments, loyalty, orders, deliveries, fraud-flags, webhooks, campaigns, announcements, customers, profile, reports, scheduled-reports. Tidak satu pun punya halaman, jadi audit yang digerakkan halaman tidak melihatnya; Kritis §31 kedua ADALAH salah satu sweep ini, ditemukan lewat gejalanya di aplikasi pelanggan. | `scripts/scheduler/crontab` | `sweep-tanpa-penonton` | TERBUKA | — | — |


---

## Urutan kerja

Dari §50, tidak diubah. Sapuan lebih dulu, tiket satuan belakangan.

| # | Langkah | Kelas akar | Baris register yang ditutupnya |
| --- | --- | --- | --- |
| 00 | Register + pass re-cek (dokumen ini) | — | — |
| 01 | Sapu depot-scope pada seluruh route by-id | `depot-scope-by-id` | CA-2-03 + CA-4-04 ditutup (PR #416); sisanya diratchet, lihat di bawah |
| 02 | Beri `PROCESSING` jalan keluar — kurir **dan** pemilik waralaba | `jalur-uang` | CA-4-01 + sisi `payout.service.ts:280` |
| 03 | Klaim biaya, tutup shift, gerbang COD | `jalur-uang` | CA-4-02, CA-4-05, CA-4-12..15 |
| 04 | Registry penghapusan PDP + perbaiki teks /hapus-akun | `pdp-registry` | CA-3-01 + CA-3-02 ditutup (PR #419); 8 dari 9 tabel AUDIT_L3 §4.2 punya eksekutor, `depot.order_disputes` dilaporkan UNENFORCED beserta alasannya |
| 05 | Hentikan halaman HQ membaca proyeksi publik | `proyeksi-publik` | CA-2-04 |
| 06 | Sapu ConfirmDialog ke aksi yang tidak bisa dibatalkan | `confirm-dialog` | semua baris berkelas itu |
| 07 | Sapu gerbang kapabilitas di rail dan halaman /hq | `gerbang-kapabilitas` | semua baris berkelas itu |
| 08 | Skrip laporan untuk baris yang sudah rusak di produksi (**dry-run**) | `jalur-uang` | — |
| 09 | 14 sweep terjadwal diberi penonton | `sweep-tanpa-penonton` | CA-5-01 (CA-3-02 sudah ditutup di langkah 04) |
| 10+ | Sisa Sedang/Rendah + isi sel ringkas, dikelompokkan per kelas akar | `lain` | sisanya |

### Gerbang yang sudah dipasang

| Gerbang | Dipasang di | Apa yang ia jaga |
| --- | --- | --- |
| `scripts/check-depot-scope.mjs` + `scripts/depot-scope-baseline.json` | CI job `gate` (PR #416, diperbaiki #418 dan #419) | Tiap route by-id yang bisa dicapai peran ber-scope depot dan tidak menyebut `assertDepotAccess`/`depotScopeIds` masuk hitungan. Angkanya hanya boleh TURUN: baseline **63** pada 1 September 2026 (turun dari 83 begitu gerbangnya belajar membaca `@Can` di tingkat KELAS — 22 di antaranya tidak pernah lubang). Uji-diri: `scripts/check-depot-scope.test.sh`. |

Baseline 63 itu bukan 63 lubang. Sebagian besar adalah baris milik pelanggan
(`cart/items/:productId`), baris se-jaringan (`products/:id`) atau baris milik kurir yang
dijaga kepemilikan, bukan depot. Yang dijanjikan gerbang ini bukan "semuanya aman", melainkan
"jumlahnya tidak bisa bertambah tanpa ada yang melihat" — persis aturan
`purge-executor.registry.ts`: di luar daftar dilaporkan, bukan dilewatkan diam-diam. Tiap PR
berikutnya yang meninjau satu route menurunkan angkanya lewat `--write`.

### Aturan yang mengikat tiap PR

- Branch `fix/console-audit-<nn>-<slug>` dari `main` terbaru. Tidak pernah commit langsung ke `main`.
- **Sebelum tiap PR**: `git pull`, lalu buka lagi baris kartunya. Sudah diperbaiki orang lain →
  `SUDAH DIPERBAIKI (PR #x)`, lewati.
- **Gerbang regresi wajib**: tiap PR meninggalkan minimal satu uji yang **GAGAL** kalau
  perbaikannya di-revert. Tanpa itu PR tidak dibuka. Gate coverage yang sudah ada tidak diturunkan.
- **Migrasi ikut urutan rilis**: kolom/tabel baru satu rilis lebih dulu, kode yang membacanya
  belakangan. Buktikan up → rerun → down → up di Postgres bersih. CI DB-nya kosong, jadi hijau di
  CI bukan bukti terpasang di prod.
- **Perbaikan data produksi**: skripnya ditulis, tidak dijalankan. Dry-run by default, cetak
  hitungan baris dulu.

### Berhenti dan tanya

Berhenti pada item itu, lanjut item lain yang tidak bergantung padanya, kumpulkan jadi satu batch:

1. Repo punya komentar berkode yang menyatakan “cacat” itu disengaja → `KEPUTUSAN`.
2. Perbaikannya mengubah angka bisnis (tarif, ambang, persentase, jendela retensi).
3. Perbaikannya mengubah teks legal/persetujuan/UU PDP di luar kalimat /hapus-akun yang sudah diputuskan.
4. Perbaikannya butuh menulis ke data produksi.
5. Kartunya bertentangan dengan `docs/AUDIT_L3.md`.

