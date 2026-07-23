import {
  InsufficientBalanceError,
  InvalidEarningRuleError,
  InvalidWithdrawalAmountError,
} from '../src/domain/errors';
import { CourierPayoutService } from '../src/application/services/courier-payout.service';
import type { CourierLedgerEntryType } from '../src/domain/courier-earning';
import type {
  CourierEarningRuleRecord,
  CourierLedgerEntryRecord,
  CourierLedgerRepository,
  CreateCourierLedgerData,
  CreateEarningRuleData,
} from '../src/application/ports/courier-ledger.repository';
import type {
  CourierWithdrawalRecord,
  CourierWithdrawalRepository,
  CreateCourierWithdrawalData,
} from '../src/application/ports/courier-withdrawal.repository';

const DEFAULT_RULE: CourierEarningRuleRecord = {
  id: 'rule-1',
  depotId: null,
  effectiveDate: new Date('2026-01-01'),
  createdAt: new Date('2026-01-01'),
  baseFare: 5000,
  peakBonus: 2000,
  onTimeBonus: 1000,
  peakStartHour: 17,
  peakEndHour: 20,
  monthlyTarget: 5_000_000,
  tiers: [],
};

class FakeCourierLedger implements CourierLedgerRepository {
  entries: CourierLedgerEntryRecord[] = [];
  rule: CourierEarningRuleRecord | null = DEFAULT_RULE;

