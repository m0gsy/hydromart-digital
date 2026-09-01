# Pass re-cek — 9 Kritis + 67 Tinggi

**Dijalankan 1 September 2026** terhadap pohon kerja `main` pada `958bc562` (100 commit setelah
audit dimulai, 8 setelah audit selesai). Tiap baris di bawah adalah berkas yang **dibuka hari ini**,
bukan yang laporan sumber tulis.

Sedang (100) dan Rendah (43) **tidak** dicek di sini — dicek saat PR-nya dikerjakan, sesuai §50
langkah 09. Register: [CONSOLE_AUDIT_REGISTER.md](CONSOLE_AUDIT_REGISTER.md).

## Yang berubah sejak laporan ditulis

Empat kartu sudah ditutup orang lain. Semuanya diverifikasi lewat baris kodenya, bukan lewat judul commit:

| Kartu | Judul | PR penutup |
| --- | --- | --- |
| `CA-1-04` | Tunjangan tidak diprorata terhadap tanggal berlakunya sendiri | #122 |
| `CA-2-13` | Tarif kurir bertanggal depan langsung berlaku saat disimpan | #413 |
| `CA-2-23` | `fetchAllPages` meminta 200 padahal server menolak di atas 100 | #407 |
| `CA-3-04` | Depot tutup memblokir SEMUA pesanan, termasuk slot terjadwal | #405 |

Satu kartu berubah jadi `KEPUTUSAN` (`CA-1-17`), tiga jadi `DUPLIKAT`, dua `DITOLAK` (§16 sudah
mencoretnya sendiri). Delapan Kritis lain **masih terbuka persis seperti §50 menemukannya**; yang
kesembilan (`CA-3-01`) nyata tapi arah perbaikannya berubah oleh keputusan pemilik.

## Catatan tentang bobot bukti pass ini

Sembilan Kritis dan enam puluh tujuh Tinggi dibuka satu per satu terhadap pohon kerja, dan setiap
vonis di bawah punya barisnya. Yang **tidak** dibuka: 100 Sedang, 43 Rendah, dan seluruh isi sel
tabel ringkas. Akurasi di lapisan yang diperiksa tidak boleh dibaca sebagai akurasi di lapisan yang
tidak diperiksa sama sekali.

---

### `CA-1-04` · §3 · Tinggi — Tunjangan tidak diprorata terhadap tanggal berlakunya sendiri

