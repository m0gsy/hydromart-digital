# HRIS Lite — Audit Gap & Rencana Penyelesaian

> **Status dokumen:** rencana yang sudah disetujui, belum dieksekusi.
> **Tanggal audit:** 2026-07-29. **Basis:** pembacaan kode, bukan ingatan — setiap klaim
> punya berkas rujukan.
> **Lingkup:** Fase A–C (backend + web). Mobile (Fase D) di luar dokumen ini.

Dokumen ini membandingkan spesifikasi HRIS Lite (10 modul + dashboard + reporting +
database + backend + frontend + mobile + integrasi + security + testing) terhadap kode
yang benar-benar ada di `services/hr-service` dan `apps/web/src/app/hr`.

---

## 1. Ringkasan hasil audit

**~55% terimplementasi.** Yang ada berkualitas produksi — 365 test hijau di hr-service,
coverage 90/90/90/90, arsitektur heksagonal penuh, RBAC, audit interceptor, Swagger.
Bukan kerangka kosong. Tetapi **empat modul nol besar** dan ada tiga gap lintas-modul.

| # | Modul | Status | Bukti |
| --- | --- | --- | --- |
| 1 | Employee Management | **80%** | model `Employee` + `EmploymentHistory`, `employee.service.ts` (10 KB), UI `/hr/employees` (+detail, new, import) |
| 2 | Face Recognition Attendance | **90%** | `face.service.ts`, `face-math.ts`, `face-verifier.port.ts`, `neo-face.provider.ts`, `attendance.service.ts` (11 KB), UI `/hr/me/enroll` + `/hr/me/check-in` |
| 3 | Shift Management | **35%** | model `Shift` + `shift.service.ts` (2,2 KB) + `Employee.shiftId` |
| 4 | **Leave Management** | **0%** | **tidak ada model, service, endpoint, maupun halaman** |
| 5 | Holiday Calendar | **70%** | model `Holiday`, `holiday.service.ts`, UI `/hr/calendar` |
| 6 | Payroll Engine | **95%** | `payroll.service.ts` (15 KB), `payroll-pdf.ts`, `bonus-rules.ts`, `tenure.ts`, `loan.ts`, `overtime.ts` |
| 7 | Performance Management | **25%** | model `PerformanceReview` + `performance.service.ts` (1,4 KB) + UI `/hr/performance` |
| 8 | **Announcement Center** | **0%** untuk HR | `DepotBroadcast` di crm-service hanya untuk kurir per-depot |
| 9 | **Document Management** | **0%** | nol kecocokan `EmployeeDocument` di seluruh hr-service |
| 10 | **Asset Management** | **0%** | nol kecocokan asset di seluruh hr-service |

### Modul yang sudah matang — apa isinya

- **Payroll** yang paling lengkap: tipe karyawan TRAINING/PROBATION/PERMANENT/DEPOT_MANAGER,
  harian vs bulanan, bonus manual + aturan bonus otomatis (`BonusRule`), potongan
  terlambat, potongan absen otomatis, cicilan kasbon, kenaikan masa kerja, lembur, slip
  PDF, alur DRAFT → APPROVED → PAID yang mengunci, semuanya konfigurabel per-depot lewat
  `setting-defs.ts`.
- **Face attendance**: enrollment, verifikasi, **liveness detection** (`face-verifier.port.ts`
  + `neo-face.provider.ts` — sering dikira belum ada), penyimpanan embedding, riwayat,
  koreksi manual dengan jejak `AttendanceAdjustment`, aturan jam kerja/toleransi/potongan
  yang konfigurabel.
- **Employee**: profil, status, posisi, depot, riwayat jabatan (`EmploymentHistory`
  append-only), info gaji, kontak darurat, NPWP/BPJS, status ACTIVE/INACTIVE/RESIGNED.

### Empat modul kosong — apa persisnya yang tidak ada