  async create(data: CreateCourierLedgerData): Promise<CourierLedgerEntryRecord> {
    const row: CourierLedgerEntryRecord = {
      id: `e-${this.entries.length}`,
      courierId: data.courierId,
      depotId: data.depotId,
      type: data.type,
      amount: data.amount,
      description: data.description,
      sourceRef: data.sourceRef ?? null,
      occurredAt: data.occurredAt ?? new Date(),
      createdAt: new Date(),
    };
    this.entries.push(row);
    return row;
  }
  async findBySourceRef(sourceRef: string): Promise<CourierLedgerEntryRecord | null> {
    return this.entries.find((e) => e.sourceRef === sourceRef) ?? null;
  }
  async balanceFor(courierId: string): Promise<number> {
    return this.entries.filter((e) => e.courierId === courierId).reduce((s, e) => s + e.amount, 0);
  }
  async sumByType(
    courierId: string,
    type: CourierLedgerEntryType,
    since: Date,
  ): Promise<number> {
    return this.entries
      .filter((e) => e.courierId === courierId && e.type === type && e.occurredAt >= since)
      .reduce((s, e) => s + e.amount, 0);
  }
  async listForCourier(courierId: string, page: number, limit: number) {
    const all = this.entries
      .filter((e) => e.courierId === courierId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return { items: all.slice((page - 1) * limit, page * limit), total: all.length };
  }
  async countByType(
    courierId: string,
    type: CourierLedgerEntryType,
    since: Date,
  ): Promise<number> {
    return this.entries.filter(
      (e) => e.courierId === courierId && e.type === type && e.occurredAt >= since,
    ).length;
  }
  async currentRule(): Promise<CourierEarningRuleRecord | null> {
    return this.rule;
  }
  rules: CourierEarningRuleRecord[] = [];
  async listRules(): Promise<CourierEarningRuleRecord[]> {
    return this.rules;
  }
  async createRule(data: CreateEarningRuleData): Promise<CourierEarningRuleRecord> {
    const row: CourierEarningRuleRecord = {
      id: `r-${this.rules.length}`,
      createdAt: new Date(),
      ...data,
    };
    this.rules.push(row);
    return row;
  }
}

class FakeCourierWithdrawals implements CourierWithdrawalRepository {
  created: CreateCourierWithdrawalData[] = [];
  async create(data: CreateCourierWithdrawalData): Promise<CourierWithdrawalRecord> {
    this.created.push(data);
    return { ...data, id: `w-${this.created.length}`, createdAt: new Date(), updatedAt: new Date() };
  }
  async listForCourier(courierId: string): Promise<CourierWithdrawalRecord[]> {
    return this.created
      .filter((w) => w.courierId === courierId)
      .map((w, i) => ({ ...w, id: `w-${i}`, createdAt: new Date(), updatedAt: new Date() }));
  }
}

const COURIER = '11111111-1111-4111-8111-111111111111';
// 18:00 WIB = 11:00 UTC → peak; 03:00 UTC = 10:00 WIB → off-peak.
const PEAK_UTC = '2026-07-18T11:00:00.000Z';
const OFFPEAK_UTC = '2026-07-18T03:00:00.000Z';

const event = (deliveryId: string, deliveredAt: string, onTime: boolean) => ({
  courierId: COURIER,
  depotId: null,
  deliveryId,
  deliveredAt,
  onTime,
});

describe('CourierPayoutService', () => {
  let ledger: FakeCourierLedger;
  let withdrawals: FakeCourierWithdrawals;
  let service: CourierPayoutService;

  beforeEach(() => {
    ledger = new FakeCourierLedger();
    withdrawals = new FakeCourierWithdrawals();
    service = new CourierPayoutService(ledger, withdrawals);
  });

  it('credits base + on-time + peak using the WIB hour of deliveredAt', async () => {
    const entry = await service.recordDeliveryEarning(event('d1', PEAK_UTC, true));
    expect(entry?.type).toBe('EARNING');
    expect(entry?.amount).toBe(8000); // 5000 + 2000 peak + 1000 on-time
  });

  it('credits base only for an off-peak, late delivery', async () => {
    const entry = await service.recordDeliveryEarning(event('d2', OFFPEAK_UTC, false));
    expect(entry?.amount).toBe(5000);
  });

  it('is idempotent: a re-pushed delivery posts no second entry', async () => {
    await service.recordDeliveryEarning(event('d3', OFFPEAK_UTC, true));
    await service.recordDeliveryEarning(event('d3', OFFPEAK_UTC, true));
    expect(ledger.entries).toHaveLength(1);
    expect(await service.summary(COURIER)).toMatchObject({ availableBalance: 6000 });
  });

  it('records nothing when no earning rule is configured', async () => {
    ledger.rule = null;
    const entry = await service.recordDeliveryEarning(event('d4', PEAK_UTC, true));
    expect(entry).toBeNull();
    expect(ledger.entries).toHaveLength(0);
  });

  it('summary sums this-month earnings and the balance', async () => {
    await service.recordDeliveryEarning(event('d5', OFFPEAK_UTC, true)); // 6000
    await service.recordDeliveryEarning(event('d6', PEAK_UTC, false)); // 7000
    const summary = await service.summary(COURIER);
    expect(summary.availableBalance).toBe(13000);
    expect(summary.recentEntries).toHaveLength(2);
  });

  describe('recordCashVariance', () => {
    const variance = (settlementId: string, amount: number) => ({
      courierId: COURIER,
      depotId: null,
      settlementId,
      amount,
    });

    it('posts a negative CASH_VARIANCE debit for a shortfall', async () => {
      const entry = await service.recordCashVariance(variance('s1', 15000));
      expect(entry.type).toBe('CASH_VARIANCE');
      expect(entry.amount).toBe(-15000);
      expect(await ledger.balanceFor(COURIER)).toBe(-15000);
    });

    it('is idempotent per settlement id', async () => {
      await service.recordCashVariance(variance('s2', 15000));
      await service.recordCashVariance(variance('s2', 15000));
      expect(ledger.entries).toHaveLength(1);
    });
  });

  describe('requestWithdrawal', () => {
    it('rejects a non-positive amount', async () => {
      await expect(service.requestWithdrawal(COURIER, 0, 'BCA')).rejects.toBeInstanceOf(
        InvalidWithdrawalAmountError,
      );
    });

    it('rejects when the amount exceeds available balance', async () => {
      await service.recordDeliveryEarning(event('d1', OFFPEAK_UTC, false)); // 5000 balance
      await expect(service.requestWithdrawal(COURIER, 6000, 'BCA')).rejects.toBeInstanceOf(
        InsufficientBalanceError,
      );
    });

    it('posts a matching debit that drops the balance to zero on a full cash-out', async () => {
      await service.recordDeliveryEarning(event('d1', PEAK_UTC, true)); // 8000
      const w = await service.requestWithdrawal(COURIER, 8000, 'BCA ···· 4821');
      expect(w.reference).toMatch(/^WD-\d{8}-\d{4}$/);
      expect(withdrawals.created).toHaveLength(1);
      expect(await ledger.balanceFor(COURIER)).toBe(0);
      expect((await service.summary(COURIER)).recentWithdrawals).toHaveLength(1);
    });
  });

  describe('ledger + withdrawal history', () => {
    it('paginates the courier ledger', async () => {
      await service.recordDeliveryEarning(event('d1', OFFPEAK_UTC, false)); // 5000
      await service.recordDeliveryEarning(event('d2', OFFPEAK_UTC, false)); // 5000
      const page = await service.ledgerPage(COURIER, 1, 1);
      expect(page).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
      expect(page.items).toHaveLength(1);
    });

    it('returns the withdrawal history for the courier', async () => {
      await service.recordDeliveryEarning(event('d1', PEAK_UTC, true)); // 8000
      await service.requestWithdrawal(COURIER, 8000, 'BCA');
      const history = await service.withdrawalHistory(COURIER);
      expect(history).toHaveLength(1);
      expect(history[0].amount).toBe(8000);
    });
  });

  describe('earning-rule editor (design 6b)', () => {
    const validRule = {
      depotId: null,
      baseFare: 5000,
      peakBonus: 2000,
      onTimeBonus: 1000,
      peakStartHour: 17,
      peakEndHour: 20,
      monthlyTarget: 5_000_000,
      tiers: [{ deliveries: 25, bonus: 25_000 }],
      effectiveDate: new Date('2026-08-01'),
    };

    it('appends a rule and lists it back', async () => {
      const created = await service.applyEarningRule(validRule);
      expect(created.id).toBeDefined();
      expect(await service.listEarningRules()).toHaveLength(1);
    });

    it('rejects a negative fare', async () => {
      await expect(service.applyEarningRule({ ...validRule, baseFare: -1 })).rejects.toBeInstanceOf(
        InvalidEarningRuleError,
      );
    });

    it('rejects an empty peak window (start ≥ end)', async () => {
      await expect(
        service.applyEarningRule({ ...validRule, peakStartHour: 20, peakEndHour: 17 }),
      ).rejects.toBeInstanceOf(InvalidEarningRuleError);
    });

    it('rejects a negative monthly target', async () => {
      await expect(
        service.applyEarningRule({ ...validRule, monthlyTarget: -1 }),
      ).rejects.toBeInstanceOf(InvalidEarningRuleError);
    });

    it('rejects a ladder with duplicate delivery counts', async () => {
      await expect(
        service.applyEarningRule({
          ...validRule,
          tiers: [
            { deliveries: 25, bonus: 1 },
            { deliveries: 25, bonus: 2 },
          ],
        }),
      ).rejects.toBeInstanceOf(InvalidEarningRuleError);
    });

    it('exposes the effective rule to the courier', async () => {
      expect(await service.effectiveRule(null)).toBe(DEFAULT_RULE);
    });
  });

  describe('monthly incentive tiers', () => {
    // Same-month deliveries; the 2nd one crosses the 2-delivery rung.
    const day = (n: number) => `2026-07-${String(n).padStart(2, '0')}T03:00:00.000Z`;

    beforeEach(() => {
      ledger.rule = {
        ...DEFAULT_RULE,
        tiers: [
          { deliveries: 2, bonus: 25_000 },
          { deliveries: 3, bonus: 60_000 },
        ],
      };
    });

    const incentives = () => ledger.entries.filter((e) => e.type === 'INCENTIVE');

    it('posts nothing before the first rung is reached', async () => {
      await service.recordDeliveryEarning(event('d1', day(1), true));
      expect(incentives()).toHaveLength(0);
    });

    it('credits the rung bonus on the delivery that reaches it', async () => {
      await service.recordDeliveryEarning(event('d1', day(1), true));
      await service.recordDeliveryEarning(event('d2', day(2), true));
      expect(incentives()).toHaveLength(1);
      expect(incentives()[0].amount).toBe(25_000);
      expect(incentives()[0].sourceRef).toContain(':2026-07:2');
    });

    it('pays each rung once even as later deliveries land', async () => {
      for (const id of ['d1', 'd2', 'd3', 'd4']) {
        await service.recordDeliveryEarning(event(id, day(Number(id.slice(1))), true));
      }
      expect(incentives().map((e) => e.amount)).toEqual([25_000, 60_000]);
    });

    it('is idempotent when a delivery is re-pushed', async () => {
      await service.recordDeliveryEarning(event('d1', day(1), true));
      await service.recordDeliveryEarning(event('d2', day(2), true));
      await service.recordDeliveryEarning(event('d2', day(2), true));
      expect(incentives()).toHaveLength(1);
    });

    it('restarts the ladder in a new month', async () => {
      await service.recordDeliveryEarning(event('d1', day(1), true));
      await service.recordDeliveryEarning(event('d2', day(2), true));
      await service.recordDeliveryEarning(event('a1', '2026-08-01T03:00:00.000Z', true));
      await service.recordDeliveryEarning(event('a2', '2026-08-02T03:00:00.000Z', true));
      const refs = incentives().map((e) => e.sourceRef);
      expect(refs).toEqual([
        expect.stringContaining(':2026-07:2'),
        expect.stringContaining(':2026-08:2'),
      ]);
    });
  });
});
