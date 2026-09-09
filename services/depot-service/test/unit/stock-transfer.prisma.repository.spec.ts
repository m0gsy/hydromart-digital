import { NegativeStockError } from '../../src/domain/errors';
import { StockMovementType } from '../../src/domain/inventory';
import { StockTransferStatus } from '../../src/domain/stock-transfer';
import { StockTransferPrismaRepository } from '../../src/infrastructure/prisma/stock-transfer.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * CA-2-54 — the two writes that must never disagree.
 *
 * Each method here is one transaction on purpose. Deducting stock and then failing to write
 * the transfer row would be stock that vanished; writing the row and failing to deduct would
 * be stock counted in two depots at once. These tests pin the parts that make that true: the
 * floor inside the UPDATE, and the single claim on the status.
 */

function build() {
  const stockTransfer = {
    create: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  };
  const stockMovement = { create: jest.fn() };
  const $queryRaw = jest.fn();
  const $transaction = jest
    .fn()
    .mockImplementation((arg) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
  const prisma = {
    stockTransfer,
    stockMovement,
    $queryRaw,
    $transaction,
  } as unknown as PrismaService;
  return {
    prisma,
    stockTransfer,
    stockMovement,
    $queryRaw,
    repo: new StockTransferPrismaRepository(prisma),
  };
}

const SEND = {
  reference: 'TRF-260909-0001',
  fromItemId: '11111111-1111-4111-8111-111111111111',
  fromDepotId: 'depot-a',
  toDepotId: 'depot-b',
  productId: 'prod-1',
  label: 'Galon 19L',
  unit: 'galon',
  quantity: 5,
  note: null,
  sentBy: 'staff-1',
};

const ROW = {
  id: 'trf-1',
  reference: SEND.reference,
  fromDepotId: 'depot-a',
  toDepotId: 'depot-b',
  productId: 'prod-1',
  label: 'Galon 19L',
  unit: 'galon',
  quantity: 5,
  status: StockTransferStatus.SENT,
  note: null,
  sentBy: 'staff-1',
  sentAt: new Date('2026-09-09T01:00:00.000Z'),
  receivedBy: null,
  receivedAt: null,
  cancelReason: null,
};

describe('CA-2-54 StockTransferPrismaRepository', () => {
  it('deducts with the floor in the UPDATE, then writes the movement and the transfer', async () => {
    const ctx = build();
    ctx.$queryRaw.mockResolvedValue([{ id: SEND.fromItemId, quantity: 15 }]);
    ctx.stockTransfer.create.mockResolvedValue(ROW);

    const out = await ctx.repo.send(SEND);

    expect(out.status).toBe(StockTransferStatus.SENT);
    // The arithmetic and the floor live in the statement, not in Node: a sale landing
    // between the service's check and this write cannot take the line below zero.
    const sql = (ctx.$queryRaw.mock.calls[0]?.[0] as { strings: string[] }).strings.join('?');
    expect(sql).toContain('"quantity" - ');
    expect(sql).toContain('>= 0');
    expect(ctx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: StockMovementType.TRANSFER_OUT,
          delta: -5,
          quantityBefore: 20,
          quantityAfter: 15,
        }),
      }),
    );
  });

  it('writes nothing at all when the floor refuses the deduction', async () => {
    const ctx = build();
    ctx.$queryRaw.mockResolvedValue([]);

    await expect(ctx.repo.send(SEND)).rejects.toBeInstanceOf(NegativeStockError);
    expect(ctx.stockMovement.create).not.toHaveBeenCalled();
    expect(ctx.stockTransfer.create).not.toHaveBeenCalled();
  });

  /*
   * The status is claimed with a WHERE on SENT, so two receivers pressing at once produce
   * ONE credit: the loser updates no row and is handed null.
   */
  it('claims the row on SENT before crediting anything', async () => {
    const ctx = build();
    ctx.stockTransfer.updateMany.mockResolvedValue({ count: 1 });
    ctx.stockTransfer.findUnique.mockResolvedValue(ROW);
    ctx.$queryRaw.mockResolvedValue([{ id: 'item-b', quantity: 5 }]);

    const out = await ctx.repo.receive('trf-1', 'item-b', 'staff-2');

    expect(out?.status).toBe(StockTransferStatus.SENT);
    expect(ctx.stockTransfer.updateMany).toHaveBeenCalledWith({
      where: { id: 'trf-1', status: StockTransferStatus.SENT },
      data: expect.objectContaining({ status: StockTransferStatus.RECEIVED, receivedBy: 'staff-2' }),
    });
    expect(ctx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: StockMovementType.TRANSFER_IN, delta: 5 }),
      }),
    );
  });

  it('credits nothing when somebody else claimed it first', async () => {
    const ctx = build();
    ctx.stockTransfer.updateMany.mockResolvedValue({ count: 0 });

    await expect(ctx.repo.receive('trf-1', 'item-b', 'staff-2')).resolves.toBeNull();
    expect(ctx.$queryRaw).not.toHaveBeenCalled();
    expect(ctx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('puts the stock back at the sender on cancel, under the same single claim', async () => {
    const ctx = build();
    ctx.stockTransfer.updateMany.mockResolvedValue({ count: 1 });
    ctx.stockTransfer.findUnique.mockResolvedValue(ROW);
    ctx.$queryRaw.mockResolvedValue([{ id: SEND.fromItemId, quantity: 20 }]);

    await ctx.repo.cancel('trf-1', SEND.fromItemId, 'Motor mogok', 'staff-1');

    expect(ctx.stockTransfer.updateMany).toHaveBeenCalledWith({
      where: { id: 'trf-1', status: StockTransferStatus.SENT },
      data: { status: StockTransferStatus.CANCELLED, cancelReason: 'Motor mogok' },
    });
    expect(ctx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: StockMovementType.TRANSFER_IN, delta: 5 }),
      }),
    );
  });

  it('returns nothing to cancel when it is no longer in transit', async () => {
    const ctx = build();
    ctx.stockTransfer.updateMany.mockResolvedValue({ count: 0 });
    await expect(ctx.repo.cancel('trf-1', 'item-a', 'x', 'staff-1')).resolves.toBeNull();
    expect(ctx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('reads each queue from the side that asks', async () => {
    const ctx = build();
    ctx.stockTransfer.findMany.mockResolvedValue([ROW]);

    await ctx.repo.list({ depotId: 'depot-b', direction: 'in', limit: 50 });
    expect(ctx.stockTransfer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { toDepotId: 'depot-b' } }),
    );

    await ctx.repo.list({
      depotId: 'depot-a',
      direction: 'out',
      status: StockTransferStatus.SENT,
      limit: 10,
    });
    expect(ctx.stockTransfer.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { fromDepotId: 'depot-a', status: StockTransferStatus.SENT },
        take: 10,
      }),
    );
  });

  it('counts the day so far, to number the next transfer', async () => {
    const ctx = build();
    ctx.stockTransfer.count.mockResolvedValue(3);
    await expect(ctx.repo.countSentOn('2026-09-09')).resolves.toBe(3);
  });

  it('fails the receive when the destination line vanished mid-transaction', async () => {
    const ctx = build();
    ctx.stockTransfer.updateMany.mockResolvedValue({ count: 1 });
    ctx.stockTransfer.findUnique.mockResolvedValue(ROW);
    ctx.$queryRaw.mockResolvedValue([]);

    await expect(ctx.repo.receive('trf-1', 'item-b', 'staff-2')).rejects.toBeInstanceOf(
      NegativeStockError,
    );
  });

  it('fails the cancel when the sending line vanished mid-transaction', async () => {
    const ctx = build();
    ctx.stockTransfer.updateMany.mockResolvedValue({ count: 1 });
    ctx.stockTransfer.findUnique.mockResolvedValue(ROW);
    ctx.$queryRaw.mockResolvedValue([]);

    await expect(ctx.repo.cancel('trf-1', 'item-a', 'x', 'staff-1')).rejects.toBeInstanceOf(
      NegativeStockError,
    );
  });

  it('reads one transfer, or nothing', async () => {
    const ctx = build();
    ctx.stockTransfer.findUnique.mockResolvedValueOnce(ROW).mockResolvedValueOnce(null);
    await expect(ctx.repo.findById('trf-1')).resolves.toMatchObject({ id: 'trf-1' });
    await expect(ctx.repo.findById('nope')).resolves.toBeNull();
  });
});
