import {
  InsufficientBalanceError,
  InvalidRevenueAmountError,
  InvalidWithdrawalAmountError,
} from '../src/domain/errors';
import { PayoutService } from '../src/application/services/payout.service';
import type {
  CreateLedgerEntryData,
  LedgerRepository,
} from '../src/application/ports/ledger.repository';
import type {
  CreateWithdrawalData,
  WithdrawalRepository,
} from '../src/application/ports/withdrawal.repository';
import type { CommissionSchemeRepository } from '../src/application/ports/commission-scheme.repository';
import type { CommissionSchemeRecord } from '../src/domain/commission';
import type { LedgerEntryRecord, WithdrawalRecord } from '../src/domain/ledger';

// In-memory fakes — the balance guard is the money-critical path worth pinning.
class FakeLedger implements LedgerRepository {
  entries: LedgerEntryRecord[] = [];
  constructor(seed: number[] = []) {
    seed.forEach((amount, i) =>
      this.entries.push({
        id: `seed-${i}`,
        franchiseOwnerId: 'owner-1',
        depotId: null,
        type: 'SALE_SETTLEMENT',
        amount,
        description: 'seed',
        occurredAt: new Date(),
        createdAt: new Date(),
      }),
    );
  }
  async create(data: CreateLedgerEntryData): Promise<LedgerEntryRecord> {
    const row: LedgerEntryRecord = {
      ...data,
      id: `e-${this.entries.length}`,
      occurredAt: data.occurredAt ?? new Date(),
      createdAt: new Date(),
    };
    this.entries.push(row);
    this.refs.set(data.sourceRef ?? `no-ref-${this.entries.length}`, row);
    return row;
  }
  refs = new Map<string, LedgerEntryRecord>();
  async findBySourceRef(sourceRef: string): Promise<LedgerEntryRecord | null> {
    return this.refs.get(sourceRef) ?? null;
  }
  async balanceFor(owner?: string): Promise<number> {
    return this.entries
      .filter((e) => !owner || e.franchiseOwnerId === owner)
      .reduce((n, e) => n + e.amount, 0);
  }
  async ownersWithBalance() {
    const byOwner = new Map<string, number>();
    for (const e of this.entries) {
      byOwner.set(e.franchiseOwnerId, (byOwner.get(e.franchiseOwnerId) ?? 0) + e.amount);
    }
    return [...byOwner.entries()]
      .map(([franchiseOwnerId, availableBalance]) => ({ franchiseOwnerId, availableBalance }))
      .filter((o) => o.availableBalance > 0)
      .sort((a, b) => b.availableBalance - a.availableBalance);
  }
  async sumByType(): Promise<number> {
    return 0;
  }
  async listForOwner(): Promise<{ items: LedgerEntryRecord[]; total: number }> {
    return { items: this.entries, total: this.entries.length };
  }
}

class FakeSchemes implements CommissionSchemeRepository {
  // Mutable: a reversal has to prove it reverses what was CHARGED, not what the scheme
  // says today, so a test needs to move the rate between the sale and the void.
  constructor(public current: { depotId: string; pct: number }[] = []) {}
  async listCurrent(): Promise<CommissionSchemeRecord[]> {
    return this.current.map((c, i) => ({
      id: `cs-${i}`,
      depotId: c.depotId,
      ownerName: null,
      pct: c.pct,
      effectiveDate: new Date('2026-01-01'),
      createdAt: new Date('2026-01-01'),
    }));
  }
  async createMany(): Promise<CommissionSchemeRecord[]> {
    return [];
  }
}

class FakeWithdrawals implements WithdrawalRepository {
  created: CreateWithdrawalData[] = [];
  async create(data: CreateWithdrawalData): Promise<WithdrawalRecord> {
    this.created.push(data);
    return { ...data, id: 'w-1', createdAt: new Date(), updatedAt: new Date() };
  }
  async listForOwner(): Promise<WithdrawalRecord[]> {
    return [];
  }
}

