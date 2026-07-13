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
  async balanceFor(): Promise<number> {
    return this.entries.reduce((n, e) => n + e.amount, 0);
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
