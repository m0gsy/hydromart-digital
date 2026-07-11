import { toUtcDay } from '../../src/domain/series';
import {
  DemandRow,
  ForecastRepository,
  IngestCommand,
  IngestItem,
  ProductRefRecord,
} from '../../src/application/ports/forecast.repository';
import { OrderFeedPort } from '../../src/application/ports/order-feed.port';

/** Cell key: null depot collapses to '∅' so it never collides with a real id. */
function cellKey(productId: string, depotId: string | null, day: number): string {
  return `${productId}|${depotId ?? '∅'}|${day}`;
}

interface DemandCell extends DemandRow {
  orderCount: number;
}

/**
 * In-memory stand-in for ForecastRepository, mirroring the Prisma adapter's write semantics
 * exactly (idempotency via ingestedOrderIds, quantity += item.quantity + orderCount += 1 per
 * cell, ProductRef upsert, epoch-day bucketing via domain `toUtcDay`). Maps/set are public so
 * tests can seed and inspect state directly without going through applyIngest.
 */
export class FakeForecastRepository implements ForecastRepository {
  refs = new Map<string, ProductRefRecord>();
  cells = new Map<string, DemandCell>();
  ingestedOrderIds = new Set<string>();

  async hasIngested(orderId: string): Promise<boolean> {
    return this.ingestedOrderIds.has(orderId);
  }

  async applyIngest(cmd: IngestCommand): Promise<void> {
    if (this.ingestedOrderIds.has(cmd.orderId)) return; // idempotent no-op

    const day = toUtcDay(cmd.at);
    for (const item of cmd.items) {
      this.upsertRef(item);
      this.incrementCell(item.productId, cmd.depotId, day, item.quantity);
    }

    this.ingestedOrderIds.add(cmd.orderId);
  }

  private upsertRef(item: IngestItem): void {
    this.refs.set(item.productId, {
      productId: item.productId,
      name: item.productName,
      sku: item.sku,
      unit: item.unit,
    });
  }

  private incrementCell(productId: string, depotId: string | null, day: number, quantity: number): void {
    const key = cellKey(productId, depotId, day);
    const cell = this.cells.get(key);
    if (cell) {
      cell.quantity += quantity;
      cell.orderCount += 1;
    } else {
      this.cells.set(key, { productId, depotId, day, quantity, orderCount: 1 });
    }
  }

  async findDemandRows(query: {
    productId: string;
    depotId?: string | null;
    fromDay: number;
    toDay: number;
  }): Promise<DemandRow[]> {
    const { productId, depotId, fromDay, toDay } = query;
    const allDepots = depotId === undefined;
    return [...this.cells.values()]
      .filter(
        (c) =>
          c.productId === productId &&
          c.day >= fromDay &&
          c.day <= toDay &&
          (allDepots || c.depotId === depotId),
      )
      .map(toDemandRow);
  }

  async listDepotProducts(query: {
    depotId: string;
    fromDay: number;
    toDay: number;
  }): Promise<{ productId: string; rows: DemandRow[] }[]> {
    const { depotId, fromDay, toDay } = query;
    const grouped = new Map<string, DemandRow[]>();
    for (const c of this.cells.values()) {
      if (c.depotId !== depotId || c.day < fromDay || c.day > toDay) continue;
      const rows = grouped.get(c.productId) ?? [];
      rows.push(toDemandRow(c));
      grouped.set(c.productId, rows);
    }
    return [...grouped.entries()].map(([productId, rows]) => ({ productId, rows }));
  }

  async findRefs(productIds: string[]): Promise<ProductRefRecord[]> {
    return productIds.map((id) => this.refs.get(id)).filter((r): r is ProductRefRecord => r !== undefined);
  }
}

function toDemandRow(c: DemandCell): DemandRow {
  return { productId: c.productId, depotId: c.depotId, day: c.day, quantity: c.quantity };
}

/** In-memory stand-in for OrderFeedPort: paginates a fixed list of orders by index cursor. */
export class FakeOrderFeed implements OrderFeedPort {
  constructor(public orders: IngestCommand[] = []) {}

  async fetchCompleted(cursor: string | null, limit: number): Promise<{ orders: IngestCommand[]; nextCursor: string | null }> {
    const start = cursor ? Number(cursor) : 0;
    const page = this.orders.slice(start, start + limit);
    const end = start + page.length;
    return { orders: page, nextCursor: end < this.orders.length ? String(end) : null };
  }
}