**Leave Management.** Tidak ada `Leave` model, service, endpoint, atau halaman. Yang ada
hanya nilai `LEAVE` di enum `AttendanceStatus` yang **diisi manual oleh HR** lewat
`attendance.service.ts:208`. Artinya karyawan tidak bisa mengajukan cuti; tidak ada jenis
cuti, alur persetujuan, maupun saldo. Payroll memang membaca `leaveDays`, tapi angka itu
berasal dari entri manual HR, bukan dari cuti yang disetujui.

**Announcement Center.** `DepotBroadcast` di crm-service punya read-status, tapi targetnya
hanya depot, audiensnya kurir, tanpa push, tanpa penjadwalan, tanpa target
company/department/role/employee. Lebih dalam: **hr-service tidak punya port notifikasi
sama sekali** — tidak ada jalur teknis apa pun dari HR ke pengguna.

**Document & Asset Management.** Nol. `storage.port.ts` ada di hr-service (dipakai foto
wajah) sehingga fondasi penyimpanannya tersedia, tapi dokumen karyawan
(KTP/KK/kontrak/NPWP/sertifikat) dengan versioning dan audit, serta pelacakan aset
(motor/HP/seragam/laptop), belum ada.

### Gap lintas-modul

| Gap | Fakta | Dampak |
| --- | --- | --- |
| `deleted_at` / soft delete | **0 kecocokan** di `hr-service/prisma/schema.prisma` | Spesifikasi mewajibkan `deleted_at` di setiap tabel. Kode memilih `EmployeeStatus.RESIGNED` sebagai gantinya (lihat komentar schema baris 33) — keputusan sadar, bukan kelalaian |
| Department | **Tidak ada di mana pun** — bukan field, bukan model | Dipakai spesifikasi di modul 1, target announcement, dan statistik dashboard. Semua terblokir sampai entitas ini ada |
| GPS | `geofence.ts` dipakai di `attendance.service.ts:53` dan `:93` | Spesifikasi menulis "No GPS"; kode menolak absen di luar radius depot (default 0 = nonaktif) |
| Reporting | 3 dari 8 laporan (`reports.controller.ts`) | Belum ada: late, leave, performance, asset, announcement. PDF hanya untuk slip gaji |
| Mobile app | `apps/` hanya berisi `web/`; nol jejak Capacitor/Expo/React Native | Seluruh bab MOBILE (offline queue, biometric, secure storage) **0%** |
| UI Shift & Bonus/Deduction | Shift hanya muncul di dalam `/hr/calendar`; tidak ada halaman Bonus atau Deduction tersendiri | Spesifikasi meminta halaman terpisah |

---

## 2. Keputusan yang sudah dikunci

| Topik | Keputusan | Konsekuensi |
| --- | --- | --- |
| GPS absensi | **Pertahankan geofence** | Spesifikasi "No GPS" yang disesuaikan, bukan kodenya. Geofence adalah satu-satunya penahan absen titip di sistem berbasis wajah, dan default-nya sudah nonaktif (radius 0). Nol perubahan di `attendance.service.ts` |
| Soft delete | **Pertahankan status lifecycle** | Tidak ada `deletedAt` di 16 model lama **maupun** model baru — satu pola, bukan dua. Untuk data HR ini juga lebih jujur: karyawan resign bukan baris yang "dihapus" |
| Basis upah lembur | **Gaji pokok saja** | Tunjangan tidak masuk basis. Nol perubahan pada `domain/overtime.ts` dan test lembur yang sudah teruji |
| Penamaan `SalaryRule` | **Tetap `BonusRule` + `ServiceSetting`** | Tidak ada rename model produksi hanya demi kecocokan nama spesifikasi; fungsinya sudah setara dan sudah teruji |
| Kuota cuti | **ANNUAL + PERMISSION memotong kuota** | SICK dan EMERGENCY tetap dicatat dan dibayar, tapi tidak mengurangi jatah tahunan |
| Lingkup | **Fase A + B + C** | 3 modul baru dari nol, plus Announcement, Performance, Shift, dan 5 laporan. Mobile di luar lingkup |

### Apakah tiga modul yang sudah matang menjadi 100%?

Ya, setelah rencana ini mencakup **A3**.

