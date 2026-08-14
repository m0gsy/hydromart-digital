import { PaymentPrismaRepository } from '../../src/infrastructure/prisma/payment.prisma.repository';
import { TaxSettingsPrismaRepository } from '../../src/infrastructure/prisma/tax-settings.prisma.repository';
import { PaymentMethod, PaymentStatus, RefundApproval } from '../../src/domain/payment';
import { TaxRounding } from '../../src/domain/tax';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

// Prisma returns Decimal instances for money columns; the repos only rely on toNumber().
const dec = (n: number) => ({ toNumber: () => n });

// A fully-populated row exercises every non-null money branch of toRecord.
const fullRow = () => ({
  id: 'pay-1',
  orderId: 'order-1',
  customerId: 'cust-1',
  method: 'CASH',
  status: 'PAID',
  amount: dec(18000),
  reference: 'ref-1',
  instruction: 'pay at depot',
  gatewayData: '{"x":1}',
  paidAt: new Date('2026-01-02'),
  failedAt: null,
  refundedAt: new Date('2026-01-03'),
  refundReason: 'spoiled',
  refundedAmount: dec(5000),
  refundApproval: 'APPROVED',
  cashReceived: dec(20000),
  changeGiven: dec(2000),
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-04'),
});

// A row where all optional money columns are null exercises the null branches.
const sparseRow = () => ({
  ...fullRow(),
  refundedAmount: null,
  cashReceived: null,
  changeGiven: null,
  refundApproval: 'NONE',
});

