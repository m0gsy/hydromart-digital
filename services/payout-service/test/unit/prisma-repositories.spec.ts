import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { WithdrawalPrismaRepository } from '../../src/infrastructure/prisma/withdrawal.prisma.repository';
import { CommissionSchemePrismaRepository } from '../../src/infrastructure/prisma/commission-scheme.prisma.repository';
import { LedgerPrismaRepository } from '../../src/infrastructure/prisma/ledger.prisma.repository';
import { CourierWithdrawalPrismaRepository } from '../../src/infrastructure/prisma/courier-withdrawal.prisma.repository';
import { ExpenseClaimPrismaRepository } from '../../src/infrastructure/prisma/expense-claim.prisma.repository';
import { CourierLedgerPrismaRepository } from '../../src/infrastructure/prisma/courier-ledger.prisma.repository';

// B-8: the balance check and the two writes used to be three independent statements on
// two connections, so an owner could overdraw by sending requests at once and a crash
// between the writes left a PROCESSING payout with the balance untouched. These assert the
// contract the transaction provides; only real Postgres can prove the advisory lock
// serializes, which is what the integration concurrency proofs are for.
describe('WithdrawalPrismaRepository.withdrawWithDebit', () => {
  const withdrawal = { create: jest.fn() };
  const ledgerEntry = { aggregate: jest.fn(), create: jest.fn() };
  const $executeRaw = jest.fn();
  const prisma = {
    withdrawal,
    ledgerEntry,
    $executeRaw,
    $transaction: jest.fn((fn) => fn({ withdrawal, ledgerEntry, $executeRaw })),
  } as unknown as PrismaService;
  const repo = new WithdrawalPrismaRepository(prisma);

  const input = {
    franchiseOwnerId: 'own-1',
    amount: 500,
    bankAccountRef: 'BCA',
    reference: 'WD-1',
    status: 'PROCESSING' as const,
    description: 'Pencairan saldo · WD-1',
  };

  beforeEach(() => jest.clearAllMocks());


  it('takes a lock keyed on the owner before reading the balance', async () => {
    ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 500 } });
    withdrawal.create.mockResolvedValue({
      id: 'w', franchiseOwnerId: 'own-1', amount: '500', bankAccountRef: 'BCA',
      status: 'PROCESSING', reference: 'WD-1', createdAt: new Date(), updatedAt: new Date(),
    });
    await repo.withdrawWithDebit(input);
    expect($executeRaw).toHaveBeenCalled();
    // Reading the balance before the lock is the bug; order is the whole fix.
    expect($executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      ledgerEntry.aggregate.mock.invocationCallOrder[0],
    );
  });

  it('writes the withdrawal and its debit in the same transaction', async () => {
    ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 1000 } });
    withdrawal.create.mockResolvedValue({
      id: 'w', franchiseOwnerId: 'own-1', amount: '500', bankAccountRef: 'BCA',
      status: 'PROCESSING', reference: 'WD-1', createdAt: new Date(), updatedAt: new Date(),
    });

    const out = await repo.withdrawWithDebit(input);

    expect(out.ok).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(ledgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'WITHDRAWAL', amount: -500 }),
    });
  });

  it('writes nothing at all when the balance is short', async () => {
    ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 100 } });

    const out = await repo.withdrawWithDebit(input);

    expect(out).toEqual({ ok: false, balance: 100 });
    expect(withdrawal.create).not.toHaveBeenCalled();
    expect(ledgerEntry.create).not.toHaveBeenCalled();
  });

  it('treats an empty ledger as a zero balance rather than throwing', async () => {
    ledgerEntry.aggregate.mockResolvedValue({ _sum: { amount: null } });
    const out = await repo.withdrawWithDebit(input);
    expect(out).toEqual({ ok: false, balance: 0 });
  });
});