| Modul | Sekarang | Sisa gap | Ditutup oleh |
| --- | --- | --- | --- |
| Employee | 80% | Department; dokumen karyawan; (soft delete) | **A1** + **B2**; soft delete selesai lewat keputusan, bukan kode |
| Face Attendance | 90% | Absensi memakai shift **depot** (`findActiveForDepot` di `attendance.service.ts:62`), bukan shift yang ditugaskan ke karyawan; (GPS) | **C3**; GPS selesai lewat keputusan |
| Payroll | 95% | **Tunjangan (allowance)** — nol kecocokan. Spesifikasi menyebutnya terpisah dari Bonus, dan memang beda: tunjangan itu tambahan **tetap berulang**, bonus itu variabel | **A3** |

---

## 3. Prinsip: pakai ulang, jangan bangun paralel

Empat fondasi sudah ada dan **wajib** dipakai ulang, bukan ditiru:

- **Notifikasi** → `POST /crm/api/v1/notifications/internal`
  (`services/crm-service/src/modules/notification.controller.ts:107`), `@Public() +
  InternalAuthGuard`, body `{ event, phone, vars, customerId }`. Ini menulis feed in-app
  **dan** mengirim WhatsApp sekaligus. Push web lewat `push.service` yang sudah ada di
  crm. **Jangan** bangun stack notifikasi kedua di hr-service.
- **Penyimpanan file** → `services/hr-service/src/application/ports/storage.port.ts`
  (dipakai foto wajah), lengkap dengan adapter S3 + no-op dev. Dokumen karyawan memakai
  port yang sama dengan `keyPrefix: 'hr/documents'`.
- **RBAC** → `CAPABILITIES` di `packages/access/src/index.ts`. Capability baru
  ditambahkan di sana, bukan pengecekan role ad-hoc di controller.
- **Konfigurasi** → `SETTING_DEFS` di `services/hr-service/src/config/setting-defs.ts` +
  `tunableNum/tunableStr` di `hr-config.service.ts` (per-depot + GLOBAL).

Aturan repo yang berlaku di setiap commit: coverage **90/90/90/90**, setiap migration
punya `rollback.sql`, typecheck + lint + prettier bersih.

---

## 4. Milestone A — Fondasi (memblokir B dan C)

### A1. Department

- `prisma/schema.prisma`: model `Department` (`id`, `name`, `code` unik, `depotId`
  nullable = lintas-depot, `active`) + `Employee.departmentId` nullable.
- Migration + `rollback.sql`. **Backfill tidak otomatis** — karyawan lama
  `departmentId = null` dan UI menampilkan "Belum diatur". Menebak departemen orang
  adalah data palsu.
- `department.repository.ts` + `department.service.ts` + CRUD, pola sama seperti
  `shift.service.ts`.
- Web: kolom + filter departemen di `/hr/employees`, field di form `new`/`[id]`.

### A2. Port notifikasi HR

- `application/ports/notification.port.ts`: `notify(event, phone, vars, subjectId)`.
- `infrastructure/http/notification.http.adapter.ts`: panggil
  `${CRM_SERVICE_URL}/api/v1/notifications/internal` dengan header `x-internal-key`.
  **Fail-open** dengan log — notifikasi gagal tidak boleh menggagalkan approval cuti.
  Tiru `services/order-service/src/infrastructure/http/notification.http.adapter.ts`.
- Env: `CRM_SERVICE_URL` + `INTERNAL_SERVICE_KEY` di `env.validation.ts`.

### A3. Tunjangan (allowance) — membawa Payroll ke 100%

Bonus tidak bisa dipakai sebagai penggantinya: bonus adalah baris sekali-bayar per
periode, tunjangan adalah komponen **tetap yang berulang** setiap bulan sampai dicabut.

- Model `Allowance`: `employeeId`, `type` (TRANSPORT/MEAL/POSITION/HOUSING/OTHER),
  `amount`, `effectiveFrom`, `effectiveTo` nullable, `active`, `note`.
- Enum `PayrollItemKind` ditambah `ALLOWANCE` supaya slip gaji memisahkannya dari bonus.
  Migration memperluas enum Postgres, jadi `rollback.sql` harus jujur soal batas itu.
