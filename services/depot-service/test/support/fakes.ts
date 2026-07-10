import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { InventoryItemType } from '../../src/domain/inventory';
import { DepotConfigService } from '../../src/config/depot-config.service';
import {
  CreateDepotData,
  DepotQuery,
  DepotRecord,
  DepotRepository,
  UpdateDepotData,
} from '../../src/application/ports/depot.repository';
import {
  CreateInventoryItemData,
  InventoryItemRecord,
  InventoryListFilter,
  InventoryRepository,
  RecordMovementData,
  StockMovementRecord,
  UpdateInventoryItemData,
} from '../../src/application/ports/inventory.repository';
import { LowStockAlert, LowStockAlertPort } from '../../src/application/ports/low-stock-alert.port';

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
  async create(data: CreateDepotData): Promise<DepotRecord> {
    const now = nextDate();
    const rec: DepotRecord = { ...data, id: randomUUID(), active: true, createdAt: now, updatedAt: now };
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

  async create(data: CreateInventoryItemData): Promise<InventoryItemRecord> {
    const now = nextDate();
    const rec: InventoryItemRecord = { ...data, id: randomUUID(), createdAt: now, updatedAt: now };
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
  async listForDepot(depotId: string, filter: InventoryListFilter): Promise<InventoryItemRecord[]> {
    return this.items
      .filter((x) => x.depotId === depotId && (!filter.itemType || x.itemType === filter.itemType))
      .filter((x) => !filter.lowStockOnly || (x.minimumStock > 0 && x.quantity <= x.minimumStock))
      .map((x) => ({ ...x }));
  }
  async listLowStock(depotId?: string): Promise<InventoryItemRecord[]> {
    return this.items
      .filter((x) => (!depotId || x.depotId === depotId) && x.minimumStock > 0 && x.quantity <= x.minimumStock)
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
}

export class FakeLowStockAlert implements LowStockAlertPort {
  emitted: { alert: LowStockAlert; authorization: string }[] = [];

  async emit(alert: LowStockAlert, authorization: string): Promise<void> {
    this.emitted.push({ alert, authorization });
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
