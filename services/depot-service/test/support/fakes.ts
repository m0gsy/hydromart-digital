import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { SettingRow, SettingsCache } from '@hydromart/platform';

import { InventoryItemType } from '../../src/domain/inventory';
import { PricingRuleRecord } from '../../src/domain/pricing-rule';
import { DepotConfigService } from '../../src/config/depot-config.service';
import {
  CreatePricingRuleData,
  PricingRuleRepository,
  UpdatePricingRuleData,
} from '../../src/application/ports/pricing-rule.repository';
import {
  CreateDepotData,
  DepotQuery,
  DepotRecord,
  DepotRepository,
  UpdateDepotData,
} from '../../src/application/ports/depot.repository';
import {
  CreateInventoryItemData,
  DepotMovementFilter,
  DepotProductPrice,
  DepotStockMovementRecord,
  InventoryItemRecord,
  InventoryListFilter,
  InventoryRepository,
  RecordMovementData,
  ReservationRecord,
  StockMovementRecord,
  UpdateInventoryItemData,
} from '../../src/application/ports/inventory.repository';
import { available, ReservationStatus, StockMovementType } from '../../src/domain/inventory';
import { LowStockAlert, LowStockAlertPort } from '../../src/application/ports/low-stock-alert.port';
import {
  CatalogLookup,
  CatalogProduct,
  ProductCatalogPort,
} from '../../src/application/ports/product-catalog.port';
import {
  UntrackedSaleAlert,
  UntrackedSaleAlertPort,
} from '../../src/application/ports/untracked-sale-alert.port';
import { Approval, ApprovalStatus, ApprovalType } from '../../src/domain/approval';
import {
  ApprovalRepository,
  CreateApprovalData,
  PendingCounts,
  UpdateApprovalData,
} from '../../src/application/ports/approval.repository';
import { Supplier } from '../../src/domain/supplier';
import {
  CreateSupplierData,
  SupplierRepository,
} from '../../src/application/ports/supplier.repository';
import { PoStatus, PurchaseOrder } from '../../src/domain/purchase-order';
import {
  CreatePurchaseOrderData,
  PurchaseOrderRepository,
  UpdatePurchaseOrderData,
} from '../../src/application/ports/purchase-order.repository';
import { ShiftAssignment } from '../../src/domain/shift';
import { RosterRepository, UpsertShiftData } from '../../src/application/ports/roster.repository';
import {
  CreateGallonIssueData,
  GallonIssueRecord,
  GallonIssueRepository,
  GallonIssueSummary,
} from '../../src/application/ports/gallon-issue.repository';
import { HierarchyRepository } from '../../src/application/ports/hierarchy.repository';

let seq = 0;
const nextDate = (): Date => new Date(1_800_000_000_000 + (seq += 1) * 1000);

/** In-memory hierarchy: depot -> assistant, and a person -> superior chain. */
export class InMemoryHierarchyRepository implements HierarchyRepository {
  assistantOfDepot = new Map<string, string>(); // depotId -> assistantId
  superiorOf = new Map<string, string>(); // staffId -> superiorId
  direct = new Map<string, string[]>(); // staffId -> depotIds

  depotsForAssistant(staffId: string): Promise<string[]> {
    return this.depotsForAssistants([staffId]);
  }

  depotsForAssistants(staffIds: readonly string[]): Promise<string[]> {
    const set = new Set(staffIds);
    return Promise.resolve(
      [...this.assistantOfDepot.entries()].filter(([, a]) => set.has(a)).map(([d]) => d),
    );
  }

  subordinatesOf(superiorId: string): Promise<string[]> {
    return this.subordinatesOfMany([superiorId]);
  }

  subordinatesOfMany(superiorIds: readonly string[]): Promise<string[]> {
    const set = new Set(superiorIds);
    return Promise.resolve(
      [...this.superiorOf.entries()].filter(([, s]) => set.has(s)).map(([staff]) => staff),
    );
  }

