# Register audit keamanan pra-rilis (2026-09)

Tahap 1 (audit, tanpa perubahan kode) selesai 2026-09-11. Laporan lengkap — setiap temuan dengan
lokasi, potongan kode, cara eksploitasi, dan patch — ada di artifact privat:
<https://claude.ai/code/artifact/36804163-438e-4ec7-9c5e-c82900a662dd>.

Register ini adalah daftar kerja Tahap 2: satu baris per temuan, PR yang menutupnya, dan
statusnya. Baris hanya ditandai selesai setelah perbaikannya ada di branch dengan tes yang
merah sebelum perbaikan dan hijau sesudahnya.

**102 temuan** — High 35, Medium 28, Low 39 —
ditambah satu rantai Critical (XCUT-4: CORE-1 → PYO-2 → PYO-4) yang diputus lewat CORE-1.
Selesai: **2**.

## Keputusan pemilik, 2026-09-11

- **Pemberian peran (CORE-1).** FINANCE, HR, MARKETING hanya bisa diberikan SUPER_ADMIN. MANAGER
  bisa diberikan SUPER_ADMIN atau HR — promosi di jalur supervisi tetap pekerjaan HR. HEAD_OFFICE
  memegang `hrAdmin` juga, jadi hr-service kini menyebut aktor manusianya ke auth-service.
- **Promo saat cek preferensi gagal (CRM-2).** Marketing gagal-tertutup; notifikasi transaksional
  tetap gagal-terbuka seperti keputusan Fase F.
- **Voucher dan banner MANAGER (PRM-1, PRM-5).** Dibiarkan berlaku di seluruh jaringan.
- **Katalog (PRD-1).** MANAGER tetap boleh mengedit; perubahan harga dasar diberi jejak audit.
- **Poin loyalti (LOY-1, LOY-2).** MANAGER tetap boleh, dibatasi ke pelanggan depotnya, dengan
  plafon dan aktor tercatat.

## Urutan PR

| PR | Isi | Temuan | Selesai |
|---|---|---|---|
| PR-1 | Batas pemberian peran | CORE-1, CORE-2 | 2/2 |
| PR-2 | Voucher yang tidak pernah bisa ditukar | PRM-3 | 0/1 |
| PR-3 | Scope depot (XCUT-3) | ORD-1, ORD-2, DLV-1, DLV-2, DLV-3, DPT-1, LOY-3, LOY-4, LOY-9, FCT-1, FCT-2, PAY-2, PAY-3, DSH-1, DSH-2, PRM-2, REF-1, WEBC-1, WEBC-2 | 0/19 |
| PR-4 | Privasi storage (XCUT-1/2) | AUTH-1, AUTH-2, CUS-1, PAY-1, PAY-5, HR-1, HR-4, DLV-5 | 0/8 |
| PR-5 | Gateway dan sesi | GW-1, GW-2, GW-3, GW-4, AUTH-7 | 0/5 |
| PR-6 | Payout | PYO-1, PYO-2, PYO-3, PYO-4, PYO-5, PYO-6, PYO-7, WEBB-1 | 0/8 |
| PR-7 | CRM dan notifikasi | CRM-1, CRM-2, CRM-3, CRM-4, CRM-5, CRM-6, CRM-7, CRM-8, CRM-9 | 0/9 |
| PR-8 | PDP karyawan | HR-2, HR-3 | 0/2 |
| PR-9 | Loyalti | LOY-1, LOY-2, LOY-5, LOY-6, LOY-7, LOY-8, LOY-10 | 0/7 |
| PR-10 | Promo | PRM-4, PRM-6, PRM-7, PRM-8, PRM-9 | 0/5 |
| PR-11 | Auth | AUTH-3, AUTH-4, AUTH-5, AUTH-6, AUTH-8, CORE-3 | 0/6 |
| PR-12 | Admin | ADM-1, ADM-2, ADM-3, ADM-4, ADM-5, ADM-6, ADM-7, ADM-8, ADM-9 | 0/9 |
| PR-13 | Platform bersama | PLAT-1, PLAT-2, PLAT-3, PLAT-5, PLAT-6, PLAT-7, PLAT-8, CORE-4, CORE-5, CORE-6 | 0/10 |
| PR-14 | Katalog dan sisa per service | PRD-1, PAY-4, DLV-4, DPT-2, CUS-2 | 0/5 |
| PR-15 | Web dan dependency | WEBA-1, WEBB-2, DEP-1, DEP-2 | 0/4 |
| — | Diterima pemilik, tanpa perubahan kode | PRM-1, PRM-5 | 0/2 |