describe('PayoutService.requestWithdrawal', () => {
  it('rejects a non-positive amount', async () => {
    const svc = new PayoutService(
      new FakeLedger([100000]),
      new FakeWithdrawals(),
      new FakeSchemes(),
    );
    await expect(svc.requestWithdrawal('owner-1', 0, 'BCA')).rejects.toBeInstanceOf(
      InvalidWithdrawalAmountError,
    );
  });

  it('rejects when the amount exceeds available balance', async () => {
    const svc = new PayoutService(
      new FakeLedger([100000]),
      new FakeWithdrawals(),
      new FakeSchemes(),
    );
    await expect(svc.requestWithdrawal('owner-1', 150000, 'BCA')).rejects.toBeInstanceOf(
      InsufficientBalanceError,
    );
  });

  it('posts a matching debit that drops the balance to zero on a full cash-out', async () => {
    const ledger = new FakeLedger([500000]);
    const withdrawals = new FakeWithdrawals();
    const svc = new PayoutService(ledger, withdrawals, new FakeSchemes());

    const w = await svc.requestWithdrawal('owner-1', 500000, 'BCA ···· 4821');

    expect(w.reference).toMatch(/^WD-\d{8}-\d{4}$/);
    expect(withdrawals.created).toHaveLength(1);
    expect(await ledger.balanceFor()).toBe(0);
  });
});