- `payroll.service.ts`: baris tunjangan aktif pada periode ditambahkan sebelum bonus.
  **Tunjangan TIDAK masuk basis upah lembur** — `minuteRate()` di `domain/overtime.ts`
  tetap membagi `monthlyRate`/`dailyRate` saja, dan nol test lembur perlu diubah. Tulis
  satu test yang membuktikan: karyawan bertunjangan dan tanpa tunjangan menerima upah
  lembur yang sama persis.
- Web: halaman `/hr/allowances` + tab di detail karyawan.

---

## 5. Milestone B — Tiga modul kosong

### B1. Leave Management

Model `LeaveRequest` (jenis ANNUAL/SICK/PERMISSION/EMERGENCY, tanggal mulai–selesai,
alasan, lampiran opsional, status `PENDING_MANAGER → PENDING_HR →
APPROVED/REJECTED/CANCELLED`, `managerDecidedBy/At`, `hrDecidedBy/At`, catatan penolakan)
dan `LeaveBalance` (per karyawan per tahun, kuota + terpakai).

```text
Karyawan ajukan → PENDING_MANAGER → manager setuju → PENDING_HR → HR setuju → APPROVED
                        │ tolak                           │ tolak
                        ▼                                 ▼
                    REJECTED                          REJECTED
```

- Domain murni `domain/leave.ts`: hitung hari kerja cuti (**pakai ulang**
  `workingDaysInMonth`/`parseWeeklyOffDays` di `domain/calendar.ts` supaya libur nasional
  dan libur mingguan tidak ikut terpotong dari kuota), validasi tumpang tindih, transisi
  status yang sah.
- `leave.service.ts`: submit, decideManager, decideHr, cancel, listSelf, listForApproval,
  balance. Notifikasi di setiap transisi lewat port A2.
- **Sinkronisasi absensi**: saat `APPROVED`, tulis baris `Attendance` berstatus `LEAVE`
  untuk setiap hari kerja dalam rentang — pakai ulang `upsertManual` yang sudah ada di
  `application/ports/attendance.repository.ts`. Inilah yang menghubungkan cuti ke
  payroll: `payroll.service.ts` sudah membaca `leaveDays` dari `attendance.summary`,
  jadi **nol perubahan di payroll**.
- **Kuota**: `ANNUAL` dan `PERMISSION` memotong `LeaveBalance`; `SICK` dan `EMERGENCY`
  tidak. Aturannya hidup di `domain/leave.ts` sebagai satu fungsi murni
  (`deductsQuota(type)`), bukan `if` yang tersebar — supaya kalau kebijakan berubah,
  hanya satu tempat yang disentuh dan testnya langsung menangkap.
- RBAC: capability `leaveApprove` (DEPOT_MANAGER tahap 1, HR tahap 2).
- Web: `/hr/leave` (antrean persetujuan), `/hr/me/leave` (ajukan + riwayat sendiri).

### B2. Document Management

Model `EmployeeDocument`: `employeeId`, `type` (KTP/KK/CONTRACT/NPWP/CERTIFICATE/OTHER),
`fileUrl`, `fileKey`, `mimeType`, `sizeBytes`, `version`, `supersededById` nullable,
`uploadedBy`, `expiresAt` nullable.

- **Versioning = baris baru**, bukan menimpa file. Unggah pengganti menaikkan `version`
  dan menandai yang lama `supersededById`. Riwayat tidak pernah hilang.
- Unggah lewat `StoragePort` yang sudah ada, `keyPrefix: 'hr/documents'`. Validasi
  mimetype + ukuran meniru `services/auth-service/src/modules/auth/avatar.controller.ts`,
  termasuk **503 saat storage mati**.
- Audit: setiap unggah/ganti/unduh masuk `AuditLog` lewat `audit.service.ts` yang ada.
- Web: tab Dokumen di `/hr/employees/[id]` + preview/unduh/ganti.

> **Catatan UU PDP:** modul ini menyimpan KTP dan KK — data pribadi yang persis diatur
> UU 27/2022. Item 13 pada daftar perubahan UAT (modul UU PDP tahap 1) bersinggungan
> langsung di sini dan sebaiknya diputuskan sebelum B2 dikerjakan.

