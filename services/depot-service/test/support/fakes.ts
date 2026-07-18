import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

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
  DepotProductPrice,
  InventoryItemRecord,
  InventoryListFilter,
  InventoryRepository,
  RecordMovementData,
  ReservationRecord,
  StockMovementRecord,
  UpdateInventoryItemData,
} from '../../src/application/ports/inventory.repository';
import { available, ReservationStatus } from '../../src/domain/inventory';
import { LowStockAlert, LowStockAlertPort } from '../../src/application/ports/low-stock-alert.port';
import { Approval, ApprovalStatus, ApprovalType } from '../../src/domain/approval';
import {
  ApprovalRepository,
  CreateApprovalData,
  PendingCounts,
  UpdateApprovalData,
} from '../../src/application/ports/approval.repository';
import { Supplier } from '../../src/domain/supplier';
import { CreateSupplierData, SupplierRepository } from '../../src/application/ports/supplier.repository';
import { PoStatus, PurchaseOrder } from '../../src/domain/purchase-order';
import {
  CreatePurchaseOrderData,
  PurchaseOrderRepository,
  UpdatePurchaseOrderData,
} from '../../src/application/ports/purchase-order.repository';
import { ShiftAssignment } from '../../src/domain/shift';
import { RosterRepository, UpsertShiftData } from '../../src/application/ports/roster.repository';

let seq = 0;
const nextDate = (): Date => new Date(1_800_000_000_000 + (seq += 1) * 1000);

export class InMemoryDepotRepository implements DepotRepository {
  rows: DepotRecord[] = [];

  private match(r: DepotRecord, q: Pick<DepotQuery, 'ownershipType' | 'search' | 'activeOnly'>): boolean {
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
    const all = this.rows.filter((r) => this.match(r, query)).sort((a, b) => a.code.localeCompare(b.code));
    const start = (query.page - 1) * query.limit;
    return { items: all.slice(start, start + query.limit).map((r) => ({ ...r })), total: all.length };
  }
  async findById(id: string, activeOnly: boolean): Promise<DepotRecord | null> {
    const r = this.rows.find((x) => x.id === id && (!activeOnly || x.active));
    return r ? { ...r } : null;
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
  async listForDepot(depotId: string, filter: InventoryListFilter): Promise<InventoryItemRecord[]> {
    return this.items
      .filter((x) => x.depotId === depotId && (!filter.itemType || x.itemType === filter.itemType))
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
  async hasMovementForOrder(itemId: string, orderId: string): Promise<boolean> {
    return this.moves.some((m) => m.itemId === itemId && m.orderId === orderId);
  }
  async listMovements(itemId: string): Promise<StockMovementRecord[]> {
    return this.moves
      .filter((m) => m.itemId === itemId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((m) => ({ ...m }));
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
  return new DepotConfigService(fake as unknown as ConfigService);
}