## Semua temuan

| ID | Severity | Unit | Temuan | PR | Status |
|---|---|---|---|---|---|
| AUTH-1 | High (semula Critical) | auth | `/uploads` static assets served with zero authentication, zero authorization | PR-4 | Terbuka |
| AUTH-2 | High | auth | PDP account erasure clears the avatar URL column but never deletes the underlying photo | PR-4 | Terbuka |
| CORE-1 | High (semula Critical) | platform core + access | HEAD_OFFICE self-escalates to FINANCE/MANAGER/HR/MARKETING money capabilities via staff invite — Keputusan 2026-09-11: FINANCE/HR/MARKETING hanya SUPER_ADMIN; MANAGER oleh SUPER_ADMIN atau HR. | PR-1 | Selesai |
| CRM-1 | High | crm | Depot floor staff can write arbitrary text into ANY customer's inbox + push (BROADCAST passthrough), no depot scope, no marketing check | PR-7 | Terbuka |
| CRM-2 | High | crm | Marketing opt-out check FAILS OPEN: a customer-service outage, 5xx, timeout, or missing env sends promo to opted-out customers — Keputusan 2026-09-11: marketing gagal-tertutup, transaksional tetap gagal-terbuka. | PR-7 | Terbuka |
| CRM-3 | High | crm | Ops feed shows every employee's kasbon amount, leave-rejection reason and phone to every depot's staff network-wide | PR-7 | Terbuka |
| CUS-1 | High | customer | PDP erasure never deletes the reseller's KTP/shopfront photo from public object storage — only the DB pointer is nulled | PR-4 | Terbuka |
| DEP-1 | High | dependency | Rasional "onnx bukan driver produksi" dibantah default prod repo sendiri | PR-15 | Terbuka |
| DLV-1 | High | delivery | `GET /reports/sla-by-depot` has no depot-scoping mechanism at all; MANAGER sees every depot's SLA breakdown | PR-3 | Terbuka |
| DLV-2 | High | delivery | `GET /reports/sla` defaults to network-wide totals when `depotIds` is omitted; MANAGER can drop the filter | PR-3 | Terbuka |
| DLV-3 | High | delivery | `GET /shifts` returns every depot's courier shift rows (incl. GPS check-in/out coordinates) when `depotId` is omitted | PR-3 | Terbuka |
| DPT-1 | High (semula Critical) | depot | `GET /depots/manage` returns every depot's bank account + QRIS to any KEPALA_DEPOT/MANAGER/FRANCHISE_OWNER, unscoped | PR-3 | Terbuka |
| DSH-1 | High (semula Critical) | dashboard | Network-scoped routes allow depot staff to read all-network data | PR-3 | Terbuka |
| FCT-2 | High | forecast | forecast pendapatan & permintaan SELURUH JARINGAN untuk peran per-depot yang tidak mengirim `depotId` | PR-3 | Terbuka |
| GW-1 | High | gateway | OTP/SMS billing rate-limit tier is bypassed by a trailing slash or path-case change | PR-5 | Terbuka |
| HR-1 | High | hr | Biometric source photos and attendance face frames are never deleted from object storage on erasure | PR-4 | Terbuka |
| HR-2 | High | hr | HR audit trail retains full unredacted employee PII forever, including through anonymisation | PR-8 | Terbuka |
| HR-3 | High | hr | Biometric (face) enrolment has no consent capture, recording or enforcement anywhere | PR-8 | Terbuka |
| LOY-1 | High | loyalty | MANAGER can credit/debit points of ANY customer in the network (cross-depot write on money) — Keputusan 2026-09-11: MANAGER tetap boleh, dibatasi ke pelanggan depotnya. | PR-9 | Terbuka |
| LOY-2 | High | loyalty | Manual points adjustment is unbounded and records no actor (untraceable minting) — Keputusan 2026-09-11: plafon + aktor tercatat. | PR-9 | Terbuka |
| LOY-3 | High | loyalty | Depot staff without `?depotId=` get the whole network's redemption queue | PR-3 | Terbuka |
| LOY-4 | High | loyalty | `GET loyalty/customers/:customerId` reads any customer's standing, no home-depot check | PR-3 | Terbuka |
| ORD-1 | High | order | Cross-depot financial/rating reports leak every depot's data to a depot-scoped MANAGER | PR-3 | Terbuka |
| PAY-1 | High (semula Critical) | payment | Payment-proof bank-transfer slips are served from a fully public, unauthenticated bucket URL | PR-4 | Terbuka |
| PAY-2 | High | payment | `POST /payments/for-orders` returns any depot's payment records to a depot-scoped caller | PR-3 | Terbuka |
| PAY-3 | High | payment | `GET /payments/cash-collected` returns any depot's PAID-cash totals to a depot-scoped caller | PR-3 | Terbuka |
| PAY-4 | High | payment | `initiate()` creates a payment against any order with no ownership/depot check; the mismatch error then discloses the real total | PR-14 | Terbuka |
| PRD-1 | High | product | MANAGER (peran per-depot) bisa mengubah dan menonaktifkan katalog seluruh jaringan — MANAGER tetap boleh mengedit katalog (keputusan 2026-09-11); yang dikerjakan: jejak audit perubahan harga dasar. | PR-14 | Terbuka |
| PRM-1 | High | promo | Depot-scoped MANAGER holds `voucherWrite`/`voucherRead`: mints, edits, deactivates and grants NETWORK-wide vouchers, bypassing the HQ approval gate — Diterima 2026-09-11: voucher MANAGER tetap berlaku di semua depot (lanjutan CA-2-42). | — | Diterima |
| PRM-2 | High | promo | Promotion analytics: KEPALA_DEPOT/MANAGER read network-wide customer IDs, order IDs and order value of every depot (confused deputy on the internal key) | PR-3 | Terbuka |
| PYO-1 | High | payout | Expense auto-approve accepts any typed URL under the public bucket prefix, reusable without limit: a courier account mints ledger credit with no human in the loop | PR-6 | Terbuka |
| PYO-2 | High | payout | One FINANCE account releases any owner's full balance to a destination it types, and settles it, with no second approver, no ceiling, and no persisted actor | PR-6 | Terbuka |
| REF-1 | High | referral | Cross-depot customer referral read (authorization bypass) | PR-3 | Terbuka |
| WEBC-1 | High | apps/web | layar antrean penukaran menembak request TANPA depotId di setiap pemuatan | PR-3 | Terbuka |
| WEBC-2 | High | apps/web | pencarian dan pengaturan depot mengunduh rekaman lengkap SEMUA depot | PR-3 | Terbuka |
| ADM-1 | Medium | admin | Webhook dispatcher does no address check at send time and follows redirects: an endpoint's owner can point admin-service at the docker network or cloud metadata | PR-12 | Terbuka |
| ADM-2 | Medium | admin | One SUPER_ADMIN session can wipe the shared audit trail, and the FINANCIAL legal floor can be lifted by reclassifying the dataset | PR-12 | Terbuka |
| ADM-3 | Medium | admin | UU PDP erasure of support tickets leaves the complaint subject, order ref, customer id and staff replies | PR-12 | Terbuka |
| ADM-4 | Medium | admin | Webhook delivery payloads (recipient names) are kept forever, are not in any retention or erasure path, and every partner receives every depot's deliveries | PR-12 | Terbuka |
| AUTH-3 | Medium | auth | User enumeration on `/auth/login` and `/auth/otp/resend` | PR-11 | Terbuka |
| AUTH-4 | Medium | auth | Audit-log and session `ipAddress` trust client-supplied `X-Forwarded-For` unconditionally | PR-11 | Terbuka |
| CORE-2 | Medium | platform core + access | `canGrantRole`'s documented "fail closed" contract is false for every target role except SUPER_ADMIN/DIREKTUR | PR-1 | Selesai |
| CORE-3 | Medium | platform core + access | Audit/session trail records a client-spoofable IP (`X-Forwarded-For` first hop trusted over `request.ip`) | PR-11 | Terbuka |
| CRM-4 | Medium | crm | `GET /campaigns/:id` returns the full, unpaginated recipient list (name + phone) — a bulk copy of the customer base to roles that may not read the customer directory | PR-7 | Terbuka |
| DLV-4 | Medium | delivery | Proof-of-delivery GPS is accepted from the client with no server-side proximity check against the delivery destination | PR-14 | Terbuka |
| DLV-5 | Medium | delivery | Default storage driver (`STORAGE_DRIVER` unset ⇒ `'local'`) serves PoD/incident photos publicly and unauthenticated, undoing the private-bucket protection | PR-4 | Terbuka |
| DPT-2 | Medium | depot | Depot-held customer PII (dispute/incident `customerName`/`customerPhone`, courier names) has no visible erasure path inside depot-service | PR-14 | Terbuka |
| DSH-2 | Medium (semula High) | dashboard | Downstream services called with internal key instead of caller's token | PR-3 | Terbuka |
| FCT-1 | Medium | forecast | Settings schema endpoint authorization gap | PR-3 | Terbuka |
| GW-2 | Medium | gateway | Logout skips server-side revocation whenever the refresh token is absent from the call, but still reports success | PR-5 | Terbuka |
| GW-3 | Medium | gateway | Production is allowed to boot with zero transport security (no TLS, no HSTS, no CSP, unauthenticated `/metrics`) with no code-level guardrail | PR-5 | Terbuka |
| HR-4 | Medium | hr | Attendance face photos have no retention ceiling while an employee is active | PR-4 | Terbuka |
| LOY-5 | Medium | loyalty | A depot-scoped MANAGER's per-depot earn rate mints a network-wide currency and global tier | PR-9 | Terbuka |
| LOY-6 | Medium | loyalty | Reversing a sale never takes back lifetime points/tier, and refuses outright if the points were already spent | PR-9 | Terbuka |
| ORD-2 | Medium | order | Network-wide revenue/retention reports have no depot dimension at all, reachable by a depot-scoped MANAGER | PR-3 | Terbuka |
| PAY-5 | Medium | payment | bukti transfer tidak punya jalur hapus sama sekali, di bucket yang publik | PR-4 | Terbuka |
| PLAT-5 | Medium | platform · nest | `INTERNAL_SERVICE_KEY` is one unscoped, unrotatable, SUPER_ADMIN-everywhere secret | PR-13 | Terbuka |
| PRM-3 | Medium | promo | Redemption lock compares TEXT `vouchers.id` with a `::uuid` parameter: redeem, release and promotion analytics very likely fail with `operator does not exist: text = uuid` | PR-2 | Terbuka |
| PRM-4 | Medium | promo | Vouchers have no audience: a "granted" voucher is spendable by every customer, and every customer's wallet lists every active code | PR-10 | Terbuka |
| PRM-5 | Medium | promo | Depot-scoped MANAGER writes NETWORK-wide Home banners (create/edit/delete any promotion, incl. HQ's); server stores arbitrary `ctaHref`/`imageUrl` — Diterima 2026-09-11: banner MANAGER tetap tingkat jaringan. | — | Diterima |
| PYO-3 | Medium | payout | No payout destination on file: every payout's bank account is a free-text string chosen per request, never verified, and HQ release silently reuses whatever the latest one said | PR-6 | Terbuka |
| PYO-4 | Medium | payout | PAID/FAILED and APPROVE/REJECT transitions update by id without a status predicate: a race pays out and re-credits, or credits a claim that ends up REJECTED | PR-6 | Terbuka |
| PYO-5 | Medium | payout | Expense approval: one depot MANAGER approves any amount, with no upper bound and no escalation | PR-6 | Terbuka |
| ADM-5 | Low | admin | Partner API keys never expire, the STAGING/`test` key is accepted as a production credential, and "rotate" revives a revoked key | PR-12 | Terbuka |
| ADM-6 | Low | admin | The security policy's 2FA flag and IP allowlist are stored and editable but enforced nowhere | PR-12 | Terbuka |
| ADM-7 | Low | admin | A purge whose owner answers 200 with an unexpected body is recorded as "PURGED, 0 deleted" | PR-12 | Terbuka |
| ADM-8 | Low | admin | Clearing a fraud flag can reinstate an account another BLOCKED flag is holding, and a BLOCKED→REVIEWED→CLEARED flag never reinstates it | PR-12 | Terbuka |
| ADM-9 | Low | admin | Scheduled-report CSV does not neutralise spreadsheet formulas | PR-12 | Terbuka |
| AUTH-5 | Low | auth | Access-token claims carry the raw phone number; no `iss`/`aud`, no explicit algorithm pin | PR-11 | Terbuka |
| AUTH-6 | Low | auth | OTP-gateway failure logs the raw, unredacted response body | PR-11 | Terbuka |
| AUTH-7 | Low | auth | CORS `methods` allow-list omits `PUT`, which this service actually exposes | PR-5 | Terbuka |
| AUTH-8 | Low | auth | Reviewer/demo OTP bypass: a fixed, non-expiring code for named phone numbers | PR-11 | Terbuka |
| CORE-4 | Low | platform core + access | `INTERNAL_SERVICE_KEY` may ship blank in production for most services; hr-service skips the shared guard entirely | PR-13 | Terbuka |
| CORE-5 | Low | platform core + access | `sniffFileType` validates only a signature prefix, not the whole file | PR-13 | Terbuka |
| CORE-6 | Low | platform core + access | Keyset cursor is a bare, unsigned row id despite being documented "Opaque" | PR-13 | Terbuka |
| CRM-5 | Low | crm | Push subscription upsert hands an existing endpoint to whichever account registers it last | PR-7 | Terbuka |
| CRM-6 | Low | crm | Push `endpoint` is any string: blind HTTPS POST to an attacker-chosen host (SSRF) | PR-7 | Terbuka |
| CRM-7 | Low | crm | Campaign recipient lists (name + phone) are never covered by the retention purge | PR-7 | Terbuka |
| CRM-8 | Low | crm | PDP erasure misses saved-segment customer ids and unnormalised phone numbers | PR-7 | Terbuka |
| CRM-9 | Low | crm | Recipient claim is not caller-exclusive (double delivery on overlapping sweeps) and a crash strands rows in SENDING forever | PR-7 | Terbuka |
| CUS-2 | Low | customer | Address/payment-method repository `update()` silently ignores its `customerId` parameter — ownership enforced only by caller discipline, not the query itself | PR-14 | Terbuka |
| DEP-2 | Low | dependency | Rasional multer menyebut cap yang letaknya bukan di sana | PR-15 | Terbuka |
| GW-4 | Low | gateway | Hand-rolled `readCookie` is first-match-wins with no Domain scoping, so a same-name cookie at a more specific Path shadows the real session cookie | PR-5 | Terbuka |
| LOY-7 | Low | loyalty | `internal/reverse-earn` is not idempotent and debits the caller-named customer | PR-9 | Terbuka |
| LOY-8 | Low | loyalty | Expiry sweep can expire a lot twice and expires points that were already spent | PR-9 | Terbuka |
| LOY-9 | Low | loyalty | `members/count` gives depot-scoped MANAGER the network-wide member count | PR-3 | Terbuka |
| LOY-10 | Low | loyalty | Loyalty ledger is outside the UU PDP access/erasure fan-out; free-text `reason` may carry PII | PR-9 | Terbuka |
| PLAT-1 | Low | platform · nest | `RolesGuard`/`DepotScopeGuard` fail OPEN when their metadata is absent (mitigated by CI gates) | PR-13 | Terbuka |
| PLAT-2 | Low | platform · nest | JWT `algorithms` not pinned explicitly on `verifyAsync` (currently safe via library default) | PR-13 | Terbuka |
| PLAT-3 | Low | platform · nest | JWT `iss`/`aud` claims are never checked | PR-13 | Terbuka |
| PLAT-6 | Low | platform · nest | Capability-override staleness during an outage is unbounded, not "one TTL" | PR-13 | Terbuka |
| PLAT-7 | Low | platform · nest | Alert-text redaction stops a secret's value at the first whitespace | PR-13 | Terbuka |
| PLAT-8 | Low | platform · nest | `findMany` row bound does not reach nested `include` relations | PR-13 | Terbuka |
| PRM-6 | Low | promo | `PATCH /vouchers/:id` skips create's money invariants and silently drops `budgetCap` | PR-10 | Terbuka |
| PRM-7 | Low | promo | Public `GET /vouchers/:code` is an unauthenticated existence oracle that also returns draft/inactive vouchers and internal fields; codes have no entropy floor | PR-10 | Terbuka |
| PRM-8 | Low | promo | Release hard-deletes the redemption row (reconciliation history lost); "floored at zero" comment is false; a concurrent second release returns 500 instead of `released:false` | PR-10 | Terbuka |
| PRM-9 | Low | promo | Voucher grant downloads the whole customer directory (name + phone) to find one customer | PR-10 | Terbuka |
| PYO-6 | Low | payout | Commission schemes and courier earning rules (what every future payout is computed from) record no author and emit no audit event | PR-6 | Terbuka |
| PYO-7 | Low | payout | Payout data is outside the UU PDP access/erasure path, and the "masked" bank reference is not masked by the server | PR-6 | Terbuka |
| WEBA-1 | Low | apps/web | jalur init Sentry kedua tanpa scrubbing | PR-15 | Terbuka |
| WEBB-1 | Low | apps/web | URL struk klaim biaya diterima sebagai string apa pun, dirender sebagai tautan | PR-6 | Terbuka |
| WEBB-2 | Low | apps/web | ekspor CSV tanpa netralisasi formula | PR-15 | Terbuka |