describe('WithdrawalPrismaRepository', () => {
  const model = { create: jest.fn(), findMany: jest.fn() };
  const prisma = { withdrawal: model } as unknown as PrismaService;
  const repo = new WithdrawalPrismaRepository(prisma);

  const row = {
    id: 'wd-1',
    franchiseOwnerId: 'own-1',
    amount: '150000.50', // Prisma Decimal-ish
    bankAccountRef: 'BCA-123',
    status: 'PENDING',
    reference: 'WD-REF-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates a withdrawal and maps the Decimal amount to a number', async () => {
    model.create.mockResolvedValue(row);
    const data = {
      franchiseOwnerId: 'own-1',
      amount: 150000.5,
      bankAccountRef: 'BCA-123',
      reference: 'WD-REF-1',
    };
    const result = await repo.create(data as never);
    expect(model.create).toHaveBeenCalledWith({ data });
    expect(result.amount).toBe(150000.5);
    expect(typeof result.amount).toBe('number');
    expect(result.status).toBe('PENDING');
    expect(result.id).toBe('wd-1');
  });

  it('lists withdrawals for an owner ordered by createdAt desc with take limit', async () => {
    model.findMany.mockResolvedValue([row, { ...row, id: 'wd-2', amount: '0' }]);
    const results = await repo.listForOwner('own-1', 25);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { franchiseOwnerId: 'own-1' },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    expect(results).toHaveLength(2);
    expect(results[1].amount).toBe(0);
  });

  it('returns empty array when owner has no withdrawals', async () => {
    model.findMany.mockResolvedValue([]);
    expect(await repo.listForOwner('own-x', 10)).toEqual([]);
  });
});

