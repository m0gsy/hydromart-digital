import { randomUUID } from 'node:crypto';

import { AuthenticatedUser } from '@hydromart/platform';

import { DepotConfigService } from '../../src/config/depot-config.service';
import {
  InsufficientStockError,
  InventoryItemNotFoundError,
  TransferNotFoundError,
  TransferNotPendingError,
  TransferSameDepotError,
} from '../../src/domain/errors';
import { InventoryItemType, StockMovementType } from '../../src/domain/inventory';
import { StockTransferStatus } from '../../src/domain/stock-transfer';
import { StockTransferService } from '../../src/application/services/stock-transfer.service';
import {
  SendTransferData,
  StockTransferRecord,
  StockTransferRepository,
  TransferQuery,
} from '../../src/application/ports/stock-transfer.repository';
import { InMemoryInventoryRepository } from '../support/fakes';

/**
 * CA-2-54 — stock could not move between depots at all.
 *
 * The only way stock entered a depot was a purchase order to a supplier. A depot with four
 * spare gallons and one two streets away that had run out could do nothing on the system:
 * the transfer everyone already does in practice — on a motorbike — had no record, so it
 * surfaced as a shortfall in one book and an unexplained surplus in the other.
 *
 * Two steps, because a transfer is not instantaneous. The tests below are mostly about that
 * gap: who owns the stock while it is on the bike, and what happens if it never lands.
 */

const DEPOT_A = randomUUID();
const DEPOT_B = randomUUID();
const PRODUCT = randomUUID();

const hq: AuthenticatedUser = {
  sub: randomUUID(),
  role: 'SUPER_ADMIN' as never,
  phone: null,
  depotId: null,
};
const atA: AuthenticatedUser = { ...hq, role: 'KEPALA_DEPOT' as never, depotId: DEPOT_A };
const atB: AuthenticatedUser = { ...hq, role: 'KEPALA_DEPOT' as never, depotId: DEPOT_B };

/**
 * Models the two rules the real repository enforces inside one transaction: the sender's
 * deduction is floored, and a transfer can only leave SENT once.
 */
class InMemoryTransfers implements StockTransferRepository {
  rows: StockTransferRecord[] = [];
  constructor(private readonly inventory: InMemoryInventoryRepository) {}

  async send(data: SendTransferData): Promise<StockTransferRecord> {
    const item = this.inventory.items.find((i) => i.id === data.fromItemId)!;
    if (item.quantity - data.quantity < 0) throw new Error('floored');
    item.quantity -= data.quantity;
    this.inventory.moves.push({
      id: randomUUID(),
      itemId: item.id,
      type: StockMovementType.TRANSFER_OUT,
      delta: -data.quantity,
      quantityBefore: item.quantity + data.quantity,
      quantityAfter: item.quantity,
      reason: `Transfer ${data.reference}`,
      actorId: data.sentBy,
      orderId: null,
      createdAt: new Date(),
    });
    const row: StockTransferRecord = {
      id: randomUUID(),
      reference: data.reference,
      fromDepotId: data.fromDepotId,
      toDepotId: data.toDepotId,
      productId: data.productId,
      label: data.label,
      unit: data.unit,
      quantity: data.quantity,
      status: StockTransferStatus.SENT,
      note: data.note,
      sentBy: data.sentBy,
      sentAt: new Date(),
      receivedBy: null,
      receivedAt: null,
      cancelReason: null,
    };
    this.rows.push(row);
    return { ...row };
  }

  private claim(id: string): StockTransferRecord | null {
    const row = this.rows.find((r) => r.id === id);
    return row && row.status === StockTransferStatus.SENT ? row : null;
  }

  async receive(id: string, toItemId: string, receivedBy: string) {
    const row = this.claim(id);
    if (!row) return null;
    row.status = StockTransferStatus.RECEIVED;
    row.receivedBy = receivedBy;
    row.receivedAt = new Date();
    const item = this.inventory.items.find((i) => i.id === toItemId)!;
    item.quantity += row.quantity;
    this.inventory.moves.push({
      id: randomUUID(),
      itemId: item.id,
      type: StockMovementType.TRANSFER_IN,
      delta: row.quantity,
      quantityBefore: item.quantity - row.quantity,
      quantityAfter: item.quantity,
      reason: `Transfer ${row.reference}`,
      actorId: receivedBy,
      orderId: null,
      createdAt: new Date(),
    });
    return { ...row };
  }

  async cancel(id: string, fromItemId: string, reason: string, actorId: string) {
    const row = this.claim(id);
    if (!row) return null;
    row.status = StockTransferStatus.CANCELLED;
    row.cancelReason = reason;
    const item = this.inventory.items.find((i) => i.id === fromItemId)!;
    item.quantity += row.quantity;
    this.inventory.moves.push({
      id: randomUUID(),
      itemId: item.id,
      type: StockMovementType.TRANSFER_IN,
      delta: row.quantity,
      quantityBefore: item.quantity - row.quantity,
      quantityAfter: item.quantity,
      reason: `Transfer ${row.reference} dibatalkan: ${reason}`,
      actorId,
      orderId: null,
      createdAt: new Date(),
    });
    return { ...row };
  }

