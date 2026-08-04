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
  WithdrawalOutcome,
  WithdrawalRepository,
} from '../src/application/ports/withdrawal.repository';
import type { CommissionSchemeRepository } from '../src/application/ports/commission-scheme.repository';
import type { CommissionSchemeRecord } from '../src/domain/commission';
import type { LedgerEntryRecord, WithdrawalRecord, WithdrawalStatus } from '../src/domain/ledger';
import { PayoutConfigService } from '../src/config/payout-config.service';

/**
 * The service only reads `businessTimeZone` off the config, so the test double is one
 * getter. Pinned to WIB deliberately: the month and payout-date boundaries these tests
 * assert used to come from the HOST's calendar (H-16), and a test that inherits the
 * host's zone cannot catch that regression coming back.
 */
const payoutTestConfig = (timeZone = 'Asia/Jakarta'): PayoutConfigService =>
  ({ businessTimeZone: timeZone }) as PayoutConfigService;

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
  /**
   * All-or-nothing, like the real transaction (H-7). `failAfter` lets a test cut the
   * write in half the way a crash would; without the transaction the first entry would
   * survive on its own.
   */
  failAfter: number | null = null;
  async createAll(entries: CreateLedgerEntryData[]): Promise<void> {
    const before = [...this.entries];
    const refsBefore = new Map(this.refs);
    for (const [i, data] of entries.entries()) {
      if (this.failAfter !== null && i >= this.failAfter) {
        this.entries = before;
        this.refs = refsBefore;
        throw new Error('ledger write interrupted');
      }
      await this.create(data);
    }
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
  async listForOwner(): Promise<{
    items: LedgerEntryRecord[];
    total: number;
    nextCursor: string | null;
  }> {
    return { items: this.entries, total: this.entries.length, nextCursor: null };
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
  // Audit S-15: the depot's own row, asked for by id — the service no longer reads the
  // whole table on every completed order. Counted so the baseline row has a test.
  currentForDepotCalls = 0;
  async currentForDepot(depotId: string): Promise<CommissionSchemeRecord | null> {
    this.currentForDepotCalls += 1;
    return (await this.listCurrent()).find((r) => r.depotId === depotId) ?? null;
  }
  async createMany(): Promise<CommissionSchemeRecord[]> {
    return [];
  }
}

class FakeWithdrawals implements WithdrawalRepository {
  private seq = 100_000;
  /** Mirrors the Postgres sequence: strictly increasing, never repeated (H-13). */
  async nextReferenceSequence(): Promise<number> {
    this.seq += 1;
    return this.seq;
  }

  created: CreateWithdrawalData[] = [];
  /** Ledger debits written alongside a withdrawal — proves the pair is not split. */
  debits: { franchiseOwnerId: string; amount: number; description: string }[] = [];
  // The real implementation sums the ledger inside its own transaction, so the fake reads
  // the same ledger fake rather than tracking a second, drifting number.
  constructor(private readonly ledger?: FakeLedger) {}

  async create(data: CreateWithdrawalData): Promise<WithdrawalRecord> {
    this.created.push(data);
    return { ...data, id: 'w-1', createdAt: new Date(), updatedAt: new Date() };
  }
  async listForOwner(): Promise<WithdrawalRecord[]> {
    return [];
  }

  // Single-threaded stand-in for the advisory-locked withdraw (B-8). It cannot reproduce
  // the race, but it does hold the contract the real one guarantees: the balance check and
  // both writes are one step, and a short balance writes nothing at all.
  async withdrawWithDebit(input: {
    franchiseOwnerId: string;
    amount: number;
    bankAccountRef: string;
    reference: string;
    status: WithdrawalStatus;
    description: string;
  }): Promise<WithdrawalOutcome> {
    const balance = (await this.ledger?.balanceFor(input.franchiseOwnerId)) ?? 0;
    if (input.amount > balance) return { ok: false, balance };

    const withdrawal = await this.create({
      franchiseOwnerId: input.franchiseOwnerId,
      amount: input.amount,
      bankAccountRef: input.bankAccountRef,
      reference: input.reference,
      status: input.status,
    });
    // Written in the same step as the withdrawal, exactly as the real transaction does.
    await this.ledger?.create({
      franchiseOwnerId: input.franchiseOwnerId,
      depotId: null,
      type: 'WITHDRAWAL',
      amount: -input.amount,
      description: input.description,
    });
    this.debits.push({
      franchiseOwnerId: input.franchiseOwnerId,
      amount: -input.amount,
      description: input.description,
    });
    return { ok: true, withdrawal };
  }
}

describe('PayoutService.requestWithdrawal', () => {
  it('rejects a non-positive amount', async () => {
    const svc = new PayoutService(
      new FakeLedger([100000]),
      new FakeWithdrawals(),
      new FakeSchemes(),
      payoutTestConfig(),
    );
    await expect(svc.requestWithdrawal('owner-1', 0, 'BCA')).rejects.toBeInstanceOf(
      InvalidWithdrawalAmountError,
    );
  });

  it('rejects when the amount exceeds available balance', async () => {
    const ledger = new FakeLedger([100000]);
    const withdrawals = new FakeWithdrawals(ledger);
    const svc = new PayoutService(ledger, withdrawals, new FakeSchemes(), payoutTestConfig());

    await expect(svc.requestWithdrawal('owner-1', 150000, 'BCA')).rejects.toBeInstanceOf(
      InsufficientBalanceError,
    );
    // B-8: a refused withdrawal must leave NOTHING behind. The old code wrote the
    // withdrawal row and its debit as two independent statements, so a partial write was
    // reachable; the check and both writes are now one step.
    expect(withdrawals.created).toHaveLength(0);
    expect(withdrawals.debits).toHaveLength(0);
    expect(await ledger.balanceFor('owner-1')).toBe(100000);
  });

  it('posts a matching debit that drops the balance to zero on a full cash-out', async () => {
    const ledger = new FakeLedger([500000]);
    const withdrawals = new FakeWithdrawals(ledger);
    const svc = new PayoutService(ledger, withdrawals, new FakeSchemes(), payoutTestConfig());

    const w = await svc.requestWithdrawal('owner-1', 500000, 'BCA ···· 4821');

    expect(w.reference).toMatch(/^WD-\d{8}-\d{4,}$/);
    expect(withdrawals.created).toHaveLength(1);
    expect(await ledger.balanceFor()).toBe(0);
  });

  it('cannot be drained twice: the second cash-out sees the first one’s debit', async () => {
    const ledger = new FakeLedger([500000]);
    const withdrawals = new FakeWithdrawals(ledger);
    const svc = new PayoutService(ledger, withdrawals, new FakeSchemes(), payoutTestConfig());

    await svc.requestWithdrawal('owner-1', 500000, 'BCA');
    // Sequentially this always held. What B-8 changes is that the check now runs inside
    // the same serialized step as the write, so two SIMULTANEOUS requests cannot both
    // read the pre-debit balance and both pass. Only real Postgres can prove that part.
    await expect(svc.requestWithdrawal('owner-1', 500000, 'BCA')).rejects.toBeInstanceOf(
      InsufficientBalanceError,
    );
    expect(withdrawals.created).toHaveLength(1);
  });
});

describe('PayoutService.summary', () => {
  it('reports available balance, recent entries and the next payout date', async () => {
    const ledger = new FakeLedger([300000, -50000]);
    const svc = new PayoutService(ledger, new FakeWithdrawals(), new FakeSchemes(), payoutTestConfig());

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
      const svc = new PayoutService(new FakeLedger([100000]), new FakeWithdrawals(), new FakeSchemes(), payoutTestConfig());

      // H-16 anchors the payout date to Asia/Jakarta, so the 15th is a fixed INSTANT:
      // 00:00 WIB = 17:00Z the day before. Building it from `new Date(2026, 7, 15)` used
      // the RUNNER's local midnight — the same instant only on a WIB machine, which is
      // why it passed here and failed in CI.
      const wibMidnight = (iso: string) => `${iso}T17:00:00.000Z`;

      jest.setSystemTime(new Date('2026-08-03T00:00:00Z'));
      expect((await svc.summary('owner-1')).nextPayoutDate).toBe(wibMidnight('2026-08-14'));

      jest.setSystemTime(new Date('2026-08-20T00:00:00Z'));
      expect((await svc.summary('owner-1')).nextPayoutDate).toBe(wibMidnight('2026-09-14'));
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('PayoutService.ledgerPage', () => {
  it('wraps entries in a page envelope', async () => {
    const ledger = new FakeLedger([100000, 200000]);
    const svc = new PayoutService(ledger, new FakeWithdrawals(), new FakeSchemes(), payoutTestConfig());

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
    const svc = new PayoutService(ledger, new FakeWithdrawals(), new FakeSchemes(), payoutTestConfig());

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
    const svc = new PayoutService(ledger, new FakeWithdrawals(), new FakeSchemes(), payoutTestConfig());

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
    const withdrawals = new FakeWithdrawals(ledger);
    const svc = new PayoutService(ledger, withdrawals, new FakeSchemes(), payoutTestConfig());

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
    const schemes = new FakeSchemes([{ depotId: 'depot-1', pct: 5 }]);
    const svc = new PayoutService(ledger, new FakeWithdrawals(), schemes, payoutTestConfig());

    const out = await svc.recordOrderRevenue(order);

    // Audit S-15 + the Q-17 baseline: one read, for this depot. It used to read every
    // depot's current scheme and pick one out in JavaScript, on every completed order.
    expect(schemes.currentForDepotCalls).toBe(1);

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

  // H-7. The two entries were separate un-transacted writes. A crash between them left
  // the owner credited for a sale HQ never took its cut of — invisible until somebody
  // reconciled a month of ledger by hand.
  it('writes neither entry when the ledger write is cut in half', async () => {
    const ledger = new FakeLedger();
    const svc = new PayoutService(
      ledger,
      new FakeWithdrawals(),
      new FakeSchemes([{ depotId: 'depot-1', pct: 5 }]),
      payoutTestConfig(),
    );
    ledger.failAfter = 1; // the sale lands, then the process dies before the commission

    await expect(svc.recordOrderRevenue(order)).rejects.toThrow('ledger write interrupted');

    expect(ledger.entries).toHaveLength(0);
    expect(await ledger.balanceFor('owner-a')).toBe(0);
  });

  it('backs out the sale and its commission together, or not at all', async () => {
    const ledger = new FakeLedger();
    const svc = new PayoutService(
      ledger,
      new FakeWithdrawals(),
      new FakeSchemes([{ depotId: 'depot-1', pct: 5 }]),
      payoutTestConfig(),
    );
    await svc.recordOrderRevenue(order);
    ledger.failAfter = 1;

    await expect(svc.reverseOrderRevenue(order.orderId, 'salah input')).rejects.toThrow();

    // Still exactly the original pair: no half-reversal that shorts the owner.
    expect(ledger.entries.map((e) => e.type)).toEqual(['SALE_SETTLEMENT', 'COMMISSION']);
  });

  it('posts the sale alone when the depot has no commission scheme', async () => {
    const ledger = new FakeLedger();
    const svc = new PayoutService(ledger, new FakeWithdrawals(), new FakeSchemes(), payoutTestConfig());

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
      payoutTestConfig(),
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
      payoutTestConfig(),
    );

    await svc.recordOrderRevenue(order);
    const replay = await svc.recordOrderRevenue(order);

    expect(replay.recorded).toBe(false);
    expect(ledger.entries).toHaveLength(2);
    expect(await ledger.balanceFor('owner-a')).toBe(228000);
  });

  it('rejects a non-positive amount', async () => {
    const svc = new PayoutService(new FakeLedger(), new FakeWithdrawals(), new FakeSchemes(), payoutTestConfig());
    await expect(svc.recordOrderRevenue({ ...order, amountIdr: 0 })).rejects.toBeInstanceOf(
      InvalidRevenueAmountError,
    );
  });

  it('falls back to the order id when no order number is given, and stamps the completion time', async () => {
    const ledger = new FakeLedger();
    const svc = new PayoutService(ledger, new FakeWithdrawals(), new FakeSchemes(), payoutTestConfig());
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
      payoutTestConfig(),
    );

    it('backs out both rows and leaves the owner exactly where they started', async () => {
      const ledger = new FakeLedger();
      const svc = new PayoutService(
        ledger,
        new FakeWithdrawals(),
        new FakeSchemes([{ depotId: 'depot-1', pct: 5 }]),
      payoutTestConfig(),
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
      const svc = new PayoutService(ledger, new FakeWithdrawals(), schemes,
      payoutTestConfig(),
    );
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
      payoutTestConfig(),
    );
      await live.recordOrderRevenue(order);
      await live.reverseOrderRevenue(order.orderId, 'Batal');
      expect(await live.reverseOrderRevenue(order.orderId, 'Batal')).toEqual({ reversed: false });
      expect(ledger.entries).toHaveLength(4);
    });

    it('writes no commission reversal when none was charged', async () => {
      const ledger = new FakeLedger();
      const svc = new PayoutService(ledger, new FakeWithdrawals(), new FakeSchemes(), payoutTestConfig());
      await svc.recordOrderRevenue({ ...order, depotId: null });

      await svc.reverseOrderRevenue(order.orderId, 'Batal');

      expect(ledger.entries.map((e) => e.type)).toEqual(['SALE_SETTLEMENT', 'SALE_SETTLEMENT']);
      expect(await ledger.balanceFor('owner-a')).toBe(0);
    });
  });
});

// Carried over from PR5 (H-13, H-16). Both build on the shared-ledger fake B-8 introduced:
// the balance guard reads the same ledger the withdrawal debits, so these exercise the
// merged behaviour rather than the pre-B-8 shape they were written against.
describe('PayoutService withdrawal references', () => {
  // H-13: four random digits against a UNIQUE column collide ~27% of days at this
  // volume, and the collision surfaces as a 500 on a real cash-out. A counter cannot.
  it('never issues the same reference twice across cash-outs', async () => {
    const ledger = new FakeLedger([10_000_000]);
    const withdrawals = new FakeWithdrawals(ledger);
    const svc = new PayoutService(ledger, withdrawals, new FakeSchemes(), payoutTestConfig());
    const refs = await Promise.all(
      Array.from({ length: 50 }, () => svc.requestWithdrawal('owner-1', 1000, 'BCA')),
    ).then((ws) => ws.map((w) => w.reference));
    expect(new Set(refs).size).toBe(refs.length);
  });

  // H-16: the date came from the HOST calendar, so a cash-out at 02:00 WIB carried the
  // previous day on a UTC container — and the reference is what finance reconciles by.
  it('stamps the WIB calendar date on the reference', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-03T19:00:00Z')); // 02:00 WIB, 4 Aug
    try {
      const ledger = new FakeLedger([500000]);
      const svc = new PayoutService(
        ledger,
        new FakeWithdrawals(ledger),
        new FakeSchemes(),
        payoutTestConfig(),
      );
      const w = await svc.requestWithdrawal('owner-1', 1000, 'BCA');
      expect(w.reference.slice(0, 11)).toBe('WD-20260804');
    } finally {
      jest.useRealTimers();
    }
  });
});