describe('PayoutService.summary', () => {
  it('reports available balance, recent entries and the next payout date', async () => {
    const ledger = new FakeLedger([300000, -50000]);
    const svc = new PayoutService(ledger, new FakeWithdrawals(), new FakeSchemes());

    const s = await svc.summary('owner-1');
    expect(s.availableBalance).toBe(250000);
    // COMMISSION magnitude is reported unsigned.
    expect(s.monthCommission).toBeGreaterThanOrEqual(0);
    expect(s.recentEntries).toHaveLength(2);
    expect(s.nextPayoutDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // Payouts land on the 15th. Which 15th depends on today, and "today" is whatever the calendar
  // says when the suite happens to run — so the branch was only ever exercised in one direction.
  it('points at this month’s 15th before it, and next month’s once it has passed', async () => {
    jest.useFakeTimers();
    try {
      const svc = new PayoutService(new FakeLedger([100000]), new FakeWithdrawals(), new FakeSchemes());

      jest.setSystemTime(new Date(2026, 7, 3));
      expect((await svc.summary('owner-1')).nextPayoutDate).toBe(new Date(2026, 7, 15).toISOString());

      jest.setSystemTime(new Date(2026, 7, 20));
      expect((await svc.summary('owner-1')).nextPayoutDate).toBe(new Date(2026, 8, 15).toISOString());
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('PayoutService.ledgerPage', () => {
  it('wraps entries in a page envelope', async () => {
    const ledger = new FakeLedger([100000, 200000]);
    const svc = new PayoutService(ledger, new FakeWithdrawals(), new FakeSchemes());

    const page = await svc.ledgerPage('owner-1', 1, 10);
    expect(page).toMatchObject({ page: 1, limit: 10, total: 2, totalPages: 1 });
    expect(page.items).toHaveLength(2);
  });
});

describe('PayoutService HQ release queue', () => {
  it('lists every owner with a positive balance, highest first', async () => {
    const ledger = new FakeLedger();
    await ledger.create({
      franchiseOwnerId: 'owner-a',
      depotId: null,
      type: 'SALE_SETTLEMENT',
      amount: 300000,
      description: '',
    });
    await ledger.create({
      franchiseOwnerId: 'owner-b',
      depotId: null,
      type: 'SALE_SETTLEMENT',
      amount: 900000,
      description: '',
    });
    await ledger.create({
      franchiseOwnerId: 'owner-c',
      depotId: null,
      type: 'WITHDRAWAL',
      amount: -100000,
      description: '',
    });
    const svc = new PayoutService(ledger, new FakeWithdrawals(), new FakeSchemes());

    const pending = await svc.pendingPayouts();
    expect(pending.map((p) => p.franchiseOwnerId)).toEqual(['owner-b', 'owner-a']);
    expect(pending[0].availableBalance).toBe(900000);
    expect(pending[0].nextPayoutDate).toMatch(/^\d{4}-/);
  });

  it('reports one owner balance for the depot-detail payout card', async () => {
    const ledger = new FakeLedger();
    await ledger.create({
      franchiseOwnerId: 'owner-a',
      depotId: null,
      type: 'SALE_SETTLEMENT',
      amount: 300000,
      description: '',
    });
    await ledger.create({
      franchiseOwnerId: 'owner-a',
      depotId: null,
      type: 'WITHDRAWAL',
      amount: -100000,
      description: '',
    });
    const svc = new PayoutService(ledger, new FakeWithdrawals(), new FakeSchemes());

    const bal = await svc.availableForOwner('owner-a');
    expect(bal.franchiseOwnerId).toBe('owner-a');
    expect(bal.availableBalance).toBe(200000);
    expect(bal.nextPayoutDate).toMatch(/^\d{4}-/);
    // Unknown owner → zero, never throws.
    expect((await svc.availableForOwner('nobody')).availableBalance).toBe(0);
  });

  it('releasing an owner cashes out their full balance via the withdrawal path', async () => {
    const ledger = new FakeLedger();
    await ledger.create({
      franchiseOwnerId: 'owner-a',
      depotId: null,
      type: 'SALE_SETTLEMENT',
      amount: 500000,
      description: '',
    });
    const withdrawals = new FakeWithdrawals();
    const svc = new PayoutService(ledger, withdrawals, new FakeSchemes());

    const w = await svc.releaseForOwner('owner-a');
    expect(w.amount).toBe(500000);
    expect(w.bankAccountRef).toBe('Rilis HQ');
    expect(withdrawals.created).toHaveLength(1);
    expect(await ledger.balanceFor('owner-a')).toBe(0);
    // Cleared owner no longer appears in the queue.
    expect(await svc.pendingPayouts()).toHaveLength(0);
  });
});

describe('PayoutService.recordOrderRevenue', () => {
  const order = {
    orderId: '11111111-1111-4111-8111-111111111111',
    franchiseOwnerId: 'owner-a',
    depotId: 'depot-1',
    amountIdr: 240000,
    orderNumber: 'HM-20260728-000123',
  };

  it('credits the sale and debits commission at the depot scheme rate', async () => {
    const ledger = new FakeLedger();
    const svc = new PayoutService(
      ledger,
      new FakeWithdrawals(),
      new FakeSchemes([{ depotId: 'depot-1', pct: 5 }]),
    );

    const out = await svc.recordOrderRevenue(order);

    expect(out).toMatchObject({
      recorded: true,
      revenue: 240000,
      commission: 12000,
      commissionPct: 5,
    });
    expect(ledger.entries.map((e) => [e.type, e.amount])).toEqual([
      ['SALE_SETTLEMENT', 240000],
      ['COMMISSION', -12000],
    ]);
    // Net of both entries is what the owner can actually withdraw.
    expect(await ledger.balanceFor('owner-a')).toBe(228000);
  });

  it('posts the sale alone when the depot has no commission scheme', async () => {
    const ledger = new FakeLedger();
    const svc = new PayoutService(ledger, new FakeWithdrawals(), new FakeSchemes());

    const out = await svc.recordOrderRevenue(order);

    expect(out).toMatchObject({ recorded: true, commission: 0, commissionPct: 0 });
    expect(ledger.entries).toHaveLength(1);
  });

  it('ignores a scheme belonging to another depot, and an order with no depot at all', async () => {
    const ledger = new FakeLedger();
    const svc = new PayoutService(
      ledger,
      new FakeWithdrawals(),
      new FakeSchemes([{ depotId: 'other', pct: 9 }]),
    );

    expect((await svc.recordOrderRevenue(order)).commissionPct).toBe(0);
    const unrouted = await svc.recordOrderRevenue({
      ...order,
      orderId: '22222222-2222-4222-8222-222222222222',
      depotId: null,
    });
    expect(unrouted.commissionPct).toBe(0);
  });

  it('is idempotent — a retried push never credits the owner twice', async () => {
    const ledger = new FakeLedger();
    const svc = new PayoutService(
      ledger,
      new FakeWithdrawals(),
      new FakeSchemes([{ depotId: 'depot-1', pct: 5 }]),
    );

    await svc.recordOrderRevenue(order);
    const replay = await svc.recordOrderRevenue(order);

    expect(replay.recorded).toBe(false);
    expect(ledger.entries).toHaveLength(2);
    expect(await ledger.balanceFor('owner-a')).toBe(228000);
  });

  it('rejects a non-positive amount', async () => {
    const svc = new PayoutService(new FakeLedger(), new FakeWithdrawals(), new FakeSchemes());
    await expect(svc.recordOrderRevenue({ ...order, amountIdr: 0 })).rejects.toBeInstanceOf(
      InvalidRevenueAmountError,
    );
  });

  it('falls back to the order id when no order number is given, and stamps the completion time', async () => {
    const ledger = new FakeLedger();
    const svc = new PayoutService(ledger, new FakeWithdrawals(), new FakeSchemes());
    const completedAt = new Date('2026-07-28T03:04:05.000Z');

    await svc.recordOrderRevenue({ ...order, orderNumber: null, occurredAt: completedAt });

    expect(ledger.entries[0].description).toContain(order.orderId);
    expect(ledger.entries[0].occurredAt).toEqual(completedAt);
  });

  describe('reverseOrderRevenue', () => {
    const build = (pct = 5) =>
      new PayoutService(
        new FakeLedger(),
        new FakeWithdrawals(),
        new FakeSchemes([{ depotId: 'depot-1', pct }]),
      );

    it('backs out both rows and leaves the owner exactly where they started', async () => {
      const ledger = new FakeLedger();
      const svc = new PayoutService(
        ledger,
        new FakeWithdrawals(),
        new FakeSchemes([{ depotId: 'depot-1', pct: 5 }]),
      );
      await svc.recordOrderRevenue(order);
      expect(await ledger.balanceFor('owner-a')).toBe(228000);

      expect(await svc.reverseOrderRevenue(order.orderId, 'Salah ukuran')).toEqual({
        reversed: true,
      });

      // Compensating rows, not deletions: the sale still shows in the ledger, undone.
      expect(ledger.entries.map((e) => [e.type, e.amount])).toEqual([
        ['SALE_SETTLEMENT', 240000],
        ['COMMISSION', -12000],
        ['SALE_SETTLEMENT', -240000],
        ['COMMISSION', 12000],
      ]);
      expect(await ledger.balanceFor('owner-a')).toBe(0);
    });

    // The reversal reads the ORIGINAL rows, so a scheme that changed after the sale cannot
    // hand back a different commission than the one actually taken.
    it('reverses what was charged, not what the current scheme would charge', async () => {
      const ledger = new FakeLedger();
      const schemes = new FakeSchemes([{ depotId: 'depot-1', pct: 5 }]);
      const svc = new PayoutService(ledger, new FakeWithdrawals(), schemes);
      await svc.recordOrderRevenue(order);

      schemes.current = [{ depotId: 'depot-1', pct: 20 }];
      await svc.reverseOrderRevenue(order.orderId, 'Batal');

      expect(ledger.entries.at(-1)).toMatchObject({ type: 'COMMISSION', amount: 12000 });
      expect(await ledger.balanceFor('owner-a')).toBe(0);
    });

    it('is a no-op for an order that never posted, and for one already reversed', async () => {
      const svc = build();
      expect(await svc.reverseOrderRevenue('nothing-here', 'Batal')).toEqual({ reversed: false });

      const ledger = new FakeLedger();
      const live = new PayoutService(
        ledger,
        new FakeWithdrawals(),
        new FakeSchemes([{ depotId: 'depot-1', pct: 5 }]),
      );
      await live.recordOrderRevenue(order);
      await live.reverseOrderRevenue(order.orderId, 'Batal');
      expect(await live.reverseOrderRevenue(order.orderId, 'Batal')).toEqual({ reversed: false });
      expect(ledger.entries).toHaveLength(4);
    });

    it('writes no commission reversal when none was charged', async () => {
      const ledger = new FakeLedger();
      const svc = new PayoutService(ledger, new FakeWithdrawals(), new FakeSchemes());
      await svc.recordOrderRevenue({ ...order, depotId: null });

      await svc.reverseOrderRevenue(order.orderId, 'Batal');

      expect(ledger.entries.map((e) => e.type)).toEqual(['SALE_SETTLEMENT', 'SALE_SETTLEMENT']);
      expect(await ledger.balanceFor('owner-a')).toBe(0);
    });
  });
});