describe('CommissionSchemePrismaRepository', () => {
  const model = { findMany: jest.fn(), create: jest.fn() };
  const $transaction = jest.fn();
  const prisma = { commissionScheme: model, $transaction } as unknown as PrismaService;
  const repo = new CommissionSchemePrismaRepository(prisma);

  const row = {
    id: 'sch-1',
    depotId: 'dep-1',
    ownerName: 'Pak Budi',
    pct: '12.5',
    effectiveDate: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('lists current schemes DISTINCT ON depotId newest first, mapping pct to number', async () => {
    model.findMany.mockResolvedValue([row]);
    const results = await repo.listCurrent();
    expect(model.findMany).toHaveBeenCalledWith({
      orderBy: [{ depotId: 'asc' }, { effectiveDate: 'desc' }],
      distinct: ['depotId'],
    });
    expect(results[0].pct).toBe(12.5);
    expect(results[0].depotId).toBe('dep-1');
  });

  it('creates many schemes inside a transaction and maps pct', async () => {
    // create() is called per row to build the transaction ops; $transaction resolves the rows.
    model.create.mockReturnValue('op' as never);
    $transaction.mockResolvedValue([row, { ...row, id: 'sch-2', depotId: 'dep-2', pct: '10' }]);
    const input = [
      { depotId: 'dep-1', ownerName: 'Pak Budi', pct: 12.5, effectiveDate: row.effectiveDate },
      { depotId: 'dep-2', ownerName: null, pct: 10, effectiveDate: row.effectiveDate },
    ];
    const results = await repo.createMany(input as never);
    expect(model.create).toHaveBeenCalledTimes(2);
    expect(model.create).toHaveBeenNthCalledWith(1, { data: input[0] });
    expect(model.create).toHaveBeenNthCalledWith(2, { data: input[1] });
    expect($transaction).toHaveBeenCalledWith(['op', 'op']);
    expect(results.map((r) => r.pct)).toEqual([12.5, 10]);
  });
});

describe('LedgerPrismaRepository', () => {
  const model = {
    create: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  };
  const $transaction = jest.fn((ops: unknown[]) => Promise.resolve(ops));
  const prisma = { ledgerEntry: model, $transaction } as unknown as PrismaService;
  const repo = new LedgerPrismaRepository(prisma);

  const row = {
    id: 'le-1',
    franchiseOwnerId: 'own-1',
    depotId: 'dep-1',
    type: 'COMMISSION',
    amount: '5000',
    description: 'commission',
    occurredAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());
  // H-7: a sale and the commission it owes go in as one unit, or a crash between them
  // leaves the owner credited for a sale HQ never took its cut of.
  it('writes a set of entries in one transaction', async () => {
    const entries = [
      {
        franchiseOwnerId: 'own-1',
        depotId: null,
        type: 'SALE_SETTLEMENT' as const,
        amount: 1000,
        description: 'Penjualan',
      },
      {
        franchiseOwnerId: 'own-1',
        depotId: null,
        type: 'COMMISSION' as const,
        amount: -50,
        description: 'Komisi',
      },
    ];
    await repo.createAll(entries);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(model.create).toHaveBeenCalledTimes(2);
  });

  it('creates a ledger entry and maps the amount', async () => {
    model.create.mockResolvedValue(row);
    const data = {
      franchiseOwnerId: 'own-1',
      depotId: 'dep-1',
      type: 'COMMISSION',
      amount: 5000,
      description: 'commission',
      occurredAt: row.occurredAt,
    };
    const result = await repo.create(data as never);
    expect(model.create).toHaveBeenCalledWith({ data });
    expect(result.amount).toBe(5000);
    expect(result.depotId).toBe('dep-1');
  });

  it('finds a pushed entry by source ref, and returns null when there is none', async () => {
    model.findUnique.mockResolvedValueOnce(row);
    const found = await repo.findBySourceRef('order:o1:SALE');
    expect(model.findUnique).toHaveBeenCalledWith({ where: { sourceRef: 'order:o1:SALE' } });
    expect(found?.amount).toBe(5000);

    model.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findBySourceRef('order:none:SALE')).toBeNull();
  });

  it('returns balance sum, coercing null _sum to 0', async () => {
    model.aggregate.mockResolvedValue({ _sum: { amount: '7500' } });
    expect(await repo.balanceFor('own-1')).toBe(7500);
    expect(model.aggregate).toHaveBeenCalledWith({
      where: { franchiseOwnerId: 'own-1' },
      _sum: { amount: true },
    });

    model.aggregate.mockResolvedValue({ _sum: { amount: null } });
    expect(await repo.balanceFor('own-2')).toBe(0);
  });

  it('lists owners with positive balances sorted descending', async () => {
    model.groupBy.mockResolvedValue([
      { franchiseOwnerId: 'a', _sum: { amount: '100' } },
      { franchiseOwnerId: 'b', _sum: { amount: '500' } },
      { franchiseOwnerId: 'c', _sum: { amount: '0' } }, // filtered out (not > 0)
      { franchiseOwnerId: 'd', _sum: { amount: null } }, // null -> 0, filtered out
    ]);
    const owners = await repo.ownersWithBalance();
    expect(model.groupBy).toHaveBeenCalledWith({
      by: ['franchiseOwnerId'],
      _sum: { amount: true },
    });
    expect(owners).toEqual([
      { franchiseOwnerId: 'b', availableBalance: 500 },
      { franchiseOwnerId: 'a', availableBalance: 100 },
    ]);
  });

  it('sums by type since a date', async () => {
    const since = new Date('2026-01-01');
    model.aggregate.mockResolvedValue({ _sum: { amount: '250' } });
    expect(await repo.sumByType('own-1', 'WITHDRAWAL' as never, since)).toBe(250);
    expect(model.aggregate).toHaveBeenCalledWith({
      where: { franchiseOwnerId: 'own-1', type: 'WITHDRAWAL', occurredAt: { gte: since } },
      _sum: { amount: true },
    });

    model.aggregate.mockResolvedValue({ _sum: { amount: null } });
    expect(await repo.sumByType('own-1', 'WITHDRAWAL' as never, since)).toBe(0);
  });

  it('lists entries for an owner paginated with total count', async () => {
    model.findMany.mockResolvedValue([row]);
    model.count.mockResolvedValue(1);
    const result = await repo.listForOwner('own-1', 2, 20);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { franchiseOwnerId: 'own-1' },
      orderBy: { occurredAt: 'desc' },
      skip: 20, // (2-1)*20
      take: 20,
    });
    expect(model.count).toHaveBeenCalledWith({ where: { franchiseOwnerId: 'own-1' } });
    expect(result.total).toBe(1);
    expect(result.items[0].amount).toBe(5000);
  });
});