### B3. Asset Management

Model `EmployeeAsset` (`type` MOTORCYCLE/SMARTPHONE/UNIFORM/LAPTOP/PRINTER/SCANNER/OTHER,
kode aset, merek/serial, nilai, `status` AVAILABLE/ASSIGNED/RETURNED/MAINTENANCE/LOST)
dan `AssetMovement` append-only (ASSIGN/TRANSFER/RETURN/MAINTENANCE, dari/ke karyawan,
tanggal, catatan, kondisi).

- Aturan domain di `domain/asset.ts`: transisi status yang sah (aset ASSIGNED tidak bisa
  di-assign lagi tanpa TRANSFER/RETURN dulu).
- Web: `/hr/assets` (daftar + filter) dan tab Aset di detail karyawan.

---

## 6. Milestone C — Announcement, Performance, Shift, Reports

### C1. Announcement Center

Model `Announcement` (judul, isi, level, `scheduledAt` nullable, `publishedAt`,
`createdBy`) + `AnnouncementTarget` (dimensi COMPANY / DEPOT / DEPARTMENT / ROLE /
EMPLOYEE + nilainya) + `AnnouncementRead` (`announcementId`, `employeeId`, `readAt`).

- Resolusi audiens di domain murni `domain/announcement.ts`: dari daftar target → daftar
  `employeeId`. Ini yang paling perlu diuji — target yang tumpang tindih tidak boleh
  mengirim dobel.
- Pengiriman: untuk tiap penerima yang punya `authSubjectId`, panggil port A2 (in-app +
  WhatsApp). Push web menyusul lewat crm push yang sudah ada.
- Terjadwal: `scheduledAt` di masa depan tidak langsung kirim. Rilis lewat endpoint sweep
  admin (`POST /announcements/publish-due`), **pola yang sama** dengan `expireAbandoned`
  di order-service — bukan cron baru di dalam service.
- Web: `/hr/announcements` (tulis + target + riwayat + statistik dibaca).

### C2. Performance — dari CRUD jadi skor

- `domain/performance-score.ts` (murni): skor kehadiran (dari `attendance.summary`),
  kedisiplinan (lateDays), penjualan (**pakai ulang** `application/ports/sales.port.ts`
  yang sudah dipakai aturan bonus), bobot konfigurabel lewat `SETTING_DEFS`.
- `PerformanceReview` diperluas: skor komponen + skor akhir + catatan manajer.
- Web: dashboard skor di `/hr/performance`.

### C3. Shift — rotasi & kalender

- `ShiftRotation` (pola mingguan per karyawan/depot) + `ShiftAssignment` append-only,
  karena `Employee.shiftId` sekarang menimpa tanpa jejak.
- **Absensi menghitung terhadap shift KARYAWAN.** `attendance.service.ts:62` sudah
  memakai shift, tapi `findActiveForDepot(depotId)` — yaitu shift **depot**. Kolom
  `Employee.shiftId` tidak pernah dibaca. Perubahannya: shift karyawan dulu → shift depot
  → `workStartTime` config. Ini perubahan perilaku nyata bagi orang yang absen setiap
  hari, jadi diuji paling hati-hati.
- Web: halaman `/hr/shift` tersendiri (kalender + penugasan), keluar dari `/hr/calendar`.

### C4. Reporting

Tambah **late, leave, performance, asset, announcement** dengan pola yang sama persis
(`csv.ts` / `xlsx.ts` yang ada), plus ekspor **PDF** lintas laporan dengan
menggeneralisasi `domain/payroll-pdf.ts`.

---

## 7. Struktur berkas (pola berulang)

Setiap modul baru mengikuti struktur hr-service yang ada — tidak ada pola baru:

```text
prisma/schema.prisma                          + model
prisma/migrations/<tanggal>_<nama>/           migration.sql + rollback.sql
src/domain/<modul>.ts                         aturan murni, tanpa Nest/Prisma
src/application/ports/<modul>.repository.ts   interface
src/application/services/<modul>.service.ts   orkestrasi
src/infrastructure/prisma/<modul>.prisma.repository.ts
src/modules/<modul>.controller.ts + dto/      HTTP + Swagger + RBAC
src/modules/hr.module.ts                      wiring DI
test/unit/<modul>*.spec.ts                    domain + service + controller
apps/web/src/app/hr/<modul>/page.tsx          UI
apps/web/src/components/hr/hr-rail.tsx        item navigasi
apps/web/src/lib/{types,endpoints}.ts         tipe + URL
apps/web/src/lib/dictionaries/{id,en}/        label dwibahasa
packages/access/src/index.ts                  capability baru
```

---

## 8. Verifikasi

Per milestone, sebelum commit:

1. `cd services/hr-service && npm run typecheck && npm run test:cov && npm run lint` —
   coverage wajib tetap ≥90 di keempat metrik.
2. `cd apps/web && npm run typecheck && npm run lint && npm test`.
3. Migration dijalankan **maju dan mundur** di Postgres lokal sebelum menyentuh yang lain.
4. Alur end-to-end yang wajib dibuktikan, bukan diasumsikan:
   - **Cuti**: ajukan → setujui manager → setujui HR → baris `Attendance` berstatus LEAVE
     muncul untuk setiap hari kerja → payroll bulan itu menghitung `leaveDays` dan
     **tidak** memotong absen untuk hari tersebut.
   - **Cuti melintasi libur nasional**: hari libur tidak memotong kuota.
   - **Kuota cuti**: ANNUAL dan PERMISSION mengurangi saldo; SICK dan EMERGENCY tidak
     mengurangi saldo tapi tetap menghasilkan baris Attendance LEAVE.
   - **Dokumen**: unggah → ganti → versi lama masih terbaca dan tertandai superseded.
   - **Aset**: assign → transfer → return, riwayat lengkap dan status akhir benar.
   - **Announcement**: target tumpang tindih (mis. depot X **dan** departemen Y yang
     beririsan) mengirim **satu** notifikasi per orang.
   - **Terjadwal**: `scheduledAt` di masa depan tidak terkirim sampai sweep dijalankan.
   - **Tunjangan**: slip gaji punya baris ALLOWANCE terpisah dari BONUS; tunjangan yang
     `effectiveTo`-nya sudah lewat tidak terhitung; **upah lembur dua karyawan dengan
     gaji pokok sama tetap identik** walau salah satunya bertunjangan.
   - **Shift karyawan**: karyawan dengan `shiftId` sendiri dinilai terlambat terhadap jam
     shift-nya, bukan jam depot — dan karyawan tanpa `shiftId` tetap memakai jam depot
     persis seperti sebelumnya (nol regresi).
5. Jangan `npm test` dari root repo — kena timeout 600 detik dan keluar exit 255 (runner
   mati, bukan test gagal). Jalankan per service.

---

## 9. Urutan & strategi commit

Satu branch per milestone, dari `main`. B dan C bergantung pada A.

```text
A  feat/hr-department + feat/hr-notification-port   fondasi, wajib duluan
A3 feat/hr-allowance          membawa Payroll ke 100%
B1 feat/hr-leave              paling besar, paling bernilai
B2 feat/hr-documents          bersinggungan dengan UU PDP
B3 feat/hr-assets
C1 feat/hr-announcements      butuh A1 (department) + A2 (notifikasi)
C2 feat/hr-performance
C3 feat/hr-shift-rotation     mengubah perilaku absensi, uji paling hati-hati
C4 feat/hr-reports
```

**Catatan ukuran:** sembilan milestone, empat di antaranya modul penuh dari nol dengan
model, domain, service, controller, UI, dan test. Ini pekerjaan beberapa sesi, bukan satu.

---

## 10. Ketergantungan pada pekerjaan lain

- **PR UAT #38–#42** sudah dibuka, belum di-merge. Empat migration belum dijalankan.
  `/docs` akan mati di produksi tanpa `DOCS_USER`/`DOCS_PASSWORD`.
- **Item 13 (modul UU PDP tahap 1)** belum dimulai dan bersinggungan langsung dengan B2.
- **Fase D (mobile)** di luar lingkup dokumen ini.