- **Berkas:** `services/hr-service/src/application/services/payroll.service.ts:187`
- **Yang terlihat hari ini:** `label: a.note ?? `Tunjangan ${a.type}`,`
- **Vonis:** SUDAH DIPERBAIKI (PR #122)
- **Catatan:** payroll.service.ts:188 kini `amount: Math.round(rupiah(a.amount) * window.fraction)`, dengan komentar D6 di :182-184 yang menamai persis kebocorannya.

### `CA-1-05` · §3 · Tinggi — Sisa kasbon dihitung dari bulan yang berlalu, bukan dari yang benar-benar terpotong

- **Berkas:** `services/hr-service/src/domain/loan.ts:42`
- **Yang terlihat hari ini:** `export function loanRemainingAfter(loan: LoanTerms, period: string): number {`
- **Vonis:** TERBUKA
- **Catatan:** `loanRemainingAfter` (loan.ts:42-46) masih `paid = installmentAmount * n` — hitungan bulan berlalu. `loanDeductionFor` di :33 SUDAH menerima `paidSoFar` (D4), jadi potongannya benar dan badge "Lunas"-nya belum.

### `CA-1-08` · §4 · Tinggi — Bonus yang dibuat setelah payroll disetujui hilang diam-diam

- **Berkas:** `apps/web/src/app/hr/adjustments/page.tsx:143`
- **Yang terlihat hari ini:** `<p className="text-xs text-muted">{t('hrFix.adjustments.entersPayroll')}</p>`
- **Vonis:** TERBUKA
- **Catatan:** adjustments/page.tsx tidak memeriksa status payroll periode yang dituju sebelum menyimpan; baris :141-143 hanya catatan createdAt.

### `CA-1-09` · §4 · Tinggi — Bonus dan potongan yang salah ketik tidak bisa dihapus dari mana pun

- **Berkas:** `services/hr-service/src/modules/adjustment.controller.ts:23–67`
- **Yang terlihat hari ini:** `@Get()`
- **Vonis:** TERBUKA
- **Catatan:** `BonusController` (adjustment.controller.ts:19-37) hanya punya `@Get()` dan `@Post()`. Tidak ada `@Delete`.

### `CA-1-10` · §4 · Tinggi — Payroll bisa dikunci meski masih ada absen PENDING

- **Berkas:** `services/hr-service/src/application/services/payroll.service.ts:88`
- **Yang terlihat hari ini:** `const existing = await this.repo.findByEmployeeAndPeriod(employeeId, periodMonth);`
- **Vonis:** DUPLIKAT DARI CA-1-42
- **Catatan:** Berkas:baris identik dengan kartu §10. §10 membantah kalimat "hilang permanen"; kartu §4 tidak pernah ditarik.

### `CA-1-11` · §5 · Tinggi — Setujui dan Tandai Dibayar langsung eksekusi

- **Berkas:** `apps/web/src/app/hr/payroll/detail/page.tsx:96–97`
- **Yang terlihat hari ini:** `{canRun && (`
- **Vonis:** TERBUKA
- **Catatan:** payroll/detail/page.tsx:98-99 `onClick={() => act(endpoints.hr.approvePayroll(id), …)}` — eksekusi langsung, tanpa ConfirmDialog.

### `CA-1-12` · §5 · Tinggi — Hapus departemen tanpa konfirmasi — dan tanpa pemeriksaan referensi

- **Berkas:** `apps/web/src/app/hr/departments/page.tsx:109 · department.service.ts:53`
- **Yang terlihat hari ini:** `<Button variant="ghost" onClick={() => remove(d.id)}>`
- **Vonis:** TERBUKA
- **Catatan:** departments/page.tsx:109 `<Button variant="ghost" onClick={() => remove(d.id)}>` — tanpa konfirmasi.

### `CA-1-16` · §6 · Tinggi — Antrean cuti berhenti di 20 permohonan, tanpa halaman 2

- **Berkas:** `apps/web/src/app/hr/leave/page.tsx:53 · endpoints/hr.ts:217`
- **Yang terlihat hari ini:** `api.get<HrPage<LeaveRequest>>(endpoints.hr.leaveQueue({ status: status || undefined }), true),`
- **Vonis:** TERBUKA
- **Catatan:** leave/page.tsx:53 memanggil `endpoints.hr.leaveQueue({ status })` tanpa page/pageSize; `listForApproval` (leave.service.ts:167) default `pageSize = 20`.

### `CA-1-17` · §6 · Tinggi — Pemilih karyawan terkunci di 100 orang aktif

- **Berkas:** `apps/web/src/components/hr/employee-select.tsx:44`
- **Yang terlihat hari ini:** `endpoints.hr.employees({ status: 'ACTIVE', pageSize: 100 }),`
- **Vonis:** KEPUTUSAN — TANYA PEMILIK
- **Catatan:** employee-select.tsx:42-43 punya komentar berkode: "ponytail: 100 is the DTO's hard @Max — a depot past 100 active staff needs a search-as-you-type picker, not a bigger page." Repo menyatakan ini disengaja.

### `CA-1-27` · §8 · Tinggi — Tunjangan dipagari hrAdmin, servernya minta hrPayroll

- **Berkas:** `apps/web/src/app/hr/allowances/page.tsx:16 · allowance.controller.ts:28,:36,:44`
- **Yang terlihat hari ini:** `const isAdmin = canManageHr(customer?.role);`
- **Vonis:** TERBUKA
- **Catatan:** allowances/page.tsx:16 `const isAdmin = canManageHr(customer?.role)` — pagar klien masih hrAdmin, bukan hrPayroll.

### `CA-1-38` · §10 · Tinggi — Payroll mengabaikan rota yang HR susun sendiri

- **Berkas:** `services/hr-service/src/application/services/payroll.service.ts:598, :667, :699 · leave.service.ts:287 · performance.service.ts:242`
- **Yang terlihat hari ini:** `const standardWorkingMinutes = this.config.standardWorkingMinutes(depotId);`
- **Vonis:** TERBUKA
- **Catatan:** `overtimeBonus` (payroll.service.ts:598-609) membaca `config.standardWorkingMinutes(depotId)` dan `config.weeklyOffDays(depotId)` — bukan rota yang HR susun.

### `CA-1-39` · §10 · Tinggi — Jam istirahat ikut dibayar sebagai lembur, setiap hari, untuk semua orang

- **Berkas:** `services/hr-service/src/application/services/attendance.service.ts:133`
- **Yang terlihat hari ini:** `const score = await this.assertFace(employee, punch);`
- **Vonis:** TERBUKA
- **Catatan:** attendance.service.ts `checkOut()` (:127-148) tidak mengurangi jam istirahat dari menit kerja.

### `CA-1-40` · §10 · Tinggi — Staf HR bisa menyetujui cutinya sendiri, dua tahap sekaligus

- **Berkas:** `services/hr-service/src/application/services/leave.service.ts:176–202 · modules/leave.controller.ts:80, :92`
- **Yang terlihat hari ini:** `async decideManager(`
- **Vonis:** TERBUKA
- **Catatan:** `decideManager` (leave.service.ts:176-188) hanya `assertDepotAccess(user, request.depotId)`. Tidak ada pemeriksaan pemohon = pemutus.

### `CA-1-53` · §12 · Tinggi — Tombol pilih file di semua halaman impor tidak bisa dicapai keyboard

- **Berkas:** `apps/web/src/components/csv-import.tsx:348`
- **Yang terlihat hari ini:** `className="hidden"`
- **Vonis:** TERBUKA
- **Catatan:** csv-import.tsx:344-348 `<input type="file" … className="hidden" />` di dalam `<label>` dengan `<span>` sebagai tombol — tidak ada perhentian tab.

### `CA-2-03` · §17 · Kritis — Manajer bisa mengubah rekening bank dan QRIS SETIAP depot di jaringan

- **Berkas:** `services/depot-service/src/modules/depot.controller.ts:251, :263, :309`
- **Yang terlihat hari ini:** `@Can('depotAdmin')`
- **Vonis:** TERBUKA
- **Catatan:** depot.controller.ts:251-258 `@Can('depotAdmin') @Patch(':id')` lalu `return this.depots.update(id, dto)` — tanpa `assertDepotAccess`. `:id` bukan kunci yang dibaca `DepotScopeGuard`.

### `CA-2-04` · §17 · Kritis — Detail depot HQ membaca proyeksi publik — menyuntingnya menghapus rekening bank depot

- **Berkas:** `apps/web/src/app/hq/depots/detail/page.tsx:42`
- **Yang terlihat hari ini:** `const depot = useAsync<DepotAdmin>(() => api.get(endpoints.depots.detail(id), true), [id]);`
- **Vonis:** TERBUKA
- **Catatan:** hq/depots/detail/page.tsx:43 `useAsync<DepotAdmin>(() => api.get(endpoints.depots.detail(id), true))` — tipe klien DepotAdmin di atas route yang mengembalikan proyeksi publik.

### `CA-2-05` · §18 · Tinggi — “Blokir” di antrean fraud tidak memblokir apa pun

- **Berkas:** `apps/web/src/app/hq/fraud/page.tsx:114 · fraud-flag.service.ts:35`
- **Yang terlihat hari ini:** `<Button variant="danger" onClick={() => act(r, 'block')}>`
- **Vonis:** TERBUKA
- **Catatan:** hq/fraud/page.tsx:114 `act(r, 'block')` — layar mengganti status flag saja.

### `CA-2-06` · §18 · Tinggi — IP allowlist dan timeout sesi disimpan, tidak ditegakkan di mana pun

- **Berkas:** `apps/web/src/app/hq/security/page.tsx:97–110 · security-policy.service.ts:31`
- **Yang terlihat hari ini:** `<div className="flex flex-col gap-6">`
- **Vonis:** TERBUKA
- **Catatan:** hq/security/page.tsx menyimpan `policy.idleTimeoutMinutes`; tidak ada pembaca di jalur autentikasi.

### `CA-2-08` · §19 · Tinggi — Ongkir dihitung dua kali dalam net payout

- **Berkas:** `apps/web/src/app/hq/reconciliation/page.tsx:173`
- **Yang terlihat hari ini:** `? sales - platformFee - commission + shippingBilled - refunds - gallonDeposit`
- **Vonis:** TERBUKA
- **Catatan:** reconciliation/page.tsx:173 `sales - platformFee - commission + shippingBilled - refunds - gallonDeposit`.

### `CA-2-09` · §19 · Tinggi — Komisi waralaba dihitung dari dasar yang berbeda dengan yang benar-benar ditagih

- **Berkas:** `apps/web/src/app/hq/reconciliation/page.tsx:117 vs order.service.ts:1612`
- **Yang terlihat hari ini:** `const commission = sales != null && scheme ? Math.round(sales * (scheme.pct / 100)) : null;`
- **Vonis:** TERBUKA
- **Catatan:** reconciliation/page.tsx:117 `Math.round(sales * (scheme.pct / 100))` — dasarnya `revenue` roll-up, bukan dasar yang ditagih order-service.

### `CA-2-10` · §19 · Tinggi — Rekonsiliasi hanya bisa dibuat untuk 10 depot terbesar

- **Berkas:** `apps/web/src/app/hq/reconciliation/page.tsx:105 · dashboard.service.ts:142`
- **Yang terlihat hari ini:** `const topRow = dash.data?.topDepots?.items.find((r) => r.depotId === selected) ?? null;`
- **Vonis:** TERBUKA
- **Catatan:** reconciliation/page.tsx:105 `dash.data?.topDepots?.items.find(...)` — depot di luar daftar teratas menghasilkan `null`.

### `CA-2-12` · §20 · Tinggi — Aturan harga memakai batas hari UTC — promo mati jam 07:00 di hari terakhirnya

- **Berkas:** `services/depot-service/src/modules/pricing.controller.ts:13 · domain/pricing-rule.ts:54`
- **Yang terlihat hari ini:** `return v ? new Date(v) : null;`
- **Vonis:** TERBUKA
- **Catatan:** pricing.controller.ts:12-14 `toDate(v) { return v ? new Date(v) : null; }` — batas hari tetap UTC.

### `CA-2-13` · §20 · Tinggi — Tarif kurir bertanggal depan langsung berlaku saat disimpan

- **Berkas:** `services/payout-service/src/infrastructure/prisma/courier-ledger.prisma.repository.ts:164`
- **Yang terlihat hari ini:** `async currentRule(`
- **Vonis:** SUDAH DIPERBAIKI (PR #413)
- **Catatan:** `currentRule(depotId, asOf)` kini menyaring `effectiveDate <= asOf`; komentar :168-177 menyebut ukuran produksi 2026-08-31.

### `CA-2-14` · §20 · Tinggi — Skema komisi bertanggal depan juga langsung berlaku

- **Berkas:** `services/payout-service/src/infrastructure/prisma/commission-scheme.prisma.repository.ts:31, :39`
- **Yang terlihat hari ini:** `// silently stops being paid.`
- **Vonis:** TERBUKA
- **Catatan:** `currentForDepot` (commission-scheme.prisma.repository.ts:40-44) `findFirst({ where: { depotId }, orderBy: { effectiveDate: 'desc' } })` — tanpa gerbang tanggal. `listCurrent` DISTINCT ON juga tanpa gerbang.

### `CA-2-15` · §21 · Tinggi — Konsol depot memilih depot default dari daftar seluruh jaringan, bukan depot milik penggunanya

- **Berkas:** `apps/web/src/lib/depot-context.tsx:68, :91`
- **Yang terlihat hari ini:** `.get<Page<Depot>>(endpoints.depots.browse({ limit: 100 }), true)`
- **Vonis:** TERBUKA
- **Catatan:** depot-context.tsx:68 `endpoints.depots.browse({ limit: 100 })` — daftar publik seluruh jaringan.

### `CA-2-16` · §21 · Tinggi — FINANCE dan MARKETING memegang kapabilitas yang layarnya hanya ada di /hq — dan isHq() menolak keduanya

- **Berkas:** `apps/web/src/lib/roles.ts:68`
- **Yang terlihat hari ini:** `export function isHq(role: string | null | undefined): boolean {`
- **Vonis:** TERBUKA
- **Catatan:** roles.ts:68-70 `isHq` = HEAD_OFFICE | SUPER_ADMIN | DIREKTUR. FINANCE dan MARKETING di luar.

### `CA-2-17` · §21 · Tinggi — FINANCE mendarat di konsol HR dan terkurung di sana

- **Berkas:** `apps/web/src/lib/roles.ts:266`
- **Yang terlihat hari ini:** `}`
- **Vonis:** TERBUKA
- **Catatan:** roles.ts:263-270 — `/dashboard` lebih dulu, lalu `/hr`; FINANCE mendarat di HR.

### `CA-2-18` · §21 · Tinggi — Konsol operator memakai daftar menu ketiga yang di-hardcode dan tidak difilter kapabilitas

- **Berkas:** `apps/web/src/components/operator/operator-shell.tsx:30–61`
- **Yang terlihat hari ini:** `const primaryTabs: Tab[] = [`
- **Vonis:** TERBUKA
- **Catatan:** operator-shell.tsx:30-40 `const primaryTabs: Tab[] = [...]` — daftar tetap, tanpa filter kapabilitas.

### `CA-2-19` · §21 · Tinggi — Halaman peringkat depot gagal total untuk HEAD_OFFICE dan DIREKTUR

- **Berkas:** `apps/web/src/app/hq/scorecard/page.tsx:33, :37`
- **Yang terlihat hari ini:** `const settings = useAsync<SettingsSchema>(() => fetchSettingsSchema('/payout/api/v1', null), []);`
- **Vonis:** TERBUKA
- **Catatan:** hq/scorecard/page.tsx:33 dan :37 — `settings.error` mengembalikan `ErrorState` untuk seluruh halaman.

### `CA-2-20` · §22 · Tinggi — Satu orang bisa mengajukan, menyetujui, dan sekaligus menaikkan ambang persetujuan depotnya sendiri

- **Berkas:** `services/depot-service/src/application/services/approval.service.ts:94`
- **Yang terlihat hari ini:** `async decide(`
- **Vonis:** TERBUKA
- **Catatan:** approval.service.ts:94-105 `decide(id, decision, note, decidedBy)` — tidak membandingkan `decidedBy` dengan pengaju.

### `CA-2-21` · §22 · Tinggi — Penulisan stok tidak atomik — dua penyesuaian bersamaan saling menimpa

- **Berkas:** `services/depot-service/src/infrastructure/prisma/inventory.prisma.repository.ts:202`
- **Yang terlihat hari ini:** `async applyMovement(`
- **Vonis:** TERBUKA
- **Catatan:** inventory.prisma.repository.ts:202-213 `applyMovement` menulis `data: { quantity: newQuantity }` — nilai mutlak, bukan `increment`/`decrement`.

### `CA-2-22` · §22 · Tinggi — Buku kas depot tidak punya jalur koreksi apa pun

- **Berkas:** `services/depot-service/src/modules/cashbook.controller.ts:63`
- **Yang terlihat hari ini:** `@Post()`
- **Vonis:** TERBUKA
- **Catatan:** cashbook.controller.ts hanya punya `@Get()` (:51) dan `@Post()` (:63).

### `CA-2-23` · §23 · Tinggi — fetchAllPages meminta 200 padahal server menolak di atas 100 — enam layar katalog mati

- **Berkas:** `apps/web/src/lib/fetch-all-pages.ts:22`
- **Yang terlihat hari ini:** `/*`
- **Vonis:** SUDAH DIPERBAIKI (PR #407)
- **Catatan:** fetch-all-pages.ts:22-31 kini menerangkan 100 = `@Max(100)` DTO server; regresi 200-nya ditulis sebagai riwayat.

### `CA-2-24` · §23 · Tinggi — Tidak ada satu pun pintu untuk mengajukan refund, padahal wewenangnya diiklankan di matriks RBAC

- **Berkas:** `services/payment-service/src/modules/payment.controller.ts:514`
- **Yang terlihat hari ini:** `@Post(':id/refund')`
- **Vonis:** TERBUKA
- **Catatan:** Route `@Post(':id/refund') @Can('refundIssue')` ADA di payment.controller.ts:514. Yang tidak ada adalah pintunya di konsol.

### `CA-2-25` · §24 · Tinggi — Ekspor “pendapatan per depot” hanya berisi 10 depot teratas

- **Berkas:** `apps/web/src/app/hq/reports/export/page.tsx:87`
- **Yang terlihat hari ini:** `return (dash.data?.topDepots?.items ?? []).map((r) => ({`
- **Vonis:** TERBUKA
- **Catatan:** hq/reports/export/page.tsx:87 `(dash.data?.topDepots?.items ?? []).map(...)`.

### `CA-2-26` · §24 · Tinggi — Enam layar jaringan berhenti di 100 depot, dua di antaranya mencetak angka dari potongan itu

- **Berkas:** `hq/franchise:23 · hq/depots:46 · hq/onboarding:35 · hq/inventory:27 · hq/roster:30`
- **Yang terlihat hari ini:** _berkas majemuk — tidak ada satu baris tunggal_
- **Vonis:** TERBUKA
- **Catatan:** Berkas majemuk (5 halaman). Semua masih `limit: 100`.

### `CA-2-27` · §24 · Tinggi — Antrean aplikasi waralaba mengubur pemohon baru begitu 100 aplikasi pernah masuk

- **Berkas:** `apps/web/src/app/hq/applications/page.tsx:33`
- **Yang terlihat hari ini:** `() => api.get(endpoints.franchiseApps.list({ limit: 100 }), true),`
- **Vonis:** TERBUKA
- **Catatan:** hq/applications/page.tsx:33 `endpoints.franchiseApps.list({ limit: 100 })`.

### `CA-2-28` · §24 · Tinggi — Log audit HQ hanya 100 baris terbaru, dan ekspornya ikut terpotong tanpa memberi tahu

- **Berkas:** `apps/web/src/app/hq/audit/page.tsx:30`
- **Yang terlihat hari ini:** `const log = useAsync<Page<AuditEntry>>(() => api.get(endpoints.audit.list({ limit: 100 }), true));`
- **Vonis:** TERBUKA
- **Catatan:** hq/audit/page.tsx:30 `endpoints.audit.list({ limit: 100 })`.

### `CA-2-29` · §24 · Tinggi — Papan lacak hanya memuat ON_DELIVERY; tombol tarik-kembali tak terjangkau

- **Berkas:** `apps/web/src/app/dashboard/tracking/page.tsx:181`
- **Yang terlihat hari ini:** `variant="secondary"`
- **Vonis:** TERBUKA
- **Catatan:** dashboard/tracking/page.tsx:198 `endpoints.deliveries.list({ status: 'ON_DELIVERY', limit: 50 })`. Tombol tarik-kembali di :169 sudah menerima ASSIGNED/PICKED_UP, tapi barisnya tak pernah dimuat.

### `CA-2-30` · §25 · Tinggi — Tier harga borongan selalu berlaku untuk SEMUA produk

- **Berkas:** `apps/web/src/app/dashboard/wholesale/page.tsx:76`
- **Yang terlihat hari ini:** `await api.post(`
- **Vonis:** TERBUKA
- **Catatan:** dashboard/wholesale/page.tsx:76-80 payload `{ depotId, label, minQty, maxQty, priceIdr }` — tanpa productId.

### `CA-2-31` · §25 · Tinggi — PO berisi barang katalog ditandai “Diterima” tanpa stok pernah bertambah

- **Berkas:** `services/depot-service/src/application/services/purchase-order.service.ts:112`
- **Yang terlihat hari ini:** `await this.inventory.receiveStock(`
- **Vonis:** TERBUKA
- **Catatan:** purchase-order.service.ts:110-123 — `receiveStock` di dalam try/catch per baris; barang katalog tanpa baris stok tetap RECEIVED.

### `CA-2-32` · §25 · Tinggi — Pembebanan selisih setoran ke kurir dikirim tanpa jaminan sampai

- **Berkas:** `services/delivery-service/src/application/services/settlement.service.ts:155`
- **Yang terlihat hari ini:** `if (charged) {`
- **Vonis:** TERBUKA
- **Catatan:** settlement.service.ts:155-162 `void this.payout.cashVarianceCharged({...})` — fire-and-forget.

### `CA-2-33` · §25 · Tinggi — Daftar pelanggan berisiko churn tidak dibatasi depot saat switcher di “Semua depot”

- **Berkas:** `services/forecast-service/src/modules/forecast.controller.ts:139`
- **Yang terlihat hari ini:** `async churn(@Query() query: ChurnQueryDto): Promise<{ customers: ChurnItem[] }> {`
- **Vonis:** TERBUKA
- **Catatan:** forecast.controller.ts:139 `churn(@Query() query)` — tanpa `@CurrentUser`, jadi tanpa `depotScopeIds`.

### `CA-2-34` · §25 · Tinggi — Menolak refund pada pesanan yang sudah dibatalkan menahan uang pelanggan tanpa jejak

- **Berkas:** `apps/web/src/app/hq/refunds/page.tsx:33`
- **Yang terlihat hari ini:** `async function decide(r: RefundQueueItem, approved: boolean) {`
- **Vonis:** TERBUKA
- **Catatan:** hq/refunds/page.tsx:33-44 `decide()` hanya memanggil approve/reject; tidak ada jejak untuk pesanan yang sudah dibatalkan.

### `CA-2-35` · §25 · Tinggi — “Harga tetap” di form aturan harga tidak menghasilkan harga tetap

- **Berkas:** `apps/web/src/app/hq/forms/pricing-rule/page.tsx:62`
- **Yang terlihat hari ini:** `// Map the 3-way UI onto the backend's PERCENT|FIXED. Fixed = absolute target price,`
- **Vonis:** TERBUKA
- **Catatan:** hq/forms/pricing-rule/page.tsx:65-66 `ruleValue = kind === 'fixed' ? String(Number(value) - (product?.basePrice ?? 0)) : value` — harga "tetap" disimpan sebagai selisih dari harga katalog.

### `CA-2-36` · §25 · Tinggi — Kotak masuk insiden depot tidak punya form lapor

- **Berkas:** `apps/web/src/app/dashboard/incidents/page.tsx:179`
- **Yang terlihat hari ini:** `const list = useAsync<DepotIncident[]>(`
- **Vonis:** TERBUKA
- **Catatan:** dashboard/incidents/page.tsx hanya membaca `endpoints.incidents.list`; tidak ada form buat.

### `CA-2-37` · §25 · Tinggi — Setiap webhook yang dibuat dari konsol dikirim tanpa tanda tangan, selamanya

- **Berkas:** `apps/web/src/app/hq/webhooks/page.tsx:153`
- **Yang terlihat hari ini:** `await api.post(endpoints.admin.webhooks.create, { url: url.trim(), events: eventList }, true);`
- **Vonis:** TERBUKA
- **Catatan:** hq/webhooks/page.tsx:153 `api.post(endpoints.admin.webhooks.create, { url, events })` — tanpa secret.

### `CA-2-38` · §25 · Tinggi — Baris tabel pesanan HQ hanya bisa dibuka dengan tetikus

- **Berkas:** `apps/web/src/app/hq/orders/page.tsx:118`
- **Yang terlihat hari ini:** `<tr`
- **Vonis:** TERBUKA
- **Catatan:** hq/orders/page.tsx:118-122 `<tr className="cursor-pointer" onClick={...}>` — tanpa `tabIndex`/`onKeyDown`/`role`.

### `CA-2-39` · §25 · Tinggi — Sengketa pesanan hanya mengubah status — REFUND tidak mengembalikan uang, RESEND tidak mengirim apa pun

- **Berkas:** `services/depot-service/src/application/services/dispute.service.ts:78`
- **Yang terlihat hari ini:** `async resolve(`
- **Vonis:** TERBUKA
- **Catatan:** dispute.service.ts:78-89 `resolve()` hanya `this.disputes.update(id, { status, … })`.

### `CA-2-40` · §25 · Tinggi — Ekspor dan antrean lain yang ikut terpotong

- **Berkas:** `dashboard/orders:288 · dashboard/returns:338 · hq/orders:55`
- **Yang terlihat hari ini:** _berkas majemuk — tidak ada satu baris tunggal_
- **Vonis:** TERBUKA
- **Catatan:** Berkas majemuk (3 halaman).

### `CA-2-41` · §25 · Tinggi — Roster kurir salah menghitung beban

- **Berkas:** `apps/web/src/app/hq/roster/page.tsx:29`
- **Yang terlihat hari ini:** `api.get<Page<Delivery>>(endpoints.deliveries.list({ limit: 100 }), true),`
- **Vonis:** TERBUKA
- **Catatan:** hq/roster/page.tsx:29 `endpoints.deliveries.list({ limit: 100 })` — beban dihitung dari potongan itu.

### `CA-3-01` · §31 · Kritis — Hapus akun tidak menyentuh order-service: nama, nomor HP, dan titik GPS pelanggan tetap utuh 10 tahun, padahal halaman hapus-akun menjanjikan sebaliknya

- **Berkas:** `apps/web/src/lib/dictionaries/id/deleteAccount.ts:30`
- **Yang terlihat hari ini:** `body: 'Riwayat pesanan, pembayaran, dan catatan keuangan wajib kami simpan minimal 10 tahun untuk memenuhi kewajiban perpajakan dan audit — data ini dikecualika`
- **Vonis:** TERBUKA — arah perbaikannya berubah
- **Catatan:** Kalimat yang salah ada di deleteAccount.ts:30: "Setelah akunmu dianonimkan, catatan tersebut tidak lagi menunjuk ke identitasmu." `order.orders.phone`/`recipientName`/`driverPhone` (813 baris, AUDIT_L3 §4.2) tetap utuh. **Keputusan pemilik 2026-09-01: retensi TETAP, teksnya yang diperbaiki + pengecualiannya ditulis.**

### `CA-3-02` · §31 · Kritis — Langganan tetap berjalan setelah akun dihapus: pesanan baru terus dibuat atas nama orang yang sudah minta dilupakan

- **Berkas:** `services/order-service/src/application/services/subscription.service.ts:243`
- **Yang terlihat hari ini:** `async processDue(now: Date): Promise<SubscriptionSweepResult> {`
- **Vonis:** TERBUKA
- **Catatan:** subscription.service.ts:243-254 `processDue(now)` langsung `this.subs.findDue(now)` lalu membangun `DeliveryAddressSnapshot` dari `sub.recipientName`/`sub.phone` — tanpa penjaga akun terhapus.

### `CA-3-03` · §32 · Tinggi — Foto profil dan foto pendaftaran agen (KTP) tidak pernah dihapus dari bucket saat akun dihapus — hanya kolomnya yang dikosongkan

- **Berkas:** `services/auth-service/src/application/ports/storage.port.ts:22`
- **Yang terlihat hari ini:** `put(input: StoragePutInput): Promise<StoragePutResult>;`
- **Vonis:** TERBUKA
- **Catatan:** storage.port.ts:21-23 `interface StoragePort { put(input): Promise<StoragePutResult>; }` — tidak ada `delete`.

### `CA-3-04` · §32 · Tinggi — Depot tutup memblokir SEMUA pesanan, termasuk slot terjadwal yang justru dirancang server untuk diterima

- **Berkas:** `apps/web/src/app/checkout/page.tsx:364`
- **Yang terlihat hari ini:** `* disagree about what was available" — they did.`
- **Vonis:** SUDAH DIPERBAIKI (PR #405)
- **Catatan:** checkout/page.tsx:371-372 `const depotClosed = depot != null && depotState === 'tutup'; const expressBlocked = express && depotClosed;`

### `CA-3-05` · §32 · Tinggi — Akun yang sudah didaftarkan tapi belum verifikasi tidak bisa masuk, dan disuruh menghubungi dukungan

- **Berkas:** `apps/web/src/app/login/page.tsx:104`
- **Yang terlihat hari ini:** `// least reads "Nomor ini belum terdaftar", but still leaves the visitor to find`
- **Vonis:** TERBUKA
- **Catatan:** login/page.tsx:102-115 hanya menangani `AUTH_CUSTOMER_NOT_FOUND`; akun terdaftar-belum-verifikasi jatuh ke `setError(...)`.

### `CA-3-06` · §32 · Tinggi — Nomor telepon pelanggan disalin ke tabel komplain admin-service dan tidak pernah ikut terhapus maupun ikut diekspor

- **Berkas:** `services/admin-service/src/modules/customer-support.controller.ts:61`
- **Yang terlihat hari ini:** `customerRef: user.phone,`
- **Vonis:** TERBUKA
- **Catatan:** customer-support.controller.ts:59-65 `customerRef: user.phone, customerPhone: user.phone` — dua kolom, keduanya di luar `anonymise()`.

### `CA-3-07` · §32 · Tinggi — Foto bukti transfer pelanggan disimpan permanen di bucket publik dan tidak pernah disebut di Kebijakan Privasi

- **Berkas:** `apps/web/src/lib/dictionaries/id/privacy.ts:40`
- **Yang terlihat hari ini:** `body: 'Data akun disimpan selama akunmu aktif. Bukti pengantaran (foto, tanda tangan, nama penerima, lokasi) disimpan maksimal 12 bulan sejak penyerahan, lalu d`
- **Vonis:** TERBUKA
- **Catatan:** privacy.ts:40 hanya menyebut bukti pengantaran. Foto bukti transfer tidak disebut di mana pun.

### `CA-4-01` · §41 · Kritis — Penarikan saldo kurir memotong saldo tapi tidak punya jalur pembayaran — status PROCESSING selamanya

- **Berkas:** `services/payout-service/src/application/services/courier-payout.service.ts:233`
- **Yang terlihat hari ini:** `* then post a WITHDRAWAL debit so the balance drops immediately.`
- **Vonis:** TERBUKA
- **Catatan:** `'PAID'` hanya muncul di `domain/ledger.ts:4` (tipe) dan enum Prisma. Nol penulis di seluruh `services/payout-service/src`. Sisi pemilik waralaba (`payout.service.ts:280`) berbagi cacat yang sama.

### `CA-4-02` · §41 · Kritis — Klaim biaya auto-approve dan mengkredit ledger kurir berdasarkan depotId dan receiptUrl yang dikirim klien sendiri

- **Berkas:** `services/payout-service/src/application/services/expense-claim.service.ts:43`
- **Yang terlihat hari ini:** `const auto = isAutoApproved(`
- **Vonis:** TERBUKA
- **Catatan:** expense-claim.service.ts:41-47 `const depotId = input.depotId ?? null;` lalu `isAutoApproved(input.amount, this.config.expenseAutoApproveMaxIdr(depotId), receiptUrl !== null)` — depotId mentah dari klien. Baris 125 dan 141 di berkas yang sama MEMANGGIL `assertDepotAccess`.

### `CA-4-03` · §41 · Kritis — Uang COD yang sudah dipungut hilang dari setoran begitu pengantaran ditandai Gagal atau Jadwal Ulang

- **Berkas:** `apps/web/src/app/driver/deliveries/detail/page.tsx:280`
- **Yang terlihat hari ini:** `{(delivery.status === 'ASSIGNED' ||`
- **Vonis:** TERBUKA
- **Catatan:** driver/deliveries/detail/page.tsx:280-291 — tombol Gagal/Jadwal Ulang tersedia dari ASSIGNED/PICKED_UP/ON_DELIVERY tanpa jalur setoran untuk uang yang sudah dipungut.

### `CA-4-04` · §41 · Kritis — Riwayat pembayaran pesanan depot manapun bisa dibaca kurir dengan satu UUID

- **Berkas:** `services/payment-service/src/modules/payment.controller.ts:325`
- **Yang terlihat hari ini:** `listForOrder(@Param('orderId', ParseUUIDPipe) orderId: string): Promise<Page<PaymentRecord>> {`
- **Vonis:** TERBUKA
- **Catatan:** payment.controller.ts:325 `listForOrder(@Param('orderId', ParseUUIDPipe) orderId)` — tanpa `@CurrentUser`, jadi tanpa cek depot. `@Can('paymentRead')`.

### `CA-4-05` · §41 · Kritis — Kurir bisa tutup shift lalu menyelesaikan antaran — uang COD-nya lolos dari setoran

- **Berkas:** `services/delivery-service/src/application/services/shift.service.ts:99`
- **Yang terlihat hari ini:** `async checkOut(driverId: string, id: string, lat: number, lng: number): Promise<ShiftView> {`
- **Vonis:** TERBUKA
- **Catatan:** shift.service.ts:99-110 `checkOut()` hanya `ownedOpenShift` + `assertTransition` — tidak memeriksa antaran berjalan.

### `CA-4-06` · §42 · Tinggi — KPI beranda manajer mobile adalah angka seluruh jaringan, dipajang di bawah nama depotnya

- **Berkas:** `apps/web/src/app/m/manager/page.tsx:77`
- **Yang terlihat hari ini:** `const dash = useAsync<ExecutiveDashboard>(() => api.get(endpoints.dashboard.executive(), true), []);`
- **Vonis:** TERBUKA
- **Catatan:** m/manager/page.tsx:77 `endpoints.dashboard.executive()` — angka jaringan, tanpa depot.

### `CA-4-07` · §42 · Tinggi — Konsol manajer mobile terkunci ke depot pertama jaringan — antrean approval depot sendiri tak pernah muncul

- **Berkas:** `apps/web/src/app/m/manager/approvals/page.tsx:70`
- **Yang terlihat hari ini:** `? api.get(endpoints.approvals.list({ depotId: scopedId, status: 'PENDING' }), true)`
- **Vonis:** TERBUKA
- **Catatan:** m/manager/approvals/page.tsx:70 memakai `scopedId` dari depot-context, yang jatuh ke `depots[0]`.

### `CA-4-08` · §42 · Tinggi — Tab Tim selalu kosong atau 403: roster kurir diminta tanpa depotId lalu disaring dengan depot yang salah

- **Berkas:** `apps/web/src/app/m/manager/team/page.tsx:31`
- **Yang terlihat hari ini:** `const roster = useAsync<Customer[]>(() => api.get(endpoints.auth.drivers, true), []);`
- **Vonis:** TERBUKA
- **Catatan:** m/manager/team/page.tsx:31 `endpoints.auth.drivers` tanpa depotId, lalu disaring klien di :34.

### `CA-4-09` · §42 · Tinggi — Konsol manajer di HP memilih depot dari daftar publik seluruh jaringan dan tak punya pengalih depot

- **Berkas:** `apps/web/src/lib/depot-context.tsx:91`
- **Yang terlihat hari ini:** `const scopedId = selectedId ?? depots[0]?.id ?? null;`
- **Vonis:** TERBUKA
- **Catatan:** depot-context.tsx:91 `const scopedId = selectedId ?? depots[0]?.id ?? null;`

### `CA-4-12` · §43 · Tinggi — Beranda tugas menutup antaran tanpa gerbang COD — uang tunai tak pernah tercatat dan tak ada jalan kembali

- **Berkas:** `apps/web/src/app/driver/page.tsx:187`
- **Yang terlihat hari ini:** `{d.status === 'ON_DELIVERY' &&`
- **Vonis:** TERBUKA
- **Catatan:** driver/page.tsx:187-201 — PoD dari beranda tanpa gerbang COD.

### `CA-4-13` · §43 · Tinggi — Tombol PoD di layar Beranda kurir menutup pengantaran COD tanpa memungut uang — pagar C1(c) hanya ada di layar detail

- **Berkas:** `apps/web/src/app/driver/page.tsx:198`
- **Yang terlihat hari ini:** `<Button onClick={() => setCapturing(d.id)} className="w-full">`
- **Vonis:** TERBUKA
- **Catatan:** driver/page.tsx:198 `<Button onClick={() => setCapturing(d.id)}>` — pagar C1(c) tidak ada di jalur ini.

### `CA-4-14` · §43 · Tinggi — Ikon tong sampah di banner antrean luring menghapus setoran tunai dengan satu sentuhan, tanpa konfirmasi

- **Berkas:** `apps/web/src/components/offline-queue-banner.tsx:74`
- **Yang terlihat hari ini:** `<button`
- **Vonis:** TERBUKA
- **Catatan:** offline-queue-banner.tsx:74-81 `onClick={() => void discard(job.id)}` — satu sentuhan, tanpa konfirmasi.

### `CA-4-15` · §43 · Tinggi — Tutup shift tidak diperiksa terhadap pengantaran yang masih berjalan, dan kurir langsung terkunci dari tugasnya

- **Berkas:** `apps/web/src/app/driver/shift/status/page.tsx:72`
- **Yang terlihat hari ini:** `const checkOut = () =>`
- **Vonis:** TERBUKA
- **Catatan:** driver/shift/status/page.tsx:72-81 `checkOut` langsung POST; servernya (shift.service.ts:99) juga tidak memeriksa.

### `CA-4-18` · §44 · Tinggi — Progres tangga bonus di /driver/goal memakai hitungan antar MINGGUAN dibanding ambang tangga yang BULANAN

- **Berkas:** `apps/web/src/app/driver/goal/page.tsx:108`
- **Yang terlihat hari ini:** `const achieved = delivered >= tier.deliveries;`
- **Vonis:** TERBUKA
- **Catatan:** driver/goal/page.tsx:44 `const delivered = perf.data.delivered` (mingguan) dibanding :108 `delivered >= tier.deliveries` (ambang bulanan).

### `CA-4-19` · §44 · Tinggi — Tidak ada apa pun yang bisa menutup shift yang lupa di-check-out, dan check-in berikutnya diam-diam menyambung shift lama

- **Berkas:** `services/delivery-service/src/application/services/shift.service.ts:72`
- **Yang terlihat hari ini:** `if (open.depotId === depotId) return this.view(open);`
- **Vonis:** TERBUKA
- **Catatan:** shift.service.ts:72 `if (open.depotId === depotId) return this.view(open);` — shift lama disambung diam-diam, dan tidak ada penutup otomatis.

### `CA-4-20` · §44 · Tinggi — Tangga bonus di layar Target membandingkan hitungan MINGGUAN dengan syarat BULANAN yang dipakai server untuk membayar

- **Berkas:** `apps/web/src/app/driver/goal/page.tsx:44`
- **Yang terlihat hari ini:** `const delivered = perf.data.delivered;`
- **Vonis:** DUPLIKAT DARI CA-4-18
- **Catatan:** Kartu kedua atas goal/page.tsx yang sama.

### `CA-4-46` · §47 · Tinggi — Laporan insiden kurir dikirim tanpa lokasi dan tanpa depot — kecelakaan tidak bisa didatangi siapa pun

- **Berkas:** `apps/web/src/app/driver/incidents/new/page.tsx:67`
- **Yang terlihat hari ini:** `{ category, severity, description: description.trim(), photoUrl },`
- **Vonis:** TERBUKA
- **Catatan:** driver/incidents/new/page.tsx:65-69 body `{ category, severity, description, photoUrl }` — tanpa lat/lng, tanpa depotId.

### `CA-4-47` · §47 · Tinggi — Delivery tanpa customerId membuat retur galon kurir dibayar dari saldo deposit kolektif depot

- **Berkas:** `services/delivery-service/src/application/services/delivery.service.ts:199`
- **Yang terlihat hari ini:** `customerId: input.customerId ?? null,`
- **Vonis:** TERBUKA
- **Catatan:** delivery.service.ts:199 `customerId: input.customerId ?? null` — delivery tanpa customerId lolos ke retur galon.

