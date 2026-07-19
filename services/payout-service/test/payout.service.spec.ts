import { InsufficientBalanceError, InvalidWithdrawalAmountError } from '../src/domain/errors';
import { PayoutService } from '../src/application/services/payout.service';
import type {
  CreateLedgerEntryData,
  LedgerRepository,
} from '../src/application/ports/ledger.repository';
import type {
  CreateWithdrawalData,
  WithdrawalRepository,
} from '../src/application/ports/withdrawal.repository';
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
    return row;
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
    const svc = new PayoutService(new FakeLedger([100000]), new FakeWithdrawals());
    await expect(svc.requestWithdrawal('owner-1', 0, 'BCA')).rejects.toBeInstanceOf(
      InvalidWithdrawalAmountError,
    );
  });

  it('rejects when the amount exceeds available balance', async () => {
    const svc = new PayoutService(new FakeLedger([100000]), new FakeWithdrawals());
    await expect(svc.requestWithdrawal('owner-1', 150000, 'BCA')).rejects.toBeInstanceOf(
      InsufficientBalanceError,
    );
  });

  it('posts a matching debit that drops the balance to zero on a full cash-out', async () => {
    const ledger = new FakeLedger([500000]);
    const withdrawals = new FakeWithdrawals();
    const svc = new PayoutService(ledger, withdrawals);

    const w = await svc.requestWithdrawal('owner-1', 500000, 'BCA ···· 4821');

    expect(w.reference).toMatch(/^WD-\d{8}-\d{4}$/);
    expect(withdrawals.created).toHaveLength(1);
    expect(await ledger.balanceFor()).toBe(0);
  });
});

describe('PayoutService.summary', () => {
  it('reports available balance, recent entries and the next payout date', async () => {
    const ledger = new FakeLedger([300000, -50000]);
    const svc = new PayoutService(ledger, new FakeWithdrawals());

    const s = await svc.summary('owner-1');
    expect(s.availableBalance).toBe(250000);
    // COMMISSION magnitude is reported unsigned.
    expect(s.monthCommission).toBeGreaterThanOrEqual(0);
    expect(s.recentEntries).toHaveLength(2);
    expect(s.nextPayoutDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('PayoutService.ledgerPage', () => {
  it('wraps entries in a page envelope', async () => {
    const ledger = new FakeLedger([100000, 200000]);
    const svc = new PayoutService(ledger, new FakeWithdrawals());

    const page = await svc.ledgerPage('owner-1', 1, 10);
    expect(page).toMatchObject({ page: 1, limit: 10, total: 2, totalPages: 1 });
    expect(page.items).toHaveLength(2);
  });
});

describe('PayoutService HQ release queue', () => {
  it('lists every owner with a positive balance, highest first', async () => {
    const ledger = new FakeLedger();
    await ledger.create({ franchiseOwnerId: 'owner-a', depotId: null, type: 'SALE_SETTLEMENT', amount: 300000, description: '' });
    await ledger.create({ franchiseOwnerId: 'owner-b', depotId: null, type: 'SALE_SETTLEMENT', amount: 900000, description: '' });
    await ledger.create({ franchiseOwnerId: 'owner-c', depotId: null, type: 'WITHDRAWAL', amount: -100000, description: '' });
    const svc = new PayoutService(ledger, new FakeWithdrawals());

    const pending = await svc.pendingPayouts();
    expect(pending.map((p) => p.franchiseOwnerId)).toEqual(['owner-b', 'owner-a']);
    expect(pending[0].availableBalance).toBe(900000);
    expect(pending[0].nextPayoutDate).toMatch(/^\d{4}-/);
  });

  it('reports one owner balance for the depot-detail payout card', async () => {
    const ledger = new FakeLedger();
    await ledger.create({ franchiseOwnerId: 'owner-a', depotId: null, type: 'SALE_SETTLEMENT', amount: 300000, description: '' });
    await ledger.create({ franchiseOwnerId: 'owner-a', depotId: null, type: 'WITHDRAWAL', amount: -100000, description: '' });
    const svc = new PayoutService(ledger, new FakeWithdrawals());

    const bal = await svc.availableForOwner('owner-a');
    expect(bal.franchiseOwnerId).toBe('owner-a');
    expect(bal.availableBalance).toBe(200000);
    expect(bal.nextPayoutDate).toMatch(/^\d{4}-/);
    // Unknown owner → zero, never throws.
    expect((await svc.availableForOwner('nobody')).availableBalance).toBe(0);
  });

  it('releasing an owner cashes out their full balance via the withdrawal path', async () => {
    const ledger = new FakeLedger();
    await ledger.create({ franchiseOwnerId: 'owner-a', depotId: null, type: 'SALE_SETTLEMENT', amount: 500000, description: '' });
    const withdrawals = new FakeWithdrawals();
    const svc = new PayoutService(ledger, withdrawals);

    const w = await svc.releaseForOwner('owner-a');
    expect(w.amount).toBe(500000);
    expect(w.bankAccountRef).toBe('Rilis HQ');
    expect(withdrawals.created).toHaveLength(1);
    expect(await ledger.balanceFor('owner-a')).toBe(0);
    // Cleared owner no longer appears in the queue.
    expect(await svc.pendingPayouts()).toHaveLength(0);
  });
});