  async findById(id: string) {
    const row = this.rows.find((r) => r.id === id);
    return row ? { ...row } : null;
  }

  async list(query: TransferQuery) {
    return this.rows
      .filter((r) =>
        query.direction === 'in' ? r.toDepotId === query.depotId : r.fromDepotId === query.depotId,
      )
      .filter((r) => !query.status || r.status === query.status)
      .slice(0, query.limit)
      .map((r) => ({ ...r }));
  }

  async countSentOn() {
    return this.rows.length;
  }
}

function build(quantity = 20, reserved = 0) {
  const inventory = new InMemoryInventoryRepository();
  inventory.items.push({
    id: randomUUID(),
    depotId: DEPOT_A,
    itemType: InventoryItemType.PRODUK,
    productId: PRODUCT,
    label: 'Galon 19L',
    unit: 'galon',
    quantity,
    reserved,
    minimumStock: 0,
    sellPrice: null,
    hidden: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const transfers = new InMemoryTransfers(inventory);
  const config = { businessTimeZone: 'Asia/Jakarta' } as DepotConfigService;
  return {
    inventory,
    transfers,
    svc: new StockTransferService(transfers, inventory, config),
    source: () => inventory.items.find((i) => i.depotId === DEPOT_A)!,
    dest: () => inventory.items.find((i) => i.depotId === DEPOT_B),
  };
}

const SEND = { fromDepotId: DEPOT_A, toDepotId: DEPOT_B, productId: PRODUCT, quantity: 5 };

describe('CA-2-54 stock transfer between depots', () => {
  it('deducts the sender the moment it is dispatched — they no longer have it', async () => {
    const ctx = build(20);
    const transfer = await ctx.svc.send(atA, atA.sub, SEND);

    expect(transfer.status).toBe(StockTransferStatus.SENT);
    expect(ctx.source().quantity).toBe(15);
    // And nothing has arrived anywhere yet: the goods are on a bike.
    expect(ctx.dest()).toBeUndefined();
    expect(ctx.inventory.moves.map((m) => m.type)).toEqual([StockMovementType.TRANSFER_OUT]);
  });

  it('credits the receiver only when somebody there counts it', async () => {
    const ctx = build(20);
    const sent = await ctx.svc.send(atA, atA.sub, SEND);

    const received = await ctx.svc.receive(atB, atB.sub, sent.id);

    expect(received.status).toBe(StockTransferStatus.RECEIVED);
    expect(received.receivedBy).toBe(atB.sub);
    expect(ctx.dest()?.quantity).toBe(5);
    // Both books balance: five left one depot, five arrived at the other.
    expect(ctx.source().quantity).toBe(15);
    expect(ctx.inventory.moves.map((m) => m.type)).toEqual([
      StockMovementType.TRANSFER_OUT,
      StockMovementType.TRANSFER_IN,
    ]);
  });

  it('opens a line at a depot that has never stocked the product', async () => {
    const ctx = build(20);
    const sent = await ctx.svc.send(atA, atA.sub, SEND);

    await ctx.svc.receive(atB, atB.sub, sent.id);

    // Label and unit come from what the sender counted out, so the line still reads
    // correctly even after the catalog renames the product.
    expect(ctx.dest()).toMatchObject({ label: 'Galon 19L', unit: 'galon', quantity: 5 });
  });

  /*
   * `reserved` is stock already promised to orders this depot has taken. Shipping it away
   * would turn somebody's paid order into a shortfall at the depot that promised it.
   */
  it('will not send stock that is already promised to an order', async () => {
    const ctx = build(20, 18);

    await expect(ctx.svc.send(atA, atA.sub, SEND)).rejects.toBeInstanceOf(InsufficientStockError);
    expect(ctx.source().quantity).toBe(20);
    expect(ctx.transfers.rows).toHaveLength(0);
  });

  it('puts the stock back at the sender when it never arrives', async () => {
    const ctx = build(20);
    const sent = await ctx.svc.send(atA, atA.sub, SEND);

    const cancelled = await ctx.svc.cancel(atA, atA.sub, sent.id, 'Motor mogok');

    expect(cancelled.status).toBe(StockTransferStatus.CANCELLED);
    expect(ctx.source().quantity).toBe(20);
    expect(ctx.dest()).toBeUndefined();
  });

  // Two people pressing "received" at once must produce ONE credit, not two.
  it('credits once when the same transfer is received twice', async () => {
    const ctx = build(20);
    const sent = await ctx.svc.send(atA, atA.sub, SEND);
    await ctx.svc.receive(atB, atB.sub, sent.id);

    await expect(ctx.svc.receive(atB, atB.sub, sent.id)).rejects.toBeInstanceOf(
      TransferNotPendingError,
    );
    expect(ctx.dest()?.quantity).toBe(5);
  });

  /*
   * The check above catches the ordinary second press, because by then the row reads
   * RECEIVED. This is the other one: two receives interleaved so closely that BOTH read
   * SENT, and only the database can break the tie. The repository claims the row in the
   * same statement it credits, so the loser is handed null — and the service must report
   * that as "already handled" rather than quietly answering success.
   */
  it('refuses when the database awards the receive to somebody else', async () => {
    const ctx = build(20);
    const sent = await ctx.svc.send(atA, atA.sub, SEND);
    ctx.transfers.receive = async () => null;

    await expect(ctx.svc.receive(atB, atB.sub, sent.id)).rejects.toBeInstanceOf(
      TransferNotPendingError,
    );
  });

  it('refuses a cancel the database awards to somebody else', async () => {
    const ctx = build(20);
    const sent = await ctx.svc.send(atA, atA.sub, SEND);
    ctx.transfers.cancel = async () => null;

    await expect(ctx.svc.cancel(atA, atA.sub, sent.id, 'motor mogok')).rejects.toBeInstanceOf(
      TransferNotPendingError,
    );
  });

  it('cannot be cancelled after it has been received', async () => {
    const ctx = build(20);
    const sent = await ctx.svc.send(atA, atA.sub, SEND);
    await ctx.svc.receive(atB, atB.sub, sent.id);

    await expect(ctx.svc.cancel(atA, atA.sub, sent.id, 'terlambat')).rejects.toBeInstanceOf(
      TransferNotPendingError,
    );
    // The stock stays where it landed, rather than existing at both depots at once.
    expect(ctx.source().quantity).toBe(15);
    expect(ctx.dest()?.quantity).toBe(5);
  });

  describe('who may do what', () => {
    it('lets only the sending depot give stock away', async () => {
      const ctx = build(20);
      await expect(ctx.svc.send(atB, atB.sub, SEND)).rejects.toThrow();
      expect(ctx.source().quantity).toBe(20);
    });

    it('lets only the receiving depot say it arrived', async () => {
      const ctx = build(20);
      const sent = await ctx.svc.send(atA, atA.sub, SEND);
      // The sender cannot count stock they cannot see.
      await expect(ctx.svc.receive(atA, atA.sub, sent.id)).rejects.toThrow();
    });

    it('lets only the sending depot take it back', async () => {
      const ctx = build(20);
      const sent = await ctx.svc.send(atA, atA.sub, SEND);
      await expect(ctx.svc.cancel(atB, atB.sub, sent.id, 'salah kirim')).rejects.toThrow();
    });

    it('scopes both queues to the depot that asks', async () => {
      const ctx = build(20);
      await ctx.svc.send(atA, atA.sub, SEND);

      expect(await ctx.svc.list(atA, DEPOT_A, 'out')).toHaveLength(1);
      expect(await ctx.svc.list(atB, DEPOT_B, 'in')).toHaveLength(1);
      expect(await ctx.svc.list(atA, DEPOT_A, 'in')).toHaveLength(0);
      await expect(ctx.svc.list(atB, DEPOT_A, 'out')).rejects.toThrow();
    });
  });

  describe('refusals', () => {
    it('refuses a depot sending to itself', async () => {
      const ctx = build(20);
      await expect(
        ctx.svc.send(atA, atA.sub, { ...SEND, toDepotId: DEPOT_A }),
      ).rejects.toBeInstanceOf(TransferSameDepotError);
    });

    it('refuses a product this depot does not stock', async () => {
      const ctx = build(20);
      await expect(
        ctx.svc.send(atA, atA.sub, { ...SEND, productId: randomUUID() }),
      ).rejects.toBeInstanceOf(InventoryItemNotFoundError);
    });

    it('404s a transfer that does not exist', async () => {
      const ctx = build(20);
      await expect(ctx.svc.receive(hq, hq.sub, randomUUID())).rejects.toBeInstanceOf(
        TransferNotFoundError,
      );
    });

    it('refuses to cancel when the sending line has been deleted meanwhile', async () => {
      const ctx = build(20);
      const sent = await ctx.svc.send(atA, atA.sub, SEND);
      ctx.inventory.items.length = 0;
      await expect(ctx.svc.cancel(atA, atA.sub, sent.id, 'hilang')).rejects.toBeInstanceOf(
        InventoryItemNotFoundError,
      );
    });
  });

  it('numbers each transfer readably, by the day it left', async () => {
    const ctx = build(20);
    const first = await ctx.svc.send(atA, atA.sub, SEND);
    const second = await ctx.svc.send(atA, atA.sub, SEND);

    expect(first.reference).toMatch(/^TRF-\d{6}-0001$/);
    expect(second.reference).toMatch(/^TRF-\d{6}-0002$/);
  });
});