  directDepots(staffId: string): Promise<string[]> {
    return Promise.resolve(this.direct.get(staffId) ?? []);
  }

  setDepotAssistant(depotId: string, staffId: string | null): Promise<void> {
    if (staffId === null) this.assistantOfDepot.delete(depotId);
    else this.assistantOfDepot.set(depotId, staffId);
    return Promise.resolve();
  }

  setSuperior(staffId: string, superiorId: string): Promise<void> {
    this.superiorOf.set(staffId, superiorId);
    return Promise.resolve();
  }

  clearSuperior(staffId: string): Promise<void> {
    this.superiorOf.delete(staffId);
    return Promise.resolve();
  }

  grantDepot(staffId: string, depotId: string): Promise<void> {
    this.direct.set(staffId, [...(this.direct.get(staffId) ?? []), depotId]);
    return Promise.resolve();
  }

  revokeDepot(staffId: string, depotId: string): Promise<void> {
    this.direct.set(
      staffId,
      (this.direct.get(staffId) ?? []).filter((d) => d !== depotId),
    );
    return Promise.resolve();
  }

  async describe(staffId: string): Promise<{
    superiorId: string | null;
    subordinateIds: string[];
    assistantDepotIds: string[];
    directDepotIds: string[];
  }> {
    return {
      superiorId: this.superiorOf.get(staffId) ?? null,
      subordinateIds: await this.subordinatesOf(staffId),
      assistantDepotIds: await this.depotsForAssistant(staffId),
      directDepotIds: await this.directDepots(staffId),
    };
  }
}

export class InMemoryDepotRepository implements DepotRepository {
  rows: DepotRecord[] = [];

  private match(
    r: DepotRecord,
    q: Pick<DepotQuery, 'ownershipType' | 'search' | 'activeOnly'>,
  ): boolean {
    if (q.activeOnly && !r.active) return false;
    if (q.ownershipType && r.ownershipType !== q.ownershipType) return false;
    if (q.search) {
      const s = q.search.toLowerCase();
      if (
        !r.name.toLowerCase().includes(s) &&
        !r.code.toLowerCase().includes(s) &&
        !r.city.toLowerCase().includes(s)
      )
        return false;
    }
    return true;
  }

  async search(query: DepotQuery): Promise<{ items: DepotRecord[]; total: number }> {
    const all = this.rows
      .filter((r) => this.match(r, query))
      .sort((a, b) => a.code.localeCompare(b.code));
    const start = (query.page - 1) * query.limit;
    return {
      items: all.slice(start, start + query.limit).map((r) => ({ ...r })),
      total: all.length,
    };
  }
  async findById(id: string, activeOnly: boolean): Promise<DepotRecord | null> {
    const r = this.rows.find((x) => x.id === id && (!activeOnly || x.active));
    return r ? { ...r } : null;
  }
  // Audit S-19: the existence check the depot guard uses. Counted, so a test can prove the
  // guard stopped reading whole rows.
  existsCalls = 0;
  async exists(id: string): Promise<boolean> {
    this.existsCalls += 1;
    return this.rows.some((x) => x.id === id);
  }
  async findByCode(code: string): Promise<DepotRecord | null> {
    const r = this.rows.find((x) => x.code === code);
    return r ? { ...r } : null;
  }
  async findByOwner(ownerId: string): Promise<DepotRecord[]> {
    return this.rows
      .filter((x) => x.ownerId === ownerId)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((r) => ({ ...r }));
  }
  async create(data: CreateDepotData): Promise<DepotRecord> {
    const now = nextDate();
    const rec: DepotRecord = {
      ...data,
      paymentBankName: data.paymentBankName ?? null,
      paymentBankAccountNumber: data.paymentBankAccountNumber ?? null,
      paymentBankAccountHolder: data.paymentBankAccountHolder ?? null,
      paymentQrisImageUrl: data.paymentQrisImageUrl ?? null,
      assistantSupervisorId: data.assistantSupervisorId ?? null,
      id: randomUUID(),
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(rec);
    return { ...rec };
  }
  async update(id: string, patch: UpdateDepotData): Promise<DepotRecord> {
    const rec = this.rows.find((r) => r.id === id)!;
    Object.assign(rec, patch, { updatedAt: nextDate() });
    return { ...rec };
  }
}

export class InMemoryInventoryRepository implements InventoryRepository {
  items: InventoryItemRecord[] = [];
  moves: StockMovementRecord[] = [];
  reservations: (ReservationRecord & { quantity: number })[] = [];