// Courier twin of the B-8 fix, plus B-10: this debit was the only one of the four courier
// ledger writes with no sourceRef, so it alone had no idempotency key.
describe('CourierWithdrawalPrismaRepository.withdrawWithDebit', () => {
  const courierWithdrawal = { create: jest.fn() };
  const courierLedgerEntry = { aggregate: jest.fn(), create: jest.fn() };
  const $executeRaw = jest.fn();
  const prisma = {
    courierWithdrawal,
    courierLedgerEntry,
    $executeRaw,
    $transaction: jest.fn((fn) => fn({ courierWithdrawal, courierLedgerEntry, $executeRaw })),
  } as unknown as PrismaService;
  const repo = new CourierWithdrawalPrismaRepository(prisma);

  const input = {
    courierId: 'cou-1',
    amount: 300,
    bankAccountRef: 'BRI',
    reference: 'CWD-9',
    status: 'PROCESSING' as const,
    description: 'Penarikan saldo · CWD-9',
  };
  const created = {
    id: 'cw', courierId: 'cou-1', amount: '300', bankAccountRef: 'BRI',
    status: 'PROCESSING', reference: 'CWD-9', createdAt: new Date(), updatedAt: new Date(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('debits with a sourceRef so a retry cannot debit twice', async () => {
    courierLedgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 1000 } });
    courierWithdrawal.create.mockResolvedValue(created);

    await repo.withdrawWithDebit(input);

    expect(courierLedgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: -300, sourceRef: 'withdrawal:CWD-9' }),
    });
  });

  it('locks per courier before reading, and writes both rows in one transaction', async () => {
    courierLedgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 1000 } });
    courierWithdrawal.create.mockResolvedValue(created);

    const out = await repo.withdrawWithDebit(input);

    expect(out.ok).toBe(true);
    expect($executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      courierLedgerEntry.aggregate.mock.invocationCallOrder[0],
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('writes nothing at all when the balance is short', async () => {
    courierLedgerEntry.aggregate.mockResolvedValue({ _sum: { amount: 10 } });

    const out = await repo.withdrawWithDebit(input);

    expect(out).toEqual({ ok: false, balance: 10 });
    expect(courierWithdrawal.create).not.toHaveBeenCalled();
    expect(courierLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('treats an empty ledger as a zero balance', async () => {
    courierLedgerEntry.aggregate.mockResolvedValue({ _sum: { amount: null } });
    expect(await repo.withdrawWithDebit(input)).toEqual({ ok: false, balance: 0 });
  });
});

describe('CourierWithdrawalPrismaRepository', () => {
  const model = { create: jest.fn(), findMany: jest.fn() };
  const prisma = { courierWithdrawal: model } as unknown as PrismaService;
  const repo = new CourierWithdrawalPrismaRepository(prisma);

  const row = {
    id: 'cwd-1',
    courierId: 'cou-1',
    amount: '75000',
    bankAccountRef: 'BRI-9',
    status: 'PENDING',
    reference: 'CWD-REF-1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates a courier withdrawal and maps the amount', async () => {
    model.create.mockResolvedValue(row);
    const data = {
      courierId: 'cou-1',
      amount: 75000,
      bankAccountRef: 'BRI-9',
      reference: 'CWD-REF-1',
    };
    const result = await repo.create(data as never);
    expect(model.create).toHaveBeenCalledWith({ data });
    expect(result.amount).toBe(75000);
    expect(result.courierId).toBe('cou-1');
    expect(result.status).toBe('PENDING');
  });

  it('lists withdrawals for a courier ordered desc with take', async () => {
    model.findMany.mockResolvedValue([row]);
    const results = await repo.listForCourier('cou-1', 15);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { courierId: 'cou-1' },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });
    expect(results[0].reference).toBe('CWD-REF-1');
  });

  it('returns empty array when courier has no withdrawals', async () => {
    model.findMany.mockResolvedValue([]);
    expect(await repo.listForCourier('cou-x', 5)).toEqual([]);
  });
});