describe('PaymentPrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
    aggregate: jest.fn(),
    update: jest.fn(),
  };
  const prisma = { payment: model } as unknown as PrismaService;
  const repo = new PaymentPrismaRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  const createData = {
    orderId: 'order-1',
    customerId: 'cust-1',
    method: PaymentMethod.CASH,
    amount: 18000,
    reference: null,
    instruction: null,
    gatewayData: null,
  };

  it('create passes data through and maps every money field', async () => {
    model.create.mockResolvedValue(fullRow());
    const record = await repo.create(createData);
    expect(model.create).toHaveBeenCalledWith({ data: createData });
    expect(record.amount).toBe(18000);
    expect(record.refundedAmount).toBe(5000);
    expect(record.cashReceived).toBe(20000);
    expect(record.changeGiven).toBe(2000);
    expect(record.status).toBe(PaymentStatus.PAID);
    expect(record.refundApproval).toBe(RefundApproval.APPROVED);
  });

  it('maps null money columns to null', async () => {
    model.findUnique.mockResolvedValue(sparseRow());
    const record = await repo.findById('pay-1');
    expect(record?.refundedAmount).toBeNull();
    expect(record?.cashReceived).toBeNull();
    expect(record?.changeGiven).toBeNull();
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'pay-1' } });
  });

  it('findById returns null when the row is missing', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('nope')).toBeNull();
  });

  it('findActiveByOrder filters to PENDING/PAID, newest first', async () => {
    model.findFirst.mockResolvedValue(fullRow());
    const record = await repo.findActiveByOrder('order-1');
    expect(record?.id).toBe('pay-1');
    expect(model.findFirst).toHaveBeenCalledWith({
      where: { orderId: 'order-1', status: { in: [PaymentStatus.PENDING, PaymentStatus.PAID] } },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('findActiveByOrder returns null when none active', async () => {
    model.findFirst.mockResolvedValue(null);
    expect(await repo.findActiveByOrder('order-1')).toBeNull();
  });

  it('findByReference queries by reference and maps / returns null', async () => {
    model.findFirst.mockResolvedValue(fullRow());
    expect((await repo.findByReference('ref-1'))?.id).toBe('pay-1');
    expect(model.findFirst).toHaveBeenCalledWith({ where: { reference: 'ref-1' } });
    model.findFirst.mockResolvedValue(null);
    expect(await repo.findByReference('ref-x')).toBeNull();
  });

  it('search builds the where from provided filters and paginates', async () => {
    model.findMany.mockResolvedValue([fullRow(), sparseRow()]);
    model.count.mockResolvedValue(2);
    const result = await repo.search({
      customerId: 'cust-1',
      orderId: 'order-1',
      status: PaymentStatus.PAID,
      page: 2,
      limit: 10,
    });
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', orderId: 'order-1', status: PaymentStatus.PAID },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
    });
    expect(model.count).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', orderId: 'order-1', status: PaymentStatus.PAID },
    });
  });

  it('search omits absent filters (empty where)', async () => {
    model.findMany.mockResolvedValue([]);
    model.count.mockResolvedValue(0);
    const out = await repo.search({ page: 1, limit: 20 });
    expect(model.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
    });
    expect(out.nextCursor).toBeNull();
  });

  it('search seeks past a cursor rather than an offset (audit Q-16)', async () => {
    model.findMany.mockResolvedValue([fullRow()]);
    model.count.mockResolvedValue(900);
    const out = await repo.search({ page: 30, limit: 1, cursor: 'pay-0' });
    expect(model.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: 'pay-0' }, skip: 1, take: 1 }),
    );
    expect(out.nextCursor).toBe(out.items[0].id);
  });

  it('listPendingRefunds filters on PENDING approval, newest updated first', async () => {
    model.findMany.mockResolvedValue([fullRow()]);
    model.count.mockResolvedValue(1);
    const result = await repo.listPendingRefunds({ page: 1, limit: 5 });
    expect(result.total).toBe(1);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { refundApproval: RefundApproval.PENDING },
      orderBy: { updatedAt: 'desc' },
      skip: 0,
      take: 5,
    });
  });

  it('aggregateUnsettledByMethod groups PENDING with a date range and maps sums', async () => {
    model.groupBy.mockResolvedValue([
      { method: 'CASH', _sum: { amount: 30000 }, _count: { _all: 3 } },
      { method: 'QRIS', _sum: { amount: null }, _count: { _all: 0 } },
    ]);
    const from = new Date('2026-01-01');
    const to = new Date('2026-01-31');
    const out = await repo.aggregateUnsettledByMethod({ from, to });
    expect(model.groupBy).toHaveBeenCalledWith({
      by: ['method'],
      where: { status: PaymentStatus.PENDING, createdAt: { gte: from, lte: to } },
      _sum: { amount: true },
      _count: { _all: true },
    });
    expect(out).toEqual([
      { method: PaymentMethod.CASH, amount: 30000, count: 3 },
      { method: PaymentMethod.QRIS, amount: 0, count: 0 },
    ]);
  });

  it('aggregateUnsettledByMethod omits createdAt when range is empty', async () => {
    model.groupBy.mockResolvedValue([]);
    await repo.aggregateUnsettledByMethod({});
    expect(model.groupBy).toHaveBeenCalledWith({
      by: ['method'],
      where: { status: PaymentStatus.PENDING },
      _sum: { amount: true },
      _count: { _all: true },
    });
  });

  it('aggregateRevenueByMethod groups PAID with a one-sided range', async () => {
    model.groupBy.mockResolvedValue([
      { method: 'CASH', _sum: { amount: 90000 }, _count: { _all: 5 } },
    ]);
    const from = new Date('2026-02-01');
    const out = await repo.aggregateRevenueByMethod({ from });
    expect(model.groupBy).toHaveBeenCalledWith({
      by: ['method'],
      where: { status: PaymentStatus.PAID, createdAt: { gte: from } },
      _sum: { amount: true },
      _count: { _all: true },
    });
    expect(out).toEqual([{ method: PaymentMethod.CASH, amount: 90000, count: 5 }]);
  });

  it('sumCashCollected short-circuits on an empty order set', async () => {
    const summary = await repo.sumCashCollected([]);
    expect(summary).toEqual({ total: 0, count: 0 });
    expect(model.aggregate).not.toHaveBeenCalled();
  });

  it('sumCashCollected aggregates PAID cash over the given orders', async () => {
    model.aggregate.mockResolvedValue({ _sum: { amount: 54000 }, _count: { _all: 3 } });
    const summary = await repo.sumCashCollected(['order-1', 'order-2']);
    expect(summary).toEqual({ total: 54000, count: 3 });
    expect(model.aggregate).toHaveBeenCalledWith({
      where: {
        orderId: { in: ['order-1', 'order-2'] },
        method: PaymentMethod.CASH,
        status: PaymentStatus.PAID,
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
  });

  it('sumCashCollected coerces a null sum to zero', async () => {
    model.aggregate.mockResolvedValue({ _sum: { amount: null }, _count: { _all: 0 } });
    expect(await repo.sumCashCollected(['order-1'])).toEqual({ total: 0, count: 0 });
  });

  // S2. The daily report needs the split by courier, and the courier is on the ORDER —
  // so one summed total cannot answer it, however many times you ask.
  it('cashByOrder short-circuits on an empty order set', async () => {
    expect(await repo.cashByOrder([])).toEqual([]);
    expect(model.groupBy).not.toHaveBeenCalled();
  });

  it('cashByOrder groups PAID cash per order and drops orders with none', async () => {
    model.groupBy.mockResolvedValue([{ orderId: 'order-1', _sum: { amount: 40000 } }]);
    const rows = await repo.cashByOrder(['order-1', 'order-2']);
    expect(model.groupBy).toHaveBeenCalledWith({
      by: ['orderId'],
      where: {
        orderId: { in: ['order-1', 'order-2'] },
        method: PaymentMethod.CASH,
        status: PaymentStatus.PAID,
      },
      _sum: { amount: true },
    });
    // order-2 is absent, not zero: it simply has no PAID cash row.
    expect(rows).toEqual([{ orderId: 'order-1', amountIdr: 40000 }]);
  });

  it('cashByOrder coerces a null group sum to zero', async () => {
    model.groupBy.mockResolvedValue([{ orderId: 'order-1', _sum: { amount: null } }]);
    expect(await repo.cashByOrder(['order-1'])).toEqual([{ orderId: 'order-1', amountIdr: 0 }]);
  });

  // Bounded by paidAt, not createdAt: a sale rung up before the shift but settled during it
  // is cash this cashier is holding, and their count has to include it.
  it('sumDepotCash aggregates one depot PAID cash by settlement time', async () => {
    const from = new Date('2026-08-03T01:00:00.000Z');
    const to = new Date('2026-08-03T09:00:00.000Z');
    model.aggregate.mockResolvedValue({ _sum: { amount: 1_250_000 }, _count: { _all: 9 } });

    expect(await repo.sumDepotCash('depot-1', { from, to })).toEqual({ total: 1_250_000, count: 9 });
    expect(model.aggregate).toHaveBeenCalledWith({
      where: {
        depotId: 'depot-1',
        method: PaymentMethod.CASH,
        status: PaymentStatus.PAID,
        paidAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
  });

  it('sumDepotCash reports zero for a depot that took nothing', async () => {
    model.aggregate.mockResolvedValue({ _sum: { amount: null }, _count: { _all: 0 } });
    expect(await repo.sumDepotCash('depot-1', {})).toEqual({ total: 0, count: 0 });
  });

  it('update applies the patch and returns the mapped row', async () => {
    model.update.mockResolvedValue(fullRow());
    const patch = {
      status: PaymentStatus.PAID,
      paidAt: new Date('2026-01-02'),
      cashReceived: 20000,
    };
    const record = await repo.update('pay-1', patch);
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'pay-1' }, data: patch });
    expect(record.status).toBe(PaymentStatus.PAID);
    expect(record.cashReceived).toBe(20000);
  });
});

describe('TaxSettingsPrismaRepository', () => {
  const model = {
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  };
  const prisma = { taxSettings: model } as unknown as PrismaService;
  const repo = new TaxSettingsPrismaRepository(prisma);

  const taxRow = () => ({
    id: 'tax-1',
    ppnPercent: dec(11),
    priceIncludesTax: true,
    taxRounding: 'HALF_UP',
    invoiceFormat: 'INV-{seq}',
    companyName: 'Hydromart',
    npwp: '00.000.000.0-000.000',
    address: 'Jakarta',
    updatedAt: new Date('2026-01-01'),
  });

  const input = {
    ppnPercent: 11,
    priceIncludesTax: true,
    taxRounding: TaxRounding.HALF_UP,
    invoiceFormat: 'INV-{seq}',
    companyName: 'Hydromart',
    npwp: '00.000.000.0-000.000',
    address: 'Jakarta',
  };

  beforeEach(() => jest.clearAllMocks());

  it('get returns the newest row mapped, decimal to number', async () => {
    model.findFirst.mockResolvedValue(taxRow());
    const record = await repo.get();
    expect(record?.ppnPercent).toBe(11);
    expect(record?.taxRounding).toBe(TaxRounding.HALF_UP);
    expect(record?.companyName).toBe('Hydromart');
    expect(model.findFirst).toHaveBeenCalledWith({ orderBy: { updatedAt: 'desc' } });
  });

  it('get returns null when no settings exist', async () => {
    model.findFirst.mockResolvedValue(null);
    expect(await repo.get()).toBeNull();
  });

  it('upsert updates the existing singleton row', async () => {
    model.findFirst.mockResolvedValue({ id: 'tax-1' });
    model.update.mockResolvedValue(taxRow());
    const record = await repo.upsert(input);
    expect(model.update).toHaveBeenCalledWith({ where: { id: 'tax-1' }, data: input });
    expect(model.create).not.toHaveBeenCalled();
    expect(record.ppnPercent).toBe(11);
  });

  it('upsert creates the first row when none exists', async () => {
    model.findFirst.mockResolvedValue(null);
    model.create.mockResolvedValue(taxRow());
    const record = await repo.upsert(input);
    expect(model.create).toHaveBeenCalledWith({ data: input });
    expect(model.update).not.toHaveBeenCalled();
    expect(record.ppnPercent).toBe(11);
  });
});