  async create(data: CreateInventoryItemData): Promise<InventoryItemRecord> {
    const now = nextDate();
    const rec: InventoryItemRecord = {
      ...data,
      reserved: 0,
      sellPrice: data.sellPrice ?? null,
      hidden: false,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.items.push(rec);
    return { ...rec };
  }
  async findById(id: string): Promise<InventoryItemRecord | null> {
    const r = this.items.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async findLine(
    depotId: string,
    itemType: InventoryItemType,
    productId: string | null,
  ): Promise<InventoryItemRecord | null> {
    const r = this.items.find(
      (x) => x.depotId === depotId && x.itemType === itemType && x.productId === productId,
    );
    return r ? { ...r } : null;
  }
  async findPrices(depotId: string, productIds: string[]): Promise<DepotProductPrice[]> {
    return this.items
      .filter(
        (x) =>
          x.depotId === depotId &&
          x.itemType === InventoryItemType.PRODUK &&
          x.productId !== null &&
          productIds.includes(x.productId) &&
          x.sellPrice !== null,
      )
      .map((x) => ({ productId: x.productId as string, sellPrice: x.sellPrice as number }));
  }
  async renameByProductId(productId: string, label: string, unit: string): Promise<number> {
    const hits = this.items.filter((x) => x.productId === productId);
    hits.forEach((x) => Object.assign(x, { label, unit }));
    return hits.length;
  }
  async setHiddenByProductId(productId: string, hidden: boolean): Promise<number> {
    const hits = this.items.filter((x) => x.productId === productId);
    hits.forEach((x) => Object.assign(x, { hidden }));
    return hits.length;
  }
  async deleteLine(itemId: string): Promise<void> {
    this.items = this.items.filter((x) => x.id !== itemId);
    this.moves = this.moves.filter((m) => m.itemId !== itemId);
    this.reservations = this.reservations.filter((r) => r.itemId !== itemId);
  }
  async listReservations(itemId: string): Promise<ReservationRecord[]> {
    return this.reservations
      .filter((r) => r.itemId === itemId && r.status === ReservationStatus.ACTIVE)
      .map((r) => ({ ...r }));
  }
  async listForDepot(depotId: string, filter: InventoryListFilter): Promise<InventoryItemRecord[]> {
    return this.items
      .filter(
        (x) =>
          x.depotId === depotId &&
          !x.hidden &&
          (!filter.itemType || x.itemType === filter.itemType),
      )
      .filter(
        (x) =>
          !filter.lowStockOnly ||
          (x.minimumStock > 0 && available(x.quantity, x.reserved) <= x.minimumStock),
      )
      .map((x) => ({ ...x }));
  }
  async listLowStock(depotId?: string): Promise<InventoryItemRecord[]> {
    return this.items
      .filter(
        (x) =>
          (!depotId || x.depotId === depotId) &&
          x.minimumStock > 0 &&
          available(x.quantity, x.reserved) <= x.minimumStock,
      )
      .map((x) => ({ ...x }));
  }
  async update(itemId: string, patch: UpdateInventoryItemData): Promise<InventoryItemRecord> {
    const rec = this.items.find((x) => x.id === itemId)!;
    Object.assign(rec, patch, { updatedAt: nextDate() });
    return { ...rec };
  }
  async applyMovement(
    itemId: string,
    newQuantity: number,
    movement: RecordMovementData,
  ): Promise<InventoryItemRecord> {
    const rec = this.items.find((x) => x.id === itemId)!;
    rec.quantity = newQuantity;
    rec.updatedAt = nextDate();
    this.moves.push({
      ...movement,
      orderId: movement.orderId ?? null,
      id: randomUUID(),
      createdAt: nextDate(),
    });
    return { ...rec };
  }
  // Batch reads (audit S-3/S-24). Counted by the tests that pin the round-trip baseline,
  // so they track calls rather than just answering.
  findLinesCalls = 0;
  async findLines(
    depotId: string,
    itemType: InventoryItemType,
    productIds: string[],
  ): Promise<InventoryItemRecord[]> {
    this.findLinesCalls += 1;
    return this.items
      .filter(
        (x) =>
          x.depotId === depotId &&
          x.itemType === itemType &&
          x.productId !== null &&
          productIds.includes(x.productId),
      )
      .map((x) => ({ ...x }));
  }
  movementLookupCalls = 0;
  async itemsWithMovementForOrder(orderId: string, itemIds: string[]): Promise<Set<string>> {
    this.movementLookupCalls += 1;
    return new Set(
      this.moves.filter((m) => m.orderId === orderId && itemIds.includes(m.itemId)).map((m) => m.itemId),
    );
  }
  async countMovements(itemId: string, type: StockMovementType): Promise<number> {
    return this.moves.filter((m) => m.itemId === itemId && m.type === type).length;
  }
  async hasMovementForOrder(itemId: string, orderId: string): Promise<boolean> {
    return this.moves.some((m) => m.itemId === itemId && m.orderId === orderId);
  }
  async listMovements(itemId: string): Promise<StockMovementRecord[]> {
    return this.moves
      .filter((m) => m.itemId === itemId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((m) => ({ ...m }));
  }
  async listForDepotMovements(
    depotId: string,
    filter: DepotMovementFilter,
  ): Promise<{ items: DepotStockMovementRecord[]; total: number; nextCursor: string | null }> {
    const rows = this.moves
      .map((move) => ({ move, item: this.items.find((item) => item.id === move.itemId) }))
      .filter(({ item }) => item?.depotId === depotId)
      .filter(({ move }) => !filter.type || move.type === filter.type)
      .filter(
        ({ move }) =>
          (!filter.from || move.createdAt >= filter.from) &&
          (!filter.to || move.createdAt < filter.to),
      )
      .sort((a, b) => b.move.createdAt.getTime() - a.move.createdAt.getTime());
    // Models the real repository: a cursor seeks past that row and ignores `page`.
    const start = filter.cursor
      ? rows.findIndex(({ move }) => move.id === filter.cursor) + 1
      : (filter.page - 1) * filter.limit;
    const page = rows.slice(start, start + filter.limit);
    return {
      total: rows.length,
      nextCursor:
        page.length === filter.limit ? (page[page.length - 1]?.move.id ?? null) : null,
      items: page.map(({ move, item }) => ({
        ...move,
        itemLabel: item!.label,
        itemType: item!.itemType,
      })),
    };
  }
  async wastageAdjustments(
    depotId: string,
    range: { from?: Date; to?: Date },
  ): Promise<{ itemId: string; label: string; sellPrice: number | null; delta: number }[]> {
    return this.moves
      .filter((m) => m.type === StockMovementType.ADJUSTMENT && m.delta < 0)
      .filter(
        (m) => (!range.from || m.createdAt >= range.from) && (!range.to || m.createdAt < range.to),
      )
      .map((m) => ({ move: m, item: this.items.find((x) => x.id === m.itemId) }))
      .filter((x) => x.item?.depotId === depotId)
      .map(({ move, item }) => ({
        itemId: move.itemId,
        label: item!.label,
        sellPrice: item!.sellPrice,
        delta: move.delta,
      }));
  }

  async findReservation(itemId: string, orderId: string): Promise<ReservationRecord | null> {
    const r = this.reservations.find((x) => x.itemId === itemId && x.orderId === orderId);
    return r ? { ...r } : null;
  }
  async reserveAtomic(
    plans: { itemId: string; quantity: number }[],
    orderId: string,
  ): Promise<{ shortfalls: { itemId: string; requested: number; available: number }[] }> {
    const shortfalls: { itemId: string; requested: number; available: number }[] = [];
    for (const p of plans) {
      const item = this.items.find((x) => x.id === p.itemId);
      const sellable = item ? available(item.quantity, item.reserved) : 0;
      if (sellable < p.quantity) {
        shortfalls.push({ itemId: p.itemId, requested: p.quantity, available: sellable });
      }
    }
    if (shortfalls.length > 0) return { shortfalls };
    for (const p of plans) {
      const item = this.items.find((x) => x.id === p.itemId)!;
      item.reserved += p.quantity;
      item.updatedAt = nextDate();
      this.reservations.push({
        id: randomUUID(),
        itemId: p.itemId,
        orderId,
        quantity: p.quantity,
        status: ReservationStatus.ACTIVE,
      });
    }
    return { shortfalls: [] };
  }
  private settle(itemId: string, orderId: string, status: ReservationStatus): void {
    const res = this.reservations.find((x) => x.itemId === itemId && x.orderId === orderId);
    if (!res || res.status !== ReservationStatus.ACTIVE) return;
    res.status = status;
    const item = this.items.find((x) => x.id === itemId)!;
    item.reserved -= res.quantity;
    item.updatedAt = nextDate();
  }
  async releaseReservation(itemId: string, orderId: string): Promise<void> {
    this.settle(itemId, orderId, ReservationStatus.RELEASED);
  }
  async consumeReservation(itemId: string, orderId: string): Promise<void> {
    this.settle(itemId, orderId, ReservationStatus.CONSUMED);
  }
}

export class FakeLowStockAlert implements LowStockAlertPort {
  emitted: { alert: LowStockAlert; authorization: string }[] = [];

  async emit(alert: LowStockAlert, authorization: string): Promise<void> {
    this.emitted.push({ alert, authorization });
  }
}

export class FakeUntrackedSaleAlert implements UntrackedSaleAlertPort {
  emitted: UntrackedSaleAlert[] = [];
  /** Set to make the port throw, proving a failed warning never fails the sale. */
  throws = false;

  async emit(alert: UntrackedSaleAlert): Promise<void> {
    if (this.throws) {
      throw new Error('crm unreachable');
    }
    this.emitted.push(alert);
  }
}

/**
 * Catalog stub. `products` holds what the catalog knows; `unavailable` simulates
 * product-service being down, which must read differently from "no such product".
 */
export class FakeProductCatalog implements ProductCatalogPort {
  products = new Map<string, CatalogProduct>();
  unavailable = false;

  async find(productId: string): Promise<CatalogLookup> {
    if (this.unavailable) {
      return { status: 'unavailable' };
    }
    const product = this.products.get(productId);
    return product ? { status: 'found', product } : { status: 'missing' };
  }

  async findBySku(sku: string): Promise<CatalogLookup> {
    if (this.unavailable) {
      return { status: 'unavailable' };
    }
    const product = [...this.products.values()].find((p) => p.sku === sku);
    return product ? { status: 'found', product } : { status: 'missing' };
  }
}

export class FakePricingRuleRepository implements PricingRuleRepository {
  rows: PricingRuleRecord[] = [];

  async create(data: CreatePricingRuleData): Promise<PricingRuleRecord> {
    const now = new Date('2026-01-01T00:00:00Z');
    const rule: PricingRuleRecord = { id: randomUUID(), createdAt: now, updatedAt: now, ...data };
    this.rows.push(rule);
    return rule;
  }
  async findById(id: string): Promise<PricingRuleRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async listForDepot(depotId: string): Promise<PricingRuleRecord[]> {
    return this.rows.filter((r) => r.depotId === depotId);
  }
  async listActiveForDepot(depotId: string): Promise<PricingRuleRecord[]> {
    return this.rows.filter((r) => r.depotId === depotId && r.active);
  }
  async update(id: string, patch: UpdatePricingRuleData): Promise<PricingRuleRecord> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error('not found');
    Object.assign(row, patch);
    return row;
  }
  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
}

export class InMemoryApprovalRepository implements ApprovalRepository {
  rows: Approval[] = [];

  async create(data: CreateApprovalData): Promise<Approval> {
    const at = nextDate();
    const row: Approval = { id: randomUUID(), ...data, createdAt: at };
    this.rows.push(row);
    return row;
  }
  async listForDepot(depotId: string, status?: ApprovalStatus): Promise<Approval[]> {
    return this.rows
      .filter((r) => r.depotId === depotId && (!status || r.status === status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async findById(id: string): Promise<Approval | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async update(id: string, data: UpdateApprovalData): Promise<Approval> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, data);
    return row;
  }
  async pendingCounts(depotId: string): Promise<PendingCounts> {
    const counts: PendingCounts = {
      [ApprovalType.OPNAME_VARIANCE]: 0,
      [ApprovalType.DEPOSIT_REFUND]: 0,
      [ApprovalType.COD_VARIANCE]: 0,
      [ApprovalType.GALLON_VARIANCE]: 0,
    };
    for (const r of this.rows) {
      if (r.depotId === depotId && r.status === ApprovalStatus.PENDING) counts[r.type] += 1;
    }
    return counts;
  }
}

export class InMemorySupplierRepository implements SupplierRepository {
  rows: Supplier[] = [];

  async create(data: CreateSupplierData): Promise<Supplier> {
    const row: Supplier = { id: randomUUID(), ...data, createdAt: nextDate() };
    this.rows.push(row);
    return { ...row };
  }
  async listForDepot(depotId: string): Promise<Supplier[]> {
    return this.rows
      .filter((r) => r.depotId === depotId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({ ...r }));
  }
  async findById(id: string): Promise<Supplier | null> {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async findByCode(depotId: string, code: string): Promise<Supplier | null> {
    const r = this.rows.find((x) => x.depotId === depotId && x.code === code);
    return r ? { ...r } : null;
  }
}

export class InMemoryPurchaseOrderRepository implements PurchaseOrderRepository {
  rows: PurchaseOrder[] = [];

  async create(data: CreatePurchaseOrderData): Promise<PurchaseOrder> {
    const row: PurchaseOrder = {
      id: randomUUID(),
      ...data,
      status: PoStatus.DRAFT,
      receivedAt: null,
      createdAt: nextDate(),
    };
    this.rows.push(row);
    return { ...row };
  }
  async listForDepot(depotId: string, status?: PoStatus): Promise<PurchaseOrder[]> {
    return this.rows
      .filter((r) => r.depotId === depotId && (!status || r.status === status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({ ...r }));
  }
  async findById(id: string): Promise<PurchaseOrder | null> {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async update(id: string, data: UpdatePurchaseOrderData): Promise<PurchaseOrder> {
    const rec = this.rows.find((x) => x.id === id)!;
    Object.assign(rec, data);
    return { ...rec };
  }
}

export class InMemoryRosterRepository implements RosterRepository {
  rows: ShiftAssignment[] = [];

  private key(a: Pick<UpsertShiftData, 'depotId' | 'weekStart' | 'staffId' | 'day'>): string {
    return `${a.depotId}|${a.weekStart}|${a.staffId}|${a.day}`;
  }

  async listForWeek(depotId: string, weekStart: string): Promise<ShiftAssignment[]> {
    return this.rows
      .filter((r) => r.depotId === depotId && r.weekStart === weekStart)
      .map((r) => ({ ...r }));
  }

  async upsertCell(a: UpsertShiftData): Promise<ShiftAssignment> {
    const existing = this.rows.find((r) => this.key(r) === this.key(a));
    if (existing) {
      existing.shift = a.shift;
      existing.staffName = a.staffName;
      return { ...existing };
    }
    const row: ShiftAssignment = { id: randomUUID(), ...a };
    this.rows.push(row);
    return { ...row };
  }

  async bulkUpsert(assignments: UpsertShiftData[]): Promise<ShiftAssignment[]> {
    const out: ShiftAssignment[] = [];
    for (const a of assignments) out.push(await this.upsertCell(a));
    return out;
  }
}

export function buildTestConfig(overrides: Record<string, string> = {}): DepotConfigService {
  const env: Record<string, string> = {
    NODE_ENV: 'test',
    DEPOT_SERVICE_PORT: '3007',
    DEPOT_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_TTL_SECONDS: '60',
    RATE_LIMIT_MAX: '100',
    GALLON_DEPOSIT_IDR: '20000',
    APPROVAL_AUTO_PASS_IDR: '100000',
    ...overrides,
  };
  const fake = {
    get: <T>(k: string, d?: T): T => (env[k] as unknown as T) ?? (d as T),
    getOrThrow: (k: string): string => {
      if (env[k] === undefined) throw new Error(`missing ${k}`);
      return env[k];
    },
  };
  // ponytail: empty-row cache — every business getter falls through to the env value
  // above, matching today's (pre-settings-cache) behavior exactly.
  return new DepotConfigService(
    fake as unknown as ConfigService,
    new SettingsCache({ loadAll: async () => [] }),
  );
}

/** In-memory SettingsRepository for unit/e2e tests (settings.repository.ts port). */
export class InMemorySettingsRepository {
  rows: (SettingRow & { updatedBy: string })[] = [];

  async loadAll(): Promise<SettingRow[]> {
    return this.rows.map(({ scope, depotId, key, value }) => ({ scope, depotId, key, value }));
  }
  async upsert(row: SettingRow & { updatedBy: string }): Promise<void> {
    const i = this.rows.findIndex(
      (r) => r.scope === row.scope && r.depotId === row.depotId && r.key === row.key,
    );
    if (i >= 0) this.rows[i] = row;
    else this.rows.push(row);
  }
  async remove(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void> {
    const i = this.rows.findIndex(
      (r) => r.scope === scope && r.depotId === depotId && r.key === key,
    );
    if (i >= 0) this.rows.splice(i, 1);
  }
}

/** Shared by the gallon issue AND return specs (the return guard reads both ledgers). */
export class InMemoryGallonIssueRepository implements GallonIssueRepository {
  private rows: GallonIssueRecord[] = [];
  private seq = 0;

  async create(data: CreateGallonIssueData): Promise<GallonIssueRecord> {
    const row: GallonIssueRecord = { id: `i${++this.seq}`, createdAt: new Date(), ...data };
    this.rows.push(row);
    return row;
  }
  async listForDepot(depotId: string, page: number, limit: number) {
    const all = this.rows.filter((r) => r.depotId === depotId).reverse();
    return { items: all.slice((page - 1) * limit, page * limit), total: all.length };
  }
  async summaryForDepot(depotId: string): Promise<GallonIssueSummary> {
    const all = this.rows.filter((r) => r.depotId === depotId);
    return {
      issues: all.length,
      gallons: all.reduce((s, r) => s + r.quantity, 0),
      depositHeld: all.reduce((s, r) => s + r.depositHeld, 0),
    };
  }
  async networkSummary() {
    const map = new Map<string, { gallons: number; depositHeld: number }>();
    for (const r of this.rows) {
      const e = map.get(r.depotId) ?? { gallons: 0, depositHeld: 0 };
      e.gallons += r.quantity;
      e.depositHeld += r.depositHeld;
      map.set(r.depotId, e);
    }
    return [...map.entries()].map(([depotId, v]) => ({ depotId, ...v }));
  }
}
