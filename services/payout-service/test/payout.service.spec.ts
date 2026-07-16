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
