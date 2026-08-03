# Inventory ↔ Catalog Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the depot stock ledger and the product catalog one workflow instead of two disconnected screens, and close the stock-correctness gaps the disconnection created.

**Architecture:** depot-service stays the owner of stock and keeps its own database; it gains a read-only HTTP port to product-service (mirroring order-service's `ProductCatalogHttpAdapter`) so a stock line can be validated and named from the catalog. product-service gains its first outbound port — a depot-service notifier — so a rename or a deactivation reaches the lines that copied the name. Both directions fail open: a catalog outage must never block a stock movement, and a depot outage must never block a catalog edit.

**Tech Stack:** NestJS 10 (hexagonal: `application/ports` + `infrastructure/{http,prisma}`), Prisma, Jest (services, 90/90/90/90 gates), Next.js 15 App Router, Vitest (web), `x-internal-key` for service-to-service auth.

## Global Constraints

- Every service workspace gates at 90% statements/branches/functions/lines; `apps/web` and the shared packages gate at 98%. A new file with no test fails CI.
- Service-to-service calls use `@Public() @UseGuards(InternalAuthGuard) @ApiSecurity('internal-key')` on the receiver and the `x-internal-key: <INTERNAL_SERVICE_KEY>` header on the caller. Blank key = feature disabled, never an error.
- Every cross-service adapter fails open: log and continue. Precedent: `LowStockAlertHttpAdapter`.
- Prisma migrations are hand-written SQL under `services/<svc>/prisma/migrations/<timestamp>_<name>/migration.sql`, and must be verified up **and** down on a clean database. Deploy does **not** run migrations — they are applied by hand.
- Copy is Indonesian, addressed to depot operators. New user-facing strings go through `t()` with keys in both `apps/web/src/lib/dictionaries/{id,en}/`.
- Decision (a): a product with no stock line in a depot **stays sellable**; the sale is recorded and the operator is warned. It is never silently swallowed.
- Decision (b): when a catalog product is deactivated, its depot stock lines are **hidden** from the operator list, not deleted.

---

## File Structure

**depot-service**
- Create `src/application/ports/product-catalog.port.ts` — read-only view of a catalog product.
- Create `src/infrastructure/http/product-catalog.http.adapter.ts` — fetches it; fails open.
- Create `src/application/ports/untracked-sale-alert.port.ts` + `src/infrastructure/http/untracked-sale-alert.http.adapter.ts` — decision (a) warning.
- Modify `src/application/services/inventory.service.ts` — validate on create, resolve labels, hide orphans, warn on untracked sale, delete a line.
- Modify `src/application/ports/inventory.repository.ts` + `src/infrastructure/prisma/inventory.prisma.repository.ts` — `deleteLine`, `listReservations`, `renameByProductId`, `setHiddenByProductId`.
- Modify `src/modules/inventory.controller.ts` — `DELETE /inventory/:itemId`, `GET /inventory/:itemId/reservations`, `POST /internal/catalog/product-changed`.
- Create migration `prisma/migrations/20260803T_inventory_hidden/migration.sql` — `hidden BOOLEAN NOT NULL DEFAULT false`.

**product-service**
- Create `src/application/ports/stock-notifier.port.ts` + `src/infrastructure/http/stock-notifier.http.adapter.ts` — announces rename/deactivate.
- Modify `src/application/services/product.service.ts` — call the notifier after `update`/`deactivate`.

**crm-service**
- Modify `src/domain/notification-event.ts` — add `STOCK_UNTRACKED` to the enum, `NOTIFICATION_TEMPLATES`, and `OPS_EVENTS`.

**apps/web**
- Modify `src/app/dashboard/products/page.tsx` — `browseAll` + status badge.
- Modify `src/app/dashboard/inventory/page.tsx` — row picker, movements tab, opname reporting, effective price, delete, reservations, ledger pagination, i18n.
- Create `src/app/dashboard/inventory/new-line-form.tsx` — the add-stock-line form.
- Modify `src/lib/endpoints.ts`, `src/lib/types.ts`, `src/lib/dictionaries/{id,en}/ops.ts`.

---

## PR 1 — Stop the bleeding (web only)

### Task 1: `/dashboard/products` stops hiding deactivated products

**Files:**
- Modify: `apps/web/src/app/dashboard/products/page.tsx:65`
- Test: `apps/web/test/endpoints.test.ts`

**Interfaces:**
- Consumes: `endpoints.products.browseAll(q)` (already shipped in PR #66).
- Produces: nothing new.

- [ ] **Step 1:** Assert `endpoints.products.browseAll({ limit: 100 })` returns `/products/api/v1/products/all?limit=100`.
- [ ] **Step 2:** Run `npx vitest run test/endpoints.test.ts` — expect PASS (endpoint already exists; this pins it).
- [ ] **Step 3:** Swap `browse` → `browseAll` in the page and render a `<Badge>` with `active ? 'Tersedia' : 'Tidak tersedia'` in the row.
- [ ] **Step 4:** `npx tsc --noEmit` and `npx vitest run` — expect PASS.
- [ ] **Step 5:** Commit.

### Task 2: Header stock buttons stop acting on the top row

**Files:**
- Modify: `apps/web/src/app/dashboard/inventory/page.tsx:645-650,679-688`

**Interfaces:**
- Produces: `pickerOpen: 'receipt' | 'opname' | null` state; a `<LinePicker>` block listing `visible` lines, each calling `openRow(item.id, mode, receipt)`.

- [ ] **Step 1:** Replace `headerOpen` (which opens `visible[0]`) with state that opens a picker listing every visible line by label + current quantity.
- [ ] **Step 2:** Selecting a line jumps to that row's form, exactly as clicking the row's own button does.
- [ ] **Step 3:** Delete the `ponytail:` comment that documented the limitation.
- [ ] **Step 4:** `npx tsc --noEmit` — expect PASS. Commit.

### Task 3: Movements tab survives an empty stock filter

**Files:**
- Modify: `apps/web/src/app/dashboard/inventory/page.tsx:725-730`

- [ ] **Step 1:** Move the `view === 'movements'` branch **above** the `visible.length === 0` branch so the ledger renders regardless of the type filter.
- [ ] **Step 2:** Keep the depot guard: still show `noDepots` when there is no depot at all.
- [ ] **Step 3:** `npx tsc --noEmit` — expect PASS. Commit.

### Task 4: Batch opname reports which lines failed

**Files:**
- Modify: `apps/web/src/app/dashboard/inventory/page.tsx:511-547`

**Interfaces:**
- Produces: `failed: {label: string; message: string}[]` state rendered as a list; successful rows are cleared from `counts`, failed rows keep their typed value.

- [ ] **Step 1:** Collect `{label, message}` per failure instead of counting.
- [ ] **Step 2:** On partial failure keep the sheet open, clear only the saved rows, and list the failed labels.
- [ ] **Step 3:** `npx tsc --noEmit`, `npx vitest run` — expect PASS. Commit, push, open PR.

---

## PR 2 — Connect the catalog to the stock ledger

### Task 5: depot-service reads the catalog

**Files:**
- Create: `services/depot-service/src/application/ports/product-catalog.port.ts`
- Create: `services/depot-service/src/infrastructure/http/product-catalog.http.adapter.ts`
- Modify: `services/depot-service/src/application/tokens.ts`, `src/modules/depot.module.ts`, `src/config/{env.validation.ts,depot-config.service.ts}`
- Test: `services/depot-service/test/unit/product-catalog.http.adapter.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CatalogProduct { id: string; name: string; sku: string; unit: string; active: boolean }
  export interface ProductCatalogPort { find(productId: string): Promise<CatalogProduct | null> }
  ```
  `find` returns `null` on 404 **and** on any transport error (fail open), logging the reason.
- Config: `PRODUCT_SERVICE_URL` (Joi `.uri()`, default `http://localhost:3003`).

- [ ] **Step 1:** Test: 200 → mapped record; 404 → `null`; 500 → `null` + warning; abort/timeout → `null`.
- [ ] **Step 2:** Run `npx jest test/unit/product-catalog.http.adapter.spec.ts` — expect FAIL (module missing).
- [ ] **Step 3:** Implement port + adapter, copying the timeout/abort shape of `services/order-service/src/infrastructure/http/product-catalog.http.adapter.ts`.
- [ ] **Step 4:** Run the test — expect PASS. Commit.

### Task 6: Creating a stock line validates and names itself from the catalog

**Files:**
- Modify: `services/depot-service/src/application/services/inventory.service.ts:154-200`
- Test: `services/depot-service/test/unit/inventory.service.spec.ts`

**Interfaces:**
- Consumes: `ProductCatalogPort.find`.
- Behaviour: for a `PRODUK` line, `find(productId)` is called. Unknown product → throw `ProductNotFoundError` (new domain error, maps to 404). Catalog unreachable → accept the line with the caller's label (fail open). Known product → `label` and `unit` come from the catalog, ignoring what the caller typed.

- [ ] **Step 1:** Tests: unknown product rejected; unreachable catalog accepted with typed label; known product overwrites label/unit; non-PRODUK lines never call the catalog.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement. Add `ProductNotFoundError` to `src/domain/errors.ts` and its HTTP mapping.
- [ ] **Step 4:** Run — expect PASS. Commit.

### Task 7: The add-stock-line screen

**Files:**
- Create: `apps/web/src/app/dashboard/inventory/new-line-form.tsx`
- Modify: `apps/web/src/app/dashboard/inventory/page.tsx`, `src/lib/endpoints.ts`
- Test: `apps/web/test/endpoints.test.ts`

**Interfaces:**
- Produces: `endpoints.inventory.create(depotId)` → `POST /depots/api/v1/depots/${depotId}/inventory`.
- The form: item-type selector; for `PRODUK` a `<select>` populated from `endpoints.products.browseAll({limit:100})` showing `name · sku`, submitting `productId`; for raw-stock types a free-text label. `unit`, `quantity`, `minimumStock`, `sellPrice` optional.
- Products that already have a line in this depot are excluded from the dropdown (the API rejects duplicates with 409).

- [ ] **Step 1:** Test the new endpoint builder. Run — expect FAIL.
- [ ] **Step 2:** Add the builder, run — expect PASS.
- [ ] **Step 3:** Build the form component and mount it behind a "Tambah baris stok" button, gated on `canWrite`.
- [ ] **Step 4:** `npx tsc --noEmit`, `npx vitest run` — expect PASS. Commit.

### Task 8: An untracked sale warns the operator (decision a)

**Files:**
- Create: `services/depot-service/src/application/ports/untracked-sale-alert.port.ts`
- Create: `services/depot-service/src/infrastructure/http/untracked-sale-alert.http.adapter.ts`
- Modify: `services/depot-service/src/application/services/inventory.service.ts:366-370` (`reserveForOrder`) and the `consumeForOrder` skip path
- Modify: `services/crm-service/src/domain/notification-event.ts`
- Test: `services/depot-service/test/unit/inventory.service.spec.ts`, `services/crm-service/test/unit/notification-event.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface UntrackedSaleAlert { depotId: string; depotName: string; orderId: string; productIds: string[] }
  export interface UntrackedSaleAlertPort { emit(alert: UntrackedSaleAlert, authorization: string): Promise<void> }
  ```
- crm gains `STOCK_UNTRACKED = 'STOCK_UNTRACKED'`, a template ("Pesanan {{order}} di {{depot}} memuat {{count}} produk tanpa baris stok…"), and membership in `OPS_EVENTS` so it lands in the ops feed.
- The sale still succeeds. The alert is fire-and-forget and never throws.

- [ ] **Step 1:** Tests: skipped products emit exactly one alert carrying every skipped id; an empty skip list emits nothing; a throwing alert port does not fail the reservation.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement port, adapter (copy `LowStockAlertHttpAdapter`), wiring, and the crm event.
- [ ] **Step 4:** Run both services' suites — expect PASS.

### Task 9: The console shows which catalog products have no stock line (item 1.3)

**Files:**
- Modify: `apps/web/src/app/dashboard/inventory/page.tsx`

**Interfaces:**
- Consumes: catalog list (`products.browseAll`) + depot lines; the difference is rendered as a warning card listing the missing products, each with a one-click "Buat baris stok" that opens the Task 7 form pre-filled.

- [ ] **Step 1:** Compute `missing = activeCatalogProducts.filter(p => !lines.some(l => l.productId === p.id))`.
- [ ] **Step 2:** Render the card only when `missing.length > 0`, with copy explaining these sell without stock control.
- [ ] **Step 3:** `npx tsc --noEmit`, `npx vitest run` — expect PASS. Commit, push, open PR.

---

## PR 3 — Names that stay true, and orphans that stay hidden

### Task 10: Stock lines carry a `hidden` flag

**Files:**
- Create: `services/depot-service/prisma/migrations/20260803T_inventory_hidden/migration.sql`
- Modify: `services/depot-service/prisma/schema.prisma` (`InventoryItem.hidden Boolean @default(false)`)
- Modify: `src/infrastructure/prisma/inventory.prisma.repository.ts` (`listForDepot` excludes `hidden`)

- [ ] **Step 1:** Write the migration (`ALTER TABLE "inventory_items" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;`) and its down (`DROP COLUMN`).
- [ ] **Step 2:** Apply up then down on a scratch database; confirm both succeed.
- [ ] **Step 3:** Exclude hidden lines from the operator list, keep them for internal reserve/consume lookups (an order in flight must still settle).
- [ ] **Step 4:** Run depot-service tests — expect PASS. Commit.

### Task 11: product-service announces renames and deactivations

**Files:**
- Create: `services/product-service/src/application/ports/stock-notifier.port.ts`
- Create: `services/product-service/src/infrastructure/http/stock-notifier.http.adapter.ts`
- Modify: `services/product-service/src/application/services/product.service.ts:60-78`, `src/modules/product.module.ts`, `src/config/*`
- Test: `services/product-service/test/unit/stock-notifier.http.adapter.spec.ts`, `product.service.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ProductChanged { productId: string; name: string; unit: string; active: boolean }
  export interface StockNotifierPort { productChanged(change: ProductChanged): Promise<void> }
  ```
- Fires after a successful `update` when `name`, `unit`, or `active` changed, and after `deactivate`. Never throws: a depot-service outage must not fail a catalog edit.
- Config: `DEPOT_SERVICE_URL`, `INTERNAL_SERVICE_KEY`.

- [ ] **Step 1:** Tests: rename fires once with the new name; a description-only edit fires nothing; a failing notifier still returns the updated product.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement port, adapter, and the service hook.
- [ ] **Step 4:** Run — expect PASS. Commit.

### Task 12: depot-service applies the announcement

**Files:**
- Modify: `services/depot-service/src/modules/inventory.controller.ts` (new `POST /inventory/internal/product-changed`)
- Modify: `src/application/services/inventory.service.ts`, `src/application/ports/inventory.repository.ts`, `src/infrastructure/prisma/inventory.prisma.repository.ts`
- Test: `services/depot-service/test/unit/inventory.service.spec.ts`, `test/e2e/inventory.e2e.spec.ts`

**Interfaces:**
- Produces: `applyProductChange({productId, name, unit, active})` → renames every line with that `productId` across all depots and sets `hidden = !active`.
- Repository: `renameByProductId(productId, label, unit): Promise<number>` and `setHiddenByProductId(productId, hidden): Promise<number>`, both returning the row count.
- Endpoint guarded by `InternalAuthGuard`; 401 without the key.

- [ ] **Step 1:** Tests: rename updates every depot's line; deactivate hides them; reactivate unhides; unknown product is a no-op returning 0.
- [ ] **Step 2:** Run — expect FAIL. **Step 3:** Implement. **Step 4:** Run — expect PASS. Commit.

### Task 13: CSV import accepts `sku` (item 1.2)

**Files:**
- Modify: `services/depot-service/src/modules/dto/inventory.dto.ts`, `src/application/services/inventory.service.ts` (`importLines`)
- Modify: `apps/web/src/app/dashboard/inventory/import/page.tsx`
- Test: `services/depot-service/test/unit/inventory.service.spec.ts`

**Interfaces:**
- Import rows accept `sku` **or** `productId`. `sku` is resolved through a new `ProductCatalogPort.findBySku(sku)`; unresolved SKUs are reported per row in the existing `ImportSummary.errors`, never imported blank.

- [ ] **Step 1:** Add `findBySku` to the port + adapter (`GET /products?search=<sku>&limit=1`, exact-match check) with its own adapter test.
- [ ] **Step 2:** Tests: a row with `sku` imports with the resolved id; an unknown `sku` is reported; a row with both prefers `productId`.
- [ ] **Step 3:** Implement, update the wizard's column list and its help text.
- [ ] **Step 4:** Run both suites — expect PASS. Commit, push, open PR.

---

## PR 4 — The remaining console gaps

### Task 14: Effective price on PRODUK rows (item 4.4)

**Files:** modify `apps/web/src/app/dashboard/inventory/page.tsx`; consumes `endpoints.inventory.prices(depotId, productIds)`.

- [ ] Fetch resolved prices for the visible PRODUK lines; show the number and its source (`override` / `aturan` / `katalog`) instead of the bare words "harga katalog". Commit.

### Task 15: Delete a stock line (item 4.5)

**Files:** `services/depot-service/src/modules/inventory.controller.ts`, `inventory.service.ts`, `inventory.repository.ts` (+ Prisma), `apps/web/.../page.tsx`.

**Interfaces:** `DELETE /inventory/:itemId` behind `@Can('inventoryWrite')`. Refuses with 409 when `quantity != 0` or `reserved != 0` — a line holding stock is deleted by counting it to zero first, not by hiding the discrepancy.

- [ ] Tests first: non-empty line refused; empty line deleted with its movements cascading. Then implement, then the confirm dialog in the UI. Commit.

### Task 16: Reservation drill-down (item 4.8)

**Files:** repository `listReservations(itemId)`, `GET /inventory/:itemId/reservations`, UI list inside the expanded row.

**Interfaces:** returns `{orderId, quantity, status, createdAt}[]` for `ACTIVE` holds, newest first.

- [ ] Tests first (repo + controller), then the UI list under "Dipesan". Commit.

### Task 17: Ledger pagination (item 4.7)

**Files:** `apps/web/src/app/dashboard/inventory/page.tsx:442-453`.

- [ ] Replace the silent `limit: 100` with page state and a "Muat lebih banyak" button driven by the existing paginated response. Commit.

### Task 18: Finish the Indonesian/English split (item 4.6)

**Files:** `apps/web/src/lib/dictionaries/{id,en}/ops.ts`, `apps/web/src/app/dashboard/inventory/page.tsx`.

**Interfaces:** every hardcoded string in the page moves under the existing `opsFix.*` namespace; the existing RBAC-style dictionary parity test is extended to assert `id` and `en` have identical key sets for that namespace.

- [ ] Test first (key-parity), then move the strings. Run `npx vitest run` — expect PASS. Commit, push, open PR.

---

## Self-Review

**Spec coverage:** 1.1 → Task 7. 1.2 → Task 13. 1.3 → Task 9. 1.4 → Tasks 5–6. Item 2 (expensive option) → Tasks 11–12. Item 3 → Task 1. Item 4.1–4.8 → Tasks 2, 3, 4, 14, 15, 16, 17, 18. Decision (a) → Task 8. Decision (b) → Tasks 10, 12.

**Type consistency:** `ProductCatalogPort.find`/`findBySku` (Tasks 5, 13) and `StockNotifierPort.productChanged` (Task 11) are consumed under those exact names in Tasks 6, 12, 13. `InventoryItem.hidden` (Task 10) is the flag Task 12 writes. `endpoints.inventory.create` (Task 7) is reused by Task 9's pre-filled form.

**Known ordering constraint:** Task 12 must merge before Task 11 is deployed, or product-service will call an endpoint that does not exist yet. Both fail open, so the window is harmless, but deploy depot-service first.
