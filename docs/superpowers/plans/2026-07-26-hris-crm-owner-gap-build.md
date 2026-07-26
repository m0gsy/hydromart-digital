# Build Plan — HRIS + CRM + Owner Dashboard gap

Date: 2026-07-26. Source: user spec (Modul 1 HRIS, Modul 2 CRM, Dashboard Owner).
Decisions locked: WA = **manual** (queue + `wa.me` link, no auto-send); Bonus = **full rule engine**
(incl. sales target → needs per-employee/per-depot sales aggregate); order **Fase 1→5**.

## Gap list (what's missing today)

HRIS — Employee: `supervisorId` (Atasan), `npwp`, `bpjsKes`, `bpjsTk`, `shiftId` FK.
HRIS — Attendance: QR Code, GPS (geofence), Fingerprint (deferred/optional).
HRIS — Payroll: bonus rule-engine (auto), pinjaman multi-cicilan (kasbon = sekali potong today).
CRM: order aggregate wiring, segmentasi Baru/Aktif/Inactive, follow-up queue (60-hari rule),
     WA manual link, CRM dashboard per depot. (`crm-service` today = campaign/broadcast/notif only.)
Owner Dashboard: gabung payroll-MTD + terlambat-hari-ini + tidak-hadir dari hr-service ke `/dashboard/franchise`.

## Phases

### Fase 1 — Employee fields  (hr-service + web) — SMALL
- schema: Employee += supervisorId?, npwp?, bpjsKes?, bpjsTk?, shiftId? (plain nullable, service-DB convention).
- migration, DTO (create+update), employee.service input/create/update-loop.
- web: hr.ts types+form+payload; employee-form.tsx inputs. Atasan = dropdown employees sedepot.
- shiftId column added now; shift picker UI deferred to Fase 3 (pairs with per-employee shift start-time).

### Fase 2 — Bonus rule engine + pinjaman  (hr-service)
- model BonusRule (type, condition JSON, amount|pct, scope global/depot, active).
- payroll.service: evaluate rules at generate → emit BONUS items. Attendance/depot rules local;
  SALES rule depends on per-employee/depot sales aggregate (sub-dep: order-service port).
- model Loan (principal, installmentAmount, remaining) → auto-emit DEDUCTION CASH_ADVANCE monthly until 0.

### Fase 3 — Attendance GPS geofence  (hr-service + web)
Decision (2026-07-26): FR + GPS + timestamp SEKALIGUS tiap punch. NO QR, NO fingerprint.
Face-match + timestamp already exist; only GPS is net-new.
- Attendance += checkInLat?, checkInLng?, checkOutLat?, checkOutLng?.
- check-in/out DTO += lat/lng (required). Reject punch if outside depot geofence.
- Geofence: depot location (lat/lng) + radius. depotLat/Lng/radius from depot-service (cross-service port)
  OR configurable per-depot setting (geofenceRadiusM) if depot coords already reachable. Haversine in-domain.
- Wire employee shiftId → per-employee workStartTime (overrides global config).

### Fase 4 — CRM lifecycle  (customer-service + web) — LARGEST
- order-service internal aggregate endpoint (count, lastOrderAt, totalSpent per customer);
  wire into depot-crm.service (TODO already marked in code).
- segmentasi: Aktif ≤N hari, Inactive >N, Baru firstOrder ≤30hr (N configurable).
- FollowUp queue: daily cron scan inactive >60hr → task rows.
- WA manual: FE renders `wa.me/<phone>?text=<template>` per follow-up (no auto-send adapter).
- `/dashboard/crm`: Baru/Aktif/Inactive/Repeat-rate per depot.

### Fase 5 — Owner dashboard merge  (hr-service read + web)
- hr-service daily summary endpoint (lateCount, absentCount, payrollMtd).
- pull into `/dashboard/franchise` alongside existing depot/order/revenue. Read-only.

## Status
- [x] Fase 1 — DONE. schema+migration 0002, DTO, employee.service, web hr.ts/form/detail. typecheck+tests green. Migration NOT on live PG yet.
- [x] Fase 2 — DONE. domain bonus-rules.ts + loan.ts (+tests), migration 0003 (bonus_rules+loans), ports/repos/services, payroll integration (eval rules→BONUS, loans→DEDUCTION, idempotent), controllers/DTOs/module, web /hr/rules page + EmployeeLoans on detail + hr-rail link. hr-service 112 tests green, web typecheck+hr.test green. Migration 0003 NOT on live PG.
- [x] Fase 2b — SALES_TOTAL wired PER-DEPOT (user decision). order-service: repo.sumDepotSales + internal/depot-sales endpoint (InternalAuthGuard). hr-service: SalesPort + OrderSalesHttpAdapter (fails soft→null), env ORDER_SERVICE_URL + INTERNAL_SERVICE_KEY, payroll fetches only when a SALES rule exists. order+hr typecheck+tests green. Prod needs ORDER_SERVICE_URL + INTERNAL_SERVICE_KEY env set, else SALES rules stay dormant.
- [ ] Fase 3  ← next (attendance GPS geofence)
- [ ] Fase 3
- [ ] Fase 4
- [ ] Fase 5