describe('ExpenseClaimPrismaRepository', () => {
  const model = {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  };
  const prisma = { expenseClaim: model } as unknown as PrismaService;
  const repo = new ExpenseClaimPrismaRepository(prisma);

  const row = {
    id: 'ec-1',
    courierId: 'cou-1',
    depotId: 'dep-1',
    category: 'FUEL',
    amount: '30000',
    description: 'petrol',
    receiptUrl: 'https://x/receipt.jpg',
    status: 'PENDING',
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    ledgerEntryId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates a claim and maps the amount + category + status', async () => {
    model.create.mockResolvedValue(row);
    const data = {
      courierId: 'cou-1',
      depotId: 'dep-1',
      category: 'FUEL',
      amount: 30000,
      description: 'petrol',
      receiptUrl: 'https://x/receipt.jpg',
    };
    const result = await repo.create(data as never);
    expect(model.create).toHaveBeenCalledWith({ data });
    expect(result.amount).toBe(30000);
    expect(result.category).toBe('FUEL');
    expect(result.status).toBe('PENDING');
  });

  it('finds a claim by id', async () => {
    model.findUnique.mockResolvedValue(row);
    const result = await repo.findById('ec-1');
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'ec-1' } });
    expect(result?.id).toBe('ec-1');
  });

  it('returns null when claim not found', async () => {
    model.findUnique.mockResolvedValue(null);
    expect(await repo.findById('missing')).toBeNull();
  });

  it('marks a claim reviewed with approval fields and stamps reviewedAt', async () => {
    const reviewed = {
      ...row,
      status: 'APPROVED',
      reviewedBy: 'mgr-1',
      reviewNote: 'ok',
      ledgerEntryId: 'le-9',
      reviewedAt: new Date('2026-01-03'),
    };
    model.update.mockResolvedValue(reviewed);
    const result = await repo.markReviewed('ec-1', {
      status: 'APPROVED' as never,
      reviewedBy: 'mgr-1',
      reviewNote: 'ok',
      ledgerEntryId: 'le-9',
    });
    expect(model.update).toHaveBeenCalledWith({
      where: { id: 'ec-1' },
      data: {
        status: 'APPROVED',
        reviewedBy: 'mgr-1',
        reviewNote: 'ok',
        ledgerEntryId: 'le-9',
        reviewedAt: expect.any(Date),
      },
    });
    expect(result.status).toBe('APPROVED');
    expect(result.ledgerEntryId).toBe('le-9');
  });

  it('defaults ledgerEntryId to null when omitted (rejection path)', async () => {
    model.update.mockResolvedValue({ ...row, status: 'REJECTED', reviewedBy: 'mgr-1' });
    await repo.markReviewed('ec-1', {
      status: 'REJECTED' as never,
      reviewedBy: 'mgr-1',
      reviewNote: 'no receipt',
    });
    expect(model.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ledgerEntryId: null }) }),
    );
  });

  it('lists claims for a courier paginated with total', async () => {
    model.findMany.mockResolvedValue([row]);
    model.count.mockResolvedValue(3);
    const result = await repo.listForCourier('cou-1', 2, 10);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { courierId: 'cou-1' },
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
    });
    expect(model.count).toHaveBeenCalledWith({ where: { courierId: 'cou-1' } });
    expect(result.total).toBe(3);
    expect(result.items[0].amount).toBe(30000);
  });

  it('searches for a depot with both depotId and status filters', async () => {
    model.findMany.mockResolvedValue([row]);
    model.count.mockResolvedValue(1);
    const result = await repo.searchForDepot('dep-1', 'PENDING' as never, 1, 50);
    const where = { depotId: 'dep-1', status: 'PENDING' };
    expect(model.findMany).toHaveBeenCalledWith({
      where,
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 50,
    });
    expect(model.count).toHaveBeenCalledWith({ where });
    expect(result.total).toBe(1);
  });

  it('searches with empty where when depotId and status are null', async () => {
    model.findMany.mockResolvedValue([]);
    model.count.mockResolvedValue(0);
    const result = await repo.searchForDepot(null, null, 1, 20);
    expect(model.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
    expect(model.count).toHaveBeenCalledWith({ where: {} });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe('CourierLedgerPrismaRepository', () => {
  const ledgerModel = {
    create: jest.fn(),
    findUnique: jest.fn(),
    aggregate: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  };
  const ruleModel = { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() };
  const prisma = {
    courierLedgerEntry: ledgerModel,
    courierEarningRule: ruleModel,
  } as unknown as PrismaService;
  const repo = new CourierLedgerPrismaRepository(prisma);

  const entryRow = {
    id: 'cle-1',
    courierId: 'cou-1',
    depotId: 'dep-1',
    type: 'EARNING',
    amount: '12000',
    description: 'delivery fare',
    sourceRef: 'order-1',
    occurredAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
  };

  const ruleRow = {
    id: 'rule-1',
    depotId: 'dep-1',
    effectiveDate: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    baseFare: '8000',
    peakBonus: '2000',
    onTimeBonus: '1000',
    peakStartHour: 17,
    peakEndHour: 20,
    monthlyTarget: '5000000',
    tiers: [{ deliveries: 25, bonus: '25000' }],
  };

  const TIER_INCLUDE = { tiers: { orderBy: { deliveries: 'asc' } } };

  beforeEach(() => jest.clearAllMocks());

  it('creates a courier ledger entry and maps amount', async () => {
    ledgerModel.create.mockResolvedValue(entryRow);
    const data = {
      courierId: 'cou-1',
      depotId: 'dep-1',
      type: 'EARNING',
      amount: 12000,
      description: 'delivery fare',
      sourceRef: 'order-1',
      occurredAt: entryRow.occurredAt,
    };
    const result = await repo.create(data as never);
    expect(ledgerModel.create).toHaveBeenCalledWith({ data });
    expect(result.amount).toBe(12000);
    expect(result.sourceRef).toBe('order-1');
  });

  it('finds an entry by sourceRef', async () => {
    ledgerModel.findUnique.mockResolvedValue(entryRow);
    const result = await repo.findBySourceRef('order-1');
    expect(ledgerModel.findUnique).toHaveBeenCalledWith({ where: { sourceRef: 'order-1' } });
    expect(result?.id).toBe('cle-1');
  });

  it('returns null when sourceRef not found (idempotency guard)', async () => {
    ledgerModel.findUnique.mockResolvedValue(null);
    expect(await repo.findBySourceRef('nope')).toBeNull();
  });

  it('returns balance, coercing null to 0', async () => {
    ledgerModel.aggregate.mockResolvedValue({ _sum: { amount: '12000' } });
    expect(await repo.balanceFor('cou-1')).toBe(12000);
    expect(ledgerModel.aggregate).toHaveBeenCalledWith({
      where: { courierId: 'cou-1' },
      _sum: { amount: true },
    });

    ledgerModel.aggregate.mockResolvedValue({ _sum: { amount: null } });
    expect(await repo.balanceFor('cou-2')).toBe(0);
  });

  it('sums by type since a date', async () => {
    const since = new Date('2026-01-01');
    ledgerModel.aggregate.mockResolvedValue({ _sum: { amount: '9000' } });
    expect(await repo.sumByType('cou-1', 'EARNING' as never, since)).toBe(9000);
    expect(ledgerModel.aggregate).toHaveBeenCalledWith({
      where: { courierId: 'cou-1', type: 'EARNING', occurredAt: { gte: since } },
      _sum: { amount: true },
    });

    ledgerModel.aggregate.mockResolvedValue({ _sum: { amount: null } });
    expect(await repo.sumByType('cou-1', 'EARNING' as never, since)).toBe(0);
  });

  it('counts by type since a date (monthly delivery count for tiers)', async () => {
    const since = new Date('2026-01-01');
    ledgerModel.count.mockResolvedValue(26);
    expect(await repo.countByType('cou-1', 'EARNING' as never, since)).toBe(26);
    expect(ledgerModel.count).toHaveBeenCalledWith({
      where: { courierId: 'cou-1', type: 'EARNING', occurredAt: { gte: since } },
    });
  });

  it('lists entries for a courier paginated with total', async () => {
    ledgerModel.findMany.mockResolvedValue([entryRow]);
    ledgerModel.count.mockResolvedValue(1);
    const result = await repo.listForCourier('cou-1', 3, 10);
    expect(ledgerModel.findMany).toHaveBeenCalledWith({
      where: { courierId: 'cou-1' },
      orderBy: { occurredAt: 'desc' },
      skip: 20, // (3-1)*10
      take: 10,
    });
    expect(ledgerModel.count).toHaveBeenCalledWith({ where: { courierId: 'cou-1' } });
    expect(result.total).toBe(1);
    expect(result.items[0].amount).toBe(12000);
  });

  it('currentRule prefers the depot-specific newest rule', async () => {
    ruleModel.findFirst.mockResolvedValueOnce(ruleRow);
    const rule = await repo.currentRule('dep-1');
    expect(ruleModel.findFirst).toHaveBeenCalledWith({
      where: { depotId: 'dep-1' },
      orderBy: { effectiveDate: 'desc' },
      include: TIER_INCLUDE,
    });
    expect(ruleModel.findFirst).toHaveBeenCalledTimes(1); // no fallback needed
    expect(rule).toMatchObject({
      baseFare: 8000,
      peakBonus: 2000,
      onTimeBonus: 1000,
      peakStartHour: 17,
      peakEndHour: 20,
      monthlyTarget: 5000000,
      tiers: [{ deliveries: 25, bonus: 25000 }],
    });
  });

  it('currentRule falls back to the network default when depot has no rule', async () => {
    ruleModel.findFirst
      .mockResolvedValueOnce(null) // depot-specific miss
      .mockResolvedValueOnce({ ...ruleRow, depotId: null }); // network default
    const rule = await repo.currentRule('dep-1');
    expect(ruleModel.findFirst).toHaveBeenNthCalledWith(2, {
      where: { depotId: null },
      orderBy: { effectiveDate: 'desc' },
      include: TIER_INCLUDE,
    });
    expect(rule?.baseFare).toBe(8000);
  });

  it('currentRule queries only the network default when depotId is null', async () => {
    ruleModel.findFirst.mockResolvedValueOnce({ ...ruleRow, depotId: null });
    const rule = await repo.currentRule(null);
    expect(ruleModel.findFirst).toHaveBeenCalledTimes(1);
    expect(ruleModel.findFirst).toHaveBeenCalledWith({
      where: { depotId: null },
      orderBy: { effectiveDate: 'desc' },
      include: TIER_INCLUDE,
    });
    expect(rule?.peakEndHour).toBe(20);
  });

  it('currentRule returns null when no rule exists at all', async () => {
    ruleModel.findFirst.mockResolvedValue(null);
    expect(await repo.currentRule('dep-1')).toBeNull();
    expect(await repo.currentRule(null)).toBeNull();
  });

  it('lists all rules newest first', async () => {
    ruleModel.findMany.mockResolvedValue([ruleRow]);
    const rules = await repo.listRules();
    expect(ruleModel.findMany).toHaveBeenCalledWith({
      orderBy: { effectiveDate: 'desc' },
      include: TIER_INCLUDE,
    });
    expect(rules[0]).toEqual({
      id: 'rule-1',
      depotId: 'dep-1',
      effectiveDate: ruleRow.effectiveDate,
      createdAt: ruleRow.createdAt,
      baseFare: 8000,
      peakBonus: 2000,
      onTimeBonus: 1000,
      peakStartHour: 17,
      peakEndHour: 20,
      monthlyTarget: 5000000,
      tiers: [{ deliveries: 25, bonus: 25000 }],
    });
  });

  it('creates a rule with the explicit field mapping', async () => {
    ruleModel.create.mockResolvedValue(ruleRow);
    const data = {
      depotId: 'dep-1',
      baseFare: 8000,
      peakBonus: 2000,
      onTimeBonus: 1000,
      peakStartHour: 17,
      peakEndHour: 20,
      monthlyTarget: 5000000,
      tiers: [{ deliveries: 25, bonus: 25000 }],
      effectiveDate: ruleRow.effectiveDate,
    };
    const result = await repo.createRule(data as never);
    expect(ruleModel.create).toHaveBeenCalledWith({
      data: {
        depotId: 'dep-1',
        baseFare: 8000,
        peakBonus: 2000,
        onTimeBonus: 1000,
        peakStartHour: 17,
        peakEndHour: 20,
        monthlyTarget: 5000000,
        effectiveDate: ruleRow.effectiveDate,
        tiers: { create: [{ deliveries: 25, bonus: 25000 }] },
      },
      include: TIER_INCLUDE,
    });
    expect(result.baseFare).toBe(8000);
  });
});
